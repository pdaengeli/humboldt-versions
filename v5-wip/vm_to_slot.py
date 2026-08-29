
import json
import sys
import unicodedata
import difflib
import re
import xml.etree.ElementTree as ET
from typing import Dict, List, Tuple, Any

NS = {"tei": "http://www.tei-c.org/ns/1.0"}

BASE_EDITION = "1849"
EDITIONS = ["1808", "1826", "1849"]

INLINE_SAFE_PAIRS = {
    "ß|ss", "ss|ß",
    "ae|ä", "oe|ö", "ue|ü",
    "Ae|Ä", "Oe|Ö", "Ue|Ü"
}
INLINE_MAX_SINGLE_REPLACE = 2
INLINE_ADDITIONS_MAX_LEN = 12


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def normalize_text(s: str) -> str:
    if not s:
        return ""
    has_trailing = s[-1].isspace()
    t = " ".join(nfc(s).split())
    if has_trailing and not t.endswith(" "):
        t += " "
    return t


def normalize_literal(raw: str) -> str:
    if not raw:
        return ""
    has_leading = raw[0].isspace()
    has_trailing = raw[-1].isspace()
    s = " ".join(raw.split())
    if has_leading and (not s.startswith(" ")):
        s = " " + s
    if has_trailing and (not s.endswith(" ")):
        s = s + " "
    return s

ANCHOR_CHAR = "⚓"
SECTION_CHAR = "∬"

def strip_leading_anchors(s: str):
    """
    Remove leading anchor chars from a literal chunk and return:
    (cleaned_text, anchor_count)
    """
    if not s:
        return s, 0
    m = re.match(rf"^\s*({re.escape(ANCHOR_CHAR)}+)\s*", s)
    if not m:
        return s, 0
    count = len(m.group(1))
    return s[m.end():], count


def extract_and_remove_iiif_markers_with_context(l_elem) -> Dict[str, List[Dict]]:
    """
    Extract ⍟URL⍟ markers from entire <l> element tree, tracking which edition each came from.
    PERMANENTLY removes all markers from the tree.

    Returns: { edition -> [metadata_list] }
    """
    marker_char = "⍟"
    pattern = rf"{re.escape(marker_char)}([^{re.escape(marker_char)}]*?){re.escape(marker_char)}"

    metadata_by_edition = {e: [] for e in EDITIONS}

    def process(e, current_edition=None):
        # Process element text
        if e.text:
            for match in re.finditer(pattern, e.text):
                url = match.group(1).strip()
                if url.startswith("http") and current_edition:
                    metadata_by_edition[current_edition].append({"type": "iiif_url", "content": url})
            e.text = re.sub(pattern, "", e.text)
            if e.text == "":
                e.text = None

        # Process children
        for child in list(e):
            # If this is an rdg, determine its edition
            ed_context = current_edition
            if child.tag == f"{{{NS['tei']}}}rdg":
                wit = child.get("wit", "").strip().lstrip("#")
                for ed in EDITIONS:
                    if wit == ed or wit.endswith(f"-{ed}") or wit.endswith(ed):
                        ed_context = ed
                        break

            process(child, ed_context)

            # Process child tail
            if child.tail:
                for match in re.finditer(pattern, child.tail):
                    url = match.group(1).strip()
                    if url.startswith("http") and ed_context:
                        metadata_by_edition[ed_context].append({"type": "iiif_url", "content": url})
                child.tail = re.sub(pattern, "", child.tail)
                if child.tail == "":
                    child.tail = None

    process(l_elem)
    return metadata_by_edition

def extract_and_remove_section_markers_with_context(l_elem) -> Dict[str, List[Dict]]:
    """
    Extract ∬...∬ markers from entire <l> element tree, tracking which edition each came from.
    Marker payload formats:
      - "slug:title"  -> slug for linking, title for display
      - "title"       -> fallback: slug generated from title
    PERMANENTLY removes all markers from the tree.

    Returns: { edition -> [ {"type":"section","slug":"...","title":"..."} ] }
    """
    pattern = rf"{re.escape(SECTION_CHAR)}([^{re.escape(SECTION_CHAR)}]*?){re.escape(SECTION_CHAR)}"

    metadata_by_edition = {e: [] for e in EDITIONS}

    def slugify_fallback(text: str) -> str:
        s = unicodedata.normalize("NFKD", text)
        s = "".join(ch for ch in s if not unicodedata.combining(ch))
        s = s.replace("ß", "ss")
        s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
        s = re.sub(r"[\s_]+", "-", s.strip())
        s = re.sub(r"-{2,}", "-", s).strip("-")
        return s or "section"

    def parse_payload(raw: str) -> Dict[str, str]:
        payload = normalize_literal(raw).strip()
        if not payload:
            return {"slug": "", "title": ""}

        if ":" in payload:
            slug_part, title_part = payload.split(":", 1)
            slug = slug_part.strip()
            title = title_part.strip()
            if not slug and title:
                slug = slugify_fallback(title)
            if not title and slug:
                title = slug.replace("-", " ")
            return {"slug": slug, "title": title}

        # legacy format: only title
        title = payload
        slug = slugify_fallback(title)
        return {"slug": slug, "title": title}

    def add_section(raw_payload: str, ed_context):
        parsed = parse_payload(raw_payload)
        slug = parsed["slug"]
        title = parsed["title"]
        if not slug and not title:
            return
        obj = {"type": "section", "slug": slug, "title": title}

        if ed_context:
            metadata_by_edition[ed_context].append(obj)
        else:
            for ed in EDITIONS:
                metadata_by_edition[ed].append(obj)

    def process(e, current_edition=None):
        if e.text:
            for match in re.finditer(pattern, e.text):
                add_section(match.group(1), current_edition)
            e.text = re.sub(pattern, "", e.text)
            if e.text == "":
                e.text = None

        for child in list(e):
            ed_context = current_edition
            if child.tag == f"{{{NS['tei']}}}rdg":
                wit = child.get("wit", "").strip().lstrip("#")
                for ed in EDITIONS:
                    if wit == ed or wit.endswith(f"-{ed}") or wit.endswith(ed):
                        ed_context = ed
                        break

            process(child, ed_context)

            if child.tail:
                for match in re.finditer(pattern, child.tail):
                    add_section(match.group(1), ed_context)
                child.tail = re.sub(pattern, "", child.tail)
                if child.tail == "":
                    child.tail = None

    process(l_elem)
    return metadata_by_edition


def earliest(ed_list):
    order = {e: i for i, e in enumerate(EDITIONS)}
    return sorted(ed_list, key=lambda e: order.get(e, 99))[0]


def classify_variant(texts: Dict[str, str]) -> Tuple[str, str, List[str]]:
    nonempty = [k for k, v in texts.items() if v]
    unique_nonempty = set(v for v in texts.values() if v)
    if len(nonempty) == 0:
        return ("empty", None, [])
    if len(unique_nonempty) == 1 and len(nonempty) == len(EDITIONS):
        return ("original", None, EDITIONS)
    if len(nonempty) == 1:
        e = nonempty[0]
        return (f"added_in_{e}", "addition", [e])
    if texts.get(BASE_EDITION) and all((k == BASE_EDITION) or (texts[k] == "") for k in EDITIONS):
        return (f"added_in_{BASE_EDITION}", "addition", [BASE_EDITION])
    return ("replaced", "substitution", nonempty)


def coalesce_spans(spans: List[Dict]) -> List[Dict]:
    if not spans:
        return spans
    out = [spans[0]]
    for s in spans[1:]:
        last = out[-1]
        if (
            s["type"] == last["type"]
            and s.get("variant_type") == last.get("variant_type")
            and s["editions"] == last["editions"]
            and s["source"] == last["source"]
            and s.get("changes", []) == last.get("changes", [])
        ):
            last["text"] += " " + s["text"]
        else:
            out.append(s)
    return out


def cleanup_punctuation(spans: List[Dict]) -> List[Dict]:
    for s in spans:
        s["text"] = re.sub(r"\s+([,.;:!?])", r"\1", s["text"])
    return spans


def trim_space_before_punct_spans(spans: List[Dict]) -> List[Dict]:
    punct = set(",.;:!?")
    for i, s in enumerate(spans):
        txt = s.get("text", "")
        if txt and all(ch in punct or ch.isspace() for ch in txt):
            if i > 0:
                spans[i - 1]["text"] = spans[i - 1]["text"].rstrip()
            spans[i]["text"] = spans[i]["text"].lstrip()
    return spans


def add_word_boundaries(spans: List[Dict]) -> List[Dict]:
    def wordy(text: str) -> bool:
        return bool(text) and text[0].isalnum()
    for i in range(len(spans) - 1):
        a, b = spans[i], spans[i + 1]
        if not a["text"].endswith(" ") and not b["text"].startswith(" "):
            if wordy(a["text"]) and wordy(b["text"]):
                a["text"] += " "
    return spans


def extract_l_elements(root):
    return root.findall(".//tei:body//tei:l", NS)


def char_level_diff(base_text: str, other_text: str) -> List[Dict]:
    ops = []
    sm = difflib.SequenceMatcher(None, base_text, other_text)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if tag == "replace":
            ops.append({
                "char_index": i1,
                "operation": "replace",
                "char": other_text[j1:j2],
                "from": base_text[i1:i2]
            })
        elif tag == "delete":
            ops.append({
                "char_index": i1,
                "operation": "delete",
                "char": base_text[i1:i2],
                "from": base_text[i1:i2]
            })
        elif tag == "insert":
            ops.append({
                "char_index": i1,
                "operation": "insert",
                "char": other_text[j1:j2],
                "from": ""
            })
    return ops


def classify_display(span: Dict) -> str:
    if span.get("variant_type") is None and span["type"] == "original":
        return "inline"
    if span.get("variant_type") == "addition":
        if len(span["text"].strip()) <= INLINE_ADDITIONS_MAX_LEN:
            return "inline"
        return "marginal"
    if span.get("variant_type") == "substitution":
        if not span.get("changes"):
            return "inline"
        for ch in span["changes"]:
            for op in ch.get("char_level", []):
                if op["operation"] != "replace":
                    return "marginal"
                from_txt = op.get("from", "")
                to_txt = op.get("char", "")
                if max(len(from_txt), len(to_txt)) > INLINE_MAX_SINGLE_REPLACE:
                    key = f"{from_txt}|{to_txt}"
                    if key not in INLINE_SAFE_PAIRS:
                        return "marginal"
        return "inline"
    return "inline"


def annotate_span(span: Dict):
    eds = span.get("editions", [])
    first = earliest(eds) if eds else BASE_EDITION
    span["earliest_edition"] = first
    span["color_edition"] = first
    span["display"] = classify_display(span)
    for ch in span.get("changes", []):
        ch["earliest_edition"] = ch.get("edition", first)
        ch["display"] = span["display"]


def token_level_merge_additions(a_span, b_span):
    a_tokens = a_span["text"].split()
    b_tokens = b_span["text"].split()
    sm = difflib.SequenceMatcher(None, a_tokens, b_tokens)
    out_spans = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            toks = a_tokens[i1:i2]
            if not toks:
                continue
            eds = sorted(set(a_span["editions"] + b_span["editions"]), key=lambda e: EDITIONS.index(e))
            first = earliest(eds)
            out_spans.append({
                "text": " ".join(toks),
                "type": f"added_in_{first}",
                "variant_type": "addition",
                "editions": eds,
                "source": first,
                "_first_added": first,
                "changes": []
            })
        elif tag == "replace":
            base_toks = a_tokens[i1:i2]
            other_toks = b_tokens[j1:j2]
            base_first = earliest(a_span["editions"])
            out_spans.append({
                "text": " ".join(base_toks),
                "type": f"added_in_{base_first}",
                "variant_type": "addition",
                "editions": sorted(a_span["editions"], key=lambda e: EDITIONS.index(e)),
                "source": base_first,
                "_first_added": base_first,
                "changes": [{
                    "edition": b_span["editions"][0],
                    "text": " ".join(other_toks),
                    "char_level": [],
                    "note": "Substitution (token-level)"
                }]
            })
        elif tag == "delete":
            base_toks = a_tokens[i1:i2]
            if not base_toks:
                continue
            base_first = earliest(a_span["editions"])
            out_spans.append({
                "text": " ".join(base_toks),
                "type": f"added_in_{base_first}",
                "variant_type": "addition",
                "editions": sorted(a_span["editions"], key=lambda e: EDITIONS.index(e)),
                "source": base_first,
                "_first_added": base_first,
                "changes": []
            })
        elif tag == "insert":
            ins_toks = b_tokens[j1:j2]
            if not ins_toks:
                continue
            other_first = earliest(b_span["editions"])
            out_spans.append({
                "text": " ".join(ins_toks),
                "type": f"added_in_{other_first}",
                "variant_type": "addition",
                "editions": sorted(b_span["editions"], key=lambda e: EDITIONS.index(e)),
                "source": other_first,
                "_first_added": other_first,
                "changes": []
            })
    return out_spans


def reconcile_conflicting_additions(spans: List[Dict]) -> List[Dict]:
    out = []
    i = 0
    while i < len(spans):
        if (
            i + 1 < len(spans)
            and spans[i].get("variant_type") == "addition"
            and spans[i + 1].get("variant_type") == "addition"
            and set(spans[i]["editions"]).isdisjoint(spans[i + 1]["editions"])
        ):
            merged = token_level_merge_additions(spans[i], spans[i + 1])
            out.extend(merged)
            i += 2
            continue
        out.append(spans[i])
        i += 1
    return out


def split_replaced_tokenwise(spans: List[Dict]) -> List[Dict]:
    out = []
    for s in spans:
        if not (s.get("type") == "replaced" and s.get("variant_type") == "substitution"):
            out.append(s)
            continue
        if len(s.get("editions", [])) != 2 or len(s.get("changes", [])) != 1:
            out.append(s)
            continue
        base_text = s["text"]
        base_ed = s.get("source", BASE_EDITION) or BASE_EDITION
        ch = s["changes"][0]
        other_ed = ch["edition"]
        other_text = ch["text"]
        a_tokens = base_text.split()
        b_tokens = other_text.split()
        sm = difflib.SequenceMatcher(None, a_tokens, b_tokens)

        new_spans = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                toks = a_tokens[i1:i2]
                if not toks:
                    continue
                eds = sorted([base_ed, other_ed], key=lambda e: EDITIONS.index(e))
                first = earliest(eds)
                new_spans.append({
                    "text": " ".join(toks),
                    "type": f"added_in_{first}",
                    "variant_type": "addition",
                    "editions": eds,
                    "source": first,
                    "_first_added": first,
                    "changes": []
                })
            elif tag == "replace":
                base_toks = a_tokens[i1:i2]
                other_toks = b_tokens[j1:j2]
                if base_toks:
                    new_spans.append({
                        "text": " ".join(base_toks),
                        "type": f"added_in_{base_ed}",
                        "variant_type": "addition",
                        "editions": [base_ed],
                        "source": base_ed,
                        "_first_added": base_ed,
                        "changes": [{
                            "edition": other_ed,
                            "text": " ".join(other_toks),
                            "char_level": [],
                            "note": "Substitution (token-level)"
                        }]
                    })
            elif tag == "delete":
                base_toks = a_tokens[i1:i2]
                if base_toks:
                    new_spans.append({
                        "text": " ".join(base_toks),
                        "type": f"added_in_{base_ed}",
                        "variant_type": "addition",
                        "editions": [base_ed],
                        "source": base_ed,
                        "_first_added": base_ed,
                        "changes": []
                    })
            elif tag == "insert":
                ins_toks = b_tokens[j1:j2]
                if ins_toks:
                    new_spans.append({
                        "text": " ".join(ins_toks),
                        "type": f"added_in_{other_ed}",
                        "variant_type": "addition",
                        "editions": [other_ed],
                        "source": other_ed,
                        "_first_added": other_ed,
                        "changes": []
                    })
        out.extend(new_spans if new_spans else [s])
    return out


def reconstruct_for_edition(segments: List[Dict], edition: str) -> str:
    parts = []
    for s in segments:
        if edition in s["editions"]:
            if s["type"].startswith("added_in_"):
                parts.append(s["text"])
            elif s["type"] == "replaced":
                if edition == BASE_EDITION:
                    parts.append(s["text"])
                else:
                    ch = next((c for c in s.get("changes", []) if c["edition"] == edition), None)
                    if ch:
                        parts.append(ch.get("text", s["text"]))
                    else:
                        parts.append(s["text"])
            else:
                parts.append(s["text"])
    return "".join(parts)


def tokenize(text: str) -> set:
    return set(re.findall(r"\w+", text.lower()))


def jaccard_similarity(a: str, b: str) -> float:
    A, B = tokenize(a), tokenize(b)
    if not A and not B:
        return 1.0
    inter = len(A & B)
    union = len(A | B)
    return inter / union if union else 1.0


def compute_similarity(segments: List[Dict]) -> float:
    base_text = reconstruct_for_edition(segments, BASE_EDITION)
    sims = []
    for ed in EDITIONS:
        if ed == BASE_EDITION:
            continue
        ed_text = reconstruct_for_edition(segments, ed)
        sims.append(jaccard_similarity(base_text, ed_text))
    return sum(sims) / len(sims) if sims else 1.0


def compute_para_stats(segments: List[Dict]) -> Dict:
    stats = {
        "additions": 0,
        "deletions": 0,
        "substitutions": 0,
        "orthographic": 0,
        "total_variants": 0,
        "similarity": 1.0
    }
    for s in segments:
        vt = s.get("variant_type")
        if vt is None:
            continue
        stats["total_variants"] += 1
        if vt == "addition":
            stats["additions"] += 1
        elif vt == "deletion":
            stats["deletions"] += 1
        elif vt == "substitution":
            stats["substitutions"] += 1
        elif vt == "orthographic":
            stats["orthographic"] += 1
    stats["similarity"] = compute_similarity(segments)
    return stats


def add_to_global(global_stats: Dict, para_stats: Dict):
    for k, v in para_stats.items():
        if k == "similarity":
            continue
        global_stats[k] = global_stats.get(k, 0) + v


# -------------------- formatting extraction --------------------

def parse_style_tag(el: ET.Element) -> List[str]:
    tag = el.tag.split("}")[-1]
    styles = []

    if tag in ("b",):
        styles.append("bold")
    if tag in ("em", "i"):
        styles.append("italic")

    rend = (el.get("rend") or "").strip().lower()
    rendition = (el.get("rendition") or "").strip().lower()
    cls = (el.get("class") or "").strip().lower()

    # spaced
    if rend == "spaced" or "lera-spaced" in cls:
        styles.append("spaced")

    # bold hinted via rend
    if rend == "bold":
        styles.append("bold")

    # rendition font hints
    if "#fr" in rendition:
        styles.append("font-fraktur")
    if "#aq" in rendition:
        styles.append("font-antiqua")

    return styles


def merge_runs(runs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not runs:
        return []
    runs = sorted(runs, key=lambda r: (r["start"], r["end"], ",".join(r["styles"])))
    out = [runs[0]]
    for r in runs[1:]:
        last = out[-1]
        if last["end"] == r["start"] and last["styles"] == r["styles"]:
            last["end"] = r["end"]
        else:
            out.append(r)
    return out


def extract_text_and_runs_from_node(node: ET.Element, active_styles: List[str], buf: List[str], runs: List[Dict]):
    if node.text:
        txt = normalize_literal(node.text)
        if txt:
            start = len("".join(buf))
            buf.append(txt)
            end = len("".join(buf))
            if active_styles:
                runs.append({"start": start, "end": end, "styles": sorted(set(active_styles))})

    for child in list(node):
        child_styles = active_styles + parse_style_tag(child)
        extract_text_and_runs_from_node(child, child_styles, buf, runs)

        if child.tail:
            tail = normalize_literal(child.tail)
            if tail:
                start = len("".join(buf))
                buf.append(tail)
                end = len("".join(buf))
                if active_styles:
                    runs.append({"start": start, "end": end, "styles": sorted(set(active_styles))})


def extract_reading_text_and_runs(rdg: ET.Element) -> Tuple[str, List[Dict]]:
    buf: List[str] = []
    runs: List[Dict] = []
    extract_text_and_runs_from_node(rdg, [], buf, runs)
    text = "".join(buf)

    # Normalize and process
    runs = [r for r in merge_runs(runs) if r["start"] < r["end"]]
    return text, runs


def build_segments_from_l(l_elem) -> Tuple[List[Dict], Dict[str, List[Dict]], int, Dict[str, List[Dict]]]:
    # FIRST: Extract all IIIF markers from the entire <l> with edition context and remove them
    paragraph_metadata_by_ed = extract_and_remove_iiif_markers_with_context(l_elem)
    # THEN: Extract all section markers (∬...∬) with edition context and remove them
    section_metadata_by_ed = extract_and_remove_section_markers_with_context(l_elem)

    segments: List[Dict] = []
    edition_runs_map: Dict[str, List[Dict]] = {e: [] for e in EDITIONS}
    edition_cursor: Dict[str, int] = {e: 0 for e in EDITIONS}
    edition_notes_map: Dict[str, List[Dict]] = {e: [] for e in EDITIONS}
    paragraph_anchor_count = 0

    # Add paragraph-level metadata to the appropriate editions
    for ed in EDITIONS:
        edition_notes_map[ed].extend(paragraph_metadata_by_ed.get(ed, []))
        edition_notes_map[ed].extend(section_metadata_by_ed.get(ed, []))

    current_literal: List[str] = []

    def push_to_all_editions(text_piece: str, styles: List[str] = None):
        if styles is None:
            styles = []
        for ed in EDITIONS:
            start = edition_cursor[ed]
            edition_cursor[ed] += len(text_piece)
            if styles:
                edition_runs_map[ed].append({
                    "start": start,
                    "end": edition_cursor[ed],
                    "styles": sorted(set(styles))
                })

    def push_to_edition(ed: str, text_piece: str, runs_local: List[Dict]):
        base = edition_cursor[ed]
        edition_cursor[ed] += len(text_piece)
        for r in runs_local:
            edition_runs_map[ed].append({
                "start": base + r["start"],
                "end": base + r["end"],
                "styles": r["styles"]
            })

    def flush_literal():
        nonlocal paragraph_anchor_count
        if current_literal:
            raw = "".join(current_literal)
            s = normalize_literal(raw)

            # strip LERA anchor chars from literal text and store metadata count
            s, c = strip_leading_anchors(s)
            if c:
                paragraph_anchor_count += c

            if s.strip():
                span = {
                    "text": s,
                    "type": "original",
                    "variant_type": None,
                    "editions": EDITIONS,
                    "source": BASE_EDITION,
                    "changes": []
                }
                annotate_span(span)
                segments.append(span)
                push_to_all_editions(s, [])
            current_literal.clear()

    if l_elem.text:
        current_literal.append(l_elem.text)

    for child in l_elem:
        if child.tag == f"{{{NS['tei']}}}app":
            flush_literal()

            texts = {e: "" for e in EDITIONS}
            rdg_runs = {e: [] for e in EDITIONS}

            for rdg in child.findall("./tei:rdg", NS):
                wit = rdg.get("wit", "").strip().lstrip("#")
                # map possible witness ids like anchor-1849 -> 1849
                for ed in EDITIONS:
                    if wit == ed or wit.endswith(f"-{ed}") or wit.endswith(ed):
                        # Markers already removed at paragraph level; just extract text
                        txt_raw, runs = extract_reading_text_and_runs(rdg)
                        val = normalize_text(txt_raw)
                        texts[ed] = val
                        if val:
                            if len(txt_raw) == len(val):
                                rdg_runs[ed] = runs
                            else:
                                rdg_runs[ed] = []
                        break

            vtype, vsub, eds = classify_variant(texts)

            if vtype == "empty":
                pass
            elif vtype.startswith("added_in_"):
                for ed in eds:
                    if texts[ed]:
                        span = {
                            "text": texts[ed],
                            "type": f"added_in_{ed}",
                            "variant_type": "addition",
                            "editions": [ed],
                            "source": ed,
                            "_first_added": ed,
                            "changes": []
                        }
                        annotate_span(span)
                        segments.append(span)
                        push_to_edition(ed, texts[ed], rdg_runs.get(ed, []))
            elif vtype == "original":
                span = {
                    "text": texts[BASE_EDITION],
                    "type": "original",
                    "variant_type": None,
                    "editions": EDITIONS,
                    "source": BASE_EDITION,
                    "changes": []
                }
                annotate_span(span)
                segments.append(span)
                rep_runs = rdg_runs.get(BASE_EDITION, [])
                for ed in EDITIONS:
                    push_to_edition(ed, texts[BASE_EDITION], rep_runs if ed == BASE_EDITION else rdg_runs.get(ed, []))
            elif vtype == "replaced":
                if eds:
                    base_text = texts.get(BASE_EDITION, "") or texts.get(eds[0], "")
                    source_ed = BASE_EDITION if texts.get(BASE_EDITION) else eds[0]
                    changes = []
                    for ed in eds:
                        if ed == BASE_EDITION:
                            continue
                        other_text = texts[ed]
                        if other_text == base_text:
                            changes.append({
                                "edition": ed,
                                "text": other_text,
                                "char_level": [],
                                "note": f"Matches {BASE_EDITION}"
                            })
                        else:
                            changes.append({
                                "edition": ed,
                                "text": other_text,
                                "char_level": char_level_diff(base_text, other_text),
                                "note": "Substitution (char-level)"
                            })
                    span = {
                        "text": base_text,
                        "type": "replaced",
                        "variant_type": vsub,
                        "editions": sorted(eds, key=lambda e: EDITIONS.index(e)),
                        "source": source_ed,
                        "changes": changes
                    }
                    annotate_span(span)
                    segments.append(span)

                    for ed in EDITIONS:
                        if ed not in span["editions"]:
                            continue
                        if ed == BASE_EDITION:
                            push_to_edition(ed, base_text, rdg_runs.get(BASE_EDITION, []))
                        else:
                            ch = next((c for c in changes if c["edition"] == ed), None)
                            ed_txt = ch["text"] if ch else base_text
                            push_to_edition(ed, ed_txt, rdg_runs.get(ed, []))

            if child.tail:
                current_literal.append(child.tail)
        else:
            if child.text:
                current_literal.append(child.text)
            if child.tail:
                current_literal.append(child.tail)

    flush_literal()
    segments = [s for s in segments if s["text"]]
    segments = coalesce_spans(segments)
    segments = cleanup_punctuation(segments)
    segments = trim_space_before_punct_spans(segments)
    segments = reconcile_conflicting_additions(segments)
    segments = coalesce_spans(segments)
    segments = split_replaced_tokenwise(segments)
    segments = coalesce_spans(segments)
    segments = add_word_boundaries(segments)

    for s in segments:
        if "display" not in s:
            annotate_span(s)

    for ed in EDITIONS:
        edition_runs_map[ed] = merge_runs(edition_runs_map[ed])

    return segments, edition_runs_map, paragraph_anchor_count, edition_notes_map


def build_slots(root) -> Dict:
    l_elems = extract_l_elements(root)
    content = []
    global_stats = {
        "paragraphs": 0,
        "additions": 0,
        "deletions": 0,
        "substitutions": 0,
        "orthographic": 0,
        "total_variants": 0
    }

    for idx, l in enumerate(l_elems):
        num = l.get("n")
        segments, format_runs, paragraph_anchor_count, edition_notes_map = build_segments_from_l(l)

        para_stats = compute_para_stats(segments)
        add_to_global(global_stats, para_stats)
        global_stats["paragraphs"] += 1

        edition_text = {ed: reconstruct_for_edition(segments, ed) for ed in EDITIONS}

        content.append({
            "index": idx,
            "data": {
                "number": int(num) if num and num.isdigit() else num,
                "meta": {"slot_note": f"L n={num} from VM; witnesses {','.join(EDITIONS)}"},
                "unified_text": segments,
                "note_positions": {},
                "notes": edition_notes_map,
                "apparatus": "auto-generated from VM",
                "stats": para_stats,
                "edition_text": edition_text,
                "format_runs": format_runs,
                "format_notes": [],
                "anchor_count": paragraph_anchor_count
            }
        })

    return {
        "meta": {
            "generated_at": "2026-06-30T00:00:00Z",
            "editions": EDITIONS,
            "generator": "vm-to-slot-inline-marginal-format-runs",
            "stats": global_stats
        },
        "content": content
    }


def main(xml_path: str):
    tree = ET.parse(xml_path)
    root = tree.getroot()
    slot_json = build_slots(root)
    json.dump(slot_json, sys.stdout, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python vm_to_slot.py <vm_tei.xml>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])

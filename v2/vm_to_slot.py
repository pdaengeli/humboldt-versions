import json
import sys
import unicodedata
import difflib
import re
import xml.etree.ElementTree as ET
from typing import Dict, List, Tuple

NS = {"tei": "http://www.tei-c.org/ns/1.0"}

BASE_EDITION = "1849"
# Chronological order so "earliest" picks first-use correctly.
EDITIONS = ["1808", "1826", "1849"]

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
            and s["variant_type"] == last["variant_type"]
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
            eds = sorted(set(a_span["editions"] + b_span["editions"]),
                         key=lambda e: EDITIONS.index(e))
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
                if edition in s["editions"]:
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
        else:
            continue
    return "".join(parts)

def build_segments_from_l(l_elem) -> List[Dict]:
    segments: List[Dict] = []
    current_literal: List[str] = []

    def flush_literal():
        if current_literal:
            raw = "".join(current_literal)
            s = normalize_literal(raw)
            if s.strip():
                segments.append({
                    "text": s,
                    "type": "original",
                    "variant_type": None,
                    "editions": EDITIONS,
                    "source": BASE_EDITION,
                    "changes": []
                })
            current_literal.clear()

    if l_elem.text:
        current_literal.append(l_elem.text)

    for child in l_elem:
        if child.tag == f"{{{NS['tei']}}}app":
            flush_literal()
            texts = {e: "" for e in EDITIONS}
            for rdg in child.findall("./tei:rdg", NS):
                wit = rdg.get("wit", "").strip().lstrip("#")
                val = normalize_text(rdg.text or "")
                if wit in texts:
                    texts[wit] = val

            vtype, vsub, eds = classify_variant(texts)

            if vtype == "empty":
                pass
            elif vtype.startswith("added_in_"):
                for ed in eds:
                    if texts[ed]:
                        segments.append({
                            "text": texts[ed],
                            "type": f"added_in_{ed}",
                            "variant_type": "addition",
                            "editions": [ed],
                            "source": ed,
                            "_first_added": ed,
                            "changes": []
                        })
            elif vtype == "original":
                segments.append({
                    "text": texts[BASE_EDITION],
                    "type": "original",
                    "variant_type": None,
                    "editions": EDITIONS,
                    "source": BASE_EDITION,
                    "changes": []
                })
            elif vtype == "replaced":
                if eds:
                    base_text = texts.get(BASE_EDITION, "") or texts.get(eds[0], "")
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
                    segments.append({
                        "text": base_text,
                        "type": "replaced",
                        "variant_type": vsub,
                        "editions": sorted(eds, key=lambda e: EDITIONS.index(e)),
                        "source": BASE_EDITION if texts.get(BASE_EDITION) else eds[0],
                        "changes": changes
                    })
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
    return segments

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
        segments = build_segments_from_l(l)
        para_stats = compute_para_stats(segments)
        add_to_global(global_stats, para_stats)
        global_stats["paragraphs"] += 1
        content.append({
            "index": idx,
            "data": {
                "number": int(num) if num and num.isdigit() else num,
                "meta": { "slot_note": f"L n={num} from VM; witnesses {','.join(EDITIONS)}" },
                "unified_text": segments,
                "note_positions": {},
                "notes": [],
                "apparatus": "auto-generated from VM",
                "stats": para_stats
            }
        })
    return {
        "meta": {
            "generated_at": "2025-12-05T00:00:00Z",
            "editions": EDITIONS,
            "generator": "vm-to-slot-sample",
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

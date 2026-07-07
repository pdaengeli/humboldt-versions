import unicodedata
import difflib
from typing import Dict, List, Tuple
from .tei_parse import extract_l_elements
from .postprocess import (
    coalesce_spans,
    cleanup_punctuation,
    trim_space_before_punct_spans,
    add_word_boundaries,
)
from .reconstruct import compute_para_stats, add_to_global

BASE_EDITION = "1849"
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
        if child.tag.endswith("app"):
            flush_literal()
            texts = {e: "" for e in EDITIONS}
            for rdg in child.findall("./tei:rdg", {"tei": "http://www.tei-c.org/ns/1.0"}):
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

    # Post-processing pipeline
    segments = [s for s in segments if s["text"]]
    segments = coalesce_spans(segments)
    segments = cleanup_punctuation(segments)
    segments = trim_space_before_punct_spans(segments)
    segments = coalesce_spans(segments)
    segments = add_word_boundaries(segments)
    return segments

def build_slots(root) -> Dict:
    l_elems = extract_l_elements(root)
    content = []
    global_stats = {
        "paragraphs": 0,
        "additions": 0,
        "deletions": 0,
        "substitutions": 0,
        "orthographic": 0,
        "total_variants": 0,
    }
    for idx, l in enumerate(l_elems):
        num = l.get("n")
        segments = build_segments_from_l(l)
        para_stats = compute_para_stats(segments, BASE_EDITION, EDITIONS)
        add_to_global(global_stats, para_stats)
        global_stats["paragraphs"] += 1
        content.append({
            "index": idx,
            "data": {
                "number": int(num) if num and num.isdigit() else num,
                "meta": {"slot_note": f"L n={num} from VM; witnesses {','.join(EDITIONS)}"},
                "unified_text": segments,
                "note_positions": {},
                "notes": [],
                "apparatus": "auto-generated from VM",
                "stats": para_stats,
            }
        })
    return {
        "meta": {
            "editions": EDITIONS,
            "generator": "slotbuilder",
            "stats": global_stats,
        },
        "content": content,
    }
"""Reconstruction and statistics helpers."""

import re
from typing import Dict, List

def reconstruct_for_edition(segments: List[Dict], edition: str, base: str) -> str:
    parts = []
    for s in segments:
        if edition not in s["editions"]:
            continue
        if s["type"].startswith("added_in_"):
            parts.append(s["text"])
        elif s["type"] == "replaced":
            if edition == base:
                parts.append(s["text"])
            else:
                ch = next((c for c in s.get("changes", []) if c["edition"] == edition), None)
                parts.append(ch.get("text", s["text"]) if ch else s["text"])
        else:
            parts.append(s["text"])
    return "".join(parts)

def _tokenize(text: str) -> set:
    return set(re.findall(r"\w+", text.lower()))

def _jaccard(a: str, b: str) -> float:
    A, B = _tokenize(a), _tokenize(b)
    if not A and not B:
        return 1.0
    inter, union = len(A & B), len(A | B)
    return inter / union if union else 1.0

def compute_similarity(segments: List[Dict], base: str, editions: List[str]) -> float:
    base_text = reconstruct_for_edition(segments, base, base)
    sims = []
    for ed in editions:
        if ed == base:
            continue
        ed_text = reconstruct_for_edition(segments, ed, base)
        sims.append(_jaccard(base_text, ed_text))
    return sum(sims) / len(sims) if sims else 1.0

def compute_para_stats(segments: List[Dict], base: str, editions: List[str]) -> Dict:
    stats = {
        "additions": 0,
        "deletions": 0,
        "substitutions": 0,
        "orthographic": 0,
        "total_variants": 0,
        "similarity": 1.0,
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
    stats["similarity"] = compute_similarity(segments, base, editions)
    return stats

def add_to_global(global_stats: Dict, para_stats: Dict):
    for k, v in para_stats.items():
        if k == "similarity":
            continue
        global_stats[k] = global_stats.get(k, 0) + v
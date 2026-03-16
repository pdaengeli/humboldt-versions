"""Span post-processing helpers."""

import re
from typing import Dict, List

def coalesce_spans(spans: List[Dict]) -> List[Dict]:
    if not spans:
        return spans
    out = [spans[0]]
    for s in spans[1:]:
        last = out[-1]
        if (
            s["type"] == last["type"]
            and s.get("variant_type") == last.get("variant_type")
            and s.get("editions") == last.get("editions")
            and s.get("source") == last.get("source")
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
# AvH: Ansichten der Natur · Textgenesis (v2)

## Data generation pipeline
1. Sentence-level alignment on LERA.
2. LERA export in Versioning Machine (VM) XML.
3. Transform to slot JSON:
   ```bash
   python3 vm_to_slot.py humboldt-vm-parallel-seg.xml > slot_output.json
   ```

## Variant / diff handling (summary)
- **Inline (colored) only when:**
  - Safe small pairs: ß↔ss, ae↔ä, oe↔ö, ue↔ü (incl. caps).
  - Single-character replaces (length 1), even if not in the safe set.
- **Everything else goes to the apparatus:**
  - *NB: apparatus/marginal notes still to be refined*
  - Multi-letter substitutions (e.g., “zur”↔“der”), multi-token diffs, inserts/deletes >1 char.
  - Conflicting additions (back-to-back from disjoint editions) are token-diffed: each token is an addition with earliest-use color; the opposing reading is recorded for the apparatus.
- **Additions:** Underlined inline, colored by earliest edition in the span (`_first_added`). Text remains inline.
- **Spacing/punctuation hygiene:** Removes spaces before punctuation; trims/adjusts whitespace around punctuation-only spans.
- **Edition order:** 1808 < 1826 < 1849 (used to pick “first use” color).

## Frontend features (v2)
- **Paragraph navigation:** TOC in groups of 10; hash links (`#para-N`) scroll with offset for the sticky legend/header.
- **Edition toggle:** All / 1808 / 1826 / 1849.
- **Variant-type filters:** 
  - *NB: categorisation to be revised*
  - Legacy implementation from v1: Orthographic, Lexical, Substitution, Addition, Deletion.
- **Colors & mode:** Edition colors adjustable; text or background color mode toggle.
- **Underlines:** Additions underlined at `0.075em` thickness, `0.175em` offset.
- **Per-paragraph stats:** Similarity badge; change counters (+ / – / subs).
  - Currently: Jaccard similarity over lowercased word tokens (replaces prior char-level SequenceMatcher ratio).
- **Apparatus:** By default hides variants already shown inline/underlined; optional toggle “show all variants in margin”.
- **Font sizing:** `A-`/`A+` font scale controls.
- **Lazy load:** Batch rendering via Intersection Observer.

## TODO (essentials)
- Group commentary and improve styling of notes.
- Retain typographic features:
  - LERA can import several typographic features but does not export them.
  - Re-introduce paragraph-level token/character offset sidecars (generated from source files) and merge them in the frontend so the original typography is preserved in rendering.
- Refine variant categories/wording in the sidebar and apparatus phrasing.
- Tighten apparatus filtering/phrasing once categories are finalized.
- Improve tooltip information based on refined variant categories/wording
- Derive print input format (IDML or HTML/CSS route)

## Files (v2)
- `v2/index.html` — current UI.
- `v2/slot_output.json` — generated Slot JSON (from VM XML).
- `v2/comparison_provenance.json` — provenance/compare metadata (if present).
- `v2/vm_to_slot.py` — VM XML → Slot JSON converter.
- `v2/humboldt-vm-parallel-seg.xml` — VM XML input.


## Status

Prototype - Functional for analysis and visualization, primarily meant for discussion (UI mostly stable, data model, categorisation and rendering may still change).


```
Created: December 2025
Last updated: 2025-12-06
```

# AvH: Ansichten der Natur · Textgenesis (v3 — current stage)

Prototype UI + data model iteration for exploring the textual genesis of *Ansichten der Natur* across **1808 / 1826 / 1849**.

This README describes the **current v3 stage** (as implemented now).

---

## Data generation pipeline (current)
1. Sentence-/segment-level alignment on LERA.
2. Export as Versioning Machine (VM) XML.
3. Transform VM XML → Slot JSON:
   ```bash
   python3 vm_to_slot.py humboldt-vm-parallel-seg.xml > slot_output.json
   ```

**Primary data file used by the frontend**
- `slot_output.json` (slot-based paragraph content with edition membership and change metadata).

---

## Data model & rendering assumptions (current)
The frontend renders each paragraph from `unified_text` (an array of “spans” / segments). Segments typically include:

- `text`: surface string for the **base**/latest edition representation (currently 1849).
- `editions`: list of editions the segment belongs to (subset of `["1808","1826","1849"]`).
- `display`: `"inline"` or `"marginal"` (or forced-to-marginal by UI rules, e.g. long additions).
- Substitutions:
  - `type: "replaced"`, `variant_type: "substitution"`
  - `changes[]`: earlier-edition readings (optionally with `char_level` ops).
- Additions:
  - `variant_type: "addition"` plus edition membership.

**Edition order**
- `1808 < 1826 < 1849` (used to choose “latest earlier difference” and color assignment).

---

## Views (reading modes)
The UI provides two “families” of reading views:

### 1) Comparative view: `Alle Ausgaben (vergleichend)`
This is the analysis/variant view:
- Inline variants are highlighted (color/underline rules).
- Marginal apparatus is shown in the right column.
- Optional settings affect inline vs marginal display.
- Per-paragraph header shows:
  - earliest edition badge
  - edition chips (1808/1826/1849)
  - optional paragraph stats (similarity and counters)

### 2) Pure edition views (isolated text)
- `1. Ausgabe (1808)`
- `2. Ausgabe (1826)`
- `3. Ausgabe (1849)`

In these views the paragraph is reconstructed for the selected edition and rendered as plain running text:
- **No variant markup** (no color chips, no dotted underlines, no tooltips).
- **No marginal apparatus** column.
- Paragraph header is simplified to show only the **selected edition** badge.
- Purpose: “How it was printed” per edition, without comparative features.

---

## Variant / diff handling (current behavior)
### Inline vs marginal (high level)
- **Inline variants** appear in the running text (and are typically *not* duplicated in the apparatus by default).
- **Marginal variants** appear as dotted-underlined placeholders in the running text and as notes in the apparatus.

### “Show all variants in margin”
Setting: **„alle Varianten marginal einblenden“**

- **Default (off):**
  - Inline variants: shown inline only; **no dotted underline** and **no marginal note**.
  - Marginal variants: dotted underline + marginal note visible.

- **Enabled (on):**
  - Inline variants: additionally get a dotted underline cue and **also appear in the apparatus** (so everything becomes available in the margin).

### Underlines
- Additions inline: solid underline, colored by earliest edition.
- Marginal placeholders: dotted underline, colored by edition-based cue.

### Tooltips (marginal placeholders)
Marginal placeholder tooltips are compressed to avoid redundancy:
- identical earlier readings from multiple editions are grouped, e.g.  
  `1808 1826: Denn wenn → Wenn`

---

## Correction mode (editorial workflow — current prototype)
A correction-focused navigation tool is available in **comparative view only**.

### UI
- Bottom-left **drawer / balloon** (fixed position, does not reflow the layout).
- Enable/disable toggle (`aktiv`), status indicator (`current/total`).
- **Jump to paragraph** input (`§ … Go`) to resume work roughly where you left off.
- Filter groups:
  1) **Ort**: inline / marginal
  2) **Typ**: Ersetzung / Ergänzung / Tilgung
  3) **Länge (nur Ersetzung)**: single-char / multi-char (best-effort classification)

### Navigation
- Buttons: `←` / `→`
- Keyboard:
  - `←` / `→` or `j` / `k`: previous/next
  - `Esc`: disables correction mode and closes the drawer

### Behaviour
- Targets are indexed in **document order** from the **currently rendered** content.
- When stepping:
  - the selected inline/marginal element is highlighted
  - the corresponding apparatus entry is highlighted when present
  - scrolling accounts for the sticky header + legend so highlights do not end up hidden
- Lazy loading compromise:
  - correction mode primarily indexes loaded paragraphs
  - when stepping forward past the end of loaded targets, it will attempt to load the next batch and refresh

### Implementation note (Phase 2)
To keep filters resilient and avoid tight coupling to rendering branches, each rendered variant gets:
- a `data-variant-id` on its DOM node (already present)
- a metadata mapping `variantMetaById.set(variantId, span)` (used for filtering/classification)

---

## UI features (current)
- **Sticky header** and **sticky legend** (legend stays visible under the header).
- **Edition colors:** fixed defaults (1808 yellow / 1826 red / 1849 violet), adjustable via color pickers.
- **Settings panel:** cogwheel toggles settings area (no auto-scroll/jump).
- **Font sizing:** `A-` / `A+` font scale controls.
- **Paragraph navigation:** TOC in groups of 10; hash links (`#para-N`) supported with a scroll offset.
- **Lazy load:** batch rendering via Intersection Observer.
- **Apparatus interactions:**
  - Hovering dotted marginal placeholders highlights the corresponding apparatus entry.
  - Clicking apparatus notes scrolls to the corresponding inline location.

---

## Files (current stage)
(Names may vary slightly depending on repo layout; update if paths differ.)

- `index.html` — current UI.
- `styles.css` — styling (legend stickiness, paragraph layout, apparatus, correction drawer).
- `app.js` — state + rendering logic (comparative vs edition views, apparatus generation, correction mode).
- `slot_output.json` — generated Slot JSON (from VM XML).
- `vm_to_slot.py` — VM XML → Slot JSON converter.
- `humboldt-vm-parallel-seg.xml` — VM XML input.

---

## Known limitations (current)
- Variant categories are currently simplified / in flux (sidebar filtering removed in current v3 stage).
- Apparatus phrasing and grouping is “good enough” for exploration but not yet editorial quality.
- Typographic features from print (spacing nuances, italics, bold, etc.) are not preserved end-to-end.
- Correction mode IDs are stable only within a render session (variant ids are generated during rendering). Persisting editorial decisions will require stable IDs (data-level) or a robust matching layer.

---

## Next steps / possible enhancements

### 1) Re-introduction of formatting / typography
Goal: recover print-level formatting such as:
- spacing fidelity
- italics, bold, small caps (if present)
- punctuation/quotation marks handling

Potential approach:
- Generate per-edition standoff annotations (character offsets per paragraph/edition).
- Merge formatting into reconstructed edition text in the frontend.
- For comparative view: decide whether formatting follows base edition, selected edition, or hybrid rules.

### 2) Apparatus refinement
- More consistent labeling (edition labels, change type labels).
- Better grouping and de-duplication.
- Optional “show only marginal” vs “show all” modes.

### 3) Define path towards print

---

## Status
Prototype — functional for analysis and visualization, primarily meant for discussion.
Data model, rendering rules, and editorial UX are expected to evolve.

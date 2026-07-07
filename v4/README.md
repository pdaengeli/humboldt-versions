# AvH: Ansichten der Natur · Textgenesis (v4 — current stage)

Prototype UI + data model iteration for exploring the textual genesis of *Ansichten der Natur* across **1808 / 1826 / 1849**.

This README describes the **current v4 stage**.

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

**New v4 paragraph-level information**
- `edition_text: { "1808": "...", "1826": "...", "1849": "..." }`
- `format_runs: { edition -> [{start, end, styles[]}, ...] }`
- `format_notes: []` (currently placeholder)

**Edition order**
- `1808 < 1826 < 1849` (used to choose “latest earlier difference” and color assignment).

---

## Views (reading modes)

### 1) Comparative view: `Alle Ausgaben (vergleichend)`
This is the analysis/variant view:
- Inline variants are highlighted (color/underline rules).
- Marginal apparatus is shown in the right column.
- Optional settings affect inline vs marginal display.
- Per-paragraph header shows:
  - earliest edition badge
  - edition chips (1808/1826/1849)
  - optional paragraph stats (similarity and counters)
- format-diff cues and possible format entries in apparatus.

### 2) Pure edition views (isolated text)
- `1. Ausgabe (1808)`
- `2. Ausgabe (1826)`
- `3. Ausgabe (1849)`

In these views the paragraph is reconstructed for the selected edition and rendered as plain running text:
- **No variant markup** (no color chips, no dotted underlines, no tooltips).
- **No marginal apparatus** column.
- Paragraph header is simplified to show only the **selected edition** badge.
- Purpose: “How it was printed” per edition, without comparative features.
- typography/formatting runs are applied to reconstructed edition text.

---

## Variant and apparatus behavior
### Inline vs marginal (high level)
- **Inline variants** appear in the running text (and are typically *not* duplicated in the apparatus by default).
- **Marginal variants** appear as dotted-underlined placeholders in the running text and as notes in the apparatus.
- Long additions may be forced to marginal by threshold logic.

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

### 1849-only paragraphs
If a paragraph’s earliest edition is 1849:
- additions are rendered as running text,
- redundant addition notes are suppressed in apparatus.

### Tooltip compaction
Marginal placeholder tooltips are compressed to avoid redundancy:
- identical earlier readings from multiple editions are grouped, e.g.  
  `1808 1826: Denn wenn → Wenn`

---

## Correction mode (comparative view only)
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

Implementation note:
- variant DOM nodes carry `data-variant-id`,
- span metadata is indexed via `variantMetaById` for robust filtering.

---

## UI features (current)
- **Sticky header** and **sticky legend** (legend stays visible under the header).
- **Edition colors:** fixed defaults (1808 yellow / 1826 red / 1849 violet), adjustable via color pickers.
- **Settings panel:** cogwheel toggles settings area (no auto-scroll/jump).
- **Font sizing:** `A-` / `A+` font scale controls.
- **Responsive behavior** with minimum-width notice for very small screens.
- **Paragraph navigation:** TOC in groups of 10; hash links (`#para-N`) supported with a scroll offset.
- **Lazy load:** batch rendering via Intersection Observer.
- **Apparatus interactions:**
  - Hovering dotted marginal placeholders highlights the corresponding apparatus entry.
  - Clicking apparatus notes scrolls to the corresponding inline location.

---

## Files (current stage)
- `index.html` — layout and controls
- `styles.css` — UI styles, apparatus, correction drawer, formatting classes/cues
- `app.js` — state, rendering logic, comparative/pure views, correction mode, format-diff handling
- `slot_output.json` — generated Slot JSON (text + formatting layer; generated from VM XML)
- `vm_to_slot.py` — VM XML → Slot JSON converter
- `humboldt-vm-parallel-seg.xml` — VM XML input

---

## What is new in v4 (vs v3)

V4 now includes **formatting-aware rendering and format-diff cues**.

### 1) Formatting-aware data export
The converter now exports, per paragraph:
- `edition_text` (reconstructed text for each edition),
- `format_runs` (character-range style annotations per edition),
- `format_notes` (reserved for further use).

This extends the previous v3 slot model (primarily textual variants) with typography-level information.

### 2) Formatting-aware frontend rendering
The UI can now render style runs in both comparative and pure-edition views:
- bold
- italic
- spaced letterforms
- font hints (fraktur / antiqua classes)

### 3) Format-diff detection in comparative mode
In comparative view, the app detects style differences between 1849 and earlier editions (1808/1826):
- affected tokens get a visual format-diff cue,
- corresponding format notes can appear in the apparatus,
- adjacent notes with identical signatures are merged for readability.

### 4) Better TEI reading extraction
Nested markup inside `<rdg>` is now parsed recursively (including text, child nodes, and tails), improving fidelity from VM XML into slot JSON.

---

---

## Known limitations
- Variant category model remains pragmatic and may evolve.
- Apparatus phrasing/grouping is exploratory, not final editorial apparatus.
- Formatting alignment across editions is heuristic in ambiguous repetition cases.
- Format-diff anchoring is best-effort and can be imperfect in highly repetitive strings.
- Correction-mode variant IDs are render-session-specific (not yet persistent editorial IDs).

---

## Next steps / possible enhancements
1. **Stabilize persistent IDs** for long-term editorial correction workflows.
2. **Refine formatting collation** for repeated tokens and ambiguous anchors.
3. **Improve apparatus wording** (clearer distinction: textual vs formatting changes).
4. **Editorial export path** (print-ready / TEI-back annotations / audit trail).
5. **Configurable formatting policy** in comparative mode (base-edition vs edition-specific vs hybrid).

---

## Status
Prototype — functional for analysis and visualization, now with (partial) formatting support (v4).
Data model, rendering rules, and editorial UX are expected to evolve further.
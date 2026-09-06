// Slot viewer (refined)
// - Fixed palette: 1808 yellow, 1826 red, 1849 violet
// - Comparative view ("all"): inline variants + marginal apparatus
// - Pure edition views (1808/1826/1849): render full text of that edition with NO variants/appartus
// - Correction mode (comparative only): bottom-left drawer + next/prev stepping through variants
//   + focus toggles (hide right variants column, hide paragraph stats)
// - Improvement: For paragraphs whose earliest edition is 1849, suppress redundant "addition" marginalization
//   (additions render as plain running text; no apparatus note)
// ---------------------------------------------------------------------------

let allData = [];
let metaData = null;
let displayedCount = 0;
const BATCH_SIZE = 25;
let isLoading = false;

let currentEdition = 'all';
let showAllVariants = false;
let showStats = true;
let legendExpanded = false; // collapsed by default
let variantColorMode = 'text';
let fontScale = 1;
let inlineAddMax = 12;

// Fixed palette
const BASE_EDITION = '1849';
const editionColors = { '1808': '#f5c211', '1826': '#c01c28', '1849': '#8e44ad' };
const editionOrder  = { '1808': 0, '1826': 1, '1849': 2 };

const spanRegistry = new Map();     // variant-id -> DOM node
const variantMetaById = new Map();  // variant-id -> span object (Phase 2 for correction mode & filtering)
let correctionMode = null;          // initialized later (avoid TDZ / load order issues)

// NOTE LINKING
const noteLinkRegistry = new Map();      // refId  -> target note paragraph number
const noteBackLinkRegistry = new Map();  // noteId -> source ref paragraph number
const noteEntryToRefRegistry = new Map();    // noteEntryId -> noteRefId
const noteRefElementRegistry = new Map();    // noteId -> apparatus-note DOM element

// ---------------------------------------------------------------------------
// Formatting helpers

function runClass(style) {
  if (style === 'bold') return 'fmt-bold';
  if (style === 'italic') return 'fmt-italic';
  if (style === 'spaced') return 'fmt-spaced';
  if (style === 'font-fraktur') return 'fmt-font-fraktur';
  if (style === 'font-antiqua') return 'fmt-font-antiqua';
  return '';
}

function styleClasses(styles = []) {
  return (styles || []).map(runClass).filter(Boolean).join(' ');
}

function applyRunsToText(text, runs = []) {
  const safeText = text || '';
  if (!runs || !runs.length || !safeText.length) return [{ text: safeText, classes: '' }];

  const events = [];
  runs.forEach(r => {
    const s = Math.max(0, Math.min(safeText.length, r.start ?? 0));
    const e = Math.max(0, Math.min(safeText.length, r.end ?? 0));
    if (e <= s) return;
    events.push({ i: s, t: 'start', styles: r.styles || [] });
    events.push({ i: e, t: 'end', styles: r.styles || [] });
  });

  events.sort((a, b) => a.i - b.i || (a.t === 'end' ? -1 : 1));

  const out = [];
  let cursor = 0;
  const active = new Map();

  const keyOf = (arr) => (arr || []).slice().sort().join('|');

  for (let k = 0; k < events.length; ) {
    const idx = events[k].i;

    if (idx > cursor) {
      const stylesNow = Array.from(active.values()).flat();
      out.push({
        text: safeText.slice(cursor, idx),
        classes: styleClasses([...new Set(stylesNow)])
      });
      cursor = idx;
    }

    while (k < events.length && events[k].i === idx && events[k].t === 'end') {
      active.delete(`k-${k}-${keyOf(events[k].styles)}`);
      k++;
    }
    while (k < events.length && events[k].i === idx && events[k].t === 'start') {
      active.set(`k-${k}-${keyOf(events[k].styles)}`, events[k].styles || []);
      k++;
    }
  }

  if (cursor < safeText.length) {
    const stylesNow = Array.from(active.values()).flat();
    out.push({
      text: safeText.slice(cursor),
      classes: styleClasses([...new Set(stylesNow)])
    });
  }

  return out.filter(p => p.text.length > 0);
}

function appendTextWithRuns(parent, text, runs) {
  const parts = applyRunsToText(text, runs);
  parts.forEach(p => {
    if (!p.classes) parent.appendChild(document.createTextNode(p.text));
    else {
      const s = document.createElement('span');
      s.className = p.classes;
      s.textContent = p.text;
      parent.appendChild(s);
    }
  });
}

function findTextFirstIndex(full, needle, from = 0) {
  if (!needle) return -1;
  return full.indexOf(needle, from);
}

// NOTE HELPERS
function noteStem(id) {
  return String(id || '').replace(/-(ref|note)\s*$/, '').trim();
}


function buildNoteLinkRegistry() {
  noteLinkRegistry.clear();
  noteBackLinkRegistry.clear();
  noteEntryToRefRegistry.clear();

  const entryByStem = new Map(); // stem -> { para, ed, noteId }
  const refByStem = new Map();   // stem -> { para, ed, refId }
  const prio = { '1849': 3, '1826': 2, '1808': 1 };

  allData.forEach(item => {
    const para = Number(item?.data?.number);
    const notesByEd = item?.data?.notes || {};
    ['1808', '1826', '1849'].forEach(ed => {
      (notesByEd[ed] || []).forEach(n => {
        if (n?.type === 'note_entry' && n?.id) {
          const stem = noteStem(n.id);
          if (!stem) return;
          const prev = entryByStem.get(stem);
          if (!prev || (prio[ed] || 0) > (prio[prev.ed] || 0)) {
            entryByStem.set(stem, { para, ed, noteId: String(n.id) });
          }
        }
        if (n?.type === 'note_ref' && n?.id) {
          const stem = noteStem(n.id);
          if (!stem) return;
          const prev = refByStem.get(stem);
          // prefer earliest occurrence; if tie, prefer newer edition
          if (!prev || para < prev.para || (para === prev.para && (prio[ed] || 0) > (prio[prev.ed] || 0))) {
            refByStem.set(stem, { para, ed, refId: String(n.id) });
          }
        }
      });
    });
  });

  // forward links (ref -> note para)
  allData.forEach(item => {
    const notesByEd = item?.data?.notes || {};
    ['1808', '1826', '1849'].forEach(ed => {
      (notesByEd[ed] || []).forEach(n => {
        if (n?.type !== 'note_ref' || !n?.id) return;
        const stem = noteStem(n.id);
        const target = entryByStem.get(stem);
        if (target?.para) noteLinkRegistry.set(String(n.id), target.para);
      });
    });
  });

  // backlinks (note -> ref para) + entry -> ref mapping
  allData.forEach(item => {
    const notesByEd = item?.data?.notes || {};
    ['1808', '1826', '1849'].forEach(ed => {
      (notesByEd[ed] || []).forEach(n => {
        if (n?.type !== 'note_entry' || !n?.id) return;
        const entryId = String(n.id);
        const stem = noteStem(entryId);
        const src = refByStem.get(stem);
        if (src?.para) noteBackLinkRegistry.set(entryId, src.para);
        if (src?.refId) noteEntryToRefRegistry.set(entryId, src.refId);
      });
    });
  });
}

function collectRefIdsForParagraph(item) {
  const out = [];
  const seen = new Set();
  const notesByEd = item?.data?.notes || {};
  ['1808', '1826', '1849'].forEach(ed => {
    (notesByEd[ed] || []).forEach(n => {
      if (n?.type === 'note_ref' && n?.id) {
        const id = String(n.id);
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    });
  });
  return out;
}

function collectNoteEntryIdsForParagraph(item) {
  const out = [];
  const seen = new Set();
  const notesByEd = item?.data?.notes || {};
  ['1808', '1826', '1849'].forEach(ed => {
    (notesByEd[ed] || []).forEach(n => {
      if (n?.type === 'note_entry' && n?.id) {
        const id = String(n.id);
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    });
  });
  return out;
}

function injectNoteRefLinks(textDiv, item) {
  if (!textDiv || !item) return;

  const refIds = collectRefIdsForParagraph(item);
  if (!refIds.length) return;

  const superscriptRE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
  const walker = document.createTreeWalker(textDiv, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  let refIdx = 0;

  nodes.forEach(tn => {
    if (refIdx >= refIds.length) return;
    const raw = tn.nodeValue || '';
    superscriptRE.lastIndex = 0;
    if (!superscriptRE.test(raw)) return;
    superscriptRE.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    let m;

    while ((m = superscriptRE.exec(raw)) !== null) {
      if (refIdx >= refIds.length) break;

      const before = raw.slice(last, m.index);
      if (before) frag.appendChild(document.createTextNode(before));

      const refText = m[0];
      const refId = refIds[refIdx++];
      const targetPara = noteLinkRegistry.get(refId);

      const a = document.createElement('a');
      a.className = 'note-ref-link';
      a.textContent = refText;
      a.dataset.noteRefId = refId;
      if (targetPara) {
        a.href = `#para-${targetPara}`;
        a.dataset.notePara = String(targetPara);
        a.title = `Zur Anmerkung springen (§ ${targetPara})`;
      } else {
        a.href = '#';
        a.title = 'Anmerkung';
      }

      a.addEventListener('click', (e) => {
        if (!targetPara) return;
        e.preventDefault();
        ensureLoaded(targetPara - 1);
        scrollToParagraph(targetPara);
      });

      frag.appendChild(a);
      last = superscriptRE.lastIndex;
    }

    const tail = raw.slice(last);
    if (tail) frag.appendChild(document.createTextNode(tail));
    tn.parentNode.replaceChild(frag, tn);
  });
}

function injectNoteBackLinks(textDiv, item) {
  if (!textDiv || !item) return;

  const entryIds = collectNoteEntryIdsForParagraph(item);
  if (!entryIds.length) return;

  // One backlink per note paragraph (first note entry id in that paragraph)
  const noteEntryId = entryIds[0];
  const noteRefId = noteEntryToRefRegistry.get(noteEntryId);
  const sourcePara = noteBackLinkRegistry.get(noteEntryId);
  if (!sourcePara) return;

  const back = document.createElement('a');
  back.className = 'note-back-link';
  back.href = `#para-${sourcePara}`;
  back.title = `Zurück zur Verweisstelle (§ ${sourcePara})`;
  back.textContent = '⮴';

  back.addEventListener('click', (e) => {
    e.preventDefault();
    ensureLoaded(sourcePara - 1);
    scrollToParagraph(sourcePara);

    if (noteRefId) {
      const appNote = noteRefElementRegistry.get(noteRefId);
      if (appNote) {
        appNote.classList.add('cm-active-note');
        setTimeout(() => appNote.classList.remove('cm-active-note'), 1200);
      }

      const refAnchor = document.querySelector(`a.note-ref-link[data-note-ref-id="${noteRefId}"]`);
      if (refAnchor) {
        refAnchor.classList.add('inline-highlight');
        setTimeout(() => refAnchor.classList.remove('inline-highlight'), 1200);
      }
    }
  });

  // prepend before paragraph content
  textDiv.insertBefore(back, textDiv.firstChild);
}


function linkifyApparatusNoteText(noteText, item, targetId) {
  const frag = document.createDocumentFragment();
  const text = String(noteText || '');

  // Linkify only the special markers you said you emit in preprocessing.
  // Add more symbols here if needed later.
  const markerRE = /([⁺*])/g;

  const superscriptToNoteId = (marker) => {
    // Prefer edition-aware note refs from the current paragraph
    const notesByEd = item?.data?.notes || {};
    const eds = ['1808', '1826', '1849'];

    // Heuristic: the marker came from the earliest edition that differs in the variant.
    // We use the variant metadata attached to the target apparatus span to identify
    // which earlier edition(s) introduced the reading.
    const span = variantMetaById.get(targetId) || null;

    // If this is a substitution, use the earliest differing edition(s)
    const candidateEds = [];
    if (span?.type === 'replaced' && Array.isArray(span.changes)) {
      const diffs = span.changes.filter(ch => ch.text && ch.text !== span.text);
      diffs.forEach(ch => {
        if (ch?.edition && !candidateEds.includes(ch.edition)) candidateEds.push(ch.edition);
      });
    }

    // For additions, use the edition(s) in which the addition exists.
    if (span?.variant_type === 'addition' && Array.isArray(span.editions)) {
      span.editions.forEach(ed => {
        if (ed && !candidateEds.includes(ed)) candidateEds.push(ed);
      });
    }

    // Fallback: try editions in chronological order
    if (!candidateEds.length) candidateEds.push(...eds);

    for (const ed of candidateEds) {
      const ref = (notesByEd[ed] || []).find(n => n?.type === 'note_ref' && n?.id);
      if (ref?.id) return ref.id;
    }
    return null;
  };

  let last = 0;
  let m;

  while ((m = markerRE.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before) frag.appendChild(document.createTextNode(before));

    const marker = m[1];
    const noteRefId = superscriptToNoteId(marker);
    const a = document.createElement('a');
    a.className = 'note-ref-link apparatus-note-marker';
    a.textContent = marker;
    a.href = noteRefId ? `#${noteRefId}` : '#';
    a.title = noteRefId ? 'Zur Verweisstelle springen' : 'Verweisstelle nicht gefunden';
    if (noteRefId) a.dataset.noteRefId = noteRefId;

    a.addEventListener('click', (e) => {
      if (!noteRefId) return;
      e.preventDefault();

      const targetPara = noteLinkRegistry.get(noteRefId);
      if (targetPara) {
        ensureLoaded(targetPara - 1);
        scrollToParagraph(targetPara);
      }

      const sourceSpan = spanRegistry.get(targetId);
      if (sourceSpan) {
        sourceSpan.classList.add('inline-highlight');
        setTimeout(() => sourceSpan.classList.remove('inline-highlight'), 1200);
      }

      const appNote = noteRefElementRegistry.get(noteRefId);
      if (appNote) {
        appNote.classList.add('cm-active-note');
        setTimeout(() => appNote.classList.remove('cm-active-note'), 1200);
      }
    });

    frag.appendChild(a);
    last = markerRE.lastIndex;
  }

  const tail = text.slice(last);
  if (tail) frag.appendChild(document.createTextNode(tail));

  return frag;
}

function getSpanFormatRuns(item, spanText, edition, cursorObj) {
  const fr = item?.data?.format_runs?.[edition] || [];
  const full = item?.data?.edition_text?.[edition] || '';
  if (!spanText || !full || !fr.length) return [];

  const startGuess = findTextFirstIndex(full, spanText, cursorObj.pos || 0);
  if (startGuess < 0) return [];

  const endGuess = startGuess + spanText.length;
  cursorObj.pos = endGuess;

  const overlap = [];
  fr.forEach(r => {
    const s = Math.max(startGuess, r.start);
    const e = Math.min(endGuess, r.end);
    if (e > s) {
      overlap.push({
        start: s - startGuess,
        end: e - startGuess,
        styles: r.styles || []
      });
    }
  });
  return overlap;
}

function isParagraphMergeMarker(span) {
  return span?.type === 'paragraph_merge_marker' || span?.marker_kind === 'paragraph_merge';
}

// ---------------------------------------------------------------------------
// Formatting diff helpers (NEW)

function stylesAtRange(runs, start, end) {
  if (!runs?.length || end <= start) return [];
  const st = new Set();
  runs.forEach(r => {
    const s = Math.max(start, r.start ?? 0);
    const e = Math.min(end, r.end ?? 0);
    if (e > s) (r.styles || []).forEach(x => st.add(x));
  });
  return [...st].sort();
}

function fmtStylesLabel(styles) {
  if (!styles || !styles.length) return 'regular';
  return styles.join('+');
}

function getFormatDiffForSpan(item, spanText, cursorMap) {
  const runsByEd = item?.data?.format_runs || {};
  const txt1849 = item?.data?.edition_text?.['1849'] || '';
  if (!spanText || !txt1849) return null;

  // Anchor in 1849 (exact/case-insensitive)
  let s1849 = findTextFirstIndex(txt1849, spanText, cursorMap['1849']?.pos || 0);
  if (s1849 < 0) s1849 = txt1849.toLowerCase().indexOf(spanText.toLowerCase(), cursorMap['1849']?.pos || 0);
  if (s1849 < 0) return null;

  const e1849 = s1849 + spanText.length;
  cursorMap['1849'].pos = e1849;

  const baseStyles = stylesAtRange(runsByEd['1849'] || [], s1849, e1849);

  // Helper: style lookup in earlier editions with tolerant first-char case flip
  function lookupStyles(ed) {
    const full = item?.data?.edition_text?.[ed] || '';
    let s = findTextFirstIndex(full, spanText, cursorMap[ed]?.pos || 0);
    if (s < 0) s = full.toLowerCase().indexOf(spanText.toLowerCase(), cursorMap[ed]?.pos || 0);

    if (s < 0 && spanText.length > 0) {
      const flip = spanText[0] === spanText[0].toLowerCase()
        ? spanText[0].toUpperCase() + spanText.slice(1)
        : spanText[0].toLowerCase() + spanText.slice(1);
      s = findTextFirstIndex(full, flip, cursorMap[ed]?.pos || 0);
      if (s < 0) s = full.toLowerCase().indexOf(flip.toLowerCase(), cursorMap[ed]?.pos || 0);
    }

    if (s < 0) return null;
    const e = s + spanText.length;
    cursorMap[ed].pos = e;
    return stylesAtRange(runsByEd[ed] || [], s, e);
  }

  const s1808 = lookupStyles('1808');
  const s1826 = lookupStyles('1826');

  const diffEds = [];
  if (s1808 && JSON.stringify(s1808) !== JSON.stringify(baseStyles)) diffEds.push('1808');
  if (s1826 && JSON.stringify(s1826) !== JSON.stringify(baseStyles)) diffEds.push('1826');

  // Safety net: if earlier has explicit run starting at 0 and token is first-word-like, treat as diff
  if (!diffEds.length && s1849 === 0) {
    const has1808Start = (runsByEd['1808'] || []).some(r => r.start === 0 && (r.styles || []).length);
    const has1826Start = (runsByEd['1826'] || []).some(r => r.start === 0 && (r.styles || []).length);
    const has1849Start = (runsByEd['1849'] || []).some(r => r.start === 0 && (r.styles || []).length);

    if (has1808Start !== has1849Start) diffEds.push('1808');
    if (has1826Start !== has1849Start) diffEds.push('1826');
  }

  if (!diffEds.length) return null;

  const latestEarlier = diffEds.includes('1826') ? '1826' : '1808';

  const classesSet = new Set();

  // collect concrete style classes from differing earlier editions
  if (s1808 && diffEds.includes('1808')) s1808.forEach(st => classesSet.add(runClass(st)));
  if (s1826 && diffEds.includes('1826')) s1826.forEach(st => classesSet.add(runClass(st)));
  classesSet.delete(''); // remove unknowns

  const fmtClasses = [...classesSet];

  const detail = `${diffEds.join(', ')}: ${fmtClasses.length ? fmtClasses.join(', ') : 'format differs'} · 1849: ${fmtStylesLabel(baseStyles)}`;

  return {
    hasDiff: true,
    editionsDiff: diffEds,
    latestEarlier,
    detail,
    fmtClasses,
    signature: `fmt|${diffEds.join(',')}|${latestEarlier}|${detail}`
  };
}

function mergeAdjacentFormatNotes(notes) {
  if (!notes?.length) return [];

  const getPos = (id) => {
    const m = (id || '').match(/^v-(\d+)-(\d+)-/);
    if (!m) return null;
    return { para: parseInt(m[1], 10), idx: parseInt(m[2], 10) };
  };

  const out = [{ ...notes[0] }];

  for (let i = 1; i < notes.length; i++) {
    const n = notes[i];
    const last = out[out.length - 1];
    const a = getPos(last.targetId);
    const b = getPos(n.targetId);

    const contiguous =
      a && b &&
      a.para === b.para &&
      b.idx === a.idx + 1 &&
      last.signature === n.signature &&
      last.colorEd === n.colorEd;

    if (contiguous) {
      last.text = `${last.text}${n.text.startsWith(' ') ? '' : ' '}${n.text}`;
    } else {
      out.push({ ...n });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers

function isVisiblyEmpty(item) {
  if (!item?.data) return true;

  const unified = item.data.unified_text || [];
  const notesByEd = item.data.notes || {};
  const editionText = item.data.edition_text || {};

  const hasVisibleText =
    unified.some(s => String(s?.text || '').trim().length > 0) ||
    Object.values(editionText).some(t => String(t || '').trim().length > 0);

  const hasUsefulNotes =
    ['1808', '1826', '1849'].some(ed =>
      (notesByEd[ed] || []).some(n => ['note_ref', 'note_entry', 'section'].includes(n?.type))
    );

  return !(hasVisibleText || hasUsefulNotes);
}

function isComparativeView() { return currentEdition === 'all'; }

function editionLabel(ed) {
  if (ed === '1808') return '1. Ausgabe (1808)';
  if (ed === '1826') return '2. Ausgabe (1826)';
  if (ed === '1849') return '3. Ausgabe (1849)';
  return ed;
}

function editionText(span, edition) {
  if (edition === 'all') return span.text;
  if (!span.editions.includes(edition)) return null;
  if (span.type === 'replaced' && edition !== BASE_EDITION) {
    const ch = (span.changes || []).find(c => c.edition === edition);
    return ch ? ch.text ?? span.text : span.text;
  }
  return span.text;
}

function spanClasses(span) {
  const classes = ['word'];
  if (span.variant_type) classes.push(span.variant_type);
  if (span.type === 'replaced') classes.push('substitution');
  return classes;
}

function paragraphBaseEdition(segments) {
  const order = { '1808': 0, '1826': 1, '1849': 2 };
  let best = '1849';
  segments.forEach(s => (s.editions || []).forEach(ed => { if ((order[ed] ?? 9) < (order[best] ?? 9)) best = ed; }));
  return best;
}

function isInline(span) {
  if (span.variant_type === 'addition' && (span.text || '').length > inlineAddMax) return false;
  return span.display === 'inline';
}

function latestEarlierDiffEdition(span) {
  if (!span.changes || !span.changes.length) return null;
  const diffs = span.changes.filter(ch => ch.text && ch.text !== span.text);
  if (!diffs.length) return null;
  return diffs.sort((a, b) => (editionOrder[b.edition] ?? 99) - (editionOrder[a.edition] ?? 99))[0];
}

// Build a plain paragraph string for a given edition (no variants/appartus)
function reconstructParagraphText(segments, edition) {
  let out = '';
  (segments || []).forEach(s => {
    if (!s?.editions?.includes(edition)) return;

    if (s.type === 'original' || (s.type && s.type.startsWith('added_in_')) || s.variant_type === 'addition') {
      out += s.text || '';
      return;
    }

    if (s.type === 'replaced') {
      if (edition === BASE_EDITION) {
        out += s.text || '';
      } else {
        const ch = (s.changes || []).find(c => c.edition === edition);
        out += (ch?.text ?? s.text ?? '');
      }
      return;
    }

    out += s.text || '';
  });
  return out;
}

// Tooltip text for marginal placeholders (group identical earlier readings by editions)
function marginalTooltip(span) {
  if (span.variant_type === 'addition') {
    return `Ergänzung: ${span.editions?.join(', ') || ''}`;
  }
  if (span.type === 'replaced' && span.changes?.length) {
    const diffs = span.changes.filter(ch => ch.text !== span.text);
    if (!diffs.length) return 'Variante';

    const grouped = new Map(); // earlierText -> [editions...]
    diffs.forEach(ch => {
      const key = ch.text;
      const list = grouped.get(key) || [];
      list.push(ch.edition);
      grouped.set(key, list);
    });

    return Array.from(grouped.entries())
      .map(([txt, eds]) => `${eds.join(' ')}: ${txt} \u2192 ${span.text}`)
      .join('\n');
  }
  return 'Variante';
}

function applyEditionColorsToLegend() {
  document.documentElement.style.setProperty('--color-1808', editionColors['1808']);
  document.documentElement.style.setProperty('--color-1826', editionColors['1826']);
  document.documentElement.style.setProperty('--color-1849', editionColors['1849']);
}

function applyFontScale() {
  document.documentElement.style.setProperty('--unified-text-scale', fontScale);
}

// Helper: Get the last IIIF URL before a paragraph across all collected URLs
function getLastIiifUrlsForParagraph(allDataUpTo, paraIdx) {
  const urls = {
    '1808': null,
    '1826': null,
    '1849': null
  };

  // Scan backwards from current paragraph to find the most recent IIIF URL per edition
  for (let i = paraIdx; i >= 0; i--) {
    const item = allDataUpTo[i];
    if (!item?.data?.notes) continue;

    for (const ed of ['1808', '1826', '1849']) {
      if (!urls[ed]) {
        const notes = item.data.notes[ed] || [];
        const iiifNote = notes.find(n => n.type === 'iiif_url');
        if (iiifNote) {
          urls[ed] = iiifNote.content;
        }
      }
    }

    // If all editions have URLs, we can stop searching
    if (urls['1808'] && urls['1826'] && urls['1849']) break;
  }

  return urls;
}

// Helper: Build fragment viewer URL
function buildFragmentViewerUrl(urls) {
  const params = new URLSearchParams();

  if (urls['1808']) params.append('1808', urls['1808']);
  if (urls['1826']) params.append('1826', urls['1826']);
  if (urls['1849']) params.append('1849', urls['1849']);

  if (params.toString()) {
    return `../facsimile-viewer.html?${params.toString()}`;
  }
  return null;
}

// Sticky offset for legend under header
function updateHeaderOffset() {
  const headerEl = document.querySelector('.header');
  if (!headerEl) return;
  const style = getComputedStyle(headerEl);
  const h = headerEl.offsetHeight + parseFloat(style.marginBottom || '0');
  document.documentElement.style.setProperty('--header-offset', `${h}px`);
}

// Merge helper for additions with identical text (comparative view only)
function mergeAdjacentAdditions(spans) {
  const out = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s?.variant_type === 'addition' && i + 1 < spans.length) {
      const n = spans[i + 1];
      if (n?.variant_type === 'addition' && n.text === s.text) {
        const eds = Array.from(new Set([...(s.editions || []), ...(n.editions || [])]));
        eds.sort((a, b) => (editionOrder[a] ?? 99) - (editionOrder[b] ?? 99));
        out.push({ ...s, editions: eds, source: eds[0], earliest_edition: eds[0], color_edition: eds[0] });
        i += 1;
        continue;
      }
    }
    out.push(s);
  }
  return out;
}

function getStickyTopOffset() {
  const header = document.querySelector('.header');
  const legend = document.querySelector('.legend-shell');

  const headerH = header ? header.getBoundingClientRect().height : 0;
  const legendH = legend ? legend.getBoundingClientRect().height : 0;

  // breathing room so highlight is not glued to the legend
  return headerH + legendH + 60;
}

function scrollToElement(el) {
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.pageYOffset - getStickyTopOffset();
  window.scrollTo({ top: y, behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Comparative rendering

function renderCharLevelSubstitution(span) {
  const base = span.text;
  const byIdx = new Map();

  (span.changes || []).forEach(ch => {
    (ch.char_level || []).forEach(op => {
      if (op.operation !== 'replace') return;
      const idx = op.char_index;
      const candidate = { ed: ch.edition, earlier: op.char, baseLen: Math.max(1, (op.from || '').length || 1) };
      const prev = byIdx.get(idx);
      if (!prev || (editionOrder[ch.edition] ?? 99) > (editionOrder[prev.ed] ?? 99)) byIdx.set(idx, candidate);
    });
  });

  const wrapper = document.createElement('span');
  wrapper.className = spanClasses(span).join(' ');

  // dotted underline only if marginal OR showAllVariants
  if (span.display === 'marginal' || showAllVariants) {
    const diffEd = latestEarlierDiffEdition(span);
    if (diffEd) {
      const cueColor = editionColors[diffEd.edition] || '#000';
      wrapper.style.textDecoration = `underline dotted ${cueColor}`;
      wrapper.style.textDecorationThickness = '0.08em';
      wrapper.style.textUnderlineOffset = '0.18em';
    }
  }

  let i = 0;
  while (i < base.length) {
    const entry = byIdx.get(i);
    const baseChar = base[i];
    if (entry) {
      const colored = document.createElement('span');
      colored.className = 'char-variant';
      colored.style.color = editionColors[entry.ed] || '#000';
      colored.textContent = baseChar;
      colored.title = `${entry.ed}: ${entry.earlier} \u2192 ${baseChar}`;
      wrapper.appendChild(colored);
      i += entry.baseLen;
    } else {
      wrapper.appendChild(document.createTextNode(baseChar));
      i += 1;
    }
  }
  return wrapper;
}

function renderSpans(merged, paraNum, paraBaseEd, item) {
  const frag = document.createDocumentFragment();
  const spanIds = new Array(merged.length).fill(null);
  let variantIdx = 0;

  const fmtCursor = {
    '1808': { pos: 0 },
    '1826': { pos: 0 },
    '1849': { pos: 0 }
  };

  const register = (el, idx, span) => {
    if (span.variant_type || span.type === 'replaced') {
      const id = `v-${paraNum}-${idx}-${variantIdx++}`;
      el.dataset.variantId = id;
      spanRegistry.set(id, el);
      variantMetaById.set(id, span);
      spanIds[idx] = id;
    }
  };

  const applyFormatCue = (el, txt, fmtDiff) => {
    if (!fmtDiff?.hasDiff || !isComparativeView()) return;
    el.classList.add('format-diff-cue');

    const accents = (fmtDiff.editionsDiff || []).map(ed => editionColors[ed] || 'transparent');
    el.style.setProperty('--fmt-accent-1', accents[0] || 'transparent');
    el.style.setProperty('--fmt-accent-2', accents[1] || 'transparent');
    el.style.setProperty('--fmt-accent-3', accents[2] || 'transparent');

    const fmtClasses = fmtDiff.fmtClasses || [];

    el.dataset.formatDiff = JSON.stringify({
      latestEarlier: fmtDiff.latestEarlier,
      detail: fmtDiff.detail,
      signature: fmtDiff.signature,
      text: txt,
      fmtClasses
    });

    el.title = (el.title ? `${el.title}\n` : '') + `Format: ${fmtDiff.detail}`;
  };

  merged.forEach((span, idx) => {
    if (isParagraphMergeMarker(span)) {
      if (!isComparativeView()) return;

      const el = document.createElement('span');
      el.className = 'paragraph-merge-inline';

      const eds = (span.editions || []).slice().sort((a, b) => (editionOrder[a] ?? 99) - (editionOrder[b] ?? 99));

      // choose latest changed edition for color (1826 in your case)
      const colorEd = eds.length ? eds[eds.length - 1] : (span.source || BASE_EDITION);
      const color = editionColors[colorEd] || '#6c757d';

      el.style.setProperty('--merge-marker-color', color);
      el.title = `Absatzzusammenführung (${eds.join(', ') || colorEd})`;

      frag.appendChild(el);
      return;
    }

    const txt = editionText(span, currentEdition);
    if (txt === null) return;

    const runs = getSpanFormatRuns(item, txt, BASE_EDITION, fmtCursor['1849']);
    const fmtDiff = getFormatDiffForSpan(item, txt, fmtCursor);

    if (paraBaseEd === '1849' && span.variant_type === 'addition') {
      const el = document.createElement('span');
      el.className = 'word';
      appendTextWithRuns(el, txt, runs);
      applyFormatCue(el, txt, fmtDiff);
      frag.appendChild(el);
      return;
    }

    if (isInline(span)) {
      if (span.variant_type === 'addition') {
        const el = document.createElement('span');
        el.className = 'word addition';
        const color = editionColors[span.earliest_edition || span.editions?.[0] || BASE_EDITION] || '#000';
        el.style.textDecoration = `underline solid ${color}`;
        el.style.textDecorationThickness = '0.075em';
        el.style.textUnderlineOffset = '0.175em';
        if (variantColorMode === 'background') { el.style.background = color + '33'; el.style.color = '#000'; }
        else { el.style.color = color; }

        appendTextWithRuns(el, txt, runs);
        el.title = `Erg. ${span.editions.join(', ')}`;
        applyFormatCue(el, txt, fmtDiff);

        register(el, idx, span);
        frag.appendChild(el);
        return;
      }

      if (span.type === 'replaced' && span.variant_type === 'substitution') {
        const el = renderCharLevelSubstitution(span);
        applyFormatCue(el, txt, fmtDiff);
        register(el, idx, span);
        frag.appendChild(el);
        return;
      }

      const el = document.createElement('span');
      el.className = spanClasses(span).join(' ');
      appendTextWithRuns(el, txt, runs);
      applyFormatCue(el, txt, fmtDiff);

      register(el, idx, span);
      frag.appendChild(el);
      return;
    }

    const el = document.createElement('span');
    el.className = 'word marginal-placeholder';
    el.style.opacity = '0.85';
    appendTextWithRuns(el, txt, runs);

    const color = editionColors[span.earliest_edition || span.editions?.[0] || BASE_EDITION] || '#000';
    el.style.textDecoration = `underline dotted ${color}`;
    el.style.textDecorationThickness = '0.08em';
    el.style.textUnderlineOffset = '0.18em';
    el.title = marginalTooltip(span);

    applyFormatCue(el, txt, fmtDiff);
    register(el, idx, span);

    el.addEventListener('mouseenter', () => {
      const note = document.querySelector(`.apparatus-note[data-target="${el.dataset.variantId}"]`);
      if (note) {
        note.classList.add('hovering');
        note.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
    el.addEventListener('mouseleave', () => {
      const note = document.querySelector(`.apparatus-note[data-target="${el.dataset.variantId}"]`);
      if (note) note.classList.remove('hovering');
    });

    frag.appendChild(el);
  });

  return { frag, spanIds };
}

function renderApparatus(merged, spanIds, paraBaseEd) {
  const appDiv = document.createElement('div');
  appDiv.className = 'apparatus';
  const notes = [];

  (merged || []).forEach((span, i) => {
    const targetId = spanIds?.[i] || null;

    // textual additions
    if (span.variant_type === 'addition') {
      if (paraBaseEd === '1849') {
        // no textual addition apparatus
      } else if (span.display !== 'inline' || showAllVariants) {
        notes.push({ text: span.text, colorEd: span.earliest_edition || span.editions?.[0], targetId, kind: 'text' });
      }
    }

    // textual substitutions
    if (span.type === 'replaced' && span.changes && span.changes.length) {
      const latestDiff = latestEarlierDiffEdition(span);
      if (latestDiff && (span.display !== 'inline' || showAllVariants)) {
        notes.push({
          text: latestDiff.text,
          colorEd: latestDiff.edition,
          targetId,
          kind: 'text'
        });
      }
    }

    // format diffs (from data attached on rendered token)
    if (targetId) {
      const el = spanRegistry.get(targetId);
      if (el?.dataset?.formatDiff) {
        try {
          const fd = JSON.parse(el.dataset.formatDiff);
          notes.push({
            text: fd.text || '',
            colorEd: fd.latestEarlier || null,
            targetId,
            kind: 'format',
            signature: fd.signature || '',
            formatDetail: fd.detail || '',
            fmtClasses: fd.fmtClasses || []
          });
        } catch (_) {}
      }
    }
  });

  // Merge adjacent format notes; keep text notes unchanged
  const textNotes = notes.filter(n => n.kind === 'text');
  const formatNotes = mergeAdjacentFormatNotes(notes.filter(n => n.kind === 'format'));
  const finalNotes = [...textNotes, ...formatNotes];

  if (!finalNotes.length) {
    appDiv.innerHTML = '<div class="apparatus-empty">Keine Varianten</div>';
    return appDiv;
  }

  finalNotes.forEach(n => {
    const d = document.createElement('div');
    d.className = 'apparatus-note';
    if (n.colorEd) d.style.color = editionColors[n.colorEd] || '#000';

    if (n.kind === 'format') {
      // render text with style runs, no "(Format)" label
      // simple heuristic: if earlier formatting differs and includes spacing, apply spaced class
      const span = document.createElement('span');
      span.textContent = n.text;

      // primary: explicit classes from data
      let classes = (n.fmtClasses || []).filter(Boolean);

      // hard fallback for known case: if none, derive from edition format_runs start
      if (!classes.length) {
        const paraMatch = (n.targetId || '').match(/^v-(\d+)-/);
        if (paraMatch) {
          const paraNum = parseInt(paraMatch[1], 10); // 1-based
          const para = allData[paraNum - 1];
          const fr = para?.data?.format_runs || {};
          const ed = n.colorEd || '1826';
          const runs = fr[ed] || [];

          // if earliest run starts at 0 and covers token length, use those styles
          const first = runs.find(r => r.start === 0 && (r.end || 0) >= (n.text || '').length);
          if (first?.styles?.length) {
            classes = first.styles.map(runClass).filter(Boolean);
          }
        }
      }

      classes.forEach(c => span.classList.add(c));
      d.appendChild(span);

    } else {
      const paraMatch = (n.targetId || '').match(/^v-(\d+)-/);
      const paraNum = paraMatch ? parseInt(paraMatch[1], 10) : null;
      const paraItem = paraNum ? allData[paraNum - 1] : null;

      // Build a linkified apparatus note body so markers like ⁺ or * are clickable
      const bodyFrag = document.createDocumentFragment();
      const text = String(n.text || '');
      const markerRE = /([⁺*])/g;

      // Try to resolve the note-ref id that belongs to the edition that introduced this variant.
      const resolveNoteRefId = () => {
        if (!paraItem) return null;
        const notesByEd = paraItem?.data?.notes || {};
        const span = variantMetaById.get(n.targetId) || null;

        // Prefer the earlier edition(s) that actually differ from 1849 in this span.
        const candidateEds = [];
        if (span?.type === 'replaced' && Array.isArray(span.changes)) {
          const diffs = span.changes.filter(ch => ch && ch.text && ch.text !== span.text);
          diffs.forEach(ch => {
            if (ch.edition && !candidateEds.includes(ch.edition)) candidateEds.push(ch.edition);
          });
        }

        // For additions, use the edition(s) in which the addition exists.
        if (span?.variant_type === 'addition' && Array.isArray(span.editions)) {
          span.editions.forEach(ed => {
            if (ed && !candidateEds.includes(ed)) candidateEds.push(ed);
          });
        }

        // Fallback to chronological order.
        if (!candidateEds.length) candidateEds.push('1808', '1826', '1849');

        for (const ed of candidateEds) {
          const ref = (notesByEd[ed] || []).find(x => x?.type === 'note_ref' && x?.id);
          if (ref?.id) return ref.id;
        }
        return null;
      };

      const noteRefId = resolveNoteRefId();

      // Register the apparatus note element so back-links can highlight it later
      if (noteRefId) {
        noteRefElementRegistry.set(noteRefId, d);
      }

      let last = 0;
      let m;

      while ((m = markerRE.exec(text)) !== null) {
        const before = text.slice(last, m.index);
        if (before) bodyFrag.appendChild(document.createTextNode(before));

        const marker = m[1];
        const a = document.createElement('a');
        a.className = 'note-ref-link apparatus-note-marker';
        a.textContent = marker;
        a.href = noteRefId ? `#${noteRefId}` : '#';
        a.title = noteRefId ? 'Zur Verweisstelle springen' : 'Verweisstelle nicht gefunden';

        if (noteRefId) a.dataset.noteRefId = noteRefId;

        a.addEventListener('click', (e) => {
          if (!noteRefId) return;
          e.preventDefault();

          const targetPara = noteLinkRegistry.get(noteRefId);
          if (targetPara) {
            ensureLoaded(targetPara - 1);
            scrollToParagraph(targetPara);
          }

          const sourceSpan = spanRegistry.get(n.targetId);
          if (sourceSpan) {
            sourceSpan.classList.add('inline-highlight');
            setTimeout(() => sourceSpan.classList.remove('inline-highlight'), 1200);
          }

          d.classList.add('cm-active-note');
          setTimeout(() => d.classList.remove('cm-active-note'), 1200);
        });

        bodyFrag.appendChild(a);
        last = markerRE.lastIndex;
      }

      const tail = text.slice(last);
      if (tail) bodyFrag.appendChild(document.createTextNode(tail));

      d.appendChild(bodyFrag);
    }


    if (n.targetId) d.dataset.target = n.targetId;

    const enter = () => {
      if (!n.targetId) return;
      d.classList.add('hovering');
      const el = spanRegistry.get(n.targetId);
      if (el) el.classList.add('inline-highlight');
    };
    const leave = () => {
      d.classList.remove('hovering');
      if (!n.targetId) return;
      const el = spanRegistry.get(n.targetId);
      if (el) el.classList.remove('inline-highlight');
    };

    d.addEventListener('mouseenter', enter);
    d.addEventListener('mouseleave', leave);
    d.addEventListener('click', () => {
      if (!n.targetId) return;
      const el = spanRegistry.get(n.targetId);
      if (!el) return;
      scrollToElement(el);
      el.classList.add('inline-highlight');
      setTimeout(() => el.classList.remove('inline-highlight'), 1200);
    });

    appDiv.appendChild(d);
  });

  return appDiv;
}


// ---------------------------------------------------------------------------
// Paragraph rendering

function renderParagraph(item, idx) {
  const paraNum = idx + 1;
  const card = document.createElement('div');
  card.className = 'paragraph-card';
  card.id = `para-${paraNum}`;

  // --- note-block grouping classes ---
  const noteIds = collectNoteEntryIdsForParagraph(item);

  const noteStem = (id) => String(id || '').replace(/-(ref|note)\s*$/, '').trim();
  const hasNestedNoteId = (ids) => (ids || []).some(id => /\.\d+$/.test(noteStem(id)));

  const hasOwnNoteEntry = noteIds.length > 0;
  const isNestedNoteBlock = hasNestedNoteId(noteIds);

  const hasSectionMarker = (it) => {
    if (!it?.data?.notes) return false;
    return ['1808', '1826', '1849'].some(ed =>
      (it.data.notes[ed] || []).some(n => n?.type === 'section')
    );
  };

  const isContinuationOfNoteBlock = (() => {
    if (hasOwnNoteEntry) return false;

    for (let j = idx - 1; j >= 0; j--) {
      const prev = allData[j];
      if (!prev) break;

      if (collectNoteEntryIdsForParagraph(prev).length > 0) return true;
      if (hasSectionMarker(prev)) break;
    }
    return false;
  })();

  if (isNestedNoteBlock) {
    card.classList.add('note-block', 'note-block-nested');
  } else if (hasOwnNoteEntry) {
    card.classList.add('note-block', 'note-block-start');
  } else if (isContinuationOfNoteBlock) {
    card.classList.add('note-block', 'note-block-cont');
  }


  const header = document.createElement('div');
  header.className = 'paragraph-header paragraph-header-collapsed';
  header.setAttribute('aria-expanded', 'false');

  // clickable strip at the top
  const headerToggle = document.createElement('button');
  headerToggle.type = 'button';
  headerToggle.className = 'paragraph-header-toggle';
  headerToggle.setAttribute('aria-label', 'Absatzmetadaten ein-/ausblenden');

  const headerLine = document.createElement('span');
  headerLine.className = 'paragraph-header-line';

  const headerYear = document.createElement('span');
  headerYear.className = 'paragraph-header-year';

  // Back side / revealed metadata container
  const headerMeta = document.createElement('div');
  headerMeta.className = 'paragraph-header-meta';

  // Left: paragraph number
  const num = document.createElement('div');
  num.className = 'paragraph-number';
  num.innerHTML = `<a href="#para-${paraNum}">§ ${paraNum} <span class="anchor-icon">#</span></a>`;

  // Center: comparative badges or plain edition chip
  const center = document.createElement('div');
  center.className = 'paragraph-badges-group';

  let paraBaseEd = null;

  if (isComparativeView()) {
    paraBaseEd = paragraphBaseEdition(item.data.unified_text || []);
    header.dataset.baseEdition = paraBaseEd;
    header.style.setProperty('--header-line-color', editionColors[paraBaseEd || currentEdition] || '#8e44ad');
    headerYear.textContent = paraBaseEd;

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'edition-chips';

    ['1808', '1826', '1849'].forEach(ed => {
      const chip = document.createElement('span');
      chip.className = 'new-badge';
      chip.style.background = 'transparent';
      chip.style.color = editionColors[ed];
      chip.style.border = `1px solid ${editionColors[ed]}`;
      chip.textContent = ed;
      chipsWrap.appendChild(chip);
    });

    const baseInfo = document.createElement('span');
    baseInfo.className = 'info-icon';
    baseInfo.title = 'Basistext: zeigt an, in welcher Version der Absatz erstmals vorkam';
    baseInfo.textContent = 'ℹ';

    const chipsInfo = document.createElement('span');
    chipsInfo.className = 'info-icon';
    chipsInfo.title = 'Varianten: zeigt an, welche Zeichen in früheren Fassungen abwichen';
    chipsInfo.textContent = 'ℹ';

    center.appendChild(chipsWrap);
    center.appendChild(baseInfo);
    center.appendChild(chipsInfo);
  } else {
    center.classList.add('plain-edition-chip');
    const chip = document.createElement('span');
    chip.className = 'new-badge';
    chip.style.background = 'transparent';
    chip.style.color = editionColors[currentEdition] || '#000';
    chip.style.border = `1px solid ${editionColors[currentEdition] || '#000'}`;
    chip.textContent = editionLabel(currentEdition);
    center.appendChild(chip);

    header.dataset.baseEdition = currentEdition;
    header.style.setProperty('--header-line-color', editionColors[currentEdition] || '#8e44ad');
    headerYear.textContent = editionLabel(currentEdition);
  }

  // Right: stats (comparative only) + IIIF button
  const statsDiv = document.createElement('div');
  statsDiv.className = 'paragraph-badges';
  const stats = item.data?.stats;

  if (isComparativeView() && showStats && stats) {
    if (typeof stats.similarity === 'number') {
      const sim = stats.similarity;
      const simClass = sim > 0.85 ? 'high' : sim > 0.6 ? 'medium' : 'low';
      const b = document.createElement('span');
      b.className = `similarity-badge ${simClass}`;
      b.textContent = `Similarity ${Math.round(sim * 100)}%`;
      statsDiv.appendChild(b);
    }
    const c = document.createElement('span');
    c.className = 'change-stats-badge';
    c.innerHTML = `<span class="added">+${stats.additions || 0}</span> / <span class="removed">-${stats.deletions || 0}</span> / subs ${stats.substitutions || 0}`;
    statsDiv.appendChild(c);
  }

  const iiifUrls = getLastIiifUrlsForParagraph(allData, idx);
  const hasAnyUrl = iiifUrls['1808'] || iiifUrls['1826'] || iiifUrls['1849'];

  if (hasAnyUrl) {
    const iiifLink = buildFragmentViewerUrl(iiifUrls);
    if (iiifLink) {
      const iiifBtn = document.createElement('a');
      iiifBtn.className = 'iiif-button';
      iiifBtn.href = iiifLink;
      iiifBtn.target = '_blank';
      iiifBtn.title = 'Quellenbilder in Faksimile-Viewer öffnen';
      iiifBtn.textContent = '📄';
      statsDiv.appendChild(iiifBtn);
    }
  }

  headerToggle.appendChild(headerLine);
  headerToggle.appendChild(headerYear);

  headerMeta.appendChild(num);
  headerMeta.appendChild(center);
  headerMeta.appendChild(statsDiv);

  header.appendChild(headerToggle);
  header.appendChild(headerMeta);
  card.appendChild(header);

  card.classList.add('paragraph-card-collapsed');

  headerToggle.addEventListener('click', () => {
    const expanded = card.classList.toggle('paragraph-card-expanded');
    card.classList.toggle('paragraph-card-collapsed', !expanded);
    header.classList.toggle('paragraph-header-collapsed', !expanded);
    header.classList.toggle('paragraph-header-expanded', expanded);
    header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  });

  const body = document.createElement('div');
  body.className = 'paragraph-body';

  // Plain edition view: single-column, no apparatus, no variants
  if (!isComparativeView()) {
    body.classList.add('plain-edition-view');

    header.dataset.baseEdition = currentEdition;

    header.style.setProperty('--header-line-color', editionColors[currentEdition] || '#8e44ad');

    const textDiv = document.createElement('div');
    textDiv.className = 'unified-text';

    const plain = item?.data?.edition_text?.[currentEdition]
      ?? reconstructParagraphText(item.data.unified_text || [], currentEdition);

    const chunks = String(plain || '').split(/\n{2,}/);

    const runs = item?.data?.format_runs?.[currentEdition] || [];

    chunks.forEach((chunk, i) => {
      const el = document.createElement('span');
      el.className = 'word plain-edition';
      appendTextWithRuns(el, chunk, runs); // acceptable fallback even if runs not remapped per chunk
      textDiv.appendChild(el);

      if (i < chunks.length - 1) {
        textDiv.appendChild(document.createElement('br'));
        textDiv.appendChild(document.createElement('br'));
      }
    });

    // note links
    injectNoteRefLinks(textDiv, item);
    injectNoteBackLinks(textDiv, item);

    body.appendChild(textDiv);

    card.appendChild(body);
    return card;
  }

  // Comparative view
  const merged = mergeAdjacentAdditions(item.data.unified_text || []);

  const textDiv = document.createElement('div');
  textDiv.className = 'unified-text';
  const { frag, spanIds } = renderSpans(merged, paraNum, paraBaseEd || '1849', item);

  // paragraph anchor marker (single visual cue)
  const anchorCount = item?.data?.anchor_count || 0;
  if (anchorCount > 0 && correctionMode?.enabled) {
    const a = document.createElement('span');
    a.className = 'lera-anchor';
    a.dataset.count = String(anchorCount);
    a.setAttribute('aria-hidden', 'true');
    a.title = 'LERA-Anker';
    textDiv.appendChild(a);
  }
  textDiv.appendChild(frag);

  // note links
  injectNoteRefLinks(textDiv, item);
  injectNoteBackLinks(textDiv, item);

  body.appendChild(textDiv);

  const appDiv = renderApparatus(merged, spanIds, paraBaseEd || '1849');
  body.appendChild(appDiv);

  card.appendChild(body);
  return card;
}


// ---------------------------------------------------------------------------
// Loader & setup

function loadNextBatch(force = false) {
  if (isLoading && !force) return;
  isLoading = true;
  const container = document.getElementById('content');
  const end = Math.min(displayedCount + BATCH_SIZE, allData.length);
  for (let i = displayedCount; i < end; i++) {
    if (isVisiblyEmpty(allData[i])) continue;
    container.appendChild(renderParagraph(allData[i], i));
  }
  displayedCount = end;
  isLoading = false;

  // Correction mode: refresh index whenever new content arrives
  if (correctionMode && correctionMode.refresh) correctionMode.refresh(true);
}

function ensureLoaded(targetIndex) {
  while (displayedCount <= targetIndex && displayedCount < allData.length) loadNextBatch(true);
}

function buildSectionTOC() {
  const root = document.getElementById('toc-sections');
  if (!root) return;
  root.innerHTML = '';

  const editionPriority = ['1849', '1826', '1808'];

  // Normalize slug keys consistently across file
  function normalizeSlug(slug) {
    let s = String(slug || '').trim();
    if (!s) return '';
    s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); // remove combining marks
    s = s.replace(/ß/g, 'ss');
    s = s.replace(/[^\w\s-]/g, '');
    s = s.replace(/[\s_]+/g, '-');
    s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
    return s;
  }

  // Aggregate by normalized slug
  // slugMap[key] = { slugKey, start, titlesByEd: {1849:Set,1826:Set,1808:Set} }
  const slugMap = new Map();

  for (let i = 0; i < allData.length; i++) {
    const paraNum = i + 1;
    const notesByEd = allData[i]?.data?.notes || {};

    editionPriority.forEach(ed => {
      (notesByEd[ed] || []).forEach(n => {
        if (n?.type !== 'section') return;

        const rawSlug = String(n.slug || '').trim();
        const rawTitle = String(n.title || '').trim();
        const slugKey = normalizeSlug(rawSlug || rawTitle);
        if (!slugKey) return;

        if (!slugMap.has(slugKey)) {
          slugMap.set(slugKey, {
            slugKey,
            start: paraNum,
            titlesByEd: { '1849': new Set(), '1826': new Set(), '1808': new Set() }
          });
        }

        const rec = slugMap.get(slugKey);
        if (paraNum < rec.start) rec.start = paraNum;

        // keep explicit title; fallback to raw slug prettified
        const title = rawTitle || rawSlug.replace(/-/g, ' ').trim();
        if (title) rec.titlesByEd[ed].add(title);
      });
    });
  }

  if (!slugMap.size) {
    root.innerHTML = '<div class="apparatus-empty">Keine Abschnitte erkannt</div>';
    return;
  }

  // Resolve display title by priority; keep deterministic ordering
  const sections = Array.from(slugMap.values())
    .map(rec => {
      let chosenTitle = '';
      for (const ed of editionPriority) {
        const candidates = Array.from(rec.titlesByEd[ed]);
        if (candidates.length) {
          candidates.sort((a, b) => a.localeCompare(b, 'de'));
          chosenTitle = candidates[0];
          break;
        }
      }
      if (!chosenTitle) chosenTitle = rec.slugKey.replace(/-/g, ' ');
      return {
        slug: rec.slugKey,
        title: chosenTitle,
        start: rec.start
      };
    })
    .sort((a, b) => a.start - b.start || a.slug.localeCompare(b.slug, 'de'));

  // Render (one entry per unique slug)
  sections.forEach((s, idx) => {
    const next = sections[idx + 1];
    const end = next ? next.start - 1 : allData.length;

    const item = document.createElement('div');
    item.className = 'toc-item';
    item.dataset.paraNum = String(s.start);
    item.dataset.sectionSlug = s.slug;

    const label = document.createElement('span');
    label.textContent = `${s.title} (§ ${s.start}${end > s.start ? '–' + end : ''})`;
    item.appendChild(label);

    item.addEventListener('click', () => {
      ensureLoaded(s.start - 1);
      history.replaceState(null, '', `#sec-${s.slug}`);
      scrollToParagraph(s.start);
    });

    root.appendChild(item);
  });
}

function buildTOC() {
  const tocList = document.getElementById('toc-list');
  tocList.innerHTML = '';
  for (let groupStart = 0; groupStart < allData.length; groupStart += 10) {
    const groupEnd = Math.min(groupStart + 10, allData.length);
    const group = document.createElement('div'); group.className = 'toc-group';
    const header = document.createElement('div');
    header.className = 'toc-group-header';
    header.textContent = `§ ${groupStart + 1}${groupEnd > groupStart + 1 ? '–' + groupEnd : ''}`;
    header.addEventListener('click', () => {
      const items = group.querySelector('.toc-group-items');
      const expanded = items.classList.toggle('expanded');
      header.classList.toggle('expanded', expanded);
    });
    group.appendChild(header);
    const items = document.createElement('div'); items.className = 'toc-group-items';
    for (let i = groupStart; i < groupEnd; i++) {
      const paraNum = i + 1;
      const div = document.createElement('div'); div.className = 'toc-item';
      div.dataset.index = i; div.dataset.paraNum = paraNum;
      const label = document.createElement('span'); label.textContent = `§ ${paraNum}`;
      div.appendChild(label);
      if (allData[i]?.data?.new_in_1849) {
        const badge = document.createElement('span'); badge.className = 'toc-badge'; badge.textContent = 'NEU'; div.appendChild(badge);
      }
      div.addEventListener('click', () => {
        if (!items.classList.contains('expanded')) { items.classList.add('expanded'); header.classList.add('expanded'); }
        ensureLoaded(paraNum - 1);
        scrollToParagraph(paraNum);
      });
      items.appendChild(div);
    }
    group.appendChild(items);
    tocList.appendChild(group);
  }
}

function scrollToParagraph(paraNum) {
  const card = document.getElementById(`para-${paraNum}`);
  if (!card) return;
  scrollToElement(card);
}

function setupIntersectionObserver() {
  const sentinel = document.getElementById('sentinel');
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) loadNextBatch(); }), { rootMargin: '200px' });
  observer.observe(sentinel);
}

function setupScrollTracking() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        if (id && id.startsWith('para-')) {
          document.querySelectorAll('.toc-item').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.paraNum, 10) === parseInt(id.replace('para-', ''), 10));
          });
        }
      }
    });
  }, { threshold: 0.4 });
  const attach = () => { document.querySelectorAll('.paragraph-card').forEach(card => observer.observe(card)); };
  const mo = new MutationObserver(() => { attach(); });
  mo.observe(document.getElementById('content'), { childList: true });
}

// ---------------------------------------------------------------------------
// Legend / settings wiring (single instance)

const legendPanel = document.getElementById('legend-panel');
const colorPanel  = document.getElementById('color-panel');

function setLegendExpanded(expanded) {
  legendExpanded = expanded;
  if (legendPanel) legendPanel.classList.toggle('expanded', expanded);
  if (legendPanel) legendPanel.classList.toggle('collapsed', !expanded);
  if (legendPanel) legendPanel.style.display = expanded ? 'block' : 'none';
}

setLegendExpanded(false);

document.getElementById('color-settings')?.addEventListener('click', () => {
  setLegendExpanded(!legendExpanded);
});

colorPanel?.querySelectorAll('input[type="color"][data-ed]')?.forEach(input => {
  input.addEventListener('input', () => {
    const ed = input.dataset.ed;
    editionColors[ed] = input.value;
    applyEditionColorsToLegend();
    if (isComparativeView()) rerenderAll();
  });
});

document.getElementById('color-mode-toggle')?.addEventListener('change', (e) => {
  variantColorMode = e.target.checked ? 'background' : 'text';
  if (isComparativeView()) rerenderAll();
});

document.getElementById('toggle-all-variants')?.addEventListener('change', (e) => {
  showAllVariants = e.target.checked;
  if (isComparativeView()) rerenderAll();
});

document.getElementById('toggle-stats')?.addEventListener('change', (e) => {
  showStats = !e.target.checked;
  if (isComparativeView()) rerenderAll();
});

// ---------------------------------------------------------------------------
// Correction mode (bottom-left drawer + stepping)

correctionMode = {
  enabled: false,
  open: false,
  targets: [],
  idx: -1,
  filters: {
    inline: true,
    marginal: true,
    substitution: true,
    addition: true,
    deletion: true,
    singleChar: false,  // only single-char (best-effort)
    multiChar: false    // only multi-char (best-effort)
  },
  ui: {
    root: null,
    btnToggle: null,
    panel: null,
    status: null,
    btnPrev: null,
    btnNext: null,
    btnOpen: null
  },

  findBestStartIndex() {
    if (!this.targets.length) return -1;

    const candidates = this.targets
      .map((t, i) => ({ i, top: t.el.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top);

    const under = candidates.find(c => c.top >= 0);
    if (under) return under.i;
    return candidates[candidates.length - 1].i;
  },

  ensureUI() {
    if (this.ui.root) return;

    const root = document.createElement('div');
    root.className = 'correction-drawer';
    root.innerHTML = `
      <button class="correction-fab" type="button" title="Korrekturmodus">✓</button>
      <div class="correction-panel" style="display:none;">
        <div class="correction-header">
          <div class="correction-title">Korrekturmodus</div>
          <button class="correction-close" type="button" title="Schließen">×</button>
        </div>

        <div class="correction-row">
          <label class="correction-toggle">
            <input type="checkbox" class="cm-enable">
            <span>aktiv</span>
          </label>
          <div class="correction-status cm-status">–</div>
        </div>

        <div class="correction-section">
          <div class="correction-section-title">Start / Sprung</div>
          <div class="correction-jump">
            <label class="correction-jump-label">§</label>
            <input class="cm-jump-input" type="number" min="1" step="1" placeholder="Absatz">
            <button class="cm-jump-go" type="button">Go</button>
          </div>
          <div class="correction-explain">
            Tipp: „Go“ lädt/scrollt zum Absatz und setzt die Auswahl auf die nächstfolgende Variante.
          </div>
        </div>

        <hr class="correction-hr" />

        <div class="correction-section">
          <div class="correction-section-title">Fokus</div>
          <div class="correction-filters correction-filters-2col">
            <label><input type="checkbox" class="cm-focus" data-k="hideApparatus" checked> Varianten ausblenden (Spalte rechts)</label>
            <label><input type="checkbox" class="cm-focus" data-k="hideStats" checked> Stats ausblenden</label>
          </div>
          <div class="correction-explain">
            Fokus-Modus reduziert Ablenkungen während des Steppens (wirkt nur in Korrekturmodus).
          </div>
        </div>

        <hr class="correction-hr" />

        <div class="correction-section">
          <div class="correction-section-title">Filter (1) Ort</div>
          <div class="correction-filters correction-filters-2col">
            <label><input type="checkbox" class="cm-filter" data-k="inline" checked> inline</label>
            <label><input type="checkbox" class="cm-filter" data-k="marginal" checked> marginal</label>
          </div>
        </div>

        <div class="correction-section">
          <div class="correction-section-title">Filter (2) Typ</div>
          <div class="correction-filters correction-filters-2col">
            <label><input type="checkbox" class="cm-filter" data-k="substitution" checked> Ersetzung</label>
            <label><input type="checkbox" class="cm-filter" data-k="addition" checked> Ergänzung</label>
            <label><input type="checkbox" class="cm-filter" data-k="deletion" checked> Tilgung</label>
          </div>
        </div>

        <div class="correction-section">
          <div class="correction-section-title">Filter (3) Länge (nur Ersetzung)</div>
          <div class="correction-filters correction-filters-2col">
            <label title="best-effort: sehr kurze Substitutionen (char-level)">
              <input type="checkbox" class="cm-filter" data-k="singleChar"> single-char
            </label>
            <label title="best-effort: längere Substitutionen">
              <input type="checkbox" class="cm-filter" data-k="multiChar"> multi-char
            </label>
          </div>
          <div class="correction-explain">
            Hinweis: Wenn (3) aktiv ist, werden nur Substitutionen gezeigt, die dazu passen.
          </div>
        </div>

        <hr class="correction-hr" />

        <div class="correction-section">
          <div class="correction-section-title">Navigation</div>
          <div class="correction-nav">
            <button type="button" class="cm-prev">←</button>
            <button type="button" class="cm-next">→</button>
          </div>
          <div class="correction-hint">
            Tasten: ←/→ oder j/k · Esc beendet
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    this.ui.root = root;
    this.ui.btnOpen = root.querySelector('.correction-fab');
    this.ui.panel = root.querySelector('.correction-panel');
    this.ui.status = root.querySelector('.cm-status');
    this.ui.btnPrev = root.querySelector('.cm-prev');
    this.ui.btnNext = root.querySelector('.cm-next');
    this.ui.btnToggle = root.querySelector('.cm-enable');

    const jumpInput = root.querySelector('.cm-jump-input');
    const jumpGo = root.querySelector('.cm-jump-go');

    const doJump = () => {
      const n = parseInt(jumpInput?.value, 10);
      if (!n || n < 1) return;

      ensureLoaded(n - 1);
      scrollToParagraph(n);

      if (!this.enabled) this.setEnabled(true);

      setTimeout(() => {
        this.refresh(true);
        const start = this.findBestStartIndex?.() ?? 0;
        if (this.targets.length) this.select(start >= 0 ? start : 0, { scroll: false });
      }, 150);
    };

    jumpGo?.addEventListener('click', doJump);
    jumpInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJump();
    });

    root.querySelector('.correction-close')?.addEventListener('click', () => this.setOpen(false));
    this.ui.btnOpen?.addEventListener('click', () => this.setOpen(!this.open));

    this.ui.btnToggle?.addEventListener('change', () => {
      this.setEnabled(this.ui.btnToggle.checked);
    });

    root.querySelectorAll('.cm-filter').forEach(cb => {
      cb.addEventListener('change', () => {
        const k = cb.dataset.k;
        this.filters[k] = cb.checked;
        this.refresh(true);
      });
    });

    root.querySelectorAll('.cm-focus').forEach(cb => {
      cb.addEventListener('change', () => {
        const k = cb.dataset.k;
        if (k === 'hideApparatus') {
          document.body.classList.toggle('cm-hide-apparatus', cb.checked && this.enabled);
        }
        if (k === 'hideStats') {
          document.body.classList.toggle('cm-hide-stats', cb.checked && this.enabled);
        }
      });
    });

    this.ui.btnPrev?.addEventListener('click', () => this.prev());
    this.ui.btnNext?.addEventListener('click', () => this.next());
  },

  setOpen(open) {
    this.ensureUI();
    this.open = open;
    if (this.ui.panel) this.ui.panel.style.display = open ? 'block' : 'none';
  },

  setEnabled(enabled) {
    this.ensureUI();

    if (enabled && !isComparativeView()) {
      enabled = false;
    }

    this.enabled = enabled;
    if (this.ui.btnToggle) this.ui.btnToggle.checked = enabled;

    if (!enabled) {
      this.clearSelection();
      this.idx = -1;
      this.updateStatus();
      document.body.classList.remove('cm-hide-apparatus', 'cm-hide-stats');
      return;
    }

    const hideApp = this.ui.root?.querySelector('.cm-focus[data-k="hideApparatus"]')?.checked;
    const hideStats = this.ui.root?.querySelector('.cm-focus[data-k="hideStats"]')?.checked;
    document.body.classList.toggle('cm-hide-apparatus', !!hideApp);
    document.body.classList.toggle('cm-hide-stats', !!hideStats);

    this.refresh(true);
    if (this.targets.length) {
      const start = this.findBestStartIndex();
      this.select(start >= 0 ? start : 0, { scroll: false });
    }
  },

  classifyTarget(variantId, el) {
    const span = variantMetaById.get(variantId) || null;
    const kind = el?.classList?.contains('marginal-placeholder') ? 'marginal' : 'inline';

    let variantType = span?.variant_type || null;
    if (!variantType && span?.type === 'replaced') variantType = 'substitution';

    let isSingleChar = false;
    let isMultiChar = false;
    if (span?.type === 'replaced' && Array.isArray(span.changes)) {
      const ops = span.changes.flatMap(ch => (ch.char_level || []));
      const hasReplaceLen1 = ops.some(op => op.operation === 'replace' && ((op.from || '').length <= 1));
      const hasReplaceLenGt1 = ops.some(op => op.operation === 'replace' && ((op.from || '').length > 1));
      isSingleChar = hasReplaceLen1 && !hasReplaceLenGt1;

      isMultiChar =
        hasReplaceLenGt1 ||
        (span.text && span.changes.some(ch => (ch.text || '').length !== (span.text || '').length));
    }

    const snippet = (span?.text || el?.textContent || '').trim().slice(0, 80);
    return { variantId, el, span, kind, variantType, isSingleChar, isMultiChar, snippet };
  },

  passesFilters(t) {
    if (t.kind === 'inline' && !this.filters.inline) return false;
    if (t.kind === 'marginal' && !this.filters.marginal) return false;

    if (t.variantType === 'substitution' && !this.filters.substitution) return false;
    if (t.variantType === 'addition' && !this.filters.addition) return false;
    if (t.variantType === 'deletion' && !this.filters.deletion) return false;

    const lengthFiltersOn = this.filters.singleChar || this.filters.multiChar;
    if (lengthFiltersOn) {
      const anyMatch = (this.filters.singleChar && t.isSingleChar) || (this.filters.multiChar && t.isMultiChar);
      if (!anyMatch) return false;
    }

    return true;
  },

  refresh(keepCurrent = false) {
    this.ensureUI();

    if (!isComparativeView() && this.enabled) {
      this.setEnabled(false);
      return;
    }

    if (!this.enabled) {
      this.targets = [];
      this.idx = -1;
      this.updateStatus();
      return;
    }

    const els = Array.from(document.querySelectorAll('[data-variant-id]'));
    const nextTargets = [];
    els.forEach(el => {
      const id = el.dataset.variantId;
      if (!id) return;
      const t = this.classifyTarget(id, el);
      if (this.passesFilters(t)) nextTargets.push(t);
    });

    let nextIdx = -1;
    if (keepCurrent && this.idx >= 0 && this.idx < this.targets.length) {
      const currentId = this.targets[this.idx]?.variantId;
      if (currentId) nextIdx = nextTargets.findIndex(t => t.variantId === currentId);
    }

    this.targets = nextTargets;

    if (this.targets.length === 0) {
      this.clearSelection();
      this.idx = -1;
      this.updateStatus();
      return;
    }

    if (nextIdx >= 0) {
      this.idx = nextIdx;
      this.select(this.idx, { scroll: false });
    } else if (this.idx < 0 || this.idx >= this.targets.length) {
      this.idx = 0;
      this.select(0, { scroll: false });
    }

    this.updateStatus();
  },

  clearSelection() {
    document.querySelectorAll('.cm-active').forEach(el => el.classList.remove('cm-active'));
    document.querySelectorAll('.cm-active-note').forEach(el => el.classList.remove('cm-active-note'));
  },

  updateStatus() {
    if (!this.ui.status) return;
    if (!this.enabled) {
      this.ui.status.textContent = 'inaktiv';
      return;
    }
    if (!this.targets.length) {
      this.ui.status.textContent = '0 Varianten (Filter)';
      return;
    }
    const cur = this.idx >= 0 ? (this.idx + 1) : 0;
    this.ui.status.textContent = `${cur}/${this.targets.length}`;
  },

  select(i, { scroll = true } = {}) {
    if (!this.enabled) return;
    if (i < 0 || i >= this.targets.length) return;

    this.clearSelection();
    this.idx = i;

    const t = this.targets[i];
    if (t?.el) t.el.classList.add('cm-active');

    const note = document.querySelector(`.apparatus-note[data-target="${t.variantId}"]`);
    if (note) note.classList.add('cm-active-note');

    if (scroll && t?.el) scrollToElement(t.el);

    this.updateStatus();
  },

  ensureNextTargetLoaded(dir = +1) {
    if (!this.enabled) return;

    const attemptLoad = () => {
      if (displayedCount >= allData.length) return false;
      loadNextBatch(true);
      return true;
    };

    for (let tries = 0; tries < 20; tries++) {
      if (!this.targets.length) return attemptLoad();

      if (dir > 0) {
        if (this.idx + 1 < this.targets.length) return true;
      } else {
        if (this.idx - 1 >= 0) return true;
      }

      const loaded = attemptLoad();
      if (!loaded) return false;
      this.refresh(true);
    }
    return true;
  },

  next() {
    if (!this.enabled) return;
    this.ensureNextTargetLoaded(+1);
    if (!this.targets.length) return;
    const next = Math.min(this.targets.length - 1, this.idx + 1);
    this.select(next, { scroll: true });
  },

  prev() {
    if (!this.enabled) return;
    if (!this.targets.length) return;
    const prev = Math.max(0, this.idx - 1);
    this.select(prev, { scroll: true });
  }
};

function installCorrectionModeKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (!correctionMode?.enabled) return;

    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable;
    if (typing) return;

    if (e.key === 'Escape') {
      correctionMode.setEnabled(false);
      correctionMode.setOpen(false);
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'j') {
      e.preventDefault();
      correctionMode.next();
    }
    if (e.key === 'ArrowLeft' || e.key === 'k') {
      e.preventDefault();
      correctionMode.prev();
    }
  });
}

// ---------------------------------------------------------------------------
// General event wiring

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('reading-mode-radio')) {
    currentEdition = e.target.value;
    document.querySelectorAll('.reading-mode-item').forEach(l => l.classList.remove('active'));
    e.target.closest('.reading-mode-item').classList.add('active');

    if (!isComparativeView() && correctionMode?.enabled) correctionMode.setEnabled(false);

    rerenderAll();
  }
  if (e.target.id === 'inline-add-max') {
    const v = parseInt(e.target.value, 10);
    inlineAddMax = isNaN(v) ? 12 : Math.max(1, v);
    if (isComparativeView()) rerenderAll();
  }
});

document.getElementById('font-plus')?.addEventListener('click', () => {
  fontScale = Math.min(1.6, fontScale + 0.1);
  applyFontScale();
});
document.getElementById('font-minus')?.addEventListener('click', () => {
  fontScale = Math.max(0.8, fontScale - 0.1);
  applyFontScale();
});

function rerenderAll() {
  displayedCount = 0;
  spanRegistry.clear();
  variantMetaById.clear();
  noteRefElementRegistry.clear();
  document.getElementById('content').innerHTML = '';
  loadNextBatch(true);
}

// ---------------------------------------------------------------------------
// Bootstrap / initial wiring

document.addEventListener('DOMContentLoaded', () => {
  updateHeaderOffset();
  applyEditionColorsToLegend();
  applyFontScale();

  correctionMode.ensureUI();
  correctionMode.setOpen(false);
  installCorrectionModeKeyboard();
});

window.addEventListener('resize', updateHeaderOffset);

fetch('slot_output.json')
  .then(r => { if (!r.ok) throw new Error('Datei nicht gefunden'); return r.json(); })
  .then(data => {
    metaData = data.meta || {};
    allData = data.content || [];
    buildNoteLinkRegistry();
    document.getElementById('content').innerHTML = '';
    buildSectionTOC();
    buildTOC();
    loadNextBatch();
    setupIntersectionObserver();
    setupScrollTracking();
    initialHashScroll();
    updateHeaderOffset();
  })
  .catch(err => {
    document.getElementById('content').innerHTML = `<div class="error"><strong>Fehler:</strong> ${err.message}</div>`;
  });

function initialHashScroll() {
  if (!window.location.hash) return;
  const id = window.location.hash.substring(1);
  const m = id.match(/^para-(\d+)$/);
  if (m) {
    const paraNum = parseInt(m[1], 10);
    ensureLoaded(paraNum - 1);
    setTimeout(() => scrollToParagraph(paraNum), 100);
  }
}

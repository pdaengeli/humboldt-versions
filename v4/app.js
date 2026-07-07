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

// ---------------------------------------------------------------------------
// Formatting helpers (NEW)

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
      d.textContent = n.text;
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

  const header = document.createElement('div');
  header.className = 'paragraph-header';

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

    const baseBadge = document.createElement('span');
    baseBadge.className = 'new-badge';
    baseBadge.style.background = '#111';
    baseBadge.style.color = '#fff';
    baseBadge.textContent = paraBaseEd;

    const baseInfo = document.createElement('span');
    baseInfo.className = 'info-icon';
    baseInfo.title = 'Basistext: zeigt an, in welcher Version der Absatz erstmals vorkam';
    baseInfo.textContent = 'ℹ';

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'edition-chips';

    ['1808','1826','1849'].forEach(ed => {
      const chip = document.createElement('span');
      chip.className = 'new-badge';
      chip.style.background = 'transparent';
      chip.style.color = editionColors[ed];
      chip.style.border = `1px solid ${editionColors[ed]}`;
      chip.textContent = ed;
      chipsWrap.appendChild(chip);
    });

    const chipsInfo = document.createElement('span');
    chipsInfo.className = 'info-icon';
    chipsInfo.title = 'Varianten: zeigt an, welche Zeichen in früheren Fassungen abwichen';
    chipsInfo.textContent = 'ℹ';

    center.appendChild(baseBadge);
    center.appendChild(baseInfo);
    center.appendChild(chipsWrap);
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
  }

  // Right: stats (comparative only)
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

  header.appendChild(num);
  header.appendChild(center);
  header.appendChild(statsDiv);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'paragraph-body';

  // Plain edition view: single-column, no apparatus, no variants
  if (!isComparativeView()) {
    body.classList.add('plain-edition-view');

    const textDiv = document.createElement('div');
    textDiv.className = 'unified-text';

    const plain = item?.data?.edition_text?.[currentEdition]
      ?? reconstructParagraphText(item.data.unified_text || [], currentEdition);

    const el = document.createElement('span');
    el.className = 'word plain-edition';

    const runs = item?.data?.format_runs?.[currentEdition] || [];
    appendTextWithRuns(el, plain, runs);

    textDiv.appendChild(el);
    body.appendChild(textDiv);

    card.appendChild(body);
    return card;
  }

  // Comparative view
  const merged = mergeAdjacentAdditions(item.data.unified_text || []);

  const textDiv = document.createElement('div');
  textDiv.className = 'unified-text';
  const { frag, spanIds } = renderSpans(merged, paraNum, paraBaseEd || '1849', item);
  textDiv.appendChild(frag);
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
  for (let i = displayedCount; i < end; i++) container.appendChild(renderParagraph(allData[i], i));
  displayedCount = end;
  isLoading = false;

  // Correction mode: refresh index whenever new content arrives
  if (correctionMode && correctionMode.refresh) correctionMode.refresh(true);
}

function ensureLoaded(targetIndex) {
  while (displayedCount <= targetIndex && displayedCount < allData.length) loadNextBatch(true);
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

    // prefer the first target that is at/under the top of viewport (not hidden)
    const candidates = this.targets
      .map((t, i) => ({ i, top: t.el.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top);

    const under = candidates.find(c => c.top >= 0);
    if (under) return under.i;

    // otherwise we're past all targets currently loaded: use last one
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

    // only meaningful in comparative view
    if (enabled && !isComparativeView()) {
      enabled = false;
    }

    this.enabled = enabled;
    if (this.ui.btnToggle) this.ui.btnToggle.checked = enabled;

    // clear selection when disabling
    if (!enabled) {
      this.clearSelection();
      this.idx = -1;
      this.updateStatus();

      // reset focus overrides when leaving correction mode
      document.body.classList.remove('cm-hide-apparatus', 'cm-hide-stats');
      return;
    }

    // apply focus overrides from current UI state
    const hideApp = this.ui.root?.querySelector('.cm-focus[data-k="hideApparatus"]')?.checked;
    const hideStats = this.ui.root?.querySelector('.cm-focus[data-k="hideStats"]')?.checked;
    document.body.classList.toggle('cm-hide-apparatus', !!hideApp);
    document.body.classList.toggle('cm-hide-stats', !!hideStats);

    // build initial index + pick start near viewport
    this.refresh(true);
    if (this.targets.length) {
      const start = this.findBestStartIndex();
      this.select(start >= 0 ? start : 0, { scroll: false }); // don't jump on enable
    }
  },

  // Determine kind/type/length buckets using span meta (best-effort)
  classifyTarget(variantId, el) {
    const span = variantMetaById.get(variantId) || null;
    const kind = el?.classList?.contains('marginal-placeholder') ? 'marginal' : 'inline';

    // normalize variantType for filtering
    let variantType = span?.variant_type || null;
    if (!variantType && span?.type === 'replaced') variantType = 'substitution';

    // best-effort single vs multi-char (substitutions only)
    let isSingleChar = false;
    let isMultiChar = false;
    if (span?.type === 'replaced' && Array.isArray(span.changes)) {
      const ops = span.changes.flatMap(ch => (ch.char_level || []));
      const hasReplaceLen1 = ops.some(op => op.operation === 'replace' && ((op.from || '').length <= 1));
      const hasReplaceLenGt1 = ops.some(op => op.operation === 'replace' && ((op.from || '').length > 1));
      isSingleChar = hasReplaceLen1 && !hasReplaceLenGt1;

      // fallback: treat as multi if any replace op is >1 or if earlier vs base lengths differ
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

    // if singleChar or multiChar filters active, require match (substitutions only)
    const lengthFiltersOn = this.filters.singleChar || this.filters.multiChar;
    if (lengthFiltersOn) {
      const anyMatch = (this.filters.singleChar && t.isSingleChar) || (this.filters.multiChar && t.isMultiChar);
      if (!anyMatch) return false;
    }

    return true;
  },

  refresh(keepCurrent = false) {
    this.ensureUI();

    // Disable correction mode automatically if leaving comparative view
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

    // index currently rendered variant elements (in DOM order)
    const els = Array.from(document.querySelectorAll('[data-variant-id]'));
    const nextTargets = [];
    els.forEach(el => {
      const id = el.dataset.variantId;
      if (!id) return;
      const t = this.classifyTarget(id, el);
      if (this.passesFilters(t)) nextTargets.push(t);
    });

    // try to keep selection on same variantId
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

    // highlight apparatus note too (if present)
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

    // don’t hijack typing
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

    // auto-disable correction mode when leaving comparative view
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
    document.getElementById('content').innerHTML = '';
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

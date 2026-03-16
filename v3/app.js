// Slot viewer (refined)
// - Fixed palette: 1808 yellow, 1826 red, 1849 violet
// - Comparative view ("all"): inline variants + marginal apparatus
// - Pure edition views (1808/1826/1849): render full text of that edition with NO variants/appartus
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

const spanRegistry = new Map(); // variant-id -> DOM node

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
//    return `Addition: ${span.editions?.join(', ') || ''}`;
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

function renderSpans(merged, paraNum) {
  const frag = document.createDocumentFragment();
  const spanIds = new Array(merged.length).fill(null);
  let variantIdx = 0;

  const register = (el, idx, span) => {
    if (span.variant_type || span.type === 'replaced') {
      const id = `v-${paraNum}-${idx}-${variantIdx++}`;
      el.dataset.variantId = id;
      spanRegistry.set(id, el);
      spanIds[idx] = id;
    }
  };

  merged.forEach((span, idx) => {
    const txt = editionText(span, currentEdition);
    if (txt === null) return;

    if (isInline(span)) {
      // Additions inline
      if (span.variant_type === 'addition') {
        const el = document.createElement('span');
        el.className = 'word addition';
        const color = editionColors[span.earliest_edition || span.editions?.[0] || BASE_EDITION] || '#000';
        el.style.textDecoration = `underline solid ${color}`;
        el.style.textDecorationThickness = '0.075em';
        el.style.textUnderlineOffset = '0.175em';
        if (variantColorMode === 'background') { el.style.background = color + '33'; el.style.color = '#000'; }
        else { el.style.color = color; }
        el.textContent = txt;
        el.title = `Erg. ${span.editions.join(', ')}`;
        register(el, idx, span);
        frag.appendChild(el);
        return;
      }

      // Substitutions inline
      if (span.type === 'replaced' && span.variant_type === 'substitution') {
        const el = renderCharLevelSubstitution(span);
        register(el, idx, span);
        frag.appendChild(el);
        return;
      }

      // Originals / other inline
      const el = document.createElement('span');
      el.className = spanClasses(span).join(' ');
      el.textContent = txt;
      register(el, idx, span);
      frag.appendChild(el);
      return;
    }

    // Marginal placeholder
    const el = document.createElement('span');
    el.className = 'word marginal-placeholder';
    el.style.opacity = '0.85';
    el.textContent = txt;
    const color = editionColors[span.earliest_edition || span.editions?.[0] || BASE_EDITION] || '#000';
    el.style.textDecoration = `underline dotted ${color}`;
    el.style.textDecorationThickness = '0.08em';
    el.style.textUnderlineOffset = '0.18em';
    el.title = marginalTooltip(span);
    register(el, idx, span);

    // Hover: highlight matching apparatus note
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

function renderApparatus(merged, spanIds) {
  const appDiv = document.createElement('div');
  appDiv.className = 'apparatus';
  const notes = [];

  (merged || []).forEach((span, i) => {
    const targetId = spanIds?.[i] || null;

    // additions
    if (span.variant_type === 'addition') {
      if (span.display !== 'inline' || showAllVariants) {
        notes.push({ text: span.text, colorEd: span.earliest_edition || span.editions?.[0], targetId });
      }
      return;
    }

    // substitutions
    if (span.type === 'replaced' && span.changes && span.changes.length) {
      const latestDiff = latestEarlierDiffEdition(span);
      if (latestDiff && (span.display !== 'inline' || showAllVariants)) {
        notes.push({
          text: latestDiff.text,
          colorEd: latestDiff.edition,
          targetId
        });
      }
    }
  });

  if (!notes.length) {
    appDiv.innerHTML = '<div class="apparatus-empty">Keine Varianten</div>';
    return appDiv;
  }

  notes.forEach(n => {
    const d = document.createElement('div');
    d.className = 'apparatus-note';
    if (n.colorEd) d.style.color = editionColors[n.colorEd] || '#000';
    d.textContent = n.text;
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
      const y = el.getBoundingClientRect().top + window.pageYOffset - 170;
      window.scrollTo({ top: y, behavior: 'smooth' });
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

  if (isComparativeView()) {
    const baseEd = paragraphBaseEdition(item.data.unified_text || []);
    const baseBadge = document.createElement('span');
    baseBadge.className = 'new-badge';
    baseBadge.style.background = '#111';
    baseBadge.style.color = '#fff';
    baseBadge.textContent = baseEd;

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

    const plain = reconstructParagraphText(item.data.unified_text || [], currentEdition);
    const el = document.createElement('span');
    el.className = 'word plain-edition';
    el.textContent = plain;

    textDiv.appendChild(el);
    body.appendChild(textDiv);

    card.appendChild(body);
    return card;
  }

  // Comparative view
  const merged = mergeAdjacentAdditions(item.data.unified_text || []);

  const textDiv = document.createElement('div');
  textDiv.className = 'unified-text';
  const { frag, spanIds } = renderSpans(merged, paraNum);
  textDiv.appendChild(frag);
  body.appendChild(textDiv);

  const appDiv = renderApparatus(merged, spanIds);
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
  const y = card.getBoundingClientRect().top + window.pageYOffset - 170;
  window.scrollTo({ top: y, behavior: 'smooth' });
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
// Legend / settings wiring

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
// General event wiring

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('reading-mode-radio')) {
    currentEdition = e.target.value;
    document.querySelectorAll('.reading-mode-item').forEach(l => l.classList.remove('active'));
    e.target.closest('.reading-mode-item').classList.add('active');
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
  document.getElementById('content').innerHTML = '';
  loadNextBatch(true);
}

// ---------------------------------------------------------------------------
// Bootstrap

document.addEventListener('DOMContentLoaded', () => {
  updateHeaderOffset();
  applyEditionColorsToLegend();
  applyFontScale();
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

/* ── Keyboard nav helpers ── */
let kbResultIdx = -1;
let kbHistoryIdx = -1;

function getResultCards() {
  return [...document.querySelectorAll('#search-results .result-card')];
}

function focusResultCard(idx) {
  const cards = getResultCards();
  if (!cards.length) return;
  idx = Math.max(0, Math.min(cards.length - 1, idx));
  cards.forEach((c, i) => c.classList.toggle('kb-focus', i === idx));
  cards[idx].focus({ preventScroll: false });
  kbResultIdx = idx;
}

function onResultKeydown(e, idx, qn) {
  const cards = getResultCards();
  if (e.key === 'ArrowDown') { e.preventDefault(); focusResultCard(idx + 1); }
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (idx === 0) { document.getElementById('search-input').focus(); kbResultIdx = -1; cards.forEach(c => c.classList.remove('kb-focus')); }
    else focusResultCard(idx - 1);
  }
  else if (e.key === 'Enter') openSymbol(qn);
  else if (e.key === 'Escape') { document.getElementById('search-input').focus(); kbResultIdx = -1; cards.forEach(c => c.classList.remove('kb-focus')); }
  else if (e.key === 'c' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); copyToClipboard(qn).then(() => showToast('✓ Copied')); }
}

/* ── Search history ── */
const HISTORY_KEY = 'repograph_search_history';
const MAX_HISTORY = 8;

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function addToHistory(q) {
  if (!q.trim()) return;
  let h = getHistory().filter(x => x !== q);
  h.unshift(q);
  if (h.length > MAX_HISTORY) h = h.slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}

function renderHistoryDropdown() {
  const h = getHistory();
  const el = document.getElementById('search-history');
  if (!h.length) { el.classList.remove('show'); return; }
  el.innerHTML = h.map(q =>
    `<div class="history-item" onmousedown="pickHistory(event,'${esc(q)}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
      ${esc(q)}
    </div>`
  ).join('');
  el.classList.add('show');
}

function showHistory() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) renderHistoryDropdown();
}

function hideHistoryDelayed() {
  setTimeout(() => document.getElementById('search-history').classList.remove('show'), 150);
}

function pickHistory(e, q) {
  e.preventDefault();
  document.getElementById('search-input').value = q;
  document.getElementById('search-history').classList.remove('show');
  updateClearBtn();
  doSearch();
}

/* ── Search input helpers ── */
function updateClearBtn() {
  const val = document.getElementById('search-input').value;
  const btn = document.getElementById('search-clear');
  btn.classList.toggle('visible', val.length > 0);
}

function onSearchInput(input) {
  updateClearBtn();
  if (!input.value.trim()) {
    document.getElementById('search-history').classList.remove('show');
  }
  debouncedSearch();
}

function clearSearch() {
  const inp = document.getElementById('search-input');
  inp.value = '';
  updateClearBtn();
  inp.focus();
  document.getElementById('search-results').innerHTML =
    `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <p>${t('empty.prompt')}</p><span>${t('empty.example')}</span>
    </div>`;
}

function setSearchMode(mode, btn) {
  state.searchMode = mode;
  btn.closest('.tab-row').querySelectorAll('.tab').forEach(tb => tb.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('search-mode-hint').textContent = t(mode === 'semantic' ? 'hint.semantic' : 'hint.code');
  document.getElementById('search-input').placeholder = t(mode === 'semantic' ? 'ph.semantic' : 'ph.code');
}

function toggleChip(el, group) {
  document.querySelectorAll(`.filter-chip[data-group="${group}"]`).forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  state.filters[group] = el.dataset.val;
}

/* ── Pagination state ── */
const searchState = { q: '', mode: '', lang: '', kind: '', limit: 10, offset: 0, hasMore: false };

async function doSearch() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  addToHistory(q);
  document.getElementById('search-history').classList.remove('show');

  const limit = parseInt(document.getElementById('search-limit').value, 10);
  const { lang, kind } = state.filters;
  const el = document.getElementById('search-results');
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>Searching…</span></div>`;

  Object.assign(searchState, { q, mode: state.searchMode, lang, kind, limit, offset: 0 });

  try {
    let page;
    if (state.searchMode === 'semantic') {
      page = await api.semantic(q, lang, kind, limit, 0);
    } else {
      page = await api.code(q, lang, limit, 0);
    }
    searchState.offset = page.results.length;
    searchState.hasMore = page.hasMore;
    renderResults(page.results, false);
    renderLoadMore(page.hasMore);
  } catch (e) {
    el.innerHTML = `<div class="empty-state" style="color:var(--red)">
      <p>Request failed</p><span>${esc(e.message)}</span></div>`;
  }
}

async function loadMore() {
  const { q, mode, lang, kind, limit, offset } = searchState;
  if (!q || !searchState.hasMore) return;
  const btn = document.getElementById('load-more-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  try {
    let page;
    if (mode === 'semantic') {
      page = await api.semantic(q, lang, kind, limit, offset);
    } else {
      page = await api.code(q, lang, limit, offset);
    }
    searchState.offset = offset + page.results.length;
    searchState.hasMore = page.hasMore;
    renderResults(page.results, true);
    renderLoadMore(page.hasMore);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('btn.loadMore'); }
  }
}

function renderLoadMore(hasMore) {
  const existing = document.getElementById('load-more-btn');
  if (existing) existing.remove();
  if (!hasMore) return;
  const el = document.getElementById('search-results');
  const btn = document.createElement('button');
  btn.id = 'load-more-btn';
  btn.className = 'btn btn-ghost load-more-btn';
  btn.textContent = t('btn.loadMore');
  btn.onclick = loadMore;
  el.appendChild(btn);
}

const debouncedSearch = debounce(doSearch, 300);

function renderResults(results, append = false) {
  const el = document.getElementById('search-results');
  if (!append && (!results || results.length === 0)) {
    el.innerHTML = `<div class="empty-state"><p>${t('empty.prompt')}</p><span>${t('empty.example')}</span></div>`;
    return;
  }
  const startIdx = append
    ? document.querySelectorAll('#search-results .result-card').length
    : 0;
  if (!append) {
    const meta = `<div class="result-meta"><span>${results.length}</span> ${t('result.count', results.length).replace(String(results.length), '').trim()}</div>`;
    el.innerHTML = meta + `<div class="results-grid" id="results-grid"></div>`;
  }
  const grid = document.getElementById('results-grid');
  const cards = results.map((r, i) => {
    const u = r.unit;
    const score = r.score || 0;
    const pct = Math.min(100, Math.round(score * 100));
    const sig = u.signature ? `<div class="rc-sig">${esc(u.signature)}</div>` : '';
    const annots = u.annotations && u.annotations.length
      ? `<div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">${u.annotations.map(a => `<span style="font-size:10px;font-family:var(--fm);color:var(--amber);opacity:0.8">${esc(a)}</span>`).join('')}</div>` : '';
    const sourceBtn = u.rawSource
      ? `<button class="rc-source-toggle" onclick="toggleSource(event,this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          ${t('src.toggle')}
        </button>
        <pre class="rc-source-pre">${esc(u.rawSource)}</pre>` : '';
    const qnSafe = esc(u.qualifiedName || '');
    const absIdx = startIdx + i;
    return `<div class="result-card" tabindex="-1" data-result-idx="${absIdx}" style="animation-delay:${Math.min(i, 10) * 40}ms"
      onclick="openSymbol('${qnSafe}')"
      onkeydown="onResultKeydown(event,${absIdx},'${qnSafe}')"
      onfocus="kbResultIdx=${absIdx}"
      onblur="if(kbResultIdx===${absIdx})kbResultIdx=-1"
      >
      <div class="rc-top">
        <span class="kind-badge" style="${kindStyle(u.kind)}">${u.kind}</span>
        <div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%"></div></div>
        <span class="score-val">${score.toFixed(3)}</span>
        <button class="copy-btn" onclick="copyQn(event,'${qnSafe}')" title="Copy qualified name">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
      <div class="rc-name">${esc(u.qualifiedName || '')}</div>
      <div class="rc-path">
        <span style="color:var(--text-3)">${esc(u.language || '')} · </span>${esc(u.filePath || '')}
        <span style="color:var(--text-3)"> · L${u.startLine}–${u.endLine}</span>
      </div>
      ${sig}${annots}${sourceBtn}
    </div>`;
  }).join('');
  if (append) {
    grid.insertAdjacentHTML('beforeend', cards);
  } else {
    grid.innerHTML = cards;
  }
}

function toggleSource(e, btn) {
  e.stopPropagation();
  const pre = btn.nextElementSibling;
  const open = pre.classList.toggle('open');
  btn.classList.toggle('open', open);
  const textNode = [...btn.childNodes].find(n => n.nodeType === 3);
  if (textNode) textNode.nodeValue = ' ' + t(open ? 'src.close' : 'src.toggle');
}

function copyQn(e, qn) {
  e.stopPropagation();
  copyToClipboard(qn).then(() => showToast('✓ Copied'));
}

function openSymbol(qn) {
  if (!qn) return;
  document.getElementById('graph-target').value = qn;
  switchPanel('graph');
  setTimeout(() => doGraphQuery(), 200);
}

/* ── Input listeners (set up after DOM ready) ── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('search-input').addEventListener('keydown', e => {
    const histEl = document.getElementById('search-history');
    const histItems = [...histEl.querySelectorAll('.history-item')];

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histEl.classList.contains('show') && histItems.length) {
        kbHistoryIdx = Math.min(kbHistoryIdx + 1, histItems.length - 1);
        histItems.forEach((it, i) => it.classList.toggle('kb-focus', i === kbHistoryIdx));
      } else {
        histEl.classList.remove('show');
        focusResultCard(0);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histEl.classList.contains('show') && histItems.length) {
        kbHistoryIdx = Math.max(kbHistoryIdx - 1, -1);
        histItems.forEach((it, i) => it.classList.toggle('kb-focus', i === kbHistoryIdx));
        if (kbHistoryIdx === -1) histItems.forEach(it => it.classList.remove('kb-focus'));
      }
      return;
    }
    if (e.key === 'Enter') {
      if (histEl.classList.contains('show') && kbHistoryIdx >= 0 && histItems[kbHistoryIdx]) {
        const q = histItems[kbHistoryIdx].textContent.trim();
        document.getElementById('search-input').value = q;
        histEl.classList.remove('show');
        kbHistoryIdx = -1;
        updateClearBtn();
        doSearch();
      } else {
        histEl.classList.remove('show');
        kbHistoryIdx = -1;
        doSearch();
      }
      return;
    }
    if (e.key === 'Escape') {
      histEl.classList.remove('show');
      kbHistoryIdx = -1;
      histItems.forEach(it => it.classList.remove('kb-focus'));
    }
  });
});

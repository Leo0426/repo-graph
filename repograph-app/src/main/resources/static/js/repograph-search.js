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
  if (e.target !== e.currentTarget) return;
  const cards = getResultCards();
  if (e.key === 'ArrowDown') { e.preventDefault(); focusResultCard(idx + 1); }
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (idx === 0) { document.getElementById('search-input').focus(); kbResultIdx = -1; cards.forEach(c => c.classList.remove('kb-focus')); }
    else focusResultCard(idx - 1);
  }
  else if (e.key === 'Enter') openSymbol(qn);
  else if (e.key === 'Escape') { document.getElementById('search-input').focus(); kbResultIdx = -1; cards.forEach(c => c.classList.remove('kb-focus')); }
  else if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    copyToClipboard(qn).then(() => showToast(t('toast.copied')))
      .catch(() => showToast(t('toast.copyFailed'), 5000, 'error'));
  }
}

/* ── Search history ── */
const HISTORY_KEY = 'repograph_search_history';
const MAX_HISTORY = 8;

function getHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(item => typeof item === 'string' && item.trim()).slice(0, MAX_HISTORY) : [];
  } catch { return []; }
}

function addToHistory(q) {
  if (!q.trim()) return;
  let h = getHistory().filter(x => x !== q);
  h.unshift(q);
  if (h.length > MAX_HISTORY) h = h.slice(0, MAX_HISTORY);
  // Search remains usable when optional browser history cannot be persisted.
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (_) {}
}

function renderHistoryDropdown() {
  const h = getHistory();
  const el = document.getElementById('search-history');
  if (!h.length) { el.classList.remove('show'); return; }
  el.innerHTML = h.map(q =>
    `<div class="history-item" onmousedown="pickHistory(event,${esc(JSON.stringify(q))})">
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

function onSearchInput(input, inputEvent) {
  updateClearBtn();
  invalidateSearch();
  if (inputEvent?.isComposing) return;
  if (!input.value.trim()) {
    renderSearchEmpty();
    document.getElementById('search-history').classList.remove('show');
  }
  debouncedSearch();
}

function renderSearchEmpty() {
  document.getElementById('search-results').innerHTML =
    `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <p data-i18n="empty.prompt">${esc(t('empty.prompt'))}</p>
      <span data-i18n="empty.example">${esc(t('empty.example'))}</span>
      <div class="search-examples">${['http', 'auth', 'data'].map(key =>
        `<button type="button" onclick="useSearchExample(this)" data-i18n="search.example.${key}">${esc(t(`search.example.${key}`))}</button>`
      ).join('')}</div>
    </div>`;
}

function useSearchExample(button) {
  document.getElementById('search-input').value = button.textContent.trim();
  updateClearBtn();
  doSearch();
}

function clearSearch() {
  invalidateSearch();
  const input = document.getElementById('search-input');
  input.value = '';
  updateClearBtn();
  input.focus();
  renderSearchEmpty();
}

function setSearchMode(mode, btn) {
  invalidateSearch();
  state.searchMode = mode;
  btn.closest('.tab-row').querySelectorAll('.tab').forEach(tb => {
    tb.classList.remove('active'); tb.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed', 'true');
  const hint = document.getElementById('search-mode-hint');
  const input = document.getElementById('search-input');
  hint.dataset.i18n = mode === 'semantic' ? 'hint.semantic' : 'hint.code';
  input.dataset.i18nPh = mode === 'semantic' ? 'ph.semantic' : 'ph.code';
  hint.textContent = t(hint.dataset.i18n);
  input.placeholder = t(input.dataset.i18nPh);
  document.querySelectorAll('.filter-chip[data-group="kind"]').forEach(chip => {
    chip.disabled = mode === 'code';
  });
  document.querySelector('.search-kind-note').hidden = mode !== 'code';
  renderSearchFilterSummary();
  if (document.getElementById('search-input').value.trim()) doSearch();
}

function toggleChip(el, group) {
  if (el.disabled) return;
  invalidateSearch();
  document.querySelectorAll(`.filter-chip[data-group="${group}"]`).forEach(c => {
    c.classList.remove('active'); c.setAttribute('aria-pressed', 'false');
  });
  el.classList.add('active');
  el.setAttribute('aria-pressed', 'true');
  state.filters[group] = el.dataset.val;
  renderSearchFilterSummary();
  if (document.getElementById('search-input').value.trim()) doSearch();
}

function renderSearchFilterSummary() {
  const summary = document.getElementById('search-filter-summary');
  if (!summary) return;
  const lang = state.filters.lang
    ? document.querySelector('.filter-chip[data-group="lang"].active')?.textContent.trim()
    : t('search.allLanguages');
  const kind = state.searchMode === 'code' ? '' : state.filters.kind
    ? document.querySelector('.filter-chip[data-group="kind"].active')?.textContent.trim()
    : t('search.allKinds');
  summary.textContent = t('search.filterSummary', lang, kind, document.getElementById('search-limit').value);
  document.getElementById('search-reset-filters').disabled = !state.filters.lang && !state.filters.kind;
}

function resetSearchFilters() {
  invalidateSearch();
  state.filters = { lang: '', kind: '' };
  document.querySelectorAll('.filter-chip').forEach(chip => {
    const active = chip.dataset.val === '';
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
  renderSearchFilterSummary();
  if (document.getElementById('search-input').value.trim()) doSearch();
}

function changeSearchLimit() {
  invalidateSearch();
  renderSearchFilterSummary();
  if (document.getElementById('search-input').value.trim()) doSearch();
}

/* ── Pagination state ── */
const searchState = { q: '', mode: '', lang: '', kind: '', limit: 10, offset: 0, hasMore: false };

let searchRequestVersion = 0;
let pendingSearchKey = null;
let loadingMore = false;
let searchDebounceTimer;

function setSearchBusy(busy) {
  document.getElementById('search-results').setAttribute('aria-busy', String(busy));
  const button = document.getElementById('search-submit');
  if (button) button.disabled = busy;
}

function invalidateSearch() {
  clearTimeout(searchDebounceTimer);
  searchRequestVersion++;
  pendingSearchKey = null;
  loadingMore = false;
  searchState.hasMore = false;
  document.getElementById('load-more-btn')?.remove();
  setSearchBusy(false);
}

async function doSearch() {
  clearTimeout(searchDebounceTimer);
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const limit = parseInt(document.getElementById('search-limit').value, 10);
  const { lang, kind } = state.filters;
  const mode = state.searchMode;
  const key = JSON.stringify([q, limit, lang, kind, mode]);
  if (pendingSearchKey === key) return;
  const version = ++searchRequestVersion;
  pendingSearchKey = key;
  loadingMore = false;
  addToHistory(q);
  document.getElementById('search-history').classList.remove('show');
  const el = document.getElementById('search-results');
  setSearchBusy(true);
  el.innerHTML = `<div class="search-loading">
    <div class="loading-row"><div class="spinner"></div><span>${esc(t('search.searching'))}</span></div>
    <div class="search-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="search-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>
  </div>`;
  Object.assign(searchState, { q, mode, lang, kind, limit, offset: 0, hasMore: false });
  try {
    const page = mode === 'semantic'
      ? await api.semantic(q, lang, kind, limit, 0)
      : await api.code(q, lang, limit, 0);
    if (version !== searchRequestVersion) return;
    if (!Array.isArray(page.results)) throw new Error(page.error || t('search.requestFailed'));
    searchState.offset = page.results.length;
    searchState.hasMore = page.hasMore;
    renderResults(page.results, false);
    renderLoadMore(page.hasMore);
  } catch (error) {
    if (version !== searchRequestVersion) return;
    el.innerHTML = `<div class="empty-state search-error">
      <p>${esc(t('search.requestFailed'))}</p><span>${esc(error.message)}</span>
      <button type="button" class="btn btn-ghost search-retry" onclick="doSearch()">${esc(t('search.retry'))}</button>
    </div>`;
  } finally {
    if (version === searchRequestVersion) {
      pendingSearchKey = null;
      setSearchBusy(false);
    }
  }
}

async function loadMore() {
  const { q, mode, lang, kind, limit, offset } = searchState;
  if (!q || !searchState.hasMore || loadingMore) return;
  const version = searchRequestVersion;
  loadingMore = true;
  const btn = document.getElementById('load-more-btn');
  if (btn) { btn.disabled = true; btn.textContent = t('search.searching'); }
  try {
    const page = mode === 'semantic'
      ? await api.semantic(q, lang, kind, limit, offset)
      : await api.code(q, lang, limit, offset);
    if (version !== searchRequestVersion) return;
    if (!Array.isArray(page.results)) throw new Error(page.error || t('search.requestFailed'));
    searchState.offset = offset + page.results.length;
    searchState.hasMore = page.hasMore;
    renderResults(page.results, true);
    renderLoadMore(page.hasMore);
  } catch (error) {
    if (version !== searchRequestVersion) return;
    if (btn) { btn.disabled = false; btn.textContent = t('btn.loadMore'); }
    showToast(t('search.requestFailed'), 5000, 'error');
  } finally {
    if (version === searchRequestVersion) loadingMore = false;
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

function debouncedSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(doSearch, 300);
}

function renderResults(results, append = false) {
  const el = document.getElementById('search-results');
  if (!append && (!results || results.length === 0)) {
    el.innerHTML = `<div class="empty-state"><p data-i18n="search.noResults">${esc(t('search.noResults'))}</p><span data-i18n="search.noResultsHint">${esc(t('search.noResultsHint'))}</span></div>`;
    return;
  }
  const startIdx = append
    ? document.querySelectorAll('#search-results .result-card').length
    : 0;
  if (!append) {
    const meta = '<div class="result-meta" data-count="0"></div>';
    el.innerHTML = meta + `<div class="results-grid" id="results-grid"></div>`;
  }
  const grid = document.getElementById('results-grid');
  const cards = results.map((r, i) => {
    const u = r.unit;
    const score = r.score || 0;
    const sig = u.signature ? `<div class="rc-sig">${esc(u.signature)}</div>` : '';
    const annots = u.annotations && u.annotations.length
      ? `<div class="rc-annotations">${u.annotations.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : '';
    const sourceBtn = u.rawSource
      ? `<button class="rc-source-toggle" aria-expanded="false" onclick="toggleSource(event,this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          <span data-i18n="src.toggle">${t('src.toggle')}</span>
        </button>` : '';
    const qnSafe = esc(JSON.stringify(u.qualifiedName || ''));
    const absIdx = startIdx + i;
    return `<article class="result-card" tabindex="0" data-result-idx="${absIdx}" style="animation-delay:${Math.min(i, 10) * 40}ms"
      onkeydown="onResultKeydown(event,${absIdx},${qnSafe})"
      onfocus="kbResultIdx=${absIdx}"
      onblur="if(kbResultIdx===${absIdx})kbResultIdx=-1"
      >
      <div class="rc-top">
        <span class="kind-badge" style="${kindStyle(u.kind)}">${u.kind}</span>
        <span class="rc-language">${esc(u.language || '')}</span>
        <span class="rc-similarity"><span data-i18n="search.similarity">${t('search.similarity')}</span>
          <span class="score-val">${score.toFixed(3)}</span></span>
        <button class="copy-btn" onclick="copyQn(event,${qnSafe})" data-i18n-title="search.copyName" title="${t('search.copyName')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
      <div class="rc-title">${esc(u.simpleName || u.qualifiedName || '')}</div>
      <div class="rc-name">${esc(u.qualifiedName || '')}</div>
      <div class="rc-path">
        ${esc(u.filePath || '')}
        <span style="color:var(--text-3)"> · L${u.startLine}–${u.endLine}</span>
      </div>
      ${sig}${annots}
      <div class="rc-actions">${sourceBtn}
        <button type="button" class="btn btn-ghost rc-open-graph" onclick="openSymbol(${qnSafe})">
          <span data-i18n="search.graphAction">${t('search.graphAction')}</span><span aria-hidden="true">↗</span>
        </button>
      </div>
      ${u.rawSource ? `<pre class="rc-source-pre">${esc(u.rawSource)}</pre>` : ''}
    </article>`;
  }).join('');
  if (append) {
    grid.insertAdjacentHTML('beforeend', cards);
  } else {
    grid.innerHTML = cards;
  }
  updateSearchResultCount();
}

function updateSearchResultCount() {
  const meta = document.querySelector('#search-results > .result-meta');
  if (!meta) return;
  const count = getResultCards().length;
  meta.dataset.count = String(count);
  meta.textContent = t('search.resultsShown', count);
}

function toggleSource(e, btn) {
  e.stopPropagation();
  const pre = btn.closest('.result-card').querySelector('.rc-source-pre');
  const open = pre.classList.toggle('open');
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  const label = btn.querySelector('span');
  label.dataset.i18n = open ? 'src.close' : 'src.toggle';
  label.textContent = t(label.dataset.i18n);
}

function copyQn(e, qn) {
  e.stopPropagation();
  copyToClipboard(qn).then(() => showToast(t('toast.copied')))
    .catch(() => showToast(t('toast.copyFailed'), 5000, 'error'));
}

async function openSymbol(qn) {
  if (!qn) return;
  document.getElementById('graph-target').value = qn;
  await switchPanel('graph');
  if (Alpine.store('repograph').panel === 'graph' && document.getElementById('graph-target').value === qn) {
    doGraphQuery();
  }
}

/* ── Input listeners (set up after DOM ready) ── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('search-filter-disclosure').open = !window.matchMedia('(max-width: 760px)').matches;
  renderSearchFilterSummary();
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
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
      e.preventDefault();
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

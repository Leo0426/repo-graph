/* Exact symbol lookup and file/line location share the captured project scope. */
const symbolView = {
  mode: 'lookup', generation: 0, phase: 'ready', unit: null, context: null,
  pendingKey: '', error: '', composing: false,
};
const symbolText = key => `<span data-i18n="${key}">${esc(t(key))}</span>`;

function setSymbolMode(mode) {
  if (!['lookup', 'locate'].includes(mode) || mode === symbolView.mode) return;
  symbolView.mode = mode;
  symbolView.composing = false;
  document.querySelectorAll('#symbol-tab-row button').forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('symbol-lookup-section').hidden = mode !== 'lookup';
  document.getElementById('symbol-locate-section').hidden = mode !== 'locate';
  document.getElementById('symbol-result').hidden = mode !== 'lookup';
  document.getElementById('locate-result').hidden = mode !== 'locate';
  invalidateSymbolQuery();
}

function invalidateSymbolQuery() {
  ++symbolView.generation;
  symbolView.phase = 'ready';
  symbolView.unit = null;
  symbolView.context = null;
  symbolView.pendingKey = '';
  symbolView.error = '';
  ['symbol-validation', 'locate-validation'].forEach(id => { document.getElementById(id).hidden = true; });
  document.querySelectorAll('#panel-symbol [aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
  renderSymbolState();
}

function handleSymbolKeydown(event) {
  if (event.key === 'Enter' && (event.isComposing || symbolView.composing || event.keyCode === 229 || event.repeat)) event.preventDefault();
}

function submitSymbolQuery(event, mode) {
  event.preventDefault();
  if (!symbolView.composing && !event.isComposing) return querySymbol(mode);
}
function doSymbolLookup() { return querySymbol('lookup'); }
function doLocate() { return querySymbol('locate'); }

function validateSymbolInput(mode) {
  const context = { mode, projectId: state.activeProjectId || '' };
  let invalidInput, messageKey;
  if (mode === 'lookup') {
    context.qualifiedName = document.getElementById('symbol-qn-input').value.trim();
    if (!context.qualifiedName) { invalidInput = 'symbol-qn-input'; messageKey = 'symbol.empty'; }
  } else {
    context.file = document.getElementById('locate-file-input').value.trim();
    const rawLine = document.getElementById('locate-line-input').value;
    context.line = Number(rawLine);
    if (!context.file) { invalidInput = 'locate-file-input'; messageKey = 'locate.empty'; }
    else if (!/^\d+$/.test(rawLine) || !Number.isInteger(context.line) || context.line < 1 || context.line > 2147483647) {
      invalidInput = 'locate-line-input'; messageKey = 'symbol.invalidLine';
    }
  }
  if (invalidInput) {
    const validation = document.getElementById(mode === 'lookup' ? 'symbol-validation' : 'locate-validation');
    validation.dataset.i18n = messageKey;
    validation.textContent = t(messageKey);
    validation.hidden = false;
    const input = document.getElementById(invalidInput);
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return null;
  }
  return context;
}

async function querySymbol(mode) {
  if (symbolView.composing) return;
  if (mode !== symbolView.mode) setSymbolMode(mode);
  const context = validateSymbolInput(mode);
  if (!context) return;
  const key = JSON.stringify(context);
  if (symbolView.phase === 'loading' && symbolView.pendingKey === key) return;
  const generation = ++symbolView.generation;
  symbolView.phase = 'loading';
  symbolView.unit = null;
  symbolView.context = context;
  symbolView.pendingKey = key;
  symbolView.error = '';
  renderSymbolState();
  const current = () => generation === symbolView.generation && context.projectId === (state.activeProjectId || '') && mode === symbolView.mode;
  try {
    const unit = await (mode === 'lookup' ? api.symbol(context.qualifiedName, context.projectId) : api.locate(context.file, context.line, context.projectId));
    if (!current()) return;
    if (!unit || typeof unit.qualifiedName !== 'string' || !unit.qualifiedName || typeof unit.kind !== 'string') {
      throw new Error(t('symbol.invalidResponse'));
    }
    symbolView.unit = unit;
    symbolView.phase = 'ready-result';
  } catch (error) {
    if (!current()) return;
    symbolView.phase = error.status === 404 ? 'not-found' : 'error';
    symbolView.error = error.message;
  } finally {
    if (current()) {
      symbolView.pendingKey = '';
      renderSymbolState();
    }
  }
}

function renderSymbolState() {
  const { phase, mode, unit } = symbolView;
  const active = document.getElementById(mode === 'lookup' ? 'symbol-result' : 'locate-result');
  const inactive = document.getElementById(mode === 'lookup' ? 'locate-result' : 'symbol-result');
  if (!active || !inactive) return;
  inactive.innerHTML = '';
  inactive.setAttribute('aria-busy', 'false');
  active.setAttribute('aria-busy', String(phase === 'loading'));
  active.dataset.state = phase;
  if (phase === 'ready-result') renderSymbolCard(unit, active.id);
  else if (phase === 'loading') active.innerHTML = '<div class="symbol-loading" aria-hidden="true"><div></div><div></div><div></div></div>';
  else if (phase === 'error') active.innerHTML = `<div class="symbol-empty symbol-error" role="alert"><strong>${symbolText(mode === 'lookup' ? 'symbol.lookupFailed' : 'symbol.locateFailed')}</strong><p>${esc(symbolView.error)}</p><button type="button" class="btn btn-ghost" onclick="querySymbol(symbolView.mode)">${symbolText('symbol.retry')}</button></div>`;
  else if (phase === 'not-found') active.innerHTML = `<div class="symbol-empty"><strong>${symbolText(mode === 'lookup' ? 'symbol.notFound' : 'locate.notFound')}</strong><p>${symbolText('symbol.notFoundHint')}</p></div>`;
  else active.innerHTML = `<div class="symbol-empty"><span class="symbol-empty-icon" aria-hidden="true">⌘</span><strong>${symbolText('symbol.ready')}</strong><p>${symbolText('symbol.readyHint')}</p></div>`;
  refreshSymbolLanguage();
}

function renderSymbolCard(unit, containerId) {
  const container = document.getElementById(containerId);
  const name = unit.simpleName || unit.qualifiedName;
  const lines = Number.isInteger(unit.startLine) && unit.startLine > 0
    ? `L${unit.startLine}${Number.isInteger(unit.endLine) && unit.endLine >= unit.startLine ? '–' + unit.endLine : ''}` : '';
  const annotations = Array.isArray(unit.annotations) ? unit.annotations : [];
  container.innerHTML = `<article class="symbol-detail" data-i18n-aria-label="symbol.result" aria-label="${esc(t('symbol.result'))}">
    <div class="symbol-detail-heading"><div><span class="kind-badge" style="${kindStyle(unit.kind)}">${esc(unit.kind)}</span>${unit.language ? `<span class="symbol-language">${esc(unit.language)}</span>` : ''}<h2>${esc(name)}</h2></div>
      <button type="button" class="btn btn-primary" onclick="openSymbolGraph()">${symbolText('symbol.graph')} ↗</button></div>
    <dl class="symbol-facts"><div><dt>${symbolText('symbol.qualifiedName')}</dt><dd class="symbol-qualified-name">${esc(unit.qualifiedName)}</dd></div>
      <div><dt>${symbolText('symbol.position')}</dt><dd>${esc(unit.filePath || '—')}${lines ? `<span class="symbol-line-range">${lines}</span>` : ''}</dd></div>
      ${unit.parentQualifiedName ? `<div><dt>${symbolText('symbol.parent')}</dt><dd>${esc(unit.parentQualifiedName)}</dd></div>` : ''}</dl>
    ${unit.signature ? `<div class="symbol-signature"><h3>${symbolText('symbol.signature')}</h3><pre tabindex="0"><code>${esc(unit.signature)}</code></pre></div>` : ''}
    ${annotations.length ? `<div class="symbol-annotations"><h3>${symbolText('symbol.annotations')}</h3><div>${annotations.map(annotation => `<span>${esc(annotation)}</span>`).join('')}</div></div>` : ''}
    <div class="symbol-detail-actions"><button type="button" class="btn btn-ghost" onclick="copySymbolValue('qualifiedName')">${symbolText('symbol.copyName')}</button>
      <span class="symbol-copy-feedback" role="status" aria-live="polite"></span></div>
    ${unit.rawSource ? `<details class="symbol-source"><summary>${symbolText('symbol.source')}</summary><div class="symbol-source-toolbar"><button type="button" class="btn btn-ghost" onclick="copySymbolValue('rawSource')">${symbolText('symbol.copySource')}</button></div><pre tabindex="0"><code>${esc(unit.rawSource)}</code></pre></details>` : `<p class="symbol-no-source">${symbolText('symbol.noSource')}</p>`}
  </article>`;
}

function refreshSymbolLanguage() {
  const scope = document.getElementById('symbol-scope-name');
  if (!scope) return;
  const projectId = state.activeProjectId || '';
  const project = (state.projects || []).find(project => project.projectId === projectId);
  scope.textContent = projectId ? (project ? projectName(project) : projectId) : t('header.allProjects');
  scope.title = projectId;
  const status = document.getElementById('symbol-query-status');
  status.textContent = symbolView.phase === 'loading' ? t('symbol.loading')
    : symbolView.phase === 'ready-result' ? `${t('symbol.found')} · ${symbolView.unit.simpleName || symbolView.unit.qualifiedName}`
    : symbolView.phase === 'not-found' ? t(symbolView.mode === 'lookup' ? 'symbol.notFound' : 'locate.notFound') : '';
  status.dataset.state = symbolView.phase;
  document.getElementById('symbol-lookup-btn').disabled = symbolView.mode === 'lookup' && symbolView.phase === 'loading';
  document.getElementById('symbol-locate-btn').disabled = symbolView.mode === 'locate' && symbolView.phase === 'loading';
}

async function copySymbolValue(field) {
  const value = symbolView.unit?.[field];
  if (!value || !['qualifiedName', 'rawSource'].includes(field)) return;
  const generation = symbolView.generation;
  let key = 'symbol.copyDone';
  try { await copyToClipboard(value); }
  catch (_) { key = 'symbol.copyFailed'; }
  if (generation !== symbolView.generation) return;
  const feedback = document.querySelector('#panel-symbol .symbol-copy-feedback');
  if (feedback) {
    feedback.dataset.i18n = key;
    feedback.dataset.tone = key === 'symbol.copyFailed' ? 'error' : 'success';
    feedback.textContent = t(key);
  }
}

async function openSymbolGraph() {
  const unit = symbolView.unit;
  const context = symbolView.context;
  if (!unit || !context) return;
  const target = unit.qualifiedName;
  const projectId = context.projectId;
  const generation = symbolView.generation;
  const targetInput = document.getElementById('graph-target');
  const projectInput = document.getElementById('graph-project');
  targetInput.value = target;
  projectInput.value = projectId;
  const callers = document.querySelector('#graph-tab-row .tab[onclick*="\'callers\'"]');
  setGraphMode('callers', callers);
  await switchPanel('graph');
  if (Alpine.store('repograph').panel !== 'graph' || generation !== symbolView.generation
      || targetInput.value !== target || projectInput.value !== projectId || state.graphMode !== 'callers') return;
  doGraphQuery();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#panel-symbol form').forEach(form => {
    form.addEventListener('compositionstart', () => { symbolView.composing = true; });
    form.addEventListener('compositionend', () => { symbolView.composing = false; });
  });
  renderSymbolState();
});

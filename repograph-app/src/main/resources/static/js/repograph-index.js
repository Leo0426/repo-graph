/* ── Index panel: isolate status requests by directory and poll serially. ── */
const indexView = {
  root: '', version: 0, phase: 'ready', snapshot: null, checking: false,
  error: '', signature: '', busyRoots: new Set(), submittingRoots: new Set(),
};
const INDEX_POLL_MS = 3000;
const LOG_MAX = 100;

function stopIndexPolling() {
  if (state.indexPolling) clearTimeout(state.indexPolling);
  state.indexPolling = null;
}

function onIndexRootChange(forceReset = false) {
  const input = document.getElementById('index-root');
  const root = input.value.trim();
  try { localStorage.setItem('repograph_index_root', input.value); } catch (_) {}
  if (root === indexView.root && !forceReset) return;
  stopIndexPolling();
  ++indexView.version;
  indexView.root = root;
  indexView.phase = indexView.busyRoots.has(root) || indexView.submittingRoots.has(root) ? 'unknown' : 'ready';
  indexView.snapshot = null;
  indexView.checking = false;
  indexView.error = '';
  indexView.signature = '';
  document.getElementById('index-validation').hidden = true;
  input.removeAttribute('aria-invalid');
  document.getElementById('index-errors-panel').open = false;
  clearIndexLog();
  refreshIndexLanguage();
}

function resetDeletedIndexRoot(root) {
  indexView.busyRoots.delete(root);
  if (document.getElementById('index-root')?.value.trim() === root) onIndexRootChange(true);
}

function requireIndexRoot() {
  onIndexRootChange();
  if (indexView.root) return indexView.root;
  const validation = document.getElementById('index-validation');
  validation.textContent = t('log.noRoot');
  validation.hidden = false;
  document.getElementById('index-configuration').open = true;
  const input = document.getElementById('index-root');
  input.setAttribute('aria-invalid', 'true');
  input.focus();
  return '';
}

async function triggerIndex() {
  const root = requireIndexRoot();
  if (!root || indexView.busyRoots.has(root) || indexView.submittingRoots.has(root)
      || indexView.checking || indexView.phase === 'connection') return;
  stopIndexPolling();
  const version = ++indexView.version;
  indexView.submittingRoots.add(root);
  indexView.phase = 'submitting';
  indexView.snapshot = null;
  indexView.error = '';
  indexView.signature = '';
  refreshIndexLanguage();
  const languages = ['lang-java', 'lang-c', 'lang-py'].map(id => document.getElementById(id))
    .filter(input => input.checked).map(input => input.value);
  const strategy = document.getElementById('index-strategy').value;
  const force = document.getElementById('no-incremental').checked;
  logLine('info', t('log.starting', root));
  logLine('info', t('log.strategy', strategy, languages.join(','), force));
  const current = () => version === indexView.version && root === indexView.root;
  let accepted = false;
  try {
    const response = await api.triggerIndex(root, languages.join(','), strategy, force);
    if (response?.status !== 'running') throw new Error(t('index.invalidResponse'));
    indexView.busyRoots.add(root);
    accepted = true;
    if (current()) logLine('info', t('index.accepted'));
  } catch (error) {
    if (error.status === 409) {
      indexView.busyRoots.add(root);
      accepted = true;
      if (current()) logLine('warn', t('index.conflict'));
    } else {
      if (!error.status) indexView.busyRoots.add(root);
      if (!current()) return;
      // A transport failure cannot prove whether the server accepted the request.
      indexView.phase = error.status ? 'error' : 'connection';
      indexView.error = error.message;
      logLine('error', t('log.failed', error.message));
    }
  } finally {
    indexView.submittingRoots.delete(root);
    if (current()) {
      if (accepted) {
        indexView.phase = 'running';
        indexView.snapshot = { status: 'running' };
      }
      refreshIndexLanguage();
      if (accepted) {
        if (Alpine.store('repograph').panel === 'index') focusIndexExecution();
        readIndexStatus(root, version);
      }
    } else if (indexView.root === root) {
      refreshIndexLanguage();
    }
  }
}

function checkIndexStatus() {
  const root = requireIndexRoot();
  if (!root || indexView.checking || indexView.submittingRoots.has(root)) return;
  stopIndexPolling();
  return readIndexStatus(root, indexView.version);
}

async function readIndexStatus(root, version) {
  if (version !== indexView.version || root !== indexView.root || indexView.checking) return;
  indexView.checking = true;
  if (!indexView.snapshot) indexView.phase = 'checking';
  refreshIndexLanguage();
  const current = () => version === indexView.version && root === indexView.root;
  try {
    const result = await api.indexStatus(root);
    if (!result || typeof result.status !== 'string'
        || (!['idle', 'running', 'done', 'partial'].includes(result.status) && !result.status.startsWith('error'))) {
      throw new Error(t('index.invalidResponse'));
    }
    if (!current()) return;
    indexView.error = '';
    updateIndexStatus(result);
    if (result.status === 'running') {
      state.indexPolling = setTimeout(() => {
        state.indexPolling = null;
        readIndexStatus(root, version);
      }, INDEX_POLL_MS);
    }
  } catch (error) {
    if (!current()) return;
    indexView.phase = 'connection';
    indexView.error = error.message;
    logLine('error', `${t('index.statusFailed')}: ${error.message}`);
  } finally {
    if (current()) {
      indexView.checking = false;
      refreshIndexLanguage();
    }
  }
}

function updateIndexStatus(result) {
  indexView.snapshot = result;
  indexView.phase = result.status.startsWith('error') ? 'error' : result.status;
  if (result.status === 'running') indexView.busyRoots.add(indexView.root);
  else indexView.busyRoots.delete(indexView.root);
  const signature = JSON.stringify(result);
  if (signature !== indexView.signature) {
    indexView.signature = signature;
    if (result.indexedAt) logLine('info', t('log.history', relativeTime(result.indexedAt)));
    if (result.status === 'done' || result.status === 'partial') {
      logLine(result.status === 'partial' ? 'warn' : 'ok', t(result.status === 'partial' ? 'log.partial' : 'log.done',
        result.totalUnits ?? '—', result.totalEdges ?? '—', formatDur(result.durationMs)));
      (result.errors || []).forEach(error => logLine('warn', error));
    } else if (result.status.startsWith('error')) logLine('error', result.status);
    else if (result.status === 'running' && result.stage) {
      logLine('info', `${indexStageLabel(result.stage)}: ${result.done ?? '—'}/${result.total ?? '—'}`);
    }
  }
}

function indexStageLabel(stage) {
  if (stage === 'parsing' || stage === 'embedding') return t('index.stage.' + stage);
  return stage ? `${t('index.stage.other')} · ${stage}` : t('index.unknownStage');
}

/** Language/HTMX refreshes update current text without replacing logs or disclosures. */
function refreshIndexLanguage() {
  const card = document.getElementById('index-state-card');
  if (!card) return;
  const { phase, snapshot: result, root, checking } = indexView;
  const set = (id, value) => {
    const element = document.getElementById(id);
    const text = String(value ?? '—');
    if (element && element.textContent !== text) element.textContent = text;
  };
  card.dataset.state = phase;
  card.setAttribute('aria-busy', String(checking || phase === 'submitting'));
  const stateKey = ['idle', 'running', 'done', 'partial'].includes(phase) ? 'status.' + phase : 'index.phase.' + phase;
  set('ring-status', t(stateKey));
  set('index-observed-root', root || t('index.noRootSelected'));
  const notes = { ready: 'readyHint', submitting: 'submittingHint', checking: 'checkingHint', running: 'runningHint',
    done: 'doneHint', partial: 'partialHint', error: 'failedHint', connection: 'connectionHint', idle: 'idleHint', unknown: 'connectionHint' };
  set('index-state-note', t('index.' + notes[phase]));
  const error = indexView.error || (phase === 'error' && result?.status?.startsWith('error') ? result.status : '');
  const errorElement = document.getElementById('index-connection-error');
  errorElement.hidden = !error;
  set('index-connection-error', error);
  document.getElementById('index-retry-status').hidden = !['connection', 'unknown'].includes(phase);
  document.getElementById('index-retry-status').disabled = checking;
  const stageVisible = phase === 'running' || phase === 'submitting' || phase === 'checking';
  document.getElementById('index-progress').hidden = !stageVisible;
  const progress = document.getElementById('index-stage-progress');
  const pct = phase === 'running' && Number.isFinite(result?.pct) ? Math.min(100, Math.max(0, result.pct)) : null;
  if (pct === null) progress.removeAttribute('value');
  else progress.value = pct;
  set('ring-pct', pct === null ? '—' : `${pct}%`);
  set('index-stage-label', indexStageLabel(result?.stage));
  set('index-stage-count', phase === 'running' && result?.done != null && result?.total != null ? `${result.done} / ${result.total}` : '');
  set('stat-files', result?.totalFiles);
  set('stat-parsed', result?.parsedFiles);
  set('stat-units', result?.totalUnits);
  set('stat-edges', result?.totalEdges);
  set('stat-errors', Array.isArray(result?.errors) ? result.errors.length : undefined);
  document.getElementById('stat-errors').dataset.hasErrors = String(Array.isArray(result?.errors) && result.errors.length > 0);
  set('stat-dur', result?.durationMs != null ? formatDur(result.durationMs) : '—');
  const history = document.getElementById('stat-indexed-at-row');
  history.hidden = !result?.indexedAt;
  set('stat-indexed-at', result?.indexedAt ? relativeTime(result.indexedAt) : '');
  document.getElementById('stat-indexed-at').dateTime = result?.indexedAt || '';
  document.getElementById('stat-indexed-at').title = result?.indexedAt || '';
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  document.getElementById('index-errors-panel').hidden = !errors.length;
  set('index-error-count', errors.length);
  const list = document.getElementById('index-errors');
  const markup = errors.map(error => `<li>${esc(error)}</li>`).join('');
  if (list.innerHTML !== markup) list.innerHTML = markup;
  const blocked = indexView.busyRoots.has(root) || indexView.submittingRoots.has(root) || checking || phase === 'connection';
  const start = document.getElementById('index-btn');
  start.disabled = blocked;
  const label = start.querySelector('span');
  const labelKey = phase === 'submitting' ? 'index.phase.submitting' : indexView.busyRoots.has(root) ? 'status.running' : 'btn.startIndex';
  label.dataset.i18n = labelKey;
  label.textContent = t(labelKey);
  document.getElementById('status-btn').disabled = checking || indexView.submittingRoots.has(root);
}

function focusIndexExecution() {
  if (matchMedia('(max-width: 760px)').matches) document.getElementById('index-configuration').open = false;
  const execution = document.getElementById('index-execution');
  execution.focus({ preventScroll: true });
  execution.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function clearIndexLog() {
  const log = document.getElementById('index-log');
  if (log) log.innerHTML = `<span class="log-info index-log-placeholder" data-i18n="log.waiting">${esc(t('log.waiting'))}</span>`;
}

function logLine(type, message) {
  const log = document.getElementById('index-log');
  if (!log) return;
  const follow = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.querySelector('.index-log-placeholder')?.remove();
  while (log.children.length >= LOG_MAX) log.firstElementChild.remove();
  const time = new Date().toLocaleTimeString('en', { hour12: false });
  const className = { ok: 'log-ok', error: 'log-err', warn: 'log-warn', info: 'log-info' }[type] || 'log-info';
  log.insertAdjacentHTML('beforeend', `<div class="${className}"><time>${time}</time><span>${esc(message)}</span></div>`);
  if (follow) log.scrollTop = log.scrollHeight;
}

function formatDur(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm ' + (Math.floor(ms / 1000) % 60) + 's';
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    const root = localStorage.getItem('repograph_index_root');
    if (root) document.getElementById('index-root').value = root;
  } catch (_) {}
  onIndexRootChange();
  clearIndexLog();
  refreshIndexLanguage();
  if (indexView.root) checkIndexStatus();
});

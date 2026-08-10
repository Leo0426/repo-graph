/* ── Index panel ── */
let toggleOn = false;

function toggleSwitch() {
  toggleOn = !toggleOn;
  document.getElementById('no-incremental').checked = toggleOn;
  const track = document.getElementById('toggle-track');
  const thumb = document.getElementById('toggle-thumb');
  track.style.background = toggleOn ? 'rgba(0,255,179,0.35)' : 'var(--border)';
  thumb.style.left = toggleOn ? '21px' : '3px';
  thumb.style.background = toggleOn ? 'var(--mint)' : 'var(--text-2)';
}

async function triggerIndex() {
  const root = document.getElementById('index-root').value.trim();
  if (!root) { logLine('error', t('log.noRoot')); return; }

  const langs = [];
  if (document.getElementById('lang-java').checked) langs.push('java');
  if (document.getElementById('lang-c').checked) langs.push('c');
  if (document.getElementById('lang-py').checked) langs.push('python');

  const strategy = document.getElementById('index-strategy').value;
  const noInc = toggleOn;

  logLine('info', t('log.starting', root));
  logLine('info', t('log.strategy', strategy, langs.join(','), noInc));
  document.getElementById('ring-status').textContent = 'starting…';
  setRingProgress(0);

  const btn = document.getElementById('index-btn');
  btn.disabled = true;
  btn.querySelector('span').textContent = t('status.running');

  try {
    const r = await api.triggerIndex(root, langs.join(','), strategy, noInc);
    logLine('ok', `${t('status.' + r.status) || r.status}: ${r.message || ''}`);
    startIndexPolling(root);
  } catch (e) {
    logLine('error', t('log.failed', e.message));
    btn.disabled = false;
    btn.querySelector('span').textContent = t('btn.startIndex');
  }
}

function _reenableIndexBtn() {
  const btn = document.getElementById('index-btn');
  if (btn) { btn.disabled = false; btn.querySelector('span').textContent = t('btn.startIndex'); }
}

async function checkIndexStatus() {
  const root = document.getElementById('index-root').value.trim();
  if (!root) { logLine('error', t('log.noRoot')); return; }
  try {
    const s = await api.indexStatus(root);
    updateIndexStatus(s);
  } catch (e) {
    logLine('error', 'Status check failed: ' + e.message);
  }
}

function startIndexPolling(root) {
  if (state.indexPolling) clearInterval(state.indexPolling);
  state.indexPolling = setInterval(async () => {
    try {
      const s = await api.indexStatus(root);
      updateIndexStatus(s);
      if (s.status === 'done' || s.status === 'partial'
          || (s.status && s.status.startsWith('error'))) {
        clearInterval(state.indexPolling);
        state.indexPolling = null;
      }
    } catch (e) {}
  }, 3000);
}

function updateIndexStatus(s) {
  if (!s) return;
  const status = s.status || 'idle';
  const isHistory = !!s.indexedAt;           // only set on SQLite-fallback responses
  document.getElementById('ring-status').textContent = status;

  if (status === 'done' || status === 'partial') {
    setRingProgress(100);
    if (isHistory) {
      const rel = relativeTime(s.indexedAt);
      logLine('info', t('log.history', rel));
    } else {
      const logType = status === 'partial' ? 'warn' : 'ok';
      const logKey = status === 'partial' ? 'log.partial' : 'log.done';
      logLine(logType, t(logKey, s.totalUnits, s.totalEdges, formatDur(s.durationMs)));
      if (s.errors && s.errors.length) s.errors.forEach(e => logLine('warn', e));
    }
    _reenableIndexBtn();
  } else if (status === 'running') {
    let pct;
    if (s.pct != null) {
      pct = s.stage === 'embedding'
        ? 20 + Math.round(s.pct * 0.8)
        : Math.round(s.pct * 0.8);
    } else {
      pct = s.totalFiles > 0 ? Math.round((s.parsedFiles / s.totalFiles) * 80) : 10;
    }
    setRingProgress(Math.max(5, pct));
    if (s.stage && s.done != null && s.total != null) {
      const stageLabel = s.stage === 'embedding' ? 'Embedding' : 'Parsing';
      document.getElementById('ring-pct').textContent = `${s.pct ?? 0}%`;
      logLine('info', `${stageLabel}: ${s.done}/${s.total}`);
    }
  } else if (status.startsWith('error')) {
    logLine('error', status);
    setRingProgress(0);
    _reenableIndexBtn();
  }

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };
  set('stat-files',    s.totalFiles    ?? '—');
  set('stat-units',    s.totalUnits    ?? '—');
  set('stat-edges',    s.totalEdges    ?? '—');
  set('stat-degraded', s.degradedFiles ?? '—');
  set('stat-errors',   (s.errors || []).length || '0');
  set('stat-dur',      s.durationMs ? formatDur(s.durationMs) : '—');
  set('ring-pct',      status === 'done' ? '✓' : status === 'partial' ? '!' : status === 'running' ? '…' : '—');

  // Timestamp row: show when data comes from history, hide otherwise
  const tsEl = document.getElementById('stat-indexed-at');
  if (tsEl) tsEl.textContent = s.indexedAt ? relativeTime(s.indexedAt) : '';
  const tsRow = document.getElementById('stat-indexed-at-row');
  if (tsRow) tsRow.style.display = s.indexedAt ? '' : 'none';
}

function setRingProgress(pct) {
  const circ = 314;
  const fill = document.getElementById('ring-fill');
  if (fill) fill.style.strokeDashoffset = circ - (circ * pct / 100);
}

const LOG_MAX = 100;

function logLine(type, msg) {
  const log = document.getElementById('index-log');
  while (log.children.length >= LOG_MAX) log.removeChild(log.firstChild);
  const time = new Date().toLocaleTimeString('en', { hour12: false });
  const cls = { ok: 'log-ok', error: 'log-err', warn: 'log-warn', info: 'log-info' }[type] || 'log-info';
  log.insertAdjacentHTML('beforeend', `<div class="${cls}">[${time}] ${esc(msg)}</div>`);
  log.scrollTop = log.scrollHeight;
}

function formatDur(ms) {
  if (!ms) return '—';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm ' + (Math.floor(ms / 1000) % 60) + 's';
}

document.addEventListener('DOMContentLoaded', () => {
  const root = localStorage.getItem('repograph_index_root');
  if (root) {
    const el = document.getElementById('index-root');
    if (el) el.value = root;
    // Auto-restore last index result from SQLite history (survives restarts)
    api.indexStatus(root).then(s => {
      if (s && s.status && s.status !== 'idle') updateIndexStatus(s);
    }).catch(() => {});
  }
  const logEl = document.getElementById('index-log');
  if (logEl) logEl.innerHTML = `<span class="log-info">${t('log.waiting')}</span>`;
});

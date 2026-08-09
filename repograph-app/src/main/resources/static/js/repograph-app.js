/* ── State ── */
const state = {
  searchMode: 'semantic',
  graphMode: 'callers',
  filters: { lang: '', kind: '' },
  selectedNode: null,
  activeProjectId: '',
  flowResult: null,
  flowView: 'cfg',
  indexPolling: null,
  projects: [],
};

/* ── Utils ── */
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function copyToClipboard(text) {
  return navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.resolve();
}

function relativeTime(iso) {
  if (!iso) return '';
  const ts = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60)          return t('time.justNow');
  if (sec < 3600)        return t('time.minAgo', Math.floor(sec / 60));
  if (sec < 86400)       return t('time.hourAgo', Math.floor(sec / 3600));
  if (sec < 86400 * 30)  return t('time.dayAgo', Math.floor(sec / 86400));
  return new Date(ts).toLocaleDateString();
}

let _toastTimer = null;
function showToast(msg, ms = 1800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ── API ── */
const api = {
  semantic: (q, lang, kind, limit, offset = 0) => {
    const p = new URLSearchParams({ q, limit, offset });
    if (lang) p.set('lang', lang);
    if (kind) p.set('kind', kind);
    return fetch(`/api/v1/search/semantic?${p}`).then(r => r.json());
  },
  code: (snippet, lang, limit, offset = 0) => {
    const p = new URLSearchParams({ snippet, limit, offset });
    if (lang) p.set('lang', lang);
    return fetch(`/api/v1/search/code?${p}`).then(r => r.json());
  },
  graphQuery: (path, target, depth, projectId) => {
    const p = new URLSearchParams({ target });
    if (depth != null) p.set('depth', depth);
    if (projectId) p.set('projectId', projectId);
    return fetch(`/api/v1/graph/${path}?${p}`).then(r => r.json());
  },
  callers: (target, depth, projectId) => api.graphQuery('callers', target, depth, projectId),
  callees: (target, depth, projectId) => api.graphQuery('callees', target, depth, projectId),
  impact: (target, projectId) => api.graphQuery('impact', target, null, projectId),
  subtypes: (target, projectId) => api.graphQuery('subtypes', target, null, projectId),
  graphSymbols: (query, projectId) => {
    const p = new URLSearchParams({ q: query, limit: 10 });
    if (projectId) p.set('projectId', projectId);
    return fetch(`/api/v1/graph/symbols?${p}`).then(r => r.json());
  },
  flowAnalyze: (target, projectId) => {
    const p = new URLSearchParams({ target });
    if (projectId) p.set('projectId', projectId);
    return fetch(`/api/v1/flow/analyze?${p}`).then(r => {
      if (!r.ok) throw new Error(r.status === 404 ? 'Flow analysis is unavailable for this symbol' : `HTTP ${r.status}`);
      return r.json();
    });
  },
  deadCode: (projectId) =>
    fetch(`/api/v1/graph/deadcode?projectId=${encodeURIComponent(projectId)}`).then(r => r.json()),
  testGaps: (projectId) =>
    fetch(`/api/v1/graph/testgaps?projectId=${encodeURIComponent(projectId)}`).then(r => r.json()),
  entrypoints: (projectId, lang) => {
    const p = new URLSearchParams();
    if (projectId) p.set('projectId', projectId);
    if (lang) p.set('lang', lang);
    const qs = p.toString();
    return fetch(`/api/v1/graph/entrypoints${qs ? '?' + qs : ''}`).then(r => r.json());
  },
  projects: () => fetch('/api/v1/projects').then(r => r.json()),
  projectStats: (projectId) =>
    fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/stats`).then(r => r.json()),
  deleteProject: (projectId) =>
    fetch(`/api/v1/index/project?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' })
      .then(r => r.json()),
  symbol: (qn) => fetch(`/api/v1/symbol/${encodeURIComponent(qn)}`).then(r => r.json()),
  locate: (file, line) => fetch(`/api/v1/locate?file=${encodeURIComponent(file)}&line=${line}`).then(r => r.json()),
  frameworks: (projectId) => fetch(`/api/v1/frameworks/${encodeURIComponent(projectId)}`).then(r => r.json()),
  sbom: async (projectId, projectRoot) => {
    const p = new URLSearchParams({ projectRoot });
    const r = await fetch(`/api/v1/sbom/${encodeURIComponent(projectId)}?${p}`);
    const text = await r.text();
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { msg = JSON.parse(text).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    return text;
  },
  indexStatus: (root) => fetch(`/api/v1/index/project/status?projectRoot=${encodeURIComponent(root)}`).then(r => r.json()),
  triggerIndex: (root, lang, strategy, noIncremental) => {
    const p = new URLSearchParams({ projectRoot: root, strategy });
    if (lang) p.set('lang', lang);
    p.set('noIncremental', noIncremental);
    return fetch(`/api/v1/index/project?${p}`, { method: 'POST' }).then(r => r.json());
  },
  watchList: () => fetch('/api/v1/watch').then(r => r.json()),
  watchStatus: (projectId) => fetch(`/api/v1/watch/${encodeURIComponent(projectId)}`).then(r => r.json()),
  watchStart: (projectId, root) => {
    const p = new URLSearchParams({ projectId, root });
    return fetch(`/api/v1/watch?${p}`, { method: 'POST' }).then(r => r.json());
  },
  watchStop: (projectId) => fetch(`/api/v1/watch/${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
  vulnScanCode: (projectId) =>
    fetch(`/api/v1/vulns/scan/code?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' }).then(r => r.json()),
  vulnScanTaint: (projectId) =>
    fetch(`/api/v1/vulns/scan/taint?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' }).then(r => r.json()),
  vulnScanDeps: (projectId, projectRoot) => {
    const p = new URLSearchParams({ projectId, projectRoot });
    return fetch(`/api/v1/vulns/scan/deps?${p}`, { method: 'POST' }).then(r => r.json());
  },
  vulnList: (projectId, severity, status) => {
    const p = new URLSearchParams({ projectId });
    if (severity) p.set('severity', severity);
    if (status) p.set('status', status);
    return fetch(`/api/v1/vulns?${p}`).then(r => r.json());
  },
  vulnUpdateStatus: (id, status) =>
    fetch(`/api/v1/vulns/${encodeURIComponent(id)}/status?status=${encodeURIComponent(status)}`,
          { method: 'PUT' }).then(r => r.json()),
  vulnReport: (projectId) =>
    fetch(`/api/v1/vulns/report/${encodeURIComponent(projectId)}`).then(r => r.json()),
  complexity: (projectId, limit = 20) => {
    const p = new URLSearchParams({ projectId, limit });
    return fetch(`/api/v1/metrics/complexity?${p}`).then(r => r.json());
  },
  coupling: (projectId, sort = 'fanout', limit = 20) => {
    const p = new URLSearchParams({ projectId, sort, limit });
    return fetch(`/api/v1/metrics/coupling?${p}`).then(r => r.json());
  },
  packageCycles: (projectId) =>
    fetch(`/api/v1/metrics/cycles?projectId=${encodeURIComponent(projectId)}`).then(r => r.json()),
  healthReport: (projectId) =>
    fetch(`/api/v1/metrics/report?projectId=${encodeURIComponent(projectId)}`).then(r => r.json()),
  hotspots: (projectId, limit = 10) => {
    const p = new URLSearchParams({ projectId, limit });
    return fetch(`/api/v1/metrics/hotspots?${p}`).then(r => r.json());
  },
  exportGraph: (projectId, format = 'mermaid') => {
    const p = new URLSearchParams({ projectId, format });
    return fetch(`/api/v1/export/graph?${p}`).then(r => r.text());
  },
  exportGraphUrl: (projectId, format) =>
    `/api/v1/export/graph?projectId=${encodeURIComponent(projectId)}&format=${encodeURIComponent(format)}`,
  agentStartSastTriage: async (projectId, format, json, codeVersion, ruleVersion) => {
    const p = new URLSearchParams({ projectId, format });
    if (codeVersion) p.set('codeVersion', codeVersion);
    if (ruleVersion) p.set('ruleVersion', ruleVersion);
    const response = await fetch(`/api/v1/agent-runs/sast-triage?${p}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json,
    });
    if (!response.ok) throw new Error(await apiError(response));
    return response.json();
  },
  agentRuns: async (projectId, limit = 20) => {
    const p = new URLSearchParams({ projectId, limit });
    const response = await fetch(`/api/v1/agent-runs?${p}`);
    if (!response.ok) throw new Error(await apiError(response));
    return response.json();
  },
  agentRun: async (runId) => {
    const response = await fetch(`/api/v1/agent-runs/${encodeURIComponent(runId)}`);
    if (!response.ok) throw new Error(await apiError(response));
    return response.json();
  },
};

async function apiError(response) {
  const text = await response.text();
  try { return JSON.parse(text).error || `HTTP ${response.status}`; }
  catch (_) { return text || `HTTP ${response.status}`; }
}

/* ── Navigation ── */
function switchPanel(id) {
  Alpine.store('repograph').showPanel(id);
}

function handlePanelSwitch(id) {
  if (id === 'agent') { refreshProjectsList().then(populateAgentProjectSelect).then(loadAgentRuns); return; }
  if (id === 'graph') setTimeout(initGraphCanvas, 50);
  if (id === 'tools') renderProjectsManage();
  if (id === 'benchmark') { loadBenchmark(); return; }
  if (id === 'vulns') { refreshProjectsList().then(populateVulnProjectSelect); return; }
  if (id === 'metrics') { refreshProjectsList().then(populateMetricsProjectSelect); return; }
  if (id === 'graph' || id === 'tools' || id === 'stats' || id === 'sbom') {
    const refreshed = refreshProjectsList();
    if (id === 'stats') refreshed.then(maybeAutoLoadStats);
    if (id === 'sbom') refreshed.then(projects => {
      const input = document.getElementById('sbom-view-input');
      if (input && !input.value.trim() && Array.isArray(projects) && projects.length === 1)
        input.value = projectName(projects[0]);
    });
    return refreshed;
  }
}

function maybeAutoLoadStats(projects) {
  const input = document.getElementById('stats-project-input');
  if (!input || input.value.trim()) return;
  if (!Array.isArray(projects) || projects.length !== 1) return;
  input.value = projectName(projects[0]);
  loadProjectStats();
}

async function refreshProjectsList() {
  try {
    const projects = await api.projects();
    state.projects = projects;
    const dl = document.getElementById('projects-datalist');
    dl.innerHTML = projects.map(p => {
      const name = projectName(p);
      const label = `${p.projectId.slice(0, 8)}… · ${p.nodeCount} units`;
      return `<option value="${esc(name)}" label="${esc(label)}"></option>`;
    }).join('');
    const global = document.getElementById('global-project');
    const selected = state.activeProjectId;
    global.innerHTML = `<option value="">${esc(t('header.allProjects'))}</option>` + projects.map(p =>
      `<option value="${esc(p.projectId)}">${esc(projectName(p))} · ${p.nodeCount}</option>`
    ).join('');
    global.value = selected;
    return projects;
  } catch (e) {
    return state.projects;
  }
}

function setGlobalProject(projectId) {
  state.activeProjectId = projectId || '';
  localStorage.setItem('repograph_active_project', state.activeProjectId);
  const project = (state.projects || []).find(p => p.projectId === state.activeProjectId);
  const value = project ? projectName(project) : '';
  ['graph-project','entrypoints-project','stats-project-input',
   'frameworks-project-input','sbom-project-input','sbom-view-input'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  });
  const agentProject = document.getElementById('agent-project-select');
  if (agentProject) agentProject.value = state.activeProjectId;
  const active = document.querySelector('.panel.active');
  if (active?.id === 'panel-stats' && value) loadProjectStats();
}

function projectName(p) {
  if (!p) return '';
  if (!p.projectRoot) return p.projectId;
  const parts = p.projectRoot.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p.projectId;
}

function resolveProjectId(nameOrId) {
  if (!nameOrId) return nameOrId;
  const projects = state.projects || [];
  const byName = projects.find(p => projectName(p) === nameOrId);
  if (byName) return byName.projectId;
  const byId = projects.find(p => p.projectId === nameOrId || p.projectId.startsWith(nameOrId));
  if (byId) return byId.projectId;
  return nameOrId;
}

function resolveProject(nameOrId) {
  if (!nameOrId) return null;
  const projects = state.projects || [];
  return projects.find(p => projectName(p) === nameOrId)
      || projects.find(p => p.projectId === nameOrId || p.projectId.startsWith(nameOrId))
      || null;
}

/* ── I18N application ── */
function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const val = t(el.dataset.i18n);
    if (typeof val === 'string') el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const val = t(el.dataset.i18nPh);
    if (val) el.placeholder = val;
  });
  document.querySelectorAll('select option[data-i18n]').forEach(el => {
    const val = t(el.dataset.i18n);
    if (val) el.textContent = val;
  });
  const hint = document.getElementById('graph-hint');
  if (hint && hint.dataset.i18n) hint.textContent = t(hint.dataset.i18n);
  const modeHint = document.getElementById('search-mode-hint');
  if (modeHint) modeHint.textContent = t(state.searchMode === 'semantic' ? 'hint.semantic' : 'hint.code');
}

function onLangChange(lang) {
  currentLang = lang;
  localStorage.setItem('repograph_lang', lang);
  document.documentElement.lang = lang;
  applyLang();
  refreshProjectsList();
}

/* ── Symbol panel ── */
function setSymbolMode(mode, btn) {
  btn.closest('.tab-row').querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('symbol-lookup-section').style.display = mode === 'lookup' ? '' : 'none';
  document.getElementById('symbol-locate-section').style.display  = mode === 'locate'  ? '' : 'none';
}

function renderSymbolCard(unit, containerId) {
  const el = document.getElementById(containerId);
  if (!unit || unit.error) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">∅</div><div>${t(containerId === 'symbol-result' ? 'symbol.notFound' : 'locate.notFound')}</div></div>`;
    return;
  }
  el.innerHTML = `<div class="result-card" style="cursor:default">
    <div class="result-header">
      <span class="kind-badge" style="${kindStyle(unit.kind)}">${unit.kind}</span>
      <span class="result-qn">${esc(unit.qualifiedName)}</span>
    </div>
    <div class="result-meta">
      <span>${esc(unit.filePath || '')}</span>
      ${unit.startLine ? `<span>L${unit.startLine}–${unit.endLine}</span>` : ''}
      ${unit.language ? `<span>${unit.language}</span>` : ''}
    </div>
  </div>`;
}

async function doSymbolLookup() {
  const qn = document.getElementById('symbol-qn-input').value.trim();
  if (!qn) { document.getElementById('symbol-result').innerHTML = `<div class="empty-state">${t('symbol.empty')}</div>`; return; }
  document.getElementById('symbol-result').innerHTML = '<div class="empty-state">…</div>';
  try {
    const unit = await api.symbol(qn);
    renderSymbolCard(unit, 'symbol-result');
  } catch(e) {
    document.getElementById('symbol-result').innerHTML = `<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

async function doLocate() {
  const file = document.getElementById('locate-file-input').value.trim();
  const line = parseInt(document.getElementById('locate-line-input').value) || 0;
  if (!file || !line) { document.getElementById('locate-result').innerHTML = `<div class="empty-state">${t('locate.empty')}</div>`; return; }
  document.getElementById('locate-result').innerHTML = '<div class="empty-state">…</div>';
  try {
    const unit = await api.locate(file, line);
    renderSymbolCard(unit, 'locate-result');
  } catch(e) {
    document.getElementById('locate-result').innerHTML = `<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

/* ── Kind colors ── */
const KIND_COLORS = {
  CLASS: '#3EFFA0', INTERFACE: '#60A5FA', ENUM: '#34D399', ANNOTATION: '#6EE7B7',
  METHOD: '#A78BFA', CONSTRUCTOR: '#C084FC', FUNCTION: '#FBBF24',
  FIELD: '#94A3B8', STRUCT: '#FB923C', MACRO: '#F97316', LOCAL_VAR: '#64748B',
};

function kindColor(k) { return KIND_COLORS[k] || '#64748B'; }
function kindStyle(k) {
  const c = kindColor(k);
  return `background:${c}22;color:${c};border:1px solid ${c}44`;
}

/* ── Keyboard shortcuts ── */
document.addEventListener('keydown', e => {
  const inInput = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);

  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    switchPanel('search');
    document.getElementById('search-input').focus();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const active = document.querySelector('.panel.active');
    if (active && active.id === 'panel-search') doSearch();
    if (active && active.id === 'panel-graph')  doGraphQuery();
    return;
  }
  if (e.key === 'Escape') { hideTooltip(); return; }

  if (!inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const panels = ['search','graph','symbol','stats','index','tools','sbom','health','benchmark'];
    const idx = parseInt(e.key) - 1;
    if (idx >= 0 && idx < panels.length) {
      switchPanel(panels[idx]);
      if (idx === 0) setTimeout(() => document.getElementById('search-input').focus(), 80);
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      switchPanel('search');
      document.getElementById('search-input').focus();
      return;
    }
  }
});

/* ── Delete modal ── */
let _deleteModalResolve = null;

function showDeleteModal(projectId, projectRoot) {
  const name = projectRoot
    ? projectRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop()
    : projectId;
  document.getElementById('delete-modal-title').textContent = '删除项目';
  document.getElementById('delete-modal-body').innerHTML =
    `确定要删除 <strong>${esc(name)}</strong> 的所有索引数据？<br>此操作不可撤销。`;
  const modal = document.getElementById('delete-modal');
  modal.style.display = 'flex';
  return new Promise(resolve => {
    _deleteModalResolve = resolve;
    document.getElementById('delete-modal-confirm').onclick = () => hideDeleteModal(true);
  });
}

function hideDeleteModal(confirmed = false) {
  document.getElementById('delete-modal').style.display = 'none';
  if (_deleteModalResolve) { _deleteModalResolve(confirmed); _deleteModalResolve = null; }
}

/* ── Tooltip ── */
function showTooltip(e, text) {
  const tip = document.getElementById('tooltip');
  tip.textContent = text;
  tip.style.display = 'block';
  tip.style.left = (e.clientX + 12) + 'px';
  tip.style.top  = (e.clientY - 8) + 'px';
}
function hideTooltip() { document.getElementById('tooltip').style.display = 'none'; }

/* ── Stats drill-down ── */
function drillToKind(kind) {
  const chip = document.querySelector(`.filter-chip[data-group="kind"][data-val="${kind}"]`);
  if (chip) toggleChip(chip, 'kind');
  switchPanel('search');
}

/* ── Re-apply lang after HTMX swaps ── */
document.body.addEventListener('htmx:afterSettle', () => applyLang());

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
  // Apply saved lang
  document.documentElement.lang = currentLang;
  applyLang();

  // Restore index root
  const savedRoot = localStorage.getItem('repograph_index_root');
  if (savedRoot) {
    const el = document.getElementById('index-root');
    if (el) el.value = savedRoot;
  }

  state.activeProjectId = localStorage.getItem('repograph_active_project') || '';

  initGraphCanvas();
  refreshProjectsList();

  // Status bar clock
  const sbClock = document.getElementById('sb-clock');
  if (sbClock) {
    const tick = () => { sbClock.textContent = new Date().toTimeString().slice(0, 8); };
    tick();
    setInterval(tick, 1000);
  }

  // Honor #stats=<pid> deep links
  (async () => {
    const m = /^#stats=([^&]+)$/.exec(location.hash || '');
    if (!m) return;
    const pid = decodeURIComponent(m[1]);
    await switchPanel('stats');
    const matchedProject = (state.projects || []).find(p => p.projectId === pid);
    const input = document.getElementById('stats-project-input');
    if (input) input.value = matchedProject ? projectName(matchedProject) : pid;
    loadProjectStats();
  })();
});

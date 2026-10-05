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

async function copyToClipboard(text) {
  if (!navigator.clipboard?.writeText) throw new Error(t('toast.copyFailed'));
  await navigator.clipboard.writeText(text);
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
let _toastFrame = null;
function showToast(msg, ms = 3200, tone = 'info') {
  const el = document.getElementById('toast');
  cancelAnimationFrame(_toastFrame);
  el.textContent = '';
  el.dataset.tone = tone;
  el.classList.add('show');
  _toastFrame = requestAnimationFrame(() => { el.textContent = msg; });
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ── API ── */
const api = {
  semantic: (q, lang, kind, limit, offset = 0) => {
    const p = new URLSearchParams({ q, limit, offset });
    if (lang) p.set('lang', lang);
    if (kind) p.set('kind', kind);
    return fetch(`/api/v1/search/semantic?${p}`).then(async response => {
      if (!response.ok) throw new Error(await apiError(response));
      return response.json();
    });
  },
  code: (snippet, lang, limit, offset = 0) => {
    const p = new URLSearchParams({ snippet, limit, offset });
    if (lang) p.set('lang', lang);
    return fetch(`/api/v1/search/code?${p}`).then(async response => {
      if (!response.ok) throw new Error(await apiError(response));
      return response.json();
    });
  },
  graphQuery: (path, target, depth, projectId) => {
    const p = new URLSearchParams({ target });
    if (depth != null) p.set('depth', depth);
    if (projectId) p.set('projectId', projectId);
    return fetch(`/api/v1/graph/${path}?${p}`).then(apiJsonResponse);
  },
  callers: (target, depth, projectId) => api.graphQuery('callers', target, depth, projectId),
  callees: (target, depth, projectId) => api.graphQuery('callees', target, depth, projectId),
  impact: (target, projectId) => api.graphQuery('impact', target, null, projectId),
  subtypes: (target, projectId) => api.graphQuery('subtypes', target, null, projectId),
  graphSymbols: (query, projectId) => {
    const p = new URLSearchParams({ q: query, limit: 10 });
    if (projectId) p.set('projectId', projectId);
    return fetch(`/api/v1/graph/symbols?${p}`).then(apiJsonResponse);
  },
  flowAnalyze: (target, projectId) => {
    const p = new URLSearchParams({ target });
    if (projectId) p.set('projectId', projectId);
    return fetch(`/api/v1/flow/analyze?${p}`).then(apiJsonResponse);
  },
  deadCode: (projectId) =>
    fetch(`/api/v1/graph/deadcode?projectId=${encodeURIComponent(projectId)}`).then(apiJsonResponse),
  testGaps: (projectId) =>
    fetch(`/api/v1/graph/testgaps?projectId=${encodeURIComponent(projectId)}`).then(apiJsonResponse),
  entrypoints: (projectId, lang) => {
    const p = new URLSearchParams();
    if (projectId) p.set('projectId', projectId);
    if (lang) p.set('lang', lang);
    const qs = p.toString();
    return fetch(`/api/v1/graph/entrypoints${qs ? '?' + qs : ''}`).then(apiJsonResponse);
  },
  projects: () => fetch('/api/v1/projects').then(apiJsonResponse),
  projectStats: (projectId) =>
    fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/stats`).then(apiJsonResponse),
  deleteProject: async (projectId, projectRoot) => {
    const params = new URLSearchParams({ projectId });
    if (projectRoot) params.set('projectRoot', projectRoot);
    const response = await fetch(`/api/v1/index/project?${params}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(await apiError(response));
    // A project list requested before this deletion must not restore the removed project.
    projectsRequestVersion++;
    if (typeof resetDeletedSbomProject === 'function') resetDeletedSbomProject(projectId, projectRoot);
    return response.json();
  },
  symbol: (qn, projectId) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    const query = params.toString();
    return fetch(`/api/v1/symbol/${encodeURIComponent(qn)}${query ? '?' + query : ''}`).then(apiJsonResponse);
  },
  locate: (file, line, projectId) => {
    const params = new URLSearchParams({ file, line });
    if (projectId) params.set('projectId', projectId);
    return fetch(`/api/v1/locate?${params}`).then(apiJsonResponse);
  },
  frameworks: (projectId) => fetch(`/api/v1/frameworks/${encodeURIComponent(projectId)}`).then(apiJsonResponse),
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
  indexStatus: (root) => fetch(`/api/v1/index/project/status?projectRoot=${encodeURIComponent(root)}`).then(apiJsonResponse),
  triggerIndex: (root, lang, strategy, noIncremental) => {
    const p = new URLSearchParams({ projectRoot: root, strategy });
    if (lang) p.set('lang', lang);
    p.set('noIncremental', noIncremental);
    return fetch(`/api/v1/index/project?${p}`, { method: 'POST' }).then(apiJsonResponse);
  },
  watchList: () => fetch('/api/v1/watch').then(r => r.json()),
  watchStatus: (projectId) => fetch(`/api/v1/watch/${encodeURIComponent(projectId)}`).then(apiJsonResponse),
  watchStart: (projectId, root) => {
    const p = new URLSearchParams({ projectId, root });
    return fetch(`/api/v1/watch?${p}`, { method: 'POST' }).then(apiJsonResponse);
  },
  watchStop: async (projectId) => {
    const response = await fetch(`/api/v1/watch/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(await apiError(response));
    return response;
  },
  vulnScanCode: (projectId) =>
    fetch(`/api/v1/vulns/scan/code?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' }).then(apiJsonResponse),
  vulnScanTaint: (projectId) =>
    fetch(`/api/v1/vulns/scan/taint?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' }).then(apiJsonResponse),
  vulnScanDeps: (projectId, projectRoot) => {
    const p = new URLSearchParams({ projectId, projectRoot });
    return fetch(`/api/v1/vulns/scan/deps?${p}`, { method: 'POST' }).then(apiJsonResponse);
  },
  vulnList: (projectId, severity, status) => {
    const p = new URLSearchParams({ projectId });
    if (severity) p.set('severity', severity);
    if (status) p.set('status', status);
    return fetch(`/api/v1/vulns?${p}`).then(apiJsonResponse);
  },
  vulnUpdateStatus: (id, status) =>
    fetch(`/api/v1/vulns/${encodeURIComponent(id)}/status?status=${encodeURIComponent(status)}`,
          { method: 'PUT' }).then(apiJsonResponse),
  vulnTaintEvidence: (id) =>
    fetch(`/api/v1/vulns/${encodeURIComponent(id)}/taint-evidence`).then(async response => {
      if (!response.ok) throw new Error(`Taint evidence request failed: HTTP ${response.status}`);
      return response.json();
    }),
  vulnReport: (projectId) =>
    fetch(`/api/v1/vulns/report/${encodeURIComponent(projectId)}`).then(apiJsonResponse),
  complexity: (projectId, limit = 20) => {
    const p = new URLSearchParams({ projectId, limit });
    return fetch(`/api/v1/metrics/complexity?${p}`).then(apiJsonResponse);
  },
  coupling: (projectId, sort = 'fanout', limit = 20) => {
    const p = new URLSearchParams({ projectId, sort, limit });
    return fetch(`/api/v1/metrics/coupling?${p}`).then(apiJsonResponse);
  },
  packageCycles: (projectId) =>
    fetch(`/api/v1/metrics/cycles?projectId=${encodeURIComponent(projectId)}`).then(apiJsonResponse),
  healthReport: (projectId) =>
    fetch(`/api/v1/metrics/report?projectId=${encodeURIComponent(projectId)}`).then(apiJsonResponse),
  hotspots: (projectId, limit = 10) => {
    const p = new URLSearchParams({ projectId, limit });
    return fetch(`/api/v1/metrics/hotspots?${p}`).then(apiJsonResponse);
  },
  architectureReview: async (projectId) => {
    const p = new URLSearchParams({ projectId });
    const response = await fetch(`/api/v1/architecture/reviews?${p}`, { method: 'POST' });
    if (!response.ok) throw new Error(await apiError(response));
    return response.json();
  },
  exportGraph: (projectId, format = 'mermaid') => {
    const p = new URLSearchParams({ projectId, format });
    return fetch(`/api/v1/export/graph?${p}`).then(r => r.text());
  },
  exportGraphUrl: (projectId, format) =>
    `/api/v1/export/graph?projectId=${encodeURIComponent(projectId)}&format=${encodeURIComponent(format)}`,
  agentStartSastTriage: async (
      projectId, format, json, codeVersion, ruleVersion, budgetChars = 12000, maxFindings = 10) => {
    const p = new URLSearchParams({ projectId, format });
    if (codeVersion) p.set('codeVersion', codeVersion);
    if (ruleVersion) p.set('ruleVersion', ruleVersion);
    p.set('budgetChars', budgetChars);
    p.set('maxFindings', maxFindings);
    const response = await fetch(`/api/v1/agent-runs/sast-triage?${p}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json,
    });
    if (!response.ok) throw new Error(await apiError(response));
    return response.json();
  },
  agentStartVulnerabilityTriage: async (
      vulnerabilityId, codeVersion, ruleVersion, budgetChars = 12000) => {
    const p = new URLSearchParams({ vulnerabilityId, budgetChars });
    if (codeVersion) p.set('codeVersion', codeVersion);
    if (ruleVersion) p.set('ruleVersion', ruleVersion);
    const response = await fetch(`/api/v1/agent-runs/vulnerability-triage?${p}`, { method: 'POST' });
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
  llmSettings: async () => {
    const response = await fetch('/api/v1/agent-settings/llm');
    if (!response.ok) throw new Error(await apiError(response));
    return response.json();
  },
  updateLlmSettings: async (settings) => {
    const response = await fetch('/api/v1/agent-settings/llm', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error(await apiError(response));
    return response.json();
  },
  testLlmSettings: async (settings) => {
    const response = await fetch('/api/v1/agent-settings/llm/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error(await apiError(response));
    return response.json();
  },
};

async function apiError(response) {
  const text = await response.text();
  try { const body = JSON.parse(text); return body.error || body.message || `HTTP ${response.status}`; }
  catch (_) { return text || `HTTP ${response.status}`; }
}

async function apiJsonResponse(response) {
  if (!response.ok) {
    const error = new Error(await apiError(response));
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/* ── Navigation ── */
function switchPanel(id) {
  return Alpine.store('repograph').showPanel(id);
}

async function focusGlobalSearch() {
  await switchPanel('search');
  await Alpine.nextTick();
  document.getElementById('search-input')?.focus();
}

function handlePanelSwitch(id) {
  if (id === 'agent') {
    initAgentWorkbench();
    refreshProjectsList().then(populateAgentProjectSelect)
      .then(() => Promise.all([loadAgentVulnerabilities(), loadAgentRuns()]));
    loadLlmSettings();
    return;
  }
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
  if (!input || Alpine.store('repograph').panel !== 'stats' || location.hash.startsWith('#stats=')) return;
  if (!input.value.trim()) {
    const project = projects?.find(item => item.projectId === state.activeProjectId)
      || (projects?.length === 1 ? projects[0] : null);
    if (!project) return;
    input.value = projectName(project);
  }
  loadProjectStats();
}

let projectsRequestVersion = 0;
async function refreshProjectsList() {
  const version = ++projectsRequestVersion;
  try {
    const projects = await api.projects();
    if (version !== projectsRequestVersion) return state.projects;
    if (!Array.isArray(projects)) throw new Error('Invalid project list');
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
  try { localStorage.setItem('repograph_active_project', state.activeProjectId); } catch (_) {}
  document.getElementById('global-project').value = state.activeProjectId;
  const project = (state.projects || []).find(p => p.projectId === state.activeProjectId);
  const value = project ? projectName(project) : '';
  ['graph-project','entrypoints-project','stats-project-input',
   'frameworks-project-input','sbom-project-input','sbom-view-input'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  });
  if (typeof invalidateToolsInputs === 'function') invalidateToolsInputs();
  if (typeof invalidateSbomView === 'function') invalidateSbomView();
  if (typeof invalidateSymbolQuery === 'function') invalidateSymbolQuery();
  const agentProject = document.getElementById('agent-project-select');
  if (agentProject && agentProject.value !== state.activeProjectId) {
    agentProject.value = state.activeProjectId;
    syncAgentProjectSelection();
  }
  const vulnProject = document.getElementById('vuln-project-select');
  if (vulnProject) {
    vulnProject.value = state.activeProjectId;
    onVulnProjectChange();
  }
  const metricsProject = document.getElementById('metrics-project-select');
  if (metricsProject) {
    metricsProject.value = state.activeProjectId;
    if (metricsProject.value !== _metricsPid) onMetricsProjectChange();
  }
  invalidateGraphQuery();
  const active = document.querySelector('.panel.active');
  if (active?.id === 'panel-stats') loadProjectStats();
  else if (typeof invalidateStatsInput === 'function') invalidateStatsInput();
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
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const val = t(el.dataset.i18nTitle);
    if (val) el.title = val;
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const val = t(el.dataset.i18nAriaLabel);
    if (val) el.setAttribute('aria-label', val);
  });
  document.querySelectorAll('select option[data-i18n]').forEach(el => {
    const val = t(el.dataset.i18n);
    if (val) el.textContent = val;
  });
  const hint = document.getElementById('graph-hint');
  if (hint && hint.dataset.i18n) hint.textContent = t(hint.dataset.i18n);
  const modeHint = document.getElementById('search-mode-hint');
  if (modeHint) modeHint.textContent = t(state.searchMode === 'semantic' ? 'hint.semantic' : 'hint.code');
  if (typeof renderSearchFilterSummary === 'function') renderSearchFilterSummary();
  if (typeof updateSearchResultCount === 'function') updateSearchResultCount();
  if (typeof refreshStatsLanguage === 'function') refreshStatsLanguage();
  if (typeof renderVulnSummary === 'function') renderVulnSummary();
  if (typeof refreshIndexLanguage === 'function') refreshIndexLanguage();
  if (typeof refreshToolsLanguage === 'function') refreshToolsLanguage();
  if (typeof refreshSbomLanguage === 'function') refreshSbomLanguage();
  if (typeof refreshSymbolLanguage === 'function') refreshSymbolLanguage();
  if (typeof refreshMetricsLanguage === 'function') refreshMetricsLanguage();
  if (typeof refreshBenchmarkLanguage === 'function') refreshBenchmarkLanguage();
  renderServiceHealth();
  if (typeof renderAgentProjectHint === 'function') renderAgentProjectHint();
  if (typeof renderAgentVulnerabilities === 'function') renderAgentVulnerabilities();
  if (typeof renderAgentRunList === 'function') renderAgentRunList();
  if (typeof rerenderAgentCurrentRun === 'function') rerenderAgentCurrentRun();
  if (typeof refreshExternalInputStatus === 'function' && agentUi?.inputMode === 'external') {
    refreshExternalInputStatus();
  } else if (typeof updateAgentLaunchState === 'function') {
    updateAgentLaunchState();
  }
}

function onLangChange(lang) {
  currentLang = lang;
  localStorage.setItem('repograph_lang', lang);
  document.documentElement.lang = lang;
  applyLang();
  refreshProjectsList();
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
  if (_deleteModalResolve) {
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      hideDeleteModal();
    } else if (e.key === 'Tab') {
      const modal = document.getElementById('delete-modal');
      const buttons = [...modal.querySelectorAll('button:not([disabled])')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement))) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement))) {
        e.preventDefault();
        first?.focus();
      }
    }
    return;
  }
  if (document.querySelector('dialog[open]') || e.defaultPrevented || e.isComposing) return;
  const activeElement = document.activeElement;
  const inInput = ['INPUT','TEXTAREA','SELECT'].includes(activeElement?.tagName)
    || activeElement?.isContentEditable;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    focusGlobalSearch();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const active = document.querySelector('.panel.active');
    if (active?.id === 'panel-search' || active?.id === 'panel-graph') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) active.id === 'panel-search' ? doSearch() : doGraphQuery();
    }
    return;
  }
  if (e.key === 'Escape') {
    hideTooltip();
    const store = Alpine.store('repograph');
    if (store.navOpen) {
      store.navOpen = false;
      document.getElementById('nav-toggle')?.focus();
    }
    return;
  }

  if (!inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const panels = ['agent','search','graph','symbol','stats','index','tools','sbom','vulns','metrics'];
    const idx = e.key === '0' ? 9 : parseInt(e.key) - 1;
    if (idx >= 0 && idx < panels.length) {
      e.preventDefault();
      if (panels[idx] === 'search') focusGlobalSearch();
      else switchPanel(panels[idx]);
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      focusGlobalSearch();
      return;
    }
  }
}, true);

/* ── Delete modal ── */
let _deleteModalResolve = null;
let _deleteModalPreviousFocus = null;
let _deleteModalInert = [];

function showDeleteModal(projectId, projectRoot) {
  if (_deleteModalResolve) hideDeleteModal();
  _deleteModalPreviousFocus = document.activeElement;
  const name = projectRoot
    ? projectRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop()
    : projectId;
  document.getElementById('delete-modal-title').textContent = t('delete.title');
  document.getElementById('delete-modal-body').innerHTML =
    `${esc(t('delete.message', name))}<br>${esc(t('delete.irreversible'))}`;
  const modal = document.getElementById('delete-modal');
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  _deleteModalInert = [...document.querySelectorAll('body > header, body > .layout, body > .statusbar, body > .skip-link')]
    .map(el => ({ el, inert: el.inert }));
  _deleteModalInert.forEach(({ el }) => { el.inert = true; });
  return new Promise(resolve => {
    _deleteModalResolve = resolve;
    document.getElementById('delete-modal-confirm').onclick = () => hideDeleteModal(true);
    document.getElementById('delete-modal-cancel').focus();
  });
}

function hideDeleteModal(confirmed = false) {
  const modal = document.getElementById('delete-modal');
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  if (!_deleteModalResolve) return;
  const resolve = _deleteModalResolve;
  _deleteModalResolve = null;
  _deleteModalInert.forEach(({ el, inert }) => { el.inert = inert; });
  _deleteModalInert = [];
  const previous = _deleteModalPreviousFocus;
  _deleteModalPreviousFocus = null;
  if (previous?.isConnected && !previous.disabled && previous.getClientRects().length) previous.focus();
  else document.getElementById('main-content')?.focus();
  resolve(confirmed);
}

document.addEventListener('focusin', e => {
  if (_deleteModalResolve && !document.getElementById('delete-modal').contains(e.target)) {
    document.getElementById('delete-modal-cancel').focus();
  }
});

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
async function drillToKind(kind) {
  const chip = document.querySelector(`.filter-chip[data-group="kind"][data-val="${kind}"]`);
  if (!chip) return;
  // Both search APIs span all indexed projects. Only preset their supported kind filter.
  await switchPanel('search');
  if (state.searchMode !== 'semantic') {
    state.filters.kind = kind;
    document.querySelectorAll('.filter-chip[data-group="kind"]').forEach(item => {
      const active = item === chip;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    setSearchMode('semantic', document.querySelector('#search-tab-row [data-i18n="tab.semantic"]'));
  } else {
    toggleChip(chip, 'kind');
  }
  document.getElementById('search-filter-disclosure').open = true;
  document.getElementById('search-input').focus();
}

/* ── Service health (one HTMX poll, validated before replacing the view) ── */
let _serviceHealth = 'checking';
const HEALTH_SERVICES = ['qdrant', 'ollama', 'neo4j'];
const serviceHealthView = {
  busy: false, request: null, receivedAt: '', errorKey: '',
  states: { qdrant: 'checking', ollama: 'checking', neo4j: 'checking' },
};
const healthResponses = new WeakMap();
const invalidHealthResponses = new WeakSet();

function renderServiceHealth() {
  const status = document.getElementById('sb-health');
  if (status) {
    status.dataset.state = _serviceHealth;
    status.dataset.i18n = `shell.status.${_serviceHealth}`;
    status.textContent = t(status.dataset.i18n);
  }
  HEALTH_SERVICES.forEach(service => {
    const health = serviceHealthView.states[service];
    const label = t(`shell.service.${health}`);
    const name = service === 'qdrant' ? 'Qdrant' : service === 'neo4j' ? 'Neo4j' : 'Ollama';
    const badge = document.getElementById(`hb-${service}`);
    if (badge) {
      badge.dataset.health = health;
      const stateLabel = badge.querySelector('.badge-state');
      if (stateLabel) stateLabel.textContent = label;
      badge.setAttribute('aria-label', `${name}: ${label}`);
      badge.title = `${name}: ${label}`;
    }
    const dot = document.getElementById(`hd-${service}`);
    if (dot) dot.className = `badge-dot ${health === 'offline' ? 'checking' : health}`;
    const card = document.querySelector(`#health-grid [data-service="${service}"]`)
      || document.querySelectorAll('#health-grid .health-card')[HEALTH_SERVICES.indexOf(service)];
    if (card) {
      card.classList.remove('h-ok', 'h-err', 'h-unknown');
      card.classList.add(health === 'ok' ? 'h-ok' : health === 'error' ? 'h-err' : 'h-unknown');
      card.dataset.state = health;
      const stateLabel = card.querySelector('.health-status');
      if (stateLabel) stateLabel.textContent = label;
    }
  });
  const summary = document.getElementById('health-summary');
  if (!summary) return;
  summary.dataset.state = _serviceHealth;
  const setText = (id, text) => {
    const element = document.getElementById(id);
    if (element && element.textContent !== text) element.textContent = text;
  };
  setText('health-summary-title', t(`health.state.${_serviceHealth}`));
  setText('health-summary-note', t(`health.note.${_serviceHealth}`));
  const button = document.getElementById('health-refresh');
  button.disabled = serviceHealthView.busy;
  button.dataset.i18n = serviceHealthView.busy ? 'health.checking' : 'health.refresh';
  button.textContent = t(button.dataset.i18n);
  setText('health-check-progress', serviceHealthView.busy ? t('health.checkingHint') : '');
  const grid = document.getElementById('health-grid');
  grid.setAttribute('aria-busy', String(serviceHealthView.busy));
  const time = document.getElementById('health-last-checked');
  if (serviceHealthView.receivedAt) {
    delete time.dataset.i18n;
    time.dateTime = serviceHealthView.receivedAt;
    time.textContent = new Date(serviceHealthView.receivedAt).toLocaleString(currentLang === 'zh' ? 'zh-CN' : 'en-US', { hour12: false });
  } else {
    time.removeAttribute('datetime');
    time.textContent = t('health.never');
  }
  const error = document.getElementById('health-check-error');
  error.hidden = !serviceHealthView.errorKey;
  setText('health-check-error', serviceHealthView.errorKey ? t(serviceHealthView.errorKey) : '');
}

function refreshHealthStatus() {
  if (serviceHealthView.busy) return;
  htmx.trigger(document.getElementById('health-grid'), 'health-refresh');
}

function isHealthRequest(event) {
  return event.detail?.elt?.id === 'health-grid' || event.detail?.target?.id === 'health-grid';
}

function markHealthUnavailable(errorKey) {
  _serviceHealth = 'offline';
  serviceHealthView.errorKey = errorKey;
  HEALTH_SERVICES.forEach(service => { serviceHealthView.states[service] = 'offline'; });
  const grid = document.getElementById('health-grid');
  if (grid && !grid.querySelector('.health-card')) {
    grid.innerHTML = `<div class="health-unavailable" data-i18n="health.noSnapshot">${esc(t('health.noSnapshot'))}</div>`;
  }
}

document.body.addEventListener('htmx:beforeRequest', event => {
  if (!isHealthRequest(event)) return;
  if (serviceHealthView.busy) { event.preventDefault(); return; }
  serviceHealthView.busy = true;
  serviceHealthView.request = event.detail.xhr;
  renderServiceHealth();
});

document.body.addEventListener('htmx:beforeSwap', event => {
  if (!isHealthRequest(event) || !event.detail.shouldSwap) return;
  const xhr = event.detail.xhr;
  const fragment = new DOMParser().parseFromString(xhr.responseText, 'text/html');
  const states = {};
  const valid = fragment.querySelectorAll('.health-card').length === HEALTH_SERVICES.length
    && HEALTH_SERVICES.every(service => {
      const badges = fragment.querySelectorAll(`[id="hb-${service}"]`);
      const health = badges[0]?.dataset.health;
      if (badges.length !== 1 || !['ok', 'error', 'checking'].includes(health)) return false;
      states[service] = health;
      return true;
    });
  if (!valid) {
    invalidHealthResponses.add(xhr);
    event.detail.shouldSwap = false;
    event.detail.isError = true;
    return;
  }
  healthResponses.set(xhr, states);
});

document.body.addEventListener('htmx:afterSwap', event => {
  if (!isHealthRequest(event)) return;
  const states = healthResponses.get(event.detail.xhr);
  if (!states) return;
  serviceHealthView.states = states;
  serviceHealthView.receivedAt = new Date().toISOString();
  serviceHealthView.errorKey = '';
  _serviceHealth = HEALTH_SERVICES.every(service => states[service] === 'ok') ? 'ok'
    : HEALTH_SERVICES.some(service => states[service] === 'error') ? 'degraded' : 'checking';
  renderServiceHealth();
});

document.body.addEventListener('htmx:afterRequest', event => {
  if (!isHealthRequest(event) || event.detail.xhr !== serviceHealthView.request) return;
  serviceHealthView.busy = false;
  serviceHealthView.request = null;
  if (invalidHealthResponses.has(event.detail.xhr)) markHealthUnavailable('health.invalidResponse');
  else if (event.detail.failed || event.detail.xhr?.status === 0) markHealthUnavailable('health.requestFailed');
  renderServiceHealth();
});

/* ── Re-apply lang after HTMX swaps ── */
document.body.addEventListener('htmx:afterSettle', () => applyLang());

/* ── Init ── */
document.addEventListener('DOMContentLoaded', async () => {
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

  await Alpine.store('repograph').restorePanel();
});

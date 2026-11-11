/* RepoGraph Agent Workbench — public execution state only, never model chain-of-thought. */
const agentUi = {
  runs: [],
  selectedId: '',
  polling: null,
  llmSettings: null,
  llmConnection: null,
  inputMode: 'vuln',
  vulnerabilities: [],
  selectedVulnerabilityId: '',
  currentRun: null,
  runListSignature: '',
  runDetailSignature: '',
  runsRequestVersion: 0,
  detailRequestVersion: 0,
  runLoadError: '',
  vulnRequestVersion: 0,
  preparationProjectId: null,
  preparationDrafts: new Map(),
  fileReadVersion: 0,
  pollingBusy: false,
  expandedDetails: new Set(),
  taintEvidence: new Map(),
  taintEvidenceLoading: new Set(),
  expandedTaintSteps: new Set(),
};

function initAgentWorkbench() {
  const panel = document.getElementById('panel-agent');
  if (!panel || panel.dataset.initialized) return;
  panel.dataset.initialized = 'true';
  panel.addEventListener('keydown', event => {
    if (event.isComposing || event.target.closest('dialog')) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!document.getElementById('agent-run-btn').disabled) startSastTriageAgent();
    }
  });
  setAgentInputMode(agentUi.inputMode);
}

function agentCapabilityLabel(capability) {
  const key = 'agent.step.' + capability;
  const label = t(key);
  return label === key ? capability.replaceAll('_', ' ') : label;
}

function openAgentCapability(capability) {
  if (capability === 'architecture') {
    switchPanel('metrics');
    return;
  }
  if (capability === 'remediation') {
    switchPanel('vulns');
    return;
  }
  showAgentPreparation();
}

function focusAgentWorkflow(element) {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  });
}

function showAgentPreparation() {
  if (Alpine.store('repograph').panel !== 'agent') return;
  const preparation = document.getElementById('agent-preparation');
  if (preparation) preparation.open = true;
  focusAgentWorkflow(document.getElementById('agent-preparation-toggle'));
}

function renderAgentCurrentTask() {
  const element = document.getElementById('agent-current-task');
  if (!element) return;
  const run = agentUi.currentRun?.id === agentUi.selectedId ? agentUi.currentRun
    : agentUi.runs.find(item => item.id === agentUi.selectedId);
  element.dataset.status = run?.status || 'PREPARING';
  const taskKey = run?.playbook === 'WIKI_SUMMARY' ? 'agent.taskWiki'
    : run?.playbook === 'SAST_TRIAGE' ? (run.inputReference?.startsWith('vulnerability:') ? 'agent.taskVulnerability' : 'agent.taskSast') : '';
  document.getElementById('agent-current-heading').textContent = run
    ? (taskKey ? t(taskKey) : run.playbook || t('agent.currentTask')) : t('agent.launch');
  document.getElementById('agent-current-status').textContent = run ? agentStatus(run.status).label : t('agent.completeRequired');
  const project = state.projects.find(project => project.projectId === (run?.projectId || state.activeProjectId));
  document.getElementById('agent-current-context').textContent = [project ? projectName(project) : '', run?.id || ''].filter(Boolean).join(' · ');
  const activeStep = run?.steps?.find(step => step.status === 'RUNNING');
  const note = run?.statusReason
    || (activeStep ? `${agentCapabilityLabel(activeStep.capability)} · ${activeStep.summary || ''}`
      : t(run ? `agent.current.${run.status}` : 'agent.current.PREPARING'));
  document.getElementById('agent-current-note').textContent = agentUi.runLoadError
    ? `${t('agent.runStateStale')} ${agentUi.runLoadError}` : note;
  document.getElementById('agent-current-action').textContent = t(!run ? 'agent.launch'
    : (run.outputReference || '').startsWith('report-snapshot:') ? 'agent.readReviewReport' : 'agent.viewRuns');
  document.getElementById('agent-current-action').disabled = !!run && agentUi.currentRun?.id !== run.id;
}

function openCurrentAgentTask() {
  if (agentUi.selectedId && agentUi.currentRun?.id !== agentUi.selectedId) return;
  if (!agentUi.currentRun) return showAgentPreparation();
  if ((agentUi.currentRun.outputReference || '').startsWith('report-snapshot:')) return openAgentReview();
  showAgentRuns();
  const output = document.getElementById('agent-output-slot');
  if ((agentUi.currentRun.outputReference || '').startsWith('report-snapshot:') && output) {
    focusAgentWorkflow(output);
  }
}

function showAgentRuns() {
  if (Alpine.store('repograph').panel !== 'agent') return;
  const preparation = document.getElementById('agent-preparation');
  if (preparation) preparation.open = false;
  focusAgentWorkflow(document.getElementById(agentUi.selectedId ? 'agent-timeline-heading' : 'agent-run-workspace'));
}

function renderAgentPreparationSummary() {
  const summary = document.getElementById('agent-preparation-context');
  if (!summary) return;
  const projectId = document.getElementById('agent-project-select')?.value;
  const project = (state.projects || []).find(item => item.projectId === projectId);
  const vulnerability = agentUi.vulnerabilities.find(item => item.id === agentUi.selectedVulnerabilityId);
  const input = agentUi.inputMode === 'external' ? t('agent.modeExternal')
    : vulnerability?.title || t('agent.readyVulnerability');
  summary.textContent = project ? `${projectName(project)} · ${input}` : t('agent.completeRequired');
  summary.title = summary.textContent;
}

const AGENT_DRAFT_FIELDS = {
  'agent-findings-json': '', 'agent-code-version': '', 'agent-rule-version': '', 'agent-format': 'semgrep',
  'agent-budget-chars': '12000', 'agent-max-findings': '10', 'agent-vulnerability-filter': 'active',
  'agent-vulnerability-search': ''
};

function restoreAgentPreparation(projectId) {
  if (agentUi.preparationProjectId === projectId) return;
  if (agentUi.preparationProjectId === null) { agentUi.preparationProjectId = projectId; return; }
  agentUi.fileReadVersion++;
  agentUi.preparationDrafts.set(agentUi.preparationProjectId, {
    fields: Object.fromEntries(Object.keys(AGENT_DRAFT_FIELDS).map(id => [id, document.getElementById(id).value])),
    mode: agentUi.inputMode, vulnerabilityId: agentUi.selectedVulnerabilityId,
    advanced: document.querySelector('.agent-advanced-options').open,
    filename: document.getElementById('agent-file-name').dataset.filename || ''
  });
  agentUi.preparationProjectId = projectId;
  const draft = agentUi.preparationDrafts.get(projectId);
  for (const [id, fallback] of Object.entries(AGENT_DRAFT_FIELDS)) document.getElementById(id).value = draft?.fields[id] ?? fallback;
  agentUi.selectedVulnerabilityId = draft?.vulnerabilityId || '';
  document.querySelector('.agent-advanced-options').open = draft?.advanced || false;
  const filename = document.getElementById('agent-file-name');
  filename.dataset.filename = draft?.filename || '';
  filename.textContent = draft?.filename || t('agent.fileEmpty');
  if (draft?.filename) delete filename.dataset.i18n;
  else filename.dataset.i18n = 'agent.fileEmpty';
  setAgentInputMode(draft?.mode || 'vuln');
}

/* ── Input mode: vulnerability center picker vs external SAST findings ── */
function setAgentInputMode(mode) {
  const next = mode === 'external' ? 'external' : 'vuln';
  agentUi.inputMode = next;
  const isExternal = next === 'external';
  document.getElementById('agent-mode-vuln')?.toggleAttribute('hidden', isExternal);
  document.getElementById('agent-mode-external')?.toggleAttribute('hidden', !isExternal);
  document.getElementById('agent-scope-field')?.toggleAttribute('hidden', isExternal);
  document.getElementById('agent-format-field')?.toggleAttribute('hidden', !isExternal);
  document.getElementById('agent-maxfindings-field')?.toggleAttribute('hidden', !isExternal);
  for (const [id, active] of [['agent-mode-vuln-btn', !isExternal], ['agent-mode-external-btn', isExternal]]) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  showAgentError('');
  if (isExternal) refreshExternalInputStatus();
  updateAgentLaunchState();
}

function readAgentFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const version = ++agentUi.fileReadVersion;
  const projectId = agentUi.preparationProjectId;
  const reader = new FileReader();
  reader.onload = () => {
    if (version !== agentUi.fileReadVersion || projectId !== agentUi.preparationProjectId) return;
    document.getElementById('agent-findings-json').value = String(reader.result || '');
    const filename = document.getElementById('agent-file-name');
    filename.textContent = `${file.name} · ${file.size} B`;
    filename.dataset.filename = filename.textContent;
    delete filename.dataset.i18n;
    refreshExternalInputStatus();
  };
  reader.onerror = () => {
    if (version === agentUi.fileReadVersion && projectId === agentUi.preparationProjectId) showAgentError(t('agent.fileError'));
  };
  reader.readAsText(file);
  input.value = '';
}

function clearAgentFindingsInput() {
  agentUi.fileReadVersion++;
  const textarea = document.getElementById('agent-findings-json');
  if (textarea) textarea.value = '';
  const name = document.getElementById('agent-file-name');
  if (name) { name.textContent = t('agent.fileEmpty'); name.dataset.i18n = 'agent.fileEmpty'; delete name.dataset.filename; }
  showAgentError('');
  refreshExternalInputStatus();
}

function onAgentFindingsInput() {
  agentUi.fileReadVersion++;
  refreshExternalInputStatus();
}

/* Parse the pasted/loaded findings blob and count entries for the chosen format. */
function parseAgentFindingsInput() {
  const raw = document.getElementById('agent-findings-json')?.value.trim() || '';
  const format = document.getElementById('agent-format')?.value || 'semgrep';
  if (!raw) return { state: 'empty', format, total: 0 };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return { state: 'invalid', format, total: 0 };
  }
  const total = format === 'sarif'
    ? (parsed?.runs || []).reduce((sum, run) => sum + (run?.results?.length || 0), 0)
    : (parsed?.results?.length || 0);
  return { state: total > 0 ? 'ready' : 'unrecognized', format, total, raw };
}

function refreshExternalInputStatus() {
  const badge = document.getElementById('agent-input-status');
  if (badge) {
    const result = parseAgentFindingsInput();
    const maxFindings = Number(document.getElementById('agent-max-findings')?.value) || 10;
    badge.classList.toggle('ready', result.state === 'ready');
    badge.classList.toggle('error', result.state === 'invalid');
    if (result.state === 'ready') {
      badge.textContent = t('agent.inputReady',
        result.format.toUpperCase(), result.total, Math.min(result.total, maxFindings));
    } else if (result.state === 'invalid') {
      badge.textContent = t('agent.invalidJson');
    } else if (result.state === 'unrecognized') {
      badge.textContent = t('agent.unrecognizedInput');
    } else {
      badge.textContent = t('agent.awaitingInput');
    }
  }
  updateAgentLaunchState();
}

function rememberAgentDetail(element) {
  const stepId = element.closest('.agent-step')?.dataset.stepId;
  const kind = element.dataset.detailKind;
  if (!stepId || !kind) return;
  const key = `${stepId}:${kind}`;
  if (element.open) agentUi.expandedDetails.add(key);
  else agentUi.expandedDetails.delete(key);
}

function restoreAgentTextSize() {
  let saved = '';
  try { saved = localStorage.getItem('repograph_agent_text_size'); } catch (_) {}
  applyAgentTextSize(saved === 'large' ? 'large' : 'standard');
}

function setAgentTextSize(size) {
  const normalized = size === 'large' ? 'large' : 'standard';
  try { localStorage.setItem('repograph_agent_text_size', normalized); } catch (_) {}
  applyAgentTextSize(normalized);
}

function applyAgentTextSize(size) {
  document.querySelectorAll('[data-agent-text-size]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.agentTextSize === size));
  });
  const panel = document.getElementById('panel-agent');
  if (!panel) return;
  panel.dataset.textSize = size;
  const standard = document.getElementById('agent-text-standard');
  const large = document.getElementById('agent-text-large');
  standard?.classList.toggle('active', size === 'standard');
  large?.classList.toggle('active', size === 'large');
  standard?.setAttribute('aria-pressed', String(size === 'standard'));
  large?.setAttribute('aria-pressed', String(size === 'large'));
}

async function loadLlmSettings() {
  if (typeof sessionReady !== 'undefined') await sessionReady;
  if (typeof sessionAccount !== 'undefined' && sessionAccount?.role !== 'ADMIN') return;
  const stateElement = document.getElementById('agent-llm-state');
  if (!stateElement) return;
  setLlmState('loading', t('agent.llm.loading'), '—');
  try {
    const settings = await api.llmSettings();
    agentUi.llmSettings = settings;
    agentUi.llmConnection = null;
    document.getElementById('agent-llm-provider').value = settings.provider;
    document.getElementById('agent-llm-enabled').checked = settings.enabled;
    document.getElementById('agent-llm-base-url').value = settings.baseUrl;
    document.getElementById('agent-llm-model').value = settings.model;
    renderSavedLlmState();
  } catch (error) {
    setLlmState('error', t('agent.llm.error'), error.message);
  }
}

function toggleLlmSettings() {
  const module = document.getElementById('agent-llm-module');
  const open = module.classList.toggle('open');
  module.querySelector('.agent-llm-header').setAttribute('aria-expanded', String(open));
  document.getElementById('agent-llm-chevron').textContent = open ? '−' : '＋';
}

function renderSavedLlmState() {
  const settings = agentUi.llmSettings;
  if (!settings?.enabled) {
    setLlmState('disabled', t('agent.llm.disabled'), t('agent.llm.heuristicOnly'));
    return;
  }
  setLlmState('unverified', t('capability.state.unverified'), `${settings.provider} / ${settings.model}`);
}

function setLlmState(tone, title, detail) {
  const element = document.getElementById('agent-llm-state');
  if (!element) return;
  element.className = `agent-llm-state ${tone}`;
  element.innerHTML = `<i></i><b>${esc(title)}</b><small>${esc(detail)}</small>`;
}

function showLlmMessage(message, tone) {
  const element = document.getElementById('agent-llm-message');
  if (!element) return;
  element.className = `agent-llm-message ${tone || ''}`;
  element.textContent = message || '';
}

function populateAgentProjectSelect(projects = state.projects) {
  const select = document.getElementById('agent-project-select');
  if (!select) return;
  const previous = state.activeProjectId;
  const emptyLabel = projects?.length ? t('ph.selectProject') : t('agent.noIndexedProjects');
  select.innerHTML = `<option value="">${esc(emptyLabel)}</option>`
    + (projects || []).map(project =>
      `<option value="${esc(project.projectId)}">${esc(projectName(project))} · ${project.nodeCount}</option>`
    ).join('');
  if ((projects || []).some(project => project.projectId === previous)) select.value = previous;
  restoreAgentPreparation(select.value);
  renderAgentProjectHint();
  updateAgentLaunchState();
}

async function loadAgentVulnerabilities() {
  const requestVersion = ++agentUi.vulnRequestVersion;
  const projectId = document.getElementById('agent-project-select')?.value || '';
  const list = document.getElementById('agent-vulnerability-list');
  const count = document.getElementById('agent-vulnerability-count');
  if (!list) return;
  if (!projectId) {
    agentUi.vulnerabilities = [];
    agentUi.selectedVulnerabilityId = '';
    if (count) count.textContent = '—';
    list.innerHTML = `<div class="agent-empty">${esc(t('agent.selectProjectForVulnerabilities'))}</div>`;
    renderAgentVulnerabilityDetail();
    updateAgentLaunchState();
    return;
  }
  list.innerHTML = `<div class="agent-empty agent-loading">${esc(t('agent.loadingVulnerabilities'))}</div>`;
  try {
    agentUi.taintEvidence.clear();
    agentUi.taintEvidenceLoading.clear();
    const vulnerabilities = await api.vulnList(projectId, '', '');
    if (requestVersion !== agentUi.vulnRequestVersion || document.getElementById('agent-project-select').value !== projectId) return;
    if (!Array.isArray(vulnerabilities) || vulnerabilities.some(item => item.projectId !== projectId)) throw new Error(t('agent.invalidRuns'));
    agentUi.vulnerabilities = vulnerabilities;
    if (!agentUi.vulnerabilities.some(item => item.id === agentUi.selectedVulnerabilityId)) {
      const preferred = agentUi.vulnerabilities.find(item => item.status === 'SUSPECTED')
        || agentUi.vulnerabilities.find(item => item.status === 'CONFIRMED');
      agentUi.selectedVulnerabilityId = preferred?.id || '';
    }
    renderAgentVulnerabilities();
    showAgentError('');
  } catch (error) {
    if (requestVersion !== agentUi.vulnRequestVersion || document.getElementById('agent-project-select').value !== projectId) return;
    agentUi.vulnerabilities = [];
    agentUi.selectedVulnerabilityId = '';
    if (count) count.textContent = '—';
    list.innerHTML = `<div class="agent-empty agent-error">${esc(error.message)}</div>`;
    renderAgentVulnerabilityDetail();
    updateAgentLaunchState();
  }
}

function filteredAgentVulnerabilities() {
  const scope = document.getElementById('agent-vulnerability-filter')?.value || 'active';
  const query = document.getElementById('agent-vulnerability-search')?.value.trim().toLowerCase() || '';
  return agentUi.vulnerabilities.filter(item => {
    const inScope = scope === 'all' || (scope === 'active'
      ? item.status === 'SUSPECTED' || item.status === 'CONFIRMED' : item.status === scope);
    const haystack = [item.title, item.ruleId, item.cwe, item.filePath, item.qualifiedName]
      .join(' ').toLowerCase();
    return inScope && (!query || haystack.includes(query));
  });
}

function renderAgentVulnerabilities() {
  const list = document.getElementById('agent-vulnerability-list');
  const count = document.getElementById('agent-vulnerability-count');
  if (!list) return;
  const vulnerabilities = filteredAgentVulnerabilities();
  if (count) count.textContent = t('agent.vulnerabilityCount', vulnerabilities.length, agentUi.vulnerabilities.length);
  if (!vulnerabilities.length) {
    list.innerHTML = `<div class="agent-empty agent-empty-action"><strong>${esc(t('agent.noVulnerabilities'))}</strong>
      <span>${esc(t('agent.noVulnerabilitiesHint'))}</span>
      <button onclick="openVulnPanelFor(document.getElementById('agent-project-select')?.value)">${esc(t('agent.openVulnerabilities'))} →</button></div>`;
  } else {
    list.innerHTML = vulnerabilities.map(item => `<button class="agent-vulnerability-item
        ${item.id === agentUi.selectedVulnerabilityId ? 'selected' : ''}" role="option"
        aria-selected="${item.id === agentUi.selectedVulnerabilityId}"
        onclick="selectAgentVulnerability('${esc(item.id)}')">
      <span class="agent-vulnerability-severity ${esc(item.severity.toLowerCase())}">${esc(item.severity)}</span>
      <strong>${esc(item.title)}</strong><small>${esc(item.ruleId)} · ${esc(item.cwe || 'NO CWE')}</small>
      <code>${esc(item.filePath)}:${item.startLine}</code><em>${esc(agentVulnerabilityStatus(item.status))}</em>
    </button>`).join('');
  }
  renderAgentVulnerabilityDetail();
  updateAgentLaunchState();
}

function selectAgentVulnerability(vulnerabilityId) {
  agentUi.selectedVulnerabilityId = vulnerabilityId;
  showAgentError('');
  renderAgentVulnerabilities();
}

function renderAgentVulnerabilityDetail() {
  const detail = document.getElementById('agent-vulnerability-detail');
  if (!detail) return;
  const item = agentUi.vulnerabilities.find(value => value.id === agentUi.selectedVulnerabilityId);
  if (!item) {
    detail.innerHTML = `<div class="agent-empty">${esc(t('agent.noVulnerabilitySelected'))}</div>`;
    return;
  }
  detail.innerHTML = `<div class="agent-vulnerability-detail-head">
      <span class="agent-vulnerability-severity ${esc(item.severity.toLowerCase())}">${esc(item.severity)}</span>
      <span>${esc(agentVulnerabilityStatus(item.status))}</span><code>${esc(item.id)}</code></div>
    <h3>${esc(item.title)}</h3>
    <dl><div><dt>${esc(t('agent.rule'))}</dt><dd>${esc(item.ruleId)}</dd></div><div><dt>CWE</dt><dd>${esc(item.cwe || '—')}</dd></div>
      <div><dt>${esc(t('agent.symbol'))}</dt><dd>${esc(item.qualifiedName || '—')}</dd></div>
      <div><dt>${esc(t('agent.location'))}</dt><dd>${esc(item.filePath)}:${item.startLine}</dd></div></dl>
    <p>${esc(item.detail || t('agent.noVulnerabilityDetail'))}</p>
    ${renderAgentTaintEvidence(item)}`;
  if (isTaintVulnerability(item)) loadAgentTaintEvidence(item.id);
}

function isTaintVulnerability(item) {
  return item?.ruleId?.endsWith('_TAINT') || item?.detail?.startsWith('污点链：');
}

async function loadAgentTaintEvidence(vulnerabilityId) {
  if (!vulnerabilityId || agentUi.taintEvidence.has(vulnerabilityId)
      || agentUi.taintEvidenceLoading.has(vulnerabilityId)) return;
  agentUi.taintEvidenceLoading.add(vulnerabilityId);
  const requestVersion = agentUi.vulnRequestVersion;
  const projectId = document.getElementById('agent-project-select').value;
  const current = () => requestVersion === agentUi.vulnRequestVersion && document.getElementById('agent-project-select').value === projectId;
  try {
    const steps = await api.vulnTaintEvidence(vulnerabilityId);
    if (!current()) return;
    agentUi.taintEvidence.set(vulnerabilityId, { steps, error: '' });
    steps.filter(step => step.role === 'SOURCE' || step.role === 'SINK')
      .forEach(step => agentUi.expandedTaintSteps.add(`${vulnerabilityId}:${step.sequence}`));
  } catch (error) {
    if (!current()) return;
    agentUi.taintEvidence.set(vulnerabilityId, { steps: [], error: error.message });
  } finally {
    if (current()) {
      agentUi.taintEvidenceLoading.delete(vulnerabilityId);
      if (agentUi.selectedVulnerabilityId === vulnerabilityId) renderAgentVulnerabilityDetail();
    }
  }
}

function rememberTaintStep(element, vulnerabilityId, sequence) {
  const key = `${vulnerabilityId}:${sequence}`;
  if (element.open) agentUi.expandedTaintSteps.add(key);
  else agentUi.expandedTaintSteps.delete(key);
}

function renderAgentTaintEvidence(item) {
  if (!isTaintVulnerability(item)) return '';
  const state = agentUi.taintEvidence.get(item.id);
  if (!state) {
    return `<section class="agent-taint-chain"><div class="agent-taint-title"><i></i>
      <b>${esc(t('agent.taintChain'))}</b><span>${esc(t('agent.taintLoading'))}</span></div>
      <div class="agent-taint-skeleton"><i></i><i></i><i></i></div></section>`;
  }
  if (state.error) {
    return `<section class="agent-taint-chain"><div class="agent-taint-title"><i></i>
      <b>${esc(t('agent.taintChain'))}</b><span class="error">${esc(state.error)}</span></div></section>`;
  }
  if (!state.steps.length) {
    return `<section class="agent-taint-chain"><div class="agent-taint-title"><i></i>
      <b>${esc(t('agent.taintChain'))}</b><span>${esc(t('agent.taintNoEvidence'))}</span></div>
      <div class="agent-taint-empty">${esc(t('agent.taintRescanHint'))}</div></section>`;
  }
  return `<section class="agent-taint-chain"><div class="agent-taint-title"><i></i>
    <b>${esc(t('agent.taintChain'))}</b><span>${esc(t('agent.taintStepCount', state.steps.length))}</span></div>
    <div class="agent-taint-track">${state.steps.map(step => renderAgentTaintStep(item.id, step)).join('')}</div>
  </section>`;
}

function renderAgentTaintStep(vulnerabilityId, step) {
  const roleKey = { SOURCE: 'agent.taintSource', PROPAGATION: 'agent.taintPropagation', SINK: 'agent.taintSink' }[step.role];
  const key = `${vulnerabilityId}:${step.sequence}`;
  const open = agentUi.expandedTaintSteps.has(key) ? ' open' : '';
  const location = step.filePath ? `${step.filePath}:${step.startLine}-${step.endLine}` : t('agent.taintUnlocated');
  return `<article class="agent-taint-step ${esc(step.role.toLowerCase())}">
    <span class="agent-taint-node">${step.sequence}</span>
    <div class="agent-taint-step-body"><div class="agent-taint-step-head">
      <b>${esc(roleKey ? t(roleKey) : step.role)}</b><code>${esc(step.methodQn)}</code>
      <small>${esc(step.fromSlot)} <i>→</i> ${esc(step.toSlot)}</small></div>
      <details${open} ontoggle="rememberTaintStep(this,'${esc(vulnerabilityId)}',${step.sequence})">
        <summary><span>${esc(t('agent.taintSourceCode'))}</span><code>${esc(location)}</code></summary>
        ${renderTaintSource(step)}
      </details></div></article>`;
}

function renderTaintSource(step) {
  if (!step.sourceExcerpt) return `<div class="agent-taint-no-source">${esc(t('agent.taintUnlocated'))}</div>`;
  return `<pre class="agent-taint-code">${step.sourceExcerpt.split('\n').map((line, index) =>
    `<span><i>${step.startLine + index}</i><code>${esc(line) || ' '}</code></span>`).join('')}</pre>`;
}

function agentVulnerabilityStatus(status) {
  const keys = { SUSPECTED: 'vuln.suspected', CONFIRMED: 'vuln.confirmed',
    FIXED: 'vuln.fixed', DISMISSED: 'vuln.dismissed' };
  return keys[status] ? t(keys[status]) : status;
}

function handleAgentProjectChange() {
  const projectId = document.getElementById('agent-project-select').value;
  setGlobalProject(projectId);
  syncAgentProjectSelection();
}

function syncAgentProjectSelection() {
  if (typeof closeAgentReview === 'function') closeAgentReview(false);
  agentUi.runsRequestVersion++;
  agentUi.detailRequestVersion++;
  agentUi.vulnRequestVersion++;
  agentUi.runLoadError = '';
  renderAgentProjectHint();
  stopAgentPolling();
  restoreAgentPreparation(state.activeProjectId);
  agentUi.vulnerabilities = [];
  agentUi.runs = [];
  agentUi.selectedId = '';
  agentUi.currentRun = null;
  agentUi.runListSignature = '';
  agentUi.runDetailSignature = '';
  resetAgentRunDetail();
  renderAgentVulnerabilities();
  updateAgentLaunchState();
  Promise.all([loadAgentVulnerabilities(), loadAgentRuns()]);
}

/** 跳转索引面板并聚焦项目路径输入（Agent 项目提示的“去索引”使用）。 */
async function goIndexRoot() {
  await switchPanel('index');
  await Alpine.nextTick();
  document.getElementById('index-root')?.focus();
}

function renderAgentProjectHint() {
  const hint = document.getElementById('agent-project-hint');
  const select = document.getElementById('agent-project-select');
  if (!hint || !select) return;
  const project = (state.projects || []).find(item => item.projectId === select.value);
  hint.className = project ? 'ready' : ((state.projects || []).length ? '' : 'warning');
  if (project) {
    hint.textContent = t('agent.projectReady', project.nodeCount);
  } else if (!(state.projects || []).length) {
    hint.innerHTML = `${esc(t('agent.noProjectHint'))}
      <button onclick="goIndexRoot()">${esc(t('agent.goIndex'))} →</button>`;
  } else {
    hint.textContent = t('agent.projectHint');
  }
}

function updateAgentLaunchState() {
  renderAgentPreparationSummary();
  const projectReady = Boolean(document.getElementById('agent-project-select')?.value);
  const external = agentUi.inputMode === 'external';
  const inputReady = external
    ? parseAgentFindingsInput().state === 'ready'
    : agentUi.vulnerabilities.some(item => item.id === agentUi.selectedVulnerabilityId);
  renderAgentReadiness('agent-ready-project', projectReady, t('agent.readyProject'));
  renderAgentReadiness('agent-ready-vulnerability', inputReady,
    t(external ? 'agent.readyPayload' : 'agent.readyVulnerability'));
  const button = document.getElementById('agent-run-btn');
  if (!button || button.classList.contains('running')) return;
  button.disabled = !(projectReady && inputReady);
  const hint = document.getElementById('agent-run-hint');
  if (hint) hint.textContent = button.disabled ? t('agent.completeRequired') : t('agent.readyToRun');
}

function renderAgentReadiness(id, ready, label) {
  const item = document.getElementById(id);
  if (!item) return;
  item.classList.toggle('ready', ready);
  item.querySelector('span').textContent = label;
  item.querySelector('b').textContent = ready ? t('agent.ready') : t('agent.waiting');
}

async function startSastTriageAgent() {
  const projectId = document.getElementById('agent-project-select').value;
  if (!projectId) return showAgentError(t('agent.projectRequired'));

  const external = agentUi.inputMode === 'external';
  const codeVersion = document.getElementById('agent-code-version').value.trim();
  const ruleVersion = document.getElementById('agent-rule-version').value.trim();
  const budgetChars = Number(document.getElementById('agent-budget-chars').value);

  let findings;
  if (external) {
    findings = parseAgentFindingsInput();
    if (findings.state === 'empty') return showAgentError(t('agent.payloadRequired'));
    if (findings.state === 'invalid') return showAgentError(t('agent.invalidJson'));
    if (findings.state === 'unrecognized') return showAgentError(t('agent.unrecognizedInput'));
  } else if (!agentUi.selectedVulnerabilityId) {
    return showAgentError(t('agent.vulnerabilityRequired'));
  }

  const button = document.getElementById('agent-run-btn');
  button.disabled = true;
  button.classList.add('running');
  showAgentError('');
  try {
    const run = external
      ? await api.agentStartSastTriage(
        projectId, findings.format, findings.raw, codeVersion, ruleVersion, budgetChars,
        Number(document.getElementById('agent-max-findings').value) || 10)
      : await api.agentStartVulnerabilityTriage(
        agentUi.selectedVulnerabilityId, codeVersion, ruleVersion, budgetChars);
    if (document.getElementById('agent-project-select').value !== projectId) {
      showToast(t('agent.acceptedElsewhere', run.id), 8000);
      return;
    }
    agentUi.selectedId = run.id;
    showToast(t('agent.accepted'));
    await loadAgentRuns();
    showAgentRuns();
  } catch (error) {
    showAgentError(error.message);
  } finally {
    button.classList.remove('running');
    updateAgentLaunchState();
  }
}

async function loadAgentRuns(silent = false) {
  const requestVersion = ++agentUi.runsRequestVersion;
  const select = document.getElementById('agent-project-select');
  const projectId = select?.value || '';
  const list = document.getElementById('agent-run-list');
  const count = document.getElementById('agent-run-count');
  if (!list) return;
  if (!projectId) {
    stopAgentPolling();
    agentUi.runs = [];
    agentUi.currentRun = null;
    agentUi.runLoadError = '';
    agentUi.runListSignature = '';
    agentUi.runDetailSignature = '';
    if (count) count.textContent = '—';
    list.innerHTML = `<div class="agent-empty">${esc(t('agent.selectProject'))}</div>`;
    resetAgentRunDetail();
    return;
  }
  if (!silent && !agentUi.runs.length) {
    list.innerHTML = `<div class="agent-empty agent-loading">${esc(t('agent.loading'))}</div>`;
  }
  try {
    const runs = await api.agentRuns(projectId);
    if (requestVersion !== agentUi.runsRequestVersion || select.value !== projectId) return;
    if (!Array.isArray(runs) || runs.some(run => run.projectId !== projectId)) throw new Error(t('agent.invalidRuns'));
    list.classList.remove('stale');
    list.removeAttribute('title');
    const listSignature = JSON.stringify(runs.map(run =>
      [run.id, run.status, run.steps?.length || 0]));
    agentUi.runs = runs;
    if (count) count.textContent = `${agentUi.runs.length} ${t('agent.runCount')}`;
    if (listSignature !== agentUi.runListSignature) {
      agentUi.runListSignature = listSignature;
      renderAgentRunList();
    }
    if (agentUi.selectedId && agentUi.runs.some(run => run.id === agentUi.selectedId)) {
      await selectAgentRun(agentUi.selectedId, false, !silent);
    } else if (agentUi.runs.length) {
      await selectAgentRun(agentUi.runs[0].id, false, !silent);
    } else {
      agentUi.selectedId = '';
      agentUi.currentRun = null;
      agentUi.runLoadError = '';
      agentUi.runDetailSignature = '';
      resetAgentRunDetail();
    }
    if (agentUi.runs.some(run => agentRunActive(run.status))) startAgentPolling();
    else stopAgentPolling();
  } catch (error) {
    if (requestVersion !== agentUi.runsRequestVersion || select.value !== projectId) return;
    agentUi.runLoadError = error.message;
    renderAgentCurrentTask();
    if (silent) {
      list.classList.add('stale');
      list.title = error.message;
    } else {
      list.innerHTML = `<div class="agent-empty agent-error">${esc(error.message)}</div>`;
    }
  }
}

function resetAgentRunDetail() {
  const detail = document.getElementById('agent-run-detail');
  const runId = document.getElementById('agent-run-id');
  if (runId) runId.textContent = t('agent.noRun');
  if (!detail) return;
  delete detail.dataset.runId;
  detail.className = 'agent-detail-empty';
  detail.innerHTML = emptyState('agent.noRun', 'agent.noRunHint', 'activity');
  renderAgentCurrentTask();
}

function renderAgentRunList() {
  const list = document.getElementById('agent-run-list');
  if (!list) return;
  const scrollTop = list.scrollTop;
  if (!agentUi.runs.length) {
    list.innerHTML = `<div class="agent-empty agent-empty-action">
      <strong>${esc(t('agent.noHistory'))}</strong>
      <span>${esc(t('agent.noHistoryHint'))}</span>
      <button onclick="focusAgentInput()">${esc(t('agent.startFirstRun'))} →</button>
    </div>`;
    list.scrollTop = scrollTop;
    return;
  }
  const existingItems = Array.from(list.querySelectorAll('.agent-run-item'));
  const structuralChange = existingItems.length !== agentUi.runs.length
    || agentUi.runs.some(run => !existingItems.some(element => element.dataset.runId === run.id));
  if (structuralChange) {
    list.innerHTML = agentUi.runs.map(renderAgentRunItem).join('');
  } else {
    agentUi.runs.forEach(run => {
      const existing = existingItems.find(element => element.dataset.runId === run.id);
      const signature = agentRunItemSignature(run);
      if (existing.dataset.signature !== signature) {
        const focused = document.activeElement === existing;
        existing.insertAdjacentHTML('afterend', renderAgentRunItem(run));
        const replacement = existing.nextElementSibling;
        existing.remove();
        if (focused) replacement.focus({ preventScroll: true });
      } else {
        existing.classList.toggle('selected', run.id === agentUi.selectedId);
      }
    });
  }
  list.scrollTop = scrollTop;
}

function renderAgentRunItem(run) {
  const status = agentStatus(run.status);
  return `<button class="agent-run-item ${run.id === agentUi.selectedId ? 'selected' : ''}"
      data-run-id="${esc(run.id)}" data-signature="${esc(agentRunItemSignature(run))}"
      onclick="openAgentRun('${esc(run.id)}')">
    <span class="agent-run-status ${status.tone}">${status.label}</span>
    <strong>${esc(run.playbook.replaceAll('_', ' '))}</strong>
    <small>${esc(relativeTime(run.createdAt))}</small>
    <code>${esc(run.id.slice(0, 8))}</code>
  </button>`;
}

function agentRunItemSignature(run) {
  return JSON.stringify([run.status, run.steps?.length || 0, run.playbook, run.playbookVersion]);
}

function focusAgentInput() {
  showAgentPreparation();
  const list = document.getElementById('agent-vulnerability-list');
  focusAgentWorkflow(list);
  list?.querySelector('button')?.focus({ preventScroll: true });
}

function openAgentRun(runId) {
  const request = selectAgentRun(runId);
  showAgentRuns();
  return request;
}

async function selectAgentRun(runId, rerenderList = true, showLoading = true) {
  const requestVersion = ++agentUi.detailRequestVersion;
  const projectId = document.getElementById('agent-project-select').value;
  const changedSelection = agentUi.currentRun?.id !== runId;
  agentUi.selectedId = runId;
  if (rerenderList) renderAgentRunList();
  const detail = document.getElementById('agent-run-detail');
  if (showLoading && changedSelection) {
    detail.className = 'agent-detail-empty';
    detail.innerHTML = emptyState('agent.loadingRun', '', 'activity');
  }
  try {
    const run = await api.agentRun(runId);
    if (agentUi.selectedId !== runId || requestVersion !== agentUi.detailRequestVersion
      || document.getElementById('agent-project-select').value !== projectId) return;
    if (run.projectId !== projectId) throw new Error(t('agent.invalidRuns'));
    const recovered = !!agentUi.runLoadError;
    agentUi.runLoadError = '';
    detail.classList.remove('stale');
    detail.removeAttribute('title');
    const signature = JSON.stringify(run);
    agentUi.currentRun = run;
    if (changedSelection || signature !== agentUi.runDetailSignature) {
      renderAgentRunDetail(run, changedSelection);
      agentUi.runDetailSignature = signature;
    } else if (recovered) renderAgentCurrentTask();
    const index = agentUi.runs.findIndex(item => item.id === run.id);
    if (index >= 0) agentUi.runs[index] = run;
    if (rerenderList) renderAgentRunList();
    if (agentRunActive(run.status)) startAgentPolling();
  } catch (error) {
    if (requestVersion !== agentUi.detailRequestVersion || document.getElementById('agent-project-select').value !== projectId) return;
    agentUi.runLoadError = error.message;
    renderAgentCurrentTask();
    if (showLoading) {
      detail.innerHTML = `<strong>${esc(t('agent.loadFailed'))}</strong><span>${esc(error.message)}</span>`;
    } else {
      detail.classList.add('stale');
      detail.title = error.message;
    }
  }
}

function renderAgentRunDetail(run, replaceAll = false) {
  const detail = document.getElementById('agent-run-detail');
  const status = agentStatus(run.status);
  document.getElementById('agent-run-id').textContent = `RUN / ${run.id}`;
  const snapshotId = (run.outputReference || '').startsWith('report-snapshot:')
    ? run.outputReference.substring('report-snapshot:'.length) : '';
  const output = snapshotId ? `<div class="agent-output-gate">
      <div><span>${esc(t('agent.humanGate'))}</span><strong>${esc(t(run.status === 'WAITING_FOR_REVIEW' ? 'agent.reviewReady' : 'agent.readReviewReport'))}</strong>
      <small>${esc(snapshotId)}</small></div>
      <a target="_blank" href="/api/v1/review-queue/snapshots/${encodeURIComponent(snapshotId)}/export?format=markdown">Markdown ↗</a>
      <a target="_blank" href="/api/v1/review-queue/snapshots/${encodeURIComponent(snapshotId)}/export?format=json">JSON ↗</a>
      <a target="_blank"
         href="/api/v1/review-queue/snapshots/${encodeURIComponent(snapshotId)}/export?format=pdf">PDF ↗</a>
    </div>` : '';
  const initial = replaceAll || detail.dataset.runId !== run.id;
  if (initial) {
    detail.className = 'agent-detail-content';
    detail.dataset.runId = run.id;
    detail.innerHTML = `<div id="agent-run-summary" class="agent-run-summary"></div>
      <div id="agent-audit-strip" class="agent-audit-strip"></div>
      <div id="agent-live-telemetry"></div>
      <div id="agent-run-failure"></div>
      <div id="agent-timeline" class="agent-timeline"></div>
      <div id="agent-output-slot" tabindex="-1"></div>`;
  }
  detail.dataset.runStatus = run.status.toLowerCase();
  patchAgentRegion('agent-run-summary',
    JSON.stringify([run.status, run.playbook, run.playbookVersion, run.createdAt, run.steps?.length || 0]),
    renderAgentRunSummary(run, status));
  patchAgentRegion('agent-audit-strip',
    JSON.stringify([run.inputReference, run.updatedAt, run.completedAt]), renderAgentAuditStrip(run));
  const activeStep = [...(run.steps || [])].reverse().find(step => step.status === 'RUNNING');
  patchAgentRegion('agent-live-telemetry',
    JSON.stringify([run.status, activeStep?.id || '']), renderAgentLiveTelemetry(run));
  patchAgentRegion('agent-run-failure', run.statusReason || '', run.statusReason
    ? `<div class="agent-run-failure">${esc(run.statusReason)}</div>` : '');
  updateAgentTimeline(run.steps || []);
  patchAgentRegion('agent-output-slot', snapshotId, output);
  updateAgentLiveDurations();
  renderAgentCurrentTask();
}

function patchAgentRegion(id, signature, html) {
  const element = document.getElementById(id);
  if (!element || element.dataset.renderSignature === signature) return;
  element.innerHTML = html;
  element.dataset.renderSignature = signature;
}

function renderAgentLiveTelemetry(run) {
  if (!agentRunActive(run.status)) return '';
  const activeStep = [...(run.steps || [])].reverse().find(step => step.status === 'RUNNING');
  const detail = activeStep
    ? `${String(activeStep.sequence).padStart(2, '0')} / ${agentCapabilityLabel(activeStep.capability)}`
    : t('agent.awaitingExecutor');
  return `<div class="agent-live-telemetry">
    <svg class="icon" aria-hidden="true"><use href="/vendor/lucide/icons.svg#activity"/></svg>
    <div><b>${esc(t('agent.liveExecution'))}</b><small>${esc(detail)}</small></div>
    <code><i></i>${esc(t('agent.streamingAudit'))}</code>
  </div>`;
}

function rerenderAgentCurrentRun() {
  if (!agentUi.currentRun) return;
  document.querySelectorAll('#agent-run-detail [data-render-signature]').forEach(element => {
    delete element.dataset.renderSignature;
  });
  document.querySelectorAll('#agent-timeline .agent-step').forEach(element => {
    element.dataset.signature = '';
  });
  renderAgentRunDetail(agentUi.currentRun, false);
}

function renderAgentRunSummary(run, status) {
  return `<div><span>${esc(t('agent.runStatus'))}</span><strong class="${status.tone}">${status.label}</strong></div>
    <div><span>${esc(t('agent.playbook'))}</span><strong>${esc(run.playbook)}@${esc(run.playbookVersion)}</strong></div>
    <div><span>${esc(t('agent.started'))}</span><strong>${esc(formatAgentTime(run.createdAt))}</strong></div>
    <div><span>${esc(t('agent.steps'))}</span><strong>${esc(t('agent.recordedSteps', run.steps?.length || 0))}</strong></div>`;
}

function renderAgentAuditStrip(run) {
  const finishedAt = run.completedAt || run.updatedAt;
  return `<div><span>${esc(t('agent.auditInput'))}</span><code title="${esc(run.inputReference || '')}">
      ${esc(shortAgentReference(run.inputReference || '—'))}</code></div>
    <div><span>${esc(t('agent.auditUpdated'))}</span><time>${esc(formatAgentTime(run.updatedAt))}</time></div>
    <div><span>${esc(t('agent.auditElapsed'))}</span><strong class="agent-live-duration"
      data-started-at="${esc(run.createdAt)}" data-finished-at="${esc(run.completedAt || '')}">
      ${esc(formatAgentDuration(run.createdAt, finishedAt))}</strong></div>
    <button type="button" onclick="downloadAgentAudit('${esc(run.id)}')">
      ${esc(t('agent.exportAudit'))} <span>↓</span></button>`;
}

function updateAgentTimeline(steps) {
  const timeline = document.getElementById('agent-timeline');
  if (!timeline) return;
  if (!steps.length) {
    timeline.innerHTML = `<div class="agent-empty agent-timeline-awaiting">${esc(t('agent.queuedHint'))}</div>`;
    return;
  }
  timeline.querySelector('.agent-timeline-awaiting')?.remove();
  const activeIds = new Set(steps.map(step => step.id));
  timeline.querySelectorAll('.agent-step').forEach(element => {
    if (!activeIds.has(element.dataset.stepId)) element.remove();
  });
  steps.forEach((step, index) => {
    const existing = Array.from(timeline.children).find(element => element.dataset.stepId === step.id);
    const signature = JSON.stringify(step);
    if (!existing) {
      timeline.insertAdjacentHTML('beforeend', renderAgentStep(step, index, signature, false, false, true));
    } else if (existing.dataset.signature !== signature) {
      const auditOpen = Boolean(existing.querySelector('details.agent-step-audit[open]'));
      const missingOpen = Boolean(existing.querySelector('details:not(.agent-step-audit)[open]'));
      const focusedKind = existing.contains(document.activeElement)
        ? document.activeElement.closest('details')?.dataset.detailKind : '';
      const previousTop = focusedKind ? document.activeElement.getBoundingClientRect().top : 0;
      existing.insertAdjacentHTML(
        'afterend', renderAgentStep(step, index, signature, auditOpen, missingOpen, false));
      const replacement = existing.nextElementSibling;
      existing.remove();
      if (focusedKind) {
        const target = replacement.querySelector(`[data-detail-kind="${focusedKind}"] > summary`);
        if (target) {
          target.focus({ preventScroll: true });
          const body = document.querySelector('#panel-agent .agent-body');
          body.scrollTop += target.getBoundingClientRect().top - previousTop;
        }
      }
    }
  });
}

function renderAgentStep(
    step, index, signature = JSON.stringify(step), auditOpen = false,
    missingOpen = false, arriving = true) {
  const status = agentStepStatus(step.status);
  const refs = (step.evidenceReferences || []).map(reference =>
    `<code title="${esc(reference)}">${esc(shortAgentReference(reference))}</code>`).join('');
  const results = (step.results || []).map(renderAgentStepResult).join('');
  const missing = (step.missingInfo || []).map(item => `<li>${esc(item)}</li>`).join('');
  const finishedAt = step.finishedAt || '';
  const auditExpanded = auditOpen || agentUi.expandedDetails.has(`${step.id}:audit`);
  const missingExpanded = missingOpen || agentUi.expandedDetails.has(`${step.id}:missing`);
  return `<article class="agent-step ${status.tone} ${arriving ? 'arriving' : ''}"
      style="--step-delay:${Math.min(index, 5) * 45}ms" data-step-id="${esc(step.id)}"
      data-signature="${esc(signature)}">
    <div class="agent-step-node"><span>${String(index + 1).padStart(2, '0')}</span></div>
    <div class="agent-step-card">
      <header><strong>${esc(agentCapabilityLabel(step.capability))}</strong><span>${status.label}</span>
        <time>${esc(formatAgentTime(step.startedAt))} · <b class="agent-live-duration"
          data-started-at="${esc(step.startedAt)}" data-finished-at="${esc(finishedAt)}">
          ${esc(formatAgentDuration(step.startedAt, finishedAt || new Date().toISOString()))}</b></time></header>
      <p>${esc(step.summary)}</p>
      ${results ? `<div class="agent-step-results">${results}</div>` : ''}
      ${refs ? `<div class="agent-evidence"><b>${esc(t('agent.evidence'))}</b>${refs}</div>` : ''}
      ${missing ? `<details data-detail-kind="missing" ontoggle="rememberAgentDetail(this)"
        ${missingExpanded ? 'open' : ''}><summary>${esc(t('agent.missing'))} ·
        ${step.missingInfo.length}</summary><ul>${missing}</ul></details>` : ''}
      ${step.error ? `<div class="agent-step-error">${esc(step.error)}</div>` : ''}
      <details class="agent-step-audit" data-detail-kind="audit" ontoggle="rememberAgentDetail(this)"
        ${auditExpanded ? 'open' : ''}>
        <summary>${esc(t('agent.auditDetails'))}</summary>
        <dl><div><dt>${esc(t('agent.stepId'))}</dt><dd>${esc(step.id)}</dd></div>
          <div><dt>${esc(t('agent.sequence'))}</dt><dd>${step.sequence}</dd></div>
          <div><dt>${esc(t('agent.startedAt'))}</dt><dd>${esc(step.startedAt || '—')}</dd></div>
          <div><dt>${esc(t('agent.finishedAt'))}</dt><dd>${esc(step.finishedAt || t('agent.inProgress'))}</dd></div></dl>
        <small>${esc(t('agent.auditBoundary'))}</small>
      </details>
    </div>
  </article>`;
}

function renderAgentStepResult(result) {
  const uncertainty = Math.round(Number(result.uncertainty || 0) * 100);
  const recommendation = result.recommendation || '—';
  return `<div class="agent-step-result">
    <code title="${esc(result.subjectReference)}">${esc(shortAgentReference(result.subjectReference))}</code>
    <span><small>${esc(t('agent.baseline'))}</small><b>${esc(result.baseline || '—')}</b></span>
    <i>→</i>
    <span><small>${esc(t('agent.recommendation'))}</small><b>${esc(recommendation)}</b></span>
    <em>${esc(t('agent.uncertainty'))} ${uncertainty}%</em>
    ${result.advisoryOnly ? `<strong>${esc(t('agent.advisoryOnly'))}</strong>` : ''}
  </div>`;
}

function agentStatus(status) {
  const values = {
    QUEUED: [t('agent.status.queued'), 'queued'], RUNNING: [t('agent.status.running'), 'running'],
    WAITING_FOR_REVIEW: [t('agent.status.review'), 'review'], COMPLETED: [t('agent.status.completed'), 'completed'],
    PARTIAL: [t('agent.status.partial'), 'partial'], FAILED: [t('agent.status.failed'), 'failed'],
    CANCELLED: [t('agent.status.cancelled'), 'cancelled'],
  };
  const value = values[status] || [status, 'queued'];
  return { label: value[0], tone: value[1] };
}

function agentStepStatus(status) {
  const values = {
    PENDING: [t('agent.step.pending'), 'queued'], RUNNING: [t('agent.step.running'), 'running'],
    COMPLETED: [t('agent.step.completed'), 'completed'], SKIPPED: [t('agent.step.skipped'), 'skipped'],
    FAILED: [t('agent.step.failed'), 'failed'],
  };
  const value = values[status] || [status, 'queued'];
  return { label: value[0], tone: value[1] };
}

function agentRunActive(status) { return status === 'QUEUED' || status === 'RUNNING'; }

function startAgentPolling() {
  if (agentUi.polling) return;
  agentUi.polling = setInterval(async () => {
    if (!document.getElementById('panel-agent')?.classList.contains('active')) {
      stopAgentPolling();
      return;
    }
    updateAgentLiveDurations();
    if (agentUi.pollingBusy) return;
    agentUi.pollingBusy = true;
    try {
      await loadAgentRuns(true);
    } finally {
      agentUi.pollingBusy = false;
    }
  }, 2000);
}

function stopAgentPolling() {
  if (agentUi.polling) clearInterval(agentUi.polling);
  agentUi.polling = null;
  agentUi.pollingBusy = false;
}

function updateAgentLiveDurations() {
  document.querySelectorAll('#agent-run-detail .agent-live-duration').forEach(element => {
    const end = element.dataset.finishedAt || new Date().toISOString();
    element.textContent = formatAgentDuration(element.dataset.startedAt, end);
  });
}

function formatAgentDuration(startedAt, finishedAt) {
  const started = new Date(startedAt).getTime();
  const finished = new Date(finishedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return '—';
  const milliseconds = Math.max(0, finished - started);
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} m ${seconds % 60} s`;
}

async function downloadAgentAudit(runId) {
  try {
    const run = await api.agentRun(runId);
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agent-run-${runId}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(t('agent.auditExported'));
  } catch (error) {
    showAgentError(error.message);
  }
}

function shortAgentReference(reference) {
  const text = String(reference);
  if (text.startsWith('vulnerability:')) return `VULNERABILITY / ${text.slice(14, 26)}`;
  if (text.startsWith('finding:')) return `FINDING / ${text.slice(8, 20)}`;
  if (text.startsWith('report-snapshot:')) return `SNAPSHOT / ${text.slice(16, 28)}`;
  return text.length > 28 ? `${text.slice(0, 25)}…` : text;
}

function formatAgentTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(currentLang === 'zh' ? 'zh-CN' : 'en-US', { hour12: false });
}

function showAgentError(message) {
  const element = document.getElementById('agent-command-error');
  if (element) element.textContent = message || '';
}

restoreAgentTextSize();
window.addEventListener('beforeunload', stopAgentPolling);

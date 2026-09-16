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
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!document.getElementById('agent-run-btn').disabled) startSastTriageAgent();
    }
  });
  setAgentInputMode(agentUi.inputMode);
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
  document.querySelector('.agent-command-deck')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('agent-findings-json').value = String(reader.result || '');
    document.getElementById('agent-file-name').textContent = `INPUT / ${file.name} / ${file.size} B`;
    refreshExternalInputStatus();
  };
  reader.onerror = () => showAgentError(t('agent.fileError'));
  reader.readAsText(file);
  input.value = '';
}

function clearAgentFindingsInput() {
  const textarea = document.getElementById('agent-findings-json');
  if (textarea) textarea.value = '';
  const name = document.getElementById('agent-file-name');
  if (name) name.textContent = 'INPUT / NOT LOADED';
  showAgentError('');
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
  const saved = localStorage.getItem('repograph_agent_text_size');
  applyAgentTextSize(saved === 'large' ? 'large' : 'standard');
}

function setAgentTextSize(size) {
  const normalized = size === 'large' ? 'large' : 'standard';
  localStorage.setItem('repograph_agent_text_size', normalized);
  applyAgentTextSize(normalized);
}

function applyAgentTextSize(size) {
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
  const stateElement = document.getElementById('agent-llm-state');
  if (!stateElement) return;
  setLlmState('loading', 'LOADING', '—');
  try {
    const settings = await api.llmSettings();
    agentUi.llmSettings = settings;
    document.getElementById('agent-llm-enabled').checked = settings.enabled;
    document.getElementById('agent-llm-base-url').value = settings.baseUrl;
    document.getElementById('agent-llm-model').value = settings.model;
    renderSavedLlmState();
  } catch (error) {
    setLlmState('error', 'CONFIG ERROR', error.message);
  }
}

function toggleLlmSettings() {
  const module = document.getElementById('agent-llm-module');
  const open = module.classList.toggle('open');
  document.getElementById('agent-llm-chevron').textContent = open ? '−' : '＋';
}

function llmDraft() {
  return {
    enabled: document.getElementById('agent-llm-enabled').checked,
    baseUrl: document.getElementById('agent-llm-base-url').value.trim(),
    model: document.getElementById('agent-llm-model').value.trim(),
  };
}

function renderLlmDraftState() {
  const draft = llmDraft();
  if (!draft.enabled) setLlmState('disabled', 'DISABLED', t('agent.llm.heuristicOnly'));
  else setLlmState('unverified', 'ENABLED', t('agent.llm.unsaved'));
}

function renderSavedLlmState() {
  const settings = agentUi.llmSettings;
  if (!settings?.enabled) {
    setLlmState('disabled', 'DISABLED', t('agent.llm.heuristicOnly'));
    return;
  }
  if (agentUi.llmConnection?.reachable && agentUi.llmConnection?.modelAvailable) {
    setLlmState('ready', 'READY', `${settings.provider} / ${settings.model}`);
  } else {
    setLlmState('unverified', 'ENABLED', `${settings.provider} / ${settings.model}`);
  }
}

async function testLlmConnection() {
  const draft = llmDraft();
  if (!draft.baseUrl || !draft.model) return showLlmMessage(t('agent.llm.required'), 'error');
  const button = document.getElementById('agent-llm-test-btn');
  button.disabled = true;
  showLlmMessage(t('agent.llm.testing'), 'working');
  setLlmState('loading', 'PROBING', draft.baseUrl);
  try {
    const status = await api.testLlmSettings(draft);
    agentUi.llmConnection = status;
    document.getElementById('agent-llm-models').innerHTML = (status.models || [])
      .map(model => `<option value="${esc(model)}"></option>`).join('');
    if (!status.reachable) {
      setLlmState('error', 'UNREACHABLE', draft.baseUrl);
      showLlmMessage(t('agent.llm.unreachable'), 'error');
    } else if (!status.modelAvailable) {
      setLlmState('warning', 'MODEL MISSING', draft.model);
      showLlmMessage(t('agent.llm.modelMissing', draft.model), 'warning');
    } else {
      setLlmState('ready', 'READY', `OLLAMA / ${draft.model}`);
      showLlmMessage(t('agent.llm.connected', draft.model), 'success');
    }
  } catch (error) {
    setLlmState('error', 'TEST FAILED', draft.baseUrl);
    showLlmMessage(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function saveLlmSettings() {
  const draft = llmDraft();
  if (!draft.baseUrl || !draft.model) return showLlmMessage(t('agent.llm.required'), 'error');
  const button = document.getElementById('agent-llm-save-btn');
  button.disabled = true;
  showLlmMessage(t('agent.llm.saving'), 'working');
  try {
    agentUi.llmSettings = await api.updateLlmSettings(draft);
    renderSavedLlmState();
    showLlmMessage(t('agent.llm.saved'), 'success');
    showToast(t('agent.llm.saved'));
  } catch (error) {
    showLlmMessage(error.message, 'error');
  } finally {
    button.disabled = false;
  }
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
  const previous = select.value || state.activeProjectId;
  const emptyLabel = projects?.length ? t('ph.selectProject') : t('agent.noIndexedProjects');
  select.innerHTML = `<option value="">${esc(emptyLabel)}</option>`
    + (projects || []).map(project =>
      `<option value="${esc(project.projectId)}">${esc(projectName(project))} · ${project.nodeCount}</option>`
    ).join('');
  if ((projects || []).some(project => project.projectId === previous)) select.value = previous;
  if (!select.value && projects?.length === 1) select.value = projects[0].projectId;
  renderAgentProjectHint();
  updateAgentLaunchState();
}

async function loadAgentVulnerabilities() {
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
    agentUi.vulnerabilities = await api.vulnList(projectId, '', '');
    if (!agentUi.vulnerabilities.some(item => item.id === agentUi.selectedVulnerabilityId)) {
      const preferred = agentUi.vulnerabilities.find(item => item.status === 'SUSPECTED')
        || agentUi.vulnerabilities.find(item => item.status === 'CONFIRMED');
      agentUi.selectedVulnerabilityId = preferred?.id || '';
    }
    renderAgentVulnerabilities();
    showAgentError('');
  } catch (error) {
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
      <button onclick="switchPanel('vulns')">${esc(t('agent.openVulnerabilities'))} →</button></div>`;
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
    <dl><div><dt>RULE</dt><dd>${esc(item.ruleId)}</dd></div><div><dt>CWE</dt><dd>${esc(item.cwe || '—')}</dd></div>
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
  try {
    const steps = await api.vulnTaintEvidence(vulnerabilityId);
    agentUi.taintEvidence.set(vulnerabilityId, { steps, error: '' });
    steps.filter(step => step.role === 'SOURCE' || step.role === 'SINK')
      .forEach(step => agentUi.expandedTaintSteps.add(`${vulnerabilityId}:${step.sequence}`));
  } catch (error) {
    agentUi.taintEvidence.set(vulnerabilityId, { steps: [], error: error.message });
  } finally {
    agentUi.taintEvidenceLoading.delete(vulnerabilityId);
    if (agentUi.selectedVulnerabilityId === vulnerabilityId) renderAgentVulnerabilityDetail();
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
  renderAgentProjectHint();
  agentUi.selectedVulnerabilityId = '';
  agentUi.selectedId = '';
  agentUi.currentRun = null;
  agentUi.runDetailSignature = '';
  clearAgentFindingsInput();
  updateAgentLaunchState();
  Promise.all([loadAgentVulnerabilities(), loadAgentRuns()]);
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
      <button onclick="switchPanel('index')">${esc(t('agent.goIndex'))} →</button>`;
  } else {
    hint.textContent = t('agent.projectHint');
  }
}

function updateAgentLaunchState() {
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
  item.querySelector('b').textContent = ready ? 'READY' : 'WAITING';
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
    agentUi.selectedId = run.id;
    showToast(t('agent.accepted'));
    await loadAgentRuns();
  } catch (error) {
    showAgentError(error.message);
  } finally {
    button.classList.remove('running');
    updateAgentLaunchState();
  }
}

async function loadAgentRuns(silent = false) {
  const select = document.getElementById('agent-project-select');
  const projectId = select?.value || '';
  const list = document.getElementById('agent-run-list');
  const count = document.getElementById('agent-run-count');
  if (!list) return;
  if (!projectId) {
    stopAgentPolling();
    agentUi.runs = [];
    agentUi.currentRun = null;
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
    list.classList.remove('stale');
    list.removeAttribute('title');
    const listSignature = JSON.stringify(runs.map(run =>
      [run.id, run.status, run.steps?.length || 0]));
    agentUi.runs = runs;
    if (count) count.textContent = `${agentUi.runs.length} RUNS`;
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
      agentUi.runDetailSignature = '';
      resetAgentRunDetail();
    }
    if (agentUi.runs.some(run => agentRunActive(run.status))) startAgentPolling();
    else stopAgentPolling();
  } catch (error) {
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
  if (runId) runId.textContent = 'NO RUN SELECTED';
  if (!detail) return;
  delete detail.dataset.runId;
  detail.className = 'agent-detail-empty';
  detail.innerHTML = `<div class="agent-radar"><i></i><i></i><i></i></div>
    <strong>${esc(t('agent.noRun'))}</strong><span>${esc(t('agent.noRunHint'))}</span>`;
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
        existing.insertAdjacentHTML('afterend', renderAgentRunItem(run));
        existing.remove();
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
      onclick="selectAgentRun('${esc(run.id)}')">
    <span class="agent-run-status ${status.tone}">${status.label}</span>
    <strong>${esc(run.playbook.replaceAll('_', ' '))}</strong>
    <small>${esc(relativeTime(run.createdAt))}</small>
    <code>${esc(run.id.slice(0, 8))}</code>
    <i style="--progress:${agentProgress(run)}%"></i>
  </button>`;
}

function agentRunItemSignature(run) {
  return JSON.stringify([run.status, run.steps?.length || 0, run.playbook, run.playbookVersion]);
}

function focusAgentInput() {
  const list = document.getElementById('agent-vulnerability-list');
  list?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  list?.querySelector('button')?.focus({ preventScroll: true });
}

async function selectAgentRun(runId, rerenderList = true, showLoading = true) {
  const changedSelection = agentUi.currentRun?.id !== runId;
  agentUi.selectedId = runId;
  if (rerenderList) renderAgentRunList();
  const detail = document.getElementById('agent-run-detail');
  if (showLoading && changedSelection) {
    detail.className = 'agent-detail-empty';
    detail.innerHTML = `<div class="agent-radar"><i></i><i></i><i></i></div>
      <strong>${esc(t('agent.loadingRun'))}</strong>`;
  }
  try {
    const run = await api.agentRun(runId);
    if (agentUi.selectedId !== runId) return;
    detail.classList.remove('stale');
    detail.removeAttribute('title');
    const signature = JSON.stringify(run);
    agentUi.currentRun = run;
    if (changedSelection || signature !== agentUi.runDetailSignature) {
      renderAgentRunDetail(run, changedSelection);
      agentUi.runDetailSignature = signature;
    }
    const index = agentUi.runs.findIndex(item => item.id === run.id);
    if (index >= 0) agentUi.runs[index] = run;
    if (rerenderList) renderAgentRunList();
    if (agentRunActive(run.status)) startAgentPolling();
  } catch (error) {
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
      <div><span>${esc(t('agent.humanGate'))}</span><strong>${esc(t('agent.reviewReady'))}</strong>
      <small>${esc(snapshotId)}</small></div>
      <a target="_blank" href="/api/v1/review-queue/snapshots/${encodeURIComponent(snapshotId)}/export?format=markdown">MARKDOWN ↗</a>
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
      <div id="agent-output-slot"></div>`;
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
    ? `${String(activeStep.sequence).padStart(2, '0')} / ${activeStep.capability.replaceAll('_', ' ')}`
    : t('agent.awaitingExecutor');
  return `<div class="agent-live-telemetry">
    <span class="agent-signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
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
    <div><span>PLAYBOOK</span><strong>${esc(run.playbook)}@${esc(run.playbookVersion)}</strong></div>
    <div><span>${esc(t('agent.started'))}</span><strong>${esc(formatAgentTime(run.createdAt))}</strong></div>
    <div><span>${esc(t('agent.steps'))}</span><strong>${run.steps?.length || 0} / 5</strong></div>`;
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
      existing.insertAdjacentHTML(
        'afterend', renderAgentStep(step, index, signature, auditOpen, missingOpen, false));
      existing.remove();
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
      <header><strong>${esc(step.capability.replaceAll('_', ' '))}</strong><span>${status.label}</span>
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
        <dl><div><dt>STEP ID</dt><dd>${esc(step.id)}</dd></div>
          <div><dt>SEQUENCE</dt><dd>${step.sequence}</dd></div>
          <div><dt>STARTED AT</dt><dd>${esc(step.startedAt || '—')}</dd></div>
          <div><dt>FINISHED AT</dt><dd>${esc(step.finishedAt || t('agent.inProgress'))}</dd></div></dl>
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

function agentProgress(run) {
  if (run.status === 'WAITING_FOR_REVIEW' || run.status === 'COMPLETED') return 100;
  return Math.min(100, Math.round(((run.steps?.length || 0) / 5) * 100));
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

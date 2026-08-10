/* RepoGraph Agent Workbench — public execution state only, never model chain-of-thought. */
const agentUi = {
  runs: [],
  selectedId: '',
  polling: null,
  llmSettings: null,
  llmConnection: null,
};

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
  select.innerHTML = `<option value="">${esc(t('ph.selectProject'))}</option>`
    + (projects || []).map(project =>
      `<option value="${esc(project.projectId)}">${esc(projectName(project))} · ${project.nodeCount}</option>`
    ).join('');
  if ((projects || []).some(project => project.projectId === previous)) select.value = previous;
  if (!select.value && projects?.length === 1) select.value = projects[0].projectId;
}

function readAgentFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('agent-findings-json').value = String(reader.result || '');
    document.getElementById('agent-file-name').textContent = `INPUT / ${file.name} / ${file.size} B`;
  };
  reader.onerror = () => showAgentError(t('agent.fileError'));
  reader.readAsText(file);
}

async function startSastTriageAgent() {
  const projectId = document.getElementById('agent-project-select').value;
  const format = document.getElementById('agent-format').value;
  const json = document.getElementById('agent-findings-json').value.trim();
  if (!projectId) return showAgentError(t('agent.projectRequired'));
  if (!json) return showAgentError(t('agent.payloadRequired'));

  const button = document.getElementById('agent-run-btn');
  button.disabled = true;
  button.classList.add('running');
  showAgentError('');
  try {
    JSON.parse(json);
  } catch (_) {
    button.disabled = false;
    button.classList.remove('running');
    return showAgentError(t('agent.invalidJson'));
  }

  try {
    const run = await api.agentStartSastTriage(
      projectId, format, json,
      document.getElementById('agent-code-version').value.trim(),
      document.getElementById('agent-rule-version').value.trim());
    agentUi.selectedId = run.id;
    showToast(t('agent.accepted'));
    await loadAgentRuns();
    await selectAgentRun(run.id);
  } catch (error) {
    showAgentError(error.message);
  } finally {
    button.disabled = false;
    button.classList.remove('running');
  }
}

async function loadAgentRuns() {
  const select = document.getElementById('agent-project-select');
  const projectId = select?.value || '';
  const list = document.getElementById('agent-run-list');
  if (!list) return;
  stopAgentPolling();
  if (!projectId) {
    agentUi.runs = [];
    list.innerHTML = `<div class="agent-empty">${esc(t('agent.selectProject'))}</div>`;
    return;
  }
  list.innerHTML = `<div class="agent-empty agent-loading">${esc(t('agent.loading'))}</div>`;
  try {
    agentUi.runs = await api.agentRuns(projectId);
    renderAgentRunList();
    if (agentUi.selectedId && agentUi.runs.some(run => run.id === agentUi.selectedId)) {
      await selectAgentRun(agentUi.selectedId, false);
    } else if (agentUi.runs.length) {
      await selectAgentRun(agentUi.runs[0].id, false);
    }
    if (agentUi.runs.some(run => agentRunActive(run.status))) startAgentPolling();
  } catch (error) {
    list.innerHTML = `<div class="agent-empty agent-error">${esc(error.message)}</div>`;
  }
}

function renderAgentRunList() {
  const list = document.getElementById('agent-run-list');
  if (!agentUi.runs.length) {
    list.innerHTML = `<div class="agent-empty">${esc(t('agent.noHistory'))}</div>`;
    return;
  }
  list.innerHTML = agentUi.runs.map(run => {
    const status = agentStatus(run.status);
    return `<button class="agent-run-item ${run.id === agentUi.selectedId ? 'selected' : ''}"
                    onclick="selectAgentRun('${esc(run.id)}')">
      <span class="agent-run-status ${status.tone}">${status.label}</span>
      <strong>${esc(run.playbook.replaceAll('_', ' '))}</strong>
      <small>${esc(relativeTime(run.createdAt))}</small>
      <code>${esc(run.id.slice(0, 8))}</code>
      <i style="--progress:${agentProgress(run)}%"></i>
    </button>`;
  }).join('');
}

async function selectAgentRun(runId, rerenderList = true) {
  agentUi.selectedId = runId;
  if (rerenderList) renderAgentRunList();
  const detail = document.getElementById('agent-run-detail');
  detail.className = 'agent-detail-empty';
  detail.innerHTML = `<div class="agent-radar"><i></i><i></i><i></i></div><strong>${esc(t('agent.loadingRun'))}</strong>`;
  try {
    const run = await api.agentRun(runId);
    renderAgentRunDetail(run);
    const index = agentUi.runs.findIndex(item => item.id === run.id);
    if (index >= 0) agentUi.runs[index] = run;
    renderAgentRunList();
    if (agentRunActive(run.status)) startAgentPolling();
  } catch (error) {
    detail.innerHTML = `<strong>${esc(t('agent.loadFailed'))}</strong><span>${esc(error.message)}</span>`;
  }
}

function renderAgentRunDetail(run) {
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
    </div>` : '';
  const steps = (run.steps || []).map((step, index) => renderAgentStep(step, index)).join('');
  detail.className = 'agent-detail-content';
  detail.innerHTML = `<div class="agent-run-summary">
      <div><span>${esc(t('agent.runStatus'))}</span><strong class="${status.tone}">${status.label}</strong></div>
      <div><span>PLAYBOOK</span><strong>${esc(run.playbook)}@${esc(run.playbookVersion)}</strong></div>
      <div><span>${esc(t('agent.started'))}</span><strong>${esc(formatAgentTime(run.createdAt))}</strong></div>
      <div><span>${esc(t('agent.steps'))}</span><strong>${run.steps?.length || 0} / 5</strong></div>
    </div>
    ${run.statusReason ? `<div class="agent-run-failure">${esc(run.statusReason)}</div>` : ''}
    <div class="agent-timeline">${steps || `<div class="agent-empty">${esc(t('agent.queuedHint'))}</div>`}</div>
    ${output}`;
}

function renderAgentStep(step, index) {
  const status = agentStepStatus(step.status);
  const refs = (step.evidenceReferences || []).map(reference =>
    `<code title="${esc(reference)}">${esc(shortAgentReference(reference))}</code>`).join('');
  const results = (step.results || []).map(renderAgentStepResult).join('');
  const missing = (step.missingInfo || []).map(item => `<li>${esc(item)}</li>`).join('');
  return `<article class="agent-step ${status.tone}">
    <div class="agent-step-node"><span>${String(index + 1).padStart(2, '0')}</span></div>
    <div class="agent-step-card">
      <header><strong>${esc(step.capability.replaceAll('_', ' '))}</strong><span>${status.label}</span>
        <time>${esc(formatAgentTime(step.finishedAt || step.startedAt))}</time></header>
      <p>${esc(step.summary)}</p>
      ${results ? `<div class="agent-step-results">${results}</div>` : ''}
      ${refs ? `<div class="agent-evidence"><b>${esc(t('agent.evidence'))}</b>${refs}</div>` : ''}
      ${missing ? `<details><summary>${esc(t('agent.missing'))} · ${step.missingInfo.length}</summary><ul>${missing}</ul></details>` : ''}
      ${step.error ? `<div class="agent-step-error">${esc(step.error)}</div>` : ''}
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
  agentUi.polling = setInterval(() => {
    if (document.getElementById('panel-agent')?.classList.contains('active')) loadAgentRuns();
    else stopAgentPolling();
  }, 2000);
}

function stopAgentPolling() {
  if (agentUi.polling) clearInterval(agentUi.polling);
  agentUi.polling = null;
}

function shortAgentReference(reference) {
  const text = String(reference);
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

window.addEventListener('beforeunload', stopAgentPolling);

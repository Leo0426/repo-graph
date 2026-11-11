/* Task impact is a projection of observed service/configuration facts, never a job scheduler. */
const capabilityView = { generation: null, loading: false, error: false, receivedAt: '' };
const TASK_CAPABILITIES = {
  search: { panel: 'search', services: ['qdrant', 'ollama'], project: true },
  index: { panel: 'index', services: ['neo4j', 'ollama', 'qdrant'], admin: true },
  graph: { panel: 'graph', services: ['neo4j'], project: true },
  facts: { panel: 'wiki', services: [], project: true },
  advisory: { panel: 'agent', services: [], project: true, generation: true },
  review: { panel: 'agent', services: [], project: true },
};

async function loadGenerationCapability() {
  if (capabilityView.loading) return;
  capabilityView.loading = true;
  renderTaskCapabilities();
  try {
    await sessionReady;
    const data = await fetch('/api/v1/capabilities/generation').then(apiJsonResponse);
    if (typeof data.configured !== 'boolean' || typeof data.enabled !== 'boolean') throw new Error('Invalid generation capability');
    capabilityView.generation = data;
    capabilityView.error = false;
    capabilityView.receivedAt = new Date().toISOString();
  } catch (_) {
    capabilityView.generation = null;
    capabilityView.error = true;
  } finally {
    capabilityView.loading = false;
    renderTaskCapabilities();
  }
}

function taskCapabilityState(task) {
  if (task.admin && sessionAccount?.role !== 'ADMIN') return 'permission';
  if (task.project && !state.projects.some(project => project.projectId === state.activeProjectId)) return 'noProject';
  if (task.generation) {
    const generation = capabilityView.generation;
    if (!generation) return 'unknown';
    if (!generation.configured) return 'notConfigured';
    return generation.enabled ? 'unverified' : 'disabled';
  }
  if (task.services.some(service => serviceHealthView.states[service] === 'error')) return 'blocked';
  if (task.services.some(service => serviceHealthView.states[service] !== 'ok')) return 'unknown';
  return task.services.length ? 'connected' : 'read';
}

function taskCapabilityNote(id, outcome) {
  const task = TASK_CAPABILITIES[id];
  if (outcome === 'noProject') return t('capability.choose');
  if (outcome === 'permission') return t('capability.permission');
  if (['blocked', 'unknown'].includes(outcome) && task.services.length) {
    const name = service => service === 'ollama' ? 'Embedding Ollama' : service === 'neo4j' ? 'Neo4j' : 'Qdrant';
    const failed = task.services.filter(service => serviceHealthView.states[service] === 'error').map(name);
    const unknown = task.services.filter(service => !['ok', 'error'].includes(serviceHealthView.states[service])).map(name);
    return [failed.length ? t('capability.affected', failed.join('、')) : '',
      unknown.length ? t('capability.unknownDependency', unknown.join('、')) : ''].filter(Boolean).join(' ');
  }
  if (task.generation) {
    const generation = capabilityView.generation;
    return `${t('capability.generation.note')}${generation?.configured ? ` ${generation.name} / ${generation.model}` : ''}`;
  }
  return t(`capability.${id}.note`);
}

function renderTaskCapabilities() {
  const agentNote = document.getElementById('agent-generation-note');
  if (agentNote) {
    const config = capabilityView.generation;
    agentNote.textContent = t(!config ? (capabilityView.error ? 'capability.configFailed' : 'capability.configLoading')
      : config.enabled && config.configured ? 'agent.generationFutureEnabled' : 'agent.generationFutureDisabled');
  }
  const grid = document.getElementById('capability-grid');
  if (!grid) return;
  if (!grid.children.length) {
    grid.innerHTML = Object.keys(TASK_CAPABILITIES).map(id => `<article class="capability-card" data-capability="${id}">
      <h3></h3><strong class="capability-state"></strong><p></p>
      <div class="capability-actions"><button type="button" class="btn btn-ghost" data-capability-open></button>
      <button type="button" class="btn btn-ghost" data-capability-recover></button></div></article>`).join('');
    grid.querySelectorAll('[data-capability]').forEach(card => {
      card.querySelector('[data-capability-open]').onclick = () => openTaskCapability(card.dataset.capability);
      card.querySelector('[data-capability-recover]').onclick = () => recoverTaskCapability(card.dataset.capability);
    });
  }
  for (const [id, task] of Object.entries(TASK_CAPABILITIES)) {
    const card = grid.querySelector(`[data-capability="${id}"]`);
    const outcome = taskCapabilityState(task);
    card.dataset.state = outcome;
    card.querySelector('h3').textContent = t(`capability.${id}.title`);
    card.querySelector('.capability-state').textContent = t(`capability.state.${outcome}`);
    card.querySelector('p').textContent = taskCapabilityNote(id, outcome);
    card.querySelector('[data-capability-open]').textContent = t(outcome === 'noProject' ? 'capability.chooseAction'
      : outcome === 'permission' ? 'capability.repositories' : `capability.${id}.open`);
    const recovery = card.querySelector('[data-capability-recover]');
    recovery.hidden = ['noProject', 'permission', 'read', 'connected'].includes(outcome);
    recovery.textContent = t(task.generation ? (sessionAccount?.role === 'ADMIN' ? 'capability.configure' : 'capability.askAdmin') : 'capability.checkDependency');
    const notice = document.querySelector(`[data-task-notice="${id}"]`);
    if (notice) {
      notice.hidden = !['blocked', 'unknown'].includes(outcome);
      notice.querySelector('span').textContent = `${t(`capability.state.${outcome}`)} · ${taskCapabilityNote(id, outcome)}`;
      notice.querySelector('button').textContent = t('capability.checkDependency');
      notice.querySelector('button').onclick = () => recoverTaskCapability(id);
    }
  }
  const scope = document.getElementById('capability-project');
  const project = state.projects.find(item => item.projectId === state.activeProjectId);
  if (scope) scope.textContent = project ? t('search.scopeRepository', projectName(project)) : t('capability.choose');
  const refresh = document.getElementById('capability-generation-refresh');
  if (refresh) refresh.disabled = capabilityView.loading;
  const freshness = document.getElementById('capability-generation-freshness');
  if (freshness) freshness.textContent = capabilityView.loading ? t('capability.configLoading')
    : capabilityView.error ? t('capability.configFailed') : capabilityView.receivedAt
      ? t('capability.configTime', new Date(capabilityView.receivedAt).toLocaleTimeString(currentLang === 'zh' ? 'zh-CN' : 'en-US')) : t('capability.configUnloaded');
}

async function openTaskCapability(id) {
  const task = TASK_CAPABILITIES[id];
  const outcome = taskCapabilityState(task);
  await switchPanel(['noProject', 'permission'].includes(outcome) ? 'tools' : task.panel);
  document.getElementById('main-content').focus({ preventScroll: true });
}

async function recoverTaskCapability(id) {
  const task = TASK_CAPABILITIES[id];
  if (task.generation) {
    if (sessionAccount?.role === 'ADMIN') return openProviderManagement();
    showToast(t('capability.askAdminNote'), 8000);
    return;
  }
  await switchPanel('health');
  const service = task.services.find(service => serviceHealthView.states[service] !== 'ok') || task.services[0];
  const card = document.querySelector(`#health-grid [data-service="${service}"]`);
  if (card) { card.tabIndex = -1; card.focus({ preventScroll: true }); card.scrollIntoView({ block: 'center' }); }
}

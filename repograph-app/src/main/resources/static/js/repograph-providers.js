const providerView = { providers: [], editing: null, loading: false, busy: false, catalogVersion: 0, catalogAbort: null };
const providerStatus = (message, tone = 'info', ...args) => {
  const element = document.getElementById('provider-status');
  if (message.startsWith('provider.ui.')) setLocalizedText(element, message, ...args);
  else clearLocalizedText(element, message);
  element.dataset.state = tone;
};
async function loadProviders() {
  await sessionReady;
  if (sessionAccount?.role !== 'ADMIN' || providerView.loading || providerView.busy) return;
  providerView.loading = true; document.getElementById('provider-new').disabled = true; providerStatus('provider.ui.loading');
  try { await refreshProviders(); providerStatus(''); }
  catch (error) { providerStatus('provider.ui.loadFailed', 'error', errorMessageArgument(error)); }
  finally { providerView.loading = false; document.getElementById('provider-new').disabled = false; }
}
async function refreshProviders() {
  const providers = await adminRequest('admin/model-providers');
  if (!Array.isArray(providers)) throw clientMessageError('provider.ui.invalid');
  providerView.providers = providers; renderProviders();
}
function renderProviders() {
  document.getElementById('provider-list').innerHTML = providerView.providers.map(provider => `
    <article class="card" data-provider="${esc(provider.id)}">
      <span class="admin-status-pill">${localizedText(provider.selected ? (provider.enabled ? 'provider.ui.current' : 'provider.ui.currentDisabled') : (provider.enabled ? 'provider.ui.available' : 'provider.ui.disabled'))}</span>
      <h3>${esc(provider.name)}</h3><p>${esc(provider.protocol)} · ${esc(provider.model)}</p><p>${esc(provider.baseUrl)}</p>
      <p>${localizedText('provider.ui.keySummary', provider.apiKeyConfigured, provider.maxOutputTokens)}</p>
      <div class="admin-actions"><button class="btn btn-ghost" data-provider-edit>${localizedText('provider.ui.editAction')}</button>
        <button class="btn btn-ghost" data-provider-test>${localizedText('provider.ui.test')}</button>
        ${!provider.selected && provider.enabled ? `<button class="btn btn-primary" data-provider-select>${localizedText('provider.ui.select')}</button>` : ''}
        ${!provider.selected ? `<button class="btn btn-ghost" data-provider-delete>${localizedText('btn.delete')}</button>` : ''}</div>
    </article>`).join('') || `<p>${localizedText('provider.ui.empty')}</p>`;
  document.querySelectorAll('[data-provider]').forEach(row => {
    const id = row.dataset.provider;
    row.querySelector('[data-provider-edit]').onclick = () => editProvider(id);
    row.querySelector('[data-provider-test]').onclick = () => mutateProvider(async () => {
      const result = await adminRequest(`admin/model-providers/${encodeURIComponent(id)}/test`, 'POST');
      if (!result.connected) throw result.message ? new Error(result.message) : clientMessageError('provider.ui.testFailed');
      return result.message || 'provider.ui.testSuccess';
    });
    const select = row.querySelector('[data-provider-select]');
    if (select) select.onclick = () => mutateProvider(async () => {
      await adminRequest(`admin/model-providers/${encodeURIComponent(id)}/select`, 'POST');
      return 'provider.ui.selected';
    });
    const remove = row.querySelector('[data-provider-delete]');
    if (remove) remove.onclick = () => {
      const provider = providerView.providers.find(item => item.id === id);
      if (!confirm(t('provider.ui.deleteConfirm', provider.name))) return;
      mutateProvider(async () => {
        await adminRequest(`admin/model-providers/${encodeURIComponent(id)}`, 'DELETE');
        if (providerView.editing === id) closeProviderEditor();
        return 'provider.ui.deleted';
      });
    };
  });
}
function editProvider(id = null) {
  if (providerView.busy || providerView.loading) return;
  const provider = providerView.providers.find(item => item.id === id);
  if (id && !provider) return;
  const form = document.getElementById('provider-form'); form.reset(); form.hidden = false;
  resetProviderModels();
  providerView.editing = id;
  document.getElementById("provider-preset-controls").hidden = !!id;
  document.getElementById("provider-preset-hint").textContent = "";
  delete document.getElementById("provider-preset-hint").dataset.preset;
  setLocalizedText('provider-editor-title', id ? 'provider.ui.edit' : 'provider.ui.add');
  document.getElementById('provider-name').value = provider?.name || '';
  document.getElementById('provider-protocol').value = provider?.protocol || 'OPENAI';
  document.getElementById('provider-base-url').value = provider?.baseUrl || '';
  document.getElementById('provider-model').value = provider?.model || '';
  document.getElementById('provider-timeout').value = provider?.timeoutMillis || 180000;
  document.getElementById('provider-output').value = provider?.maxOutputTokens || 4096;
  document.getElementById('provider-enabled').checked = provider?.enabled ?? true;
  document.getElementById('provider-clear-key').disabled = !provider?.apiKeyConfigured;
  setLocalizedText('provider-key-hint', provider?.apiKeyConfigured ? 'provider.ui.keySaved' : 'provider.ui.keyOptional');
  updateProviderHint(); document.getElementById('provider-name').focus();
}
function updateProviderHint() {
  const protocol = document.getElementById('provider-protocol').value;
  if (protocol === 'OLLAMA') setLocalizedText('provider-url-hint', 'provider.ui.ollamaUrl');
  else setLocalizedText('provider-url-hint', 'provider.ui.apiUrl', protocol === 'ANTHROPIC' ? '/messages' : '/chat/completions');
}
function closeProviderEditor() {
  resetProviderModels();
  const form = document.getElementById('provider-form'); form.reset(); form.hidden = true;
  providerView.editing = null;
}
async function saveProvider() {
  const form = document.getElementById('provider-form');
  if (!form.reportValidity()) return;
  const input = {
    name: document.getElementById('provider-name').value.trim(),
    protocol: document.getElementById('provider-protocol').value,
    baseUrl: document.getElementById('provider-base-url').value.trim(),
    model: document.getElementById('provider-model').value.trim(),
    apiKey: document.getElementById('provider-api-key').value,
    clearApiKey: document.getElementById('provider-clear-key').checked,
    enabled: document.getElementById('provider-enabled').checked,
    timeoutMillis: Number(document.getElementById('provider-timeout').value),
    maxOutputTokens: Number(document.getElementById('provider-output').value),
  };
  const id = providerView.editing;
  // Retain historical rates without asking administrators to re-enter or invent prices.
  const saved = providerView.providers.find(provider => provider.id === id);
  if (saved && saved.protocol === input.protocol && saved.baseUrl === input.baseUrl.replace(/\/+$/, '')
      && saved.model === input.model) {
    input.inputUsdPerMillionTokens = saved.inputUsdPerMillionTokens;
    input.outputUsdPerMillionTokens = saved.outputUsdPerMillionTokens;
  } else if (saved) {
    input.inputUsdPerMillionTokens = null;
    input.outputUsdPerMillionTokens = null;
  }
  await mutateProvider(async () => {
    await adminRequest('admin/model-providers' + (id ? '/' + encodeURIComponent(id) : ''), id ? 'PUT' : 'POST', input);
    closeProviderEditor();
    return id ? 'provider.ui.saved' : 'provider.ui.created';
  });
}
async function mutateProvider(action) {
  if (providerView.busy || providerView.loading) return;
  providerView.busy = true; providerStatus('provider.ui.processing');
  const controls = [...document.querySelectorAll('#admin-providers button, #provider-fields')];
  const disabled = controls.map(control => control.disabled); controls.forEach(control => { control.disabled = true; });
  try {
    const message = await action();
    await refreshProviders();
    if (typeof loadLlmSettings === 'function') await loadLlmSettings();
    providerStatus(message, 'success');
  } catch (error) { providerStatus('provider.ui.failed', 'error', errorMessageArgument(error)); }
  finally {
    providerView.busy = false; controls.forEach((control, index) => { control.disabled = disabled[index]; });
    document.getElementById('provider-fetch-models').disabled = !!providerView.catalogAbort;
  }
}
function openProviderManagement() {
  switchPanel('admin'); selectAdminTab('providers');
}

// Templates are editable connection drafts, not an assertion that credentials or a model are available.
const providerPresets = {
  custom: { name: '', protocol: 'OPENAI_COMPATIBLE', url: '' },
  openai: { name: 'OpenAI', protocol: 'OPENAI', url: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic', protocol: 'ANTHROPIC', url: 'https://api.anthropic.com/v1' },
  gemini: { name: 'Google Gemini', protocol: 'OPENAI_COMPATIBLE', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  deepseek: { name: 'DeepSeek', protocol: 'OPENAI_COMPATIBLE', url: 'https://api.deepseek.com' },
  qwen: { name: '通义千问', protocol: 'OPENAI_COMPATIBLE', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  siliconflow: { name: '硅基流动', protocol: 'OPENAI_COMPATIBLE', url: 'https://api.siliconflow.cn/v1' },
  ollama: { name: 'Ollama', protocol: 'OLLAMA', url: 'http://localhost:11434' },
};
function applyProviderPreset() {
  if (providerView.editing || providerView.busy || providerView.loading) return;
  const preset = providerPresets[document.getElementById('provider-preset').value];
  if (!preset) return;
  document.getElementById('provider-name').value = preset.name;
  document.getElementById('provider-protocol').value = preset.protocol;
  document.getElementById('provider-base-url').value = preset.url;
  // Do not carry a credential or model into a different service draft.
  resetProviderModels();
  document.getElementById('provider-api-key').value = '';
  document.getElementById('provider-model').value = '';
  document.getElementById('provider-preset-hint').dataset.preset = document.getElementById('provider-preset').value;
  renderProviderPresetHint();
  updateProviderHint();
  document.getElementById('provider-model').focus();
}

function renderProviderPresetHint() {
  const hint = document.getElementById('provider-preset-hint');
  if (hint?.dataset.preset) hint.textContent = t('provider.preset.hint.' + hint.dataset.preset);
}

function providerModelStatus(key = '', tone = 'info', ...args) {
  const status = document.getElementById('provider-model-status');
  if (key) setLocalizedText(status, key, ...args); else clearLocalizedText(status, '');
  status.dataset.state = tone;
}
function resetProviderModels() {
  providerView.catalogVersion++;
  providerView.catalogAbort?.abort(); providerView.catalogAbort = null;
  const button = document.getElementById('provider-fetch-models');
  button.disabled = false; button.removeAttribute('aria-busy');
  setLocalizedText(button, 'provider.ui.fetchModels');
  document.getElementById('provider-model-picker').hidden = true;
  const placeholder = new Option('', ''); setLocalizedText(placeholder, 'provider.ui.chooseModel');
  document.getElementById('provider-model-options').replaceChildren(placeholder);
  providerModelStatus();
}
async function fetchProviderModels() {
  if (providerView.busy || providerView.catalogAbort) return;
  for (const id of ['provider-base-url', 'provider-api-key', 'provider-timeout']) {
    if (!document.getElementById(id).reportValidity()) return;
  }
  resetProviderModels();
  const version = providerView.catalogVersion;
  const controller = new AbortController(); providerView.catalogAbort = controller;
  const button = document.getElementById('provider-fetch-models');
  button.disabled = true; button.setAttribute('aria-busy', 'true');
  setLocalizedText(button, 'provider.ui.fetchingModels');
  providerModelStatus('provider.ui.modelsLoading');
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 32000);
  try {
    const result = await adminRequest('admin/model-providers/models', 'POST', {
      providerId: providerView.editing,
      protocol: document.getElementById('provider-protocol').value,
      baseUrl: document.getElementById('provider-base-url').value.trim(),
      apiKey: document.getElementById('provider-api-key').value,
      clearApiKey: document.getElementById('provider-clear-key').checked,
      timeoutMillis: Number(document.getElementById('provider-timeout').value),
    }, controller.signal);
    if (version !== providerView.catalogVersion) return;
    if (!Array.isArray(result.models) || result.models.length > 5000
        || result.models.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)) {
      throw clientMessageError('provider.ui.modelsInvalid');
    }
    const options = document.getElementById('provider-model-options');
    result.models.forEach(id => options.add(new Option(id, id)));
    document.getElementById('provider-model-picker').hidden = result.models.length === 0;
    providerModelStatus(result.models.length ? 'provider.ui.modelsLoaded' : 'provider.ui.modelsEmpty', 'success', result.models.length);
  } catch (error) {
    if (version !== providerView.catalogVersion) return;
    providerModelStatus(timedOut ? 'provider.ui.modelsTimeout' : 'provider.ui.modelsFailed', 'error', errorMessageArgument(error));
  } finally {
    clearTimeout(timer);
    if (version === providerView.catalogVersion) {
      providerView.catalogAbort = null;
      button.disabled = providerView.busy; button.removeAttribute('aria-busy');
      setLocalizedText(button, 'provider.ui.fetchModels');
    }
  }
}
function chooseProviderModel() {
  const selected = document.getElementById('provider-model-options').value;
  if (selected) document.getElementById('provider-model').value = selected;
}
for (const id of ['provider-protocol', 'provider-base-url', 'provider-api-key', 'provider-clear-key', 'provider-timeout']) {
  document.getElementById(id).addEventListener('input', resetProviderModels);
}
document.getElementById('provider-model').addEventListener('input', () => {
  document.getElementById('provider-model-options').value = '';
});

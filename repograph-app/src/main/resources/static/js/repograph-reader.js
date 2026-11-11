/* Continuous reading of existing CodeUnit / VulnFinding data; never starts or updates a business task. */
const readerDialog = document.getElementById('result-reader');
const readerView = { source: '', index: 0, version: 0, trigger: null, listScroll: 0, listMoved: false, panel: '',
  code: null, projectId: '', loadedUnit: null, evidence: null, error: '', loading: false, statusKey: '', lang: '' };
const readerMobile = matchMedia('(max-width: 980px)');

function readerItems() {
  return readerView.source === 'search' ? searchState.results || []
    : readerView.source === 'vulns' ? vulnView.findings : readerView.code ? [{ unit: readerView.code, projectId: readerView.projectId }] : [];
}
function readerItem() { return readerItems()[readerView.index]; }
function readerUnit() { return readerView.loadedUnit || (readerView.source === 'vulns' ? null : readerItem()?.unit); }
function readerProjectId() { return readerView.source === 'vulns' ? readerItem()?.projectId || _vulnProjectId : readerItem()?.projectId || ''; }
function readerListBody() { return document.querySelector(`#panel-${readerView.panel} .panel-body`); }
function readerTrigger() {
  return readerView.source === 'search' ? document.querySelector(`.result-card[data-result-idx="${readerView.index}"] .rc-read`)
    : readerView.source === 'vulns' ? [...document.querySelectorAll('[data-reader-finding]')].find(button => button.dataset.readerFinding === readerItem()?.id)
      : readerView.trigger;
}

function openVulnReader(id, trigger) {
  const index = vulnView.findings.findIndex(finding => finding.id === id);
  if (index >= 0) openResultReader('vulns', index, trigger);
}

function openCodeReader(unit, projectId, trigger) {
  readerView.code = unit;
  readerView.projectId = projectId;
  openResultReader('graph', 0, trigger);
}

function openResultReader(source, index, trigger) {
  if (document.querySelector('dialog:modal') && !readerDialog.matches(':modal')) return;
  const alreadyOpen = readerDialog.open;
  document.getElementById('account-menu').open = false;
  readerView.source = source;
  readerView.index = index;
  if (!readerItem()) return;
  readerView.trigger = trigger || readerTrigger();
  readerView.panel = Alpine.store('repograph').panel;
  if (!alreadyOpen) { readerView.listScroll = readerListBody()?.scrollTop || 0; readerView.listMoved = false; }
  document.body.classList.add('reader-open');
  layoutResultReader();
  selectReaderRecord();
}

function layoutResultReader() {
  if (!document.body.classList.contains('reader-open')) return;
  const focus = readerDialog.contains(document.activeElement) ? document.activeElement : null;
  const scroll = document.getElementById('reader-content').scrollTop;
  const shouldModal = readerMobile.matches;
  if (shouldModal) document.getElementById('account-menu').open = false;
  if (readerDialog.open && readerDialog.matches(':modal') !== shouldModal) readerDialog.close();
  readerDialog.dataset.mode = shouldModal ? 'mobile' : 'desktop';
  readerDialog.setAttribute('role', shouldModal ? 'dialog' : 'complementary');
  readerDialog.toggleAttribute('aria-modal', shouldModal);
  if (shouldModal) readerDialog.setAttribute('aria-modal', 'true');
  document.documentElement.style.setProperty('--reader-top', `${Math.max(0, document.querySelector('.panel.active').getBoundingClientRect().top)}px`);
  if (!readerDialog.open) shouldModal ? readerDialog.showModal() : readerDialog.show();
  document.getElementById('reader-content').scrollTop = scroll;
  if (focus?.isConnected) focus.focus({ preventScroll: true });
}

function closeResultReader(restoreFocus = true) {
  if (!readerDialog.open) return;
  readerView.version++;
  const trigger = readerTrigger() || readerView.trigger;
  const body = readerListBody();
  const scroll = restoreFocus && !readerView.listMoved ? readerView.listScroll : body?.scrollTop || 0;
  readerDialog.close();
  document.body.classList.remove('reader-open');
  if (body) body.scrollTop = scroll;
  if (restoreFocus) {
    if (trigger?.isConnected && trigger.getClientRects().length) {
      trigger.focus({ preventScroll: true });
      const bounds = trigger.getBoundingClientRect(), listBounds = body?.getBoundingClientRect();
      if (listBounds && (bounds.top < listBounds.top || bounds.bottom > listBounds.bottom)) trigger.scrollIntoView({ block: 'nearest' });
    }
    else document.getElementById('main-content').focus({ preventScroll: true });
  }
}

function selectReaderRecord() {
  if (readerView.source === 'vulns' && vulnView.page !== Math.floor(readerView.index / LIST_PAGE_SIZE)) {
    vulnView.page = Math.floor(readerView.index / LIST_PAGE_SIZE);
    renderVulnList(vulnView.findings);
  }
  readerView.version++;
  readerView.loadedUnit = null;
  readerView.evidence = null;
  readerView.error = '';
  readerView.loading = false;
  readerView.statusKey = '';
  readerView.trigger = readerTrigger() || readerView.trigger;
  document.getElementById('reader-status').textContent = '';
  renderResultReader();
  document.getElementById('reader-content').scrollTop = 0;
  document.getElementById('reader-heading').focus({ preventScroll: true });
  if (readerView.source === 'vulns') loadReaderEvidence();
}

function stepResultReader(delta) {
  const index = readerView.index + delta;
  if (index < 0 || index >= readerItems().length) return;
  readerView.index = index;
  selectReaderRecord();
}

function refreshReaderNavigation() {
  if (!readerDialog.open) return;
  document.getElementById('reader-position').textContent = t('reader.position', readerView.index + 1, readerItems().length);
  document.getElementById('reader-previous').disabled = readerView.index === 0;
  document.getElementById('reader-next').disabled = readerView.index >= readerItems().length - 1;
  document.getElementById('reader-more').hidden = readerView.source !== 'search' || !searchState.hasMore;
  document.getElementById('reader-more').disabled = loadingMore;
}

function renderResultReader() {
  if (!readerDialog.open || !readerItem()) return;
  const item = readerItem(), unit = readerUnit(), vulnerability = readerView.source === 'vulns';
  const pid = readerProjectId(), project = state.projects.find(project => project.projectId === pid);
  document.getElementById('reader-origin').textContent = project ? projectName(project) : pid || t('search.unknownRepository');
  document.getElementById('reader-heading').textContent = vulnerability ? item.title || item.ruleId : unit.qualifiedName || unit.simpleName;
  const file = vulnerability ? item.filePath : unit.filePath;
  const line = vulnerability ? item.startLine : unit.startLine;
  const end = vulnerability ? item.startLine : unit.endLine;
  const location = formatReaderLocation(file, line, end);
  document.getElementById('reader-content').innerHTML = `${vulnerability
    ? `<p class="reader-conclusion"><b>${esc(item.severity)} · ${esc(t('vuln.' + item.status.toLowerCase()))}</b></p><p>${esc(item.detail || '')}</p>
        <p>${esc(item.ruleId)}${item.cwe ? ' · ' + esc(item.cwe) : ''}</p><code class="reader-full-name">${esc(item.qualifiedName || '')}</code>`
    : `${unit.signature ? `<pre class="reader-signature">${esc(unit.signature)}</pre>` : ''}
        ${unit.annotations?.length ? `<div class="rc-annotations">${unit.annotations.map(annotation => `<span>${esc(annotation)}</span>`).join('')}</div>` : ''}`}
    <div class="reader-location"><code>${esc(location)}</code><button type="button" class="btn btn-ghost" id="reader-copy-location" ${file ? '' : 'disabled'}>${esc(t('reader.copyLocation'))}</button></div>
    <h3>${esc(t(vulnerability ? 'reader.evidence' : 'reader.source'))}</h3><div id="reader-evidence" tabindex="-1"></div>`;
  document.getElementById('reader-copy-location').onclick = async () => {
    const version = readerView.version;
    try { await copyToClipboard(file + (Number.isInteger(line) && line > 0 ? ':' + line : '')); if (version === readerView.version) readerStatus('toast.copied'); }
    catch (_) { if (version === readerView.version) readerStatus('toast.copyFailed'); }
  };
  document.getElementById('reader-graph').disabled = !project || !(vulnerability ? item.qualifiedName : unit.qualifiedName);
  document.getElementById('reader-triage').hidden = !vulnerability;
  document.getElementById('reader-triage').disabled = !project;
  document.querySelectorAll('.result-card[data-result-idx]').forEach(card => card.dataset.reading = String(readerView.source === 'search' && Number(card.dataset.resultIdx) === readerView.index));
  document.querySelectorAll('.vuln-finding').forEach(card => card.dataset.reading = String(vulnerability && card.dataset.findingId === item.id));
  renderReaderEvidence();
  refreshReaderNavigation();
  readerView.lang = currentLang;
}

function formatReaderLocation(file, start, end) {
  return `${file || t('reader.unknownLocation')}${Number.isInteger(start) && start > 0 ? ' · L' + start
    + (Number.isInteger(end) && end > start ? '–' + end : '') : ' · ' + t('reader.unknownLine')}`;
}

function readerSource(source, startLine) {
  if (typeof source !== 'string') return `<p>${esc(t('symbol.invalidResponse'))}</p>`;
  return `<pre class="reader-source" tabindex="0"><code>${source.split('\n').map((line, index) =>
    `<span class="reader-source-line">${Number.isInteger(startLine) && startLine > 0 ? `<i aria-hidden="true">${startLine + index}</i>` : ''}<span>${esc(line) || ' '}</span></span>`).join('')}</code></pre>`;
}

function renderReaderEvidence() {
  const target = document.getElementById('reader-evidence');
  if (!target) return;
  if (target.contains(document.activeElement)) target.focus({ preventScroll: true });
  const unit = readerUnit();
  if (readerView.loading) { target.innerHTML = `<p role="status">${esc(t('reader.loading'))}</p>`; return; }
  if (readerView.error) {
    target.innerHTML = `<p class="reader-error" role="alert">${esc(readerView.error)}</p><button type="button" class="btn btn-ghost" onclick="loadReaderEvidence()">${esc(t('search.retry'))}</button>`;
    return;
  }
  if (readerView.evidence) {
    const roles = { SOURCE: 'agent.taintSource', PROPAGATION: 'agent.taintPropagation', SINK: 'agent.taintSink' };
    target.innerHTML = readerView.evidence.length ? readerView.evidence.map(step => `<section class="reader-evidence-step"><h4>${esc(roles[step.role] ? t(roles[step.role]) : step.role)}</h4>
      <code class="reader-full-name">${esc(step.methodQn || '')}</code><p>${esc(formatReaderLocation(step.filePath, step.startLine, step.endLine))}</p>
      ${step.sourceExcerpt ? readerSource(step.sourceExcerpt, step.startLine) : `<p>${esc(t('reader.noSource'))}</p>`}
      ${step.truncated ? `<p>${esc(t('review.truncated'))}</p>` : ''}</section>`).join('') : `<p>${esc(t('vuln.noEvidence'))}</p>`;
  } else if (unit?.rawSource) target.innerHTML = readerSource(unit.rawSource, unit.startLine);
  else target.innerHTML = `<p>${esc(t('reader.noSource'))}</p><button type="button" class="btn btn-ghost" onclick="loadReaderEvidence()" ${readerProjectId() && (unit?.qualifiedName || readerItem()?.qualifiedName) ? '' : 'disabled'}>${esc(t('reader.fetchSource'))}</button>`;
}

async function loadReaderEvidence() {
  const item = readerItem(), pid = readerProjectId(), version = ++readerView.version;
  if (!item || !pid || !state.projects.some(project => project.projectId === pid)) return;
  const current = () => readerDialog.open && version === readerView.version;
  readerView.loading = true;
  readerView.error = '';
  renderReaderEvidence();
  try {
    const taint = readerView.source === 'vulns' && (String(item.ruleId).endsWith('_TAINT') || String(item.detail).startsWith('污点链：'));
    if (taint) {
      const steps = await api.vulnTaintEvidence(item.id);
      if (!current()) return;
      if (!Array.isArray(steps)) throw new Error(t('vuln.invalidResponse'));
      readerView.evidence = steps;
    } else {
      const original = readerUnit() || item;
      if (!original.qualifiedName) throw new Error(t('reader.noSource'));
      const unit = await api.symbol(original.qualifiedName, pid);
      if (!current()) return;
      if (unit.qualifiedName !== original.qualifiedName || (original.id && readerView.source !== 'vulns' && unit.id !== original.id)
        || (readerView.source === 'vulns' && item.unitId && unit.id !== item.unitId)) throw new Error(t('reader.mismatch'));
      readerView.loadedUnit = unit;
    }
  } catch (error) { if (current()) readerView.error = error.message; }
  finally { if (current()) { readerView.loading = false; renderReaderEvidence(); } }
}

function readerStatus(key) { readerView.statusKey = key; document.getElementById('reader-status').textContent = t(key); }
async function loadMoreInReader() {
  const version = searchRequestVersion;
  document.getElementById('reader-more').disabled = true;
  try {
    const success = await loadMore();
    if (readerDialog.open && readerView.source === 'search' && version === searchRequestVersion && success === false)
      readerStatus('search.requestFailed');
  } finally { refreshReaderNavigation(); }
}
function readerOpenGraph() {
  const item = readerItem(), qn = readerView.source === 'vulns' ? item.qualifiedName : readerUnit()?.qualifiedName, pid = readerProjectId();
  closeResultReader(false);
  if (qn && pid) openSymbol(qn, pid);
}
async function readerOpenTriage() {
  const item = readerItem(), projectId = readerProjectId();
  if (readerView.source !== 'vulns' || !state.projects.some(project => project.projectId === projectId)) return;
  closeResultReader(false);
  setGlobalProject(projectId);
  await switchPanel('agent');
  if (Alpine.store('repograph').panel !== 'agent' || state.activeProjectId !== projectId) return;
  if (!agentUi.vulnerabilities.some(finding => finding.id === item.id)) { showToast(t('reader.findingUnavailable'), 5000, 'error'); return; }
  setAgentInputMode('vuln');
  selectAgentVulnerability(item.id);
  showAgentPreparation();
}
function refreshReaderLanguage() {
  if (!readerDialog.open || readerView.lang === currentLang) return;
  const content = document.getElementById('reader-content'), scroll = content.scrollTop;
  const sourceScroll = [...content.querySelectorAll('pre')].map(pre => pre.scrollLeft);
  const activeId = readerDialog.contains(document.activeElement) ? document.activeElement.id : '';
  renderResultReader();
  if (readerView.statusKey) readerStatus(readerView.statusKey);
  content.querySelectorAll('pre').forEach((pre, index) => { pre.scrollLeft = sourceScroll[index] || 0; });
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: true });
  content.scrollTop = scroll;
}
for (const event of ['pointerdown','wheel','touchmove']) document.addEventListener(event, action => {
  if (readerDialog.open && !readerMobile.matches && readerListBody()?.contains(action.target)) readerView.listMoved = true;
}, { passive: true });
readerMobile.addEventListener('change', layoutResultReader);
window.addEventListener('resize', layoutResultReader);
readerDialog.addEventListener('cancel', event => { event.preventDefault(); closeResultReader(); });
readerDialog.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !readerMobile.matches) return;
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); closeResultReader(); return; }
  if (!event.target.closest('pre,input,textarea,select,[contenteditable]') && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
    if (event.key === 'ArrowRight') { event.preventDefault(); stepResultReader(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); stepResultReader(-1); }
  }
  if (event.key === 'Tab' && readerMobile.matches) {
    const controls = [...readerDialog.querySelectorAll('button,pre[tabindex]')].filter(element => !element.disabled && element.getClientRects().length);
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  }
});

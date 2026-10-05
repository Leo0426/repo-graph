/* ── Tools panel ── */
const toolsRequests = {
  frameworks: { version: 0, status: 'idle', input: '', data: null, error: '' },
  sbom: { version: 0, status: 'idle', input: '', data: null, error: '', url: '' },
};
let toolsLanguage = null;

function invalidateToolInput(tool) {
  const request = toolsRequests[tool];
  request.version++;
  if (request.url) URL.revokeObjectURL(request.url);
  Object.assign(request, { status: 'idle', input: '', data: null, error: '', url: '' });
  renderToolResult(tool);
}

function invalidateToolsInputs() {
  invalidateToolInput('frameworks');
  invalidateToolInput('sbom');
}

function refreshToolsLanguage() {
  if (toolsLanguage === currentLang) return;
  toolsLanguage = currentLang;
  renderToolResult('frameworks');
  renderToolResult('sbom');
  renderManagedProjects();
}

function renderToolResult(tool) {
  const result = document.getElementById(`${tool}-result`);
  if (!result) return;
  const request = toolsRequests[tool];
  const submit = document.getElementById(`${tool}-submit`);
  if (submit) submit.disabled = request.status === 'loading';
  result.setAttribute('aria-busy', String(request.status === 'loading'));
  if (request.status === 'loading') {
    result.innerHTML = `<div class="tools-feedback tools-loading"><span class="spinner" aria-hidden="true"></span>${esc(t(`tools.${tool}.loading`))}</div>`;
  } else if (request.status === 'error') {
    result.innerHTML = `<div class="tools-feedback tools-error" role="alert"><p>${esc(request.error)}</p>
      <button type="button" class="btn btn-ghost tools-retry">${esc(t('tools.retry'))}</button></div>`;
    result.querySelector('.tools-retry').addEventListener('click', tool === 'frameworks' ? doFrameworks : doSbom);
  } else if (request.status === 'validation') {
    result.innerHTML = `<p class="tools-feedback tools-error" role="alert">${esc(t(request.error))}</p>`;
  } else if (request.status === 'ready' && tool === 'frameworks') {
    if (!request.data.length) {
      result.innerHTML = `<div class="tools-feedback"><strong>${esc(t('tools.frameworks.empty'))}</strong><p>${esc(t('tools.frameworks.emptyHint'))}</p></div>`;
    } else {
      result.innerHTML = `<p class="tools-result-count">${request.data.length.toLocaleString()} ${esc(t('tools.frameworks.count'))}</p>
        <div class="tools-entry-list">${request.data.map(unit => `<article class="tools-entry">
          <div class="tools-entry-heading"><span class="kind-badge" style="${kindStyle(unit.kind)}">${esc(unit.kind)}</span>
          ${unit.metadata?.framework ? `<span class="tools-framework-tag">${esc(unit.metadata.framework)}</span>` : ''}</div>
          <code>${esc(unit.qualifiedName)}</code><p class="tools-entry-path">${esc(unit.filePath || '')}</p></article>`).join('')}</div>`;
    }
  } else if (request.status === 'ready' && tool === 'sbom') {
    result.innerHTML = `<div class="tools-feedback tools-download-ready"><p>${esc(t('tools.sbom.ready'))}</p>
      <a class="btn btn-primary" href="${esc(request.url)}" download="${esc(request.filename)}">${esc(t('tools.sbom.download'))}</a>
      <code>${esc(request.filename)}</code></div>`;
  } else {
    result.innerHTML = `<p class="tools-feedback tools-initial">${esc(t(`tools.${tool}.initial`))}</p>`;
  }
}

async function runProjectTool(tool) {
  const input = document.getElementById(`${tool}-project-input`);
  const value = input.value.trim();
  const request = toolsRequests[tool];
  if (request.status === 'loading' && request.input === value) return;
  invalidateToolInput(tool);
  const project = resolveProject(value);
  const projectId = project?.projectId || resolveProjectId(value);
  if (!projectId || (tool === 'sbom' && !project?.projectRoot)) {
    request.status = 'validation';
    request.error = projectId ? 'tools.sbom.needRoot' : 'tools.selectProject';
    renderToolResult(tool);
    input.focus();
    return;
  }
  const version = request.version;
  request.input = value;
  request.status = 'loading';
  renderToolResult(tool);
  const isCurrent = () => request.version === version && input.value.trim() === value;
  try {
    const data = tool === 'frameworks' ? await api.frameworks(projectId) : await api.sbom(projectId, project.projectRoot);
    if (!isCurrent()) return;
    request.data = data || [];
    if (tool === 'sbom') {
      request.url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      request.filename = `sbom-${projectId}.json`;
    }
    request.status = 'ready';
  } catch (error) {
    if (!isCurrent()) return;
    request.status = 'error';
    request.error = error.message;
  }
  renderToolResult(tool);
}

async function doFrameworks() {
  await runProjectTool('frameworks');
}

async function doSbom() {
  await runProjectTool('sbom');
}

/* ── SBOM viewer ── */
const sbomState = {
  data: null, raw: null, projectId: null, projectRoot: null, input: '',
  scopeFilter: 'all', query: '', selectedIndex: null, status: 'idle', error: '', errorKey: '', version: 0,
};
let sbomLanguage = null;

function invalidateSbomView() {
  sbomState.version++;
  stopSbomGraph();
  Object.assign(sbomState, { data: null, raw: null, projectId: null, projectRoot: null, input: '',
    scopeFilter: 'all', query: '', selectedIndex: null, status: 'idle', error: '', errorKey: '' });
  renderSbomState();
}

function resetDeletedSbomProject(projectId, projectRoot) {
  const matchesInput = value => {
    const input = String(value || '').trim();
    const project = resolveProject(input);
    return input && (input === projectId || (projectRoot && input === projectRoot)
      || project?.projectId === projectId || (projectRoot && project?.projectRoot === projectRoot));
  };
  const viewer = document.getElementById('sbom-view-input');
  if (sbomState.projectId === projectId || (projectRoot && sbomState.projectRoot === projectRoot) || matchesInput(viewer?.value)) {
    if (viewer) viewer.value = '';
    invalidateSbomView();
  }
  const download = document.getElementById('sbom-project-input');
  if (matchesInput(download?.value) || matchesInput(toolsRequests.sbom.input)) {
    if (download) download.value = '';
    invalidateToolInput('sbom');
  }
}

function refreshSbomLanguage() {
  if (sbomLanguage === currentLang) return;
  sbomLanguage = currentLang;
  const active = document.querySelector('#panel-sbom')?.contains(document.activeElement) ? document.activeElement : null;
  const focusId = active?.id;
  const componentIndex = active?.dataset.componentIndex;
  const scope = active?.dataset.scope;
  const selection = focusId === 'sbom-component-search' ? [active.selectionStart, active.selectionEnd] : null;
  const listScroll = document.getElementById('sbom-component-list')?.scrollTop || 0;
  renderSbomState();
  let target = focusId ? document.getElementById(focusId) : null;
  if (componentIndex !== undefined) target = document.querySelector(`.sbom-component-button[data-component-index="${componentIndex}"]`);
  if (scope !== undefined) target = document.querySelector(`.sbom-scope-btn[data-scope="${scope}"]`);
  target?.focus({ preventScroll: true });
  if (selection && target?.setSelectionRange) target.setSelectionRange(...selection);
  const list = document.getElementById('sbom-component-list');
  if (list) list.scrollTop = listScroll;
}

async function loadSbomView() {
  const input = document.getElementById('sbom-view-input');
  const value = input.value.trim();
  if (sbomState.status === 'loading' && sbomState.input === value) return;
  invalidateSbomView();
  const project = resolveProject(value);
  if (!value || !project?.projectRoot) {
    sbomState.status = 'validation';
    sbomState.errorKey = value ? 'tools.sbom.needRoot' : 'tools.selectProject';
    renderSbomState();
    input.focus();
    return;
  }
  const version = sbomState.version;
  Object.assign(sbomState, { projectId: project.projectId, projectRoot: project.projectRoot, input: value, status: 'loading' });
  renderSbomState();
  const isCurrent = () => version === sbomState.version && input.value.trim() === value;
  try {
    const raw = await api.sbom(project.projectId, project.projectRoot);
    if (!isCurrent()) return;
    let bom;
    try {
      bom = JSON.parse(raw);
      if (!bom || bom.bomFormat !== 'CycloneDX' || !Array.isArray(bom.components)
          || bom.components.some(component => !component || typeof component !== 'object' || Array.isArray(component)
            || ['name', 'group', 'version', 'purl', 'scope'].some(key => component[key] != null && typeof component[key] !== 'string'))) {
        throw new Error('Invalid SBOM');
      }
    } catch (_) {
      sbomState.errorKey = 'sbom.invalidDocument';
      throw new Error(t('sbom.invalidDocument'));
    }
    sbomState.data = bom;
    sbomState.raw = raw;
    sbomState.status = 'ready';
  } catch (error) {
    if (!isCurrent()) return;
    sbomState.status = 'error';
    sbomState.error = error.message;
  }
  renderSbomState();
}

function renderSbomState() {
  const content = document.getElementById('sbom-view-content');
  if (!content) return;
  const loading = sbomState.status === 'loading';
  document.getElementById('sbom-view-submit').disabled = loading;
  document.getElementById('sbom-download-btn').hidden = sbomState.status !== 'ready';
  content.setAttribute('aria-busy', String(loading));
  if (sbomState.status === 'ready') {
    renderSbomContent();
    return;
  }
  if (loading) {
    content.innerHTML = `<div class="sbom-state sbom-loading" role="status"><span class="spinner" aria-hidden="true"></span>${esc(t('sbom.loading'))}</div>`;
  } else if (sbomState.status === 'error' || sbomState.status === 'validation') {
    content.innerHTML = `<div class="sbom-state sbom-error" role="alert"><p>${esc(sbomState.errorKey ? t(sbomState.errorKey) : sbomState.error)}</p>
      ${sbomState.status === 'error' ? `<button type="button" id="sbom-retry" class="btn btn-ghost">${esc(t('sbom.retry'))}</button>` : ''}</div>`;
    document.getElementById('sbom-retry')?.addEventListener('click', loadSbomView);
  } else {
    content.innerHTML = `<div class="sbom-state sbom-initial"><p>${esc(t('sbom.initial'))}</p></div>`;
  }
}

function renderSbomContent() {
  const bom = sbomState.data;
  if (!bom) return;
  stopSbomGraph();
  const metadata = bom.metadata || {};
  const component = metadata.component || {};
  const timestamp = Date.parse(metadata.timestamp);
  const generated = Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString(currentLang === 'zh' ? 'zh-CN' : 'en-US') : '—';
  document.getElementById('sbom-view-content').innerHTML = `
    <section class="card sbom-summary" aria-label="${esc(t('sbom.summary.project'))}">
      <div class="sbom-summary-identity"><span class="sbom-eyebrow">${esc(t('sbom.summary.project'))}</span>
        <h2>${esc(component.name || projectName(resolveProject(sbomState.projectId)) || sbomState.projectId)}</h2>
        <div class="sbom-summary-id"><code>${esc(sbomState.projectId)}</code>${component.version ? `<span>${esc(component.version)}</span>` : ''}</div>
        <code class="sbom-project-root">${esc(sbomState.projectRoot)}</code></div>
      <dl class="sbom-summary-facts"><div><dt>${esc(t('sbom.summary.components'))}</dt><dd class="sbom-component-total">${bom.components.length.toLocaleString()}</dd></div>
        <div><dt>${esc(t('sbom.summary.format'))}</dt><dd>${esc(bom.bomFormat)} ${esc(bom.specVersion || '')}</dd></div>
        <div><dt>${esc(t('sbom.summary.generated'))}</dt><dd>${esc(generated)}</dd></div></dl>
    </section>
    <section class="card sbom-inventory" aria-labelledby="sbom-inventory-heading">
      <div class="sbom-section-heading"><div><h2 id="sbom-inventory-heading">${esc(t('sbom.components.title'))}</h2><p>${esc(t('sbom.components.hint'))}</p></div>
        <span id="sbom-result-count" role="status" aria-live="polite"></span></div>
      <div class="sbom-filter-row"><div class="sbom-search-field"><label for="sbom-component-search">${esc(t('sbom.search.label'))}</label>
        <input type="search" id="sbom-component-search" value="${esc(sbomState.query)}" placeholder="${esc(t('sbom.search.ph'))}" autocomplete="off" aria-controls="sbom-component-list"></div>
        <div class="sbom-scope-controls" role="group" aria-label="${esc(t('sbom.scope.label'))}">
          ${['all', 'required', 'optional', 'excluded'].map(scope => `<button type="button" class="sbom-scope-btn ${scope}" data-scope="${scope}" aria-pressed="${sbomState.scopeFilter === scope}"></button>`).join('')}</div></div>
      <div class="sbom-workspace"><div id="sbom-component-list" aria-label="${esc(t('sbom.components.title'))}"></div>
        <div class="sbom-visual-pane"><section class="sbom-graph-section" aria-labelledby="sbom-graph-heading">
          <div class="sbom-graph-heading"><h3 id="sbom-graph-heading">${esc(t('sbom.graph.title'))}</h3>
            <div class="sbom-graph-controls" role="group" aria-label="${esc(t('sbom.graph.controls'))}">
              <button type="button" id="sbom-zoom-out" aria-label="${esc(t('sbom.graph.zoomOut'))}" title="${esc(t('sbom.graph.zoomOut'))}">−</button>
              <span id="sbom-zoom-level" aria-live="off">100%</span>
              <button type="button" id="sbom-zoom-in" aria-label="${esc(t('sbom.graph.zoomIn'))}" title="${esc(t('sbom.graph.zoomIn'))}">+</button>
              <button type="button" id="sbom-fit">${esc(t('sbom.graph.fit'))}</button></div></div>
          <p class="sbom-graph-description">${esc(t('sbom.graph.description'))}</p>
          <div class="sbom-graph-canvas"><svg id="sbom-graph-svg" role="group" aria-label="${esc(t('sbom.graph.title'))}" aria-describedby="sbom-graph-keyboard"></svg></div>
          <div class="sbom-graph-footer"><p id="sbom-graph-hint"></p><p id="sbom-graph-keyboard">${esc(t('sbom.graph.keyboard'))}</p></div>
        </section>
        <section id="sbom-node-detail" aria-labelledby="sbom-detail-heading"><div class="sbom-detail-heading"><h3 id="sbom-detail-heading">${esc(t('sbom.node.selected'))}</h3>
          <button type="button" id="sbom-close-detail" class="btn btn-ghost" hidden aria-label="${esc(t('sbom.detail.close'))}">×</button></div>
          <div id="sbom-node-detail-content"></div></section>
      </div></div>
    </section>`;
  const search = document.getElementById('sbom-component-search');
  search.addEventListener('input', event => { if (!event.isComposing) updateSbomQuery(search.value); });
  search.addEventListener('compositionend', () => updateSbomQuery(search.value));
  document.querySelectorAll('#panel-sbom .sbom-scope-btn').forEach(button => button.addEventListener('click', () => setSbomScope(button.dataset.scope)));
  document.getElementById('sbom-zoom-in').addEventListener('click', sbomGraphZoomIn);
  document.getElementById('sbom-zoom-out').addEventListener('click', sbomGraphZoomOut);
  document.getElementById('sbom-fit').addEventListener('click', sbomGraphReset);
  document.getElementById('sbom-close-detail').addEventListener('click', () => {
    const selected = sbomState.selectedIndex;
    sbomState.selectedIndex = null;
    renderSbomSelection();
    (document.querySelector(`.sbom-component-button[data-component-index="${selected}"]`) || search).focus({ preventScroll: true });
  });
  renderSbomResults();
}

function updateSbomQuery(query) {
  sbomState.query = query;
  renderSbomResults();
}

function setSbomScope(scope) {
  sbomState.scopeFilter = scope;
  renderSbomResults();
}

function sbomScopeLabel(scope) {
  return ['required', 'optional', 'excluded'].includes(scope) ? t(`sbom.filter.${scope}`) : (scope || t('sbom.scope.unknown'));
}

function renderSbomResults() {
  if (!sbomState.data) return;
  const components = sbomState.data.components;
  const query = sbomState.query.trim().toLocaleLowerCase();
  const entries = components.map((component, index) => ({ ...component, componentIndex: index }));
  const filtered = entries.filter(component => (sbomState.scopeFilter === 'all' || component.scope === sbomState.scopeFilter)
    && (!query || [component.name, component.group, component.version, component.purl].some(value => (value || '').toLocaleLowerCase().includes(query))));
  document.querySelectorAll('#panel-sbom .sbom-scope-btn').forEach(button => {
    const scope = button.dataset.scope;
    button.textContent = `${t(`sbom.filter.${scope}`)} (${scope === 'all' ? components.length : components.filter(component => component.scope === scope).length})`;
    button.setAttribute('aria-pressed', String(sbomState.scopeFilter === scope));
    button.classList.toggle('active', sbomState.scopeFilter === scope);
  });
  document.getElementById('sbom-result-count').textContent = `${filtered.length.toLocaleString()} / ${components.length.toLocaleString()} ${t('sbom.meta.components')}`;
  if (sbomState.selectedIndex !== 'root' && !filtered.some(component => component.componentIndex === sbomState.selectedIndex)) sbomState.selectedIndex = null;
  const list = document.getElementById('sbom-component-list');
  list.innerHTML = filtered.length ? filtered.map(component => `<button type="button" class="sbom-component-button" data-component-index="${component.componentIndex}"
      aria-pressed="${sbomState.selectedIndex === component.componentIndex}" aria-controls="sbom-node-detail">
      <span class="sbom-component-name">${esc(component.name || '—')}</span><span class="sbom-component-version">${esc(component.version || '—')}</span>
      <span class="sbom-component-group">${esc(component.group || component.purl || '—')}</span>
      <span class="sbom-scope-badge" style="color:${sbomScopeColor(component.scope)}">${esc(sbomScopeLabel(component.scope))}</span></button>`).join('')
    : `<div class="sbom-list-empty"><strong>${esc(t(components.length ? 'sbom.noMatch' : 'sbom.empty.title'))}</strong>
      ${components.length ? `<button type="button" id="sbom-clear-filters" class="btn btn-ghost">${esc(t('sbom.clearFilters'))}</button>` : `<p>${esc(t('sbom.empty.hint'))}</p>`}</div>`;
  list.querySelectorAll('.sbom-component-button').forEach(button => button.addEventListener('click', () => selectSbomNode({ componentIndex: Number(button.dataset.componentIndex) })));
  document.getElementById('sbom-clear-filters')?.addEventListener('click', () => {
    sbomState.query = '';
    sbomState.scopeFilter = 'all';
    document.getElementById('sbom-component-search').value = '';
    renderSbomResults();
    document.getElementById('sbom-component-search').focus();
  });
  initSbomGraphCanvas();
  renderSbomGraph(sbomState.data.metadata?.component?.name || sbomState.projectId, filtered);
  renderSbomSelection();
}

/* ── SBOM dependency graph (root → direct dependencies) ── */
const SBOM_SCOPE_COLORS = { required: '#6ee7b7', optional: '#f5bd66', excluded: '#f87171' };
const SBOM_GRAPH_LARGE_THRESHOLD = 60;
const SBOM_GRAPH_MAX_NODES = 300;
let sbomGraphZoomBehavior = null;
let sbomGraphSvgEl = null;
let _currentSbomGraphSim = null;
let sbomGraphNodes = [];
let sbomGraphResizeObserver = null;

function sbomScopeColor(scope) { return SBOM_SCOPE_COLORS[scope] || '#94a3b8'; }

function stopSbomGraph() {
  sbomGraphResizeObserver?.disconnect();
  sbomGraphResizeObserver = null;
  if (_currentSbomGraphSim) _currentSbomGraphSim.stop();
  _currentSbomGraphSim = null;
  sbomGraphSvgEl?.interrupt();
  sbomGraphSvgEl = null;
  sbomGraphZoomBehavior = null;
  sbomGraphNodes = [];
  hideTooltip();
}

function initSbomGraphCanvas() {
  stopSbomGraph();
  const svg = d3.select('#sbom-graph-svg');
  if (!svg.node()) return;
  sbomGraphSvgEl = svg;
  sbomGraphZoomBehavior = d3.zoom().scaleExtent([0.05, 4]).on('zoom', event => {
    svg.select('.zoom-g').attr('transform', event.transform);
    const level = document.getElementById('sbom-zoom-level');
    if (level) level.textContent = `${Math.round(event.transform.k * 100)}%`;
  });
  svg.call(sbomGraphZoomBehavior).on('dblclick.zoom', null);
  if (svg.select('.zoom-g').empty()) svg.append('g').attr('class', 'zoom-g');
  let lastWidth = 0;
  let lastHeight = 0;
  sbomGraphResizeObserver = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect;
    const changed = width !== lastWidth || height !== lastHeight;
    lastWidth = width;
    lastHeight = height;
    if (changed && width > 0 && height > 0 && sbomGraphSvgEl?.node() === svg.node()) sbomGraphReset();
  });
  sbomGraphResizeObserver.observe(svg.node().parentElement);
}

function sbomGraphZoomIn() { if (sbomGraphSvgEl && sbomGraphZoomBehavior) sbomGraphSvgEl.call(sbomGraphZoomBehavior.scaleBy, 1.4); }
function sbomGraphZoomOut() { if (sbomGraphSvgEl && sbomGraphZoomBehavior) sbomGraphSvgEl.call(sbomGraphZoomBehavior.scaleBy, 1 / 1.4); }
function sbomGraphReset() {
  if (!sbomGraphSvgEl || !sbomGraphZoomBehavior || !sbomGraphNodes.length) return;
  const svg = sbomGraphSvgEl.node();
  if (!svg.clientWidth || !svg.clientHeight) return;
  const left = Math.min(...sbomGraphNodes.map(node => node.x - 24));
  const right = Math.max(...sbomGraphNodes.map(node => node.x + 24));
  const top = Math.min(...sbomGraphNodes.map(node => node.y - 24));
  const bottom = Math.max(...sbomGraphNodes.map(node => node.y + 40));
  const scale = Math.max(.05, Math.min(1, (svg.clientWidth - 32) / (right - left + 180), (svg.clientHeight - 32) / (bottom - top + 64)));
  sbomGraphSvgEl.call(sbomGraphZoomBehavior.transform, d3.zoomIdentity
    .translate(svg.clientWidth / 2 - (left + right) * scale / 2, svg.clientHeight / 2 - (top + bottom) * scale / 2).scale(scale));
}

function renderSbomGraph(rootLabel, components) {
  if (!sbomGraphSvgEl) return;
  const group = sbomGraphSvgEl.select('.zoom-g');
  group.selectAll('*').remove();
  const hint = document.getElementById('sbom-graph-hint');
  const capped = components.slice(0, SBOM_GRAPH_MAX_NODES);
  const isLarge = capped.length >= SBOM_GRAPH_LARGE_THRESHOLD;
  document.querySelectorAll('#panel-sbom .sbom-graph-controls button').forEach(button => { button.disabled = !capped.length; });
  if (!capped.length) {
    sbomGraphNodes = [];
    hint.textContent = t(components.length ? 'sbom.graph.hint.empty' : (sbomState.data.components.length ? 'sbom.noMatch' : 'sbom.empty.title'));
    document.getElementById('sbom-zoom-level').textContent = '—';
    return;
  }
  hint.textContent = `${t('sbom.graph.capped')} ${capped.length} / ${components.length} · ${t('sbom.graph.capHint')}`;
  const root = { id: 'root', name: rootLabel, isRoot: true, x: 0, y: 0, fx: 0, fy: 0 };
  const radius = Math.max(140, capped.length * (isLarge ? 3 : 7));
  const dependencies = capped.map((component, index) => ({ ...component, id: `component-${component.componentIndex}`,
    x: Math.cos(index * Math.PI * 2 / capped.length) * radius, y: Math.sin(index * Math.PI * 2 / capped.length) * radius }));
  const nodes = [root, ...dependencies];
  // Bind actual node objects in both static and force layouts; duplicate bom-ref values remain independent entries.
  const links = dependencies.map(target => ({ source: root, target }));
  if (!isLarge) {
    const simulation = d3.forceSimulation(nodes).stop().alphaDecay(.1)
      .force('link', d3.forceLink(links).id(node => node.id).distance(110).strength(.6))
      .force('charge', d3.forceManyBody().strength(-320)).force('collision', d3.forceCollide(40));
    _currentSbomGraphSim = simulation;
    simulation.tick(70);
    simulation.stop();
    _currentSbomGraphSim = null;
  }
  sbomGraphNodes = nodes;
  const link = group.append('g').attr('class', 'links').selectAll('line').data(links).join('line')
    .attr('stroke', '#6ee7b7').attr('stroke-width', isLarge ? 1 : 1.5).attr('stroke-opacity', .23);
  const node = group.append('g').attr('class', 'nodes').selectAll('g').data(nodes).join('g')
    .attr('role', 'button').attr('tabindex', (datum, index) => index === 0 ? 0 : -1)
    .attr('aria-label', datum => datum.isRoot ? `${t('sbom.legend.root')}: ${datum.name}` : `${datum.name || '—'} · ${datum.version || '—'} · ${sbomScopeLabel(datum.scope)}`)
    .attr('aria-controls', 'sbom-node-detail')
    .on('click', (event, datum) => selectSbomNode(datum))
    .on('keydown', function(event, datum) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectSbomNode(datum); }
      else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = nodes.indexOf(datum);
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1
          : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + nodes.length) % nodes.length;
        node.attr('tabindex', (_, nodeIndex) => nodeIndex === target ? 0 : -1);
        node.nodes()[target].focus();
      }
    })
    .on('mouseover', (event, datum) => showTooltip(event, datum.purl || datum.name))
    .on('mouseout', hideTooltip)
    .call(d3.drag().on('start', (event, datum) => { datum.fx = datum.x; datum.fy = datum.y; })
      .on('drag', (event, datum) => { datum.x = datum.fx = event.x; datum.y = datum.fy = event.y; _updateSbomGraphPositions(link, node); }));
  node.append('title').text(datum => datum.name || '—');
  node.append('circle').attr('r', datum => datum.isRoot ? 20 : (isLarge ? 7 : 13))
    .attr('fill', '#17212d').attr('stroke', datum => datum.isRoot ? '#dce8f0' : sbomScopeColor(datum.scope)).attr('stroke-width', 2);
  node.append('text').attr('text-anchor', 'middle').attr('dy', datum => datum.isRoot ? 37 : 29)
    .attr('fill', '#dce8f0').attr('font-family', 'var(--fm)').attr('font-size', 12)
    .attr('paint-order', 'stroke').attr('stroke', '#111923').attr('stroke-width', 4).attr('stroke-linejoin', 'round')
    .attr('pointer-events', 'none').text(datum => {
      if (isLarge && !datum.isRoot) return '';
      return (datum.name || '').length > 22 ? datum.name.slice(0, 21) + '…' : datum.name;
    });
  _updateSbomGraphPositions(link, node);
  sbomGraphReset();
}

function _updateSbomGraphPositions(link, node) {
  link.attr('x1', datum => datum.source.x).attr('y1', datum => datum.source.y)
    .attr('x2', datum => datum.target.x).attr('y2', datum => datum.target.y);
  node.attr('transform', datum => `translate(${datum.x},${datum.y})`);
}

function selectSbomNode(node) {
  sbomState.selectedIndex = node.isRoot ? 'root' : node.componentIndex;
  renderSbomSelection();
}

function renderSbomSelection() {
  const content = document.getElementById('sbom-node-detail-content');
  if (!content) return;
  const selected = sbomState.selectedIndex;
  document.querySelectorAll('#panel-sbom .sbom-component-button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.componentIndex) === selected)));
  sbomGraphSvgEl?.selectAll('.nodes > g').attr('aria-pressed', node => String((node.isRoot ? 'root' : node.componentIndex) === selected));
  document.getElementById('sbom-close-detail').hidden = selected === null;
  if (selected === null) { content.innerHTML = `<p class="sbom-detail-empty">${esc(t('sbom.detail.initial'))}</p>`; return; }
  const component = selected === 'root' ? sbomState.data.metadata?.component || { name: sbomState.projectId } : sbomState.data.components[selected];
  const fields = selected === 'root' ? [['sbom.node.name', component.name], ['sbom.col.version', component.version]]
    : [['sbom.col.name', component.name], ['sbom.col.group', component.group], ['sbom.col.version', component.version], ['sbom.col.scope', sbomScopeLabel(component.scope)], ['sbom.col.purl', component.purl]];
  content.innerHTML = `<dl class="sbom-detail-fields">${fields.map(([key, value]) => `<div><dt>${esc(t(key))}</dt><dd>${esc(value || '—')}</dd></div>`).join('')}</dl>`;
}

function downloadSbomJson() {
  if (sbomState.status !== 'ready' || !sbomState.raw) return;
  const url = URL.createObjectURL(new Blob([sbomState.raw], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `sbom-${sbomState.projectId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Manage projects ── */
let managedProjects = null;
let managedProjectsVersion = 0;
let managedProjectsLoading = false;
let managedProjectsError = '';
const managedProjectDeletes = new Set();
const managedProjectErrors = new Map();

function filterManagedProjects() {
  renderManagedProjects();
}

function clearManagedProjectsFilter() {
  const input = document.getElementById('tools-project-search');
  input.value = '';
  renderManagedProjects();
  input.focus();
}

function renderManagedProjects() {
  const container = document.getElementById('projects-manage-list');
  const status = document.getElementById('tools-project-status');
  if (!container || !status) return;
  container.setAttribute('aria-busy', String(managedProjectsLoading));
  document.getElementById('tools-refresh-projects').disabled = managedProjectsLoading;
  if (managedProjectsError) {
    status.innerHTML = `<div class="tools-feedback tools-error" role="alert"><strong>${esc(t('tools.project.loadError'))}</strong>
      <p>${esc(managedProjectsError)}</p>${managedProjects !== null ? `<p class="tools-cached-hint">${esc(t('tools.project.cached'))}</p>` : ''}
      <button type="button" id="tools-project-retry" class="btn btn-ghost">${esc(t('tools.retry'))}</button></div>`;
    status.querySelector('button').addEventListener('click', renderProjectsManage);
  } else if (managedProjectsLoading) {
    status.innerHTML = `<div class="tools-feedback tools-loading"><span class="spinner" aria-hidden="true"></span>${esc(t(managedProjects === null ? 'tools.project.loading' : 'tools.project.refreshing'))}</div>`;
  } else {
    status.replaceChildren();
  }
  const query = document.getElementById('tools-project-search').value.trim().toLocaleLowerCase();
  const projects = (managedProjects || []).filter(project => [projectName(project), project.projectId, project.projectRoot]
    .some(value => String(value || '').toLocaleLowerCase().includes(query)));
  document.getElementById('tools-project-count').textContent = managedProjects === null ? ''
    : `${projects.length.toLocaleString()} / ${managedProjects.length.toLocaleString()} ${t('tools.project.count')}`;
  if (managedProjects === null) {
    container.replaceChildren();
    return;
  }
  const active = document.activeElement;
  const focusedId = container.contains(active) ? active.closest('[data-project-id]')?.dataset.projectId : null;
  const focusedAction = active?.dataset.toolsAction;
  if (!projects.length) {
    container.innerHTML = query ? `<div class="tools-empty"><strong>${esc(t('tools.project.noMatch'))}</strong>
      <button type="button" id="tools-clear-filter" class="btn btn-ghost">${esc(t('tools.project.clear'))}</button></div>`
      : `<div class="tools-empty"><strong>${esc(t('tools.manage.empty'))}</strong><p>${esc(t('tools.project.emptyHint'))}</p>
        <a href="#index" class="btn btn-primary tools-index-link">${esc(t('tools.project.index'))}</a></div>`;
    container.querySelector('#tools-clear-filter')?.addEventListener('click', clearManagedProjectsFilter);
    return;
  }
  container.innerHTML = projects.map(project => {
    const pending = managedProjectDeletes.has(project.projectId);
    const error = managedProjectErrors.get(project.projectId);
    const timestamp = Date.parse(project.indexedAt);
    const indexedAt = Number.isFinite(timestamp)
      ? `<time datetime="${esc(project.indexedAt)}" title="${esc(new Date(timestamp).toLocaleString())}">${esc(relativeTime(project.indexedAt))}</time>`
      : esc(t('tools.project.unknownTime'));
    return `<article class="tools-project" data-project-id="${esc(project.projectId)}">
      <div class="tools-project-main"><h3>${esc(projectName(project))}</h3><code class="tools-project-id">${esc(project.projectId)}</code>
        <p class="tools-project-root"><span>${esc(t('tools.project.root'))}</span><code>${esc(project.projectRoot || t('tools.project.unknownRoot'))}</code></p></div>
      <dl class="tools-project-meta"><div><dt>${esc(t('tools.project.units'))}</dt><dd class="tools-project-units">${Number(project.nodeCount || 0).toLocaleString()}</dd></div>
        <div><dt>${esc(t('tools.project.indexedAt'))}</dt><dd>${indexedAt}</dd></div></dl>
      <div class="tools-project-actions"><a class="btn btn-ghost tools-overview" data-tools-action="overview" href="#stats=${encodeURIComponent(project.projectId)}">${esc(t('tools.project.overview'))}<span aria-hidden="true">↗</span></a>
        <button type="button" class="btn btn-ghost tools-delete" data-tools-action="delete" ${pending ? 'disabled' : ''}>${esc(t(pending ? 'tools.project.deleting' : 'btn.delete'))}</button></div>
      ${error ? `<p class="tools-project-error" role="alert">${esc(t('delete.failed', error))}</p>` : ''}</article>`;
  }).join('');
  container.querySelectorAll('.tools-project').forEach(card => {
    const project = projects.find(item => item.projectId === card.dataset.projectId);
    card.querySelector('.tools-delete').addEventListener('click', () => deleteProject(project.projectId, project.projectRoot || ''));
    if (focusedId === project.projectId && focusedAction) {
      card.querySelector(`[data-tools-action="${focusedAction}"]`)?.focus({ preventScroll: true });
    }
  });
}

async function renderProjectsManage() {
  const version = ++managedProjectsVersion;
  managedProjectsLoading = true;
  managedProjectsError = '';
  renderManagedProjects();
  try {
    const projects = await api.projects();
    if (version !== managedProjectsVersion) return;
    managedProjects = projects || [];
  } catch (error) {
    if (version !== managedProjectsVersion) return;
    managedProjectsError = error.message;
  }
  managedProjectsLoading = false;
  renderManagedProjects();
}

async function deleteProject(projectId, projectRoot) {
  if (managedProjectDeletes.has(projectId)) return;
  managedProjectDeletes.add(projectId);
  if (!await showDeleteModal(projectId, projectRoot)) {
    managedProjectDeletes.delete(projectId);
    renderManagedProjects();
    if (document.querySelector('#panel-tools.active')) {
      const card = Array.from(document.querySelectorAll('.tools-project')).find(item => item.dataset.projectId === projectId);
      card?.querySelector('.tools-delete')?.focus({ preventScroll: true });
    }
    return;
  }
  managedProjectErrors.delete(projectId);
  renderManagedProjects();
  let removed = false;
  try {
    await api.deleteProject(projectId, projectRoot);
    removed = true;
    // Invalidate reads captured before this mutation before showing the local removal.
    managedProjectsVersion++;
    managedProjectsLoading = false;
    managedProjectsError = '';
    managedProjects = (managedProjects || []).filter(project => project.projectId !== projectId);
    if (state.activeProjectId === projectId) setGlobalProject('');
    if (typeof resetDeletedIndexRoot === 'function') resetDeletedIndexRoot(projectRoot);
    renderManagedProjects();
    showToast(t('delete.succeeded', projectRoot || projectId));
    await refreshProjectsList();
    await renderProjectsManage();
  } catch (error) {
    managedProjectErrors.set(projectId, error.message);
    showToast(t('delete.failed', error.message), 5000, 'error');
  } finally {
    managedProjectDeletes.delete(projectId);
    renderManagedProjects();
    if (document.querySelector('#panel-tools.active') && (document.activeElement === document.body || document.activeElement?.disabled)) {
      const remaining = Array.from(document.querySelectorAll('.tools-project')).find(card => card.dataset.projectId === projectId);
      (removed ? document.getElementById('tools-project-search') : remaining?.querySelector('.tools-delete'))?.focus({ preventScroll: true });
    }
  }
}

/* ── Benchmark ── */
const benchmarkState = {
  version: 0, status: 'idle', data: null, error: '', errorKey: '',
  onlyMisses: { semantic: false, code: false }, openCases: new Set(),
};
let benchmarkLanguage = null;

function refreshBenchmarkLanguage() {
  if (benchmarkLanguage === currentLang) return;
  benchmarkLanguage = currentLang;
  renderBenchmark();
}

function validBenchmarkSnapshot(data) {
  if (!data || typeof data !== 'object' || typeof data.projectLabel !== 'string' || typeof data.generatedAt !== 'string') return false;
  if (!data.semantic && !data.code) return false;
  const rates = ['threshold', 'hit1Rate', 'hit3Rate', 'hit5Rate', 'hit10Rate', 'mrr10'];
  return ['semantic', 'code'].every(key => {
    const section = data[key];
    if (section == null) return true;
    return typeof section.title === 'string' && typeof section.passed === 'boolean'
      && Number.isInteger(section.total) && section.total >= 0 && Array.isArray(section.cases)
      && section.cases.length === section.total
      && rates.every(rate => Number.isFinite(section[rate]) && section[rate] >= 0 && section[rate] <= 1)
      && section.cases.every(item => item && typeof item.id === 'string' && typeof item.description === 'string'
        && Number.isInteger(item.rank) && item.rank >= 0 && Number.isFinite(item.topScore) && Number.isFinite(item.hitScore)
        && typeof item.topResult === 'string' && ['hit1', 'hit3', 'hit5', 'hit10'].every(hit => typeof item[hit] === 'boolean'));
  });
}

async function loadBenchmark() {
  const version = ++benchmarkState.version;
  Object.assign(benchmarkState, { status: 'loading', error: '', errorKey: '' });
  renderBenchmark();
  try {
    const response = await fetch('/api/v1/benchmark/results');
    if (version !== benchmarkState.version) return;
    if (response.status === 404) {
      benchmarkState.data = null;
      benchmarkState.status = 'empty';
    } else {
      if (!response.ok) throw new Error(await apiError(response));
      let data;
      try {
        data = await response.json();
        if (!validBenchmarkSnapshot(data)) throw new Error('Invalid snapshot');
      } catch (_) {
        throw Object.assign(new Error(t('benchmark.invalid')), { benchmarkKey: 'benchmark.invalid' });
      }
      if (version !== benchmarkState.version) return;
      const previous = benchmarkState.data;
      if (!previous || previous.projectLabel !== data.projectLabel || previous.generatedAt !== data.generatedAt) {
        benchmarkState.openCases.clear();
        document.querySelectorAll('#bm-content details[open]').forEach(detail => { detail.open = false; });
      }
      benchmarkState.data = data;
      benchmarkState.status = 'ready';
    }
  } catch (error) {
    if (version !== benchmarkState.version) return;
    benchmarkState.status = 'error';
    benchmarkState.error = error.message;
    benchmarkState.errorKey = error.benchmarkKey || '';
  }
  if (version === benchmarkState.version) renderBenchmark();
}

function renderBenchmark() {
  const body = document.getElementById('bm-body');
  const content = document.getElementById('bm-content');
  if (!body || !content) return;
  const scrollTop = body.scrollTop;
  const active = document.querySelector('#panel-benchmark')?.contains(document.activeElement) ? document.activeElement : null;
  const focusId = active?.id;
  document.querySelectorAll('#bm-content .bm-case').forEach(detail => {
    if (detail.open) benchmarkState.openCases.add(detail.id);
    else benchmarkState.openCases.delete(detail.id);
  });
  const { data, status } = benchmarkState;
  body.setAttribute('aria-busy', String(status === 'loading'));
  document.getElementById('bm-refresh').disabled = status === 'loading';
  const meta = document.getElementById('bm-run-meta');
  meta.hidden = !data;
  meta.innerHTML = data ? `<div class="bm-source-corpus"><span>${esc(t('benchmark.source'))}</span><strong>${esc(data.projectLabel)}</strong></div>
    <div class="bm-source-time"><span>${esc(t('benchmark.generated'))}</span><time>${esc(data.generatedAt)}</time></div>` : '';
  const feedback = document.getElementById('bm-status');
  if (status === 'loading') {
    feedback.innerHTML = `<div class="bm-feedback bm-loading"><span class="spinner" aria-hidden="true"></span>${esc(t(data ? 'benchmark.refreshing' : 'benchmark.loading'))}</div>`;
  } else if (status === 'error') {
    feedback.innerHTML = `<div class="bm-feedback bm-error" role="alert"><strong>${esc(t('benchmark.error'))}</strong>
      <p>${esc(benchmarkState.errorKey ? t(benchmarkState.errorKey) : benchmarkState.error)}</p>
      ${data ? `<p class="bm-cached-note">${esc(t('benchmark.cached'))}</p>` : ''}
      <button type="button" class="btn btn-ghost" id="bm-retry">${esc(t('benchmark.retry'))}</button></div>`;
  } else if (status === 'empty') {
    feedback.innerHTML = `<div class="bm-feedback bm-empty"><h2>${esc(t('benchmark.noResults'))}</h2><p>${esc(t('benchmark.emptyHint'))}</p>
      <code>~/.repograph/benchmark-latest.json</code><p>${esc(t('benchmark.readOnly'))}</p>
      <button type="button" class="btn btn-ghost" id="bm-retry">${esc(t('benchmark.retry'))}</button></div>`;
  } else {
    feedback.replaceChildren();
  }
  content.innerHTML = data ? renderBmSection(data.semantic, 'semantic') + renderBmSection(data.code, 'code') : '';
  document.getElementById('bm-retry')?.addEventListener('click', loadBenchmark);
  content.querySelectorAll('.bm-miss-filter input').forEach(input => input.addEventListener('change', () => {
    benchmarkState.onlyMisses[input.dataset.section] = input.checked;
    renderBenchmark();
  }));
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  body.scrollTop = scrollTop;
}

function renderBmSection(section, key) {
  const title = t(`benchmark.${key}`);
  if (!section) return `<section class="bm-section bm-section-missing" id="bm-section-${key}" aria-labelledby="bm-heading-${key}">
    <div class="bm-section-heading"><h2 id="bm-heading-${key}">${esc(title)}</h2><span class="bm-status-neutral">${esc(t('benchmark.notProvided'))}</span></div>
    <p>${esc(t('benchmark.sectionMissing'))}</p></section>`;
  const evaluated = section.total > 0;
  const statusClass = evaluated ? (section.passed ? 'bm-status-pass' : 'bm-status-fail') : 'bm-status-neutral';
  const status = evaluated ? (section.passed ? 'benchmark.passed' : 'benchmark.failed') : 'benchmark.noQueries';
  const rows = section.cases.map((item, index) => ({ item, index })).filter(({ item }) => !benchmarkState.onlyMisses[key] || !item.hit10);
  return `<section class="bm-section" id="bm-section-${key}" aria-labelledby="bm-heading-${key}">
    <div class="bm-section-heading"><div><h2 id="bm-heading-${key}">${esc(title)}</h2><code>${esc(section.title)}</code></div>
      <span class="${statusClass}">${esc(t(status))}</span></div>
    <div class="bm-overview"><div class="bm-primary-metric"><span>Hit@10</span><strong>${pctFmt(section.hit10Rate)}</strong>
        <p class="bm-threshold">${esc(t('benchmark.threshold'))} · Hit@10 ≥ ${pctFmt(section.threshold)}</p></div>
      <div class="bm-mrr"><span>MRR@10</span><strong>${section.mrr10.toFixed(3)}</strong><small>${section.total.toLocaleString()} ${esc(t('benchmark.queryCount'))}</small></div></div>
    <dl class="bm-secondary-metrics">${[1, 3, 5].map(k => `<div><dt>Hit@${k}</dt><dd>${pctFmt(section[`hit${k}Rate`])}</dd></div>`).join('')}</dl>
    <p class="bm-metric-note">${esc(t('benchmark.thresholdHint'))}</p>
    <div class="bm-details-heading"><h3>${esc(t('benchmark.details'))} <span>${rows.length} / ${section.total}</span></h3>
      <label class="bm-miss-filter"><input type="checkbox" id="bm-${key}-misses" data-section="${key}" ${benchmarkState.onlyMisses[key] ? 'checked' : ''}>${esc(t('benchmark.onlyMisses'))}</label></div>
    <div class="bm-cases">${rows.length ? rows.map(({ item, index }) => renderBenchmarkCase(item, key, index)).join('')
      : `<p class="bm-query-empty">${esc(t(evaluated ? 'benchmark.noMisses' : 'benchmark.noQueries'))}</p>`}</div>
  </section>`;
}

function renderBenchmarkCase(item, key, index) {
  const id = `bm-case-${key}-${index}`;
  const rank = item.rank > 0 ? item.rank : '—';
  const hitScore = item.rank > 0 ? item.hitScore.toFixed(3) : '—';
  return `<details class="bm-case ${item.hit10 ? 'bm-case-hit' : 'bm-case-miss'}" id="${id}" ${benchmarkState.openCases.has(id) ? 'open' : ''}>
    <summary id="${id}-summary"><span class="bm-case-id">${esc(item.id)}</span><span class="bm-case-description">${esc(item.description)}</span>
      <span class="bm-case-result">${esc(t(item.hit10 ? 'benchmark.match' : 'benchmark.miss'))}</span><span class="bm-case-chevron" aria-hidden="true">›</span></summary>
    <div class="bm-case-content"><dl class="bm-case-hits">${[1, 3, 5, 10].map(k => `<div><dt>Hit@${k}</dt><dd class="${item[`hit${k}`] ? 'bm-result-hit' : 'bm-result-miss'}">${bmMark(item[`hit${k}`])}</dd></div>`).join('')}</dl>
      <dl class="bm-case-scores"><div><dt>${esc(t('benchmark.rank'))}</dt><dd>${rank}</dd></div>
        <div><dt>${esc(t('benchmark.hitScore'))}</dt><dd data-metric="hitScore">${hitScore}</dd></div>
        <div><dt>${esc(t('benchmark.topScore'))}</dt><dd>${item.topScore.toFixed(3)}</dd></div></dl>
      <div class="bm-top-result"><span>${esc(t('benchmark.topResult'))}</span><code>${esc(item.topResult || t('benchmark.noTopResult'))}</code></div>
      <p class="bm-score-note">${esc(t('benchmark.scoreHint'))}</p></div></details>`;
}

function bmMark(hit) {
  return `<span aria-hidden="true">${hit ? '✓' : '−'}</span> ${esc(t(hit ? 'benchmark.hit' : 'benchmark.notHit'))}`;
}

function pctFmt(rate) {
  return (rate * 100).toFixed(1) + '%';
}

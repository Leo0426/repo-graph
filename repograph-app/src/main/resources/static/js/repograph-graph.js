let graphZoomBehavior = null;
let graphSvgEl = null;
// Track running simulations so we can stop them before starting a new render
let _currentGraphSim = null;
let _currentFlowSim  = null;
let graphQuerySequence = 0;
let graphSymbolsSequence = 0;
let graphFitNodes = [];
let graphFitTop = 24;
let graphDisplayedContext = null;

function renderGraphModeLabel() {
  const value = document.getElementById('graph-current-mode');
  if (value) value.textContent = t('graph.currentMode', t(`graph.${state.graphMode}`));
}

function graphMotionDuration() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
}

function stopGraphSimulations() {
  _currentGraphSim?.stop();
  _currentFlowSim?.stop();
  _currentGraphSim = null;
  _currentFlowSim = null;
}

function clearGraphSelection() {
  if (typeof readerView !== 'undefined' && readerView.source === 'graph') closeResultReader(false);
  state.selectedNode = null;
  document.getElementById('node-detail').style.display = 'none';
  document.getElementById('node-detail-content').replaceChildren();
  d3.selectAll('#graph-svg .graph-node').attr('aria-pressed', 'false');
  d3.selectAll('#graph-svg .graph-node, #graph-svg .graph-connection').classed('is-context', false).classed('is-selected', false);
  document.getElementById('graph-source-status').textContent = '';
}

function clearGraphCanvas() {
  if (typeof readerView !== 'undefined' && readerView.source === 'graph') closeResultReader(false);
  graphDisplayedContext = null;
  stopGraphSimulations();
  clearGraphSelection();
  hideTooltip();
  graphFitNodes = [];
  d3.select('#graph-svg').interrupt().select('.zoom-g').selectAll('*').remove();
  document.getElementById('flow-summary').classList.remove('visible');
  document.getElementById('flow-view-switch').classList.remove('visible');
}

function setGraphBusy(busy) {
  document.getElementById('graph-query-btn').disabled = busy;
  document.getElementById('graph-query-label').textContent = t(busy ? 'graph.loading' : 'graph.queryAction');
  document.querySelector('#panel-graph .graph-canvas').setAttribute('aria-busy', String(busy));
}

function setGraphMessage(status, message) {
  const hint = document.getElementById('graph-hint');
  hint.removeAttribute('data-i18n');
  hint.textContent = message;
  const overlay = document.getElementById('graph-state');
  overlay.hidden = status === 'loaded';
  overlay.dataset.status = status;
  document.getElementById('graph-state-title').textContent = t(status === 'ready'
    ? 'graph.readyTitle' : status === 'loading' ? 'graph.loading' : 'graph.emptyTitle');
  document.getElementById('graph-state-message').textContent = message;
  document.getElementById('graph-retry').hidden = status !== 'error';
}

function graphQueryContext() {
  const mode = state.graphMode;
  const projectMode = ['entrypoints', 'deadcode', 'testgap'].includes(mode);
  const rawProject = document.getElementById(projectMode ? 'entrypoints-project' : 'graph-project').value.trim();
  return {
    mode,
    projectId: resolveProjectId(rawProject) || state.activeProjectId,
    target: projectMode ? '' : document.getElementById('graph-target').value.trim(),
    depth: Number(document.getElementById('graph-depth').value),
    lang: mode === 'entrypoints' ? document.getElementById('entrypoints-lang').value : '',
  };
}

function invalidateGraphQuery() {
  graphQuerySequence++;
  graphSymbolsSequence++;
  clearGraphCanvas();
  state.flowResult = null;
  setGraphBusy(false);
  setGraphMessage('ready', t('graph.queryChanged'));
}

function setGraphMode(mode, btn) {
  invalidateGraphQuery();
  state.graphMode = mode;
  renderGraphModeLabel();
  document.getElementById('graph-tab-row').querySelectorAll('.tab').forEach(tb => {
    tb.classList.remove('active');
    tb.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed', 'true');
  const isEntrypoints = mode === 'entrypoints';
  const isDeadCode    = mode === 'deadcode';
  const isTestGap     = mode === 'testgap';
  const isFlow        = mode === 'flow';
  document.getElementById('graph-target-wrap').style.display = (isEntrypoints || isDeadCode || isTestGap) ? 'none' : '';
  document.getElementById('entrypoints-wrap').style.display  = (isEntrypoints || isDeadCode || isTestGap) ? '' : 'none';
  document.getElementById('depth-wrap').style.display = (mode === 'callers' || mode === 'callees') ? '' : 'none';
  document.getElementById('flow-summary').classList.toggle('visible', isFlow && !!state.flowResult);
  document.getElementById('flow-view-switch').classList.toggle('visible', isFlow && !!state.flowResult);
  document.getElementById('graph-legend-label').style.display = isFlow ? 'none' : '';
  document.querySelector('.graph-legend').style.display = isFlow ? 'none' : '';
  document.getElementById('graph-related-hint').hidden = !['callers', 'callees', 'impact'].includes(mode);
}

function initGraphCanvas() {
  const svg = d3.select('#graph-svg');
  const el = svg.node();
  if (!el) return;
  if (graphSvgEl?.node() === el && graphZoomBehavior) return;
  graphSvgEl = svg;

  graphZoomBehavior = d3.zoom()
    .scaleExtent([0.05, 4])
    .on('zoom', e => {
      svg.select('.zoom-g').attr('transform', e.transform);
      document.getElementById('graph-zoom-level').textContent = `${Math.round(e.transform.k * 100)}%`;
    });

  svg.call(graphZoomBehavior).on('dblclick.zoom', null);

  if (!svg.select('.zoom-g').size()) {
    svg.append('g').attr('class', 'zoom-g');
  }
}

function graphZoomIn() {
  if (graphSvgEl && graphZoomBehavior) graphZoomTarget().call(graphZoomBehavior.scaleBy, 1.4);
}
function graphZoomOut() {
  if (graphSvgEl && graphZoomBehavior) graphZoomTarget().call(graphZoomBehavior.scaleBy, 0.7);
}
function graphZoomTarget() {
  const selection = graphSvgEl.interrupt();
  const duration = graphMotionDuration();
  return duration ? selection.transition().duration(duration) : selection;
}
function graphReset() {
  if (!graphSvgEl || !graphZoomBehavior) return;
  const el = graphSvgEl.node();
  const nodes = graphFitNodes.filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
  if (!nodes.length || !el.clientWidth || !el.clientHeight) return;
  const minX = Math.min(...nodes.map(node => node.x)) - 100;
  const maxX = Math.max(...nodes.map(node => node.x)) + 100;
  const minY = Math.min(...nodes.map(node => node.y)) - 52;
  const maxY = Math.max(...nodes.map(node => node.y)) + 52;
  const width = Math.max(1, el.clientWidth - 48);
  const height = Math.max(1, el.clientHeight - graphFitTop - 92);
  const scale = Math.max(0.01, Math.min(1, width / (maxX - minX), height / (maxY - minY)));
  // Keep Fit reachable even when a large graph needs more zoom-out than the normal wheel limit.
  graphZoomBehavior.scaleExtent([Math.min(0.05, scale), 4]);
  graphZoomTarget().call(
    graphZoomBehavior.transform,
    d3.zoomIdentity.translate(el.clientWidth / 2 - (minX + maxX) / 2 * scale,
      graphFitTop + height / 2 - (minY + maxY) / 2 * scale).scale(scale)
  );
}

function updateGraphClassHint(val) {
  const hint = document.getElementById('graph-class-hint');
  if (!hint) return;
  const isClassFqn = val.trim().length > 0 && val.includes('.') && !val.includes('#');
  hint.style.display = isClassFqn ? '' : 'none';
}

async function loadGraphSymbols() {
  const sequence = ++graphSymbolsSequence;
  const input = document.getElementById('graph-target');
  const query = input ? input.value.trim() : '';
  const dl = document.getElementById('graph-symbols-datalist');
  if (!dl || query.length < 2) {
    if (dl) dl.innerHTML = '';
    return;
  }
  const rawProject = document.getElementById('graph-project').value.trim();
  const projectId = resolveProjectId(rawProject) || state.activeProjectId;
  try {
    const symbols = await api.graphSymbols(query, projectId);
    if (sequence !== graphSymbolsSequence || input.value.trim() !== query
      || (resolveProjectId(document.getElementById('graph-project').value.trim()) || state.activeProjectId) !== projectId) return;
    dl.innerHTML = symbols.map(unit =>
      `<option value="${esc(unit.qualifiedName)}" label="${esc(unit.kind + ' · ' + unit.filePath)}"></option>`
    ).join('');
  } catch (_) {
    if (sequence === graphSymbolsSequence) dl.innerHTML = '';
  }
}

const debouncedGraphSymbols = debounce(loadGraphSymbols, 180);

async function doGraphQuery() {
  const sequence = ++graphQuerySequence;
  const context = graphQueryContext();
  const { mode, target, projectId, depth, lang } = context;
  const projectMode = ['entrypoints', 'deadcode', 'testgap'].includes(mode);
  const current = () => sequence === graphQuerySequence
    && JSON.stringify(context) === JSON.stringify(graphQueryContext());
  clearGraphCanvas();
  state.flowResult = null;
  setGraphBusy(false);
  if (!projectMode && !target) {
    setGraphMessage('ready', t('graph.targetRequired'));
    document.getElementById('graph-target').focus();
    return;
  }
  if (['deadcode', 'testgap'].includes(mode) && !projectId) {
    setGraphMessage('ready', t(`graph.${mode}.noProject`));
    document.getElementById('entrypoints-project').focus();
    return;
  }
  setGraphBusy(true);
  setGraphMessage('loading', t('graph.loading'));
  try {
    if (mode === 'flow') {
      const result = await api.flowAnalyze(target, projectId);
      if (current()) { graphDisplayedContext = context; renderFlowAnalysis(result); }
      return;
    }
    let units;
    let rootLabel = target;
    if (mode === 'entrypoints') {
      units = await api.entrypoints(projectId, lang);
      rootLabel = t('graph.entrypoints');
    } else if (mode === 'deadcode') {
      units = await api.deadCode(projectId);
      rootLabel = t('graph.deadcode.label');
    } else if (mode === 'testgap') {
      units = await api.testGaps(projectId);
      rootLabel = t('graph.testgap.label');
    } else if (mode === 'callers') units = await api.callers(target, depth, projectId);
    else if (mode === 'callees') units = await api.callees(target, depth, projectId);
    else if (mode === 'impact') units = await api.impact(target, projectId);
    else units = await api.subtypes(target, projectId);
    if (current()) { graphDisplayedContext = context; renderGraph(rootLabel, units); }
  } catch (error) {
    if (current()) {
      clearGraphCanvas();
      setGraphMessage('error', t('graph.queryFailed', error.message));
    }
  } finally {
    if (sequence === graphQuerySequence) {
      setGraphBusy(false);
      if (!current()) setGraphMessage('ready', t('graph.queryChanged'));
    }
  }
}

function renderFlowAnalysis(result) {
  state.flowResult = result;
  state.flowView = 'cfg';
  const summary = result.summary || {};
  const metric = (label, values) => `
    <div class="flow-metric">
      <div class="flow-metric-label">${esc(label)}</div>
      <div class="flow-metric-value" title="${esc((values || []).join(', '))}">
        ${esc((values || []).join(', ') || '—')}
      </div>
    </div>`;
  const panel = document.getElementById('flow-summary');
  panel.innerHTML =
    metric('Parameters', summary.parameters) +
    metric('Field reads', summary.fieldReads) +
    metric('Field writes', summary.fieldWrites) +
    metric('Return sources', summary.returnSources);
  panel.classList.add('visible');
  document.getElementById('flow-view-switch').classList.add('visible');
  document.querySelectorAll('.flow-view-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.flowView === 'cfg'));
  renderFlowGraph('cfg');
}

function switchFlowView(view, btn) {
  state.flowView = view;
  document.querySelectorAll('.flow-view-btn').forEach(item => item.classList.remove('active'));
  btn.classList.add('active');
  renderFlowGraph(view);
}

function renderFlowGraph(view) {
  // Stop previous flow simulation before starting a new one
  stopGraphSimulations();
  clearGraphSelection();

  const result = state.flowResult;
  if (!result) return;
  const graph = (view === 'pdg' ? result.programDependenceGraph : result.controlFlowGraph) || {};
  const svg = d3.select('#graph-svg');
  const el = svg.node();
  const g = svg.select('.zoom-g');
  g.selectAll('*').remove();

  const nodes = (graph.nodes || []).map(node => ({ ...node }));
  graphFitNodes = nodes;
  graphFitTop = document.getElementById('flow-summary').offsetHeight + 64;
  const links = (graph.edges || []).map(edge => ({
    ...edge,
    source: edge.sourceId,
    target: edge.targetId
  }));

  if (!nodes.length) {
    setGraphMessage('empty', t('graph.flow.empty'));
    return;
  }

  if (!g.select('defs').size()) {
    const defs = g.append('defs');
    defs.append('marker')
      .attr('id', 'flow-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 18).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', 'var(--text-3)');
  }

  // alphaDecay 0.1: converges ~2× faster than the previous 0.05
  _currentFlowSim = d3.forceSimulation(nodes)
    .alphaDecay(0.1)
    .velocityDecay(.4)
    .force('link', d3.forceLink(links).id(d => d.id).distance(view === 'pdg' ? 105 : 88).strength(.75))
    .force('charge', d3.forceManyBody().strength(-360))
    .force('x', d3.forceX(0).strength(.08))
    .force('y', d3.forceY((d, i) => (i - nodes.length / 2) * 42).strength(.16))
    .force('collision', d3.forceCollide(38));

  const edgeColor = edge => {
    if (edge.kind === 'DATA_DEPENDENCY') return 'var(--purple)';
    if (edge.kind === 'CONTROL_DEPENDENCY') return 'var(--amber)';
    if (edge.kind === 'TRUE_BRANCH') return 'var(--mint)';
    if (edge.kind === 'FALSE_BRANCH') return 'var(--red)';
    return 'var(--text-3)';
  };

  const link = g.append('g').selectAll('line').data(links).join('line')
    .attr('class', 'graph-connection')
    .attr('stroke', edgeColor)
    .attr('stroke-width', edge => edge.kind.includes('DEPENDENCY') ? 1.7 : 1.3)
    .attr('stroke-opacity', 1)
    .attr('stroke-dasharray', edge => edge.kind === 'CONTROL_DEPENDENCY' ? '4 4' : null)
    .attr('marker-end', 'url(#flow-arrow)');

  const edgeText = g.append('g').selectAll('text').data(links).join('text')
    .attr('class', 'flow-edge-label')
    .attr('text-anchor', 'middle')
    .text(edge => edge.symbol || edge.kind.replace('_BRANCH', '').replace('_DEPENDENCY', ''));

  const node = g.append('g').selectAll('g').data(nodes).join('g')
    .attr('class', 'graph-node flow-node').attr('role', 'button').attr('tabindex', 0)
    .attr('aria-label', d => `${d.label} · L${d.line}`).attr('aria-pressed', 'false')
    .attr('cursor', 'pointer')
    .on('click', (event, d) => selectFlowNode(d))
    .on('keydown', (event, d) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectFlowNode(d); } })
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) _currentFlowSim?.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) _currentFlowSim?.alphaTarget(0); d.fx = null; d.fy = null; }));

  node.append('rect')
    .attr('x', -31).attr('y', -18).attr('width', 62).attr('height', 36).attr('rx', 9)
    .attr('fill', d => d.kind === 'CONDITION' ? 'rgb(var(--warning-rgb) / .1)' : 'rgb(var(--accent-rgb) / .08)')
    .attr('stroke', d => d.kind === 'CONDITION' ? 'var(--amber)' : d.kind === 'RETURN' ? 'var(--purple)' : 'var(--mint)')
    .attr('stroke-width', 1.2);

  node.append('text')
    .attr('text-anchor', 'middle').attr('dy', '-.2em')
    .attr('fill', 'var(--text)').attr('font-family', 'var(--fm)').attr('font-size', 12)
    .text(d => d.label.length > 16 ? d.label.slice(0, 15) + '…' : d.label);
  node.append('text')
    .attr('text-anchor', 'middle').attr('dy', '1.15em')
    .attr('fill', 'var(--text-3)').attr('font-family', 'var(--fm)').attr('font-size', 11)
    .text(d => `${d.kind} · L${d.line}`);

  _currentFlowSim.on('tick', () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    edgeText.attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2 - 4);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
  const simulation = _currentFlowSim;
  simulation.on('end', () => { if (_currentFlowSim === simulation) _currentFlowSim = null; });
  setTimeout(() => {
    simulation.stop();
    if (_currentFlowSim === simulation) _currentFlowSim = null;
  }, 2500);

  setGraphMessage('loaded', `${result.target.split('#').pop()} · ${view.toUpperCase()} · ${nodes.length} nodes · ${links.length} edges`);
  simulation.tick(40);
  if (!graphMotionDuration()) {
    simulation.stop();
    _currentFlowSim = null;
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    edgeText.attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2 - 4);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  }
  graphReset();
}

// Above this node count, use a static radial layout instead of force simulation.
// Star-topology graphs (callers / impact / entrypoints) converge to a ring anyway —
// pre-computing the ring position is instant and eliminates all O(n²) physics cost.
const GRAPH_LARGE_THRESHOLD = 70;
const GRAPH_MAX_NODES = 400;

function renderGraph(rootQn, units) {
  // Kill any running simulation from a previous render
  stopGraphSimulations();
  clearGraphSelection();

  const svg = d3.select('#graph-svg');
  const cappedUnits = units.length > GRAPH_MAX_NODES ? units.slice(0, GRAPH_MAX_NODES) : units;
  const wasCapped   = cappedUnits.length < units.length;
  const isLarge     = cappedUnits.length >= GRAPH_LARGE_THRESHOLD;

  const rootNode = { id: 'query:' + rootQn, qualifiedName: rootQn, kind: 'ROOT', isRoot: true, x: 0, y: 0 };
  const allNodes = [rootNode, ...cappedUnits.map((u, index) => ({ ...u, unit: u, id: u.id || u.qualifiedName || String(index), isRoot: false }))];
  const links = allNodes.slice(1).map(node => ({ source: rootNode, target: node }));
  graphFitNodes = allNodes;
  graphFitTop = 24;

  if (cappedUnits.length === 0) {
    graphFitNodes = [];
    setGraphMessage('empty', t('graph.hint.noResult', state.graphMode, rootQn));
    svg.select('.zoom-g').selectAll('*').remove();
    return;
  }

  setGraphMessage('loaded', t('graph.hint.result', cappedUnits.length, state.graphMode, rootQn)
    + (wasCapped ? ` · ${t('graph.limit', GRAPH_MAX_NODES, units.length)}` : ''));

  const g = svg.select('.zoom-g');
  g.selectAll('*').remove();

  // ── Large graph: pre-compute evenly-spaced ring (no physics needed) ──────
  if (isLarge) {
    const R = Math.max(260, cappedUnits.length * 11);
    cappedUnits.forEach((u, i) => {
      const θ = (2 * Math.PI * i) / cappedUnits.length;
      allNodes[i + 1].x = Math.cos(θ) * R;
      allNodes[i + 1].y = Math.sin(θ) * R;
    });
  }

  // ── Links ─────────────────────────────────────────────────────────────────
  const link = g.append('g').attr('class', 'links').selectAll('line').data(links).join('line')
    .attr('class', 'graph-connection')
    .attr('stroke', 'var(--graph-edge)')
    .attr('stroke-width', isLarge ? 1 : 1.5)
    .attr('stroke-opacity', 1);

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const node = g.append('g').attr('class', 'nodes').selectAll('g').data(allNodes).join('g')
    .attr('class', 'graph-node')
    .attr('role', 'button').attr('tabindex', 0).attr('aria-pressed', 'false')
    .attr('aria-label', d => `${d.kind}: ${d.qualifiedName || d.id}`)
    .attr('cursor', 'pointer')
    .on('keydown', (e, d) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNode(d); }
    })
    .call(d3.drag()
      .on('start', (e, d) => {
        if (_currentGraphSim && !e.active) _currentGraphSim.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (e, d) => {
        d.x = d.fx = e.x; d.y = d.fy = e.y;
        // In static layout there is no simulation; update DOM directly
        if (!_currentGraphSim) _updateGraphPositions(link, node);
      })
      .on('end', (e, d) => {
        if (_currentGraphSim && !e.active) _currentGraphSim.alphaTarget(0);
        if (!_currentGraphSim) { d.fx = null; d.fy = null; }
      })
    )
    .on('click', (e, d) => selectNode(d))
    .on('dblclick', (e, d) => {
      e.stopPropagation();
      document.getElementById('graph-target').value = d.qualifiedName || d.id;
      doGraphQuery();
    })
    .on('mouseover', (e, d) => showTooltip(e, d.qualifiedName || d.id))
    .on('mouseout', hideTooltip);

  node.append('circle')
    .attr('r', d => d.isRoot ? 22 : (isLarge ? 7 : 14))
    .attr('fill',   d => d.isRoot ? 'rgb(var(--danger-rgb) / .12)' : `color-mix(in srgb, ${kindColor(d.kind)} 10%, var(--bg-2))`)
    .attr('stroke', d => d.isRoot ? 'var(--red)' : kindColor(d.kind))
    .attr('stroke-width', d => d.isRoot ? 2 : 1.5)
    // Keep nodes crisp without per-node SVG glow compositing.
    .attr('filter', null);

  node.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.isRoot ? 38 : 30)
    .attr('fill', d => d.isRoot ? 'var(--red)' : kindColor(d.kind))
    .attr('font-family', 'var(--fm)')
    .attr('font-size', 12)
    .attr('font-weight', '700')
    .attr('stroke', 'var(--bg)').attr('stroke-width', 4).attr('stroke-linejoin', 'round')
    .attr('paint-order', 'stroke fill')
    .attr('pointer-events', 'none')
    // Hide per-node labels in large mode (too crowded; hover tooltip still works)
    .text(d => {
      if (isLarge && !d.isRoot) return '';
      const n = (d.simpleName || d.qualifiedName || d.id || '').split('#').pop().split('.').pop();
      return n.length > 22 ? n.slice(0, 21) + '…' : n;
    });

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLarge) {
    // Static layout: one-shot DOM update, zero CPU after this
    _updateGraphPositions(link, node);
  } else {
    // Small graph: run force simulation (faster alphaDecay → ~65 ticks vs ~134)
    _currentGraphSim = d3.forceSimulation(allNodes)
      .alphaDecay(0.1)
      .velocityDecay(0.4)
      .force('link', d3.forceLink(links).id(d => d.id).distance(130).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide(40));
    _currentGraphSim.on('tick', () => _updateGraphPositions(link, node));
    const simulation = _currentGraphSim;
    simulation.on('end', () => { if (_currentGraphSim === simulation) _currentGraphSim = null; });
    setTimeout(() => {
      simulation.stop();
      if (_currentGraphSim === simulation) _currentGraphSim = null;
    }, 3000);
    simulation.tick(40);
    if (!graphMotionDuration()) { simulation.stop(); _currentGraphSim = null; }
    _updateGraphPositions(link, node);
  }

  graphReset();
}

function _updateGraphPositions(link, node) {
  link
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('transform', d => `translate(${d.x},${d.y})`);
}

function selectNode(d) {
  state.selectedNode = d;
  highlightGraphRelations(d);
  const group = d.isRoot && !graphSourceContext().target;
  document.getElementById('graph-source-btn').disabled = group || !graphSourceContext().projectId;
  document.getElementById('graph-pivot-btn').disabled = group;
  document.getElementById('graph-source-status').textContent = group ? t('graph.groupNotSymbol') : graphSourceContext().projectId ? '' : t('search.chooseRepository');
  const pivot = document.querySelector('#graph-pivot-btn span');
  pivot.dataset.i18n = 'btn.pivotNode'; pivot.textContent = t('btn.pivotNode');
  const el = document.getElementById('node-detail');
  el.style.display = '';
  document.getElementById('node-detail-content').innerHTML = `
    <div class="nd-label">${t('nd.kind')}</div>
    <div class="nd-value"><span class="kind-badge" style="${kindStyle(d.kind)}">${esc(t('kind.' + d.kind.toLowerCase()) === 'kind.' + d.kind.toLowerCase() ? d.kind : t('kind.' + d.kind.toLowerCase()))}</span></div>
    <div class="nd-label">${t('nd.name')}</div>
    <div class="nd-value" style="color:var(--mint)">${esc(d.qualifiedName || d.id)}</div>
    ${d.filePath ? `<div class="nd-label">${t('nd.file')}</div><div class="nd-value">${esc(d.filePath)}</div>` : ''}
    ${d.startLine ? `<div class="nd-label">${t('nd.lines')}</div><div class="nd-value">${d.startLine}–${d.endLine}</div>` : ''}
  `;
  if (typeof readerView !== 'undefined' && readerView.source === 'graph' && readerDialog.open) {
    if (d.unit) openSelectedGraphSource(); else closeResultReader(false);
  }
}

function highlightGraphRelations(selected) {
  const neighbors = new Set([selected.id]);
  const id = endpoint => typeof endpoint === 'object' ? endpoint.id : endpoint;
  d3.selectAll('#graph-svg .graph-connection').classed('is-context', edge => {
    const related = id(edge.source) === selected.id || id(edge.target) === selected.id;
    if (related) { neighbors.add(id(edge.source)); neighbors.add(id(edge.target)); }
    return related;
  });
  d3.selectAll('#graph-svg .graph-node').attr('aria-pressed', node => String(node.id === selected.id))
    .classed('is-selected', node => node.id === selected.id).classed('is-context', node => neighbors.has(node.id));
}

function graphSourceContext() { return graphDisplayedContext || graphQueryContext(); }

function selectFlowNode(node) {
  if (typeof readerView !== 'undefined' && readerView.source === 'graph') closeResultReader(false);
  state.selectedNode = { ...node, flow: true };
  highlightGraphRelations(node);
  document.getElementById('node-detail').style.display = '';
  document.getElementById('node-detail-content').innerHTML = `<div class="nd-label">${esc(node.kind)}</div><div class="nd-value">${esc(node.label)}</div><div class="nd-value">L${node.line}</div>`;
  document.getElementById('graph-source-btn').disabled = !graphSourceContext().projectId;
  document.getElementById('graph-pivot-btn').disabled = false;
  document.getElementById('graph-source-status').textContent = graphSourceContext().projectId ? '' : t('search.chooseRepository');
  const pivot = document.querySelector('#graph-pivot-btn span');
  pivot.dataset.i18n = 'graph.methodCallers'; pivot.textContent = t('graph.methodCallers');
}

async function openSelectedGraphSource() {
  const selected = state.selectedNode, context = graphSourceContext(), sequence = graphQuerySequence;
  if (!selected || !context.projectId) return;
  const button = document.getElementById('graph-source-btn');
  if (selected.unit) { openCodeReader(selected.unit, context.projectId, button); return; }
  if (!context.target) { document.getElementById('graph-source-status').textContent = t('graph.groupNotSymbol'); return; }
  button.disabled = true;
  document.getElementById('graph-source-status').textContent = t('reader.loading');
  try {
    const target = selected.flow ? context.target : selected.qualifiedName;
    const unit = await api.symbol(target, context.projectId);
    if (sequence !== graphQuerySequence || state.selectedNode !== selected || Alpine.store('repograph').panel !== 'graph') return;
    if (unit?.qualifiedName !== target || !unit.kind) throw new Error(t('reader.mismatch'));
    document.getElementById('graph-source-status').textContent = '';
    openCodeReader(unit, context.projectId, button);
  } catch (error) {
    if (sequence === graphQuerySequence && state.selectedNode === selected) document.getElementById('graph-source-status').textContent = error.message;
  } finally { if (sequence === graphQuerySequence && state.selectedNode === selected) button.disabled = false; }
}

function pivotToNode() {
  if (!state.selectedNode) return;
  const node = state.selectedNode;
  const context = graphSourceContext();
  const target = node.flow ? context.target : node.qualifiedName || node.id;
  if (node.flow || ['entrypoints','deadcode','testgap'].includes(state.graphMode)) {
    setGraphMode('callers', document.querySelector('#graph-tab-row button[onclick*="\'callers\'"]'));
  }
  document.getElementById('graph-project').value = context.projectId || '';
  document.getElementById('graph-target').value = target;
  doGraphQuery();
}

document.addEventListener('DOMContentLoaded', () => {
  renderGraphModeLabel();
  document.querySelectorAll('#graph-tab-row .tab').forEach(button =>
    button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
  ['graph-target', 'graph-project', 'entrypoints-project', 'graph-depth'].forEach(id => {
    document.getElementById(id).addEventListener('input', invalidateGraphQuery);
  });
  document.getElementById('global-project')?.addEventListener('change', invalidateGraphQuery);
  document.getElementById('graph-target').addEventListener('keydown', e => {
    if (e.key === 'Enter') doGraphQuery();
  });
});

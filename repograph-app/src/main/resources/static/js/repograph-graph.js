let graphZoomBehavior = null;
let graphSvgEl = null;
// Track running simulations so we can stop them before starting a new render
let _currentGraphSim = null;
let _currentFlowSim  = null;

function setGraphMode(mode, btn) {
  state.graphMode = mode;
  document.getElementById('graph-tab-row').querySelectorAll('.tab').forEach(tb => tb.classList.remove('active'));
  btn.classList.add('active');
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
  if (isFlow && state.flowResult) renderFlowGraph(state.flowView);
}

function initGraphCanvas() {
  const svg = d3.select('#graph-svg');
  const el = svg.node();
  if (!el) return;
  graphSvgEl = svg;

  graphZoomBehavior = d3.zoom()
    .scaleExtent([0.05, 4])
    .on('zoom', e => svg.select('.zoom-g').attr('transform', e.transform));

  svg.call(graphZoomBehavior);

  if (!svg.select('.zoom-g').size()) {
    svg.append('g').attr('class', 'zoom-g');
  }
}

function graphZoomIn()  { if (graphSvgEl && graphZoomBehavior) graphSvgEl.transition().call(graphZoomBehavior.scaleBy, 1.4); }
function graphZoomOut() { if (graphSvgEl && graphZoomBehavior) graphSvgEl.transition().call(graphZoomBehavior.scaleBy, 0.7); }
function graphReset() {
  if (graphSvgEl && graphZoomBehavior) {
    const el = graphSvgEl.node();
    graphSvgEl.transition().duration(500).call(
      graphZoomBehavior.transform,
      d3.zoomIdentity.translate(el.clientWidth / 2, el.clientHeight / 2).scale(1)
    );
  }
}

function updateGraphClassHint(val) {
  const hint = document.getElementById('graph-class-hint');
  if (!hint) return;
  const isClassFqn = val.trim().length > 0 && val.includes('.') && !val.includes('#');
  hint.style.display = isClassFqn ? '' : 'none';
}

async function loadGraphSymbols() {
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
    dl.innerHTML = symbols.map(unit =>
      `<option value="${esc(unit.qualifiedName)}" label="${esc(unit.kind + ' · ' + unit.filePath)}"></option>`
    ).join('');
  } catch (_) {
    dl.innerHTML = '';
  }
}

const debouncedGraphSymbols = debounce(loadGraphSymbols, 180);

async function doGraphQuery() {
  const mode = state.graphMode;
  document.getElementById('graph-hint').textContent = 'Loading…';

  try {
    if (mode === 'entrypoints') {
      const rawPid    = document.getElementById('entrypoints-project').value.trim();
      const projectId = resolveProjectId(rawPid) || state.activeProjectId;
      const lang      = document.getElementById('entrypoints-lang').value;
      const units = await api.entrypoints(projectId, lang);
      const rootLabel = rawPid ? `Entry Points (${rawPid})` : 'Entry Points';
      renderGraph(rootLabel, units);
      return;
    }

    if (mode === 'deadcode') {
      const rawPid    = document.getElementById('entrypoints-project').value.trim();
      const projectId = resolveProjectId(rawPid) || state.activeProjectId;
      if (!projectId) {
        document.getElementById('graph-hint').textContent = t('graph.deadcode.noProject') || '请先选择项目';
        return;
      }
      const units = await api.deadCode(projectId);
      const rootLabel = t('graph.deadcode.label') || `Dead Code (${projectId.slice(0, 8)}…)`;
      renderGraph(rootLabel, units);
      return;
    }

    if (mode === 'testgap') {
      const rawPid    = document.getElementById('entrypoints-project').value.trim();
      const projectId = resolveProjectId(rawPid) || state.activeProjectId;
      if (!projectId) {
        document.getElementById('graph-hint').textContent = t('graph.testgap.noProject');
        return;
      }
      const units = await api.testGaps(projectId);
      const rootLabel = t('graph.testgap.label');
      renderGraph(rootLabel, units);
      return;
    }

    const target = document.getElementById('graph-target').value.trim();
    if (!target) return;
    const depth = parseInt(document.getElementById('graph-depth').value);
    const rawProject = document.getElementById('graph-project').value.trim();
    const projectId = resolveProjectId(rawProject) || state.activeProjectId;

    if (mode === 'flow') {
      document.getElementById('graph-hint').textContent = 'Analyzing…';
      const result = await api.flowAnalyze(target, projectId);
      renderFlowAnalysis(result);
      return;
    }

    document.getElementById('flow-summary').classList.remove('visible');
    document.getElementById('flow-view-switch').classList.remove('visible');
    let units = [];
    if (mode === 'callers') units = await api.callers(target, depth, projectId);
    else if (mode === 'callees') units = await api.callees(target, depth, projectId);
    else if (mode === 'impact') units = await api.impact(target, projectId);
    else units = await api.subtypes(target, projectId);
    renderGraph(target, units);
  } catch (e) {
    document.getElementById('graph-hint').textContent = 'Query failed: ' + e.message;
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
  if (_currentFlowSim) { _currentFlowSim.stop(); _currentFlowSim = null; }

  const result = state.flowResult;
  if (!result) return;
  const graph = view === 'pdg' ? result.programDependenceGraph : result.controlFlowGraph;
  const svg = d3.select('#graph-svg');
  const el = svg.node();
  const W = el.clientWidth;
  const H = el.clientHeight;
  const g = svg.select('.zoom-g');
  g.selectAll('*').remove();

  const nodes = (graph.nodes || []).map(node => ({ ...node }));
  const links = (graph.edges || []).map(edge => ({
    ...edge,
    source: edge.sourceId,
    target: edge.targetId
  }));

  if (!nodes.length) {
    document.getElementById('graph-hint').textContent = 'No flow nodes';
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
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', '#64748B');
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
    if (edge.kind === 'DATA_DEPENDENCY') return '#A78BFA';
    if (edge.kind === 'CONTROL_DEPENDENCY') return '#FBBF24';
    if (edge.kind === 'TRUE_BRANCH') return '#3EFFA0';
    if (edge.kind === 'FALSE_BRANCH') return '#F87171';
    return '#64748B';
  };

  const link = g.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', edgeColor)
    .attr('stroke-width', edge => edge.kind.includes('DEPENDENCY') ? 1.7 : 1.3)
    .attr('stroke-opacity', .64)
    .attr('stroke-dasharray', edge => edge.kind === 'CONTROL_DEPENDENCY' ? '4 4' : null)
    .attr('marker-end', 'url(#flow-arrow)');

  const edgeText = g.append('g').selectAll('text').data(links).join('text')
    .attr('class', 'flow-edge-label')
    .attr('text-anchor', 'middle')
    .text(edge => edge.symbol || edge.kind.replace('_BRANCH', '').replace('_DEPENDENCY', ''));

  const node = g.append('g').selectAll('g').data(nodes).join('g')
    .attr('cursor', 'default')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) _currentFlowSim?.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) _currentFlowSim?.alphaTarget(0); d.fx = null; d.fy = null; }));

  node.append('rect')
    .attr('x', -31).attr('y', -18).attr('width', 62).attr('height', 36).attr('rx', 9)
    .attr('fill', d => d.kind === 'CONDITION' ? 'rgba(251,191,36,.12)' : 'rgba(62,255,160,.08)')
    .attr('stroke', d => d.kind === 'CONDITION' ? '#FBBF24' : d.kind === 'RETURN' ? '#A78BFA' : '#3EFFA0')
    .attr('stroke-width', 1.2);

  node.append('text')
    .attr('text-anchor', 'middle').attr('dy', '-.2em')
    .attr('fill', '#CBD5E1').attr('font-family', 'var(--fm)').attr('font-size', 8.5)
    .text(d => d.label.length > 16 ? d.label.slice(0, 15) + '…' : d.label);
  node.append('text')
    .attr('text-anchor', 'middle').attr('dy', '1.15em')
    .attr('fill', '#334155').attr('font-family', 'var(--fm)').attr('font-size', 7.5)
    .text(d => `${d.kind} · L${d.line}`);

  _currentFlowSim.on('tick', () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    edgeText.attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2 - 4);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
  _currentFlowSim.on('end', () => { _currentFlowSim = null; });
  setTimeout(() => { if (_currentFlowSim) { _currentFlowSim.stop(); _currentFlowSim = null; } }, 2500);

  document.getElementById('graph-hint').textContent =
    `${result.target.split('#').pop()} · ${view.toUpperCase()} · ${nodes.length} nodes · ${links.length} edges`;
  svg.transition().duration(400).call(
    graphZoomBehavior.transform,
    d3.zoomIdentity.translate(W / 2, H / 2 + 35).scale(Math.min(1.1, 8 / Math.sqrt(nodes.length)))
  );
}

// Above this node count, use a static radial layout instead of force simulation.
// Star-topology graphs (callers / impact / entrypoints) converge to a ring anyway —
// pre-computing the ring position is instant and eliminates all O(n²) physics cost.
const GRAPH_LARGE_THRESHOLD = 70;
const GRAPH_MAX_NODES = 400;

function renderGraph(rootQn, units) {
  // Kill any running simulation from a previous render
  if (_currentGraphSim) { _currentGraphSim.stop(); _currentGraphSim = null; }

  const svg = d3.select('#graph-svg');
  const hint = document.getElementById('graph-hint');
  const el = svg.node();
  const W = el.clientWidth, H = el.clientHeight;

  const cappedUnits = units.length > GRAPH_MAX_NODES ? units.slice(0, GRAPH_MAX_NODES) : units;
  const wasCapped   = cappedUnits.length < units.length;
  const isLarge     = cappedUnits.length >= GRAPH_LARGE_THRESHOLD;

  const rootNode = { id: rootQn, qualifiedName: rootQn, kind: 'ROOT', isRoot: true, x: 0, y: 0 };
  const allNodes = [rootNode, ...cappedUnits.map(u => ({ ...u, id: u.qualifiedName || u.id, isRoot: false }))];
  const links    = cappedUnits.map(u => ({ source: rootQn, target: u.qualifiedName || u.id }));

  if (cappedUnits.length === 0) {
    hint.textContent = t('graph.hint.noResult', state.graphMode, rootQn);
    svg.select('.zoom-g').selectAll('*').remove();
    return;
  }

  hint.textContent = t('graph.hint.result', cappedUnits.length, state.graphMode, rootQn)
    + (wasCapped ? `（限显 ${GRAPH_MAX_NODES} / 共 ${units.length}）` : '');

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
    .attr('stroke', 'url(#link-grad)')
    .attr('stroke-width',   isLarge ? 0.7 : 1.5)
    .attr('stroke-opacity', isLarge ? 0.22 : 0.5);

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const node = g.append('g').attr('class', 'nodes').selectAll('g').data(allNodes).join('g')
    .attr('cursor', 'pointer')
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
    .attr('fill',   d => d.isRoot ? 'rgba(248,113,113,0.2)' : `${kindColor(d.kind)}22`)
    .attr('stroke', d => d.isRoot ? '#F87171' : kindColor(d.kind))
    .attr('stroke-width', d => d.isRoot ? 2 : 1.5)
    // Glow SVG filters are expensive (per-node compositing pass); skip them for large graphs
    .attr('filter', d => isLarge ? null : (d.isRoot ? 'url(#glow-strong)' : 'url(#glow)'));

  node.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', d => d.isRoot ? '#F87171' : kindColor(d.kind))
    .attr('font-family', 'var(--fm)')
    .attr('font-size', d => d.isRoot ? 10 : 9)
    .attr('font-weight', '700')
    .attr('pointer-events', 'none')
    // Hide per-node labels in large mode (too crowded; hover tooltip still works)
    .text(d => {
      if (isLarge && !d.isRoot) return '';
      const n = (d.simpleName || d.qualifiedName || d.id || '').split('#').pop().split('.').pop();
      return n.length > 12 ? n.slice(0, 11) + '…' : n;
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
    _currentGraphSim.on('end',  () => { _currentGraphSim = null; });
    setTimeout(() => { if (_currentGraphSim) { _currentGraphSim.stop(); _currentGraphSim = null; } }, 3000);
  }

  // ── Zoom to fit ────────────────────────────────────────────────────────────
  const fitR  = isLarge ? Math.max(260, cappedUnits.length * 11) * 2.5 : Math.sqrt(allNodes.length) * 120;
  const scale = Math.min(isLarge ? 0.88 : 1, Math.min(W, H) / fitR);
  svg.transition().duration(600).call(
    graphZoomBehavior.transform,
    d3.zoomIdentity.translate(W / 2, H / 2).scale(scale)
  );
}

function _updateGraphPositions(link, node) {
  link
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('transform', d => `translate(${d.x},${d.y})`);
}

function selectNode(d) {
  state.selectedNode = d;
  const el = document.getElementById('node-detail');
  el.style.display = '';
  document.getElementById('node-detail-content').innerHTML = `
    <div class="nd-label">${t('nd.kind')}</div>
    <div class="nd-value"><span class="kind-badge" style="${kindStyle(d.kind)}">${d.kind}</span></div>
    <div class="nd-label">${t('nd.name')}</div>
    <div class="nd-value" style="color:var(--mint)">${esc(d.qualifiedName || d.id)}</div>
    ${d.filePath ? `<div class="nd-label">${t('nd.file')}</div><div class="nd-value">${esc(d.filePath)}</div>` : ''}
    ${d.startLine ? `<div class="nd-label">${t('nd.lines')}</div><div class="nd-value">${d.startLine}–${d.endLine}</div>` : ''}
  `;
}

function pivotToNode() {
  if (!state.selectedNode) return;
  document.getElementById('graph-target').value = state.selectedNode.qualifiedName || state.selectedNode.id;
  doGraphQuery();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('graph-target').addEventListener('keydown', e => {
    if (e.key === 'Enter') doGraphQuery();
  });
});

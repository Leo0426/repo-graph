/* ── Tools panel ── */
async function doFrameworks() {
  const pid = resolveProjectId(document.getElementById('frameworks-project-input').value.trim());
  if (!pid) return;
  document.getElementById('frameworks-result').innerHTML = '<div class="empty-state">…</div>';
  try {
    const units = await api.frameworks(pid);
    if (!units || units.length === 0) {
      document.getElementById('frameworks-result').innerHTML = `<div class="empty-state">${t('tools.frameworks.empty')}</div>`;
      return;
    }
    document.getElementById('frameworks-result').innerHTML = units.map(u => `
      <div class="result-card" style="cursor:default;margin-bottom:6px">
        <div class="result-header">
          <span class="kind-badge" style="${kindStyle(u.kind)}">${u.kind}</span>
          <span class="result-qn">${esc(u.qualifiedName)}</span>
          ${u.metadata && u.metadata.framework ? `<span style="font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(62,255,160,.1);color:var(--mint)">${esc(u.metadata.framework)}</span>` : ''}
        </div>
        <div class="result-meta"><span>${esc(u.filePath||'')}</span></div>
      </div>`).join('');
  } catch(e) {
    document.getElementById('frameworks-result').innerHTML = `<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

async function doSbom() {
  const input = document.getElementById('sbom-project-input').value.trim();
  const project = resolveProject(input);
  const pid = project ? project.projectId : resolveProjectId(input);
  const proot = project ? project.projectRoot : null;
  if (!pid) return;
  const result = document.getElementById('sbom-result');
  if (!proot) {
    result.innerHTML = `<div class="empty-state" style="color:var(--red)">未找到项目 projectRoot，请先索引该项目</div>`;
    return;
  }
  result.innerHTML = '<div class="empty-state">…</div>';
  try {
    const json = await api.sbom(pid, proot);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `sbom-${pid}.json`; a.click();
    URL.revokeObjectURL(url);
    result.innerHTML = `<div class="empty-state" style="color:var(--mint)">✓ ${t('tools.sbom.ready')}</div>`;
  } catch(e) {
    result.innerHTML = `<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

/* ── SBOM viewer ── */
const sbomState = { data: null, raw: null, projectId: null, scopeFilter: 'all', query: '' };

async function loadSbomView() {
  const input = document.getElementById('sbom-view-input').value.trim();
  const project = resolveProject(input);
  const pid = project ? project.projectId : resolveProjectId(input);
  const proot = project ? project.projectRoot : null;
  if (!pid) return;
  const content = document.getElementById('sbom-view-content');
  if (!proot) {
    content.innerHTML = `<div class="empty-state" style="color:var(--red)">未找到项目 projectRoot，请先索引该项目</div>`;
    return;
  }
  content.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>生成 SBOM…</span></div>`;
  document.getElementById('sbom-download-btn').style.display = 'none';
  try {
    const json = await api.sbom(pid, proot);
    const bom = JSON.parse(json);
    sbomState.data = bom; sbomState.raw = json; sbomState.projectId = pid;
    sbomState.scopeFilter = 'all'; sbomState.query = '';
    renderSbomContent();
    document.getElementById('sbom-download-btn').style.display = '';
  } catch(e) {
    content.innerHTML = `<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

function renderSbomContent() {
  const bom = sbomState.data;
  if (!bom) return;
  const meta = bom.metadata || {};
  const comp = meta.component || {};
  const components = bom.components || [];

  const scopeCounts = { required: 0, optional: 0, excluded: 0 };
  components.forEach(c => { if (c.scope in scopeCounts) scopeCounts[c.scope]++; });

  let filtered = components;
  if (sbomState.scopeFilter !== 'all') filtered = filtered.filter(c => c.scope === sbomState.scopeFilter);
  if (sbomState.query) {
    const q = sbomState.query.toLowerCase();
    filtered = filtered.filter(c =>
      (c.name||'').toLowerCase().includes(q) ||
      (c.group||'').toLowerCase().includes(q) ||
      (c.version||'').toLowerCase().includes(q) ||
      (c.purl||'').toLowerCase().includes(q)
    );
  }

  const ts = meta.timestamp ? new Date(meta.timestamp).toLocaleString() : '—';
  const qEsc = esc(sbomState.query);

  document.getElementById('sbom-view-content').innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="sbom-meta">
        <span class="sbom-name">${esc(comp.name||'—')}</span>
        ${comp.version ? `<span class="sbom-version">v${esc(comp.version)}</span>` : ''}
        <span class="sbom-dot">·</span>
        <span>${esc(bom.bomFormat||'CycloneDX')} ${esc(bom.specVersion||'')}</span>
        <span class="sbom-dot">·</span>
        <span>${ts}</span>
        <span class="sbom-dot">·</span>
        <span><span style="color:var(--mint);font-weight:700">${components.length}</span> ${t('sbom.meta.components')}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div class="search-wrap" style="max-width:260px">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="${t('sbom.search.ph')}" value="${qEsc}"
            oninput="sbomState.query=this.value;renderSbomContent()" style="padding-left:38px">
        </div>
        <button class="sbom-scope-btn ${sbomState.scopeFilter==='all'?'active':''}" onclick="setSbomScope('all')">${t('sbom.filter.all')} (${components.length})</button>
        <button class="sbom-scope-btn required ${sbomState.scopeFilter==='required'?'active':''}" onclick="setSbomScope('required')">${t('sbom.filter.required')} (${scopeCounts.required})</button>
        <button class="sbom-scope-btn optional ${sbomState.scopeFilter==='optional'?'active':''}" onclick="setSbomScope('optional')">${t('sbom.filter.optional')} (${scopeCounts.optional})</button>
        <button class="sbom-scope-btn excluded ${sbomState.scopeFilter==='excluded'?'active':''}" onclick="setSbomScope('excluded')">${t('sbom.filter.excluded')} (${scopeCounts.excluded})</button>
      </div>
    </div>
    <div class="sbom-count-bar"><span class="sbom-count-n">${filtered.length}</span> / ${components.length} ${t('sbom.meta.components')}</div>
    <div class="card sbom-graph-card" style="padding:0;overflow:hidden;position:relative">
      <div class="graph-canvas sbom-graph-canvas">
        <svg id="sbom-graph-svg">
          <defs>
            <filter id="sbom-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="sbom-glow-strong" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <linearGradient id="sbom-link-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#00CFFF" stop-opacity="0.55"/>
              <stop offset="100%" stop-color="#00FFB3" stop-opacity="0.28"/>
            </linearGradient>
          </defs>
        </svg>
        <div class="graph-hint" id="sbom-graph-hint"></div>
        <div class="graph-controls">
          <button class="graph-ctrl-btn" onclick="sbomGraphZoomIn()" title="Zoom in">+</button>
          <button class="graph-ctrl-btn" onclick="sbomGraphZoomOut()" title="Zoom out">−</button>
          <button class="graph-ctrl-btn" onclick="sbomGraphReset()" title="Reset" style="font-size:12px">⌂</button>
        </div>
        <div class="graph-legend sbom-graph-legend">
          <div class="legend-item"><div class="legend-dot" style="background:#00CFFF"></div>${esc(t('sbom.legend.root'))}</div>
          <div class="legend-item"><div class="legend-dot" style="background:#00FFB3"></div>${t('sbom.filter.required')}</div>
          <div class="legend-item"><div class="legend-dot" style="background:#F59E0B"></div>${t('sbom.filter.optional')}</div>
          <div class="legend-item"><div class="legend-dot" style="background:#EF4444"></div>${t('sbom.filter.excluded')}</div>
        </div>
      </div>
    </div>
    <div id="sbom-node-detail" class="card" style="display:none;margin-top:10px">
      <div class="field-label">${esc(t('sbom.node.selected'))}</div>
      <div class="node-detail" id="sbom-node-detail-content"></div>
    </div>`;

  setTimeout(() => {
    initSbomGraphCanvas();
    renderSbomGraph(comp.name || sbomState.projectId, filtered);
  }, 0);
}

function setSbomScope(scope) {
  sbomState.scopeFilter = scope;
  renderSbomContent();
}

/* ── SBOM dependency graph (root → direct dependencies) ── */
const SBOM_SCOPE_COLORS = { required: '#00FFB3', optional: '#F59E0B', excluded: '#EF4444' };
function sbomScopeColor(scope) { return SBOM_SCOPE_COLORS[scope] || '#64748B'; }

let sbomGraphZoomBehavior = null;
let sbomGraphSvgEl = null;
let _currentSbomGraphSim = null;

const SBOM_GRAPH_LARGE_THRESHOLD = 60;
const SBOM_GRAPH_MAX_NODES = 300;

function initSbomGraphCanvas() {
  const svg = d3.select('#sbom-graph-svg');
  const el = svg.node();
  if (!el) return;
  sbomGraphSvgEl = svg;
  sbomGraphZoomBehavior = d3.zoom()
    .scaleExtent([0.05, 4])
    .on('zoom', e => svg.select('.zoom-g').attr('transform', e.transform));
  svg.call(sbomGraphZoomBehavior);
  if (!svg.select('.zoom-g').size()) svg.append('g').attr('class', 'zoom-g');
}

function sbomGraphZoomIn()  { if (sbomGraphSvgEl && sbomGraphZoomBehavior) sbomGraphSvgEl.transition().call(sbomGraphZoomBehavior.scaleBy, 1.4); }
function sbomGraphZoomOut() { if (sbomGraphSvgEl && sbomGraphZoomBehavior) sbomGraphSvgEl.transition().call(sbomGraphZoomBehavior.scaleBy, 0.7); }
function sbomGraphReset() {
  if (sbomGraphSvgEl && sbomGraphZoomBehavior) {
    const el = sbomGraphSvgEl.node();
    sbomGraphSvgEl.transition().duration(500).call(
      sbomGraphZoomBehavior.transform,
      d3.zoomIdentity.translate(el.clientWidth / 2, el.clientHeight / 2).scale(1)
    );
  }
}

function renderSbomGraph(rootLabel, components) {
  if (_currentSbomGraphSim) { _currentSbomGraphSim.stop(); _currentSbomGraphSim = null; }

  const svg = d3.select('#sbom-graph-svg');
  const hint = document.getElementById('sbom-graph-hint');
  const el = svg.node();
  if (!el) return;
  const W = el.clientWidth, H = el.clientHeight;

  const capped = components.length > SBOM_GRAPH_MAX_NODES ? components.slice(0, SBOM_GRAPH_MAX_NODES) : components;
  const wasCapped = capped.length < components.length;
  const isLarge = capped.length >= SBOM_GRAPH_LARGE_THRESHOLD;

  const rootId = '__sbom_root__';
  const rootNode = { id: rootId, name: rootLabel, isRoot: true, x: 0, y: 0 };
  const depNodes = capped.map(c => ({
    ...c,
    id: c['bom-ref'] || c.purl || `${c.group||''}:${c.name}:${c.version||''}`,
    isRoot: false
  }));
  const allNodes = [rootNode, ...depNodes];
  const links = depNodes.map(n => ({ source: rootId, target: n.id }));

  if (depNodes.length === 0) {
    hint.textContent = t('sbom.graph.hint.empty');
    svg.select('.zoom-g').selectAll('*').remove();
    document.getElementById('sbom-node-detail').style.display = 'none';
    return;
  }

  hint.textContent = t('sbom.graph.hint.result', depNodes.length)
    + (wasCapped ? `（限显 ${SBOM_GRAPH_MAX_NODES} / 共 ${components.length}）` : '');

  const g = svg.select('.zoom-g');
  g.selectAll('*').remove();

  if (isLarge) {
    const R = Math.max(240, depNodes.length * 10);
    depNodes.forEach((n, i) => {
      const θ = (2 * Math.PI * i) / depNodes.length;
      allNodes[i + 1].x = Math.cos(θ) * R;
      allNodes[i + 1].y = Math.sin(θ) * R;
    });
  }

  const link = g.append('g').attr('class', 'links').selectAll('line').data(links).join('line')
    .attr('stroke', 'url(#sbom-link-grad)')
    .attr('stroke-width', isLarge ? 0.7 : 1.5)
    .attr('stroke-opacity', isLarge ? 0.22 : 0.5);

  const node = g.append('g').attr('class', 'nodes').selectAll('g').data(allNodes).join('g')
    .attr('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (e, d) => {
        if (_currentSbomGraphSim && !e.active) _currentSbomGraphSim.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (e, d) => {
        d.x = d.fx = e.x; d.y = d.fy = e.y;
        if (!_currentSbomGraphSim) _updateSbomGraphPositions(link, node);
      })
      .on('end', (e, d) => {
        if (_currentSbomGraphSim && !e.active) _currentSbomGraphSim.alphaTarget(0);
        if (!_currentSbomGraphSim) { d.fx = null; d.fy = null; }
      }))
    .on('click', (e, d) => selectSbomNode(d))
    .on('mouseover', (e, d) => showTooltip(e, d.isRoot ? d.name : (d.purl || d.name)))
    .on('mouseout', hideTooltip);

  node.append('circle')
    .attr('r', d => d.isRoot ? 22 : (isLarge ? 7 : 14))
    .attr('fill',   d => d.isRoot ? 'rgba(0,207,255,0.18)' : `${sbomScopeColor(d.scope)}22`)
    .attr('stroke', d => d.isRoot ? '#00CFFF' : sbomScopeColor(d.scope))
    .attr('stroke-width', d => d.isRoot ? 2 : 1.5)
    .attr('filter', d => isLarge ? null : (d.isRoot ? 'url(#sbom-glow-strong)' : 'url(#sbom-glow)'));

  node.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', d => d.isRoot ? '#00CFFF' : sbomScopeColor(d.scope))
    .attr('font-family', 'var(--fm)')
    .attr('font-size', d => d.isRoot ? 10 : 9)
    .attr('font-weight', '700')
    .attr('pointer-events', 'none')
    .text(d => {
      if (isLarge && !d.isRoot) return '';
      const n = d.isRoot ? d.name : d.name;
      return (n || '').length > 14 ? n.slice(0, 13) + '…' : n;
    });

  if (isLarge) {
    _updateSbomGraphPositions(link, node);
  } else {
    _currentSbomGraphSim = d3.forceSimulation(allNodes)
      .alphaDecay(0.1)
      .velocityDecay(0.4)
      .force('link', d3.forceLink(links).id(d => d.id).distance(120).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-360))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide(38));
    _currentSbomGraphSim.on('tick', () => _updateSbomGraphPositions(link, node));
    _currentSbomGraphSim.on('end',  () => { _currentSbomGraphSim = null; });
    setTimeout(() => { if (_currentSbomGraphSim) { _currentSbomGraphSim.stop(); _currentSbomGraphSim = null; } }, 3000);
  }

  const fitR  = isLarge ? Math.max(240, depNodes.length * 10) * 2.5 : Math.sqrt(allNodes.length) * 110;
  const scale = Math.min(isLarge ? 0.88 : 1, Math.min(W, H) / fitR);
  svg.transition().duration(600).call(
    sbomGraphZoomBehavior.transform,
    d3.zoomIdentity.translate(W / 2, H / 2).scale(scale)
  );
}

function _updateSbomGraphPositions(link, node) {
  link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('transform', d => `translate(${d.x},${d.y})`);
}

function selectSbomNode(d) {
  const panel = document.getElementById('sbom-node-detail');
  const content = document.getElementById('sbom-node-detail-content');
  if (d.isRoot) {
    content.innerHTML = `
      <div class="nd-label">${esc(t('sbom.node.name'))}</div>
      <div class="nd-value" style="color:#00CFFF">${esc(d.name || '—')}</div>`;
  } else {
    content.innerHTML = `
      <div class="nd-label">${esc(t('sbom.col.group'))}</div>
      <div class="nd-value">${esc(d.group || '—')}</div>
      <div class="nd-label">${esc(t('sbom.col.name'))}</div>
      <div class="nd-value" style="color:${sbomScopeColor(d.scope)}">${esc(d.name || '—')}</div>
      <div class="nd-label">${esc(t('sbom.col.version'))}</div>
      <div class="nd-value">${esc(d.version || '—')}</div>
      <div class="nd-label">${esc(t('sbom.col.scope'))}</div>
      <div class="nd-value"><span class="sbom-scope-badge ${esc(d.scope||'')}">${esc(d.scope || '—')}</span></div>
      <div class="nd-label">${esc(t('sbom.col.purl'))}</div>
      <div class="nd-value">${esc(d.purl || '—')}</div>`;
  }
  panel.style.display = '';
}

function downloadSbomJson() {
  if (!sbomState.raw) return;
  const blob = new Blob([sbomState.raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `sbom-${sbomState.projectId}.json`; a.click();
  URL.revokeObjectURL(url);
}

/* ── Manage projects ── */
async function renderProjectsManage() {
  const container = document.getElementById('projects-manage-list');
  container.innerHTML = `<div class="empty-state">${t('tools.manage.loading')}</div>`;
  try {
    const projects = await api.projects();
    if (!projects || projects.length === 0) {
      container.innerHTML = `<div class="empty-state">${t('tools.manage.empty')}</div>`;
      return;
    }
    container.innerHTML = projects.map(p => `
      <div class="result-card" style="cursor:default;display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--fm);font-size:13px;color:var(--text-1)">${esc(projectName(p))}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <span style="color:var(--mint);opacity:.7">${esc(p.projectId)}</span> · ${esc(p.projectRoot || '(unknown root)')} · ${p.nodeCount} units
          </div>
        </div>
        <button class="btn btn-ghost" style="font-size:12px;padding:4px 10px;color:var(--red);border-color:rgba(248,113,113,.3)"
          onclick="deleteProject('${esc(p.projectId)}','${esc(p.projectRoot || '')}')">
          <span data-i18n="btn.delete">${t('btn.delete')}</span>
        </button>
      </div>`).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

async function deleteProject(projectId, projectRoot) {
  if (!await showDeleteModal(projectId, projectRoot)) return;
  try {
    await api.deleteProject(projectId);
    showToast(`Deleted ${projectRoot || projectId}`);
    await refreshProjectsList();
    await renderProjectsManage();
  } catch (e) {
    showToast(`Delete failed: ${e.message}`);
  }
}

/* ── Benchmark ── */
function loadBenchmark() {
  const body = document.getElementById('bm-body');
  const meta = document.getElementById('bm-run-meta');
  body.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>${t('benchmark.loading')}</span></div>`;
  fetch('/api/v1/benchmark/results')
    .then(r => {
      if (r.status === 404) throw Object.assign(new Error('no-results'), { type: 'no-results' });
      if (!r.ok) throw new Error('server-error');
      return r.json();
    })
    .then(data => {
      meta.textContent = data.projectLabel + ' — ' + data.generatedAt;
      body.innerHTML = renderBmSection(data.semantic) + renderBmSection(data.code);
    })
    .catch(err => {
      if (err.type === 'no-results') {
        body.innerHTML = `<div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a10 10 0 1 0 10 10"/><polyline points="12 6 12 12 16 14"/><path d="M18 2v4l3 2"/></svg>
          <p>${t('benchmark.noResults')}</p>
          <span>${t('benchmark.noResultsHint')}</span>
        </div>`;
      } else {
        body.innerHTML = `<div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p>${t('benchmark.error')}</p>
          <span>${t('benchmark.errorHint')}</span>
        </div>`;
      }
    });
}

function renderBmSection(sec) {
  if (!sec) return '';
  const passed = sec.passed;
  const badgeCls = passed ? 'bm-pass' : 'bm-fail';
  const badgeTxt = passed ? 'PASS' : 'FAIL';
  const mrrCls = sec.mrr10 >= 0.7 ? 'mv' : 'mv-warn';

  const metrics = `
    <div class="bm-metrics">
      <span>Hit@1 <span class="mv">${pctFmt(sec.hit1Rate)}</span></span>
      <span>Hit@3 <span class="mv">${pctFmt(sec.hit3Rate)}</span></span>
      <span>Hit@5 <span class="mv">${pctFmt(sec.hit5Rate)}</span></span>
      <span>Hit@10 <span class="mv">${pctFmt(sec.hit10Rate)}</span></span>
      <span>MRR <span class="${mrrCls}">${sec.mrr10.toFixed(3)}</span></span>
      <span style="color:var(--text-3)">thr ${pctFmt(sec.threshold)}</span>
      <span style="color:var(--text-3)">${sec.total} queries</span>
    </div>`;

  const rows = (sec.cases || []).map(c => {
    const missCls = c.hit10 ? '' : 'bm-miss';
    const rankEl  = c.rank > 0
      ? `<span class="bm-rank-hit">${c.rank}</span>`
      : `<span class="bm-rank-miss">—</span>`;
    const scoreEl = c.hitScore > 0
      ? `<span class="bm-score">${c.hitScore.toFixed(3)}</span>`
      : `<span class="bm-rank-miss">—</span>`;
    return `<tr class="${missCls}">
      <td class="bm-id">${esc(c.id)}</td>
      <td class="bm-desc" title="${esc(c.description)}">${esc(c.description)}</td>
      <td>${bmMark(c.hit1)}</td>
      <td>${bmMark(c.hit3)}</td>
      <td>${bmMark(c.hit5)}</td>
      <td>${bmMark(c.hit10)}</td>
      <td>${rankEl}</td>
      <td>${scoreEl}</td>
    </tr>`;
  }).join('');

  return `<div class="bm-section">
    <div class="bm-section-header">
      <span class="bm-section-title">${esc(sec.title)}</span>
      <span class="${badgeCls}">${badgeTxt}</span>
      ${metrics}
    </div>
    <table class="bm-table">
      <thead><tr>
        <th>ID</th><th>Description</th>
        <th>@1</th><th>@3</th><th>@5</th><th>@10</th>
        <th>Rank</th><th>Score</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function bmMark(hit) {
  return hit ? '<span class="bm-hit">✓</span>' : '<span class="bm-x">✗</span>';
}

function pctFmt(rate) {
  return (rate * 100).toFixed(1) + '%';
}

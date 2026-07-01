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
    <div class="card" style="padding:0;overflow-x:auto">
      ${filtered.length === 0
        ? `<div class="empty-state" style="padding:32px">${t('sbom.noResults')}</div>`
        : `<table class="sbom-table">
          <thead><tr>
            <th>${t('sbom.col.group')}</th>
            <th>${t('sbom.col.name')}</th>
            <th>${t('sbom.col.version')}</th>
            <th>${t('sbom.col.scope')}</th>
            <th>${t('sbom.col.purl')}</th>
          </tr></thead>
          <tbody>${filtered.map(c => `
            <tr>
              <td class="sbom-col-group">${esc(c.group||'—')}</td>
              <td class="sbom-col-name">${esc(c.name||'—')}</td>
              <td class="sbom-col-ver">${esc(c.version||'—')}</td>
              <td><span class="sbom-scope-badge ${esc(c.scope||'')}">${esc(c.scope||'—')}</span></td>
              <td class="sbom-col-purl" title="${esc(c.purl||'')}">${esc(c.purl||'—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
    </div>`;
}

function setSbomScope(scope) {
  sbomState.scopeFilter = scope;
  renderSbomContent();
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

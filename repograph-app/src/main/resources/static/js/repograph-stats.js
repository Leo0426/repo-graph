/* ── Stats panel ── */
const FRAMEWORK_COLORS = { spring: '#3EFFA0', jaxrs: '#60A5FA', mybatis: '#FBBF24' };

function sumValues(map) {
  return Object.values(map || {}).reduce((a, b) => a + b, 0);
}

function distRows(map, total, colorFn, clickFn) {
  const entries = Object.entries(map || {});
  if (!entries.length) return '';
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([k, v]) => {
    const pct = Math.max(2, Math.round((v / max) * 100));
    const color = colorFn ? colorFn(k) : 'var(--mint)';
    const sharePct = total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '';
    const clickAttr = clickFn ? ` class="dist-row clickable" onclick="${clickFn(k)}" role="button" tabindex="0"` : ' class="dist-row"';
    return `<div${clickAttr} title="${esc(k)} · ${v} · ${sharePct}">
      <span class="dist-label" style="color:${color}">${esc(k)}</span>
      <div class="dist-bar-wrap"><div class="dist-bar" style="width:${pct}%;background:${color}"></div></div>
      <span class="dist-count">${v}</span>
    </div>`;
  }).join('');
}

function distCard(titleKey, map, total, colorFn, emptyKey, clickFn) {
  const rows = distRows(map, total, colorFn, clickFn);
  const body = rows || `<div class="dist-empty">${t(emptyKey || 'stats.noFramework')}</div>`;
  const totalLabel = total > 0 ? `<span class="total">${t('stats.total', total)}</span>` : '';
  return `<div class="dist-card">
    <h4>${t(titleKey)}${totalLabel}</h4>
    <div class="dist-rows">${body}</div>
  </div>`;
}

function renderProjectStats(s) {
  const container = document.getElementById('stats-content');
  if (!s || !s.projectId) {
    container.innerHTML = `<div class="empty-state">${t('stats.empty')}</div>`;
    return;
  }
  const meta = (state.projects || []).find(p => p.projectId === s.projectId);
  const name = meta ? projectName(meta) : (s.projectRoot ? s.projectRoot.split('/').filter(Boolean).pop() : s.projectId);
  const rel = meta ? relativeTime(meta.indexedAt) : '';
  const extras = [
    s.projectRoot ? esc(s.projectRoot) : '',
    meta ? esc(t('stats.units', meta.nodeCount)) : '',
    rel ? esc(t('stats.indexedAt', rel)) : '',
  ].filter(Boolean).join(' · ');
  container.innerHTML = `
    <div class="stats-meta">
      <span class="stats-meta-id">${esc(name)}</span>
      <span style="color:var(--text-3);font-size:11px;margin-left:6px">${esc(s.projectId)}</span>${extras ? ' · ' + extras : ''}
    </div>
    <div class="stats-summary">
      <div class="stat-card"><div class="stat-val">${s.totalUnits}</div><div class="stat-lbl">${t('stats.totalUnits')}</div></div>
      <div class="stat-card"><div class="stat-val">${s.totalFiles}</div><div class="stat-lbl">${t('stats.totalFiles')}</div></div>
      <div class="stat-card accent"><div class="stat-val">${s.totalEdges}</div><div class="stat-lbl">${t('stats.totalEdges')}</div></div>
      <div class="stat-card warn"><div class="stat-val">${s.entryPointCount}</div><div class="stat-lbl">${t('stats.entryPoints')}</div></div>
      <div class="stat-card"><div class="stat-val">${s.testCount}</div><div class="stat-lbl">${t('stats.tests')}</div></div>
    </div>
    <div id="health-badge-section" style="margin-top:12px">
      <div class="loading-row"><div class="spinner"></div><span>${t('stats.health')}</span></div>
    </div>
    <div class="dist-grid">
      ${distCard('stats.kind', s.kindDistribution, s.totalUnits, kindColor, null,
                 k => `drillToKind('${k}')`)}
      ${distCard('stats.lang', s.languageDistribution, s.totalUnits, () => 'var(--mint)')}
      ${distCard('stats.framework', s.frameworkDistribution, sumValues(s.frameworkDistribution),
                 k => FRAMEWORK_COLORS[k] || 'var(--mint)', 'stats.noFramework')}
      ${distCard('stats.edge', s.edgeKindDistribution, s.totalEdges, () => 'var(--purple)')}
    </div>
  `;
  updateWatchBar(s.projectId, s.projectRoot);
  loadHealthBadge(s.projectId);
  loadComplexity(s.projectId);
  loadCoupling(s.projectId);
  loadPackageCycles(s.projectId);
  loadHotspots(s.projectId);
  loadExportSection(s.projectId);
}

async function loadProjectStats() {
  const raw = document.getElementById('stats-project-input').value.trim();
  const container = document.getElementById('stats-content');
  if (!raw) {
    container.innerHTML = `<div class="empty-state"><p>${t('stats.empty')}</p><span>${t('stats.emptyHint')}</span></div>`;
    return;
  }
  const pid = resolveProjectId(raw);
  container.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>Loading…</span></div>`;
  try {
    const s = await api.projectStats(pid);
    renderProjectStats(s);
    if (s && s.projectId) {
      history.replaceState(null, '', `#stats=${encodeURIComponent(s.projectId)}`);
    }
  } catch (e) {
    container.innerHTML = `<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

function readStatsHash() {
  const m = /^#stats=([^&]+)$/.exec(location.hash || '');
  return m ? decodeURIComponent(m[1]) : '';
}

/* ── Health score badge ── */
async function loadHealthBadge(projectId) {
  const section = document.getElementById('health-badge-section');
  if (!section || !projectId) return;
  try {
    const r = await api.healthReport(projectId);
    const score = r.healthScore ?? 0;
    const [letter, emoji] = score >= 90 ? ['A', '✅'] : score >= 75 ? ['B', '🟡'] : score >= 60 ? ['C', '🟠'] : ['D', '🔴'];
    const scoreColor = score >= 90 ? 'var(--mint)' : score >= 75 ? 'var(--amber)' : 'var(--amber)';
    const totalVulns = (r.vulnCritical || 0) + (r.vulnHigh || 0) + (r.vulnMedium || 0) + (r.vulnLow || 0);
    const gapPct = r.totalProductionMethods > 0
      ? Math.round(100 * r.testGapCount / r.totalProductionMethods) + '%'
      : 'N/A';
    const apiUrl = `/api/v1/metrics/report?projectId=${encodeURIComponent(projectId)}`;
    const pills = [
      totalVulns > 0
        ? `<span style="background:var(--red)22;color:var(--red);border:1px solid var(--red)44;border-radius:4px;padding:2px 7px;font-size:10px">${t('stats.health.vulns', totalVulns)}</span>`
        : `<span style="background:var(--mint)22;color:var(--mint);border:1px solid var(--mint)44;border-radius:4px;padding:2px 7px;font-size:10px">${t('stats.health.noVulns')}</span>`,
      r.highComplexityMethods > 0
        ? `<span style="background:var(--amber)22;color:var(--amber);border:1px solid var(--amber)44;border-radius:4px;padding:2px 7px;font-size:10px">CC>10: ${r.highComplexityMethods}</span>`
        : '',
      r.packageCycles > 0
        ? `<span style="background:var(--red)22;color:var(--red);border:1px solid var(--red)44;border-radius:4px;padding:2px 7px;font-size:10px">${t('stats.cycles.count', r.packageCycles)}</span>`
        : `<span style="background:var(--mint)22;color:var(--mint);border:1px solid var(--mint)44;border-radius:4px;padding:2px 7px;font-size:10px">${t('stats.cycles.none')}</span>`,
      `<span style="background:var(--surface-2)44;color:var(--text-2);border:1px solid var(--border);border-radius:4px;padding:2px 7px;font-size:10px">${t('stats.health.gap', gapPct)}</span>`,
    ].filter(Boolean).join('');

    section.innerHTML = `<div style="display:flex;align-items:center;gap:14px;padding:12px 16px;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;margin-bottom:4px">
      <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;min-width:56px">
        <span style="font-size:32px;font-weight:800;line-height:1;color:${scoreColor}">${score}</span>
        <span style="font-size:11px;color:var(--text-3);margin-top:1px">/100</span>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;color:var(--text-1);font-size:13px;margin-bottom:5px">${t('stats.health.label')} ${letter} ${emoji}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${pills}</div>
      </div>
      <a href="${esc(apiUrl)}" target="_blank" style="flex-shrink:0;font-size:11px;color:var(--text-3);text-decoration:none;padding:4px 8px;border:1px solid var(--border);border-radius:4px;white-space:nowrap" title="${t('stats.health.jsonTip')}">${t('stats.health.json')}</a>
    </div>`;
  } catch (_) {
    section.innerHTML = '';
  }
}

/* ── Complexity section ── */
async function loadComplexity(projectId) {
  const container = document.getElementById('stats-content');
  if (!container || !projectId) return;

  let section = document.getElementById('complexity-section');
  if (!section) {
    section = document.createElement('div');
    section.id = 'complexity-section';
    section.style.marginTop = '20px';
    container.appendChild(section);
  }
  section.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>${t('stats.complexity')}</span></div>`;

  try {
    const metrics = await api.complexity(projectId, 20);
    if (!metrics || !metrics.length) {
      section.innerHTML = `<div class="dist-card"><h4>${t('stats.complexity')}</h4><div class="dist-empty">${t('stats.complexity.empty')}</div></div>`;
      return;
    }
    const maxCC = Math.max(1, ...metrics.map(m => m.complexity));
    const rows = metrics.map(m => {
      const pct = Math.max(4, Math.round((m.complexity / maxCC) * 100));
      const color = m.complexity >= 10 ? 'var(--red)' : m.complexity >= 6 ? 'var(--amber)' : 'var(--mint)';
      const shortName = (m.qualifiedName || '').split('#').pop() || m.qualifiedName || '?';
      const file = (m.filePath || '').split('/').pop();
      return `<div class="dist-row" title="${esc(m.qualifiedName)} · ${m.filePath}:${m.startLine}">
        <span class="dist-label" style="color:${color};max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(m.qualifiedName)}">${esc(shortName)}</span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="dist-count" style="color:${color};font-weight:600">${t('stats.complexity.cc', m.complexity)}</span>
        <span style="color:var(--text-3);font-size:10px;margin-left:6px;flex-shrink:0">${esc(file)}:${m.startLine}</span>
      </div>`;
    }).join('');
    section.innerHTML = `<div class="dist-card">
      <h4>${t('stats.complexity')}<span class="total">${t('stats.total', metrics.length)}</span></h4>
      <div class="dist-rows">${rows}</div>
    </div>`;
  } catch (_) {
    section.remove();
  }
}

/* ── Coupling section ── */
async function loadCoupling(projectId) {
  const container = document.getElementById('stats-content');
  if (!container || !projectId) return;

  let section = document.getElementById('coupling-section');
  if (!section) {
    section = document.createElement('div');
    section.id = 'coupling-section';
    section.style.marginTop = '12px';
    container.appendChild(section);
  }
  section.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>${t('stats.coupling')}</span></div>`;

  try {
    const metrics = await api.coupling(projectId, 'fanout', 20);
    if (!metrics || !metrics.length) {
      section.innerHTML = `<div class="dist-card"><h4>${t('stats.coupling')}</h4><div class="dist-empty">${t('stats.coupling.empty')}</div></div>`;
      return;
    }
    const maxFanOut = Math.max(1, ...metrics.map(m => m.fanOut));
    const rows = metrics.map(m => {
      const pct = Math.max(4, Math.round((m.fanOut / maxFanOut) * 100));
      const color = m.instability >= 0.8 ? 'var(--red)' : m.instability >= 0.5 ? 'var(--amber)' : 'var(--mint)';
      const shortName = (m.classQualifiedName || '').split('.').pop() || m.classQualifiedName || '?';
      return `<div class="dist-row" title="${esc(m.classQualifiedName)} · Ce=${m.fanOut} Ca=${m.fanIn} I=${m.instability}">
        <span class="dist-label" style="color:${color};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(m.classQualifiedName)}">${esc(shortName)}</span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="dist-count" style="color:${color};font-weight:600">${t('stats.coupling.fanout', m.fanOut)}</span>
        <span style="color:var(--text-3);font-size:10px;margin-left:6px;flex-shrink:0">${t('stats.coupling.fanin', m.fanIn)} ${t('stats.coupling.instability', m.instability)}</span>
      </div>`;
    }).join('');
    section.innerHTML = `<div class="dist-card">
      <h4>${t('stats.coupling')}<span class="total">${t('stats.total', metrics.length)}</span></h4>
      <div class="dist-rows">${rows}</div>
    </div>`;
  } catch (_) {
    section.remove();
  }
}

/* ── Package cycles section ── */
async function loadPackageCycles(projectId) {
  const container = document.getElementById('stats-content');
  if (!container || !projectId) return;

  let section = document.getElementById('cycles-section');
  if (!section) {
    section = document.createElement('div');
    section.id = 'cycles-section';
    section.style.marginTop = '12px';
    container.appendChild(section);
  }
  section.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>${t('stats.cycles')}</span></div>`;

  try {
    const cycles = await api.packageCycles(projectId);
    if (!cycles) {
      section.remove();
      return;
    }
    if (!cycles.length) {
      section.innerHTML = `<div class="dist-card">
        <h4>${t('stats.cycles')}</h4>
        <div class="dist-empty" style="color:var(--mint)">${t('stats.cycles.none')}</div>
      </div>`;
      return;
    }
    const rows = cycles.map((cycle, idx) => {
      const pkgs = (cycle.packages || []).slice().sort();
      const badge = `<span style="background:var(--red)22;color:var(--red);border:1px solid var(--red)44;border-radius:4px;padding:1px 6px;font-size:10px;margin-right:6px">${t('stats.cycles.involves', pkgs.length)}</span>`;
      const pkgList = pkgs.map(p => {
        const short = p.split('.').pop();
        return `<span title="${esc(p)}" style="color:var(--amber);font-size:11px;margin-right:4px">${esc(short)}</span>`;
      }).join('→');
      return `<div class="dist-row" title="${esc(pkgs.join(' → '))}">
        <span style="color:var(--red);font-weight:600;flex-shrink:0">⊗ ${idx + 1}</span>
        <span style="flex:1;margin:0 8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${badge}${pkgList}</span>
      </div>`;
    }).join('');

    section.innerHTML = `<div class="dist-card">
      <h4>${t('stats.cycles')}<span class="total" style="color:var(--red)">${t('stats.cycles.count', cycles.length)}</span></h4>
      <div class="dist-rows">${rows}</div>
    </div>`;
  } catch (_) {
    section.remove();
  }
}

/* ── Git hotspots section ── */
async function loadHotspots(projectId) {
  const container = document.getElementById('stats-content');
  if (!container || !projectId) return;

  let section = document.getElementById('hotspots-section');
  if (!section) {
    section = document.createElement('div');
    section.id = 'hotspots-section';
    section.style.marginTop = '12px';
    container.appendChild(section);
  }
  section.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>${t('stats.hotspots')}</span></div>`;

  try {
    const hotspots = await api.hotspots(projectId, 10);
    if (!hotspots || !hotspots.length) {
      section.innerHTML = `<div class="dist-card"><h4>${t('stats.hotspots')}</h4><div class="dist-empty">${t('stats.hotspots.empty')}</div></div>`;
      return;
    }
    const maxScore = Math.max(1, ...hotspots.map(h => h.hotspotScore));
    const rows = hotspots.map(h => {
      const pct = Math.max(4, Math.round((h.hotspotScore / maxScore) * 100));
      const color = h.hotspotScore >= 20 ? 'var(--red)' : h.hotspotScore >= 10 ? 'var(--amber)' : 'var(--mint)';
      const parts = (h.filePath || '').replace(/\\/g, '/').split('/');
      const shortFile = parts.pop() || h.filePath || '?';
      const dir = parts.length ? parts.join('/') + '/' : '';
      return `<div class="dist-row" title="${esc(h.filePath)} · churn=${h.churnCount} avgCC=${h.avgComplexity}">
        <span class="dist-label" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(h.filePath)}">
          <span style="color:var(--text-3);font-size:10px">${esc(dir)}</span><span style="color:${color}">${esc(shortFile)}</span>
        </span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="dist-count" style="color:${color};font-weight:600">${t('stats.hotspots.score', h.hotspotScore.toFixed(1))}</span>
        <span style="color:var(--text-3);font-size:10px;margin-left:6px;flex-shrink:0">${t('stats.hotspots.churn', h.churnCount)} ${t('stats.hotspots.avgcc', h.avgComplexity.toFixed(1))}</span>
      </div>`;
    }).join('');

    section.innerHTML = `<div class="dist-card">
      <h4>${t('stats.hotspots')}<span class="total">${t('stats.total', hotspots.length)}</span></h4>
      <div class="dist-rows">${rows}</div>
    </div>`;
  } catch (_) {
    section.innerHTML = `<div class="dist-card"><h4>${t('stats.hotspots')}</h4><div class="dist-empty">${t('stats.hotspots.noGit')}</div></div>`;
  }
}

/* ── Dependency Graph Export section ── */
async function loadExportSection(projectId) {
  const container = document.getElementById('stats-content');
  if (!container || !projectId) return;

  let section = document.getElementById('export-section');
  if (!section) {
    section = document.createElement('div');
    section.id = 'export-section';
    section.style.marginTop = '12px';
    container.appendChild(section);
  }

  const dotUrl = api.exportGraphUrl(projectId, 'dot');
  const mermaidUrl = api.exportGraphUrl(projectId, 'mermaid');

  section.innerHTML = `<div class="dist-card">
    <h4>${t('stats.export')}</h4>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <a href="${esc(dotUrl)}" target="_blank"
         style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text-2);text-decoration:none;cursor:pointer"
         title="${t('stats.export.dotTip')}">
        🕸 ${t('stats.export.dot')}
      </a>
      <button onclick="copyMermaid('${esc(projectId)}')"
              style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text-2);background:transparent;cursor:pointer"
              title="${t('stats.export.mermaidTip')}">
        📊 ${t('stats.export.mermaid')}
      </button>
      <a href="${esc(mermaidUrl)}" target="_blank"
         style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text-3);text-decoration:none;cursor:pointer"
         title="${t('stats.export.rawTip')}">
        ↗ ${t('stats.export.raw')}
      </a>
    </div>
    <div id="export-preview" style="display:none">
      <pre id="export-preview-code" style="background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:10px;font-size:11px;max-height:160px;overflow:auto;white-space:pre;color:var(--text-2)"></pre>
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-top:6px">${t('stats.export.hint')}</div>
  </div>`;
}

async function copyMermaid(projectId) {
  try {
    const text = await api.exportGraph(projectId, 'mermaid');
    const preview = document.getElementById('export-preview');
    const code = document.getElementById('export-preview-code');
    if (preview && code) {
      code.textContent = text.length > 800 ? text.slice(0, 800) + '\n…' : text;
      preview.style.display = '';
    }
    await copyToClipboard(text);
    showToast(t('stats.export.copied'));
  } catch (e) {
    showToast(t('stats.export.error'));
  }
}

/* ── Watch bar ── */
let _watchBarPid = null;
let _watchBarRoot = '';

async function updateWatchBar(projectId, projectRoot) {
  const bar = document.getElementById('stats-watch-bar');
  const label = document.getElementById('stats-watch-label');
  const btn = document.getElementById('stats-watch-btn');
  if (!bar || !projectId) return;
  _watchBarPid = projectId;
  _watchBarRoot = projectRoot || '';
  bar.style.display = '';
  try {
    const { watching } = await api.watchStatus(projectId);
    bar.classList.toggle('active', watching);
    label.textContent = t(watching ? 'watch.active' : 'watch.idle');
    btn.textContent = t(watching ? 'watch.stop' : 'watch.start');
  } catch (_) { bar.style.display = 'none'; }
}

async function toggleWatch() {
  if (!_watchBarPid) return;
  const bar = document.getElementById('stats-watch-bar');
  const isWatching = bar.classList.contains('active');
  try {
    if (isWatching) {
      await api.watchStop(_watchBarPid);
    } else {
      await api.watchStart(_watchBarPid, _watchBarRoot);
    }
    await updateWatchBar(_watchBarPid, _watchBarRoot);
  } catch (e) {
    showToast(e.message || 'Watch toggle failed');
  }
}

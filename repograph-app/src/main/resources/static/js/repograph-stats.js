/* ── Stats panel ── */
const FRAMEWORK_COLORS = { spring: 'var(--mint)', jaxrs: 'var(--cyan)', mybatis: 'var(--amber)' };
let statsRequestVersion = 0;
let statsPendingRequest = null;
let statsSnapshot = null;
let statsLoadedRaw = '';
let statsDisplayState = { kind: 'empty', message: '' };
let statsRenderedLanguage = currentLang;
const statsMetricCache = new Map();

function sumValues(map) {
  return Object.values(map || {}).reduce((total, count) => total + Number(count), 0);
}

function statsNumber(value) {
  return Number(value || 0).toLocaleString(currentLang === 'zh' ? 'zh-CN' : 'en-US');
}

function distRows(map, total, colorFn, clickable = false) {
  return Object.entries(map || {}).map(([key, value]) => {
    const share = total > 0 ? Number(value) / total * 100 : 0;
    const width = Math.max(0, Math.min(100, share));
    const color = colorFn ? colorFn(key) : 'var(--mint)';
    const label = `${key} · ${statsNumber(value)} · ${share.toFixed(1)}%`;
    const action = clickable && !!document.querySelector(`.filter-chip[data-group="kind"][data-val="${CSS.escape(key)}"]`);
    const tag = action ? 'button' : 'div';
    return `<${tag} class="dist-row stats-distribution-row${action ? ' clickable' : ''}"
      ${action ? `type="button" data-stats-kind="${esc(key)}" aria-label="${esc(label + ' · ' + t('stats.kindAction'))}"` : ''}
      title="${esc(label)}">
      <span class="dist-label" style="color:${color}">${esc(key)}</span>
      <span class="dist-count">${statsNumber(value)}</span><span class="stats-share">${share.toFixed(1)}%</span>
      <span class="dist-bar-wrap" aria-hidden="true"><span class="dist-bar" style="width:${width}%;background:${color}"></span></span>
    </${tag}>`;
  }).join('');
}

function distCard(titleKey, map, total, colorFn, emptyKey, clickable, shareKey) {
  const rows = distRows(map, total, colorFn, clickable);
  return `<section class="dist-card stats-distribution-card">
    <h4>${t(titleKey)}<span class="total">${t('stats.total', statsNumber(total))}</span></h4>
    <p class="stats-card-hint">${t(shareKey || 'stats.shareUnits')}</p>
    <div class="dist-rows">${rows || `<div class="dist-empty">${t(emptyKey || 'stats.noDistribution')}</div>`}</div>
    ${clickable && rows ? `<p class="stats-card-action-hint">↗ ${t('stats.kindAction')}</p>` : ''}
  </section>`;
}

function setStatsBusy(busy) {
  document.getElementById('stats-content').setAttribute('aria-busy', String(busy));
  document.getElementById('stats-load-btn').disabled = busy;
  const label = document.getElementById('stats-load-label');
  label.dataset.i18n = busy ? 'stats.loading' : 'btn.loadStats';
  label.textContent = t(label.dataset.i18n);
}

function resetStatsWatchBar() {
  _watchBarPid = null;
  _watchBarRoot = '';
  document.getElementById('stats-watch-bar').style.display = 'none';
}

function renderStatsState(kind, message = '') {
  statsDisplayState = { kind, message };
  const loading = kind === 'loading';
  const error = kind === 'error';
  const title = t(loading ? 'stats.loading' : error ? 'stats.loadFailed' : 'stats.empty');
  document.getElementById('stats-content').innerHTML = `<div class="stats-state${error ? ' stats-state-error' : ''}">
    <span class="stats-state-mark" aria-hidden="true">${loading ? '◌' : error ? '!' : '▥'}</span>
    <h3>${title}</h3>${!loading || message ? `<p>${esc(message || t('stats.emptyHint'))}</p>` : ''}
    ${error ? `<button class="btn btn-ghost stats-retry" type="button" onclick="loadProjectStats(true)">${t('stats.retry')}</button>` : ''}
  </div>`;
  document.getElementById('stats-status').textContent = message || title;
  setStatsBusy(loading);
}

function invalidateStatsInput() {
  statsRequestVersion++;
  statsPendingRequest = null;
  statsSnapshot = null;
  statsLoadedRaw = '';
  statsMetricCache.clear();
  resetStatsWatchBar();
  const raw = document.getElementById('stats-project-input').value.trim();
  if (!raw && Alpine.store('repograph').panel === 'stats' && location.hash.startsWith('#stats=')) {
    history.replaceState(null, '', '#stats');
    Alpine.store('repograph').routeHash = location.hash;
  }
  renderStatsState('empty', raw ? t('stats.queryChanged') : '');
}

function renderProjectStats(s, reuseData = false) {
  if (!s?.projectId) return renderStatsState('empty');
  statsSnapshot = s;
  statsDisplayState = { kind: 'loaded', message: '' };
  statsRenderedLanguage = currentLang;
  const container = document.getElementById('stats-content');
  const meta = (state.projects || []).find(project => project.projectId === s.projectId);
  const name = meta ? projectName(meta) : (s.projectRoot?.replace(/\\/g, '/').split('/').filter(Boolean).pop() || s.projectId);
  const rel = meta?.indexedAt ? relativeTime(meta.indexedAt) : '';
  const metrics = [['totalUnits', 'stats.totalUnits'], ['totalFiles', 'stats.totalFiles'], ['totalEdges', 'stats.totalEdges'],
    ['entryPointCount', 'stats.entryPoints'], ['testCount', 'stats.tests']];
  container.dataset.projectId = s.projectId;
  container.innerHTML = `<header class="stats-project-heading">
    <div><span class="stats-eyebrow">${t('stats.scale')}</span><h2>${esc(name)}</h2>
      ${s.projectRoot ? `<p class="stats-project-path">${esc(s.projectRoot)}</p>` : ''}</div>
    <div class="stats-project-meta"><code>${esc(s.projectId)}</code>${rel ? `<span>${esc(t('stats.indexedAt', rel))}</span>` : ''}</div>
    </header>
    <div class="stats-summary">${metrics.map(([field, key], index) => `<div class="stat-card${index < 3 ? ' stats-primary-metric' : ''}">
      <div class="stat-val">${statsNumber(s[field])}</div><div class="stat-lbl">${t(key)}</div></div>`).join('')}</div>
    ${s.totalUnits === 0 ? `<div class="stats-zero"><strong>${t('stats.zeroTitle')}</strong><p>${t('stats.zeroHint')}</p></div>` : ''}
    <div class="stats-section-heading"><h3>${t('stats.distributions')}</h3></div>
    <div class="dist-grid">
      ${distCard('stats.kind', s.kindDistribution, s.totalUnits, kindColor, null, true)}
      ${distCard('stats.lang', s.languageDistribution, s.totalUnits)}
      ${distCard('stats.framework', s.frameworkDistribution, sumValues(s.frameworkDistribution),
        key => FRAMEWORK_COLORS[key] || 'var(--mint)', 'stats.noFramework', false, 'stats.shareFramework')}
      ${distCard('stats.edge', s.edgeKindDistribution, s.totalEdges, () => 'var(--purple)', null, false, 'stats.shareEdges')}
    </div>
    ${s.totalUnits > 0 ? `<section class="stats-quality"><div class="stats-section-heading"><h3>${t('stats.quality')}</h3>
      <p>${t('stats.qualityHint')}</p></div><div id="health-badge-section"></div><div id="stats-analysis" class="stats-analysis-grid"></div></section>` : ''}`;
  container.querySelectorAll('[data-stats-kind]').forEach(button => button.addEventListener('click', () =>
    drillToKind(button.dataset.statsKind, s.projectId)));
  document.getElementById('stats-status').textContent = `${name} · ${t('stats.units', statsNumber(s.totalUnits))}`;
  setStatsBusy(false);
  if (!reuseData) updateWatchBar(s.projectId, s.projectRoot);
  else renderStatsWatchState();
  if (s.totalUnits > 0) {
    loadHealthBadge(s.projectId);
    loadComplexity(s.projectId);
    loadCoupling(s.projectId);
    loadPackageCycles(s.projectId);
    loadHotspots(s.projectId);
    loadExportSection(s.projectId);
  }
}

async function loadProjectStats(force = false) {
  const store = Alpine.store('repograph');
  if (store.panel !== 'stats') return;
  const input = document.getElementById('stats-project-input');
  const raw = input.value.trim();
  const requestedHash = location.hash;
  if (!raw) { invalidateStatsInput(); return; }
  if (statsPendingRequest?.raw === raw && statsPendingRequest.hash === requestedHash) {
    // The owning request renders any failure; duplicate callers must not leak a rejected promise.
    return statsPendingRequest.promise.catch(() => undefined);
  }
  if (!force && statsSnapshot && statsLoadedRaw === raw) return;
  const version = ++statsRequestVersion;
  const isCurrentRequest = () => version === statsRequestVersion && store.panel === 'stats'
    && location.hash === requestedHash && input.value.trim() === raw;
  statsSnapshot = null;
  statsMetricCache.clear();
  resetStatsWatchBar();
  renderStatsState('loading');
  const pending = { raw, hash: requestedHash, promise: api.projectStats(resolveProjectId(raw)) };
  statsPendingRequest = pending;
  try {
    const snapshot = await pending.promise;
    if (!isCurrentRequest()) return;
    if (!snapshot?.projectId) throw new Error(t('stats.invalidResponse'));
    statsLoadedRaw = raw;
    renderProjectStats(snapshot);
    history.replaceState(null, '', `#stats=${encodeURIComponent(snapshot.projectId)}`);
    store.routeHash = location.hash;
  } catch (error) {
    if (isCurrentRequest()) renderStatsState('error', error.message);
  } finally {
    if (version === statsRequestVersion) {
      statsPendingRequest = null;
      setStatsBusy(false);
      if (!statsSnapshot && statsDisplayState.kind === 'loading') renderStatsState('empty', t('stats.queryChanged'));
    }
  }
}

function refreshStatsLanguage() {
  if (statsRenderedLanguage === currentLang) return;
  statsRenderedLanguage = currentLang;
  if (!document.getElementById('stats-content')) return;
  if (!statsSnapshot) return renderStatsState(statsDisplayState.kind, statsDisplayState.message);
  const body = document.querySelector('#panel-stats .panel-body');
  const top = body.scrollTop;
  const focusedKind = document.activeElement?.dataset.statsKind;
  const preview = document.getElementById('export-preview');
  const previewText = preview?.style.display !== 'none' ? document.getElementById('export-preview-code')?.textContent : null;
  const snapshot = statsSnapshot;
  renderProjectStats(statsSnapshot, true);
  if (previewText != null && document.getElementById('export-preview-code')) {
    document.getElementById('export-preview').style.display = '';
    document.getElementById('export-preview-code').textContent = previewText;
  }
  if (focusedKind) document.querySelector(`[data-stats-kind="${CSS.escape(focusedKind)}"]`)?.focus({ preventScroll: true });
  requestAnimationFrame(() => { if (statsSnapshot === snapshot) body.scrollTop = top; });
}

function statsMetricData(key, projectId, load) {
  const cacheKey = `${projectId}:${key}`;
  if (!statsMetricCache.has(cacheKey)) statsMetricCache.set(cacheKey, load());
  return statsMetricCache.get(cacheKey);
}

function statsSectionCurrent(section, projectId) {
  return section.isConnected && statsSnapshot?.projectId === projectId;
}

function statsMetricFailure(section, key, titleKey, error) {
  section.innerHTML = `<div class="dist-card stats-metric-error"><h4>${t(titleKey)}</h4>
    <p>${t('stats.dataUnavailable')}</p><p class="stats-error-detail">${esc(error.message)}</p>
    <button class="btn btn-ghost stats-retry" type="button" onclick="retryStatsMetric('${key}')">${t('stats.retry')}</button></div>`;
}

function retryStatsMetric(key) {
  if (!statsSnapshot) return;
  const loaders = { health: loadHealthBadge, complexity: loadComplexity, coupling: loadCoupling,
    cycles: loadPackageCycles, hotspots: loadHotspots };
  statsMetricCache.delete(`${statsSnapshot.projectId}:${key}`);
  loaders[key]?.(statsSnapshot.projectId);
}

/* ── Health score badge ── */
async function loadHealthBadge(projectId) {
  const section = document.getElementById('health-badge-section');
  if (!section || !projectId) return;
  try {
    const r = await statsMetricData('health', projectId, () => api.healthReport(projectId));
    if (!statsSectionCurrent(section, projectId)) return;
    if (!Number.isFinite(r?.healthScore)) throw new Error(t('stats.invalidResponse'));
    const score = r.healthScore ?? 0;
    const letter = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
    const scoreColor = score >= 90 ? 'var(--mint)' : score >= 60 ? 'var(--amber)' : 'var(--red)';
    const totalVulns = (r.vulnCritical || 0) + (r.vulnHigh || 0) + (r.vulnMedium || 0) + (r.vulnLow || 0);
    const gapPct = r.totalProductionMethods > 0
      ? Math.round(100 * r.testGapCount / r.totalProductionMethods) + '%'
      : 'N/A';
    const apiUrl = `/api/v1/metrics/report?projectId=${encodeURIComponent(projectId)}`;
    const pills = [
      totalVulns > 0
        ? `<span style="background:rgba(251,140,150,.1);color:var(--red);border:1px solid rgba(251,140,150,.25);border-radius:4px;padding:2px 7px;font-size:12px">${t('stats.health.vulns', totalVulns)}</span>`
        : `<span style="background:rgba(110,231,183,.1);color:var(--mint);border:1px solid rgba(110,231,183,.25);border-radius:4px;padding:2px 7px;font-size:12px">${t('stats.health.noVulns')}</span>`,
      r.highComplexityMethods > 0
        ? `<span style="background:rgba(245,199,106,.1);color:var(--amber);border:1px solid rgba(245,199,106,.25);border-radius:4px;padding:2px 7px;font-size:12px">CC>10: ${r.highComplexityMethods}</span>`
        : '',
      r.packageCycles > 0
        ? `<span style="background:rgba(251,140,150,.1);color:var(--red);border:1px solid rgba(251,140,150,.25);border-radius:4px;padding:2px 7px;font-size:12px">${t('stats.cycles.count', r.packageCycles)}</span>`
        : `<span style="background:rgba(110,231,183,.1);color:var(--mint);border:1px solid rgba(110,231,183,.25);border-radius:4px;padding:2px 7px;font-size:12px">${t('stats.cycles.none')}</span>`,
      `<span style="background:var(--bg-3);color:var(--text-2);border:1px solid var(--border);border-radius:4px;padding:2px 7px;font-size:12px">${t('stats.health.gap', gapPct)}</span>`,
    ].filter(Boolean).join('');

    section.innerHTML = `<div class="stats-health-card" style="display:flex;align-items:center;gap:14px;padding:12px 16px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;margin-bottom:4px">
      <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;min-width:56px">
        <span style="font-size:32px;font-weight:800;line-height:1;color:${scoreColor}">${score}</span>
        <span style="font-size:12px;color:var(--text-3);margin-top:1px">/100</span>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;color:var(--text);font-size:13px;margin-bottom:5px">${t('stats.health.label')} ${letter}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${pills}</div>
      </div>
      <a href="${esc(apiUrl)}" target="_blank" style="flex-shrink:0;font-size:12px;color:var(--text-3);text-decoration:none;padding:4px 8px;border:1px solid var(--border);border-radius:4px;white-space:nowrap" title="${t('stats.health.jsonTip')}">${t('stats.health.json')}</a>
    </div>`;
  } catch (error) {
    if (statsSectionCurrent(section, projectId)) statsMetricFailure(section, 'health', 'stats.health', error);
  }
}

/* ── Complexity section ── */
async function loadComplexity(projectId) {
  const container = document.getElementById('stats-analysis');
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
    const metrics = await statsMetricData('complexity', projectId, () => api.complexity(projectId, 20));
    if (!statsSectionCurrent(section, projectId)) return;
    if (!Array.isArray(metrics)) throw new Error(t('stats.invalidResponse'));
    if (!metrics || !metrics.length) {
      section.innerHTML = `<div class="dist-card"><h4>${t('stats.complexity')}</h4><div class="dist-empty">${t('stats.complexity.empty')}</div></div>`;
      return;
    }
    const maxCC = Math.max(1, ...metrics.map(m => m.complexity));
    const rows = metrics.map(m => {
      const pct = Math.max(0, Math.round((m.complexity / maxCC) * 100));
      const color = m.complexity >= 10 ? 'var(--red)' : m.complexity >= 6 ? 'var(--amber)' : 'var(--mint)';
      const shortName = (m.qualifiedName || '').split('#').pop() || m.qualifiedName || '?';
      const file = (m.filePath || '').split('/').pop();
      return `<div class="dist-row" title="${esc(m.qualifiedName)} · ${m.filePath}:${m.startLine}">
        <span class="dist-label" style="color:${color};max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(m.qualifiedName)}">${esc(shortName)}</span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="dist-count" style="color:${color};font-weight:600">${t('stats.complexity.cc', m.complexity)}</span>
        <span style="color:var(--text-3);font-size:12px;margin-left:6px;flex-shrink:0">${esc(file)}:${m.startLine}</span>
      </div>`;
    }).join('');
    section.innerHTML = `<div class="dist-card">
      <h4>${t('stats.complexity')}<span class="total">${t('stats.total', metrics.length)}</span></h4>
      <div class="dist-rows">${rows}</div>
    </div>`;
  } catch (error) {
    if (statsSectionCurrent(section, projectId)) statsMetricFailure(section, 'complexity', 'stats.complexity', error);
  }
}

/* ── Coupling section ── */
async function loadCoupling(projectId) {
  const container = document.getElementById('stats-analysis');
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
    const metrics = await statsMetricData('coupling', projectId, () => api.coupling(projectId, 'fanout', 20));
    if (!statsSectionCurrent(section, projectId)) return;
    if (!Array.isArray(metrics)) throw new Error(t('stats.invalidResponse'));
    if (!metrics || !metrics.length) {
      section.innerHTML = `<div class="dist-card"><h4>${t('stats.coupling')}</h4><div class="dist-empty">${t('stats.coupling.empty')}</div></div>`;
      return;
    }
    const maxFanOut = Math.max(1, ...metrics.map(m => m.fanOut));
    const rows = metrics.map(m => {
      const pct = Math.max(0, Math.round((m.fanOut / maxFanOut) * 100));
      const color = m.instability >= 0.8 ? 'var(--red)' : m.instability >= 0.5 ? 'var(--amber)' : 'var(--mint)';
      const shortName = (m.classQualifiedName || '').split('.').pop() || m.classQualifiedName || '?';
      return `<div class="dist-row" title="${esc(m.classQualifiedName)} · Ce=${m.fanOut} Ca=${m.fanIn} I=${m.instability}">
        <span class="dist-label" style="color:${color};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(m.classQualifiedName)}">${esc(shortName)}</span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="dist-count" style="color:${color};font-weight:600">${t('stats.coupling.fanout', m.fanOut)}</span>
        <span style="color:var(--text-3);font-size:12px;margin-left:6px;flex-shrink:0">${t('stats.coupling.fanin', m.fanIn)} ${t('stats.coupling.instability', m.instability)}</span>
      </div>`;
    }).join('');
    section.innerHTML = `<div class="dist-card">
      <h4>${t('stats.coupling')}<span class="total">${t('stats.total', metrics.length)}</span></h4>
      <div class="dist-rows">${rows}</div>
    </div>`;
  } catch (error) {
    if (statsSectionCurrent(section, projectId)) statsMetricFailure(section, 'coupling', 'stats.coupling', error);
  }
}

/* ── Package cycles section ── */
async function loadPackageCycles(projectId) {
  const container = document.getElementById('stats-analysis');
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
    const cycles = await statsMetricData('cycles', projectId, () => api.packageCycles(projectId));
    if (!statsSectionCurrent(section, projectId)) return;
    if (!Array.isArray(cycles)) throw new Error(t('stats.invalidResponse'));
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
      const badge = `<span style="background:rgba(251,140,150,.1);color:var(--red);border:1px solid rgba(251,140,150,.25);border-radius:4px;padding:1px 6px;font-size:12px;margin-right:6px">${t('stats.cycles.involves', pkgs.length)}</span>`;
      const pkgList = pkgs.map(p => {
        const short = p.split('.').pop();
        return `<span title="${esc(p)}" style="color:var(--amber);font-size:12px;margin-right:4px">${esc(short)}</span>`;
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
  } catch (error) {
    if (statsSectionCurrent(section, projectId)) statsMetricFailure(section, 'cycles', 'stats.cycles', error);
  }
}

/* ── Git hotspots section ── */
async function loadHotspots(projectId) {
  const container = document.getElementById('stats-analysis');
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
    const hotspots = await statsMetricData('hotspots', projectId, () => api.hotspots(projectId, 10));
    if (!statsSectionCurrent(section, projectId)) return;
    if (!Array.isArray(hotspots)) throw new Error(t('stats.invalidResponse'));
    if (!hotspots || !hotspots.length) {
      section.innerHTML = `<div class="dist-card"><h4>${t('stats.hotspots')}</h4><div class="dist-empty">${t('stats.hotspots.empty')}</div></div>`;
      return;
    }
    const maxScore = Math.max(1, ...hotspots.map(h => h.hotspotScore));
    const rows = hotspots.map(h => {
      const pct = Math.max(0, Math.round((h.hotspotScore / maxScore) * 100));
      const color = h.hotspotScore >= 20 ? 'var(--red)' : h.hotspotScore >= 10 ? 'var(--amber)' : 'var(--mint)';
      const parts = (h.filePath || '').replace(/\\/g, '/').split('/');
      const shortFile = parts.pop() || h.filePath || '?';
      const dir = parts.length ? parts.join('/') + '/' : '';
      return `<div class="dist-row" title="${esc(h.filePath)} · churn=${h.churnCount} avgCC=${h.avgComplexity}">
        <span class="dist-label" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(h.filePath)}">
          <span style="color:var(--text-3);font-size:12px">${esc(dir)}</span><span style="color:${color}">${esc(shortFile)}</span>
        </span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="dist-count" style="color:${color};font-weight:600">${t('stats.hotspots.score', h.hotspotScore.toFixed(1))}</span>
        <span style="color:var(--text-3);font-size:12px;margin-left:6px;flex-shrink:0">${t('stats.hotspots.churn', h.churnCount)} ${t('stats.hotspots.avgcc', h.avgComplexity.toFixed(1))}</span>
      </div>`;
    }).join('');

    section.innerHTML = `<div class="dist-card">
      <h4>${t('stats.hotspots')}<span class="total">${t('stats.total', hotspots.length)}</span></h4>
      <div class="dist-rows">${rows}</div>
    </div>`;
  } catch (error) {
    if (statsSectionCurrent(section, projectId)) statsMetricFailure(section, 'hotspots', 'stats.hotspots', error);
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
      <pre id="export-preview-code" style="background:var(--bg-3);border:1px solid var(--border);border-radius:6px;padding:10px;font-size:12px;max-height:160px;overflow:auto;white-space:pre;color:var(--text-2)"></pre>
    </div>
    <div style="font-size:12px;color:var(--text-3);margin-top:6px">${t('stats.export.hint')}</div>
  </div>`;
}

async function copyMermaid(projectId) {
  try {
    const text = await api.exportGraph(projectId, 'mermaid');
    const preview = document.getElementById('export-preview');
    const code = document.getElementById('export-preview-code');
    if (preview && code && statsSnapshot?.projectId === projectId) {
      code.textContent = text.length > 800 ? text.slice(0, 800) + '\n…' : text;
      preview.style.display = '';
    }
    await copyToClipboard(text);
    showToast(t('stats.export.copied'));
  } catch (e) {
    showToast(t('stats.export.error'), 5000, 'error');
  }
}

/* ── Watch bar: actions always belong to the visible, successfully loaded snapshot. ── */
let _watchBarPid = null;
let _watchBarRoot = '';
let statsWatchState = { status: 'loading', watching: false };
let statsWatchRequest = 0;

function renderStatsWatchState() {
  const bar = document.getElementById('stats-watch-bar');
  if (!_watchBarPid || statsSnapshot?.projectId !== _watchBarPid) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  const { status, watching } = statsWatchState;
  const label = document.getElementById('stats-watch-label');
  const button = document.getElementById('stats-watch-btn');
  bar.classList.toggle('active', status === 'loaded' && watching);
  bar.setAttribute('aria-busy', String(status === 'loading'));
  label.dataset.i18n = status === 'loading' ? 'stats.watchChecking' : status === 'error'
    ? 'stats.watchUnavailable' : watching ? 'watch.active' : 'watch.idle';
  label.textContent = t(label.dataset.i18n);
  button.dataset.i18n = watching ? 'watch.stop' : 'watch.start';
  button.textContent = t(button.dataset.i18n);
  button.disabled = status !== 'loaded' || !_watchBarRoot;
  document.getElementById('stats-watch-retry').hidden = status !== 'error';
}

async function updateWatchBar(projectId, projectRoot) {
  if (!projectId || statsSnapshot?.projectId !== projectId) return;
  const request = ++statsWatchRequest;
  const version = statsRequestVersion;
  _watchBarPid = projectId;
  _watchBarRoot = projectRoot || '';
  statsWatchState = { status: 'loading', watching: false };
  renderStatsWatchState();
  const current = () => request === statsWatchRequest && version === statsRequestVersion
    && statsSnapshot?.projectId === projectId && _watchBarPid === projectId;
  try {
    const result = await api.watchStatus(projectId);
    if (!current()) return;
    if (typeof result?.watching !== 'boolean') throw new Error(t('stats.invalidResponse'));
    statsWatchState = { status: 'loaded', watching: result.watching };
  } catch (error) {
    if (!current()) return;
    statsWatchState = { status: 'error', watching: false };
    document.getElementById('stats-watch-label').title = error.message;
  }
  if (current()) renderStatsWatchState();
}

function retryStatsWatch() {
  if (_watchBarPid) updateWatchBar(_watchBarPid, _watchBarRoot);
}

async function toggleWatch() {
  if (!_watchBarPid || statsWatchState.status !== 'loaded') return;
  const projectId = _watchBarPid;
  const projectRoot = _watchBarRoot;
  const watching = statsWatchState.watching;
  const version = statsRequestVersion;
  statsWatchState.status = 'loading';
  renderStatsWatchState();
  try {
    if (watching) await api.watchStop(projectId);
    else await api.watchStart(projectId, projectRoot);
    // A refresh of this same project may have read the state before the mutation completed.
    if (statsSnapshot?.projectId === projectId && _watchBarPid === projectId) {
      await updateWatchBar(projectId, projectRoot);
    }
  } catch (error) {
    if (version === statsRequestVersion && _watchBarPid === projectId) {
      statsWatchState = { status: 'error', watching };
      renderStatsWatchState();
    }
    showToast(error.message, 5000, 'error');
  }
}

async function deleteProjectFromStats() {
  const projectId = _watchBarPid;
  const projectRoot = _watchBarRoot;
  if (!projectId || !await showDeleteModal(projectId, projectRoot)) return;
  try {
    await api.deleteProject(projectId, projectRoot);
    if (state.activeProjectId === projectId) setGlobalProject('');
    if (typeof resetDeletedIndexRoot === 'function') resetDeletedIndexRoot(projectRoot);
    showToast(`${t('btn.delete')}: ${projectRoot || projectId}`);
    if (_watchBarPid === projectId) {
      document.getElementById('stats-project-input').value = '';
      invalidateStatsInput();
    }
    await refreshProjectsList();
  } catch (error) {
    showToast(error.message, 5000, 'error');
  }
}

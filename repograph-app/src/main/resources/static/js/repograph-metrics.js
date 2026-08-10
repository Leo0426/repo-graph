/* ── Metrics panel ── */

let _metricsPid = '';
let _metricsTab = 'complexity';
let _architectureReviewStream = null;
let _architectureReviewRaw = '';
let _architectureReviewFrame = 0;

function populateMetricsProjectSelect() {
  const sel = document.getElementById('metrics-project-select');
  if (!sel) return;
  const prev = _metricsPid;
  sel.innerHTML = `<option value="">${t('ph.selectProject')}</option>` +
    (state.projects || []).map(p =>
      `<option value="${esc(p.projectId)}">${esc(projectName(p))}</option>`
    ).join('');
  if (prev) sel.value = prev;
}

function onMetricsProjectChange() {
  stopArchitectureReviewStream();
  const sel = document.getElementById('metrics-project-select');
  _metricsPid = sel ? sel.value : '';
  const reviewButton = document.getElementById('architecture-review-btn');
  if (reviewButton) reviewButton.disabled = !_metricsPid;
  resetArchitectureReview();
  if (_metricsPid) loadMetrics();
  else clearMetricsPanel();
}

function resetArchitectureReview() {
  const result = document.getElementById('architecture-review-result');
  if (result) result.innerHTML = `<div class="architecture-review-empty">${esc(t('arch.empty'))}</div>`;
}

async function generateArchitectureReview() {
  if (!_metricsPid) return;
  const button = document.getElementById('architecture-review-btn');
  const result = document.getElementById('architecture-review-result');
  stopArchitectureReviewStream();
  button.disabled = true;
  button.textContent = t('arch.generating');
  result.innerHTML = `<div class="architecture-review-loading"><div class="spinner"></div><span>${esc(t('arch.generatingHint'))}</span></div>`;
  if (!window.EventSource) {
    await generateArchitectureReviewFallback(button, result);
    return;
  }
  _architectureReviewRaw = '';
  let receivedResult = false;
  let terminalErrorReceived = false;
  const params = new URLSearchParams({ projectId: _metricsPid });
  const stream = new EventSource(`/api/v1/architecture/reviews/stream?${params}`);
  _architectureReviewStream = stream;
  stream.addEventListener('phase', () => renderArchitectureStream());
  stream.addEventListener('delta', event => {
    _architectureReviewRaw += event.data;
    scheduleArchitectureStreamRender();
  });
  stream.addEventListener('result', event => {
    receivedResult = true;
    renderArchitectureReview(JSON.parse(event.data));
  });
  stream.addEventListener('stream-error', event => {
    terminalErrorReceived = true;
    const error = JSON.parse(event.data);
    result.innerHTML = `<div class="architecture-review-error">${esc(error.message)}</div>`;
    stopArchitectureReviewStream();
    button.disabled = false;
    button.textContent = t('arch.generate');
  });
  stream.addEventListener('complete', () => {
    stopArchitectureReviewStream();
    button.disabled = false;
    button.textContent = t('arch.generate');
  });
  stream.onerror = () => {
    stopArchitectureReviewStream();
    button.disabled = false;
    button.textContent = t('arch.generate');
    if (!receivedResult && !terminalErrorReceived) {
      result.innerHTML = `<div class="architecture-review-error">${esc(t('arch.streamFailed'))}</div>`;
    }
  };
}

async function generateArchitectureReviewFallback(button, result) {
  try {
    renderArchitectureReview(await api.architectureReview(_metricsPid));
  } catch (error) {
    result.innerHTML = `<div class="architecture-review-error">${esc(error.message)}</div>`;
  } finally {
    button.disabled = false;
    button.textContent = t('arch.generate');
  }
}

function scheduleArchitectureStreamRender() {
  if (_architectureReviewFrame) return;
  _architectureReviewFrame = requestAnimationFrame(() => {
    _architectureReviewFrame = 0;
    renderArchitectureStream();
  });
}

function renderArchitectureStream() {
  const result = document.getElementById('architecture-review-result');
  if (!result) return;
  const chars = _architectureReviewRaw.length;
  let console = result.querySelector('.architecture-stream-console');
  if (!console) {
    result.innerHTML = `<div class="architecture-stream-console">
      <details>
        <summary>
          <span class="architecture-thinking-state"><i></i><b>${esc(t('arch.thinking'))}</b><small>${esc(t('arch.thinkingHint'))}</small></span>
          <code class="architecture-stream-count">0 CHARS</code><em>⌄</em>
        </summary>
        <div class="architecture-stream-body">
          <header><span>${esc(t('arch.liveOutput'))}</span><small>${esc(t('arch.publicOutput'))}</small></header>
          <pre class="streaming"></pre>
        </div>
      </details>
    </div>`;
    console = result.querySelector('.architecture-stream-console');
  }
  const count = console.querySelector('.architecture-stream-count');
  const output = console.querySelector('pre');
  if (count) count.textContent = `${chars} CHARS`;
  if (output) {
    output.textContent = _architectureReviewRaw || t('arch.awaitingTokens');
    if (console.querySelector('details')?.open) output.scrollTop = output.scrollHeight;
  }
}

function stopArchitectureReviewStream() {
  if (_architectureReviewStream) {
    _architectureReviewStream.close();
    _architectureReviewStream = null;
  }
  if (_architectureReviewFrame) {
    cancelAnimationFrame(_architectureReviewFrame);
    _architectureReviewFrame = 0;
  }
}

function renderArchitectureReview(review) {
  const result = document.getElementById('architecture-review-result');
  const evidence = new Map((review.evidence || []).map(item => [item.citationId, item]));
  const statusClass = String(review.status || '').toLowerCase();
  const observations = (review.observations || [])
    .map(item => `<li>${esc(item)}</li>`).join('');
  const candidates = (review.candidates || []).map(candidate => {
    const citations = (candidate.citations || []).map(id => {
      const fact = evidence.get(id);
      const title = fact ? `${fact.location} · ${fact.summary}` : id;
      return `<span class="architecture-citation" title="${esc(title)}">${esc(id)}</span>`;
    }).join('');
    return `<article class="architecture-candidate">
      <div class="architecture-candidate-rank">P${esc(candidate.priority)}</div>
      <div class="architecture-candidate-body">
        <header><strong>${esc(candidate.title)}</strong><code>${esc(candidate.location)}</code></header>
        <dl>
          <div><dt>${esc(t('arch.problem'))}</dt><dd>${esc(candidate.problem)}</dd></div>
          <div><dt>${esc(t('arch.suggestion'))}</dt><dd>${esc(candidate.suggestion)}</dd></div>
          <div><dt>${esc(t('arch.benefit'))}</dt><dd>${esc(candidate.benefit)}</dd></div>
          <div><dt>${esc(t('arch.costRisk'))}</dt><dd>${esc(candidate.cost)} · ${esc(candidate.risk)}</dd></div>
        </dl>
        <footer><span>${esc(candidate.methodology)}</span><div>${citations}</div></footer>
      </div>
    </article>`;
  }).join('');
  const missing = (review.missingInfo || []).map(item => `<li>${esc(item)}</li>`).join('');
  result.innerHTML = `<div class="architecture-review-meta">
      <span class="${statusClass}">${esc(review.status)}</span>
      <code>${esc(review.methodology)}</code><small>${esc(review.model || '—')}</small>
    </div>
    ${observations ? `<ul class="architecture-observations">${observations}</ul>` : ''}
    <div class="architecture-candidates">${candidates || `<div class="architecture-review-empty">${esc(t('arch.noCandidates'))}</div>`}</div>
    ${missing ? `<details class="architecture-missing"><summary>${esc(t('arch.missing'))}</summary><ul>${missing}</ul></details>` : ''}`;
}

function clearMetricsPanel() {
  const health = document.getElementById('metrics-health');
  if (health) health.innerHTML = `<div class="empty-state">${t('metrics.empty')}</div>`;
  setMetricsTabContent('');
}

function switchMetricsTab(tab) {
  _metricsTab = tab;
  document.querySelectorAll('.metrics-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  ['complexity', 'coupling', 'hotspots'].forEach(name => {
    const ctrl = document.getElementById(`ctrl-${name}`);
    if (ctrl) ctrl.style.display = name === tab ? 'flex' : 'none';
  });
  if (_metricsPid) loadMetricsTab(tab);
}

async function loadMetrics() {
  if (!_metricsPid) return;
  await Promise.all([
    loadMetricsHealth(_metricsPid),
    loadMetricsTab(_metricsTab),
  ]);
}

function loadMetricsTab(tab) {
  if (!_metricsPid) return;
  if (tab === 'complexity') loadMetricsComplexity(_metricsPid);
  else if (tab === 'coupling') loadMetricsCoupling(_metricsPid);
  else if (tab === 'cycles') loadMetricsCycles(_metricsPid);
  else if (tab === 'hotspots') loadMetricsHotspots(_metricsPid);
}

function setMetricsTabContent(html) {
  const el = document.getElementById('metrics-tab-content');
  if (el) el.innerHTML = html;
}

/* ── Health dashboard ── */
async function loadMetricsHealth(projectId) {
  const el = document.getElementById('metrics-health');
  if (!el) return;
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>${t('metrics.health.loading')}</span></div>`;
  try {
    const r = await api.healthReport(projectId);
    const score = r.healthScore ?? 0;
    const [grade, emoji] = score >= 90 ? ['A', '✅']
                         : score >= 75 ? ['B', '🟡']
                         : score >= 60 ? ['C', '🟠']
                         :               ['D', '🔴'];
    const scoreColor = score >= 75 ? 'var(--amber)' : score >= 60 ? 'var(--amber)' : 'var(--red)';
    const scoreColorFinal = score >= 90 ? 'var(--mint)' : scoreColor;

    const totalVulns = (r.vulnCritical || 0) + (r.vulnHigh || 0) + (r.vulnMedium || 0) + (r.vulnLow || 0);
    const totalProd = r.totalProductionMethods || 1;
    const deadPct = Math.round(100 * r.deadCodeCount / totalProd);
    const gapPct  = Math.round(100 * r.testGapCount  / totalProd);

    const dims = [
      {
        label: t('metrics.dim.vulns'),
        value: totalVulns === 0
          ? t('metrics.dim.ok')
          : `${r.vulnCritical || 0}C / ${r.vulnHigh || 0}H / ${r.vulnMedium || 0}M / ${r.vulnLow || 0}L`,
        color: totalVulns === 0 ? 'var(--mint)'
             : (r.vulnCritical > 0 || r.vulnHigh > 0) ? 'var(--red)' : 'var(--amber)',
      },
      {
        label: t('metrics.dim.complexity'),
        value: r.highComplexityMethods === 0
          ? t('metrics.dim.ok')
          : `${r.highComplexityMethods} ${t('metrics.dim.methods')}`,
        color: r.highComplexityMethods === 0 ? 'var(--mint)'
             : r.highComplexityMethods > 10  ? 'var(--red)' : 'var(--amber)',
      },
      {
        label: t('metrics.dim.coupling'),
        value: r.highInstabilityClasses === 0
          ? t('metrics.dim.ok')
          : `${r.highInstabilityClasses} ${t('metrics.dim.classes')}`,
        color: r.highInstabilityClasses === 0 ? 'var(--mint)'
             : r.highInstabilityClasses > 20  ? 'var(--red)' : 'var(--amber)',
      },
      {
        label: t('metrics.dim.cycles'),
        value: r.packageCycles === 0
          ? t('metrics.dim.ok')
          : `${r.packageCycles} ${t('metrics.dim.cycles.unit')}`,
        color: r.packageCycles === 0 ? 'var(--mint)' : 'var(--red)',
      },
      {
        label: t('metrics.dim.deadcode'),
        value: `${r.deadCodeCount} (${deadPct}%)`,
        color: deadPct > 30 ? 'var(--amber)' : 'var(--text-2)',
      },
      {
        label: t('metrics.dim.testgap'),
        value: `${r.testGapCount} (${gapPct}%)`,
        color: gapPct > 50 ? 'var(--red)' : gapPct > 30 ? 'var(--amber)' : 'var(--mint)',
      },
    ];

    el.innerHTML = `
      <div class="card" style="display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap">
        <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;min-width:72px;padding-top:4px">
          <span style="font-size:46px;font-weight:800;line-height:1;color:${scoreColorFinal}">${score}</span>
          <span style="font-size:11px;color:var(--text-3);margin-top:1px">/100</span>
          <span style="font-size:16px;font-weight:700;color:${scoreColorFinal};margin-top:4px">${grade} ${emoji}</span>
        </div>
        <div style="flex:1;min-width:200px">
          <div style="font-weight:600;font-size:13px;color:var(--text-1);margin-bottom:8px">${t('metrics.health.title')}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:5px">
            ${dims.map(d => `
              <div style="display:flex;justify-content:space-between;align-items:center;
                          padding:5px 10px;background:var(--surface-2);border-radius:6px;font-size:12px">
                <span style="color:var(--text-2)">${esc(d.label)}</span>
                <span style="font-weight:600;color:${d.color}">${esc(d.value)}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state" style="color:var(--red)">⚠ ${esc(e.message)}</div>`;
  }
}

/* ── Complexity tab ── */
async function loadMetricsComplexity(projectId) {
  const limit = parseInt(document.getElementById('complexity-limit')?.value || 20);
  setMetricsTabContent(`<div class="loading-row"><div class="spinner"></div><span>${t('stats.complexity')}</span></div>`);
  try {
    const metrics = await api.complexity(projectId, limit);
    if (!metrics?.length) {
      setMetricsTabContent(`<div class="empty-state">${t('stats.complexity.empty')}</div>`);
      return;
    }
    const maxCC = Math.max(1, ...metrics.map(m => m.complexity));
    const rows = metrics.map(m => {
      const pct   = Math.max(4, Math.round((m.complexity / maxCC) * 100));
      const color = m.complexity >= 10 ? 'var(--red)' : m.complexity >= 6 ? 'var(--amber)' : 'var(--mint)';
      const short = (m.qualifiedName || '').split('#').pop() || m.qualifiedName || '?';
      const file  = (m.filePath || '').split('/').pop();
      return `<div class="dist-row" title="${esc(m.qualifiedName)} · ${esc(m.filePath)}:${m.startLine}">
        <span class="dist-label" style="color:${color};max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${esc(m.qualifiedName)}">${esc(short)}</span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="dist-count" style="color:${color};font-weight:600">${t('stats.complexity.cc', m.complexity)}</span>
        <span style="color:var(--text-3);font-size:10px;margin-left:6px;flex-shrink:0">${esc(file)}:${m.startLine}</span>
      </div>`;
    }).join('');
    setMetricsTabContent(`<div class="dist-card"><div class="dist-rows">${rows}</div></div>`);
  } catch (e) {
    setMetricsTabContent(`<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`);
  }
}

/* ── Coupling tab ── */
async function loadMetricsCoupling(projectId) {
  const sort  = document.getElementById('coupling-sort')?.value || 'fanout';
  const limit = parseInt(document.getElementById('coupling-limit')?.value || 20);
  setMetricsTabContent(`<div class="loading-row"><div class="spinner"></div><span>${t('stats.coupling')}</span></div>`);
  try {
    const metrics = await api.coupling(projectId, sort, limit);
    if (!metrics?.length) {
      setMetricsTabContent(`<div class="empty-state">${t('stats.coupling.empty')}</div>`);
      return;
    }
    const key    = sort === 'fanin' ? 'fanIn' : 'fanOut';
    const maxVal = Math.max(1, ...metrics.map(m => m[key]));
    const rows = metrics.map(m => {
      const pct   = Math.max(4, Math.round((m[key] / maxVal) * 100));
      const color = m.instability >= 0.8 ? 'var(--red)' : m.instability >= 0.5 ? 'var(--amber)' : 'var(--mint)';
      const short = (m.classQualifiedName || '').split('.').pop() || m.classQualifiedName || '?';
      const primary   = sort === 'fanin'
        ? t('stats.coupling.fanin',  m.fanIn)
        : t('stats.coupling.fanout', m.fanOut);
      const secondary = sort === 'fanin'
        ? t('stats.coupling.fanout', m.fanOut)
        : t('stats.coupling.fanin',  m.fanIn);
      return `<div class="dist-row" title="${esc(m.classQualifiedName)} · Ce=${m.fanOut} Ca=${m.fanIn} I=${m.instability}">
        <span class="dist-label" style="color:${color};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${esc(m.classQualifiedName)}">${esc(short)}</span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="dist-count" style="color:${color};font-weight:600">${primary}</span>
        <span style="color:var(--text-3);font-size:10px;margin-left:6px;flex-shrink:0">${secondary} ${t('stats.coupling.instability', m.instability)}</span>
      </div>`;
    }).join('');
    setMetricsTabContent(`<div class="dist-card"><div class="dist-rows">${rows}</div></div>`);
  } catch (e) {
    setMetricsTabContent(`<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`);
  }
}

/* ── Cycles tab ── */
async function loadMetricsCycles(projectId) {
  setMetricsTabContent(`<div class="loading-row"><div class="spinner"></div><span>${t('stats.cycles')}</span></div>`);
  try {
    const cycles = await api.packageCycles(projectId);
    if (!cycles?.length) {
      setMetricsTabContent(`<div class="empty-state" style="color:var(--mint)">${t('stats.cycles.none')}</div>`);
      return;
    }
    const rows = cycles.map((cycle, idx) => {
      const pkgs = (cycle.packages || []).slice().sort();
      const pkgList = pkgs.map(p =>
        `<span title="${esc(p)}" style="color:var(--amber);font-size:11px;margin-right:4px">${esc(p.split('.').pop())}</span>`
      ).join('→');
      return `<div class="dist-row" title="${esc(pkgs.join(' → '))}">
        <span style="color:var(--red);font-weight:600;flex-shrink:0;margin-right:8px">⊗ ${idx + 1}</span>
        <span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">
          <span style="background:var(--red)22;color:var(--red);border:1px solid var(--red)44;border-radius:4px;
                       padding:1px 6px;font-size:10px;margin-right:6px">${t('stats.cycles.involves', pkgs.length)}</span>
          ${pkgList}
        </span>
      </div>`;
    }).join('');
    setMetricsTabContent(`<div class="dist-card">
      <div style="color:var(--red);font-size:12px;margin-bottom:8px;font-weight:600">${t('stats.cycles.count', cycles.length)}</div>
      <div class="dist-rows">${rows}</div>
    </div>`);
  } catch (e) {
    setMetricsTabContent(`<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`);
  }
}

/* ── Hotspots tab ── */
async function loadMetricsHotspots(projectId) {
  const limit = parseInt(document.getElementById('hotspots-limit')?.value || 10);
  setMetricsTabContent(`<div class="loading-row"><div class="spinner"></div><span>${t('stats.hotspots')}</span></div>`);
  try {
    const hotspots = await api.hotspots(projectId, limit);
    if (!hotspots?.length) {
      setMetricsTabContent(`<div class="empty-state">${t('stats.hotspots.empty')}</div>`);
      return;
    }
    const maxScore = Math.max(1, ...hotspots.map(h => h.hotspotScore));
    const rows = hotspots.map(h => {
      const pct   = Math.max(4, Math.round((h.hotspotScore / maxScore) * 100));
      const color = h.hotspotScore >= 20 ? 'var(--red)' : h.hotspotScore >= 10 ? 'var(--amber)' : 'var(--mint)';
      const parts     = (h.filePath || '').replace(/\\/g, '/').split('/');
      const shortFile = parts.pop() || h.filePath || '?';
      const dir       = parts.length ? parts.join('/') + '/' : '';
      return `<div class="dist-row" title="${esc(h.filePath)} · churn=${h.churnCount} avgCC=${h.avgComplexity}">
        <span class="dist-label" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${esc(h.filePath)}">
          <span style="color:var(--text-3);font-size:10px">${esc(dir)}</span><span style="color:${color}">${esc(shortFile)}</span>
        </span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="dist-count" style="color:${color};font-weight:600">${t('stats.hotspots.score', h.hotspotScore.toFixed(1))}</span>
        <span style="color:var(--text-3);font-size:10px;margin-left:6px;flex-shrink:0">${t('stats.hotspots.churn', h.churnCount)} ${t('stats.hotspots.avgcc', h.avgComplexity.toFixed(1))}</span>
      </div>`;
    }).join('');
    setMetricsTabContent(`<div class="dist-card"><div class="dist-rows">${rows}</div></div>`);
  } catch (e) {
    setMetricsTabContent(`<div class="empty-state">${t('stats.hotspots.noGit')}</div>`);
  }
}

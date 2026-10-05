/* ── Metrics: static facts and optional model advice retain separate state. ── */
let _metricsPid = '';
let _metricsTab = 'complexity';
let _metricsHealthRequest = 0;
let _metricsTabRequest = 0;
let _architectureReviewStream = null;
let _architectureReviewRaw = '';
let _architectureReviewFrame = 0;
let _architectureReviewRequest = 0;
let _architectureReviewBusy = false;
let _architectureReviewStatus = '';
let _metricsReport = null;
let _metricsRows = null;
let _metricsRowsSort = 'fanout';
let _metricsLanguage = '';
const metricLabel = key => `<span data-i18n="${key}">${esc(t(key))}</span>`;
const metricNumber = value => Number.isFinite(value) ? value : '—';

function populateMetricsProjectSelect() {
  const select = document.getElementById('metrics-project-select');
  if (!select) return;
  const projects = state.projects || [];
  const previous = _metricsPid || (projects.some(project => project.projectId === state.activeProjectId) ? state.activeProjectId : '');
  select.innerHTML = `<option value="" data-i18n="ph.selectProject">${esc(t('ph.selectProject'))}</option>`
    + projects.map(project => `<option value="${esc(project.projectId)}">${esc(projectName(project))}</option>`).join('');
  select.value = previous;
  if (select.value !== _metricsPid) onMetricsProjectChange();
}

function onMetricsProjectChange() {
  ++_metricsHealthRequest;
  ++_metricsTabRequest;
  stopArchitectureReviewStream();
  _metricsPid = document.getElementById('metrics-project-select')?.value || '';
  _metricsReport = null;
  _metricsRows = null;
  resetArchitectureReview();
  document.getElementById('metrics-refresh-btn').disabled = !_metricsPid;
  if (_metricsPid) loadMetrics();
  else clearMetricsPanel();
}

function clearMetricsPanel() {
  document.getElementById('metrics-health').innerHTML = `<div class="metrics-empty"><strong>${metricLabel('metrics.empty')}</strong><p>${metricLabel('metrics.noSelectionHint')}</p></div>`;
  document.getElementById('metrics-health').setAttribute('aria-busy', 'false');
  setMetricsTabContent('');
  document.getElementById('metrics-tab-content').setAttribute('aria-busy', 'false');
  document.getElementById('metrics-detail-count').textContent = '';
}

function switchMetricsTab(tab) {
  if (!['complexity', 'coupling', 'cycles', 'hotspots'].includes(tab)) return;
  _metricsTab = tab;
  ++_metricsTabRequest;
  _metricsRows = null;
  document.querySelectorAll('.metrics-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
    button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
  });
  ['complexity', 'coupling', 'hotspots'].forEach(name => { document.getElementById(`ctrl-${name}`).hidden = name !== tab; });
  const hint = document.getElementById('metrics-list-hint');
  hint.dataset.i18n = tab === 'cycles' ? 'metrics.cycleHint' : tab === 'hotspots' ? 'metrics.hotspotHint' : 'metrics.listHint';
  hint.textContent = t(hint.dataset.i18n);
  if (_metricsPid) loadMetricsTab(tab);
}

function loadMetrics() {
  if (!_metricsPid) return;
  return Promise.all([loadMetricsHealth(_metricsPid), loadMetricsTab(_metricsTab)]);
}
function loadMetricsTab(tab) { return _metricsPid ? loadMetricsRows(_metricsPid, tab) : undefined; }
function loadMetricsComplexity(projectId) { return loadMetricsRows(projectId, 'complexity'); }
function loadMetricsCoupling(projectId) { return loadMetricsRows(projectId, 'coupling'); }
function loadMetricsCycles(projectId) { return loadMetricsRows(projectId, 'cycles'); }
function loadMetricsHotspots(projectId) { return loadMetricsRows(projectId, 'hotspots'); }
function setMetricsTabContent(html) { document.getElementById('metrics-tab-content').innerHTML = html; }
function metricsError(error, action) {
  return `<div class="metrics-empty metrics-error" role="alert"><strong>${metricLabel('metrics.loadFailed')}</strong><p>${esc(error.message)}</p><button type="button" class="btn btn-ghost" onclick="${action}">${metricLabel('metrics.retry')}</button></div>`;
}

async function loadMetricsHealth(projectId) {
  const version = ++_metricsHealthRequest;
  const current = () => version === _metricsHealthRequest && projectId === _metricsPid;
  const element = document.getElementById('metrics-health');
  _metricsReport = null;
  element.setAttribute('aria-busy', 'true');
  element.innerHTML = `<div class="metrics-loading" role="status"><div class="spinner"></div>${metricLabel('metrics.health.loading')}</div>`;
  try {
    const report = await api.healthReport(projectId);
    if (!current()) return;
    if (!report || !Number.isFinite(report.healthScore)) throw new Error(t('metrics.invalidResponse'));
    _metricsReport = report;
    renderMetricsHealth(report);
  } catch (error) {
    if (current()) element.innerHTML = metricsError(error, 'loadMetricsHealth(_metricsPid)');
  } finally { if (current()) element.setAttribute('aria-busy', 'false'); }
}

function renderMetricsHealth(report) {
  const score = report.healthScore;
  const production = report.totalProductionMethods;
  const ratio = value => Number.isFinite(value) && Number.isFinite(production) && production > 0
    ? `${Math.round(value / production * 100)}%` : '—';
  const count = value => String(metricNumber(value));
  const vulnerabilities = ['vulnCritical', 'vulnHigh', 'vulnMedium', 'vulnLow'].map(field => count(report[field]));
  const dimensions = [
    ['vulns', `${vulnerabilities[0]} C · ${vulnerabilities[1]} H · ${vulnerabilities[2]} M · ${vulnerabilities[3]} L`, ''],
    ['complexity', count(report.highComplexityMethods), 'CC > 10'],
    ['coupling', count(report.highInstabilityClasses), 'I > 0.8'],
    ['cycles', count(report.packageCycles), ''],
    ['deadcode', count(report.deadCodeCount), ratio(report.deadCodeCount)],
    ['testgap', count(report.testGapCount), ratio(report.testGapCount)],
  ];
  const scoreTone = report.totalUnits === 0 || production === 0 ? 'unknown' : score >= 90 ? 'good' : score >= 60 ? 'warn' : 'bad';
  document.getElementById('metrics-health').innerHTML = `<div class="metrics-health-card">
    <div class="metrics-score" data-tone="${scoreTone}"><span>${metricLabel('metrics.score')}</span><strong>${esc(score)}<small>/100</small></strong>
      ${report.totalUnits === 0 ? `<p>${metricLabel('metrics.noUnits')}</p>` : ''}</div>
    <div class="metrics-health-facts"><h2>${metricLabel('metrics.facts')}</h2><div class="metrics-dimensions">${dimensions.map(([key, value, detail]) => `<div class="metrics-dimension" data-dimension="${key}"><span>${metricLabel('metrics.dim.' + key)}</span><strong>${esc(value)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`).join('')}</div></div>
    <div class="metrics-snapshot"><span>${metricLabel('stat.units')} <b>${count(report.totalUnits)}</b></span><span>${metricLabel('stat.files')} <b>${count(report.totalFiles)}</b></span><span>${metricLabel('stat.edges')} <b>${count(report.totalEdges)}</b></span><span>${metricLabel('metrics.productionMethods')} <b>${count(production)}</b></span>${report.generatedAt ? `<time datetime="${esc(report.generatedAt)}" title="${esc(report.generatedAt)}">${metricLabel('metrics.snapshot')} ${esc(relativeTime(report.generatedAt))}</time>` : ''}</div>
    <div class="metrics-health-notes"><p>${metricLabel('metrics.factHint')}</p>${production === 0 ? `<p class="metrics-no-methods">${metricLabel('metrics.noMethods')}</p>` : ''}<p>${metricLabel('metrics.ratioHint')}</p></div>
  </div>`;
}

async function loadMetricsRows(projectId, tab) {
  const version = ++_metricsTabRequest;
  const current = () => version === _metricsTabRequest && projectId === _metricsPid && tab === _metricsTab;
  const content = document.getElementById('metrics-tab-content');
  const sort = document.getElementById('coupling-sort').value;
  const limit = Number(document.getElementById(`${tab}-limit`)?.value || 20);
  _metricsRows = null;
  document.getElementById('metrics-detail-count').textContent = '';
  content.setAttribute('aria-busy', 'true');
  setMetricsTabContent(`<div class="metrics-loading" role="status"><div class="spinner"></div>${metricLabel('metrics.tab.' + tab)}</div>`);
  try {
    const rows = await (tab === 'complexity' ? api.complexity(projectId, limit) : tab === 'coupling' ? api.coupling(projectId, sort, limit) : tab === 'cycles' ? api.packageCycles(projectId) : api.hotspots(projectId, limit));
    if (!current()) return;
    if (!Array.isArray(rows)) throw new Error(t('metrics.invalidResponse'));
    _metricsRows = rows;
    _metricsRowsSort = sort;
    renderMetricsRows();
  } catch (error) {
    if (current()) setMetricsTabContent(metricsError(error, 'loadMetricsTab(_metricsTab)'));
  } finally { if (current()) content.setAttribute('aria-busy', 'false'); }
}

function renderMetricsRows() {
  if (!_metricsRows) return;
  const rows = _metricsRows;
  document.getElementById('metrics-detail-count').textContent = `${t('metrics.resultCount')} ${rows.length}`;
  if (!rows.length) {
    const key = _metricsTab === 'hotspots' ? 'stats.hotspots.empty' : _metricsTab === 'cycles' ? 'stats.cycles.none' : 'metrics.noData';
    setMetricsTabContent(`<div class="metrics-empty">${metricLabel(key)}</div>`);
    return;
  }
  if (_metricsTab === 'cycles') {
    setMetricsTabContent(`<div class="metrics-cycles">${rows.map((cycle, index) => `<article class="metrics-cycle"><h3>${index + 1} · ${esc(t('stats.cycles.involves', (cycle.packages || []).length))}</h3><ul>${(cycle.packages || []).map(pkg => `<li>${esc(pkg)}</li>`).join('')}</ul></article>`).join('')}</div>`);
    return;
  }
  const key = _metricsTab === 'complexity' ? 'complexity' : _metricsTab === 'hotspots' ? 'hotspotScore' : _metricsRowsSort === 'fanin' ? 'fanIn' : 'fanOut';
  const max = Math.max(0, ...rows.map(row => Number.isFinite(row[key]) ? row[key] : 0));
  setMetricsTabContent(`<div class="metrics-records">${rows.map(row => {
    const value = row[key];
    const width = Number.isFinite(value) && max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0;
    const title = _metricsTab === 'coupling' ? row.classQualifiedName : _metricsTab === 'hotspots' ? row.filePath : row.qualifiedName;
    const detail = _metricsTab === 'complexity' ? `${row.filePath || '—'}${row.startLine ? ':' + row.startLine : ''}`
      : _metricsTab === 'coupling' ? `Ca ${metricNumber(row.fanIn)} · Ce ${metricNumber(row.fanOut)} · I ${metricNumber(row.instability)}`
      : `${t('stats.hotspots.churn', metricNumber(row.churnCount))} · ${t('stats.hotspots.avgcc', metricNumber(row.avgComplexity))}`;
    const primary = _metricsTab === 'complexity' ? `CC ${metricNumber(value)}` : _metricsTab === 'coupling' ? `${key === 'fanIn' ? 'Ca' : 'Ce'} ${metricNumber(value)}` : t('stats.hotspots.score', Number.isFinite(value) ? value.toFixed(1) : '—');
    return `<article class="metrics-record"><div class="metrics-record-heading"><strong>${esc(title || '—')}</strong><b>${esc(primary)}</b></div><div class="metrics-record-detail">${esc(detail)}</div><div class="dist-bar-wrap" aria-hidden="true"><div class="dist-bar" style="width:${width}%"></div></div></article>`;
  }).join('')}</div>`);
}

function refreshMetricsLanguage() {
  if (!document.getElementById('metrics-project-select')) return;
  if (_metricsLanguage !== currentLang) {
    _metricsLanguage = currentLang;
    if (_metricsReport) renderMetricsHealth(_metricsReport);
    if (_metricsRows) renderMetricsRows();
  }
  updateArchitectureButton();
}

function updateArchitectureButton() {
  const button = document.getElementById('architecture-review-btn');
  if (!button) return;
  button.disabled = !_metricsPid || _architectureReviewBusy;
  button.dataset.i18n = _architectureReviewBusy ? 'arch.generating' : 'arch.generate';
  button.textContent = t(button.dataset.i18n);
  const status = document.getElementById('architecture-review-status');
  status.textContent = _architectureReviewBusy ? t('arch.generating') : _architectureReviewStatus ? t('arch.' + _architectureReviewStatus.toLowerCase()) : '';
}

function resetArchitectureReview() {
  _architectureReviewStatus = '';
  const result = document.getElementById('architecture-review-result');
  result.setAttribute('aria-busy', 'false');
  result.innerHTML = `<div class="architecture-review-empty">${metricLabel('arch.empty')}</div>`;
  updateArchitectureButton();
}

function stopArchitectureReviewStream() {
  ++_architectureReviewRequest;
  if (_architectureReviewStream) { _architectureReviewStream.close(); _architectureReviewStream = null; }
  if (_architectureReviewFrame) { cancelAnimationFrame(_architectureReviewFrame); _architectureReviewFrame = 0; }
  _architectureReviewBusy = false;
}

function architectureError(message) {
  document.getElementById('architecture-review-result').innerHTML = `<div class="architecture-review-error" role="alert">${esc(message)}</div>`;
  _architectureReviewStatus = 'FAILED';
}

function finishArchitectureReview() {
  stopArchitectureReviewStream();
  document.getElementById('architecture-review-result').setAttribute('aria-busy', 'false');
  updateArchitectureButton();
}

function validateArchitectureReview(review, projectId) {
  if (!review || review.projectId !== projectId || !['COMPLETED', 'DISABLED', 'FAILED'].includes(review.status)) throw new Error(t('arch.invalidResponse'));
}

async function generateArchitectureReview() {
  if (!_metricsPid || _architectureReviewBusy) return;
  stopArchitectureReviewStream();
  const projectId = _metricsPid;
  const version = ++_architectureReviewRequest;
  const current = () => version === _architectureReviewRequest && projectId === _metricsPid;
  const result = document.getElementById('architecture-review-result');
  _architectureReviewBusy = true;
  _architectureReviewStatus = '';
  _architectureReviewRaw = '';
  updateArchitectureButton();
  result.setAttribute('aria-busy', 'true');
  result.innerHTML = `<div class="architecture-review-loading"><div class="spinner"></div>${metricLabel('arch.generatingHint')}</div>`;
  if (!window.EventSource) {
    try {
      const review = await api.architectureReview(projectId);
      if (!current()) return;
      validateArchitectureReview(review, projectId);
      renderArchitectureReview(review);
    } catch (error) { if (current()) architectureError(error.message); }
    finally { if (current()) finishArchitectureReview(); }
    return;
  }
  let receivedResult = false;
  let stream;
  try { stream = new EventSource(`/api/v1/architecture/reviews/stream?${new URLSearchParams({ projectId })}`); }
  catch (error) { architectureError(error.message); finishArchitectureReview(); return; }
  _architectureReviewStream = stream;
  const active = () => current() && stream === _architectureReviewStream;
  const fail = message => { if (active()) { architectureError(message); finishArchitectureReview(); } };
  stream.addEventListener('phase', () => { if (active() && !receivedResult) renderArchitectureStream(); });
  stream.addEventListener('delta', event => {
    if (!active() || receivedResult) return;
    _architectureReviewRaw += event.data;
    if (!_architectureReviewFrame) _architectureReviewFrame = requestAnimationFrame(() => {
      _architectureReviewFrame = 0;
      if (active() && !receivedResult) renderArchitectureStream();
    });
  });
  stream.addEventListener('result', event => {
    if (!active()) return;
    try {
      const review = JSON.parse(event.data);
      validateArchitectureReview(review, projectId);
      if (_architectureReviewFrame) { cancelAnimationFrame(_architectureReviewFrame); _architectureReviewFrame = 0; }
      renderArchitectureReview(review);
      receivedResult = true;
    } catch (error) { fail(error.message); }
  });
  stream.addEventListener('stream-error', event => {
    if (!active()) return;
    try { fail(JSON.parse(event.data).message || t('arch.streamFailed')); }
    catch (_) { fail(t('arch.invalidResponse')); }
  });
  stream.addEventListener('complete', () => {
    if (!active()) return;
    if (!receivedResult) architectureError(t('arch.noResult'));
    finishArchitectureReview();
  });
  stream.onerror = () => {
    if (!active()) return;
    if (!receivedResult) architectureError(t('arch.streamFailed'));
    finishArchitectureReview();
  };
}

function renderArchitectureStream() {
  const result = document.getElementById('architecture-review-result');
  let console = result.querySelector('.architecture-stream-console');
  if (!console) {
    result.innerHTML = `<div class="architecture-stream-console"><details><summary><span class="architecture-thinking-state"><i></i><b>${metricLabel('arch.thinking')}</b><small>${metricLabel('arch.thinkingHint')}</small></span><code class="architecture-stream-count">0 CHARS</code><em>⌄</em></summary><div class="architecture-stream-body"><header><span>${metricLabel('arch.liveOutput')}</span><small>${metricLabel('arch.publicOutput')}</small></header><pre class="streaming" tabindex="0"></pre></div></details></div>`;
    console = result.querySelector('.architecture-stream-console');
  }
  const output = console.querySelector('pre');
  const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
  console.querySelector('.architecture-stream-count').textContent = `${_architectureReviewRaw.length} CHARS`;
  output.textContent = _architectureReviewRaw || t('arch.awaitingTokens');
  if (follow && console.querySelector('details').open) output.scrollTop = output.scrollHeight;
}
function renderArchitectureReview(review) {
  _architectureReviewStatus = review.status;
  updateArchitectureButton();
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
          <div><dt>${metricLabel('arch.problem')}</dt><dd>${esc(candidate.problem)}</dd></div>
          <div><dt>${metricLabel('arch.suggestion')}</dt><dd>${esc(candidate.suggestion)}</dd></div>
          <div><dt>${metricLabel('arch.benefit')}</dt><dd>${esc(candidate.benefit)}</dd></div>
          <div><dt>${metricLabel('arch.costRisk')}</dt><dd>${esc(candidate.cost)} · ${esc(candidate.risk)}</dd></div>
        </dl>
        <footer><span>${esc(candidate.methodology)}</span><div>${citations}</div></footer>
      </div>
    </article>`;
  }).join('');
  const missing = (review.missingInfo || []).map(item => `<li>${esc(item)}</li>`).join('');
  result.innerHTML = `<div class="architecture-review-meta">
      <span class="${statusClass}">${metricLabel('arch.' + statusClass)}</span>
      <code>${esc(review.methodology)}</code><small>${esc(review.model || '—')}</small>
    </div>
    ${observations ? `<ul class="architecture-observations">${observations}</ul>` : ''}
    <div class="architecture-candidates">${candidates || `<div class="architecture-review-empty">${metricLabel('arch.noCandidates')}</div>`}</div>
    ${missing ? `<details class="architecture-missing"><summary>${metricLabel('arch.missing')}</summary><ul>${missing}</ul></details>` : ''}
    ${evidence.size ? `<details class="architecture-evidence"><summary>${metricLabel('arch.evidence')} · ${evidence.size}</summary><ul>${[...evidence.values()].map(fact => `<li><strong>${esc(fact.citationId)}</strong><code>${esc(fact.location)}</code><p>${esc(fact.summary)}</p></li>`).join('')}</ul></details>` : ''}`;
}

/* ── Vulnerability panel ── */

let _vulnProjectId = '';
const vulnView = {
  version: 0, phase: 'idle', findings: [], expanded: new Set(), evidence: new Map(),
  scans: new Map(), updates: new Set(), reportVersion: 0,
};
const vulnStatuses = ['SUSPECTED', 'CONFIRMED', 'FIXED', 'DISMISSED'];
const vulnLabel = key => `<span data-i18n="${key}">${esc(t(key))}</span>`;

function onVulnProjectChange() {
  const projectId = document.getElementById('vuln-project-select')?.value || '';
  if (projectId !== _vulnProjectId) {
    vulnView.expanded.clear();
    closeVulnReport();
    const status = document.getElementById('vuln-scan-status');
    if (status) {
      const scanning = vulnView.scans.get(projectId)?.kind;
      status.textContent = scanning ? t(scanning === 'taint' ? 'vuln.scanningTaint' : scanning === 'deps' ? 'vuln.scanningDeps' : 'vuln.scanning') : '';
      delete status.dataset.tone;
    }
  }
  _vulnProjectId = projectId;
  updateVulnControls();
  return loadVulns();
}

function updateVulnControls() {
  const scanning = vulnView.scans.has(_vulnProjectId);
  ['vuln-scan-btn', 'vuln-taint-btn', 'vuln-deps-btn'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = !_vulnProjectId || scanning;
  });
  const refresh = document.getElementById('vuln-refresh-btn');
  if (refresh) refresh.disabled = !_vulnProjectId || vulnView.phase === 'loading';
  const report = document.getElementById('vuln-report-btn');
  if (report) report.disabled = !_vulnProjectId;
}

function triggerVulnScan() { return runVulnScan('code'); }
function triggerTaintScan() { return runVulnScan('taint'); }
function triggerDepsScan() { return runVulnScan('deps'); }

async function runVulnScan(kind) {
  const projectId = _vulnProjectId;
  if (!projectId || vulnView.scans.has(projectId)) return;
  const project = (state.projects || []).find(p => p.projectId === projectId);
  if (kind === 'deps' && !project?.projectRoot) {
    showToast(t('vuln.noProjectRoot'), 5000, 'error');
    return;
  }
  const status = document.getElementById('vuln-scan-status');
  const pending = { kind };
  vulnView.scans.set(projectId, pending);
  updateVulnControls();
  if (status) {
    delete status.dataset.tone;
    status.textContent = t(kind === 'taint' ? 'vuln.scanningTaint' : kind === 'deps' ? 'vuln.scanningDeps' : 'vuln.scanning');
  }
  try {
    const result = await (kind === 'taint' ? api.vulnScanTaint(projectId)
      : kind === 'deps' ? api.vulnScanDeps(projectId, project.projectRoot) : api.vulnScanCode(projectId));
    const fields = kind === 'taint' ? ['entryPoints', 'pathsAnalyzed', 'newFindings']
      : [kind === 'deps' ? 'scannedComponents' : 'scannedUnits', 'newFindings'];
    if (!result || fields.some(field => !Number.isFinite(result[field]) || result[field] < 0)) {
      throw new Error(t('vuln.invalidResponse'));
    }
    if (_vulnProjectId !== projectId) return;
    if (status) status.textContent = kind === 'taint'
      ? `${t('vuln.taintDone')} · ${result.entryPoints} ${t('vuln.entryPoints')} · ${result.pathsAnalyzed} ${t('vuln.paths')} · ${result.newFindings} ${t('vuln.newFindings')}`
      : t(kind === 'deps' ? 'vuln.depsScanDone' : 'vuln.scanDone', result[fields[0]], result.newFindings);
    await loadVulns();
  } catch (error) {
    if (_vulnProjectId === projectId && status) {
      status.dataset.tone = 'error';
      status.textContent = `${t('vuln.scanFailed')}: ${error.message}`;
    }
  } finally {
    if (vulnView.scans.get(projectId) === pending) vulnView.scans.delete(projectId);
    updateVulnControls();
  }
}

async function loadVulns() {
  const version = ++vulnView.version;
  const projectId = _vulnProjectId;
  const severity = document.getElementById('vuln-filter-severity')?.value || '';
  const status = document.getElementById('vuln-filter-status')?.value || '';
  const list = document.getElementById('vuln-list');
  if (!list) return;
  vulnView.evidence.clear();
  vulnView.findings = [];
  vulnView.phase = projectId ? 'loading' : 'idle';
  renderVulnSummary();
  updateVulnControls();
  list.setAttribute('aria-busy', String(!!projectId));
  if (!projectId) {
    list.innerHTML = `<div class="vuln-empty"><strong>${vulnLabel('vuln.noProject')}</strong><p>${vulnLabel('vuln.emptyHint')}</p></div>`;
    return;
  }
  list.innerHTML = `<div class="vuln-loading" role="status">${vulnLabel('vuln.loading')}<div class="vuln-skeleton"></div><div class="vuln-skeleton"></div></div>`;
  try {
    const findings = await api.vulnList(projectId, severity, status);
    if (!Array.isArray(findings)) throw new Error(t('vuln.invalidResponse'));
    if (version !== vulnView.version || projectId !== _vulnProjectId) return;
    vulnView.findings = findings;
    vulnView.phase = 'ready';
    renderVulnList(findings);
  } catch (error) {
    if (version !== vulnView.version || projectId !== _vulnProjectId) return;
    vulnView.phase = 'error';
    list.innerHTML = `<div class="vuln-empty vuln-error" role="alert"><strong>${vulnLabel('vuln.loadFailed')}</strong><p>${esc(error.message)}</p><button type="button" class="btn btn-ghost" onclick="loadVulns()">${vulnLabel('vuln.retry')}</button></div>`;
  } finally {
    if (version === vulnView.version) {
      list.setAttribute('aria-busy', 'false');
      renderVulnSummary();
      updateVulnControls();
    }
  }
}

function renderVulnSummary() {
  const count = document.getElementById('vuln-result-count');
  const breakdown = document.getElementById('vuln-result-breakdown');
  if (count) count.textContent = vulnView.phase === 'ready' ? String(vulnView.findings.length) : '—';
  if (breakdown) breakdown.innerHTML = vulnView.phase === 'ready' ? vulnStatuses.map(status => {
    const total = vulnView.findings.filter(f => f.status === status).length;
    return total ? `<span class="vuln-status-count" data-status="${status}">${vulnLabel('vuln.' + status.toLowerCase())} <b>${total}</b></span>` : '';
  }).join('') : '';
}

function resetVulnFilters() {
  document.getElementById('vuln-filter-severity').value = '';
  document.getElementById('vuln-filter-status').value = '';
  return loadVulns();
}

function renderVulnList(findings) {
  const list = document.getElementById('vuln-list');
  if (!list) return;
  if (!findings.length) {
    const filtered = document.getElementById('vuln-filter-severity').value || document.getElementById('vuln-filter-status').value;
    list.innerHTML = `<div class="vuln-empty"><strong>${vulnLabel('vulns.noFindings')}</strong><p>${vulnLabel('vuln.noMatchesHint')}</p>${filtered ? `<button type="button" id="vuln-reset-filters" class="btn btn-ghost" onclick="resetVulnFilters()">${vulnLabel('vuln.resetFilters')}</button>` : ''}</div>`;
    return;
  }
  list.innerHTML = findings.map(f => {
    const taint = String(f.ruleId || '').endsWith('_TAINT') || String(f.detail || '').startsWith('污点链：');
    const statusKey = 'vuln.' + String(f.status).toLowerCase();
    const location = `${f.filePath || '—'}${f.startLine ? ':' + f.startLine : ''}`;
    return `<details class="vuln-finding" data-finding-id="${esc(f.id)}" data-taint="${taint}" ontoggle="onVulnFindingToggle(this)"${vulnView.expanded.has(f.id) ? ' open' : ''}>
      <summary><span class="vuln-severity" data-severity="${esc(f.severity)}">${esc(f.severity)}</span>
        <span class="vuln-finding-title">${esc(f.title || f.ruleId)}</span>
        <span class="vuln-status" data-status="${esc(f.status)}">${vulnStatuses.includes(f.status) ? vulnLabel(statusKey) : esc(f.status)}</span>
        <span class="vuln-finding-location">${esc(location)}</span><span class="vuln-disclosure">${vulnLabel('vuln.details')} <span aria-hidden="true">⌄</span></span>
      </summary>
      <div class="vuln-finding-body">
        <dl class="vuln-facts"><div><dt>${vulnLabel('vuln.rule')}</dt><dd><span>${esc(f.ruleId || '—')}</span>${f.cwe ? ` <span class="vuln-cwe">${esc(f.cwe)}</span>` : ''}</dd></div>
          ${f.qualifiedName ? `<div><dt>${vulnLabel('vuln.symbol')}</dt><dd>${esc(f.qualifiedName)}</dd></div>` : ''}</dl>
        ${f.detail ? `<div class="vuln-description"><h3>${vulnLabel('vuln.description')}</h3><p>${esc(f.detail)}</p></div>` : ''}
        ${taint ? '<div class="vuln-evidence"></div>' : ''}
        <div class="vuln-finding-actions"><label>${vulnLabel('vuln.status')}<select data-finding-id="${esc(f.id)}" onchange="updateVulnStatus(this.dataset.findingId,this.value,this)"${vulnView.updates.has(f.id) ? ' disabled' : ''}>
          <option value="" data-i18n="vuln.changeStatus">${esc(t('vuln.changeStatus'))}</option>${vulnStatuses.map(status => `<option value="${status}" data-i18n="vuln.${status.toLowerCase()}">${esc(t('vuln.' + status.toLowerCase()))}</option>`).join('')}</select></label>
          ${f.qualifiedName ? `<button type="button" class="btn btn-ghost" data-qualified-name="${esc(f.qualifiedName)}" onclick="jumpToImpact(this.dataset.qualifiedName)" data-i18n-title="vuln.viewImpact" title="${esc(t('vuln.viewImpact'))}">${vulnLabel('vuln.impact')} ↗</button>` : ''}</div>
        <p class="vuln-review-hint">${vulnLabel('vuln.reviewHint')}</p>
      </div></details>`;
  }).join('');
}

function onVulnFindingToggle(details) {
  const id = details.dataset.findingId;
  if (details.open) {
    vulnView.expanded.add(id);
    if (details.dataset.taint === 'true') loadVulnEvidence(details);
  } else {
    vulnView.expanded.delete(id);
    if (vulnView.evidence.get(id)?.loading) vulnView.evidence.delete(id);
  }
}

async function loadVulnEvidence(details, retry = false) {
  const target = details.querySelector('.vuln-evidence');
  if (!target || !details.open) return;
  const id = details.dataset.findingId;
  const cached = vulnView.evidence.get(id);
  if (!retry && cached) {
    if (cached.steps) target.innerHTML = renderVulnEvidence(cached.steps);
    return;
  }
  const request = { loading: true };
  const version = vulnView.version;
  vulnView.evidence.set(id, request);
  target.innerHTML = `<p role="status">${vulnLabel('vuln.evidenceLoading')}</p>`;
  const current = () => version === vulnView.version && vulnView.evidence.get(id) === request && details.isConnected && details.open;
  try {
    const steps = await api.vulnTaintEvidence(id);
    if (!Array.isArray(steps)) throw new Error(t('vuln.invalidResponse'));
    if (!current()) return;
    request.steps = steps;
    target.innerHTML = renderVulnEvidence(steps);
  } catch (error) {
    if (!current()) return;
    target.innerHTML = `<div class="vuln-evidence-error" role="alert"><strong>${vulnLabel('vuln.evidenceError')}</strong><p>${esc(error.message)}</p><button type="button" class="btn btn-ghost" onclick="loadVulnEvidence(this.closest('.vuln-finding'),true)">${vulnLabel('vuln.retry')}</button></div>`;
  } finally {
    request.loading = false;
  }
}

function renderVulnEvidence(steps) {
  if (!steps.length) return `<p>${vulnLabel('vuln.noEvidence')}</p>`;
  const roles = { SOURCE: 'agent.taintSource', PROPAGATION: 'agent.taintPropagation', SINK: 'agent.taintSink' };
  return `<h3>${vulnLabel('vuln.evidence')}</h3><ol class="vuln-evidence-steps">${steps.map(step => `<li>
    <div class="vuln-step-role" data-role="${esc(step.role)}">${roles[step.role] ? vulnLabel(roles[step.role]) : esc(step.role)}</div>
    <div class="vuln-step-symbol">${esc(step.methodQn || '—')}</div>
    <div class="vuln-step-path">${esc(step.filePath || '—')}${step.startLine ? ':' + esc(step.startLine) : ''}${step.endLine > step.startLine ? '–' + esc(step.endLine) : ''}</div>
    <div class="vuln-slot-flow">${esc(step.fromSlot || '—')} <span aria-hidden="true">→</span> ${esc(step.toSlot || '—')}</div>
    ${step.sourceExcerpt ? `<details class="vuln-source"><summary>${vulnLabel('agent.taintSourceCode')}</summary><pre tabindex="0"><code>${esc(step.sourceExcerpt)}</code></pre></details>` : `<p>${vulnLabel('agent.taintUnlocated')}</p>`}
  </li>`).join('')}</ol>`;
}

async function updateVulnStatus(id, status, select) {
  if (!vulnStatuses.includes(status) || vulnView.updates.has(id)) return;
  const projectId = _vulnProjectId;
  vulnView.updates.add(id);
  if (select) select.disabled = true;
  try {
    await api.vulnUpdateStatus(id, status);
    if (projectId === _vulnProjectId) await loadVulns();
  } catch (error) {
    showToast(`${t('vuln.updateFailed')}: ${error.message}`, 5000, 'error');
  } finally {
    vulnView.updates.delete(id);
    document.querySelectorAll('#vuln-list select[data-finding-id]').forEach(input => {
      if (input.dataset.findingId === id) { input.disabled = false; input.value = ''; }
    });
  }
}

async function jumpToImpact(qualifiedName) {
  const projectId = _vulnProjectId;
  const projectInput = document.getElementById('graph-project');
  if (projectInput) projectInput.value = projectId;
  const input = document.getElementById('graph-target');
  if (input) input.value = qualifiedName;
  const impactBtn = document.querySelector('#graph-tab-row .tab[onclick*="\'impact\'"]');
  if (impactBtn) setGraphMode('impact', impactBtn);
  await switchPanel('graph');
  if (Alpine.store('repograph').panel !== 'graph' || input?.value !== qualifiedName
      || projectInput?.value !== projectId || state.graphMode !== 'impact') return;
  doGraphQuery();
}

async function showVulnReport() {
  const projectId = _vulnProjectId;
  const modal = document.getElementById('vuln-report-modal');
  const textarea = document.getElementById('vuln-report-text');
  if (!projectId || !modal || !textarea) return;
  const version = ++vulnView.reportVersion;
  const status = document.getElementById('vuln-report-state');
  const copy = document.getElementById('vuln-report-copy');
  const retry = document.getElementById('vuln-report-retry');
  textarea.value = '';
  status.textContent = t('vuln.reportLoading');
  delete status.dataset.tone;
  copy.disabled = true;
  retry.hidden = true;
  if (!modal.open) modal.showModal();
  const current = () => modal.open && version === vulnView.reportVersion && projectId === _vulnProjectId;
  try {
    const report = await api.vulnReport(projectId);
    if (!report || !Number.isFinite(report.totalFindings) || !Array.isArray(report.confirmedFindings)) throw new Error(t('vuln.invalidResponse'));
    if (!current()) return;
    textarea.value = formatVulnReport(report);
    status.textContent = '';
    copy.disabled = false;
  } catch (error) {
    if (!current()) return;
    status.dataset.tone = 'error';
    status.textContent = `${t('vuln.reportFailed')}: ${error.message}`;
    retry.hidden = false;
  }
}
function formatVulnReport(r) {
  const L = [];
  const mdTable = (headers, rows) => {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)));
    const pad = (s, w) => String(s ?? '').padEnd(w);
    const sep = widths.map(w => '-'.repeat(w));
    return [
      '| ' + headers.map((h, i) => pad(h, widths[i])).join(' | ') + ' |',
      '| ' + sep.map((s, i) => s + (i === 0 ? '' : '')).join(' | ') + ' |',
      ...rows.map(row => '| ' + row.map((c, i) => pad(c, widths[i])).join(' | ') + ' |'),
    ].join('\n');
  };

  L.push('# RepoGraph 漏洞扫描报告');
  L.push('');
  L.push(`| 字段 | 值 |`);
  L.push(`| ---- | -- |`);
  L.push(`| 项目 ID | \`${r.projectId}\` |`);
  L.push(`| 生成时间 | ${r.generatedAt} |`);
  L.push(`| 发现总数 | **${r.totalFindings}** 条 |`);
  L.push('');

  // Severity breakdown
  L.push('## 严重程度分布');
  L.push('');
  const sevEntries = Object.entries(r.bySeverity || {});
  if (sevEntries.length) {
    L.push(mdTable(['严重程度', '数量'], sevEntries.map(([k, v]) => [k, `${v} 条`])));
  } else {
    L.push('_无数据_');
  }
  L.push('');

  // Status breakdown
  L.push('## 状态分布');
  L.push('');
  const stEntries = Object.entries(r.byStatus || {});
  if (stEntries.length) {
    L.push(mdTable(['状态', '数量'], stEntries.map(([k, v]) => [k, `${v} 条`])));
  } else {
    L.push('_无数据_');
  }
  L.push('');

  // CWE breakdown
  const cweEntries = Object.entries(r.byCwe || {});
  if (cweEntries.length) {
    L.push('## CWE 分布');
    L.push('');
    L.push(mdTable(['CWE', '数量'], cweEntries.map(([k, v]) => [k, `${v} 条`])));
    L.push('');
  }

  // Confirmed findings detail table
  L.push('## 已确认漏洞');
  L.push('');
  const confirmed = r.confirmedFindings || [];
  if (confirmed.length) {
    L.push(mdTable(
      ['#', '严重程度', 'CWE', '规则', '符号', '位置', '详情'],
      confirmed.map((f, i) => [
        String(i + 1),
        f.severity,
        f.cwe || '',
        f.ruleId,
        f.qualifiedName,
        `${f.filePath}:${f.startLine}`,
        f.detail || '',
      ])
    ));
  } else {
    L.push('_无已确认漏洞。扫描后将高风险发现标记为 CONFIRMED 以纳入报告。_');
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('> 由 **RepoGraph** 生成 · 完全本地 · 数据零上云');
  return L.join('\n');
}

function closeVulnReport() {
  ++vulnView.reportVersion;
  const modal = document.getElementById('vuln-report-modal');
  if (modal?.open) modal.close();
}

function onVulnReportClosed() { ++vulnView.reportVersion; }

function copyVulnReport() {
  const textarea = document.getElementById('vuln-report-text');
  if (!textarea || document.getElementById('vuln-report-copy')?.disabled) return;
  const version = vulnView.reportVersion;
  const current = () => document.getElementById('vuln-report-modal').open && version === vulnView.reportVersion;
  copyToClipboard(textarea.value)
    .then(() => {
      if (!current()) return;
      const status = document.getElementById('vuln-report-state');
      status.textContent = t('toast.copied');
      delete status.dataset.tone;
    })
    .catch(() => {
      if (!current()) return;
      const status = document.getElementById('vuln-report-state');
      status.textContent = t('toast.copyFailed');
      status.dataset.tone = 'error';
    });
}

/** Called by handlePanelSwitch when the vulns panel becomes active. */
function populateVulnProjectSelect(projects) {
  const select = document.getElementById('vuln-project-select');
  if (!select || !Array.isArray(projects)) return;
  const active = _vulnProjectId || select.value || state.activeProjectId;
  select.innerHTML = `<option value="" data-i18n="ph.selectProject">${esc(t('ph.selectProject'))}</option>`
    + projects.map(project => `<option value="${esc(project.projectId)}">${esc(projectName(project))}</option>`).join('');
  select.value = projects.some(project => project.projectId === active) ? active : '';
  onVulnProjectChange();
}

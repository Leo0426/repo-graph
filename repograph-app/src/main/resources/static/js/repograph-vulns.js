/* ── Vulnerability panel ── */

let _vulnProjectId = '';

function onVulnProjectChange() {
  const sel = document.getElementById('vuln-project-select');
  _vulnProjectId = sel ? sel.value : '';
  const btn = document.getElementById('vuln-scan-btn');
  if (btn) btn.disabled = !_vulnProjectId;
  const taintBtn = document.getElementById('vuln-taint-btn');
  if (taintBtn) taintBtn.disabled = !_vulnProjectId;
  const depsBtn = document.getElementById('vuln-deps-btn');
  if (depsBtn) depsBtn.disabled = !_vulnProjectId;
  if (_vulnProjectId) loadVulns();
  else renderVulnList([]);
}

async function triggerVulnScan() {
  if (!_vulnProjectId) return;
  const btn   = document.getElementById('vuln-scan-btn');
  const stEl  = document.getElementById('vuln-scan-status');
  btn.disabled = true;
  if (stEl) stEl.textContent = t('vuln.scanning');
  try {
    const r = await api.vulnScanCode(_vulnProjectId);
    if (stEl) stEl.textContent =
      t('vuln.scanDone', r.scannedUnits ?? 0, r.newFindings ?? 0);
    const reportBtn = document.getElementById('vuln-report-btn');
    if (reportBtn) reportBtn.disabled = false;
    await loadVulns();
  } catch (e) {
    if (stEl) stEl.textContent = 'Scan failed: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function triggerTaintScan() {
  if (!_vulnProjectId) return;
  const btn  = document.getElementById('vuln-taint-btn');
  const stEl = document.getElementById('vuln-scan-status');
  btn.disabled = true;
  if (stEl) stEl.textContent = t('vuln.scanningTaint') || '正在追踪污点路径…';
  try {
    const r = await api.vulnScanTaint(_vulnProjectId);
    if (stEl) stEl.textContent =
      `污点扫描完成：${r.entryPoints ?? 0} 入口点，${r.pathsAnalyzed ?? 0} 条路径，发现 ${r.newFindings ?? 0} 条`;
    const reportBtn = document.getElementById('vuln-report-btn');
    if (reportBtn) reportBtn.disabled = false;
    await loadVulns();
  } catch (e) {
    if (stEl) stEl.textContent = 'Taint scan failed: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function triggerDepsScan() {
  if (!_vulnProjectId) return;
  const proj = (state.projects || []).find(p => p.projectId === _vulnProjectId);
  if (!proj?.projectRoot) {
    showToast(t('vuln.noProjectRoot') || '无法获取项目路径，请先完成索引');
    return;
  }
  const btn  = document.getElementById('vuln-deps-btn');
  const stEl = document.getElementById('vuln-scan-status');
  btn.disabled = true;
  if (stEl) stEl.textContent = t('vuln.scanningDeps') || '正在扫描依赖…';
  try {
    const r = await api.vulnScanDeps(_vulnProjectId, proj.projectRoot);
    if (stEl) stEl.textContent =
      t('vuln.depsScanDone', r.scannedComponents ?? 0, r.newFindings ?? 0);
    const reportBtn = document.getElementById('vuln-report-btn');
    if (reportBtn) reportBtn.disabled = false;
    await loadVulns();
  } catch (e) {
    if (stEl) stEl.textContent = 'Scan failed: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function loadVulns() {
  if (!_vulnProjectId) return;
  const severity = document.getElementById('vuln-filter-severity')?.value || '';
  const status   = document.getElementById('vuln-filter-status')?.value   || '';
  try {
    const findings = await api.vulnList(_vulnProjectId, severity, status);
    renderVulnList(findings);
    const reportBtn = document.getElementById('vuln-report-btn');
    if (reportBtn) reportBtn.disabled = findings.length === 0;
  } catch (e) {
    const el = document.getElementById('vuln-list');
    if (el) el.innerHTML =
      `<div class="empty-state" style="color:var(--red)">${esc(e.message)}</div>`;
  }
}

function renderVulnList(findings) {
  const el = document.getElementById('vuln-list');
  if (!el) return;
  if (!findings || !findings.length) {
    el.innerHTML = `<div class="empty-state">${t('vulns.noFindings')}</div>`;
    return;
  }
  el.innerHTML = findings.map(f => {
    const sevColor = f.severity === 'CRITICAL' ? 'var(--red)'
                   : f.severity === 'HIGH'     ? '#f87171'
                   : f.severity === 'MEDIUM'   ? 'var(--amber)' : 'var(--text-3)';
    const stColor  = f.status === 'CONFIRMED' ? 'var(--red)'
                   : f.status === 'FIXED'     ? 'var(--mint)'
                   : f.status === 'DISMISSED' ? 'var(--text-3)' : 'var(--amber)';
    return `
    <div class="card" style="margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:11px;font-weight:700;color:${sevColor};
                     border:1px solid ${sevColor};border-radius:4px;
                     padding:1px 6px;flex-shrink:0">${esc(f.severity)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px">${esc(f.title)}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">
            ${esc(f.cwe)} · <span style="font-family:var(--fm);font-size:11px">${esc(f.qualifiedName)}</span>
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">
            ${esc(f.filePath)}:${f.startLine}
          </div>
          ${f.detail ? `<div style="font-size:12px;color:var(--text-2);margin-top:4px">${esc(f.detail)}</div>` : ''}
        </div>
        <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span style="font-size:11px;color:${stColor};font-weight:600">${t('vuln.' + f.status.toLowerCase())}</span>
          <select style="font-size:11px;padding:2px 4px" onchange="updateVulnStatus('${esc(f.id)}', this.value)">
            <option value="" disabled selected>${t('vuln.changeStatus')}</option>
            <option value="SUSPECTED">${t('vuln.suspected')}</option>
            <option value="CONFIRMED">${t('vuln.confirmed')}</option>
            <option value="FIXED">${t('vuln.fixed')}</option>
            <option value="DISMISSED">${t('vuln.dismissed')}</option>
          </select>
          ${f.ruleId !== 'DEP_VULNERABILITY' ? `
          <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px"
                  onclick="jumpToImpact('${esc(f.qualifiedName)}')"
                  title="${t('vuln.viewImpact')}">
            ${t('vuln.impact')}
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

async function updateVulnStatus(id, status) {
  if (!status) return;
  try {
    await api.vulnUpdateStatus(id, status);
    await loadVulns();
  } catch (e) {
    showToast('Update failed: ' + e.message);
  }
}

function jumpToImpact(qualifiedName) {
  const input = document.getElementById('graph-target');
  if (input) input.value = qualifiedName;

  // 切换到影响面模式
  const impactBtn = document.querySelector('#graph-tab-row .tab[onclick*="\'impact\'"]');
  if (impactBtn) setGraphMode('impact', impactBtn);

  switchPanel('graph');
  // 面板切换完成后触发查询
  setTimeout(() => doGraphQuery(), 100);
}

async function showVulnReport() {
  if (!_vulnProjectId) return;
  const modal    = document.getElementById('vuln-report-modal');
  const textarea = document.getElementById('vuln-report-text');
  if (!modal || !textarea) return;
  textarea.value = t('vuln.reportLoading') || '生成中…';
  modal.style.display = 'flex';
  try {
    const r = await api.vulnReport(_vulnProjectId);
    textarea.value = formatVulnReport(r);
  } catch (e) {
    textarea.value = 'Error: ' + e.message;
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
  const modal = document.getElementById('vuln-report-modal');
  if (modal) modal.style.display = 'none';
}

function copyVulnReport() {
  const textarea = document.getElementById('vuln-report-text');
  if (!textarea) return;
  navigator.clipboard.writeText(textarea.value).then(() => showToast(t('toast.copied') || 'Copied'));
}

/** Called by handlePanelSwitch when the vulns panel becomes active. */
function populateVulnProjectSelect(projects) {
  const sel = document.getElementById('vuln-project-select');
  if (!sel || !Array.isArray(projects)) return;
  const prev = _vulnProjectId || sel.value;
  sel.innerHTML = `<option value="">— ${t('ph.selectProject') || '选择项目'} —</option>`
    + projects.map(p =>
        `<option value="${esc(p.projectId)}"${p.projectId === prev ? ' selected' : ''}>${esc(projectName(p))}</option>`
      ).join('');
  if (prev && projects.some(p => p.projectId === prev)) {
    sel.value = prev;
    _vulnProjectId = prev;
    const btn = document.getElementById('vuln-scan-btn');
    if (btn) btn.disabled = false;
    const taintBtn = document.getElementById('vuln-taint-btn');
    if (taintBtn) taintBtn.disabled = false;
    const depsBtn = document.getElementById('vuln-deps-btn');
    if (depsBtn) depsBtn.disabled = false;
    loadVulns();
  }
}

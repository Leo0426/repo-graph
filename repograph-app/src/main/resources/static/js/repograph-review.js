/* Frozen report facts and server-owned review states are deliberately rendered separately. */
const agentReviewDialog = document.getElementById('agent-review-dialog');
const reviewView = { version: 0, snapshotId: '', projectId: '', data: null, previousFocus: null,
  drafts: new Map(), mutations: new Set(), readError: false, loading: false, lang: '' };

async function openAgentReview() {
  const run = agentUi.currentRun;
  const reference = run?.outputReference || '';
  if (!reference.startsWith('report-snapshot:') || run.projectId !== state.activeProjectId
    || !state.projects.some(project => project.projectId === run.projectId)) return;
  if (document.querySelector('dialog[open]') && !agentReviewDialog.open) return;
  reviewView.previousFocus = document.activeElement;
  reviewView.snapshotId = reference.slice('report-snapshot:'.length);
  reviewView.projectId = run.projectId;
  reviewView.data = null;
  reviewView.readError = false;
  reviewView.lang = currentLang;
  agentReviewDialog.showModal();
  document.getElementById('agent-review-close').focus();
  await loadAgentReview();
}

function closeAgentReview(restoreFocus = true) {
  reviewView.version++;
  reviewView.loading = false;
  if (!agentReviewDialog.open) return;
  agentReviewDialog.close();
  if (restoreFocus) {
    const previous = reviewView.previousFocus;
    if (previous?.isConnected && previous.getClientRects().length && !previous.disabled) previous.focus({ preventScroll: true });
    else document.getElementById('main-content').focus({ preventScroll: true });
  }
}

async function loadAgentReview() {
  const version = ++reviewView.version;
  const snapshotId = reviewView.snapshotId, projectId = reviewView.projectId;
  const current = () => version === reviewView.version && agentReviewDialog.open && projectId === state.activeProjectId;
  reviewView.loading = true;
  updateReviewControls();
  const status = document.getElementById('agent-review-status');
  status.textContent = t('review.loading');
  if (!reviewView.data) document.getElementById('agent-review-content').innerHTML = emptyState('review.loading', '', 'file-text');
  try {
    const data = await fetch(`/api/v1/review-queue/snapshots/${encodeURIComponent(snapshotId)}/review`).then(apiJsonResponse);
    if (!current()) return;
    if (data.snapshot?.id !== snapshotId || data.snapshot.projectId !== projectId
      || !Array.isArray(data.snapshot.reports) || !Array.isArray(data.items)
      || data.items.some(item => item.entry?.snapshotId !== snapshotId || item.entry.projectId !== projectId)) {
      throw new Error(t('review.invalid'));
    }
    reviewView.data = data;
    reviewView.readError = false;
    renderAgentReview();
    status.textContent = t('review.readOnly');
  } catch (error) {
    if (!current()) return;
    reviewView.readError = true;
    status.textContent = `${t('review.readFailed')} ${error.message}`;
    if (!reviewView.data || error.status === 403 || error.status === 401) {
      reviewView.data = null;
      document.getElementById('agent-review-content').innerHTML = emptyState('review.readFailed', 'review.retryHint', 'file-text');
    }
    updateReviewControls();
  } finally {
    if (current()) { reviewView.loading = false; updateReviewControls(); }
  }
}

function renderAgentReview() {
  if (!reviewView.data || !agentReviewDialog.open) return;
  const content = document.getElementById('agent-review-content');
  const scroll = content.scrollTop;
  const opened = new Set([...content.querySelectorAll('details[open]')].map(element => element.dataset.evidence));
  const active = document.activeElement;
  const focusedEntry = active?.closest('[data-review-entry]')?.dataset.reviewEntry;
  const focusedAction = active?.dataset.reviewAction;
  const focusedReason = active?.hasAttribute('data-review-reason');
  const { snapshot, items } = reviewView.data;
  content.innerHTML = `<div class="review-snapshot-meta"><strong>${esc(t('review.frozenBaseline'))}</strong>
      <code>${esc(snapshot.id)}</code><span>${esc(t('review.versions', snapshot.codeVersion || '—', snapshot.ruleVersion || '—'))}</span>
      <time>${esc(snapshot.generatedAt || '—')}</time><span>${esc(t('review.toolVersion', snapshot.toolVersion || '—'))}</span><p>${esc(t('review.advisorySeparate'))}</p></div>
    ${items.length ? items.map(renderReviewEntry).join('') : `<p>${esc(t('review.noEntries'))}</p>`}
    <div class="review-exports">${['markdown','json','pdf'].map(format => `<a class="btn btn-ghost" target="_blank" rel="noopener"
      href="/api/v1/review-queue/snapshots/${encodeURIComponent(snapshot.id)}/export?format=${format}">${format === 'markdown' ? 'Markdown' : format.toUpperCase()} ↗</a>`).join('')}</div>`;
  content.querySelectorAll('[data-review-reason]').forEach(input => {
    input.value = reviewView.drafts.get(input.closest('[data-review-entry]').dataset.reviewEntry) || '';
  });
  content.querySelectorAll('details[data-evidence]').forEach(detail => { detail.open = opened.has(detail.dataset.evidence); });
  updateReviewControls();
  if (focusedEntry) {
    const card = [...content.querySelectorAll('[data-review-entry]')].find(card => card.dataset.reviewEntry === focusedEntry);
    const next = focusedReason ? card?.querySelector('[data-review-reason]')
      : card?.querySelector(`[data-review-action="${focusedAction}"]`);
    (next && !next.disabled ? next : card?.querySelector('.review-entry-status'))?.focus({ preventScroll: true });
  }
  content.scrollTop = scroll;
  reviewView.lang = currentLang;
}

function renderReviewEntry(item) {
  const { entry, report, reportMatchCount } = item;
  const matching = reportMatchCount === 1 && !!report;
  const finding = report?.finding;
  const own = entry.claimedBy === sessionAccount?.username;
  const statusKey = `review.status.${entry.status}`;
  const statusLabel = t(statusKey) === statusKey ? entry.status : t(statusKey);
  return `<article class="review-entry" data-review-entry="${esc(entry.id)}" data-status="${esc(entry.status)}" data-matching="${matching}" data-own="${own}">
    <header><h3>${esc(finding?.message || entry.ruleId)}</h3><strong class="review-entry-status" tabindex="-1">${esc(statusLabel)}</strong></header>
    <p>${esc(entry.ruleId)} · ${esc(entry.cwe || '')} · ${esc(entry.severity)}</p>
    ${entry.claimedBy ? `<p>${esc(t('review.claimedBy', entry.claimedBy))}</p>` : ''}
    ${matching ? `<div class="review-location"><code>${esc(finding.filePath)} · L${finding.startLine}–${finding.endLine}</code>
      <button class="btn btn-ghost" type="button" data-review-copy="${esc(finding.filePath + ':' + finding.startLine)}">${esc(t('review.copyLocation'))}</button></div>
      <p class="review-baseline"><b>${esc(t('review.baseline'))}</b> ${esc(t(`review.verdict.${report.verdict}`) === `review.verdict.${report.verdict}` ? report.verdict : t(`review.verdict.${report.verdict}`))} · ${esc(report.developerSummary || '')}</p>
      ${reviewList('review.reasons', report.reasons)}${reviewList('review.missing', report.missingInfo)}
      ${report.remediation ? `<h4>${esc(t('review.remediation'))}</h4><p>${esc(report.remediation)}</p>` : ''}
      ${reviewList('review.omitted', report.pack?.omittedReasons)}
      ${(report.pack?.evidence || []).map(evidence => `<details class="review-evidence" data-evidence="${esc(entry.id + ':' + evidence.citationId)}">
        <summary>${esc(evidence.citationId)} · ${esc(evidence.filePath)} · L${evidence.startLine}–${evidence.endLine}</summary>
        ${evidence.excerpt ? `<pre>${esc(evidence.excerpt)}</pre>` : `<p>${esc(t('review.noSource'))}</p>`}
        ${evidence.truncated ? `<p>${esc(t('review.truncated'))}</p>` : ''}</details>`).join('')}`
      : `<p class="review-match-warning">${esc(t('review.ambiguous', reportMatchCount))}</p>`}
    <div class="review-entry-actions">
      ${matching && entry.status === 'PENDING' ? `<button type="button" class="btn btn-primary" data-review-action="claim">${esc(t('review.claim'))}</button>` : ''}
      ${matching && entry.status === 'IN_REVIEW' && own ? `<label>${esc(t('review.reason'))}<textarea data-review-reason rows="3"></textarea></label>
        <div>${['confirm','reject','return'].map(action => `<button type="button" class="btn ${action === 'confirm' ? 'btn-primary' : 'btn-ghost'}" data-review-action="${action}">${esc(t(`review.${action}`))}</button>`).join('')}</div>` : ''}
    </div></article>`;
}

function reviewList(title, values) {
  return values?.length ? `<h4>${esc(t(title))}</h4><ul>${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : '';
}

function updateReviewControls() {
  document.getElementById('agent-review-refresh').disabled = reviewView.loading || reviewView.mutations.size > 0;
  document.querySelectorAll('#agent-review-content [data-review-entry]').forEach(card => {
    card.querySelectorAll('[data-review-action]').forEach(button => {
      const reason = reviewView.drafts.get(card.dataset.reviewEntry) || '';
      button.disabled = reviewView.readError || reviewView.loading || reviewView.mutations.size > 0
        || (button.dataset.reviewAction !== 'claim' && !reason.trim());
    });
    const reason = card.querySelector('[data-review-reason]');
    if (reason) reason.disabled = reviewView.loading || reviewView.readError || reviewView.mutations.size > 0;
  });
}

async function actOnReview(entryId, action) {
  if (!['claim','confirm','reject','return'].includes(action) || reviewView.loading || reviewView.readError || reviewView.mutations.size) return;
  const item = reviewView.data?.items.find(item => item.entry.id === entryId);
  if (!item || item.reportMatchCount !== 1 || !item.report || reviewView.projectId !== state.activeProjectId) return;
  if (action === 'claim' ? item.entry.status !== 'PENDING'
    : item.entry.status !== 'IN_REVIEW' || item.entry.claimedBy !== sessionAccount?.username) return;
  const reason = (reviewView.drafts.get(entryId) || '').trim();
  if (action !== 'claim' && !reason) return;
  const version = reviewView.version, snapshotId = reviewView.snapshotId, projectId = reviewView.projectId;
  reviewView.mutations.add(entryId);
  updateReviewControls();
  const status = document.getElementById('agent-review-status');
  status.textContent = t('review.saving');
  try {
    const response = await fetch(`/api/v1/review-queue/${encodeURIComponent(entryId)}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'claim' ? {} : { reason })
    }).then(apiJsonResponse);
    if (response.id !== entryId || !response.status) throw new Error(t('review.invalid'));
    if (action !== 'claim') reviewView.drafts.delete(entryId);
    if (snapshotId === reviewView.snapshotId && agentReviewDialog.open && projectId === state.activeProjectId) {
      await loadAgentReview();
    }
  } catch (error) {
    if (version === reviewView.version && agentReviewDialog.open) status.textContent = `${t('review.actionUnconfirmed')} ${error.message}`;
  } finally {
    reviewView.mutations.delete(entryId);
    if (agentReviewDialog.open) updateReviewControls();
  }
}

function refreshAgentReviewLanguage() {
  if (agentReviewDialog.open && reviewView.lang !== currentLang) renderAgentReview();
}

agentReviewDialog.addEventListener('cancel', event => { event.preventDefault(); closeAgentReview(); });
agentReviewDialog.addEventListener('click', event => {
  const action = event.target.closest('[data-review-action]');
  if (action) actOnReview(action.closest('[data-review-entry]').dataset.reviewEntry, action.dataset.reviewAction);
  const copy = event.target.closest('[data-review-copy]');
  if (copy) copyToClipboard(copy.dataset.reviewCopy)
    .then(() => { document.getElementById('agent-review-status').textContent = t('toast.copied'); })
    .catch(() => { document.getElementById('agent-review-status').textContent = t('toast.copyFailed'); });
});
agentReviewDialog.addEventListener('input', event => {
  if (!event.target.matches('[data-review-reason]')) return;
  reviewView.drafts.set(event.target.closest('[data-review-entry]').dataset.reviewEntry, event.target.value);
  updateReviewControls();
});
agentReviewDialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = [...agentReviewDialog.querySelectorAll('button, a[href], textarea')].filter(element => !element.disabled && element.getClientRects().length);
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
});

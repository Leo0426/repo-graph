/* Project-scoped Wiki reader. Generation uses the existing WIKI_SUMMARY run ledger. */
const wikiView = { projectId: '', epoch: 0, request: 0, documents: [], selected: '', loading: false,
  error: '', run: null, submitting: false, runError: '', timer: null, polling: false };
const wikiLabel = key => esc(t('wiki.' + key));
const wikiBusy = () => wikiView.submitting || (wikiView.run && ['QUEUED', 'RUNNING'].includes(wikiView.run.status));
function resetWikiProject() {
  if (wikiView.projectId === state.activeProjectId) return;
  clearTimeout(wikiView.timer);
  Object.assign(wikiView, { projectId: state.activeProjectId, epoch: wikiView.epoch + 1,
    request: wikiView.request + 1, documents: [], selected: '', loading: false,
    error: '', run: null, submitting: false, runError: '', polling: false });
  document.getElementById('wiki-filter').value = '';
  try {
    const id = sessionStorage.getItem('repograph_wiki_run:' + wikiView.projectId);
    if (id) wikiView.run = { id, status: 'RUNNING', steps: [] };
  } catch (_) {}
  renderWiki();
  if (Alpine.store('repograph').panel === 'wiki') loadWiki();
}
async function loadWiki() {
  if (wikiView.projectId !== state.activeProjectId) { resetWikiProject(); return; }
  if (!wikiView.projectId || wikiView.loading) { renderWiki(); return; }
  const epoch = wikiView.epoch, request = ++wikiView.request;
  wikiView.loading = true; wikiView.error = ''; renderWikiStatus();
  try {
    const docs = await fetch('/api/v1/summaries?' + new URLSearchParams({ projectId: wikiView.projectId })).then(apiJsonResponse);
    if (epoch !== wikiView.epoch || request !== wikiView.request) return;
    if (!Array.isArray(docs) || docs.some(d => d.projectId !== wikiView.projectId || !d.id || !Array.isArray(d.sections)))
      throw new Error(t('wiki.invalid'));
    wikiView.documents = docs;
    if (!docs.some(d => d.id === wikiView.selected)) wikiView.selected = docs[0]?.id || '';
  } catch (e) {
    if (epoch === wikiView.epoch && request === wikiView.request) wikiView.error = e.message;
  } finally {
    if (epoch === wikiView.epoch && request === wikiView.request) {
      wikiView.loading = false; renderWiki();
      if (wikiBusy() && !wikiView.polling) pollWikiRun();
    }
  }
}
function renderWikiStatus() {
  const project = state.projects.find(p => p.projectId === wikiView.projectId);
  document.getElementById('wiki-project').textContent = project ? projectName(project) : wikiView.projectId;
  document.getElementById('wiki-generate').disabled = !wikiView.projectId || !!wikiBusy();
  document.getElementById('wiki-refresh').disabled = wikiView.loading;
  document.getElementById('wiki-layout').setAttribute('aria-busy', String(wikiView.loading));
  document.getElementById('wiki-status').innerHTML = !wikiView.projectId ? wikiLabel('choose')
    : wikiView.error ? `<div class="wiki-notice">${wikiLabel('loadFailed')} ${esc(wikiView.error)} <button class="btn btn-ghost" onclick="loadWiki()">${wikiLabel('retry')}</button></div>`
    : wikiView.loading ? wikiLabel('loading') : !wikiView.documents.length ? wikiLabel('empty') : '';
}
function renderWiki() {
  if (!document.getElementById('wiki-document')) return;
  renderWikiStatus(); renderWikiTree(); renderWikiDocument(); renderWikiRun();
}
function renderWikiTree() {
  const query = document.getElementById('wiki-filter').value.trim().toLowerCase();
  const docs = wikiView.documents.filter(d => `${d.title} ${d.scopeId}`.toLowerCase().includes(query));
  document.getElementById('wiki-tree').innerHTML = docs.map(d => `<button type="button" data-document="${esc(d.id)}" ${d.id === wikiView.selected ? 'aria-current="page"' : ''}>${esc(d.level === 'PROJECT' ? d.title : d.scopeId)}<small>${wikiLabel(d.level === 'PROJECT' ? 'project' : 'package')} · v${esc(d.docVersion)}</small></button>`).join('') || (query ? wikiLabel('noMatch') : '');
  document.querySelectorAll('#wiki-tree [data-document]').forEach(button => button.addEventListener('click', () => {
    wikiView.selected = button.dataset.document;
    renderWikiTree(); renderWikiDocument(); document.getElementById('wiki-document').focus();
  }));
}
/* Escape before formatting: HTML, images and links from model/source text stay inert.
   The supported Markdown subset includes headings, lists, inline code and fenced code. */
function wikiMarkdown(text) {
  return String(text || '').split(/```[^\n]*\n([\s\S]*?)(?:```|$)/g).map((part, index) => {
    if (index % 2) return `<pre tabindex="0"><code>${esc(part)}</code></pre>`;
    return esc(part).split(/\n\s*\n/).filter(Boolean).map(block => {
      const inline = value => value.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      const rows = block.trim().split('\n');
      if (rows.length > 1 && /^\|?\s*:?-{3,}/.test(rows[1])) {
        const cells = row => row.trim().replace(/^\||\|$/g, '').split('|');
        return `<div class="wiki-table" tabindex="0"><table><thead><tr>${cells(rows[0]).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map(row => `<tr>${cells(row).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
      if (/^#{1,6} /.test(block)) return block.split('\n').map(line => /^#{1,6} /.test(line) ? `<h4>${inline(line.replace(/^#{1,6} /, ''))}</h4>` : `<p>${inline(line)}</p>`).join('');
      if (block.split('\n').every(line => /^\s*[-*] /.test(line))) return `<ul>${block.split('\n').map(line => `<li>${inline(line.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
      return `<p>${inline(block)}</p>`;
    }).join('');
  }).join('');
}
function renderWikiDocument() {
  const doc = wikiView.documents.find(d => d.id === wikiView.selected);
  const body = document.getElementById('wiki-document'), toc = document.getElementById('wiki-toc');
  if (!doc) {
    body.innerHTML = wikiView.loading ? emptyState('wiki.loading', '', 'file-text')
      : wikiView.error ? emptyState('wiki.invalid', '', 'file-text')
      : emptyState(wikiView.projectId ? 'empty.wikiTitle' : 'empty.chooseProject',
        wikiView.projectId ? 'empty.wikiHint' : 'empty.chooseHint', 'file-text');
    toc.replaceChildren();
    return;
  }
  body.innerHTML = `<h2>${esc(doc.title)}</h2><div class="wiki-meta"><span>v${esc(doc.docVersion)}</span><time>${esc(doc.generatedAt)}</time><span>${esc(t('wiki.' + doc.status))}</span></div>
    <button class="btn btn-ghost" onclick="downloadWiki()">${wikiLabel('download')}</button>
    ${!doc.model ? `<p class="wiki-notice">${wikiLabel('factsOnly')}</p>` : `<p>${wikiLabel('model')} ${esc(doc.model)}</p>`}
    ${doc.missingInfo?.length ? `<details class="wiki-notice"><summary>${wikiLabel('missing')} (${doc.missingInfo.length})</summary><ul>${doc.missingInfo.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>` : ''}
    ${doc.sections.map((section, i) => `<section class="wiki-section" id="wiki-section-${i}" tabindex="-1"><h3>${esc(section.title)}</h3><small>${wikiLabel(section.source === 'llm' ? 'llm' : 'facts')}</small><div class="wiki-body">${wikiMarkdown(section.body)}</div></section>`).join('')}
    <section class="wiki-citations"><h3>${wikiLabel('citations')}</h3>${(doc.citations || []).map((c, i) => `<button class="btn btn-ghost" data-citation="${i}">${esc(c.qualifiedName)}<br>${esc(c.filePath)}:${esc(c.startLine)}–${esc(c.endLine)}</button>`).join('') || wikiLabel('noCitations')}</section>`;
  toc.innerHTML = `<strong>${wikiLabel('contents')}</strong>` + doc.sections.map((s, i) => `<button data-section="${i}">${esc(s.title)}</button>`).join('');
  toc.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    const section = document.getElementById('wiki-section-' + button.dataset.section);
    section.focus({ preventScroll: true });
    section.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }));
  requestAnimationFrame(updateWikiReadingPosition);
  body.querySelectorAll('[data-citation]').forEach(button => button.addEventListener('click', async () => {
    const c = doc.citations[Number(button.dataset.citation)];
    await switchPanel('symbol');
    if (doc.projectId !== state.activeProjectId) return;
    if (c.filePath && c.startLine > 0) {
      setSymbolMode('locate'); document.getElementById('locate-file-input').value = c.filePath;
      document.getElementById('locate-line-input').value = c.startLine; doLocate();
    } else {
      setSymbolMode('lookup'); document.getElementById('symbol-qn-input').value = c.qualifiedName; doSymbolLookup();
    }
  }));
}
function downloadWiki() {
  const doc = wikiView.documents.find(d => d.id === wikiView.selected); if (!doc) return;
  const text = `# ${doc.title}\n\nProject: ${doc.projectId} · v${doc.docVersion} · ${doc.generatedAt}\nStatus: ${doc.status}\n\n`
    + doc.sections.map(s => `## ${s.title}\n\n[${s.source || 'facts'}]\n\n${s.body}`).join('\n\n')
    + '\n\n## ' + t('wiki.citations') + '\n\n' + (doc.citations || []).map(c => `- ${c.qualifiedName} — ${c.filePath}:${c.startLine}-${c.endLine}`).join('\n')
    + '\n\n' + (doc.missingInfo || []).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `wiki-${doc.projectId}-v${doc.docVersion}.md`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function generateWiki() {
  if (!wikiView.projectId || wikiBusy()) return;
  const epoch = wikiView.epoch, projectId = wikiView.projectId;
  wikiView.submitting = true; wikiView.runError = ''; renderWikiStatus(); renderWikiRun();
  try {
    const result = await fetch('/api/v1/summaries/generate?' + new URLSearchParams({ projectId }), { method: 'POST' }).then(apiJsonResponse);
    if (!result.agentRunId) throw new Error(t('wiki.invalid'));
    try { sessionStorage.setItem('repograph_wiki_run:' + projectId, result.agentRunId); } catch (_) {}
    if (epoch !== wikiView.epoch) return;
    wikiView.run = { id: result.agentRunId, status: 'QUEUED', steps: [] };
    pollWikiRun();
  } catch (e) { if (epoch === wikiView.epoch) wikiView.runError = e.message; }
  finally { if (epoch === wikiView.epoch) { wikiView.submitting = false; renderWikiStatus(); renderWikiRun(); } }
}
async function pollWikiRun() {
  if (!wikiView.run || wikiView.polling) return;
  clearTimeout(wikiView.timer);
  const epoch = wikiView.epoch, id = wikiView.run.id;
  wikiView.polling = true; wikiView.runError = '';
  try {
    const run = await fetch('/api/v1/agent-runs/' + encodeURIComponent(id)).then(apiJsonResponse);
    if (epoch !== wikiView.epoch) return;
    if (run.id !== id || run.projectId !== wikiView.projectId || run.playbook !== 'WIKI_SUMMARY' || !Array.isArray(run.steps)) throw new Error(t('wiki.invalid'));
    wikiView.run = run;
    if (['QUEUED', 'RUNNING'].includes(run.status)) wikiView.timer = setTimeout(pollWikiRun, 1800);
    else {
      try { sessionStorage.removeItem('repograph_wiki_run:' + wikiView.projectId); } catch (_) {}
      await loadWiki();
    }
  } catch (e) { if (epoch === wikiView.epoch) wikiView.runError = t('wiki.unknown') + ' ' + e.message; }
  finally { if (epoch === wikiView.epoch) { wikiView.polling = false; renderWikiStatus(); renderWikiRun(); } }
}
function renderWikiRun() {
  const run = wikiView.run;
  const target = document.getElementById('wiki-run');
  const html = (wikiView.submitting ? `<p>${wikiLabel('submitting')}</p>` : '')
    + (run ? `<strong>${wikiLabel('generation')} · ${esc(t('wiki.' + run.status))}</strong><p><code>${esc(run.id)}</code></p>${run.statusReason ? `<p>${esc(run.statusReason)}</p>` : ''}<ol>${run.steps.map(s => `<li>${esc(s.capability)} · ${esc(t('wiki.' + s.status))}<br>${esc(s.summary)}</li>`).join('')}</ol>` : '')
    + (wikiView.runError ? `<div class="wiki-notice">${esc(wikiView.runError)} <button class="btn btn-ghost" onclick="${run ? 'pollWikiRun()' : 'generateWiki()'}">${wikiLabel('retry')}</button></div>` : '');
  if (target.innerHTML !== html) target.innerHTML = html;
}


// Follow the reader without moving focus or altering document/history state.
let wikiReadingFrame = null;
function updateWikiReadingPosition() {
  const panel = document.getElementById('panel-wiki');
  if (!panel.classList.contains('active')) return;
  const scroller = panel.querySelector('.panel-body');
  const sections = [...panel.querySelectorAll('.wiki-section')];
  if (!sections.length) return;
  const top = scroller.getBoundingClientRect().top + 48;
  let current = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= top) current = section;
  }
  if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = sections.at(-1);
  panel.querySelectorAll('#wiki-toc button').forEach(button => {
    const active = current.id === 'wiki-section-' + button.dataset.section;
    if (active) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
  });
}
document.querySelector('#panel-wiki .panel-body').addEventListener('scroll', () => {
  cancelAnimationFrame(wikiReadingFrame);
  wikiReadingFrame = requestAnimationFrame(updateWikiReadingPosition);
}, { passive: true });

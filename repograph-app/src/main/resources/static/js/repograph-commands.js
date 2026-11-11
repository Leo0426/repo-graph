/* Local navigation only: commands never trigger indexing, scans or generation. */
const commandDialog = document.getElementById('command-palette');
let commandPreviousFocus = null;
let commandItems = [];
let commandSelection = 0;
let commandOpening = false;
const COMMAND_RECENT_KEY = 'repograph_recent_commands';
const COMMAND_ICONS = { tools: 'folder-git-2', index: 'folder-git-2', stats: 'chart-no-axes-combined',
  search: 'search', symbol: 'file-text', graph: 'git-branch', wiki: 'file-text', agent: 'shield-check',
  vulns: 'shield-check', metrics: 'chart-no-axes-combined', sbom: 'file-text',
  health: 'activity', benchmark: 'chart-no-axes-combined', admin: 'settings' };
const COMMAND_ALIASES = { tools: 'repositories projects 仓库 项目', index: 'import indexing 接入 索引',
  stats: 'overview statistics 概览 统计', search: 'find semantic code 检索 搜索', symbol: 'source location 源码 符号 定位',
  graph: 'callers callees impact 调用方 被调用 影响 图谱', wiki: 'documents documentation 文档',
  agent: 'triage review 研判 审核', vulns: 'findings vulnerabilities 漏洞 缺陷',
  metrics: 'quality architecture 质量 架构', sbom: 'dependencies packages 依赖 物料清单',
  health: 'services status 服务 健康', benchmark: 'evaluation 测评', admin: 'accounts organizations providers 账号 组织 模型' };

function recentCommands() {
  try {
    const saved = JSON.parse(localStorage.getItem(COMMAND_RECENT_KEY) || '[]');
    return Array.isArray(saved) ? saved.slice(0, 8).filter(item => item && typeof item.id === 'string'
      && item.id.length <= 2000 && ['page','project','task','query'].includes(item.type)) : [];
  } catch (_) { return []; }
}

function rememberCommand(item) {
  const entry = { type: item.type, id: item.id, ...(item.projectId ? { projectId: item.projectId } : {}) };
  const key = value => `${value.type}:${value.projectId || ''}:${value.id}`;
  const entries = [entry, ...recentCommands().filter(value => key(value) !== key(entry))].slice(0, 8);
  try { localStorage.setItem(COMMAND_RECENT_KEY, JSON.stringify(entries)); } catch (_) { /* Navigation remains available. */ }
}

async function openCommandPalette() {
  if (typeof readerDialog !== 'undefined' && readerDialog.open && !readerDialog.matches(':modal')) closeResultReader(false);
  if (commandDialog.open) { closeCommandPalette(); return; }
  if (commandOpening || document.querySelector('dialog[open], #delete-modal[aria-hidden="false"]')) return;
  commandOpening = true;
  try {
    await sessionReady;
    commandPreviousFocus = document.activeElement;
    const store = Alpine.store('repograph');
    if (store.navOpen) {
      store.navOpen = false;
      commandPreviousFocus = document.getElementById('nav-toggle');
      await Alpine.nextTick();
    }
    document.getElementById('account-menu').open = false;
    document.getElementById('command-query').value = '';
    commandDialog.showModal();
    renderCommands();
    document.getElementById('command-query').focus();
  } catch (error) { showToast(error.message, 4000, 'error'); }
  finally { commandOpening = false; }
}

function closeCommandPalette(restoreFocus = true) {
  if (!commandDialog.open) return;
  commandDialog.close();
  if (restoreFocus) {
    const previous = commandPreviousFocus;
    if (previous?.isConnected && !previous.disabled && previous.getClientRects().length) previous.focus({ preventScroll: true });
    else document.getElementById('main-content').focus({ preventScroll: true });
  }
}

function renderCommands() {
  const query = document.getElementById('command-query').value.trim().toLocaleLowerCase();
  const pages = Object.values(WORKSPACE_PANELS).flat().filter(panel => sessionAccount?.role === 'ADMIN' || !['index', 'benchmark'].includes(panel))
    .map(panel => ({ type: 'page', id: panel, label: t(`workspace.page.${panel}`),
      detail: t('command.pages'), icon: COMMAND_ICONS[panel] || 'command', search:
      `${I18N.zh[`workspace.page.${panel}`]} ${I18N.en[`workspace.page.${panel}`]} ${COMMAND_ALIASES[panel] || ''}` }));
  const repositories = state.projects.map(project => ({ type: 'project', id: project.projectId,
    label: projectName(project), detail: t('command.repositories'), icon: 'folder-git-2', search: project.projectRoot }));
  const project = state.projects.find(item => item.projectId === state.activeProjectId);
  const tasks = project ? pages.filter(page => ['search','vulns','graph','wiki','agent','stats'].includes(page.id))
    .map(page => ({ ...page, type: 'task', projectId: project.projectId, detail: projectName(project) })) : [];
  const queries = getHistory().map(value => ({ type: 'query', id: value, label: value,
    detail: t('command.recent'), icon: 'search' }));
  // Rebuild labels from current facts; cached labels, permissions and project names are never trusted.
  const recent = recentCommands().map(entry => {
    if (entry.type === 'task') {
      const repository = state.projects.find(item => item.projectId === entry.projectId);
      const page = pages.find(item => item.id === entry.id && ['search','vulns','graph','wiki','agent','stats'].includes(item.id));
      return repository && page ? { ...page, type: 'task', projectId: repository.projectId, detail: projectName(repository) } : null;
    }
    return (entry.type === 'page' ? pages : entry.type === 'project' ? repositories : queries).find(item => item.id === entry.id);
  }).filter(Boolean);
  const groups = [['command.recentUsed', [...recent, ...queries]], ['command.current', tasks],
    ['command.pages', pages], ['command.repositories', repositories]];
  const seen = new Set();
  commandItems = [];
  const markup = groups.map(([name, items], groupIndex) => {
    const options = items.filter(item => {
      const key = `${item.type}:${item.projectId || ''}:${item.id}`;
      if (seen.has(key) || !`${item.label} ${item.detail} ${item.id} ${item.search || ''}`.toLocaleLowerCase().includes(query)) return false;
      seen.add(key); return true;
    }).map(item => {
      const index = commandItems.push(item) - 1;
      return `<div class="command-option" role="option" id="command-option-${index}" aria-selected="${index === 0}"
        data-command-index="${index}" onclick="runCommand(${index})">
        <svg class="icon" aria-hidden="true"><use href="/vendor/lucide/icons.svg#${item.icon}"/></svg>
        <span>${esc(item.label)}</span><small>${esc(item.detail)}</small></div>`;
    }).join('');
    return options ? `<div role="group" aria-labelledby="command-group-${groupIndex}"><div class="command-group-title" id="command-group-${groupIndex}">${esc(t(name))}</div>${options}</div>` : '';
  }).join('');
  commandSelection = 0;
  document.getElementById('command-results').innerHTML = commandItems.length ? markup
    : `<div class="empty-state"><p>${esc(t('command.empty'))}</p></div>`;
  document.getElementById('command-status').textContent = `${commandItems.length} ${t('command.results')}`;
  selectCommand(0);
}

function selectCommand(index) {
  commandSelection = commandItems.length ? (index + commandItems.length) % commandItems.length : 0;
  document.querySelectorAll('.command-option').forEach((el, i) => el.setAttribute('aria-selected', String(i === commandSelection)));
  const selected = document.getElementById(`command-option-${commandSelection}`);
  const input = document.getElementById('command-query');
  if (selected) {
    input.setAttribute('aria-activedescendant', selected.id);
    selected.scrollIntoView({ block: 'nearest' });
  } else input.removeAttribute('aria-activedescendant');
}

async function runCommand(index) {
  const item = commandItems[index];
  if (!item) return;
  // Revalidate a repository against the current authorized project snapshot.
  if (item.type === 'project' && !state.projects.some(project => project.projectId === item.id)) { renderCommands(); return; }
  if (item.type === 'task' && !state.projects.some(project => project.projectId === item.projectId)) { renderCommands(); return; }
  rememberCommand(item);
  closeCommandPalette(false);
  if (item.type === 'task') {
    await openRepositoryTask(item.projectId, item.id);
    if (item.id === 'search') await focusGlobalSearch();
    return;
  } else if (item.type === 'project') {
    setGlobalProject(item.id);
    await switchPanel('tools');
  } else if (item.type === 'query') {
    await focusGlobalSearch();
    document.getElementById('search-input').value = item.id;
    onSearchInput(document.getElementById('search-input'));
    doSearch();
    return;
  } else if (item.id === 'search') { await focusGlobalSearch(); return; }
  else await switchPanel(item.id);
  await Alpine.nextTick();
  if (!commandDialog.open) document.getElementById('main-content').focus({ preventScroll: true });
}

commandDialog.addEventListener('cancel', event => { event.preventDefault(); closeCommandPalette(); });
document.getElementById('command-query').addEventListener('input', event => {
  if (!event.isComposing) renderCommands();
});
document.getElementById('command-query').addEventListener('compositionend', renderCommands);
commandDialog.addEventListener('click', event => { if (event.target === commandDialog) {
  const box = commandDialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeCommandPalette();
} });
commandDialog.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault(); closeCommandPalette();
  } else if (event.key === 'Tab') {
    const controls = [...commandDialog.querySelectorAll('button, input')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  } else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    document.getElementById('command-query').focus();
    selectCommand(commandSelection + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Enter' && event.target.id === 'command-query') {
    event.preventDefault(); runCommand(commandSelection);
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); closeCommandPalette();
  }
});
document.addEventListener('click', event => {
  const menu = document.getElementById('account-menu');
  if (!menu.contains(event.target)) menu.open = false;
});
document.getElementById('account-menu').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.open = false;
    event.currentTarget.querySelector('summary').focus();
  }
});

// Load before Alpine; defer data loading until the app scripts are ready.
const REPOGRAPH_PANELS = new Set([
  'admin', 'wiki', 'agent', 'search', 'graph', 'symbol', 'stats', 'index', 'tools', 'sbom', 'vulns', 'metrics', 'health', 'benchmark'
]);

const WORKSPACE_PANELS = {
  repository: ['tools', 'index', 'stats'],
  understand: ['search', 'symbol', 'graph', 'wiki'],
  defects: ['vulns', 'agent', 'metrics', 'sbom'],
  validation: ['health', 'benchmark'],
  management: ['admin'],
};
function workspaceForPanel(panel) {
  return Object.keys(WORKSPACE_PANELS).find(key => WORKSPACE_PANELS[key].includes(panel)) || 'repository';
}

function panelRoute() {
  const hash = location.hash.slice(1);
  if (!hash) return { panel: 'tools' };
  if (hash.startsWith('stats=')) {
    try { return { panel: 'stats', projectId: decodeURIComponent(hash.slice(6)) }; }
    catch (_) { return { panel: 'search' }; }
  }
  return { panel: REPOGRAPH_PANELS.has(hash) ? hash : 'search' };
}

function workspaceContext() {
  return { projectId: state.activeProjectId, searchScope: state.searchScope };
}

function rememberWorkspaceContext(mode = 'push') {
  if (mode === 'none') return;
  const context = workspaceContext();
  if (JSON.stringify(history.state?.repograph) === JSON.stringify(context)) return;
  history[mode === 'replace' ? 'replaceState' : 'pushState']({ ...history.state, repograph: context }, '', location.href);
}

document.addEventListener('alpine:init', () => {
  Alpine.store('repograph', {
    panel: panelRoute().panel,
    get workspace() { return workspaceForPanel(this.panel); },
    lang: currentLang,
    navOpen: false,
    routeHash: null,
    routeContext: null,
    scrollPositions: {},

    async showPanel(id, updateHistory = true) {
      if (!REPOGRAPH_PANELS.has(id)) return;
      const fromDrawer = this.navOpen;
      const previousPanel = this.panel;
      const alreadyActive = previousPanel === id && this.routeHash !== null;
      const previousBody = document.querySelector(`#panel-${previousPanel} .panel-body`);
      if (previousBody) this.scrollPositions[previousPanel] = previousBody.scrollTop;
      this.panel = id;
      this.navOpen = false;
      if (updateHistory && location.hash !== `#${id}`) history.pushState({ repograph: workspaceContext() }, '', `#${id}`);
      this.routeHash = location.hash;
      this.routeContext = JSON.stringify(history.state?.repograph);
      await Alpine.nextTick();
      if (fromDrawer) document.getElementById('main-content')?.focus({ preventScroll: true });
      const body = document.querySelector(`#panel-${id} .panel-body`);
      if (body) body.scrollTop = this.scrollPositions[id] || 0;
      if (alreadyActive) return;
      if (typeof handlePanelSwitch === 'function') return handlePanelSwitch(id);
    },

    async restorePanel() {
      const contextKey = JSON.stringify(history.state?.repograph);
      if (this.routeHash === location.hash && this.routeContext === contextKey
          && JSON.stringify(workspaceContext()) === contextKey) return;
      const route = panelRoute();
      const requestedHash = location.hash;
      const context = history.state?.repograph;
      if (context && typeof state !== 'undefined') {
        const projectId = state.projects.some(project => project.projectId === context.projectId) ? context.projectId : '';
        if (state.activeProjectId !== projectId) setGlobalProject(projectId, { reloadStats: false, historyMode: 'none' });
        const scope = context.searchScope === 'authorized' ? 'authorized' : 'current';
        if (state.searchScope !== scope) changeSearchScope(scope, { run: false, historyMode: 'none' });
      }
      const statsInput = document.getElementById('stats-project-input');
      if (route.projectId && statsInput) statsInput.value = route.projectId;
      await this.showPanel(route.panel, false);
      if (route.projectId && this.panel === 'stats' && location.hash === requestedHash) {
        const project = state.projects.find(item => item.projectId === route.projectId);
        if (project && state.activeProjectId !== project.projectId) setGlobalProject(project.projectId, { reloadStats: false, historyMode: 'replace' });
        if (statsInput) statsInput.value = project ? project.projectId : route.projectId;
        await loadProjectStats();
      }
    },

    async toggleNavigation() {
      this.navOpen = !this.navOpen;
      await Alpine.nextTick();
      // Wait for the body class and visibility to reach the rendered frame before focusing the drawer.
      await new Promise(requestAnimationFrame);
      if (this.navOpen) document.querySelector('.nav-btn.active')?.focus();
      else document.getElementById('nav-toggle')?.focus();
    },

    setLang(lang) {
      this.lang = lang;
      if (typeof onLangChange === 'function') onLangChange(lang);
    }
  });
  const restore = () => Alpine.store('repograph').restorePanel();
  window.addEventListener('popstate', restore);
  window.addEventListener('hashchange', restore);
  const mobileNavigation = window.matchMedia('(max-width: 760px)');
  mobileNavigation.addEventListener('change', event => {
    Alpine.store('repograph').navOpen = false;
    if (event.matches && document.getElementById('main-navigation')?.contains(document.activeElement)) {
      document.getElementById('nav-toggle')?.focus();
    }
  });
  document.addEventListener('keydown', event => {
    const store = Alpine.store('repograph');
    if (!store.navOpen || !mobileNavigation.matches) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      store.toggleNavigation();
    } else if (event.key === 'Tab') {
      const buttons = [...document.querySelectorAll('#main-navigation button')].filter(button => !button.hidden && !button.disabled);
      const index = buttons.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault(); buttons.at(-1)?.focus();
      } else if (!event.shiftKey && index === buttons.length - 1) {
        event.preventDefault(); buttons[0]?.focus();
      }
    }
  });
});

// Load before Alpine; defer data loading until the app scripts are ready.
const REPOGRAPH_PANELS = new Set([
  'agent', 'search', 'graph', 'symbol', 'stats', 'index', 'tools', 'sbom', 'vulns', 'metrics', 'health', 'benchmark'
]);

function panelRoute() {
  const hash = location.hash.slice(1);
  if (hash.startsWith('stats=')) {
    try { return { panel: 'stats', projectId: decodeURIComponent(hash.slice(6)) }; }
    catch (_) { return { panel: 'search' }; }
  }
  return { panel: REPOGRAPH_PANELS.has(hash) ? hash : 'search' };
}

document.addEventListener('alpine:init', () => {
  Alpine.store('repograph', {
    panel: panelRoute().panel,
    lang: currentLang,
    navOpen: false,
    routeHash: null,

    async showPanel(id, updateHistory = true) {
      if (!REPOGRAPH_PANELS.has(id)) return;
      const fromDrawer = this.navOpen;
      this.panel = id;
      this.navOpen = false;
      if (updateHistory && location.hash !== `#${id}`) history.pushState(null, '', `#${id}`);
      this.routeHash = location.hash;
      await Alpine.nextTick();
      if (fromDrawer) document.getElementById('main-content')?.focus();
      if (typeof handlePanelSwitch === 'function') return handlePanelSwitch(id);
    },

    async restorePanel() {
      if (this.routeHash === location.hash) return;
      const route = panelRoute();
      const requestedHash = location.hash;
      const statsInput = document.getElementById('stats-project-input');
      if (route.projectId && statsInput) statsInput.value = route.projectId;
      await this.showPanel(route.panel, false);
      if (route.projectId && this.panel === 'stats' && location.hash === requestedHash) {
        const project = state.projects.find(item => item.projectId === route.projectId);
        if (statsInput) statsInput.value = project ? projectName(project) : route.projectId;
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
      const buttons = [...document.querySelectorAll('#main-navigation button')];
      const index = buttons.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault(); buttons.at(-1)?.focus();
      } else if (!event.shiftKey && index === buttons.length - 1) {
        event.preventDefault(); buttons[0]?.focus();
      }
    }
  });
});

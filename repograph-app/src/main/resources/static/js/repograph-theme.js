/* Runs before styles on both the app and login page to avoid a theme flash. */
(() => {
  const key = 'repograph_theme';
  const modes = ['system', 'light', 'dark'];
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  function read() {
    try { const value = localStorage.getItem(key); return modes.includes(value) ? value : 'system'; }
    catch (_) { return 'system'; }
  }
  function apply() {
    document.documentElement.dataset.theme = preference;
    document.documentElement.dataset.colorScheme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.querySelectorAll('[data-theme-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeMode === preference));
    });
  }
  function set(value) {
    if (!modes.includes(value)) return;
    preference = value;
    try { localStorage.setItem(key, preference); } catch (_) { /* Theme still works for this page. */ }
    apply();
  }
  preference = read();
  window.repographTheme = { set, get: () => preference };
  apply();
  media.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', apply);
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) { preference = read(); apply(); } });
})();

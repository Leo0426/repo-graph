// Must load synchronously BEFORE Alpine defer so alpine:init fires before Alpine starts.
document.addEventListener('alpine:init', () => {
  Alpine.store('repograph', {
    panel: 'search',
    lang: currentLang,

    showPanel(id) {
      this.panel = id;
      if (typeof handlePanelSwitch === 'function') handlePanelSwitch(id);
    },

    setLang(lang) {
      this.lang = lang;
      if (typeof onLangChange === 'function') onLangChange(lang);
    }
  });
});

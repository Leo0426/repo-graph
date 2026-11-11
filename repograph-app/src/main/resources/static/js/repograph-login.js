'use strict';
let registering = false;
const form = document.getElementById('auth-form');
const status = document.getElementById('auth-status');
const submit = document.getElementById('auth-submit');
const toggle = document.getElementById('auth-toggle');
let authMessage = { key: '', raw: '' };
function renderAuthLanguage() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel)));
  document.getElementById('auth-heading').textContent = t(registering ? 'auth.registerTitle' : 'auth.signIn');
  document.title = t(registering ? 'auth.registerTitle' : 'auth.signIn') + ' · RepoGraph';
  submit.textContent = t(registering ? 'auth.registerSubmit' : 'auth.signIn');
  toggle.textContent = t(registering ? 'auth.back' : 'auth.register');
  document.getElementById('auth-lang-zh').setAttribute('aria-pressed', String(currentLang === 'zh'));
  document.getElementById('auth-lang-en').setAttribute('aria-pressed', String(currentLang === 'en'));
  status.textContent = authMessage.key ? t(authMessage.key) : authMessage.raw;
}
function changeAuthLanguage(language) {
  currentLang = language === 'en' ? 'en' : 'zh';
  try { localStorage.setItem('repograph_lang', currentLang); } catch (_) {}
  renderAuthLanguage();
}
function setAuthMessage(key, raw = '') { authMessage = {key, raw}; renderAuthLanguage(); }
renderAuthLanguage();
toggle.addEventListener('click', () => {
  registering = !registering;
  document.getElementById('registration-fields').hidden = !registering;
  document.getElementById('email').required = registering;
  document.getElementById('display-name').required = registering;
  document.getElementById('password').autocomplete = registering ? 'new-password' : 'current-password';
  setAuthMessage('');
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = true; toggle.disabled = true; setAuthMessage('auth.submitting');
  try {
    const csrfResponse = await fetch('/api/v1/auth/csrf');
    if (!csrfResponse.ok) throw clientMessageError('auth.csrfFailed');
    const csrf = await csrfResponse.json();
    const credentials = { username: form.username.value, password: form.password.value };
    const body = registering ? JSON.stringify({ ...credentials,
      displayName: document.getElementById('display-name').value, email: document.getElementById('email').value })
      : new URLSearchParams(credentials);
    const response = await fetch('/api/v1/auth/' + (registering ? 'register' : 'login'), {
      method:'POST', headers:{ [csrf.headerName]: csrf.token,
        'Content-Type': registering ? 'application/json' : 'application/x-www-form-urlencoded' }, body
    });
    const result = await response.json();
    if (!response.ok) throw result.error ? new Error(result.error) : clientMessageError('auth.requestFailed');
    form.password.value = '';
    if (registering) setAuthMessage('auth.pending');
    else location.assign('/');
  } catch (error) { setAuthMessage(error.translationKey || '', error.message); }
  finally { submit.disabled = false; toggle.disabled = false; }
});

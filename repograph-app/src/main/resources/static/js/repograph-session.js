/* Session and CSRF handling for every same-origin application request. */
const nativeFetch = window.fetch.bind(window);
let sessionAccount = null;
let csrfToken = null;
const sessionReady = nativeFetch('/api/v1/auth/me').then(async response => {
  if (response.status === 401) { location.assign('/login'); throw new Error('请先登录'); }
  if (!response.ok) throw new Error('无法读取账号状态');
  sessionAccount = await response.json();
  document.querySelectorAll('[data-admin-only]').forEach(element => { element.hidden = sessionAccount.role !== 'ADMIN'; });
  return sessionAccount;
});
// Requests still receive the rejection; prevent an unhandled promise if the page redirects before using the session.
sessionReady.catch(() => {});
async function sessionCsrf() {
  if (!csrfToken) {
    const response = await nativeFetch('/api/v1/auth/csrf');
    if (!response.ok) throw new Error('无法读取安全令牌，请刷新后重试。');
    csrfToken = await response.json();
  }
  return csrfToken;
}
window.fetch = async function(input, options = {}) {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, options);
  await sessionReady;
  const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = await sessionCsrf();
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    headers.set(token.headerName, token.token);
    options = { ...options, headers };
  }
  const response = await nativeFetch(input, options);
  if (response.status === 401) location.assign('/login');
  return response;
};
async function logoutAccount() {
  try {
    const response = await fetch('/api/v1/auth/logout', { method:'POST' });
    if (!response.ok) throw new Error('退出失败，请重试。');
    location.assign('/login');
  } catch (error) { showToast(error.message, 4000, 'error'); }
}

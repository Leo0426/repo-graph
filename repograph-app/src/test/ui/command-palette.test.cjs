'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const installFixtures = require('./fixtures.cjs');
let browser;
before(async () => { browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

async function setup(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', ...options });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.route('**/api/v1/summaries?*', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/v1/admin/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.addInitScript(() => {
    localStorage.setItem('repograph_lang', 'zh');
    localStorage.setItem('repograph_active_project', 'd3e000000001');
    localStorage.setItem('repograph_search_history', JSON.stringify(['find HTTP handlers', '<img src=x onerror=alert(1)>']));
  });
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); assert.deepEqual(fixture.unhandledRequests, []); });
  return { page, fixture };
}

test('command palette supports keyboard selection, cancellation, focus recovery and empty results', async t => {
  const { page } = await setup(t);
  await page.goto(new URL('#search', process.env.UI_BASE_URL).href, { waitUntil: 'networkidle' });
  await page.locator('.header-search').click();
  await page.locator('#command-query').waitFor();
  assert.equal(await page.locator('#command-query').evaluate(el => el === document.activeElement), true);
  const first = await page.locator('#command-query').getAttribute('aria-activedescendant');
  await page.keyboard.press('ArrowDown');
  assert.notEqual(await page.locator('#command-query').getAttribute('aria-activedescendant'), first);
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#command-query').getAttribute('aria-activedescendant'), first);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.getElementById('command-palette').contains(document.activeElement)), true);
  }
  await page.locator('#command-query').fill('nothing-matches-this-command');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#command-palette').evaluate(el => el.open), true);
  assert.match(await page.locator('#command-results').textContent(), /没有匹配/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.header-search').evaluate(el => el === document.activeElement), true);
  assert.equal(new URL(page.url()).hash, '#search');
});

test('commands navigate pages and switch the repository without starting work', async t => {
  const { page } = await setup(t);
  const mutations = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/')) mutations.push(request.url()); });
  await page.goto(process.env.UI_BASE_URL, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  await page.locator('#command-query').fill('调用图谱');
  await page.keyboard.press('Enter');
  await page.locator('#panel-graph.active').waitFor();
  assert.equal(await page.locator('#command-palette').evaluate(el => el.open), false);
  await page.keyboard.press('Meta+k');
  await page.locator('#command-query').fill('d3e000000002');
  await page.keyboard.press('Enter');
  await page.locator('#panel-tools.active').waitFor();
  assert.equal(await page.locator('#global-project').inputValue(), 'd3e000000002');
  assert.match(await page.locator('#repository-current-name').textContent(), /Inventory/);
  assert.deepEqual(mutations, []);
});

test('recent queries remain escaped and execute in the selected repository', async t => {
  const { page } = await setup(t);
  await page.goto(process.env.UI_BASE_URL, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('#command-results img').count(), 0);
  assert.match(await page.locator('#command-results').textContent(), /<img src=x/);
  await page.locator('#command-query').fill('find HTTP');
  const request = page.waitForRequest(request => request.url().includes('/search/semantic?'));
  await page.keyboard.press('Enter');
  const url = new URL((await request).url());
  assert.equal(url.searchParams.get('q'), 'find HTTP handlers');
  assert.equal(url.searchParams.get('projectId'), 'd3e000000001');
  await page.locator('#panel-search.active').waitFor();
  assert.equal(await page.locator('#search-input').inputValue(), 'find HTTP handlers');
});

test('ordinary users cannot navigate to admin-only tools from commands', async t => {
  const { page } = await setup(t);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ id: 'reader', username: 'reader', displayName: 'Reader', role: 'USER', status: 'ACTIVE' }) }));
  await page.goto(process.env.UI_BASE_URL, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  const labels = await page.getByRole('option').allTextContents();
  assert.equal(labels.some(label => label.includes('接入与索引') || label.includes('检索测评')), false);
  await page.locator('#command-query').fill('仓库列表');
  await page.keyboard.press('Enter');
  await page.locator('#panel-tools.active').waitFor();
});

test('palette respects existing modals and dismisses with a second shortcut', async t => {
  const { page } = await setup(t);
  await page.goto(process.env.UI_BASE_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { showDeleteModal('d3e000000001', '/demo/project'); });
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('#command-palette').evaluate(el => el.open), false);
  await page.locator('#delete-modal-cancel').click();
  await page.keyboard.press('Control+k');
  await page.locator('#command-query').waitFor();
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('#command-palette').evaluate(el => el.open), false);
});

test('mobile dark shell keeps repository list first, exposes preferences and fits commands', async t => {
  const { page } = await setup(t, { viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await page.goto(process.env.UI_BASE_URL, { waitUntil: 'networkidle' });
  const first = await page.locator('.tools-project').first().boundingBox();
  assert.ok(first.y + first.height < 844, 'a repository is actionable in the first viewport');
  assert.equal(await page.locator('#main-navigation .icon').count(), 5);
  assert.equal(await page.locator('#main-navigation .icon').evaluateAll(icons => icons.every(icon => icon.getBBox().width > 0)), true,
    'every local symbol has rendered geometry');
  await page.locator('#account-menu > summary').click();
  await page.locator('#lang-en').click();
  assert.equal(await page.locator('#repository-start-title').textContent(), 'Repository list');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#account-menu').evaluate(el => el.open), false);
  await page.locator('.header-search').click();
  await page.locator('#command-query').fill('repository');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#command-palette').evaluate(el => el.scrollWidth <= el.clientWidth), true);
});

test('commands group recent and current-repository tasks, match bilingual aliases and restore recent navigation', async t => {
  const { page } = await setup(t);
  await page.goto(process.env.UI_BASE_URL, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  assert.equal(await page.getByRole('group', { name: '最近使用', exact: true }).count(), 1);
  assert.ok(await page.getByRole('group', { name: '当前仓库', exact: true }).count());
  await page.locator('#command-query').fill('dependencies');
  await page.keyboard.press('Enter');
  await page.locator('#panel-sbom.active').waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  assert.match(await page.locator('#command-results [role="option"]').first().textContent(), /依赖/);
  await page.keyboard.press('Escape');
  await page.locator('#account-menu > summary').click();
  await page.locator('#lang-en').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.locator('#command-query').fill('调用图谱');
  assert.ok(await page.getByRole('option').count());
  await page.keyboard.press('Enter');
  await page.locator('#panel-graph.active').waitFor();
});

test('invalid or revoked recent commands cannot restore access and IME composition cannot run a command', async t => {
  const { page, fixture } = await setup(t);
  await page.addInitScript(() => localStorage.setItem('repograph_recent_commands', JSON.stringify([
    {type:'project',id:'revoked-repository'}, {type:'task',id:'graph',projectId:'revoked-repository'},
    {type:'page',id:'not-a-panel'}, null, {type:'query',id:'<script>unsafe</script>'}
  ])));
  await page.goto(process.env.UI_BASE_URL, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  assert.doesNotMatch(await page.locator('#command-results').textContent(), /revoked-repository|not-a-panel|unsafe/);
  const before = await page.locator('#command-results [role="option"]').count();
  await page.locator('#command-query').dispatchEvent('compositionstart');
  await page.locator('#command-query').evaluate(el => {
    el.value = 'nothing-matches';
    el.dispatchEvent(new InputEvent('input', {bubbles:true,isComposing:true}));
    el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,isComposing:true}));
  });
  assert.equal(await page.locator('#command-results [role="option"]').count(), before);
  assert.equal(await page.locator('#command-palette').evaluate(el=>el.open), true);
  await page.locator('#command-query').dispatchEvent('compositionend');
  assert.equal(await page.locator('#command-results [role="option"]').count(), 0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('repograph_recent_commands', '{broken'));
  await page.keyboard.press('Control+k');
  await page.locator('#command-query').fill(fixture.projects[0].projectId);
  assert.equal(await page.locator('#command-results [role="option"]').count(), 1);
  // A permission refresh while the palette is open must invalidate its old selected item.
  await page.route('**/api/v1/projects',route=>route.fulfill({json:[fixture.projects[1]]}));
  await page.evaluate(() => refreshProjectsList());
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#command-palette').evaluate(el=>el.open), true);
  assert.equal(await page.locator('#command-results [role="option"]').count(), 0);
});

test('optional browser storage being unavailable does not block navigation or command use', async t => {
  const { page } = await setup(t);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Denied', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Denied', 'SecurityError'); };
  });
  await page.goto(process.env.UI_BASE_URL, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  await page.locator('#command-query').fill('dependencies');
  await page.keyboard.press('Enter');
  await page.locator('#panel-sbom.active').waitFor();
});

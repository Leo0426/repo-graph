'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const installFixtures = require('./fixtures.cjs');
let browser;
before(async () => { browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

async function setup(t, { colorScheme = 'light', viewport = { width: 1440, height: 1000 }, theme } = {}) {
  const context = await browser.newContext({ colorScheme, viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.route('**/api/v1/summaries?*', route => route.fulfill({ json: [] }));
  await page.addInitScript(theme => {
    localStorage.setItem('repograph_lang', 'zh');
    localStorage.setItem('repograph_active_project', 'd3e000000001');
    if (theme && !sessionStorage.getItem('refinement-theme-seeded')) {
      localStorage.setItem('repograph_theme', theme);
      sessionStorage.setItem('refinement-theme-seeded', '1');
    }
  }, theme);
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); assert.deepEqual(fixture.unhandledRequests, []); });
  return { page, context };
}
const go = (page, panel = 'tools') => page.goto(new URL('#' + panel, process.env.UI_BASE_URL).href, { waitUntil: 'domcontentloaded' });
const scheme = page => page.locator('html').evaluate(el => getComputedStyle(el).colorScheme);

test('header bounds repository names and groups the service status into an icon action', async t => {
  const { page } = await setup(t);
  await go(page);
  await page.waitForFunction(() => document.querySelectorAll('#global-project option').length > 1);
  assert.ok((await page.locator('.project-context').boundingBox()).width <= 260);
  assert.equal(await page.locator('#global-project option:checked').textContent(), 'Demo Order Service — 虚构示例');
  assert.ok(await page.locator('.service-indicator .icon').evaluate(el => el.getBBox().width > 0));
  const treatments = await page.locator('.header-search, .service-indicator, #account-menu > summary').evaluateAll(elements =>
    elements.map(el => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopWidth, s.borderRadius, s.height]; }));
  assert.deepEqual(treatments[0], treatments[1]);
  assert.deepEqual(treatments[1], treatments[2]);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#global-project').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('static and dynamically rendered selects share an adaptive arrow and retain native selection', async t => {
  const { page } = await setup(t, { colorScheme: 'dark' });
  await go(page, 'vulns');
  await page.locator('.vuln-finding').first().locator('summary').click();
  const select = page.locator('.vuln-finding').first().locator('select');
  assert.equal(await select.evaluate(el => el.parentElement.classList.contains('select-control')), true);
  assert.equal(await select.evaluate(el => getComputedStyle(el).appearance), 'none');
  const arrow = await select.evaluate(el => {
    const wrapper = getComputedStyle(el.parentElement), glyph = getComputedStyle(el.parentElement, '::after');
    return { mask: glyph.maskImage, color: glyph.backgroundColor, expected: wrapper.color, pointer: glyph.pointerEvents };
  });
  assert.notEqual(arrow.mask, 'none');
  assert.equal(arrow.color, arrow.expected);
  assert.equal(arrow.pointer, 'none');
  await page.locator('#vuln-filter-status').selectOption('CONFIRMED');
  await page.waitForFunction(() => document.querySelectorAll('.vuln-finding').length === 1);
  assert.match(await page.locator('.vuln-finding').textContent(), /错误响应/);
});

test('page actions share the navigation row and field help is keyboard discoverable', async t => {
  const { page } = await setup(t);
  await go(page);
  await page.locator('#tools-refresh-projects').waitFor();
  assert.equal(await page.locator('#panel-tools .panel-header, #panel-tools .tools-section-heading').count(), 0);
  const row = await page.locator('.workspace-row:visible').boundingBox();
  const action = await page.locator('#tools-refresh-projects').boundingBox();
  assert.ok(action.y >= row.y && action.y + action.height <= row.y + row.height + 1);
  await page.evaluate(() => switchPanel('symbol'));
  const hint = page.locator('#symbol-query-hint');
  assert.equal(await hint.isVisible(), false);
  const disclosure = page.locator('.help-note').filter({ has: hint });
  await disclosure.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await hint.isVisible(), true);
  assert.match(await page.locator('#symbol-qn-input').getAttribute('aria-describedby'), /symbol-query-hint/);
});

test('result context uses reading typography and annotations use compact chips', async t => {
  const { page } = await setup(t);
  await go(page, 'search');
  await page.locator('#search-input').fill('orders');
  await page.locator('#search-input').press('Enter');
  const card = page.locator('.result-card').first();
  await card.waitFor();
  const fonts = await card.evaluate(el => Object.fromEntries(['rc-title', 'rc-name', 'rc-path', 'rc-sig'].map(name =>
    [name, getComputedStyle(el.querySelector('.' + name)).fontFamily])));
  assert.equal(fonts['rc-title'], fonts['rc-sig']);
  assert.equal(fonts['rc-name'], fonts['rc-path']);
  assert.notEqual(fonts['rc-name'], fonts['rc-title']);
  assert.equal(await card.locator('.rc-annotations > span').first().evaluate(el => getComputedStyle(el).borderTopWidth), '1px');
});

test('graph labels retain icons after changing language and hide implementation names', async t => {
  const { page } = await setup(t);
  await go(page, 'graph');
  await page.locator('#graph-more-queries > summary').click();
  assert.equal(await page.locator('#graph-tab-row .icon').count(), 8);
  assert.match(await page.locator('.graph-legend').textContent(), /类/);
  assert.doesNotMatch(await page.locator('.graph-legend').textContent(), /CLASS|METHOD|ROOT/);
  await page.evaluate(() => Alpine.store('repograph').setLang('en'));
  assert.equal(await page.locator('#graph-tab-row .icon').count(), 8);
  assert.equal(await page.locator('#graph-tab-row .icon').evaluateAll(icons => icons.every(icon => icon.getBBox().width > 0)), true);
  assert.match(await page.locator('.graph-legend').textContent(), /Class/);
  await page.evaluate(() => switchPanel('metrics'));
  assert.doesNotMatch(await page.locator('.architecture-review-head').textContent(), /A\/02|ForgeFlow|Ollama/);
});

test('manual theme overrides the OS, persists to login, and system resumes following the OS', async t => {
  const { page } = await setup(t, { colorScheme: 'light', theme: 'dark' });
  await go(page);
  assert.equal(await scheme(page), 'dark');
  await page.locator('#account-menu > summary').click();
  await page.locator('[data-theme-mode="light"]').click();
  assert.equal(await scheme(page), 'light');
  assert.equal(await page.locator('[data-theme-mode="light"]').getAttribute('aria-pressed'), 'true');
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await scheme(page), 'light');
  await page.goto(new URL('/login', process.env.UI_BASE_URL).href);
  assert.equal(await scheme(page), 'light');
  await go(page);
  await page.locator('#account-menu > summary').click();
  await page.locator('[data-theme-mode="system"]').click();
  assert.equal(await scheme(page), 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).colorScheme === 'light');
  assert.equal(await page.evaluate(() => localStorage.getItem('repograph_theme')), 'system');
});

test('invalid or unwritable theme storage falls back without blocking the app', async t => {
  const { page } = await setup(t, { colorScheme: 'dark' });
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) { return key === 'repograph_theme' ? 'invalid-value' : read.call(this, key); };
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'repograph_theme') throw new Error('test storage denied'); return save.call(this, key, value); };
  });
  await go(page);
  assert.equal(await scheme(page), 'dark');
  await page.locator('#account-menu > summary').click();
  await page.locator('[data-theme-mode="light"]').click();
  assert.equal(await scheme(page), 'light');
});

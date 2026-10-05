'use strict';

// Run against the rendered application; every API request is intercepted by fictional fixtures.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const installFixtures = require('./fixtures.cjs');
const baseUrl = process.env.UI_BASE_URL;
if (!baseUrl) throw new Error('Set UI_BASE_URL to a running RepoGraph view server.');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' }); });
after(async () => { await browser?.close(); });

async function workspace(t, hash = '#search', options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ...options });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.addInitScript(() => {
    localStorage.setItem('repograph_active_project', 'd3e000000001');
    localStorage.setItem('repograph_lang', 'zh');
  });
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(fixture.unhandledRequests, [], 'All API fixtures must be intentional');
  });
  await page.goto(new URL(hash, baseUrl).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.Alpine && document.querySelector('.panel.active'));
  return { page, fixture };
}
async function panel(page, id) {
  await page.waitForFunction(id => document.querySelector('.panel.active')?.id === `panel-${id}`, id);
  assert.equal(await page.locator('.panel.active').count(), 1);
}
async function focused(page, id) {
  await page.waitForFunction(id => document.activeElement?.id === id, id);
}
async function settledSearch(page, text) {
  await page.waitForFunction(text => document.querySelector('#search-results').getAttribute('aria-busy') === 'false'
    && document.querySelector('#search-results').textContent.includes(text), text);
}
async function search(page, query) {
  await page.locator('#search-input').fill(query);
  await page.locator('#search-input').press('Enter');
}
async function searchRoute(page, handler) {
  await page.route('**/api/v1/search/**', async route => {
    const url = new URL(route.request().url());
    const result = await handler(url);
    await route.fulfill({ status: result.status || 200, contentType: 'application/json', body: JSON.stringify(result.body) });
  });
}
function result(unit, name, hasMore = false) {
  return { results: [{ unit: { ...unit, qualifiedName: name }, score: 0.94 }], hasMore };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('navigation survives history, reload, stats deep links and global search shortcuts', async t => {
  const { page } = await workspace(t);
  await page.locator('.nav-btn').filter({ has: page.locator('[data-i18n="nav.stats"]') }).click();
  await panel(page, 'stats');
  // Entering Overview now loads the selected project and writes its canonical deep link.
  await page.waitForFunction(() => location.hash === '#stats=d3e000000001');
  assert.equal(await page.locator('#stats-content').getAttribute('data-project-id'), 'd3e000000001');
  await page.evaluate(() => switchPanel('graph'));
  await panel(page, 'graph');
  await page.goBack();
  await panel(page, 'stats');
  await page.goForward();
  await panel(page, 'graph');
  await page.reload({ waitUntil: 'networkidle' });
  await panel(page, 'graph');
  await page.keyboard.press('Control+k');
  await panel(page, 'search');
  await focused(page, 'search-input');
  await page.goto(new URL('#stats=d3e000000002', baseUrl).href);
  await panel(page, 'stats');
  await page.waitForFunction(() => document.querySelector('#stats-content').textContent.includes('386'));
});

test('mobile drawer traps keyboard navigation, closes on Escape and preserves project selection', async t => {
  const { page } = await workspace(t, '#search', { viewport: { width: 390, height: 844 } });
  assert.equal(await page.locator('#global-project').isVisible(), true);
  assert.equal(await page.locator('#main-navigation').isVisible(), false);
  await page.locator('#nav-toggle').click();
  await page.waitForFunction(() => document.activeElement?.classList.contains('nav-btn'));
  await page.locator('#main-navigation button').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#main-navigation button').first().evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#main-navigation button').last().evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  await focused(page, 'nav-toggle');
  assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'false');
  await page.locator('#nav-toggle').click();
  await page.locator('.nav-btn').filter({ has: page.locator('[data-i18n="nav.agent"]') }).click();
  await panel(page, 'agent');
  await focused(page, 'main-content');
  assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => showToast('DEMO ' + 'LongErrorMessage'.repeat(12), 5000, 'error'));
  await page.waitForFunction(() => document.querySelector('#toast').textContent.length > 100);
  assert.equal(await page.locator('#toast').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  await page.locator('#nav-toggle').click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => !Alpine.store('repograph').navOpen);
  await page.locator('#main-navigation button').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#main-navigation').evaluate(el => el.contains(document.activeElement)), false);
});

test('a slow stats response cannot overwrite a newer navigation URL', async t => {
  const { page } = await workspace(t);
  let requested = false;
  await page.route('**/api/v1/projects/*/stats', async route => {
    requested = true;
    await delay(600);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ projectId: 'd3e000000001', totalUnits: 123 }) });
  });
  await page.evaluate(async () => {
    await switchPanel('stats');
    document.querySelector('#stats-project-input').value = 'd3e000000001';
    loadProjectStats();
  });
  await panel(page, 'stats');
  await page.waitForTimeout(100);
  assert.equal(requested, true);
  await page.evaluate(() => switchPanel('graph'));
  await page.waitForTimeout(700);
  await panel(page, 'graph');
  assert.equal(new URL(page.url()).hash, '#graph');
});

test('delete dialog traps focus, blocks background shortcuts and restores focus on cancel/confirm', async t => {
  const { page } = await workspace(t);
  await page.locator('#search-input').focus();
  await page.evaluate(() => { window.dialogResult = null; showDeleteModal('demo', '/demo/order').then(value => window.dialogResult = value); });
  await focused(page, 'delete-modal-cancel');
  assert.equal(await page.locator('.layout').evaluate(el => el.inert), true);
  await page.keyboard.press('Shift+Tab');
  await focused(page, 'delete-modal-confirm');
  await page.keyboard.press('Tab');
  await focused(page, 'delete-modal-cancel');
  await page.keyboard.press('Control+k');
  await focused(page, 'delete-modal-cancel');
  await page.keyboard.press('Escape');
  await focused(page, 'search-input');
  assert.equal(await page.evaluate(() => window.dialogResult), false);
  assert.equal(await page.locator('.layout').evaluate(el => el.inert), false);
  await page.evaluate(() => { showDeleteModal('demo', '/demo/order').then(value => window.dialogResult = value); });
  await page.locator('#delete-modal-confirm').click();
  assert.equal(await page.evaluate(() => window.dialogResult), true);
  await page.route('**/api/v1/index/project?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"DEMO delete failed"}' }));
  assert.equal(await page.evaluate(() => api.deleteProject('demo').then(() => 'success', error => error.message)), 'DEMO delete failed');
});

test('health reflects degraded, failed and recovered HTMX responses without stale green badges', async t => {
  const { page } = await workspace(t);
  await page.waitForFunction(() => document.querySelector('#sb-health').dataset.state === 'degraded');
  const failHealth = route => route.fulfill({ status: 503, body: 'DEMO unavailable' });
  await page.route('**/api/fragments/health', failHealth);
  await page.evaluate(() => { htmx.ajax('GET', '/api/fragments/health', { target: '#health-grid', swap: 'innerHTML' }).catch(() => {}); });
  await page.waitForFunction(() => document.querySelector('#sb-health').dataset.state === 'offline');
  assert.equal(await page.locator('.health-badges .badge-dot.ok').count(), 0);
  assert.equal(await page.locator('#hb-qdrant').getAttribute('data-health'), 'offline');
  await page.unroute('**/api/fragments/health', failHealth);
  await page.evaluate(() => { htmx.ajax('GET', '/api/fragments/health', { target: '#health-grid', swap: 'innerHTML' }); });
  await page.waitForFunction(() => document.querySelector('#sb-health').dataset.state === 'degraded');
  assert.equal(await page.locator('#hb-qdrant').getAttribute('data-health'), 'ok');
});

test('latest search wins and clearing input invalidates an in-flight response', async t => {
  const { page, fixture } = await workspace(t);
  await searchRoute(page, async url => {
    const q = url.searchParams.get('q');
    await delay(q === 'old' || q === 'clear-pending' ? 650 : 40);
    return { body: result(fixture.units[0], q) };
  });
  await search(page, 'old');
  await search(page, 'new');
  await settledSearch(page, 'new');
  await page.waitForTimeout(750);
  assert.equal(await page.locator('.rc-name').textContent(), 'new');
  await search(page, 'clear-pending');
  await page.locator('#search-clear').click();
  await page.waitForTimeout(750);
  assert.equal(await page.locator('.result-card').count(), 0);
  assert.equal(await page.locator('.search-examples button').count(), 3);
  assert.equal(await page.locator('#search-results').getAttribute('aria-busy'), 'false');
});

test('manual search cancels debounce, deduplicates pending submissions and ignores composing Enter', async t => {
  const { page, fixture } = await workspace(t);
  let requests = 0;
  await searchRoute(page, async () => { requests++; await delay(40); return { body: result(fixture.units[0], 'once') }; });
  await search(page, 'once');
  await page.evaluate(() => doSearch());
  await settledSearch(page, 'once');
  await page.waitForTimeout(400);
  assert.equal(requests, 1, 'Enter should cancel the input debounce, including a fast API response');
  await page.locator('#search-input').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await page.waitForTimeout(100);
  assert.equal(requests, 1);
});

test('search failures can be retried, empty matches are distinct, and late pagination is ignored', async t => {
  const { page, fixture } = await workspace(t);
  let fails = true;
  await searchRoute(page, async url => {
    if (fails) return { status: 503, body: { error: 'DEMO search unavailable' } };
    const q = url.searchParams.get('q');
    if (q === 'empty') return { body: { results: [], hasMore: false } };
    const offset = Number(url.searchParams.get('offset'));
    if (offset) await delay(600);
    return { body: result(fixture.units[0], offset ? 'late-old-page' : q, q === 'paged' && !offset) };
  });
  await search(page, 'paged');
  await page.locator('.search-retry').waitFor();
  assert.equal(await page.locator('#search-submit').isEnabled(), true);
  fails = false;
  await page.locator('.search-retry').click();
  await settledSearch(page, 'paged');
  await page.locator('#load-more-btn').click();
  await search(page, 'replacement');
  await settledSearch(page, 'replacement');
  await page.waitForTimeout(700);
  assert.deepEqual(await page.locator('.rc-name').allTextContents(), ['replacement']);
  await search(page, 'empty');
  await settledSearch(page, '未找到');
  assert.equal(await page.locator('.search-examples').count(), 0);
});

test('result controls work from the keyboard and clipboard failure is reported truthfully', async t => {
  const { page } = await workspace(t);
  await search(page, 'orders');
  await page.locator('.result-card').first().waitFor();
  const toggle = page.locator('.rc-source-toggle').first();
  await toggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await toggle.textContent().then(text => text.trim()), await page.evaluate(() => t('src.close')));
  assert.equal(await page.locator('.rc-source-pre').first().isVisible(), true);
  await page.waitForFunction(() => document.querySelector('.rc-source-pre').getBoundingClientRect().height > 80);
  assert.match(await page.locator('.rc-source-pre').first().textContent(), /DEMO/);
  await panel(page, 'search');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: () => Promise.reject(new Error('DEMO denied')) }
  }));
  await page.locator('.copy-btn').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#toast').dataset.tone === 'error'
    && document.querySelector('#toast').textContent === t('toast.copyFailed'));
  await panel(page, 'search');
  await page.locator('[data-group="lang"][data-val="java"]').click();
  assert.equal(await page.locator('[data-group="lang"][data-val="java"]').getAttribute('aria-pressed'), 'true');
});

test('agent remains readable at desktop, tablet and phone widths, with persistent detail and text size', async t => {
  const { page, fixture } = await workspace(t, '#agent');
  await page.locator('.agent-run-item').first().click();
  await page.locator('.agent-step-result').waitFor();
  await page.locator('#agent-prepare-btn').click();
  assert.equal(await page.locator('#agent-format-field').isVisible(), false);
  await page.evaluate(() => setAgentInputMode('external'));
  assert.equal(await page.locator('#agent-format-field').isVisible(), true);
  await page.evaluate(() => setAgentInputMode('vuln'));
  assert.equal(await page.locator('#agent-format-field').isVisible(), false);
  await page.locator('.agent-llm-header').click();
  assert.equal(await page.locator('.agent-llm-header').getAttribute('aria-expanded'), 'true');
  await page.locator('.agent-llm-header').click();
  assert.equal(await page.locator('.agent-llm-header').getAttribute('aria-expanded'), 'false');
  const details = page.locator('#agent-run-detail details').first();
  await details.evaluate(el => { el.open = true; });
  await page.evaluate(run => renderAgentRunDetail(run), fixture.run);
  assert.equal(await details.evaluate(el => el.open), true);
  for (const width of [1440, 1024, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(300);
    for (const size of ['standard', 'large']) {
      await page.evaluate(size => setAgentTextSize(size), size);
      assert.equal(await page.locator('#panel-agent').getAttribute('data-text-size'), size);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}/${size} viewport`);
      assert.equal(await page.locator('.agent-step-result span').evaluateAll(nodes => nodes.every(el =>
        getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0)), true, `${width}/${size} result labels`);
      const overflow = await page.locator('#panel-agent .panel-body').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, `${width}/${size} panel`);
    }
  }
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('#panel-agent').getAttribute('data-text-size'), 'large');
});

test('English labels and reduced motion remain usable', async t => {
  const { page } = await workspace(t, '#search', { reducedMotion: 'reduce' });
  await page.evaluate(() => Alpine.store('repograph').setLang('en'));
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.match(await page.locator('#nav-toggle').getAttribute('aria-label'), /navigation|menu/i);
  await search(page, 'orders');
  await page.locator('.result-card').first().waitFor();
  assert.equal(await page.locator('.result-card').first().evaluate(el =>
    parseFloat(getComputedStyle(el).animationDuration) <= 0.001), true);
});

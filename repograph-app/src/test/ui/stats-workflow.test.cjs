'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const installFixtures = require('./fixtures.cjs');
const baseUrl = process.env.UI_BASE_URL;
if (!baseUrl) throw new Error('Set UI_BASE_URL to an isolated RepoGraph view server.');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' }); });
after(async () => { await browser?.close(); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pid = 'd3e000000001';
const otherPid = 'd3e000000002';
const snapshot = (projectId = pid, overrides = {}) => ({ projectId, projectRoot: `/demo/${projectId}`,
  totalUnits: 100, totalFiles: 12, totalEdges: 80, entryPointCount: 4, testCount: 9,
  kindDistribution: { METHOD: 75, CLASS: 25, FIELD: 0 }, languageDistribution: { java: 80, python: 20 },
  frameworkDistribution: { spring: 30, mybatis: 10 }, edgeKindDistribution: { CALLS: 60, EXTENDS: 20 }, ...overrides });

async function workspace(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', ...options });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.addInitScript(() => {
    localStorage.setItem('repograph_active_project', 'd3e000000001');
    localStorage.setItem('repograph_lang', 'en');
  });
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(fixture.unhandledRequests, [], 'All API responses come from intentional fixtures');
  });
  await page.goto(new URL('#stats', baseUrl).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#panel-stats.active'));
  return { page, fixture };
}
async function load(page, projectId = pid) {
  await page.locator('#stats-project-input').fill(projectId);
  await page.locator('#stats-project-input').press('Enter');
}
async function statsRoute(page, handler) {
  await page.route('**/api/v1/projects/*/stats', async route => {
    const projectId = new URL(route.request().url()).pathname.split('/')[4];
    const result = await handler(projectId);
    await route.fulfill({ status: result.status || 200, json: result.body || result });
  });
}

test('distribution bars use the DTO denominator and zero counts never get a nonzero bar', async t => {
  const { page } = await workspace(t);
  await statsRoute(page, () => snapshot());
  await load(page);
  await page.locator('.stats-summary').waitFor();
  const methods = page.locator('#stats-content .dist-row[title^="METHOD"]');
  assert.equal(await methods.locator('.dist-bar').evaluate(el => el.style.width), '75%');
  assert.match(await methods.innerText(), /75\.0%/);
  const zero = page.locator('#stats-content .dist-row[title^="FIELD"]');
  assert.equal(await zero.locator('.dist-bar').evaluate(el => el.style.width), '0%');
  const framework = page.locator('#stats-content .dist-row[title^="spring"]');
  assert.equal(await framework.locator('.dist-bar').evaluate(el => el.style.width), '75%');
});

test('kind distribution supports keyboard activation and explains the all-project search scope', async t => {
  const { page } = await workspace(t);
  await statsRoute(page, () => snapshot());
  await load(page);
  const methods = page.locator('#stats-content .dist-row[title^="METHOD"]');
  await methods.focus();
  assert.match(await methods.getAttribute('aria-label'), /across all projects/);
  await methods.press('Enter');
  await page.waitForFunction(() => document.querySelector('#panel-search.active')
    && state.filters.kind === 'METHOD' && document.activeElement?.id === 'search-input');
  assert.equal(await page.evaluate(() => state.filters.kind), 'METHOD');
  assert.equal(await page.locator('#search-input').evaluate(el => el === document.activeElement), true);
});

test('main API errors keep server detail and retry without disguising failure as an empty project', async t => {
  const { page } = await workspace(t);
  let calls = 0;
  await statsRoute(page, () => ++calls === 1 ? { status: 503, body: { error: 'DEMO_STATS_OFFLINE' } } : snapshot());
  await load(page);
  await page.waitForFunction(() => document.querySelector('#stats-content').textContent.includes('DEMO_STATS_OFFLINE'));
  await page.locator('#stats-content .stats-retry').click();
  await page.locator('.stats-summary').waitFor();
  assert.equal(await page.locator('#stats-content').getAttribute('aria-busy'), 'false');
});

test('changing or clearing the project immediately withdraws old watch and delete actions', async t => {
  const { page } = await workspace(t);
  await statsRoute(page, () => snapshot());
  await load(page);
  await page.locator('#stats-watch-bar').waitFor({ state: 'visible' });
  await page.locator('#stats-project-input').fill('');
  assert.equal(await page.locator('#stats-watch-bar').isVisible(), false);
  assert.equal(await page.locator('.stats-summary').count(), 0);
  assert.match(await page.locator('#stats-content').innerText(), /Select a project/);
});

test('a delayed old snapshot cannot overwrite the current project or navigation URL', async t => {
  const { page } = await workspace(t);
  await statsRoute(page, async projectId => {
    await delay(projectId === pid ? 500 : 20);
    return snapshot(projectId, { totalUnits: projectId === pid ? 111 : 222 });
  });
  const first = page.waitForRequest(`**/api/v1/projects/${pid}/stats`);
  await load(page, pid);
  await first;
  await load(page, otherPid);
  await page.waitForTimeout(650);
  assert.equal(new URL(page.url()).hash, `#stats=${otherPid}`);
  assert.match(await page.locator('.stats-summary').innerText(), /222/);
  assert.doesNotMatch(await page.locator('.stats-summary').innerText(), /111/);
});

test('optional metrics report failures separately and can retry while retaining the overview', async t => {
  const { page } = await workspace(t);
  await statsRoute(page, () => snapshot());
  let calls = 0;
  await page.route('**/api/v1/metrics/hotspots?**', route => route.fulfill(++calls === 1
    ? { status: 503, json: { error: 'DEMO_HOTSPOTS_OFFLINE' } } : { json: [] }));
  await load(page);
  await page.waitForFunction(() => document.querySelector('#hotspots-section')?.textContent.includes('DEMO_HOTSPOTS_OFFLINE'));
  assert.equal(await page.locator('.stats-summary').isVisible(), true);
  assert.doesNotMatch(await page.locator('#hotspots-section').innerText(), /not in a git repo/i);
  await page.locator('#hotspots-section .stats-retry').click();
  await page.waitForFunction(() => document.querySelector('#hotspots-section').textContent.includes('No hotspot data'));
});

test('an empty project shows real zero counts without unrelated framework messages', async t => {
  const { page } = await workspace(t);
  await statsRoute(page, () => snapshot(pid, { totalUnits: 0, totalFiles: 0, totalEdges: 0, testCount: 0,
    entryPointCount: 0, kindDistribution: {}, languageDistribution: {}, frameworkDistribution: {}, edgeKindDistribution: {} }));
  await load(page);
  await page.locator('.stats-zero').waitFor();
  assert.deepEqual(await page.locator('.stats-summary .stat-val').allTextContents(), ['0', '0', '0', '0', '0']);
  assert.equal(await page.locator('#stats-content').getByText('No framework-annotated nodes detected', { exact: true }).count(), 1);
  assert.doesNotMatch(await page.locator('#stats-content').innerText(), /NaN|Infinity|undefined/);
});

test('long project paths and distribution labels fit a 390px viewport', async t => {
  const { page } = await workspace(t, { viewport: { width: 390, height: 844 } });
  await statsRoute(page, () => snapshot(pid, { projectRoot: '/demo/' + 'long-component/'.repeat(12),
    frameworkDistribution: { ['long_framework_name_'.repeat(5)]: 40 } }));
  await load(page);
  await page.locator('.stats-summary').waitFor();
  assert.equal(await page.locator('#panel-stats .panel-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  assert.equal(await page.locator('#stats-content .dist-card').evaluateAll(cards => cards.every(el => el.scrollWidth <= el.clientWidth + 1)), true);
});

test('duplicate requests share one load and a late watch response cannot change the next project', async t => {
  const { page } = await workspace(t);
  let requests = 0;
  await statsRoute(page, async projectId => {
    requests++;
    await delay(100);
    return snapshot(projectId);
  });
  await page.route('**/api/v1/watch/*', async route => {
    const old = route.request().url().endsWith(pid);
    await delay(old ? 650 : 10);
    await route.fulfill({ json: { watching: old } });
  });
  await load(page);
  await page.evaluate(() => { loadProjectStats(); loadProjectStats(); });
  assert.equal(await page.locator('#stats-content').getAttribute('aria-busy'), 'true');
  await page.locator('.stats-summary').waitFor();
  assert.equal(requests, 1);
  await load(page, otherPid);
  await page.waitForTimeout(850);
  assert.equal(await page.locator('#stats-watch-bar').evaluate(el => el.classList.contains('active')), false);
  assert.equal(await page.locator('#stats-watch-btn').innerText(), 'Start watching');
  assert.equal(new URL(page.url()).hash, `#stats=${otherPid}`);
});

test('health polling preserves focused controls and language changes reuse cached metrics and export preview', async t => {
  const { page, fixture } = await workspace(t);
  await statsRoute(page, () => snapshot());
  await load(page);
  await page.locator('.stats-health-card').waitFor();
  const row = page.locator('[data-stats-kind="METHOD"]');
  await row.focus();
  await page.evaluate(() => {
    window.statsFocusedRow = document.activeElement;
    document.getElementById('export-preview').style.display = '';
    document.getElementById('export-preview-code').textContent = 'DEMO preserved export';
    applyLang();
  });
  assert.equal(await page.evaluate(() => window.statsFocusedRow === document.activeElement && window.statsFocusedRow.isConnected), true);
  const metricCalls = fixture.requested.filter(path => path.includes('/api/v1/metrics/')).length;
  await page.evaluate(() => Alpine.store('repograph').setLang('zh'));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#export-preview-code').textContent(), 'DEMO preserved export');
  assert.equal(await page.locator('[data-stats-kind="METHOD"]').evaluate(el => el === document.activeElement), true);
  assert.equal(fixture.requested.filter(path => path.includes('/api/v1/metrics/')).length, metricCalls);
});

test('a slow watch action converges after refreshing the same project', async t => {
  const { page } = await workspace(t);
  await statsRoute(page, () => snapshot());
  let watching = false;
  let finish;
  const completion = new Promise(resolve => { finish = resolve; });
  let started;
  const mutationStarted = new Promise(resolve => { started = resolve; });
  await page.route(`**/api/v1/watch/${pid}`, route => route.fulfill({ json: { watching } }));
  await page.route('**/api/v1/watch?**', async route => {
    started();
    await completion;
    watching = true;
    await route.fulfill({ json: { watching: true } });
  });
  await load(page);
  await page.waitForFunction(() => !document.getElementById('stats-watch-btn').disabled);
  await page.locator('#stats-watch-btn').click();
  await mutationStarted;
  await page.locator('#stats-load-btn').click();
  await page.waitForFunction(() => !document.getElementById('stats-watch-btn').disabled
    && !document.getElementById('stats-watch-bar').classList.contains('active'));
  finish();
  await page.waitForFunction(() => document.getElementById('stats-watch-bar').classList.contains('active'));
});

test('zero fan-out and zero hotspot scores do not produce a nonzero ranking bar', async t => {
  const { page } = await workspace(t);
  await statsRoute(page, () => snapshot());
  await page.route('**/api/v1/metrics/coupling?**', route => route.fulfill({ json:
    [{ classQualifiedName: 'demo.Isolated', fanOut: 0, fanIn: 0, instability: 0 }] }));
  await page.route('**/api/v1/metrics/hotspots?**', route => route.fulfill({ json:
    [{ filePath: 'demo/Unchanged.java', hotspotScore: 0, churnCount: 0, avgComplexity: 1 }] }));
  await load(page);
  await page.locator('#coupling-section .dist-bar').waitFor({ state: 'attached' });
  await page.locator('#hotspots-section .dist-bar').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#coupling-section .dist-bar').evaluate(el => el.style.width), '0%');
  assert.equal(await page.locator('#hotspots-section .dist-bar').evaluate(el => el.style.width), '0%');
});

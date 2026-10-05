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
const cases = [
  { id: 'S01', description: 'DEMO order controller entry point', rank: 1, topScore: .872, hitScore: .872,
    hit1: true, hit3: true, hit5: true, hit10: true, topResult: 'demo.orders.OrderController#findOrders(String)' },
  { id: 'S02', description: 'DEMO export validation', rank: 7, topScore: .711, hitScore: 0,
    hit1: false, hit3: false, hit5: false, hit10: true, topResult: 'demo.orders.ExportService#export(String)' },
  { id: 'S03', description: 'DEMO compensation after transaction failure', rank: 0, topScore: .456, hitScore: 0,
    hit1: false, hit3: false, hit5: false, hit10: false, topResult: 'demo.orders.OrderRepository#findByCustomerId(String)' },
];
function snapshot(label = 'Demo Order Service [d3e000000001]') {
  return { projectLabel: label, generatedAt: '2026-10-05 14:20:00',
    semantic: { title: 'SEMANTIC SEARCH', total: 3, threshold: .7, hit1Rate: 1/3, hit3Rate: 1/3,
      hit5Rate: 1/3, hit10Rate: 2/3, mrr10: (1 + 1/7)/3, passed: false, cases: structuredClone(cases) },
    code: { title: 'CODE SEARCH', total: 1, threshold: .6, hit1Rate: 1, hit3Rate: 1,
      hit5Rate: 1, hit10Rate: 1, mrr10: 1, passed: true, cases: [{ ...cases[0], id: 'C01' }] } };
}
async function workspace(t, options = {}) {
  const { response = snapshot(), viewport = { width: 1440, height: 1000 } } = options;
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  let calls = 0;
  await page.route('**/api/v1/benchmark/results', async route => {
    const result = typeof response === 'function' ? await response(++calls) : response;
    await route.fulfill(result.body !== undefined ? result : { json: result });
  });
  await page.addInitScript(() => localStorage.setItem('repograph_lang', 'en'));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(fixture.unhandledRequests, [], 'All API requests use intentional fixtures');
  });
  await page.goto(new URL('#benchmark', baseUrl).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#panel-benchmark.active'));
  return { page, fixture };
}

test('source project and original timestamp survive periodic language application and global project changes', async t => {
  const { page } = await workspace(t);
  assert.match(await page.locator('#bm-run-meta').innerText(), /Demo Order Service/);
  await page.evaluate(() => { applyLang(); applyLang(); setGlobalProject('d3e000000002'); });
  assert.match(await page.locator('#bm-run-meta').innerText(), /Demo Order Service/);
  assert.match(await page.locator('#bm-run-meta').innerText(), /2026-10-05 14:20:00/);
  assert.match(await page.locator('#panel-benchmark').innerText(), /independent of the active project/);
});

test('summary uses source metrics and the Hit@10 gate while query details preserve a real zero score', async t => {
  const { page } = await workspace(t);
  const semantic = page.locator('#bm-section-semantic');
  assert.match(await semantic.locator('.bm-overview').innerText(), /66\.7%/);
  assert.match(await semantic.locator('.bm-threshold').innerText(), /Hit@10.*70\.0%/);
  assert.match(await semantic.locator('.bm-mrr').innerText(), /0\.381/);
  const zero = page.locator('#bm-case-semantic-1');
  await zero.locator('summary').focus();
  await zero.locator('summary').press('Enter');
  assert.equal(await zero.evaluate(el => el.open), true);
  assert.equal(await zero.locator('[data-metric="hitScore"]').innerText(), '0.000');
  const miss = page.locator('#bm-case-semantic-2');
  await miss.locator('summary').click();
  assert.equal(await miss.locator('[data-metric="hitScore"]').innerText(), '—');
  assert.match(await miss.innerText(), /OrderRepository#findByCustomerId/);
});

test('native miss filtering and language changes retain expanded details, focus and selected filter', async t => {
  const { page } = await workspace(t);
  const filter = page.locator('#bm-semantic-misses');
  await filter.focus();
  await filter.press('Space');
  assert.equal(await filter.isChecked(), true);
  assert.equal(await page.locator('#bm-section-semantic .bm-case').count(), 1);
  const detail = page.locator('#bm-case-semantic-2');
  await detail.locator('summary').click();
  await page.evaluate(() => { applyLang(); applyLang(); });
  assert.equal(await detail.evaluate(el => el.open), true);
  assert.equal(await detail.locator('summary').evaluate(el => el === document.activeElement), true);
  await page.evaluate(() => { currentLang = 'zh'; applyLang(); });
  assert.equal(await page.locator('#bm-semantic-misses').isChecked(), true);
  assert.equal(await page.locator('#bm-case-semantic-2').evaluate(el => el.open), true);
  assert.equal(await page.locator('#bm-case-semantic-2 summary').evaluate(el => el === document.activeElement), true);
});

test('empty 404 response has a recoverable read action and never launches a benchmark', async t => {
  const { page } = await workspace(t, { response: { status: 404, body: '' } });
  assert.match(await page.locator('#bm-body').innerText(), /No results yet/);
  assert.equal(await page.locator('.bm-section').count(), 0);
  let writes = 0;
  page.on('request', request => { if (request.method() !== 'GET') writes++; });
  await page.route('**/api/v1/benchmark/results', route => route.fulfill({ json: snapshot() }));
  await page.locator('#bm-retry').click();
  await page.locator('#bm-section-semantic').waitFor();
  assert.equal(writes, 0);
});

test('refresh failures preserve the last snapshot and server detail, retry recovers, and later 404 removes stale data', async t => {
  const { page } = await workspace(t);
  let response = { status: 503, body: JSON.stringify({ error: 'DEMO_BENCHMARK_OFFLINE' }), contentType: 'application/json' };
  await page.route('**/api/v1/benchmark/results', route => route.fulfill(response));
  await page.locator('#bm-refresh').click();
  await page.waitForFunction(() => document.querySelector('#bm-status').textContent.includes('DEMO_BENCHMARK_OFFLINE'));
  assert.equal(await page.locator('#bm-section-semantic').count(), 1);
  assert.match(await page.locator('#bm-status').innerText(), /previous snapshot/);
  response = { json: snapshot('Recovered corpus') };
  await page.locator('#bm-retry').click();
  await page.waitForFunction(() => document.querySelector('#bm-run-meta').textContent.includes('Recovered corpus'));
  response = { status: 404, body: '' };
  await page.locator('#bm-refresh').click();
  await page.waitForFunction(() => !document.querySelector('#bm-section-semantic'));
  assert.doesNotMatch(await page.locator('#bm-run-meta').innerText(), /Recovered corpus/);
});

test('latest refresh wins over an older success or failure and loading is exposed accessibly', async t => {
  const { page } = await workspace(t);
  let calls = 0;
  await page.route('**/api/v1/benchmark/results', async route => {
    const first = ++calls === 1;
    if (first) await delay(300);
    await route.fulfill(first ? { status: 503, json: { error: 'OLDER_READ_FAILED' } } : { json: snapshot('Newest corpus') });
  });
  await page.evaluate(() => { loadBenchmark(); });
  assert.equal(await page.locator('#bm-body').getAttribute('aria-busy'), 'true');
  await page.evaluate(() => { loadBenchmark(); });
  await page.waitForFunction(() => document.querySelector('#bm-run-meta').textContent.includes('Newest corpus'));
  await delay(350);
  assert.doesNotMatch(await page.locator('#bm-status').innerText(), /OLDER_READ_FAILED/);
  assert.equal(await page.locator('#bm-body').getAttribute('aria-busy'), 'false');
});

test('invalid snapshot shape is an error, while zero queries and missing sections never fabricate evaluation results', async t => {
  const { page } = await workspace(t, { response: { projectLabel: 'broken', semantic: { mrr10: null } } });
  assert.match(await page.locator('#bm-body').innerText(), /Invalid benchmark/);
  assert.equal(await page.locator('.bm-section').count(), 0);
  const zero = snapshot();
  zero.semantic = { ...zero.semantic, total: 0, cases: [], hit1Rate: 0, hit3Rate: 0, hit5Rate: 0, hit10Rate: 0, mrr10: 0, passed: false };
  zero.code = null;
  await page.route('**/api/v1/benchmark/results', route => route.fulfill({ json: zero }));
  await page.locator('#bm-retry').click();
  await page.locator('#bm-section-semantic').waitFor();
  assert.match(await page.locator('#bm-section-semantic').innerText(), /No queries/);
  assert.match(await page.locator('#bm-section-code').innerText(), /Not provided/);
  assert.doesNotMatch(await page.locator('#bm-section-code').innerText(), /0\.0%/);
});

test('390px long metadata and expanded query evidence wrap without horizontal overflow', async t => {
  const data = snapshot('Demo corpus ' + 'long-project-name'.repeat(10));
  data.semantic.cases[0].description = 'DEMO ' + 'long readable description '.repeat(10);
  data.semantic.cases[0].topResult = 'demo.' + 'LongQualifiedName'.repeat(18) + '#handle(String)';
  const { page } = await workspace(t, { response: data, viewport: { width: 390, height: 844 } });
  await page.locator('#bm-case-semantic-0 summary').click();
  const dimensions = await page.locator('#bm-body').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.client + 1, JSON.stringify(dimensions));
  assert.equal(await page.locator('#bm-case-semantic-0').evaluate(el => el.open), true);
  await page.screenshot({ path: '/tmp/repograph-benchmark-mobile.png', fullPage: true });
});

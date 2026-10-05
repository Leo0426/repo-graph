'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const installFixtures = require('./fixtures.cjs');
const baseUrl = process.env.UI_BASE_URL;
if (!baseUrl) throw new Error('Set UI_BASE_URL to a running RepoGraph view server.');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' }); });
after(async () => { await browser?.close(); });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const health = (overrides = {}) => ({ projectId: 'd3e000000001', projectRoot: '/demo/Order Service', generatedAt: '2026-10-04T02:00:00Z',
  healthScore: 84, totalUnits: 120, totalFiles: 20, totalEdges: 180, vulnCritical: 0, vulnHigh: 0, vulnMedium: 0, vulnLow: 0,
  packageCycles: 0, highComplexityMethods: 0, highInstabilityClasses: 0, deadCodeCount: 0, testGapCount: 0, totalProductionMethods: 100,
  topComplexMethods: [], topInstableCouplings: [], packageCycleList: [], ...overrides });
const review = (projectId, text) => ({ projectId, status: 'COMPLETED', methodology: 'ForgeFlow U1–U8', model: 'demo-disabled',
  generatedAt: '2026-10-04T02:00:00Z', observations: [text], candidates: [], missingInfo: [], evidence: [] });
async function workbench(t, configure, viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.addInitScript(() => localStorage.setItem('repograph_lang', 'zh'));
  await page.route('**/api/v1/metrics/report?*', route => json(route, health({ projectId: new URL(route.request().url()).searchParams.get('projectId') })));
  if (configure) await configure(page, fixture);
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); assert.deepEqual(fixture.unhandledRequests, []); });
  await page.goto(new URL('#metrics', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#metrics-project-select').options.length === 3);
  return { page, fixture };
}
async function frames(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

test('zero coupling has zero visual bar width', async t => {
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/metrics/coupling?*', route => json(route, [
      { classQualifiedName: 'demo.Zero', fanIn: 0, fanOut: 0, instability: 0 },
      { classQualifiedName: 'demo.Active', fanIn: 2, fanOut: 8, instability: 0.8 },
    ]));
  });
  await page.locator('#metrics-project-select').selectOption('d3e000000001');
  await page.locator('.metrics-tab[data-tab="coupling"]').click();
  await page.locator('#metrics-tab-content .dist-bar').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('#metrics-tab-content .dist-bar').first().evaluate(el => el.getBoundingClientRect().width), 0);
});

test('a previous fallback review cannot overwrite a new project', async t => {
  const gate = deferred(), started = deferred(), delivered = deferred();
  t.after(() => gate.resolve());
  const { page } = await workbench(t, async page => {
    await page.addInitScript(() => { window.EventSource = undefined; });
    await page.route('**/api/v1/architecture/reviews?*', async route => {
      const projectId = new URL(route.request().url()).searchParams.get('projectId');
      if (projectId === 'd3e000000001') {
        started.resolve(); await gate.promise;
        await json(route, review(projectId, 'STALE REVIEW')); delivered.resolve();
      } else await json(route, review(projectId, 'CURRENT REVIEW'));
    });
  });
  await page.locator('#metrics-project-select').selectOption('d3e000000001');
  await page.locator('#architecture-review-btn').click(); await started.promise;
  await page.locator('#metrics-project-select').selectOption('d3e000000002');
  await page.locator('#architecture-review-btn').click();
  await page.locator('#architecture-review-result').getByText('CURRENT REVIEW', { exact: true }).waitFor();
  gate.resolve(); await delivered.promise; await frames(page);
  assert.equal(await page.locator('#architecture-review-result').getByText('STALE REVIEW', { exact: true }).count(), 0);
});

test('zero production methods retain counts without inventing coverage or a healthy grade', async t => {
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/metrics/report?*', route => json(route, health({ healthScore: 100, totalUnits: 0, totalFiles: 0, totalEdges: 0, totalProductionMethods: 0 })));
  });
  await page.locator('#metrics-project-select').selectOption('d3e000000001');
  await page.locator('.metrics-no-methods').waitFor();
  assert.equal(await page.locator('.metrics-score').getAttribute('data-tone'), 'unknown');
  assert.equal(await page.locator('[data-dimension="testgap"] strong').textContent(), '0');
  assert.equal(await page.locator('[data-dimension="testgap"] small').textContent(), '—');
  assert.equal(await page.locator('[data-dimension="deadcode"] small').textContent(), '—');
  assert.equal((await page.locator('#metrics-health').textContent()).includes('0%'), false);
});

test('failed facts and details show service errors and retry independently', async t => {
  let reports = 0, rows = 0;
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/metrics/report?*', route => ++reports === 1 ? json(route, { error: 'REPORT UNAVAILABLE' }, 503) : json(route, health()));
    await page.route('**/api/v1/metrics/complexity?*', route => ++rows === 1 ? json(route, { error: 'DETAILS UNAVAILABLE' }, 503) : json(route, [{ qualifiedName: 'demo.Recovered#method()', filePath: 'src/Recovered.java', startLine: 7, complexity: 8 }]));
  });
  await page.locator('#metrics-project-select').selectOption('d3e000000001');
  await page.locator('#metrics-health').getByText('REPORT UNAVAILABLE', { exact: true }).waitFor();
  await page.locator('#metrics-tab-content').getByText('DETAILS UNAVAILABLE', { exact: true }).waitFor();
  await page.locator('#metrics-health button').click();
  await page.locator('.metrics-score').waitFor();
  assert.equal(await page.locator('#metrics-tab-content').getByText('DETAILS UNAVAILABLE', { exact: true }).count(), 1);
  await page.locator('#metrics-tab-content button').click();
  await page.getByText('demo.Recovered#method()', { exact: true }).waitFor();
  assert.equal(await page.locator('#metrics-health').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('#metrics-tab-content').getAttribute('aria-busy'), 'false');
});

test('late facts and details cannot replace a new tab or cleared project', async t => {
  const reportGate = deferred(), rowsGate = deferred(), reportStarted = deferred(), rowsStarted = deferred();
  t.after(() => { reportGate.resolve(); rowsGate.resolve(); });
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/metrics/report?*', async route => {
      reportStarted.resolve(); await reportGate.promise; await json(route, health());
    });
    await page.route('**/api/v1/metrics/complexity?*', async route => {
      rowsStarted.resolve(); await rowsGate.promise;
      await json(route, [{ qualifiedName: 'STALE DETAIL', complexity: 9 }]);
    });
    await page.route('**/api/v1/metrics/cycles?*', route => json(route, [{ packages: ['demo.current', 'demo.cycle'] }]));
  });
  await page.locator('#metrics-project-select').selectOption('d3e000000001');
  await Promise.all([reportStarted.promise, rowsStarted.promise]);
  await page.locator('.metrics-tab[data-tab="cycles"]').click();
  await page.getByText('demo.current', { exact: true }).waitFor();
  const rowsReceived = page.waitForResponse(response => response.url().includes('/metrics/complexity'));
  rowsGate.resolve(); await rowsReceived; await frames(page);
  assert.equal(await page.getByText('demo.current', { exact: true }).count(), 1);
  assert.equal(await page.getByText('STALE DETAIL', { exact: true }).count(), 0);
  await page.locator('#metrics-project-select').selectOption('');
  const reportReceived = page.waitForResponse(response => response.url().includes('/metrics/report'));
  reportGate.resolve(); await reportReceived; await frames(page);
  assert.equal(await page.locator('.metrics-score').count(), 0);
  assert.equal(await page.locator('#metrics-tab-content').textContent(), '');
  assert.equal(await page.locator('#architecture-review-btn').isDisabled(), true);
});

async function fakeStreams(page) {
  await page.addInitScript(() => {
    window.testStreams = [];
    window.EventSource = class {
      constructor(url) { this.url = url; this.listeners = {}; this.closed = false; window.testStreams.push(this); }
      addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
      close() { this.closed = true; }
      emit(name, value) { for (const callback of this.listeners[name] || []) callback({ data: typeof value === 'string' ? value : JSON.stringify(value) }); }
    };
  });
}
async function emit(page, name, data, index = -1) { await page.evaluate(({ name, data, index }) => window.testStreams.at(index).emit(name, data), { name, data, index }); }

test('public model output stays collapsed by default and final result survives queued and late deltas', async t => {
  const { page } = await workbench(t, fakeStreams);
  await page.locator('#metrics-project-select').selectOption('d3e000000001');
  await page.locator('#architecture-review-btn').click();
  assert.equal(await page.locator('#architecture-review-btn').isDisabled(), true);
  await emit(page, 'phase', { phase: 'generation' });
  await emit(page, 'delta', 'PUBLIC OUTPUT'); await frames(page);
  const details = page.locator('.architecture-stream-console details');
  assert.equal(await details.evaluate(element => element.open), false);
  await details.locator('summary').focus(); await page.keyboard.press('Enter');
  assert.equal(await details.evaluate(element => element.open), true);
  await emit(page, 'delta', ' CONTINUED'); await frames(page);
  await page.evaluate(() => Alpine.store('repograph').setLang('en'));
  assert.equal(await details.evaluate(element => element.open), true);
  assert.equal(await details.locator('pre').textContent(), 'PUBLIC OUTPUT CONTINUED');
  await page.evaluate(final => {
    const stream = window.testStreams.at(-1);
    stream.emit('delta', ' QUEUED');
    stream.emit('result', final);
    stream.emit('delta', ' LATE');
    stream.emit('complete', {});
    stream.onerror();
  }, review('d3e000000001', 'FINAL REVIEW'));
  await frames(page);
  assert.equal(await page.locator('#architecture-review-result').getByText('FINAL REVIEW', { exact: true }).count(), 1);
  assert.equal(await page.locator('.architecture-stream-console').count(), 0);
  assert.equal(await page.locator('#architecture-review-status').textContent(), 'Review completed');
  assert.equal(await page.locator('#architecture-review-btn').isDisabled(), false);
});

test('old stream events and finally state cannot replace a newly started project review', async t => {
  const { page } = await workbench(t, fakeStreams);
  await page.locator('#metrics-project-select').selectOption('d3e000000001');
  await page.locator('#architecture-review-btn').click();
  await page.locator('#metrics-project-select').selectOption('d3e000000002');
  await page.locator('#architecture-review-btn').click();
  await emit(page, 'result', review('d3e000000001', 'OLD RESULT'), 0);
  await emit(page, 'complete', {}, 0);
  assert.equal(await page.locator('#architecture-review-btn').isDisabled(), true);
  assert.equal(await page.locator('#architecture-review-result').getByText('OLD RESULT', { exact: true }).count(), 0);
  await emit(page, 'result', review('d3e000000002', 'CURRENT STREAM RESULT'));
  await emit(page, 'complete', {});
  await page.getByText('CURRENT STREAM RESULT', { exact: true }).waitFor();
  assert.equal(await page.locator('#architecture-review-btn').isDisabled(), false);
});

test('model stream errors preserve the service message and permit retry without an empty success', async t => {
  const { page } = await workbench(t, fakeStreams);
  await page.locator('#metrics-project-select').selectOption('d3e000000001');
  await page.locator('#architecture-review-btn').click();
  await emit(page, 'stream-error', { message: 'MODEL UNAVAILABLE' });
  await page.evaluate(() => window.testStreams.at(-1).onerror());
  await page.getByText('MODEL UNAVAILABLE', { exact: true }).waitFor();
  assert.equal(await page.locator('#architecture-review-btn').isDisabled(), false);
  await page.locator('#architecture-review-btn').click();
  await emit(page, 'complete', {});
  assert.equal(await page.locator('.architecture-review-error').count(), 1);
  assert.equal(await page.locator('#architecture-review-status').textContent(), '模型评审失败');
  await page.locator('#architecture-review-btn').click();
  await emit(page, 'result', '{invalid json');
  assert.equal(await page.locator('.architecture-review-error').count(), 1);
  assert.equal(await page.locator('#architecture-review-btn').isDisabled(), false);
});

test('disabled and failed model DTOs keep their actual state and missing evidence', async t => {
  let requests = 0;
  const { page } = await workbench(t, async page => {
    await page.addInitScript(() => { window.EventSource = undefined; });
    await page.route('**/api/v1/architecture/reviews?*', route => json(route, { ...review('d3e000000001', 'STATIC FACTS ONLY'), status: ++requests === 1 ? 'DISABLED' : 'FAILED', missingInfo: ['MODEL EVIDENCE MISSING'] }));
  });
  await page.locator('#metrics-project-select').selectOption('d3e000000001');
  await page.locator('#architecture-review-btn').click();
  await page.locator('.architecture-review-meta .disabled').waitFor();
  await page.locator('.architecture-missing summary').click();
  await page.getByText('MODEL EVIDENCE MISSING', { exact: true }).waitFor();
  await page.locator('#architecture-review-btn').click();
  await page.locator('.architecture-review-meta .failed').waitFor();
  assert.equal(await page.locator('#architecture-review-result').getByText('STATIC FACTS ONLY', { exact: true }).count(), 1);
});

test('390px keyboard navigation preserves full locations and unordered cycle members in both languages', async t => {
  const longName = 'demo.orders.extremely.long.package.location.'.repeat(3) + 'OrderService#calculate()';
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/metrics/complexity?*', route => json(route, [{ qualifiedName: longName, filePath: 'src/main/java/' + 'long-directory/'.repeat(8) + 'OrderService.java', startLine: 42, complexity: 18 }]));
    await page.route('**/api/v1/metrics/cycles?*', route => json(route, [{ packages: ['demo.zeta', 'demo.alpha', 'demo.middle'] }]));
  }, { width: 390, height: 844 });
  await page.locator('#metrics-project-select').selectOption('d3e000000001');
  await page.getByText(longName, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('.metrics-tab[data-tab="cycles"]').focus(); await page.keyboard.press('Space');
  await page.locator('.metrics-cycle').waitFor();
  assert.equal(await page.locator('.metrics-tab[data-tab="cycles"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.locator('.metrics-cycle li').allTextContents(), ['demo.zeta', 'demo.alpha', 'demo.middle']);
  assert.equal((await page.locator('.metrics-cycle').textContent()).includes('→'), false);
  assert.equal(await page.locator('#ctrl-complexity').isVisible(), false);
  await page.evaluate(() => Alpine.store('repograph').setLang('en'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#metrics-detail-count').textContent(), 'Currently showing 1');
  await page.locator('#architecture-review-btn').scrollIntoViewIfNeeded();
  assert.ok((await page.locator('.architecture-review-module').boundingBox()).height >= 150, 'model advice remains readable inside the scrolling panel');
  assert.equal(await page.locator('#architecture-review-btn').isVisible(), true);
});

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
const complete = (overrides = {}) => ({ status: 'done', totalFiles: 20, parsedFiles: 20, totalUnits: 120,
  totalEdges: 180, durationMs: 2400, errors: [], ...overrides });
async function workbench(t, configure, options = {}) {
  const page = await browser.newPage({ viewport: options.viewport || { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.addInitScript(root => {
    localStorage.setItem('repograph_lang', 'zh');
    if (root) localStorage.setItem('repograph_index_root', root);
  }, options.savedRoot || '');
  if (configure) await configure(page, fixture);
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(fixture.unhandledRequests, [], 'All APIs use intentional fixtures');
  });
  await page.goto(new URL('#index', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.locator('#index-root').waitFor();
  return { page, fixture };
}
async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('a delayed status response cannot overwrite a newly selected index directory', async t => {
  const gate = deferred(), started = deferred(), delivered = deferred();
  t.after(() => gate.resolve());
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/index/project/status?*', async route => {
      const root = new URL(route.request().url()).searchParams.get('projectRoot');
      if (root === '/demo/old') {
        started.resolve(); await gate.promise;
        await json(route, complete({ totalUnits: 999 })); delivered.resolve();
      } else await json(route, complete({ totalUnits: 42 }));
    });
  });
  await page.locator('#index-root').fill('/demo/old');
  await page.locator('#status-btn').click(); await started.promise;
  await page.locator('#index-root').fill('/demo/current');
  await page.locator('#status-btn').click();
  await page.waitForFunction(() => document.getElementById('stat-units').textContent === '42');
  gate.resolve(); await delivered.promise; await frames(page);
  assert.equal(await page.locator('#stat-units').textContent(), '42');
});

test('a running query blocks duplicate submission and displays the actual stage percentage', async t => {
  let starts = 0;
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/index/project/status?*', route => json(route,
      { status: 'running', stage: 'embedding', done: 25, total: 100, pct: 25 }));
    await page.route('**/api/v1/index/project?*', route => { starts++; return json(route, { status: 'running' }, 202); });
  });
  await page.locator('#index-root').fill('/demo/running');
  await page.locator('#status-btn').click();
  await page.waitForFunction(() => document.getElementById('index-state-card').dataset.state === 'running');
  assert.equal(await page.locator('#index-btn').isEnabled(), false);
  assert.equal(await page.locator('#ring-pct').textContent(), '25%');
  assert.equal(await page.locator('#index-stage-progress').getAttribute('value'), '25');
  assert.equal(await page.locator('#index-stage-count').textContent(), '25 / 100');
  await page.locator('#index-root').fill('/demo/other');
  assert.equal(await page.locator('#index-btn').isEnabled(), true);
  await page.locator('#index-root').fill('/demo/running');
  assert.equal(await page.locator('#index-btn').isEnabled(), false);
  assert.equal(starts, 0);
});

test('submission uses native keyboard settings, prevents repeat starts, and waits for a terminal result', async t => {
  const gate = deferred(), started = deferred();
  let requests = 0, submitted;
  t.after(() => gate.resolve());
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/index/project?*', async route => {
      requests++; submitted = new URL(route.request().url()).searchParams;
      started.resolve(); await gate.promise;
      await json(route, { status: 'running', message: 'Accepted' }, 202);
    });
    await page.route('**/api/v1/index/project/status?*', route => json(route, complete()));
  });
  await page.locator('#index-root').fill('/demo/new');
  await page.locator('#no-incremental').press('Space');
  await page.locator('#lang-java').uncheck();
  await page.locator('#lang-py').check();
  await page.locator('#index-strategy').selectOption('heuristic');
  await page.locator('#index-btn').click(); await started.promise;
  assert.equal(await page.locator('#index-state-card').getAttribute('data-state'), 'submitting');
  assert.equal(await page.locator('#index-btn').isEnabled(), false);
  await page.locator('#index-root').fill('/demo/other');
  await page.locator('#index-root').fill('/demo/new');
  assert.equal(await page.locator('#index-btn').isEnabled(), false);
  gate.resolve();
  await page.waitForFunction(() => !document.getElementById('status-btn').disabled);
  await page.locator('#status-btn').click();
  await page.waitForFunction(() => document.getElementById('index-state-card').dataset.state === 'done');
  assert.equal(requests, 1);
  assert.equal(submitted.get('lang'), 'python');
  assert.equal(submitted.get('strategy'), 'heuristic');
  assert.equal(submitted.get('noIncremental'), 'true');
  assert.equal(await page.locator('#stat-units').textContent(), '120');
  assert.equal(await page.locator('#index-btn').isEnabled(), true);
});

test('saved partial history restores its timestamp, real counts and recoverable errors', async t => {
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/index/project/status?*', route => json(route, complete({ status: 'partial', parsedFiles: 18,
      indexedAt: '2026-10-04T23:00:00Z', errors: ['Embedding failed for Demo.java', 'Parse failed for Other.java'] })));
  }, { savedRoot: '/demo/history' });
  await page.waitForFunction(() => document.getElementById('index-state-card').dataset.state === 'partial');
  assert.equal(await page.locator('#stat-parsed').textContent(), '18');
  assert.equal(await page.locator('#stat-errors').textContent(), '2');
  assert.equal(await page.locator('#stat-indexed-at-row').isVisible(), true);
  await page.locator('#index-errors-panel > summary').press('Enter');
  assert.equal(await page.locator('#index-errors li').count(), 2);
  assert.ok((await page.locator('#index-log').textContent()).includes('Embedding failed'));
  assert.equal(await page.locator('#index-progress').isVisible(), false);
  assert.equal(await page.locator('#index-btn').isEnabled(), true);
});

test('status polling is serialized and connection failures retain last facts until explicit retry', async t => {
  const gate = deferred(), started = deferred();
  let requests = 0;
  t.after(() => gate.resolve());
  const { page } = await workbench(t, async page => {
    await page.clock.install();
    await page.route('**/api/v1/index/project/status?*', async route => {
      requests++;
      if (requests === 1) return json(route, { status: 'running', stage: 'parsing', done: 3, total: 10, pct: 30 });
      if (requests === 2) { started.resolve(); await gate.promise; return json(route, { message: 'Status offline' }, 503); }
      return json(route, complete());
    });
  });
  await page.locator('#index-root').fill('/demo/poll');
  await page.locator('#status-btn').click();
  await page.waitForFunction(() => document.getElementById('ring-pct').textContent === '30%');
  await page.clock.runFor(3100); await started.promise;
  await page.clock.runFor(9000);
  assert.equal(requests, 2, 'No overlapping polls while a request is pending');
  gate.resolve();
  await page.waitForFunction(() => document.getElementById('index-state-card').dataset.state === 'connection');
  assert.ok((await page.locator('#index-connection-error').textContent()).includes('Status offline'));
  assert.equal(await page.locator('#index-btn').isEnabled(), false);
  await page.clock.runFor(9000);
  assert.equal(requests, 2, 'Connection failures wait for an explicit retry');
  await page.locator('#index-retry-status').click();
  await page.waitForFunction(() => document.getElementById('index-state-card').dataset.state === 'done');
  assert.equal(await page.locator('#index-btn').isEnabled(), true);
});

test('HTTP conflict resumes monitoring while rejected submission and fatal state remain failures', async t => {
  let attempts = 0;
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/index/project?*', route => ++attempts === 1
      ? json(route, { status: 'error', message: 'EXECUTOR_REJECTED' }, 503)
      : json(route, { status: 'running', message: 'Already running' }, 409));
    await page.route('**/api/v1/index/project/status?*', route => json(route, { status: 'error: PROCESS_RESTARTED' }));
  });
  await page.locator('#index-root').fill('/demo/retry');
  await page.locator('#index-btn').click();
  await page.waitForFunction(() => document.getElementById('index-state-card').dataset.state === 'error');
  assert.ok((await page.locator('#index-connection-error').textContent()).includes('EXECUTOR_REJECTED'));
  assert.equal(await page.locator('#index-btn').isEnabled(), true);
  await page.locator('#index-btn').click();
  await page.waitForFunction(() => document.getElementById('index-connection-error').textContent.includes('PROCESS_RESTARTED'));
  assert.equal(await page.locator('#index-state-card').getAttribute('data-state'), 'error');
  assert.equal(await page.locator('#index-btn').isEnabled(), true);
  assert.equal(await page.locator('#stat-errors').textContent(), '—', 'No invented error count without an errors array');
});

test('empty input is validated inline and 390px execution remains usable in both languages', async t => {
  const { page, fixture } = await workbench(t, async page => {
    await page.route('**/api/v1/index/project/status?*', route => json(route, complete({ status: 'partial',
      errors: ['Embedding failure: /demo/'.repeat(18) + 'VeryLongSource.java'] })));
  }, { viewport: { width: 390, height: 844 } });
  await page.locator('#index-btn').click();
  assert.equal(await page.locator('#index-root').getAttribute('aria-invalid'), 'true');
  assert.equal(fixture.requested.some(request => request.startsWith('POST /api/v1/index')), false);
  await page.locator('#index-root').fill('/demo/'.repeat(25) + 'Project');
  await page.locator('#status-btn').click();
  await page.waitForFunction(() => document.getElementById('index-state-card').dataset.state === 'partial');
  await page.locator('.index-heading > button').click();
  assert.equal(await page.locator('#index-configuration').evaluate(el => el.open), false);
  await page.locator('#index-errors-panel > summary').click();
  for (const language of ['zh', 'en']) {
    await page.evaluate(lang => Alpine.store('repograph').setLang(lang), language);
    await frames(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#index-errors-panel').evaluate(el => el.open), true);
  }
});

test('unchanged polling does not duplicate logs and language refresh preserves reading position', async t => {
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/index/project/status?*', route => json(route, complete({ status: 'partial',
      errors: Array.from({ length: 24 }, (_, i) => `Sample failure ${i} in /demo/Source.java`) })));
  });
  await page.locator('#index-root').fill('/demo/log');
  await page.locator('#status-btn').click();
  await page.waitForFunction(() => document.getElementById('index-state-card').dataset.state === 'partial');
  const count = await page.locator('#index-log > div').count();
  await page.locator('#index-log').evaluate(el => { el.scrollTop = 0; });
  await page.locator('#status-btn').click();
  await page.waitForFunction(() => !document.getElementById('status-btn').disabled);
  assert.equal(await page.locator('#index-log > div').count(), count);
  await page.evaluate(() => Alpine.store('repograph').setLang('en'));
  assert.equal(await page.locator('#index-log').evaluate(el => el.scrollTop), 0);
});

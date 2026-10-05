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
async function workbench(t, configure, viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.addInitScript(() => localStorage.setItem('repograph_lang', 'zh'));
  if (configure) await configure(page, fixture);
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(fixture.unhandledRequests, [], 'All APIs use intentional fixtures');
  });
  await page.goto(new URL('#symbol', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.locator('#symbol-qn-input').waitFor();
  return { page, fixture };
}
async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('editing a symbol query rejects the older in-flight response', async t => {
  const gate = deferred(), started = deferred(), delivered = deferred();
  t.after(() => gate.resolve());
  const { page } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/symbol/**', async route => {
      started.resolve(); await gate.promise;
      await json(route, { ...fixture.units[0], qualifiedName: 'OLD_QUERY', simpleName: 'OLD_QUERY' });
      delivered.resolve();
    });
  });
  await page.locator('#symbol-qn-input').fill('OLD_QUERY');
  await page.locator('#symbol-qn-input').press('Enter'); await started.promise;
  await page.locator('#symbol-qn-input').fill('CURRENT_QUERY');
  gate.resolve(); await delivered.promise; await frames(page);
  assert.equal(await page.locator('#symbol-result').getByText('OLD_QUERY', { exact: true }).count(), 0);
});

test('locate accepts only positive Java-int line numbers and submits from the file field', async t => {
  const requests = [];
  const { page } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/locate?*', route => {
      requests.push(new URL(route.request().url()));
      return json(route, fixture.units[0]);
    });
  });
  await page.locator('#symbol-tab-row [data-mode="locate"]').press('Enter');
  assert.equal(await page.locator('#symbol-tab-row [data-mode="locate"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#locate-file-input').fill('src/Demo.java');
  for (const line of ['', '0', '-1', '1.5', '1e2', '2147483648']) {
    await page.locator('#locate-line-input').fill(line);
    await page.locator('#locate-file-input').press('Enter');
    assert.equal(await page.locator('#locate-line-input').getAttribute('aria-invalid'), 'true', line);
  }
  assert.equal(requests.length, 0);
  await page.locator('#locate-line-input').fill('42');
  await page.locator('#locate-file-input').press('Enter');
  await page.locator('#locate-result .symbol-detail').waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('line'), '42');
  assert.equal(requests[0].searchParams.get('file'), 'src/Demo.java');
  assert.equal(requests[0].searchParams.has('projectId'), false);
});

test('composition Enter and repeated pending submissions do not issue duplicate lookups', async t => {
  const gate = deferred(), started = deferred();
  t.after(() => gate.resolve());
  let requests = 0;
  const { page } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/symbol/**', async route => {
      requests++; started.resolve(); await gate.promise; await json(route, fixture.units[0]);
    });
  });
  const input = page.locator('#symbol-qn-input');
  await input.fill('demo.Controller#find(String)');
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  assert.equal(requests, 0);
  await input.dispatchEvent('compositionend');
  await input.press('Enter'); await started.promise;
  assert.equal(await page.locator('#symbol-result').getAttribute('aria-busy'), 'true');
  await input.press('Enter');
  assert.equal(await page.locator('#symbol-lookup-btn').isEnabled(), false);
  assert.equal(requests, 1);
  gate.resolve();
  await page.locator('#symbol-result .symbol-detail').waitFor();
  assert.equal(await page.locator('#symbol-lookup-btn').isEnabled(), true);
});

test('empty-body 404, HTTP failure and successful retry have distinct states', async t => {
  let request = 0;
  const { page } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/symbol/**', route => {
      request++;
      if (request === 1) return route.fulfill({ status: 404, body: '' });
      if (request === 2) return json(route, { error: 'Vector service unavailable' }, 503);
      return json(route, fixture.units[0]);
    });
  });
  await page.locator('#symbol-qn-input').fill('missing');
  await page.locator('#symbol-qn-input').press('Enter');
  await page.waitForFunction(() => document.getElementById('symbol-result').dataset.state === 'not-found');
  assert.equal(await page.locator('#symbol-result .symbol-error').count(), 0);
  assert.equal(await page.locator('#symbol-query-status').textContent(), '未找到符号');
  await page.locator('#symbol-qn-input').fill('retry');
  await page.locator('#symbol-qn-input').press('Enter');
  await page.locator('#symbol-result .symbol-error').waitFor();
  assert.ok((await page.locator('#symbol-result').textContent()).includes('Vector service unavailable'));
  await page.locator('#symbol-result .symbol-error button').click();
  await page.locator('#symbol-result .symbol-detail').waitFor();
  assert.equal(await page.locator('#symbol-result').getAttribute('aria-busy'), 'false');
  assert.ok((await page.locator('#symbol-query-status').textContent()).includes('已找到符号'));
});

test('switching query mode invalidates an earlier result without losing drafts', async t => {
  const gate = deferred(), started = deferred(), delivered = deferred();
  t.after(() => gate.resolve());
  const { page } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/symbol/**', async route => {
      started.resolve(); await gate.promise;
      await json(route, { ...fixture.units[0], simpleName: 'OLD MODE' }); delivered.resolve();
    });
  });
  await page.locator('#symbol-qn-input').fill('saved.symbol');
  await page.locator('#symbol-qn-input').press('Enter'); await started.promise;
  await page.locator('#symbol-tab-row [data-mode="locate"]').click();
  gate.resolve(); await delivered.promise; await frames(page);
  assert.equal(await page.locator('#symbol-result').getByText('OLD MODE', { exact: true }).count(), 0);
  assert.equal(await page.locator('#locate-result').getAttribute('data-state'), 'ready');
  await page.locator('#symbol-tab-row [data-mode="lookup"]').click();
  assert.equal(await page.locator('#symbol-qn-input').inputValue(), 'saved.symbol');
  assert.equal(await page.locator('#symbol-result .symbol-detail').count(), 0);
});

test('lookup and graph navigation use the same captured active project', async t => {
  let lookupUrl;
  const { page, fixture } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/symbol/**', route => {
      lookupUrl = new URL(route.request().url()); return json(route, fixture.units[0]);
    });
  });
  await page.locator('#global-project').selectOption('d3e000000002');
  await page.locator('#symbol-qn-input').fill(fixture.units[0].qualifiedName);
  await page.locator('#symbol-qn-input').press('Enter');
  await page.locator('#symbol-result .symbol-detail').waitFor();
  assert.equal(lookupUrl.searchParams.get('projectId'), 'd3e000000002');
  const graph = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/graph/callers');
  await page.locator('.symbol-detail-heading > button').click();
  const graphUrl = new URL((await graph).url());
  assert.equal(graphUrl.searchParams.get('projectId'), 'd3e000000002');
  assert.equal(graphUrl.searchParams.get('target'), fixture.units[0].qualifiedName);
});

test('source is escaped, keyboard-expandable and copy reports the actual outcome', async t => {
  const source = '<script>window.untrustedExecuted=true</script>\nreturn "<User>";';
  const { page } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/symbol/**', route => json(route, { ...fixture.units[0], rawSource: source }));
  });
  await page.locator('#symbol-qn-input').fill('demo.symbol');
  await page.locator('#symbol-qn-input').press('Enter');
  await page.locator('.symbol-source > summary').press('Enter');
  assert.equal(await page.locator('.symbol-source pre code').textContent(), source);
  assert.equal(await page.evaluate(() => !!window.untrustedExecuted), false);
  await page.evaluate(() => { navigator.clipboard.writeText = async value => { window.copiedValue = value; }; });
  await page.locator('.symbol-source-toolbar button').click();
  await page.waitForFunction(() => document.querySelector('.symbol-copy-feedback').dataset.tone === 'success');
  assert.equal(await page.evaluate(() => window.copiedValue), source);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; });
  await page.locator('.symbol-detail-actions button').click();
  await page.waitForFunction(() => document.querySelector('.symbol-copy-feedback').dataset.tone === 'error');
  await page.evaluate(() => Alpine.store('repograph').setLang('en'));
  assert.equal(await page.locator('.symbol-source').evaluate(el => el.open), true);
  assert.equal(await page.locator('.symbol-copy-feedback').textContent(), 'Copy failed. Select and copy the content manually.');
});

test('long symbol, paths and source fit a 390px viewport in both languages', async t => {
  const { page } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/symbol/**', route => json(route, { ...fixture.units[0],
      simpleName: 'LongMethod'.repeat(16), qualifiedName: 'demo.long.namespace.'.repeat(20) + '#method(String)',
      filePath: 'src/long-directory/'.repeat(20) + 'Example.java', rawSource: 'return "' + 'long source '.repeat(40) + '";' }));
  }, { width: 390, height: 844 });
  await page.locator('#symbol-qn-input').fill('demo.long');
  await page.locator('#symbol-qn-input').press('Enter');
  await page.locator('.symbol-source > summary').click();
  for (const language of ['zh', 'en']) {
    await page.evaluate(language => Alpine.store('repograph').setLang(language), language);
    await frames(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.symbol-source pre').evaluate(el => el.scrollWidth > el.clientWidth), true, 'Only source scrolls horizontally');
  }
  await page.locator('#symbol-tab-row [data-mode="locate"]').click();
  await frames(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('changing project scope rejects an earlier response and updates locate requests', async t => {
  const gate = deferred(), started = deferred(), delivered = deferred();
  t.after(() => gate.resolve());
  const urls = [];
  const { page } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/locate?*', async route => {
      const url = new URL(route.request().url()); urls.push(url);
      if (url.searchParams.get('projectId') === 'd3e000000001') {
        started.resolve(); await gate.promise;
        await json(route, { ...fixture.units[0], simpleName: 'STALE PROJECT' }); delivered.resolve();
      } else await json(route, { ...fixture.units[0], simpleName: 'CURRENT PROJECT' });
    });
  });
  await page.locator('#global-project').selectOption('d3e000000001');
  await page.locator('#symbol-tab-row [data-mode="locate"]').click();
  await page.locator('#locate-file-input').fill('src/Example.java');
  await page.locator('#locate-line-input').fill('42');
  await page.locator('#symbol-locate-btn').click(); await started.promise;
  await page.locator('#global-project').selectOption('d3e000000002');
  await page.locator('#symbol-locate-btn').click();
  await page.locator('#locate-result h2').getByText('CURRENT PROJECT', { exact: true }).waitFor();
  gate.resolve(); await delivered.promise; await frames(page);
  assert.equal(await page.locator('#locate-result').getByText('STALE PROJECT', { exact: true }).count(), 0);
  assert.equal(urls[1].searchParams.get('projectId'), 'd3e000000002');
});

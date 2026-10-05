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

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
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
  await page.goto(new URL('#vulns', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#vuln-project-select').options.length === 3);
  return { page, fixture };
}
async function chooseProject(page, id = 'd3e000000001') {
  await page.locator('#vuln-project-select').selectOption(id);
}
async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('late project responses cannot replace current findings or refill an empty project', async t => {
  const old = deferred(), requested = deferred(), delivered = deferred();
  t.after(() => old.resolve());
  const { page } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/vulns?*', async route => {
      const projectId = new URL(route.request().url()).searchParams.get('projectId');
      if (projectId === 'd3e000000001') {
        requested.resolve(); await old.promise;
        await json(route, [{ ...fixture.vulnerabilities[0], title: 'STALE PROJECT' }]); delivered.resolve();
      } else await json(route, [{ ...fixture.vulnerabilities[1], projectId, title: 'CURRENT PROJECT' }]);
    });
  });
  await chooseProject(page);
  await requested.promise;
  await chooseProject(page, 'd3e000000002');
  await page.locator('#vuln-list').getByText('CURRENT PROJECT', { exact: true }).waitFor();
  old.resolve(); await delivered.promise; await frames(page);
  assert.equal(await page.locator('#vuln-list').getByText('STALE PROJECT', { exact: true }).count(), 0);
  await chooseProject(page, '');
  assert.equal(await page.locator('#vuln-report-btn').isEnabled(), false);
  assert.equal(await page.locator('#vuln-list').getByText('CURRENT PROJECT', { exact: true }).count(), 0);
});

test('filter summaries are scoped to displayed findings and details support keyboard activation', async t => {
  const { page, fixture } = await workbench(t);
  await chooseProject(page);
  await page.waitForFunction(() => document.querySelector('#vuln-result-count')?.textContent === '3');
  await page.locator('#vuln-filter-severity').selectOption('HIGH');
  await page.waitForFunction(() => document.querySelector('#vuln-result-count')?.textContent === '1');
  const finding = page.locator('.vuln-finding').first();
  await finding.locator(':scope > summary').press('Enter');
  assert.equal(await finding.evaluate(el => el.open), true);
  assert.ok(await finding.getByText('SQL_INJECTION_TAINT', { exact: true }).count() > 0);
  assert.equal(fixture.requested.some(request => request.startsWith('PUT ')), false, 'Browsing cannot change status');
  await page.locator('#vuln-filter-severity').selectOption('CRITICAL');
  await page.locator('#vuln-reset-filters').waitFor();
  assert.equal(await page.locator('#vuln-result-count').textContent(), '0');
  await page.locator('#vuln-reset-filters').click();
  await page.waitForFunction(() => document.querySelector('#vuln-result-count')?.textContent === '3');
});

test('closed and reopened evidence ignores the first delayed response', async t => {
  const first = deferred(), started = deferred(), delivered = deferred();
  t.after(() => first.resolve());
  let requests = 0;
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/vulns/*/taint-evidence', async route => {
      const old = ++requests === 1;
      if (old) { started.resolve(); await first.promise; }
      await json(route, [{ sequence: 1, role: 'SOURCE', methodQn: old ? 'STALE EVIDENCE' : 'CURRENT EVIDENCE',
        filePath: 'Example.java', startLine: 4, endLine: 4, fromSlot: 'request', toSlot: 'param:0', sourceExcerpt: 'return input;' }]);
      if (old) delivered.resolve();
    });
  });
  await chooseProject(page);
  const finding = page.locator('.vuln-finding').first();
  await finding.locator(':scope > summary').click(); await started.promise;
  await finding.locator(':scope > summary').click();
  await finding.locator(':scope > summary').click();
  await finding.getByText('CURRENT EVIDENCE', { exact: true }).waitFor();
  first.resolve(); await delivered.promise; await frames(page);
  assert.equal(await finding.getByText('STALE EVIDENCE', { exact: true }).count(), 0);
});

test('failed list and evidence requests show retry actions without inventing empty results', async t => {
  let lists = 0, evidence = 0;
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/vulns?*', async route => {
      if (++lists === 1) await json(route, { message: 'List unavailable' }, 503);
      else await route.fallback();
    });
    await page.route('**/api/v1/vulns/*/taint-evidence', async route => {
      if (++evidence === 1) await json(route, { message: 'Evidence unavailable' }, 503);
      else await route.fallback();
    });
  });
  await chooseProject(page);
  await page.locator('.vuln-error').waitFor();
  assert.equal(await page.locator('#vuln-result-count').textContent(), '—');
  await page.locator('.vuln-error button').click();
  const finding = page.locator('.vuln-finding').first();
  await finding.locator(':scope > summary').click();
  await finding.locator('.vuln-evidence-error').waitFor();
  await finding.locator('.vuln-evidence-error button').click();
  await finding.locator('.vuln-evidence-steps li').first().waitFor();
  assert.equal(await finding.locator('.vuln-evidence-steps li').count(), 3);
});

test('failed status and scan calls do not claim success or change the finding', async t => {
  const { page, fixture } = await workbench(t, async page => {
    await page.route('**/api/v1/vulns/*/status?*', route => json(route, { message: 'Review unavailable' }, 503));
    await page.route('**/api/v1/vulns/scan/code*', route => json(route, { message: 'Scan unavailable' }, 503));
  });
  await chooseProject(page);
  const finding = page.locator('.vuln-finding').first();
  await finding.locator(':scope > summary').click();
  await finding.locator('.vuln-finding-actions select').selectOption('CONFIRMED');
  await page.waitForFunction(() => document.querySelector('#toast')?.dataset.tone === 'error');
  assert.equal(fixture.vulnerabilities[0].status, 'SUSPECTED');
  assert.equal(await finding.locator('.vuln-status').getAttribute('data-status'), 'SUSPECTED');
  await page.locator('#vuln-scan-btn').click();
  await page.waitForFunction(() => document.querySelector('#vuln-scan-status')?.dataset.tone === 'error');
  assert.ok((await page.locator('#vuln-scan-status').textContent()).includes('扫描失败'));
  assert.equal(await page.locator('#vuln-scan-btn').isEnabled(), true);
});

test('late scan completion cannot refill a cleared project or reenable scan actions', async t => {
  const gate = deferred(), started = deferred(), delivered = deferred();
  t.after(() => gate.resolve());
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/vulns/scan/code*', async route => {
      started.resolve(); await gate.promise;
      await json(route, { scannedUnits: 40, newFindings: 1 }); delivered.resolve();
    });
  });
  await chooseProject(page);
  await page.locator('#vuln-scan-btn').click(); await started.promise;
  await chooseProject(page, '');
  gate.resolve(); await delivered.promise; await frames(page);
  assert.equal(await page.locator('#vuln-scan-btn').isEnabled(), false);
  assert.equal(await page.locator('#vuln-taint-btn').isEnabled(), false);
  assert.equal(await page.locator('#vuln-scan-status').textContent(), '');
  assert.equal(await page.locator('.vuln-finding').count(), 0);
});

test('report dialog traps focus, ignores background shortcuts, and recovers from HTTP failure', async t => {
  let requests = 0;
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/vulns/report/*', route => ++requests === 1
      ? json(route, { message: 'Report unavailable' }, 503)
      : json(route, { projectId: 'd3e000000001', generatedAt: '2026-10-04T12:00:00Z', totalFindings: 3,
        bySeverity: { HIGH: 1, MEDIUM: 1, LOW: 1 }, byStatus: { SUSPECTED: 2, CONFIRMED: 1 }, byCwe: {}, confirmedFindings: [] }));
  });
  await chooseProject(page);
  await page.locator('#vuln-report-btn').click();
  const dialog = page.locator('#vuln-report-modal');
  await page.locator('#vuln-report-retry').waitFor();
  assert.equal(await page.locator('#vuln-report-copy').isEnabled(), false);
  await page.keyboard.press('Control+k');
  assert.equal(new URL(page.url()).hash, '#vulns');
  for (let index = 0; index < 7; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest('#vuln-report-modal')), true);
  }
  await page.evaluate(() => document.getElementById('vuln-project-select').focus());
  assert.equal(await page.locator('#vuln-project-select').evaluate(el => el === document.activeElement), false, 'Modal background is inert');
  await page.locator('#vuln-report-retry').click();
  await page.waitForFunction(() => !document.querySelector('#vuln-report-copy').disabled);
  assert.ok((await page.locator('#vuln-report-text').inputValue()).includes('**3**'));
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); }; });
  await page.locator('#vuln-report-copy').click();
  await page.waitForFunction(() => document.querySelector('#vuln-report-state').dataset.tone === 'error');
  assert.ok((await page.locator('#vuln-report-state').textContent()).includes('复制'));
  await page.keyboard.press('Escape');
  assert.equal(await dialog.evaluate(el => el.open), false);
  assert.equal(await page.locator('#vuln-report-btn').evaluate(el => el === document.activeElement), true);
});

test('390px findings and expanded source stay inside the viewport in both languages', async t => {
  const { page } = await workbench(t, async (page, fixture) => {
    fixture.vulnerabilities[0].title = 'LongTitle'.repeat(15);
    fixture.vulnerabilities[0].qualifiedName = 'com.example.long.package.'.repeat(12) + '#method(String)';
    fixture.vulnerabilities[0].filePath = '/workspace/very-long-path/'.repeat(10) + 'Example.java';
  }, { width: 390, height: 844 });
  await chooseProject(page);
  const finding = page.locator('.vuln-finding').first();
  await finding.locator(':scope > summary').click();
  await finding.locator('.vuln-source').first().locator('summary').click();
  for (const lang of ['zh', 'en']) {
    await page.evaluate(lang => { Alpine.store('repograph').setLang(lang); }, lang);
    await frames(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, lang + ' has no page overflow');
    assert.equal(await finding.locator('.vuln-status').isVisible(), true);
    assert.equal(await finding.locator('.vuln-severity').isVisible(), true);
  }
});

test('impact navigation uses the reviewed project and stops if navigation changes before entry', async t => {
  const { page } = await workbench(t, async (page, fixture) => {
    await page.route('**/api/v1/vulns?*', route => json(route, [{ ...fixture.vulnerabilities[0], projectId: 'd3e000000002' }]));
  });
  await page.locator('#global-project').selectOption('d3e000000001');
  await chooseProject(page, 'd3e000000002');
  await page.locator('.vuln-finding > summary').click();
  const request = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/graph/impact');
  await page.locator('.vuln-finding-actions button').click();
  const url = new URL((await request).url());
  assert.equal(url.searchParams.get('projectId'), 'd3e000000002');
  assert.equal(url.searchParams.get('target'), 'demo.orders.OrderController#findOrders(String)');
  assert.equal(await page.locator('#global-project').inputValue(), 'd3e000000001', 'Local review does not rewrite global scope');
  const calls = await page.evaluate(async () => {
    const original = switchPanel;
    let queried = 0;
    const originalQuery = doGraphQuery;
    switchPanel = async () => { Alpine.store('repograph').panel = 'search'; };
    doGraphQuery = () => { queried++; };
    try { await jumpToImpact('demo.cancelled#call()'); }
    finally { switchPanel = original; doGraphQuery = originalQuery; }
    return queried;
  });
  assert.equal(calls, 0);
});

test('report response cannot revive a dialog closed while loading', async t => {
  const gate = deferred(), started = deferred(), delivered = deferred();
  t.after(() => gate.resolve());
  const { page } = await workbench(t, async page => {
    await page.route('**/api/v1/vulns/report/*', async route => {
      started.resolve(); await gate.promise;
      await json(route, { projectId: 'd3e000000001', generatedAt: '2026-10-04', totalFindings: 3, confirmedFindings: [] });
      delivered.resolve();
    });
  });
  await chooseProject(page);
  await page.locator('#vuln-report-btn').click(); await started.promise;
  assert.equal(await page.locator('#vuln-report-copy').isEnabled(), false);
  await page.keyboard.press('Escape');
  gate.resolve(); await delivered.promise; await frames(page);
  assert.equal(await page.locator('#vuln-report-modal').evaluate(el => el.open), false);
  assert.equal(await page.locator('#vuln-report-text').inputValue(), '');
  assert.equal(await page.locator('#vuln-report-copy').isEnabled(), false);
});

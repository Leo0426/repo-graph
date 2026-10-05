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
const pid = 'd3e000000001';
const otherPid = 'd3e000000002';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const components = [
  { 'bom-ref': 'demo-json', name: 'demo-json', group: 'org.demo', version: '2.0', scope: 'required', purl: 'pkg:maven/org.demo/demo-json@2.0' },
  { 'bom-ref': 'demo-testing', name: 'demo-testing', scope: 'optional', purl: 'pkg:npm/demo-testing' },
  { 'bom-ref': 'demo-runtime', name: 'demo-runtime', version: '1.0', scope: 'excluded', purl: 'pkg:pypi/demo-runtime@1.0' },
];
function bom(name = 'Demo dependencies', entries = components) {
  return { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    metadata: { timestamp: '2026-10-04T02:00:00Z', component: { name, version: '1.0' } }, components: entries };
}
async function workspace(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce', ...options });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.addInitScript(() => {
    localStorage.setItem('repograph_lang', 'en');
    localStorage.setItem('repograph_active_project', 'd3e000000001');
  });
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(fixture.unhandledRequests, [], 'All API calls use intentional fixtures');
  });
  await page.goto(new URL('#sbom', baseUrl).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#panel-sbom.active'));
  return { page, fixture };
}
async function sbomRoute(page, handler) {
  await page.route('**/api/v1/sbom/*?**', async route => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const response = await handler(id, route.request());
    await route.fulfill(response.body !== undefined ? response : { json: response });
  });
}
async function load(page, id = pid) {
  await page.locator('#sbom-view-input').fill(id);
  await page.locator('#sbom-view-input').press('Enter');
}

test('input validation sends no request and valid empty SBOM remains a downloadable zero-component document', async t => {
  const { page } = await workspace(t);
  let reads = 0;
  await sbomRoute(page, () => { reads++; return bom('Empty demo', []); });
  await load(page, '');
  assert.match(await page.locator('#sbom-view-content').innerText(), /Select a project/);
  await load(page, 'unindexed');
  assert.match(await page.locator('#sbom-view-content').innerText(), /indexed project/);
  assert.equal(reads, 0);
  await load(page);
  await page.locator('.sbom-summary').waitFor();
  assert.match(await page.locator('#sbom-component-list').innerText(), /No declared dependencies/);
  assert.match(await page.locator('#sbom-result-count').innerText(), /0\s*\/\s*0/);
  assert.equal(await page.locator('#sbom-download-btn').isVisible(), true);
  assert.equal(await page.locator('#sbom-graph-svg .nodes > g').count(), 0);
});

test('HTTP and malformed-document failures are retryable and identical pending loads are deduplicated', async t => {
  const { page } = await workspace(t);
  let calls = 0;
  await sbomRoute(page, async () => {
    calls++;
    if (calls === 1) return { status: 400, body: JSON.stringify({ error: 'DEMO_MANIFEST_MISSING' }), contentType: 'application/json' };
    if (calls === 2) return { body: '{broken', contentType: 'application/json' };
    await delay(200);
    return bom();
  });
  await load(page);
  await page.waitForFunction(() => document.querySelector('#sbom-view-content').textContent.includes('DEMO_MANIFEST_MISSING'));
  await page.locator('#sbom-retry').click();
  await page.waitForFunction(() => document.querySelector('#sbom-view-content').getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('#sbom-download-btn').isVisible(), false);
  await page.evaluate(() => { loadSbomView(); loadSbomView(); });
  await page.locator('.sbom-summary').waitFor();
  assert.equal(calls, 3);
});

test('project changes discard older responses and clearing removes data, graph and download action', async t => {
  const { page } = await workspace(t);
  await sbomRoute(page, async id => { if (id === pid) await delay(300); return bom(id); });
  await load(page, pid);
  await load(page, otherPid);
  await page.waitForFunction(() => document.querySelector('.sbom-summary')?.textContent.includes('d3e000000002'));
  await delay(400);
  assert.doesNotMatch(await page.locator('.sbom-summary').innerText(), /d3e000000001/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#sbom-download-btn').click()]);
  assert.equal(download.suggestedFilename(), `sbom-${otherPid}.json`);
  await page.locator('#sbom-view-input').fill('');
  assert.equal(await page.locator('#sbom-download-btn').isVisible(), false);
  assert.equal(await page.locator('.sbom-summary').count(), 0);
  assert.equal(await page.evaluate(() => sbomState.raw), null);
  assert.equal(await page.evaluate(() => _currentSbomGraphSim), null);
});

test('typing a complete component query retains focus and scope filters work from the keyboard', async t => {
  const { page } = await workspace(t);
  await sbomRoute(page, () => bom());
  await load(page);
  const search = page.locator('#sbom-component-search');
  await search.pressSequentially('testing');
  assert.equal(await search.inputValue(), 'testing');
  assert.equal(await search.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.sbom-component-button').count(), 1);
  await search.fill('');
  const optional = page.locator('.sbom-scope-btn[data-scope="optional"]');
  await optional.focus();
  await optional.press('Space');
  assert.equal(await optional.getAttribute('aria-pressed'), 'true');
  assert.equal(await optional.evaluate(el => el === document.activeElement), true);
  assert.match(await page.locator('#sbom-result-count').innerText(), /1\s*\/\s*3/);
});

test('component selection exposes metadata with missing versions preserved and graph nodes are keyboard accessible', async t => {
  const { page } = await workspace(t);
  await sbomRoute(page, () => bom());
  await load(page);
  const item = page.locator('.sbom-component-button').filter({ hasText: 'demo-testing' });
  await item.focus();
  await item.press('Enter');
  assert.equal(await item.getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#sbom-node-detail-content').innerText(), /demo-testing/);
  assert.match(await page.locator('#sbom-node-detail-content').innerText(), /—/);
  const node = page.locator('#sbom-graph-svg [role="button"]').filter({ hasText: 'demo-json' }).first();
  await node.focus();
  await node.press('Enter');
  assert.match(await page.locator('#sbom-node-detail-content').innerText(), /org.demo/);
});

test('large static graphs have finite edges, a working fit control, zoom feedback and reduced motion', async t => {
  const { page } = await workspace(t);
  const many = Array.from({ length: 70 }, (_, i) => ({ ...components[0], name: `demo-${i}`, 'bom-ref': `demo-${i}` }));
  await sbomRoute(page, () => bom('Large demo', many));
  await load(page);
  await page.locator('#sbom-graph-svg .nodes > g').first().waitFor();
  const edges = await page.locator('#sbom-graph-svg .links line').evaluateAll(lines => lines.map(line => ['x1','y1','x2','y2'].map(attr => line.getAttribute(attr))));
  assert.equal(edges.length, 70);
  assert.ok(edges.every(edge => edge.every(value => value !== null && Number.isFinite(Number(value)))));
  const before = await page.locator('#sbom-zoom-level').innerText();
  await page.locator('#sbom-zoom-in').click();
  assert.notEqual(await page.locator('#sbom-zoom-level').innerText(), before);
  await page.locator('#sbom-fit').click();
  // Commit computed SVG styling before reading screen geometry; wait for any
  // pending presentation work instead of using a fixed delay under parallel load.
  await page.locator('#sbom-graph-svg .zoom-g').evaluate(async group => {
    getComputedStyle(group).transform;
    await Promise.all(group.getAnimations().map(animation => animation.finished));
  });
  const bounds = await page.locator('#sbom-graph-svg').evaluate(svg => {
    const box = svg.getBoundingClientRect();
    const outside = [...svg.querySelectorAll('.nodes circle')].flatMap(node => {
      const rect = node.getBoundingClientRect();
      return rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom
        ? [] : [{ name: node.parentElement.getAttribute('aria-label'), node: rect.toJSON(), position: node.parentElement.getAttribute('transform') }];
    });
    const style = getComputedStyle(svg.querySelector('.zoom-g'));
    return { canvas: box.toJSON(), clientWidth: svg.clientWidth, clientHeight: svg.clientHeight,
      transform: svg.querySelector('.zoom-g').getAttribute('transform'), computedTransform: style.transform,
      transitionDuration: style.transitionDuration, zoom: document.getElementById('sbom-zoom-level').textContent, outside };
  });
  assert.equal(bounds.transitionDuration, '0s', 'D3 zoom must not acquire an implicit CSS transition');
  assert.equal(bounds.outside.length, 0, JSON.stringify(bounds));
});

test('no matching components offers filter reset without presenting the project as dependency-free', async t => {
  const { page } = await workspace(t);
  await sbomRoute(page, () => bom());
  await load(page);
  await page.locator('#sbom-component-search').fill('missing-component');
  assert.match(await page.locator('#sbom-component-list').innerText(), /No matching components/);
  assert.doesNotMatch(await page.locator('#sbom-component-list').innerText(), /No declared dependencies/);
  await page.locator('#sbom-clear-filters').click();
  assert.equal(await page.locator('.sbom-component-button').count(), 3);
  assert.equal(await page.locator('#sbom-component-search').inputValue(), '');
});

test('graph cap is explicit and the accessible list retains all entries including duplicate references', async t => {
  const { page } = await workspace(t);
  const many = Array.from({ length: 305 }, (_, i) => ({ ...components[i % 3], name: `demo-${i}` }));
  await sbomRoute(page, () => bom('Capped demo', many));
  await load(page);
  await page.locator('.sbom-component-button').first().waitFor();
  assert.equal(await page.locator('.sbom-component-button').count(), 305);
  assert.equal(await page.locator('#sbom-graph-svg .nodes > g').count(), 301);
  assert.match(await page.locator('#sbom-graph-hint').innerText(), /300\s*\/\s*305/);
  await page.locator('.sbom-component-button').last().click();
  assert.match(await page.locator('#sbom-node-detail-content').innerText(), /demo-304/);
});

test('390px layout wraps long identifiers and language refresh preserves component query and focus', async t => {
  const { page } = await workspace(t, { viewport: { width: 390, height: 844 } });
  await sbomRoute(page, () => bom('Demo ' + 'long-project-name'.repeat(6), [{ ...components[0], purl: 'pkg:demo/' + 'longcomponent'.repeat(20) }]));
  await load(page);
  const search = page.locator('#sbom-component-search');
  await search.fill('json');
  await search.focus();
  await page.evaluate(() => { applyLang(); applyLang(); });
  assert.equal(await search.evaluate(el => el === document.activeElement), true);
  await page.evaluate(() => { currentLang = 'zh'; applyLang(); });
  assert.equal(await search.inputValue(), 'json');
  assert.equal(await search.evaluate(el => el === document.activeElement), true);
  await page.locator('.sbom-component-button').first().click();
  const dimensions = await page.locator('#panel-sbom .panel-body').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  assert.ok(dimensions.scroll <= dimensions.client + 1, JSON.stringify(dimensions));
  await page.screenshot({ path: '/tmp/repograph-sbom-mobile.png', fullPage: true });
});

test('a hidden language refresh and viewport resize refit the graph after its canvas becomes visible', async t => {
  const { page } = await workspace(t);
  const many = Array.from({ length: 70 }, (_, i) => ({ ...components[0], name: `demo-${i}`, 'bom-ref': `demo-${i}` }));
  await sbomRoute(page, () => bom('Responsive demo', many));
  await load(page);
  await page.locator('#sbom-graph-svg .nodes > g').first().waitFor();
  await page.evaluate(async () => { await switchPanel('tools'); currentLang = 'zh'; applyLang(); await switchPanel('sbom'); });
  const allNodesInCanvas = () => {
    const svg = document.getElementById('sbom-graph-svg');
    const box = svg.getBoundingClientRect();
    return box.width > 0 && [...svg.querySelectorAll('.nodes circle')].every(node => {
      const r = node.getBoundingClientRect();
      return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom;
    });
  };
  await page.waitForFunction(allNodesInCanvas);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(allNodesInCanvas);
  assert.ok(await page.locator('#sbom-graph-svg').evaluate(svg => svg.clientWidth > 0));
});

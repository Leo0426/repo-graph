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

async function graphPage(t, options = {}) {
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
    assert.deepEqual(fixture.unhandledRequests, [], 'All API responses are isolated fixtures');
  });
  await page.goto(new URL('#graph', baseUrl).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#panel-graph.active') && document.querySelector('#graph-svg .zoom-g'));
  return { page, fixture };
}

async function query(page, target) {
  await page.locator('#graph-target').fill(target);
  await page.locator('#graph-target').press('Enter');
}

test('empty targets do not leave the graph stuck loading', async t => {
  const { page, fixture } = await graphPage(t);
  await page.locator('#panel-graph .btn-primary').click();
  assert.doesNotMatch(await page.locator('#graph-hint').innerText(), /Loading|loading/);
  assert.equal(fixture.requested.filter(path => path.includes('/graph/callers')).length, 0);
  assert.equal(await page.locator('#graph-target').evaluate(el => el === document.activeElement), true);
});

test('a slower query cannot overwrite the latest graph and a mode change invalidates pending work', async t => {
  const { page, fixture } = await graphPage(t);
  await page.route('**/api/v1/graph/callers?**', async route => {
    const target = new URL(route.request().url()).searchParams.get('target');
    await delay(target === 'old' ? 600 : 40);
    await route.fulfill({ json: [{ ...fixture.units[0], qualifiedName: `${target}.result` }] });
  });
  const oldRequest = page.waitForRequest('**/api/v1/graph/callers?**');
  await query(page, 'old');
  await oldRequest;
  await query(page, 'new');
  await page.waitForTimeout(800);
  assert.match(await page.locator('#graph-hint').innerText(), /new/);
  assert.doesNotMatch(await page.locator('#graph-hint').innerText(), /old/);
  await query(page, 'old');
  await page.locator('[data-i18n="graph.callees"]').click();
  await page.waitForTimeout(750);
  assert.equal(await page.locator('#graph-svg .nodes > g').count(), 0);
  assert.doesNotMatch(await page.locator('#graph-hint').innerText(), /old/);
});

test('errors retain their detail and retry recovers to a graph', async t => {
  const { page, fixture } = await graphPage(t);
  let failed = false;
  await page.route('**/api/v1/graph/callers?**', async route => {
    if (!failed) {
      failed = true;
      return route.fulfill({ status: 503, json: { error: 'DEMO_GRAPH_OFFLINE' } });
    }
    return route.fulfill({ json: fixture.units });
  });
  await query(page, 'demo.query');
  await page.waitForFunction(() => document.querySelector('#graph-hint').textContent.includes('DEMO_GRAPH_OFFLINE'));
  await page.locator('#graph-retry').click();
  await page.waitForFunction(() => document.querySelectorAll('#graph-svg .nodes > g').length === 4);
  assert.equal(await page.locator('#graph-state').isVisible(), false);
  assert.equal(await page.locator('#graph-query-btn').isDisabled(), false);
});

test('large graph edges have endpoints and Fit keeps every node inside the canvas', async t => {
  const { page, fixture } = await graphPage(t);
  const units = Array.from({ length: 140 }, (_, i) => ({ ...fixture.units[0], qualifiedName: `demo.Node${i}#read()` }));
  await page.route('**/api/v1/graph/callers?**', route => route.fulfill({ json: units }));
  await query(page, 'demo.root');
  await page.waitForFunction(() => document.querySelectorAll('#graph-svg .nodes > g').length === 141);
  const endpoints = await page.locator('#graph-svg .links line').evaluateAll(lines => lines.map(line =>
    ['x1', 'x2', 'y1', 'y2'].map(name => line.getAttribute(name))));
  assert.equal(endpoints.length, 140);
  assert.ok(endpoints.every(values => values.every(value => value !== null && Number.isFinite(Number(value)))));
  await page.evaluate(() => { graphZoomIn(); graphReset(); });
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#graph-svg').evaluate(svg => {
    const bounds = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('.nodes > g')].every(node => {
      const rect = node.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    });
  }), true);
});

test('keyboard node selection is visible and an empty result removes the previous pivot target', async t => {
  const { page, fixture } = await graphPage(t);
  await page.route('**/api/v1/graph/callers?**', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.get('target') === 'empty' ? [] : fixture.units }));
  await query(page, 'demo.root');
  const node = page.locator('#graph-svg .nodes > g[role="button"]').nth(1);
  await node.focus();
  await node.press('Enter');
  assert.equal(await page.locator('#node-detail').isVisible(), true);
  assert.match(await page.locator('#node-detail-content').innerText(), /OrderController/);
  assert.equal(await node.getAttribute('aria-pressed'), 'true');
  await query(page, 'empty');
  await page.waitForFunction(() => !document.querySelector('#graph-svg .nodes > g'));
  assert.equal(await page.locator('#node-detail').isVisible(), false);
  assert.equal(await page.evaluate(() => state.selectedNode), null);
  assert.equal(await page.locator('#graph-state').isVisible(), true);
});

test('mobile graph errors and controls fit a narrow canvas', async t => {
  const { page } = await graphPage(t, { viewport: { width: 390, height: 844 } });
  await page.route('**/api/v1/graph/callers?**', route => route.fulfill({ status: 503,
    json: { error: 'DEMO_GRAPH_OFFLINE_' + 'long_detail_'.repeat(12) } }));
  await query(page, 'demo.root');
  await page.locator('#graph-retry').waitFor({ state: 'visible' });
  const layout = await page.locator('.graph-canvas').evaluate(canvas => ({
    overflow: canvas.scrollWidth > canvas.clientWidth + 1,
    controlWidths: [...canvas.querySelectorAll('.graph-ctrl-btn')].map(el => el.getBoundingClientRect().width),
  }));
  assert.equal(layout.overflow, false);
  assert.ok(layout.controlWidths.every(width => width >= 40));
});

test('flow views replace the previous diagram and an empty PDG remains recoverable', async t => {
  const { page } = await graphPage(t, { viewport: { width: 390, height: 844 } });
  await page.route('**/api/v1/flow/analyze?**', route => route.fulfill({ json: {
    target: 'demo.Controller#read()', summary: { parameters: ['value'], fieldReads: [], fieldWrites: [], returnSources: ['value'] },
    controlFlowGraph: {
      nodes: [{ id: 'entry', kind: 'ENTRY', label: 'read(value)', line: 1 },
        { id: 'return', kind: 'RETURN', label: 'return value', line: 2 }],
      edges: [{ sourceId: 'entry', targetId: 'return', kind: 'NEXT' }],
    },
    programDependenceGraph: { nodes: [], edges: [] },
  } }));
  await page.locator('[data-i18n="graph.flow"]').click();
  await query(page, 'demo.Controller#read()');
  await page.waitForFunction(() => document.querySelectorAll('#graph-svg .zoom-g rect').length === 2);
  assert.equal(await page.locator('#flow-summary').isVisible(), true);
  await page.locator('[data-flow-view="pdg"]').click();
  assert.equal(await page.locator('#graph-svg .zoom-g rect').count(), 0);
  assert.equal(await page.locator('#graph-state').isVisible(), true);
  await page.locator('[data-flow-view="cfg"]').click();
  assert.equal(await page.locator('#graph-state').isVisible(), false);
  assert.equal(await page.locator('#graph-svg .zoom-g rect').count(), 2);
  assert.equal(await page.locator('.graph-canvas').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  await page.locator('[data-i18n="graph.callers"]').click();
  assert.equal(await page.locator('#flow-summary').isVisible(), false);
  assert.equal(await page.locator('#graph-svg .zoom-g rect').count(), 0);
});

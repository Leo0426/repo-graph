'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const installFixtures = require('./fixtures.cjs');

const baseUrl = process.env.UI_BASE_URL;
if (!baseUrl) throw new Error('Set UI_BASE_URL to the isolated RepoGraph preview server.');
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' });
});
after(async () => { await browser?.close(); });

async function workspace(t, viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.addInitScript(() => localStorage.setItem('repograph_lang', 'zh'));
  t.after(async () => {
    await page.unrouteAll({ behavior: 'wait' });
    await page.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(fixture.unhandledRequests, [], 'All API requests use explicit fictional fixtures');
  });
  await page.goto(new URL('#search', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Alpine
    && document.querySelector('.panel.active')?.id === 'panel-search');
  return { page, fixture };
}

async function openFilters(page) {
  const disclosure = page.locator('#search-filter-disclosure');
  if (await disclosure.count() && !await disclosure.evaluate(element => element.open)) {
    await disclosure.locator('summary').click();
  }
}

async function search(page, query) {
  await page.locator('#search-input').fill(query);
  await page.locator('#search-input').press('Enter');
}

async function cards(page, count) {
  await page.waitForFunction(count => document.querySelectorAll('#search-results .result-card').length === count
    && document.querySelector('#search-results').getAttribute('aria-busy') === 'false', count);
}

function rows(unit, count) {
  return Array.from({ length: count }, (_, index) => ({
    unit: { ...unit, id: `demo-search-unit-${index}`, qualifiedName: `demo.orders.OrderService#find${index}(String)`,
      simpleName: `find${index}`, rawSource: '// DEMO selectable source text\nreturn orderRepository.find(customerId);' },
    score: 0.95 - index * 0.01,
  }));
}

async function paginate(page, results, beforeResponse = async () => {}) {
  await page.route('**/api/v1/search/**', async route => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 10);
    await beforeResponse({ offset, limit });
    const pageResults = results.slice(offset, offset + limit);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      results: pageResults, offset, limit, hasMore: offset + pageResults.length < results.length,
    }) });
  });
}

test('mobile filters open with native keyboard controls and reset preserves the chosen result limit', async t => {
  const { page } = await workspace(t, { width: 390, height: 844 });
  const disclosure = page.locator('#search-filter-disclosure');
  assert.equal(await disclosure.count(), 1, 'Mobile search must expose a filter disclosure');
  assert.equal(await disclosure.evaluate(element => element.tagName), 'DETAILS');
  assert.equal(await disclosure.evaluate(element => element.open), false);
  const summary = disclosure.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await disclosure.evaluate(element => element.open), true);
  await page.locator('[data-group="lang"][data-val="java"]').click();
  await page.locator('[data-group="kind"][data-val="METHOD"]').click();
  await page.locator('#search-limit').selectOption('20');
  await summary.focus();
  await page.keyboard.press('Space');
  assert.equal(await disclosure.evaluate(element => element.open), false);
  assert.match(await page.locator('#search-filter-summary').textContent(), /Java/);
  assert.match(await page.locator('#search-filter-summary').textContent(), /方法/);
  await page.keyboard.press('Enter');
  await page.locator('#search-reset-filters').click();
  assert.equal(await page.locator('[data-group="lang"][data-val=""]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-group="kind"][data-val=""]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#search-limit').inputValue(), '20');
  const resetSummary = await page.locator('#search-filter-summary').textContent();
  assert.doesNotMatch(resetSummary, /Java|方法/);
  assert(resetSummary.trim().length > 0, 'The default filter state remains described');
});

test('changing the result limit immediately refreshes the query and discards an older pending page', async t => {
  const { page, fixture } = await workspace(t);
  let releaseOldPage;
  const oldPageGate = new Promise(resolve => { releaseOldPage = resolve; });
  await paginate(page, rows(fixture.units[0], 12), async ({ offset, limit }) => {
    if (offset === 5 && limit === 5) await oldPageGate;
  });
  await openFilters(page);
  await page.locator('#search-limit').selectOption('5');
  await search(page, 'demo orders');
  await cards(page, 5);
  const oldPageRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname.includes('/search/') && url.searchParams.get('offset') === '5';
  });
  let pendingPageRequest;
  try {
    await page.locator('#load-more-btn').click();
    pendingPageRequest = await oldPageRequest;
    const refreshedRequest = page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/search/semantic') && url.searchParams.get('limit') === '10'
        && url.searchParams.get('offset') === '0';
    });
    await page.locator('#search-limit').selectOption('10');
    const refreshed = await refreshedRequest;
    assert.equal(new URL(refreshed.url()).searchParams.get('q'), 'demo orders');
    await cards(page, 10);
  } finally {
    releaseOldPage();
    if (pendingPageRequest) {
      const response = await pendingPageRequest.response();
      await response?.finished();
    }
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#search-results .result-card').count(), 10,
    'The old page must not append duplicate results to the refreshed query');
  assert.deepEqual(await page.locator('.rc-name').allTextContents(),
    Array.from({ length: 10 }, (_, index) => `demo.orders.OrderService#find${index}(String)`));
});

test('code search disables unsupported kind filters and semantic search restores the selected kind', async t => {
  const { page } = await workspace(t);
  await openFilters(page);
  const method = page.locator('[data-group="kind"][data-val="METHOD"]');
  await method.click();
  await search(page, 'demo orders');
  await cards(page, 3);
  const codeRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/search/code'));
  await page.locator('#search-tab-row [data-i18n="tab.code"]').click();
  assert.equal(new URL((await codeRequest).url()).searchParams.has('kind'), false);
  assert.equal(await page.locator('[data-group="kind"]').evaluateAll(buttons =>
    buttons.length > 0 && buttons.every(button => button.disabled)), true);
  assert.equal(await page.locator('.search-kind-note').isVisible(), true);
  assert((await page.locator('.search-kind-note').textContent()).trim().length > 0);
  const semanticRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/search/semantic'));
  await page.locator('#search-tab-row [data-i18n="tab.semantic"]').click();
  assert.equal(new URL((await semanticRequest).url()).searchParams.get('kind'), 'METHOD');
  assert.equal(await method.isEnabled(), true);
  assert.equal(await method.getAttribute('aria-pressed'), 'true');
});

test('pagination updates the displayed count while source selection and graph actions remain distinct', async t => {
  const { page, fixture } = await workspace(t);
  await paginate(page, rows(fixture.units[0], 7));
  await openFilters(page);
  await page.locator('#search-limit').selectOption('5');
  await search(page, 'demo orders');
  await cards(page, 5);
  await page.locator('#load-more-btn').click();
  await cards(page, 7);
  assert.equal(await page.locator('#search-results > .result-meta').getAttribute('data-count'), '7');
  await page.locator('.rc-source-toggle').first().click();
  const source = page.locator('.rc-source-pre').first();
  await source.click({ position: { x: 80, y: 24 } });
  assert.equal(await page.locator('.panel.active').getAttribute('id'), 'panel-search');
  await source.dblclick({ position: { x: 80, y: 24 } });
  assert.equal(await page.locator('.panel.active').getAttribute('id'), 'panel-search');
  assert(await page.evaluate(() => (window.getSelection()?.toString() || '').trim().length > 0),
    'Source text must be selectable with the mouse');
  const copyShortcuts = await page.locator('.result-card').first().evaluate(card =>
    ['ctrlKey', 'metaKey'].map(modifier => {
      const event = new KeyboardEvent('keydown', {
        key: 'c', bubbles: true, cancelable: true, [modifier]: true,
      });
      card.dispatchEvent(event);
      return event.defaultPrevented;
    }));
  assert.deepEqual(copyShortcuts, [false, false],
    'A nonempty source selection keeps native Ctrl/Cmd+C copying');
  await page.locator('.rc-open-graph').first().click();
  await page.waitForFunction(() => document.querySelector('.panel.active')?.id === 'panel-graph');
  assert.equal(await page.locator('#graph-target').inputValue(), 'demo.orders.OrderService#find0(String)');
  await page.locator('.nav-btn[data-panel="search"]').click();
  await page.locator('.result-card').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.panel.active')?.id === 'panel-graph');
});

test('unusable search history never prevents a new query from returning results', async t => {
  const cases = [
    { name: 'object cache', history: { query: 'demo old query' } },
    { name: 'null cache', history: null },
    { name: 'mixed array cache', history: [null, 23, { query: 'demo invalid' }, 'demo valid query'] },
    { name: 'history write failure', history: [], failWrites: true },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async t => {
      const { page, fixture } = await workspace(t);
      await page.evaluate(({ history, failWrites }) => {
        localStorage.setItem('repograph_search_history', JSON.stringify(history));
        if (failWrites) {
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === 'repograph_search_history') {
              throw new DOMException('DEMO: history storage unavailable', 'QuotaExceededError');
            }
            return original.call(this, key, value);
          };
        }
      }, scenario);
      await search(page, 'demo resilient order search');
      await cards(page, 3);
      assert.equal(fixture.requested.filter(request => request.includes('/api/v1/search/semantic?')).length, 1);
      assert.match(await page.locator('.rc-name').first().textContent(), /demo\.orders/);
    });
  }
});

test('IME composition searches and records only the completed text', async t => {
  const { page, fixture } = await workspace(t);
  const input = page.locator('#search-input');
  await input.focus();
  await input.evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.value = 'dingdan';
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: 'dingdan', inputType: 'insertCompositionText', isComposing: true,
    }));
  });
  // This absence assertion intentionally spans the 300 ms search debounce.
  await page.waitForTimeout(400);
  assert.deepEqual(fixture.requested.filter(request => request.includes('/api/v1/search/')), [],
    'Uncommitted IME text must not issue a search request');
  await input.evaluate(element => {
    element.value = '订单查询';
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '订单查询' }));
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: '订单查询', inputType: 'insertText', isComposing: false,
    }));
  });
  await cards(page, 3);
  // A final input event after compositionend must not create a second delayed query.
  await page.waitForTimeout(400);
  const requests = fixture.requested.filter(request => request.includes('/api/v1/search/'));
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].slice('GET '.length), baseUrl).searchParams.get('q'), '订单查询');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('repograph_search_history'))), ['订单查询']);
});

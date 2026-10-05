'use strict';

// Every health check below is an intercepted fictional HTML response, including OOB badges.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const installFixtures = require('./fixtures.cjs');
const baseUrl = process.env.UI_BASE_URL;
if (!baseUrl) throw new Error('Set UI_BASE_URL to an isolated RepoGraph view server.');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' }); });
after(async () => { await browser?.close(); });

const initialTime = '2026-10-05T02:00:00.000Z';
const services = ['qdrant', 'ollama', 'neo4j'];
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function healthHtml(states = ['ok', 'error', 'checking']) {
  const names = ['Qdrant', 'Ollama', 'Neo4j'];
  return services.map((service, i) => `<div class="health-card ${states[i] === 'ok' ? 'h-ok' : states[i] === 'error' ? 'h-err' : 'h-unknown'}" data-service="${service}">
    <div class="health-info"><div class="health-name">${names[i]}</div><div class="health-desc" data-i18n="health.${service}.desc">DEMO fictional service</div></div>
    <div class="health-status">${states[i] === 'checking' ? 'unknown' : states[i]}</div></div>`).join('')
    + services.map((service, i) => `<div class="badge" id="hb-${service}" hx-swap-oob="outerHTML" data-health="${states[i]}">
      <div id="hd-${service}" class="badge-dot ${states[i]}" aria-hidden="true"></div><span>${names[i]}</span>
      <span class="badge-state">${states[i]}</span></div>`).join('');
}
const html = (route, body = healthHtml(), status = 200) => route.fulfill({ status, contentType: 'text/html; charset=utf-8', body });

async function workspace(t, respond, options = {}) {
  const page = await browser.newPage({ viewport: options.viewport || { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.clock.install({ time: new Date(initialTime) });
  await page.clock.setFixedTime(new Date(initialTime));
  await page.addInitScript(() => localStorage.setItem('repograph_lang', 'en'));
  let requests = 0;
  await page.route('**/api/fragments/health', route => respond(route, ++requests));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(fixture.unhandledRequests, [], 'Every API request uses fictional fixtures');
  });
  await page.goto(new URL('#health', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Alpine && document.querySelector('#panel-health.active'));
  return { page, requests: () => requests };
}

async function settled(page, state) {
  await page.waitForFunction(state => document.querySelector('#health-summary')?.dataset.state === state
    && document.querySelector('#health-grid').getAttribute('aria-busy') === 'false', state);
}
async function receivedAt(page) { return (await page.locator('#health-last-checked').getAttribute('datetime')) || ''; }
async function noCurrentGreen(page) {
  assert.equal(await page.locator('.health-badges .badge-dot.ok').count(), 0);
  assert.equal(await page.locator('#health-grid .h-ok').count(), 0);
  assert.equal(await page.locator('#hb-qdrant').getAttribute('data-health'), 'offline');
}

test('only complete health responses advance freshness, including mixed states and periodic polls', async t => {
  const first = deferred(), started = deferred();
  const { page, requests } = await workspace(t, async (route, count) => {
    if (count === 1) { started.resolve(); await first.promise; }
    return html(route, count === 1 ? healthHtml() : healthHtml(['ok', 'ok', 'ok']));
  });
  try {
    await started.promise;
    assert.equal(await receivedAt(page), '', 'No timestamp is invented before the first response');
    assert.equal(await page.locator('#health-grid').getAttribute('aria-busy'), 'true');
  } finally { first.resolve(); }
  await settled(page, 'degraded');
  assert.equal(await receivedAt(page), initialTime);
  assert.deepEqual(await page.locator('.health-badges [data-health]').evaluateAll(badges => badges.map(badge => badge.dataset.health)),
    ['ok', 'error', 'checking']);
  await page.clock.setFixedTime(new Date('2026-10-05T02:00:20.000Z'));
  await page.evaluate(() => { applyLang(); applyLang(); });
  assert.equal(await receivedAt(page), initialTime, 'Language/HTMX presentation refresh is not a new check');
  await page.clock.runFor(5100);
  await settled(page, 'ok');
  assert.equal(requests(), 2, 'The existing five-second poll supplies the next result');
  assert.equal(await receivedAt(page), '2026-10-05T02:00:20.000Z');
});

test('HTTP failure keeps the last received time, removes stale green and recovers through manual retry', async t => {
  const { page } = await workspace(t, (route, count) => count === 2
    ? html(route, 'DEMO service unavailable', 503) : html(route, healthHtml(['ok', 'ok', 'ok'])));
  await settled(page, 'ok');
  const previous = await receivedAt(page);
  await page.clock.setFixedTime(new Date('2026-10-05T02:01:00.000Z'));
  await page.locator('#health-refresh').click();
  await settled(page, 'offline');
  assert.equal(await receivedAt(page), previous);
  await noCurrentGreen(page);
  assert.equal(await page.locator('#health-refresh').isEnabled(), true);
  await page.clock.setFixedTime(new Date('2026-10-05T02:02:00.000Z'));
  await page.locator('#health-refresh').click();
  await settled(page, 'ok');
  assert.equal(await receivedAt(page), '2026-10-05T02:02:00.000Z');
  assert.equal(await page.locator('.health-badges .badge-dot.ok').count(), 3);
});

test('a transport failure before any result has no freshness and can recover without reloading', async t => {
  const { page } = await workspace(t, (route, count) => count === 1
    ? route.abort('failed') : html(route, healthHtml()));
  await settled(page, 'offline');
  assert.equal(await receivedAt(page), '');
  await noCurrentGreen(page);
  await page.clock.setFixedTime(new Date('2026-10-05T02:03:00.000Z'));
  await page.locator('#health-refresh').click();
  await settled(page, 'degraded');
  assert.equal(await receivedAt(page), '2026-10-05T02:03:00.000Z');
});

test('missing or duplicate OOB service states cannot turn an invalid HTTP 200 into a fresh result', async t => {
  const malformed = [
    '<div class="health-card">DEMO incomplete result</div>',
    healthHtml(['ok', 'ok', 'ok']) + '<div id="hb-qdrant" hx-swap-oob="outerHTML" data-health="error">DEMO duplicate state</div>',
  ];
  const { page } = await workspace(t, (route, count) => html(route,
    count === 1 || count > 3 ? healthHtml(['ok', 'ok', 'ok']) : malformed[count - 2]));
  await settled(page, 'ok');
  const previous = await receivedAt(page);
  for (const minute of [4, 5]) {
    await page.clock.setFixedTime(new Date(`2026-10-05T02:0${minute}:00.000Z`));
    await page.locator('#health-refresh').click();
    await settled(page, 'offline');
    assert.equal(await receivedAt(page), previous);
    await noCurrentGreen(page);
    assert.doesNotMatch(await page.locator('#health-grid').textContent(), /DEMO (incomplete|duplicate)/);
    assert.equal(await page.locator('#hb-qdrant').count(), 1);
  }
  await page.locator('#health-refresh').click();
  await settled(page, 'ok');
  assert.notEqual(await receivedAt(page), previous);
});

test('manual retry and periodic triggers do not overlap a pending health check', async t => {
  const pending = deferred(), started = deferred();
  const { page, requests } = await workspace(t, async (route, count) => {
    if (count === 2) { started.resolve(); await pending.promise; }
    return html(route, healthHtml(['ok', 'ok', 'ok']));
  });
  await settled(page, 'ok');
  const previous = await receivedAt(page);
  try {
    await page.locator('#health-refresh').click();
    await started.promise;
    assert.equal(await page.locator('#health-refresh').isEnabled(), false);
    assert.equal(await page.locator('#health-grid').getAttribute('aria-busy'), 'true');
    await page.evaluate(() => { refreshHealthStatus(); refreshHealthStatus(); });
    await page.clock.runFor(11000);
    assert.equal(requests(), 2, 'Neither repeated retry nor automatic ticks create concurrent probes');
    assert.equal(await receivedAt(page), previous);
    await page.clock.setFixedTime(new Date('2026-10-05T02:06:00.000Z'));
  } finally { pending.resolve(); }
  await settled(page, 'ok');
  assert.equal(await receivedAt(page), '2026-10-05T02:06:00.000Z');
  assert.equal(await page.locator('#health-refresh').isEnabled(), true);
});

test('390px health controls work by keyboard and language changes preserve the actual result time', async t => {
  const { page, requests } = await workspace(t, route => html(route), { viewport: { width: 390, height: 844 } });
  await settled(page, 'degraded');
  const refresh = page.locator('#health-refresh');
  await refresh.focus();
  await refresh.press('Enter');
  await settled(page, 'degraded');
  assert.equal(requests(), 2);
  const previous = await receivedAt(page);
  await refresh.focus();
  for (const language of ['zh', 'en']) {
    await page.evaluate(language => Alpine.store('repograph').setLang(language), language);
    assert.equal(await receivedAt(page), previous);
    assert.equal(await refresh.evaluate(button => button === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.doesNotMatch(await page.locator('#health-grid').textContent(), /192\.168\.|localhost:|nomic-embed-code/);
    for (const service of services) {
      const expected = await page.evaluate(service => t(`shell.service.${document.getElementById(`hb-${service}`).dataset.health}`), service);
      assert.equal(await page.locator(`#health-grid [data-service="${service}"] .health-status`).textContent(), expected);
    }
  }
  assert.equal(requests(), 2, 'Changing language does not probe services again');
});

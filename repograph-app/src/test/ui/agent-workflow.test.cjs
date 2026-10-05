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

async function workbench(t, viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.addInitScript(() => {
    localStorage.setItem('repograph_active_project', 'd3e000000001');
    localStorage.setItem('repograph_lang', 'zh');
  });
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(fixture.unhandledRequests, [], 'Every API request uses an intentional fixture');
  });
  await page.goto(new URL('#agent', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#agent-run-summary');
  return page;
}

test('preparation starts open and navigation retains the draft and advanced options', async t => {
  const page = await workbench(t);
  assert.equal(await page.locator('#agent-preparation').evaluate(el => el.open), true);
  await page.locator('#agent-mode-external-btn').click();
  const findings = '{"results":[{"check_id":"demo-rule"}]}';
  await page.locator('#agent-findings-json').fill(findings);
  await page.locator('.agent-advanced-options > summary').click();
  await page.locator('#agent-code-version').fill('draft-commit');
  await page.locator('#agent-view-runs').click();
  assert.equal(await page.locator('#agent-preparation').evaluate(el => el.open), false);
  await page.waitForFunction(() => document.activeElement.id === 'agent-timeline-heading');
  assert.equal(await page.locator('#agent-findings-json').isVisible(), false);
  await page.locator('#agent-prepare-btn').click();
  assert.equal(await page.locator('#agent-preparation').evaluate(el => el.open), true);
  assert.equal(await page.locator('#agent-findings-json').inputValue(), findings);
  assert.equal(await page.locator('#agent-code-version').inputValue(), 'draft-commit');
  assert.equal(await page.locator('.agent-advanced-options').evaluate(el => el.open), true);
  await page.locator('#agent-preparation-toggle').press('Enter');
  assert.equal(await page.locator('#agent-preparation').evaluate(el => el.open), false);
});

test('choosing a run focuses results while polling preserves scrolling and expanded evidence', async t => {
  const page = await workbench(t);
  await page.locator('#agent-run-list .agent-run-item').first().click();
  assert.equal(await page.locator('#agent-preparation').evaluate(el => el.open), false);
  await page.waitForFunction(() => document.activeElement.id === 'agent-timeline-heading');
  const audit = page.locator('#agent-timeline details.agent-step-audit').first();
  await audit.locator('summary').click();
  await page.evaluate(() => { document.querySelector('.agent-body').scrollTop += 100; });
  const previousScroll = await page.locator('.agent-body').evaluate(el => el.scrollTop);
  await page.evaluate(() => loadAgentRuns(true));
  assert.equal(await page.locator('#agent-preparation').evaluate(el => el.open), false);
  assert.equal(await audit.evaluate(el => el.open), true);
  assert.ok(Math.abs(await page.locator('.agent-body').evaluate(el => el.scrollTop) - previousScroll) <= 1);
});

test('accepted launches focus the timeline and leave the preparation draft intact', async t => {
  const page = await workbench(t);
  await page.locator('#agent-vulnerability-list .agent-vulnerability-item').first().click();
  await page.locator('#agent-run-btn').click();
  await page.waitForFunction(() => document.activeElement.id === 'agent-timeline-heading');
  assert.equal(await page.locator('#agent-preparation').evaluate(el => el.open), false);
  await page.locator('#agent-prepare-btn').click();
  assert.equal(await page.locator('#agent-project-select').inputValue(), 'd3e000000001');
  assert.equal(await page.locator('#agent-run-btn').isEnabled(), true);
});

test('desktop run rail stays compact and mobile capabilities use a compact second row', async t => {
  const page = await workbench(t);
  const rail = await page.locator('.agent-run-rail').boundingBox();
  const detail = await page.locator('.agent-operations > .agent-run-detail').boundingBox();
  assert.ok(rail.height < detail.height / 2, 'The short run list must not stretch to the timeline height');
  await page.setViewportSize({ width: 390, height: 844 });
  const strip = await page.locator('.agent-capability-strip').boundingBox();
  assert.ok(strip.height < 190, 'Mobile capabilities should not occupy three full rows');
  assert.equal(await page.locator('.agent-run-rail').evaluate(el => getComputedStyle(el).position), 'static');
  const secondary = page.locator('.agent-capability.available');
  for (let index = 0; index < await secondary.count(); index++) {
    const button = secondary.nth(index);
    assert.ok((await button.boundingBox()).height >= 44, 'Compact controls remain usable touch targets');
    assert.equal(await button.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  }
});

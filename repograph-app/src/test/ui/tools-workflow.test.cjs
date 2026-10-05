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
const pid = 'd3e000000001';
const otherPid = 'd3e000000002';

async function workspace(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', ...options });
  page.setDefaultTimeout(5000);
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
    assert.deepEqual(fixture.unhandledRequests, [], 'Every API response is an intentional fixture');
  });
  await page.goto(new URL('#tools', baseUrl).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#panel-tools.active'));
  return { page, fixture };
}

const row = (page, id = pid) => page.locator(`.tools-project[data-project-id="${id}"]`);
const framework = label => [{ kind: 'METHOD', qualifiedName: `${label}#handle()`, filePath: `src/${label}.java`, metadata: { framework: 'spring' } }];

test('project cards show source metadata, filter locally and expose a keyboard overview link', async t => {
  const { page } = await workspace(t);
  await row(page).waitFor();
  assert.match(await row(page).innerText(), /1,248/);
  assert.equal(await row(page).locator('time').getAttribute('datetime'), '2026-10-04T02:00:00Z');
  let reads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/projects') reads++; });
  await page.locator('#tools-project-search').fill('inventory');
  assert.equal(await page.locator('.tools-project').count(), 1);
  assert.match(await page.locator('#tools-project-count').innerText(), /1\s*\/\s*2/);
  await page.locator('#tools-project-search').fill('no match');
  assert.match(await page.locator('#projects-manage-list').innerText(), /No matching projects/);
  await page.locator('#tools-clear-filter').click();
  assert.equal(reads, 0, 'Filtering never sends a project request');
  const link = row(page).locator('.tools-overview');
  await link.focus();
  await link.press('Enter');
  await page.waitForURL(`**/#stats=${pid}`);
});

test('refresh failure retains the last project list and offers a working retry', async t => {
  const { page, fixture } = await workspace(t);
  let fail = true;
  await page.route('**/api/v1/projects', route => route.fulfill(fail
    ? { status: 503, json: { error: 'DEMO_PROJECTS_OFFLINE' } }
    : { json: fixture.projects }));
  await page.locator('#tools-refresh-projects').click();
  await page.waitForFunction(() => document.querySelector('#tools-project-status').textContent.includes('DEMO_PROJECTS_OFFLINE'));
  assert.equal(await page.locator('.tools-project').count(), 2);
  fail = false;
  await page.locator('#tools-project-retry').click();
  await page.waitForFunction(() => document.querySelector('#projects-manage-list').getAttribute('aria-busy') === 'false'
    && !document.querySelector('#tools-project-retry'));
});

test('newer project responses win and an empty list offers index navigation without starting a job', async t => {
  const { page, fixture } = await workspace(t);
  let calls = 0;
  await page.route('**/api/v1/projects', async route => {
    const first = ++calls === 1;
    if (first) await delay(250);
    await route.fulfill({ json: first ? fixture.projects : [] });
  });
  await page.evaluate(() => { renderProjectsManage(); renderProjectsManage(); });
  await delay(400);
  assert.equal(await page.locator('.tools-project').count(), 0);
  assert.match(await page.locator('#projects-manage-list').innerText(), /No indexed projects/);
  let mutations = 0;
  page.on('request', request => { if (request.method() !== 'GET') mutations++; });
  await page.locator('#projects-manage-list .tools-index-link').click();
  await page.waitForFunction(() => document.querySelector('#panel-index.active'));
  assert.equal(mutations, 0);
});

test('deletion preserves confirmation and failed rows, passes quoted roots, and clears a deleted active project', async t => {
  const { page, fixture } = await workspace(t);
  let projects = [{ ...fixture.projects[0], projectRoot: "/demo/team's project" }, fixture.projects[1]];
  await page.route('**/api/v1/projects', route => route.fulfill({ json: projects }));
  await page.evaluate(() => renderProjectsManage());
  let deletes = 0;
  let receivedRoot;
  await page.route('**/api/v1/index/project?**', route => {
    assert.equal(route.request().method(), 'DELETE');
    receivedRoot = new URL(route.request().url()).searchParams.get('projectRoot');
    if (++deletes === 1) return route.fulfill({ status: 503, json: { error: 'DEMO_DELETE_OFFLINE' } });
    projects = projects.filter(p => p.projectId !== pid);
    return route.fulfill({ json: { status: 'deleted' } });
  });
  await row(page).locator('.tools-delete').click();
  await page.locator('#delete-modal-cancel').click();
  assert.equal(deletes, 0);
  await row(page).locator('.tools-delete').click();
  assert.match(await page.locator('#delete-modal-body').innerText(), /team's project/);
  await page.locator('#delete-modal-confirm').click();
  await page.waitForFunction(() => document.querySelector('.tools-project-error')?.textContent.includes('DEMO_DELETE_OFFLINE'));
  assert.equal(await row(page).count(), 1);
  assert.equal(await row(page).locator('.tools-delete').isEnabled(), true);
  await row(page).locator('.tools-delete').click();
  await page.locator('#delete-modal-confirm').click();
  await row(page).waitFor({ state: 'detached' });
  assert.equal(receivedRoot, "/demo/team's project");
  assert.equal(await page.evaluate(() => state.activeProjectId), '');
  assert.equal(await page.locator('#frameworks-project-input').inputValue(), '');
});

test('a list response started before a successful delete cannot resurrect its row', async t => {
  const { page, fixture } = await workspace(t);
  let projects = fixture.projects;
  let delayed = true;
  await page.route('**/api/v1/projects', async route => {
    const captured = projects;
    if (delayed) { delayed = false; await delay(450); }
    await route.fulfill({ json: captured });
  });
  await page.route('**/api/v1/index/project?**', route => {
    projects = projects.filter(p => p.projectId !== pid);
    return route.fulfill({ json: { status: 'deleted' } });
  });
  await page.evaluate(() => { renderProjectsManage(); });
  await row(page).locator('.tools-delete').click();
  await page.locator('#delete-modal-confirm').click();
  await row(page).waitFor({ state: 'detached' });
  await delay(550);
  assert.equal(await row(page).count(), 0);
});

test('framework requests validate inputs, recover from HTTP failure, and ignore old project results', async t => {
  const { page } = await workspace(t);
  let reads = 0;
  let fail = true;
  await page.route('**/api/v1/frameworks/*', async route => {
    reads++;
    const id = new URL(route.request().url()).pathname.split('/').pop();
    if (id === pid && !fail) await delay(250);
    await route.fulfill(fail ? { status: 503, json: { error: 'DEMO_FRAMEWORKS_OFFLINE' } } : { json: framework(id) });
  });
  await page.locator('#frameworks-project-input').fill('');
  await page.locator('#frameworks-submit').click();
  assert.match(await page.locator('#frameworks-result').innerText(), /Select a project/);
  assert.equal(reads, 0);
  await page.locator('#frameworks-project-input').fill(pid);
  await page.locator('#frameworks-submit').click();
  await page.waitForFunction(() => document.querySelector('#frameworks-result').textContent.includes('DEMO_FRAMEWORKS_OFFLINE'));
  fail = false;
  await page.locator('#frameworks-result .tools-retry').click();
  await page.locator('#frameworks-project-input').fill(otherPid);
  await page.locator('#frameworks-submit').click();
  await page.waitForFunction(() => document.querySelector('#frameworks-result').textContent.includes('d3e000000002#handle'));
  await delay(350);
  assert.doesNotMatch(await page.locator('#frameworks-result').innerText(), /d3e000000001#handle/);
  await page.evaluate(() => setGlobalProject(''));
  assert.doesNotMatch(await page.locator('#frameworks-result').innerText(), /#handle/);
});

test('SBOM exports retain a real download link for the current project and discard stale generation', async t => {
  const { page } = await workspace(t);
  await page.route('**/api/v1/sbom/*?**', async route => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    if (id === pid) await delay(250);
    await route.fulfill({ json: { bomFormat: 'CycloneDX', metadata: { component: { name: id } }, components: [] } });
  });
  await page.locator('#sbom-project-input').fill('not-indexed');
  await page.locator('#sbom-submit').click();
  assert.match(await page.locator('#sbom-result').innerText(), /indexed project/);
  await page.locator('#sbom-project-input').fill(pid);
  await page.locator('#sbom-submit').click();
  await page.locator('#sbom-project-input').fill(otherPid);
  await page.locator('#sbom-submit').click();
  const download = page.locator('#sbom-result a[download]');
  await download.waitFor();
  await delay(350);
  assert.equal(await download.getAttribute('download'), `sbom-${otherPid}.json`);
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  assert.equal(file.suggestedFilename(), `sbom-${otherPid}.json`);
  await page.locator('#sbom-project-input').fill('');
  assert.equal(await page.locator('#sbom-result a[download]').count(), 0);
});

test('390px project cards wrap long paths and language refresh preserves search focus and query', async t => {
  const { page, fixture } = await workspace(t, { viewport: { width: 390, height: 844 } });
  const projects = [{ ...fixture.projects[0], projectRoot: '/demo/' + 'long-project-path'.repeat(12) }];
  await page.route('**/api/v1/projects', route => route.fulfill({ json: projects }));
  await page.evaluate(() => renderProjectsManage());
  await page.locator('#tools-project-search').fill('long-project');
  await page.locator('#tools-project-search').focus();
  await page.evaluate(() => { applyLang(); applyLang(); });
  assert.equal(await page.locator('#tools-project-search').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#tools-project-search').inputValue(), 'long-project');
  const sizes = await page.locator('#panel-tools .panel-body').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  assert.ok(sizes.scroll <= sizes.client + 1, JSON.stringify(sizes));
  await page.screenshot({ path: '/tmp/repograph-tools-mobile.png', fullPage: true });
});

test('cancelling deletion after a concurrent list refresh restores its button and keyboard focus', async t => {
  const { page, fixture } = await workspace(t);
  await page.route('**/api/v1/projects', async route => {
    await delay(250);
    await route.fulfill({ json: fixture.projects });
  });
  await page.evaluate(() => { renderProjectsManage(); });
  await row(page).locator('.tools-delete').click();
  await page.waitForFunction(() => document.querySelector('#projects-manage-list').getAttribute('aria-busy') === 'false');
  await page.locator('#delete-modal-cancel').click();
  assert.equal(await row(page).locator('.tools-delete').isEnabled(), true);
  assert.equal(await row(page).locator('.tools-delete').evaluate(el => el === document.activeElement), true);
});

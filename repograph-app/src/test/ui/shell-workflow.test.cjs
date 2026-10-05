'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const installFixtures = require('./fixtures.cjs');
const baseUrl = process.env.UI_BASE_URL;
if (!baseUrl) throw new Error('Set UI_BASE_URL to the isolated RepoGraph preview server.');
const projectA = 'd3e000000001';
const projectB = 'd3e000000002';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' }); });
after(async () => { await browser?.close(); });

async function workspace(t) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.addInitScript(() => {
    localStorage.setItem('repograph_lang', 'en');
    localStorage.removeItem('repograph_active_project');
  });
  t.after(async () => {
    await page.unrouteAll({ behavior: 'wait' });
    await page.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(fixture.unhandledRequests, [], 'Every API request uses fictional fixtures');
  });
  await page.goto(new URL('#search', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Alpine && document.querySelectorAll('#global-project option').length === 3);
  return { page, fixture };
}

async function panel(page, name) {
  await page.locator(`.nav-btn[data-panel="${name}"]`).click();
  await page.waitForFunction(name => document.querySelector('.panel.active')?.id === `panel-${name}`, name);
}

async function projectOptions(page, selector) {
  await page.waitForFunction(selector => document.querySelector(selector)?.options.length === 3, selector);
}

async function selected(page, selector, projectId) {
  await page.waitForFunction(({ selector, projectId }) => document.querySelector(selector)?.value === projectId,
    { selector, projectId });
}

test('global project changes retarget an already loaded vulnerabilities or metrics panel', async t => {
  for (const scope of [
    { panel: 'vulns', select: '#vuln-project-select', path: '/api/v1/vulns' },
    { panel: 'metrics', select: '#metrics-project-select', path: '/api/v1/metrics/report' },
  ]) {
    await t.test(scope.panel, async t => {
      const { page, fixture } = await workspace(t);
      await page.locator('#global-project').selectOption(projectA);
      await panel(page, scope.panel);
      await projectOptions(page, scope.select);
      await page.locator(scope.select).selectOption(projectA);
      await page.waitForFunction(() => document.querySelector('.panel.active')?.textContent.length > 0);
      const start = fixture.requested.length;
      await page.locator('#global-project').selectOption(projectB);
      await selected(page, scope.select, projectB);
      await page.waitForFunction(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert(fixture.requested.slice(start).some(request => {
        const url = new URL(request.slice('GET '.length), baseUrl);
        return url.pathname === scope.path && url.searchParams.get('projectId') === projectB;
      }), 'Changing the global project refreshes the active panel for that project');
      if (scope.panel === 'vulns') {
        await page.waitForFunction(() => !document.querySelector('#vuln-list').textContent.includes('[DEMO]'));
      }
    });
  }
});

test('project selection survives first panel entry, Agent changes, and clearing the global scope', async t => {
  const { page } = await workspace(t);
  assert.equal(await page.locator('#global-project').inputValue(), '');
  await page.locator('#global-project').selectOption(projectB);
  for (const name of ['vulns', 'metrics']) {
    await panel(page, name);
    await projectOptions(page, `#${name === 'vulns' ? 'vuln' : name}-project-select`);
    await selected(page, `#${name === 'vulns' ? 'vuln' : name}-project-select`, projectB);
  }
  await panel(page, 'agent');
  await projectOptions(page, '#agent-project-select');
  await page.locator('#agent-project-select').selectOption(projectA);
  await selected(page, '#global-project', projectA);
  await page.locator('#global-project').selectOption('');
  await selected(page, '#agent-project-select', '');
  for (const name of ['vulns', 'metrics']) {
    await panel(page, name);
    await projectOptions(page, `#${name === 'vulns' ? 'vuln' : name}-project-select`);
    await selected(page, `#${name === 'vulns' ? 'vuln' : name}-project-select`, '');
  }
  assert.equal(await page.locator('#architecture-review-btn').isDisabled(), true);
  assert.equal(await page.locator('#metrics-tab-content').textContent(), '');
  await panel(page, 'vulns');
  assert.equal(await page.locator('#vuln-scan-btn').isDisabled(), true);
  assert.doesNotMatch(await page.locator('#vuln-list').textContent(), /\[DEMO\]/);
});

test('statistics kind drill-down leaves code mode and keeps the requested semantic kind', async t => {
  const { page, fixture } = await workspace(t);
  await page.locator('[data-group="kind"][data-val="METHOD"]').click();
  await page.locator('#search-input').fill('demo orders');
  await page.locator('#search-input').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#search-results .result-card').length === 3);
  await page.locator('#search-tab-row [data-i18n="tab.code"]').click();
  await panel(page, 'stats');
  const start = fixture.requested.length;
  // Exercise the shared action independently of the statistics panel's changing visual markup.
  await page.evaluate(() => drillToKind('METHOD'));
  await page.waitForFunction(() => document.querySelector('.panel.active')?.id === 'panel-search');
  await page.waitForFunction(() => document.querySelector('#search-tab-row [data-i18n="tab.semantic"]')
    .getAttribute('aria-pressed') === 'true');
  assert.equal(await page.locator('[data-group="kind"][data-val="METHOD"]').getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => document.querySelector('#search-results').getAttribute('aria-busy') === 'false');
  assert(fixture.requested.slice(start).some(request => {
    const url = new URL(request.slice('GET '.length), baseUrl);
    return url.pathname === '/api/v1/search/semantic' && url.searchParams.get('kind') === 'METHOD';
  }));
  assert(fixture.requested.filter(request => request.includes('/api/v1/search/')).every(request =>
    !new URL(request.slice('GET '.length), baseUrl).searchParams.has('projectId')),
  'Search APIs keep their existing all-project contract');
});

test('late metrics from project A cannot overwrite the displayed health and rows for project B', async t => {
  const { page } = await workspace(t);
  await panel(page, 'metrics');
  await projectOptions(page, '#metrics-project-select');
  let releaseOld;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  await page.route('**/api/v1/metrics/**', async route => {
    const url = new URL(route.request().url());
    const old = url.searchParams.get('projectId') === projectA;
    if (old) await oldGate;
    const body = url.pathname.endsWith('/report')
      ? { projectId: old ? projectA : projectB, healthScore: old ? 12 : 96, totalProductionMethods: 100,
        deadCodeCount: 0, testGapCount: 0, highComplexityMethods: 0, highInstabilityClasses: 0, packageCycles: 0 }
      : [{ qualifiedName: `demo.orders.Service#${old ? 'staleProjectA' : 'currentProjectB'}()`,
        filePath: 'DemoService.java', startLine: 1, complexity: 3 }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const oldRequests = ['report', 'complexity'].map(endpoint => page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === `/api/v1/metrics/${endpoint}` && url.searchParams.get('projectId') === projectA;
  }));
  let requests = [];
  try {
    await page.locator('#metrics-project-select').selectOption(projectA);
    requests = await Promise.all(oldRequests);
    await page.locator('#metrics-project-select').selectOption(projectB);
    await page.waitForFunction(() => document.querySelector('#metrics-tab-content').textContent.includes('currentProjectB')
      && document.querySelector('#metrics-health').textContent.includes('96'));
  } finally {
    releaseOld();
    await Promise.all(requests.map(async request => { const response = await request.response(); await response?.finished(); }));
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.match(await page.locator('#metrics-tab-content').textContent(), /currentProjectB/);
  assert.doesNotMatch(await page.locator('#metrics-tab-content').textContent(), /staleProjectA/);
  assert.match(await page.locator('#metrics-health').textContent(), /96/);
  assert.equal(await page.locator('#metrics-project-select').inputValue(), projectB);
});

test('changing the metrics limit within one project discards a slower previous limit', async t => {
  const { page } = await workspace(t);
  await panel(page, 'metrics');
  await projectOptions(page, '#metrics-project-select');
  let releaseOld;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  await page.route('**/api/v1/metrics/complexity?*', async route => {
    const limit = new URL(route.request().url()).searchParams.get('limit');
    if (limit === '20') await oldGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { qualifiedName: `demo.orders.Service#${limit === '20' ? 'staleTopTwenty' : 'currentTopTen'}()`,
        filePath: 'DemoService.java', startLine: 1, complexity: 3 },
    ]) });
  });
  const oldRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/v1/metrics/complexity' && url.searchParams.get('limit') === '20';
  });
  let request;
  try {
    await page.locator('#metrics-project-select').selectOption(projectA);
    request = await oldRequest;
    await page.locator('#complexity-limit').selectOption('10');
    await page.waitForFunction(() => document.querySelector('#metrics-tab-content').textContent.includes('currentTopTen'));
  } finally {
    releaseOld();
    if (request) { const response = await request.response(); await response?.finished(); }
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#metrics-project-select').inputValue(), projectA);
  assert.equal(await page.locator('#complexity-limit').inputValue(), '10');
  assert.match(await page.locator('#metrics-tab-content').textContent(), /currentTopTen/);
  assert.doesNotMatch(await page.locator('#metrics-tab-content').textContent(), /staleTopTwenty/);
});

test('returning to metrics for the same project preserves the existing architecture review', async t => {
  const { page } = await workspace(t);
  await panel(page, 'metrics');
  await projectOptions(page, '#metrics-project-select');
  await page.locator('#metrics-project-select').selectOption(projectA);
  await page.evaluate(() => renderArchitectureReview({
    status: 'COMPLETED', methodology: 'DEMO fixture only', model: 'demo-disabled-model',
    observations: ['[DEMO] Keep this existing architecture observation across navigation.'],
    candidates: [], evidence: [], missingInfo: [],
  }));
  const existing = await page.locator('#architecture-review-result').textContent();
  assert.match(existing, /Keep this existing architecture observation/);
  await panel(page, 'search');
  const refreshedProjects = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/projects');
  await panel(page, 'metrics');
  await (await refreshedProjects).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#metrics-project-select').inputValue(), projectA);
  assert.equal(await page.locator('#architecture-review-result').textContent(), existing);
});

test('project deletion sends its root and invalidates a project list requested before deletion', async t => {
  const { page, fixture } = await workspace(t);
  const deleted = fixture.projects.find(project => project.projectId === projectA);
  let releaseOld;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  let listRequests = 0;
  await page.route('**/api/v1/projects', async route => {
    const old = ++listRequests === 1;
    if (old) await oldGate;
    const projects = old
      ? fixture.projects.map(project => ({ ...project, nodeCount: 99999 }))
      : fixture.projects.filter(project => project.projectId !== projectA);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projects) });
  });
  let deletion;
  await page.route('**/api/v1/index/project?*', async route => {
    deletion = { method: route.request().method(), url: new URL(route.request().url()) };
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'deleted', projectId: projectA }) });
  });
  const oldRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/projects');
  try {
    await page.evaluate(() => { window.demoOldProjectRefresh = refreshProjectsList(); });
    await oldRequest;
    await page.evaluate(project => api.deleteProject(project.projectId, project.projectRoot), deleted);
    assert.equal(deletion.method, 'DELETE');
    assert.equal(deletion.url.searchParams.get('projectId'), projectA);
    assert.equal(deletion.url.searchParams.get('projectRoot'), deleted.projectRoot);
  } finally {
    releaseOld();
    await page.evaluate(() => window.demoOldProjectRefresh);
  }
  assert.deepEqual(await page.evaluate(() => state.projects.map(project => project.nodeCount)),
    fixture.projects.map(project => project.nodeCount), 'The pre-delete response cannot overwrite the known project list');
  assert.doesNotMatch(await page.locator('#global-project').textContent(), /99999/);
  await page.evaluate(() => refreshProjectsList());
  assert.deepEqual(await page.locator('#global-project option').evaluateAll(options => options.map(option => option.value)),
    ['', projectB]);
});

test('project refresh responses arriving out of order preserve the latest list and completion options', async t => {
  const { page, fixture } = await workspace(t);
  let releaseOld;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const latest = [{ ...fixture.projects.find(project => project.projectId === projectB),
    projectRoot: '/demo/Demo Inventory Refreshed', nodeCount: 777 }];
  let listRequests = 0;
  await page.route('**/api/v1/projects', async route => {
    const old = ++listRequests === 1;
    if (old) await oldGate;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(old ? fixture.projects : latest) });
  });
  const oldRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/projects');
  try {
    await page.evaluate(() => { window.demoOldProjectRefresh = refreshProjectsList(); });
    await oldRequest;
    await page.evaluate(() => refreshProjectsList());
    assert.deepEqual(await page.evaluate(() => state.projects), latest);
  } finally {
    releaseOld();
    await page.evaluate(() => window.demoOldProjectRefresh);
  }
  assert.deepEqual(await page.evaluate(() => state.projects), latest);
  assert.deepEqual(await page.locator('#global-project option').evaluateAll(options => options.map(option => option.value)),
    ['', projectB]);
  assert.match(await page.locator('#global-project').textContent(), /Demo Inventory Refreshed.*777/);
  assert.deepEqual(await page.locator('#projects-datalist option').evaluateAll(options => options.map(option => option.value)),
    ['Demo Inventory Refreshed']);
});

test('deleting the selected project from statistics clears global scope and the old index result', async t => {
  const { page, fixture } = await workspace(t);
  const project = fixture.projects.find(item => item.projectId === projectA);
  let deletion;
  let deleted = false;
  await page.route('**/api/v1/projects', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify(fixture.projects.filter(item => !deleted || item.projectId !== projectA)) }));
  await page.route('**/api/v1/index/project/status?*', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ status: 'done', totalFiles: 12,
      parsedFiles: 12, totalUnits: 321, totalEdges: 456, durationMs: 1200, errors: [] }) }));
  await page.route('**/api/v1/index/project?*', route => {
    deletion = { method: route.request().method(), url: new URL(route.request().url()) };
    deleted = true;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'deleted', projectId: projectA }) });
  });
  await page.locator('#global-project').selectOption(projectA);
  await panel(page, 'index');
  await page.locator('#index-root').fill(project.projectRoot);
  await page.locator('#status-btn').click();
  await page.waitForFunction(() => document.getElementById('stat-units').textContent === '321');
  await panel(page, 'stats');
  await page.locator('.stats-delete-btn').click();
  await page.locator('#delete-modal-confirm').click();
  await page.waitForFunction(() => state.activeProjectId === '' && document.getElementById('stat-units').textContent === '—');
  assert.equal(deletion.method, 'DELETE');
  assert.equal(deletion.url.searchParams.get('projectId'), projectA);
  assert.equal(deletion.url.searchParams.get('projectRoot'), project.projectRoot);
  assert.equal(await page.locator('#global-project').inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.getItem('repograph_active_project')), '');
  await panel(page, 'index');
  assert.equal(await page.locator('#index-state-card').getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('#stat-units').textContent(), '—');
  assert.equal(await page.locator('#stat-edges').textContent(), '—');
});

test('global project changes discard a pending symbol response and scope the next lookup', async t => {
  const { page, fixture } = await workspace(t);
  let releaseOld;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const scopes = [];
  await page.route('**/api/v1/symbol/**', async route => {
    const scope = new URL(route.request().url()).searchParams.get('projectId');
    scopes.push(scope);
    if (scope === projectA) await oldGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...fixture.units[0],
      qualifiedName: `demo.orders.Service#${scope === projectA ? 'staleScopeA' : 'currentScopeB'}()` }) });
  });
  await page.locator('#global-project').selectOption(projectA);
  await panel(page, 'symbol');
  const pending = page.waitForRequest(request => new URL(request.url()).pathname.startsWith('/api/v1/symbol/'));
  let oldRequest;
  try {
    await page.locator('#symbol-qn-input').fill('demo.orders.Service#lookup()');
    await page.locator('#symbol-qn-input').press('Enter');
    oldRequest = await pending;
    await page.locator('#global-project').selectOption(projectB);
    await page.locator('#symbol-qn-input').fill('demo.orders.Service#lookup()');
    await page.locator('#symbol-qn-input').press('Enter');
    await page.waitForFunction(() => document.getElementById('symbol-result').textContent.includes('currentScopeB'));
  } finally {
    releaseOld();
    if (oldRequest) { const response = await oldRequest.response(); await response?.finished(); }
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(scopes, [projectA, projectB]);
  assert.match(await page.locator('#symbol-result').textContent(), /currentScopeB/);
  assert.doesNotMatch(await page.locator('#symbol-result').textContent(), /staleScopeA/);
});

test('global project changes withdraw the previous SBOM download and ignore pending old data', async t => {
  const { page, fixture } = await workspace(t);
  const project = fixture.projects.find(item => item.projectId === projectA);
  let releaseOld;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  let calls = 0;
  const roots = [];
  await page.route('**/api/v1/sbom/*?*', async route => {
    const request = ++calls;
    roots.push(new URL(route.request().url()).searchParams.get('projectRoot'));
    if (request === 2) await oldGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...fixture.sbom,
      metadata: { ...fixture.sbom.metadata, component: { ...fixture.sbom.metadata.component,
        name: request === 1 ? 'DEMO previous scope A' : 'DEMO late scope A' } } }) });
  });
  await page.locator('#global-project').selectOption(projectA);
  await panel(page, 'sbom');
  await page.evaluate(() => loadSbomView());
  await page.locator('#sbom-download-btn').waitFor({ state: 'visible' });
  assert.match(await page.locator('#sbom-view-content').textContent(), /DEMO previous scope A/);
  await page.locator('#global-project').selectOption(projectB);
  assert.equal(await page.locator('#sbom-download-btn').isVisible(), false);
  assert.doesNotMatch(await page.locator('#sbom-view-content').textContent(), /DEMO previous scope A/);
  await page.locator('#global-project').selectOption(projectA);
  const pending = page.waitForRequest(request => new URL(request.url()).pathname.startsWith('/api/v1/sbom/'));
  try {
    await page.evaluate(() => { window.demoPendingSbom = loadSbomView(); });
    await pending;
    await page.locator('#global-project').selectOption(projectB);
    assert.equal(await page.locator('#sbom-download-btn').isVisible(), false);
  } finally {
    releaseOld();
    await page.evaluate(() => window.demoPendingSbom);
  }
  assert.deepEqual(roots, [project.projectRoot, project.projectRoot]);
  assert.equal(await page.locator('#sbom-download-btn').isVisible(), false);
  assert.doesNotMatch(await page.locator('#sbom-view-content').textContent(), /DEMO (previous|late) scope A/);
});

for (const inspectedProject of [projectA, projectB]) {
  test(`deleting nonactive project A ${inspectedProject === projectA ? 'withdraws its' : 'preserves project B'} SBOM viewer and tool download`, async t => {
    const { page, fixture } = await workspace(t);
    const deletedProject = fixture.projects.find(item => item.projectId === projectA);
    const inspectedLabel = inspectedProject === projectA ? 'DEMO deleted project A' : 'DEMO retained project B';
    await page.route('**/api/v1/sbom/*?*', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ ...fixture.sbom,
        metadata: { ...fixture.sbom.metadata, component: { ...fixture.sbom.metadata.component, name: inspectedLabel } } }) }));
    let deletions = 0;
    await page.route('**/api/v1/index/project?*', route => {
      assert.equal(route.request().method(), 'DELETE');
      assert.equal(new URL(route.request().url()).searchParams.get('projectRoot'), deletedProject.projectRoot);
      deletions++;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'deleted', projectId: projectA }) });
    });
    await page.locator('#global-project').selectOption(projectB);
    await panel(page, 'sbom');
    await page.locator('#sbom-view-input').fill(inspectedProject);
    await page.evaluate(() => loadSbomView());
    await page.locator('#sbom-download-btn').waitFor({ state: 'visible' });
    await panel(page, 'tools');
    await page.locator('#sbom-project-input').fill(inspectedProject);
    await page.evaluate(() => doSbom());
    await page.locator('#sbom-result a[download]').waitFor();
    const previousToolUrl = await page.locator('#sbom-result a[download]').getAttribute('href');
    await page.evaluate(project => api.deleteProject(project.projectId, project.projectRoot), deletedProject);
    assert.equal(deletions, 1);
    assert.equal(await page.locator('#global-project').inputValue(), projectB);
    assert.equal(await page.evaluate(() => state.activeProjectId), projectB);
    if (inspectedProject === projectA) {
      assert.equal(await page.locator('#sbom-result a[download]').count(), 0);
      await panel(page, 'sbom');
      assert.equal(await page.locator('#sbom-download-btn').isVisible(), false);
      assert.doesNotMatch(await page.locator('#sbom-view-content').textContent(), /DEMO deleted project A/);
    } else {
      assert.equal(await page.locator('#sbom-result a[download]').getAttribute('href'), previousToolUrl);
      await panel(page, 'sbom');
      assert.equal(await page.locator('#sbom-download-btn').isVisible(), true);
      assert.match(await page.locator('#sbom-view-content').textContent(), /DEMO retained project B/);
    }
  });
}

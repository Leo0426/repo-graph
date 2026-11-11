'use strict';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const {chromium}=require('playwright');const fixtures=require('./fixtures.cjs');let browser;
before(async()=>browser=await chromium.launch({channel:'chrome',headless:true}));after(async()=>browser?.close());
async function setup(t,width=1440) {
 const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const fixture=await fixtures(page);
 await page.addInitScript(()=>localStorage.setItem('repograph_active_project','d3e000000001'));
 t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
 await page.goto(process.env.UI_BASE_URL+'/#graph');
 await page.waitForFunction(()=>document.querySelector('#global-project').options.length===3);
 return {page,fixture};
}
test('common relationship tasks remain direct and all diagnostic queries are available under more',async t=>{
 const {page}=await setup(t);
 assert.equal(await page.locator('#graph-more-queries').evaluate(e=>e.open),false);
 assert.equal(await page.locator('#graph-tab-row > button:visible').count(),3);
 for(const mode of ['callers','callees','impact']) {
  await page.locator(`#graph-tab-row button[onclick*="'${mode}'"]`).click();
  await page.locator('#graph-target').fill('demo.orders.OrderController#findOrders(String)');
  await page.locator('#graph-query-btn').click();await page.locator('.graph-node').first().waitFor();
  assert.match(await page.locator('#graph-current-mode').textContent(),/调用|影响/);
 }
 await page.locator('#graph-more-queries > summary').click();
 assert.equal(await page.locator('#graph-more-queries button').count(),5);
 await page.locator('#graph-more-queries button[onclick*="subtypes"]').click();
 assert.match(await page.locator('#graph-current-mode').textContent(),/子类型/);
});

test('keyboard node selection highlights displayed relations and source reading preserves zoom and selection',async t=>{
 const {page,fixture}=await setup(t);
 await page.locator('#graph-target').fill(fixture.units[1].qualifiedName);await page.locator('#graph-query-btn').click();
 await page.waitForFunction(()=>document.querySelectorAll('.graph-node').length===4);
 const node=page.locator('.graph-node').nth(1);await node.focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('.graph-connection.is-context').count(),1);
 assert.equal(await page.locator('.graph-node.is-context').count(),2);
 await page.locator('[data-i18n-title="graph.zoomIn"]').click();
 const transform=await page.locator('#graph-svg .zoom-g').getAttribute('transform');
 await page.locator('#graph-source-btn').click();
 await page.locator('#result-reader[open]').waitFor();
 assert.match(await page.locator('#reader-heading').textContent(),/OrderController/);
 await page.locator('#reader-close').click();
 assert.equal(await page.locator('#graph-svg .zoom-g').getAttribute('transform'),transform);
 assert.equal(await node.getAttribute('aria-pressed'),'true');
 assert.match(await page.locator('#graph-related-hint').textContent(),/可达关系/);
});

test('a project-level result pivots to actual symbol callers and isolated flow nodes remain keyboard-readable',async t=>{
 const {page,fixture}=await setup(t,390);
 await page.locator('#graph-more-queries > summary').click();
 await page.locator('[data-i18n="graph.entrypoints"]').click();await page.locator('#graph-query-btn').click();
 await page.locator('.graph-node').nth(1).focus();await page.keyboard.press('Enter');
 const pivot=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/graph/callers');
 await page.locator('#graph-pivot-btn').click();
 assert.equal(new URL((await pivot).url()).searchParams.get('target'),fixture.units[0].qualifiedName);
 const unit=fixture.units[0];
 await page.route('**/api/v1/flow/analyze?*',r=>r.fulfill({json:{target:unit.qualifiedName,summary:{},
   controlFlowGraph:{nodes:[{id:'only',kind:'STATEMENT',label:'isolated statement',line:42}],edges:[]},
   programDependenceGraph:{nodes:[],edges:[]}}}));
 await page.locator('[data-i18n="graph.flow"]').click();
 await page.locator('#graph-target').fill(unit.qualifiedName);await page.locator('#graph-query-btn').click();
 const node=page.locator('.flow-node');await node.focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('.graph-connection').count(),0);
 assert.match(await page.locator('#node-detail-content').textContent(),/isolated statement/);
 await page.locator('#graph-source-btn').click();await page.locator('#result-reader[open]').waitFor();
 assert.match(await page.locator('#reader-content').textContent(),/OrderController/);
});

test('continuing from each project-level graph keeps its displayed repository instead of a previous symbol form',async t=>{
 const {page,fixture}=await setup(t);
 const displayedProject=fixture.projects[1].projectId;
 await page.route(/\/api\/v1\/graph\/(entrypoints|deadcode|testgaps)\?/,r=>r.fulfill({json:fixture.units}));
 await page.locator('#graph-more-queries > summary').click();
 for(const mode of ['entrypoints','deadcode','testgap']) {
  await page.locator('#graph-project').fill(fixture.projects[0].projectId);
  await page.locator(`#graph-tab-row button[onclick*="'${mode}'"]`).click();
  await page.locator('#entrypoints-project').fill(displayedProject);
  await page.locator('#graph-query-btn').click();
  await page.locator('.graph-node').nth(1).focus();await page.keyboard.press('Enter');
  const pivot=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/graph/callers');
  await page.locator('#graph-pivot-btn').click();
  const parameters=new URL((await pivot).url()).searchParams;
  assert.equal(parameters.get('projectId'),displayedProject,mode+' retains its displayed repository');
  assert.equal(parameters.get('target'),fixture.units[0].qualifiedName,mode+' retains its selected symbol');
 }
});

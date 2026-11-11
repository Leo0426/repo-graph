'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fixtures=require('./fixtures.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>browser?.close());
async function setup(t, {projectId} = {}) {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=await fixtures(page);
  if(projectId)await page.addInitScript(id=>localStorage.setItem('repograph_active_project',id),projectId);
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
  await page.goto(process.env.UI_BASE_URL+'/#search');
  await page.waitForFunction(()=>document.querySelector('#global-project').options.length===3);
  return {page,fixture};
}
test('search defaults to the current repository and cross-repository scope is an explicit choice',async t=>{
  const {page,fixture}=await setup(t);
  assert.equal(await page.locator('#search-scope-select').inputValue(),'current');
  await page.locator('#search-input').fill('orders');await page.locator('#search-input').press('Enter');
  await page.locator('#search-scope-message').filter({hasText:'选择仓库'}).waitFor();
  assert.equal(fixture.requested.some(r=>r.includes('/search/')),false);
  await page.locator('#global-project').selectOption('d3e000000001');
  assert.match(await page.locator('#search-scope-message').textContent(),/Order Service/);
  const current=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/search/semantic');
  await page.locator('#search-input').press('Enter');
  assert.equal(new URL((await current).url()).searchParams.get('projectId'),'d3e000000001');
  await page.locator('.result-card').first().waitFor();
  const all=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/search/authorized/semantic');
  await page.locator('#search-scope-select').selectOption('authorized');await all;
  assert.equal(await page.locator('#global-project').inputValue(),'d3e000000001');
  assert.match(await page.locator('#search-scope-message').textContent(),/已授权/);
});

test('scope and repository survive reload, same-panel history, and an explicit cleared selection',async t=>{
  const {page}=await setup(t);
  await page.locator('#global-project').selectOption('d3e000000001');
  await page.locator('#global-project').selectOption('d3e000000002');
  await page.goBack();
  await page.waitForFunction(()=>document.querySelector('#global-project').value==='d3e000000001');
  await page.goForward();
  await page.waitForFunction(()=>document.querySelector('#global-project').value==='d3e000000002');
  await page.locator('#search-scope-select').selectOption('authorized');
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#global-project').value==='d3e000000002');
  assert.equal(await page.locator('#search-scope-select').inputValue(),'authorized');
  await page.locator('#search-scope-select').selectOption('current');
  await page.locator('#global-project').selectOption('');
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#global-project').options.length===3);
  assert.equal(await page.locator('#global-project').inputValue(),'');
  assert.match(await page.locator('#search-scope-message').textContent(),/选择仓库/);
});
test('one change from a restored repository or scope is undone by same-panel browser history',async t=>{
  const {page}=await setup(t,{projectId:'d3e000000001'});
  assert.equal(await page.locator('#global-project').inputValue(),'d3e000000001');
  await page.locator('#global-project').selectOption('d3e000000002');await page.goBack();
  await page.waitForFunction(()=>document.querySelector('#global-project').value==='d3e000000001');
  await page.goForward();await page.waitForFunction(()=>document.querySelector('#global-project').value==='d3e000000002');
  await page.locator('#search-scope-select').selectOption('authorized');await page.goBack();
  await page.waitForFunction(()=>document.querySelector('#search-scope-select').value==='current');
});

test('a cross-repository result opens its own repository even when a symbol name is shared',async t=>{
  const {page,fixture}=await setup(t);
  await page.locator('#global-project').selectOption('d3e000000001');
  await page.route('**/api/v1/search/authorized/semantic?*',r=>r.fulfill({json:{
    results:[{unit:fixture.units[0],score:0.9,projectId:'d3e000000002'}],hasMore:false,offset:0,limit:10}}));
  await page.locator('#search-scope-select').selectOption('authorized');
  await page.locator('#search-input').fill('orders');await page.locator('#search-input').press('Enter');
  const graph=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/graph/callers');
  await page.locator('.rc-open-graph').click();
  await page.locator('#panel-graph.active').waitFor();
  assert.equal(await page.locator('#global-project').inputValue(),'d3e000000002');
  assert.equal(new URL((await graph).url()).searchParams.get('projectId'),'d3e000000002');
  assert.match(await page.locator('#global-project option:checked').textContent(),/Inventory/);
});
test('source navigation overrides an old graph form scope even when the global repository already matches',async t=>{
  const {page,fixture}=await setup(t,{projectId:'d3e000000002'});
  await page.locator('.workspace-tab[data-panel=graph]').click();
  await page.locator('#graph-project').fill(fixture.projects[0].projectId);
  await page.locator('#graph-target').fill(fixture.units[0].qualifiedName);
  const old=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/v1/graph/callers');
  await page.locator('#graph-query-btn').click();
  assert.equal(new URL((await old).url()).searchParams.get('projectId'),fixture.projects[0].projectId);
  assert.equal(await page.locator('#global-project').inputValue(),fixture.projects[1].projectId);
  await page.locator('.workspace-tab[data-panel=search]').click();
  await page.locator('#search-input').fill('orders');await page.locator('#search-input').press('Enter');
  const source=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/v1/graph/callers');
  await page.locator('.rc-open-graph').first().click();
  assert.equal(new URL((await source).url()).searchParams.get('projectId'),fixture.projects[1].projectId);
});

test('switching repository rejects a late response and a refreshed access list clears a revoked selection',async t=>{
  const {page,fixture}=await setup(t);
  let release;
  const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/v1/search/semantic?*',async r=>{
    const pid=new URL(r.request().url()).searchParams.get('projectId');
    if(pid==='d3e000000001') await gate;
    await r.fulfill({json:{results:[{unit:{...fixture.units[0],simpleName:pid==='d3e000000001'?'late A':'current B'},projectId:pid,score:0.9}],hasMore:false}});
  });
  await page.locator('#global-project').selectOption('d3e000000001');
  const started=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/search/semantic');
  await page.locator('#search-input').fill('shared');await page.locator('#search-input').press('Enter');await started;
  await page.locator('#global-project').selectOption('d3e000000002');
  await page.locator('#search-input').press('Enter');
  await page.locator('.rc-title').filter({hasText:'current B'}).waitFor();
  const finished=page.waitForResponse(r=>r.url().includes('/search/semantic')&&new URL(r.url()).searchParams.get('projectId')==='d3e000000001');
  release();await finished;
  assert.equal(await page.locator('.rc-title').textContent(),'current B');
  await page.route('**/api/v1/projects',r=>r.fulfill({json:[fixture.projects[0]]}));
  await page.locator('.nav-btn[data-workspace="repository"]').click();
  await page.waitForFunction(()=>document.querySelector('#global-project').value==='');
  assert.equal(await page.locator('.result-card').count(),0);
});
test('revoking a different repository invalidates an in-flight authorized search while the active repository stays valid',async t=>{
  const {page,fixture}=await setup(t,{projectId:'d3e000000001'});
  let release;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());
  await page.route('**/api/v1/search/authorized/semantic?*',async route=>{
    await gate;await route.fulfill({json:{results:[{projectId:fixture.projects[1].projectId,score:.9,unit:fixture.units[0]}],hasMore:false}});
  });
  await page.locator('#search-scope-select').selectOption('authorized');
  const pending=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/search/authorized/semantic');
  await page.locator('#search-input').fill('delayed authorized');await page.locator('#search-input').press('Enter');await pending;
  await page.route('**/api/v1/projects',route=>route.fulfill({json:[fixture.projects[0]]}));
  await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();
  await page.waitForFunction(()=>document.querySelector('#global-project').options.length===2);
  const finished=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/search/authorized/semantic');
  release();await finished;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#global-project').inputValue(),fixture.projects[0].projectId);
  assert.equal(await page.locator('#search-input').inputValue(),'delayed authorized');
  assert.equal(await page.locator('.result-card').count(),0);
});
test('an authorization-set update withdraws cached reader content and rejects a late page from that set',async t=>{
  const {page,fixture}=await setup(t,{projectId:'d3e000000001'});
  let release;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());
  await page.route('**/api/v1/search/authorized/semantic?*',async route=>{
    const offset=Number(new URL(route.request().url()).searchParams.get('offset')||0);
    if(offset)await gate;
    await route.fulfill({json:{results:[{projectId:fixture.projects[1].projectId,score:.9,unit:fixture.units[0]}],hasMore:!offset}});
  });
  await page.locator('#search-scope-select').selectOption('authorized');
  await page.locator('#search-input').fill('cached authorized');await page.locator('#search-input').press('Enter');
  await page.locator('.rc-read').click();await page.locator('#result-reader[open]').waitFor();
  const pending=page.waitForRequest(request=>new URL(request.url()).searchParams.get('offset')==='1');
  await page.locator('#reader-more').click();await pending;
  await page.route('**/api/v1/projects',route=>route.fulfill({json:[fixture.projects[0]]}));
  await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();
  await page.waitForFunction(()=>document.querySelector('#global-project').options.length===2);
  assert.equal(await page.locator('#result-reader').evaluate(el=>el.open),false);
  assert.equal(await page.locator('.result-card').count(),0);
  assert.match(await page.locator('#search-results').textContent(),/Accessible repositories changed/);
  const finished=page.waitForResponse(response=>new URL(response.url()).searchParams.get('offset')==='1');release();await finished;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.result-card').count(),0);
});

'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fixtures=require('./fixtures.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>browser?.close());
async function setup(t,width=1440) {
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=await fixtures(page);
  await page.route('**/api/v1/summaries?*',r=>r.fulfill({json:[]}));
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
  await page.goto(process.env.UI_BASE_URL+'/#tools');
  await page.locator('.tools-project').first().waitFor();
  return {page,fixture};
}
test('repository rows enter each task directly and preserve the filtered list on return',async t=>{
  const {page,fixture}=await setup(t);
  await page.locator('#tools-project-search').fill('Inventory');
  const card=page.locator('.tools-project[data-project-id="d3e000000002"]');
  await card.locator('[data-tools-action="search"]').click();
  await page.locator('#panel-search.active').waitFor();
  assert.equal(await page.locator('#global-project').inputValue(),'d3e000000002');
  assert.equal(await page.locator('#search-scope-select').inputValue(),'current');
  await page.goBack();await page.locator('#panel-tools.active').waitFor();
  assert.equal(await page.locator('#tools-project-search').inputValue(),'Inventory');
  assert.equal(await card.getAttribute('data-current'),'true');
  await card.locator('[data-tools-action="vulns"]').click();
  await page.locator('#panel-vulns.active').waitFor();
  await page.waitForFunction(()=>document.querySelector('#vuln-project-select').value==='d3e000000002');
  await page.goBack();await page.locator('#panel-tools.active').waitFor();
  await card.locator('[data-tools-action="wiki"]').click();
  await page.locator('#panel-wiki.active').waitFor();
  assert.equal(await page.locator('#global-project').inputValue(),'d3e000000002');
  assert.equal(fixture.requested.some(r=>!r.startsWith('GET ')),false);
});

test('keyboard overview navigation and touch reading preserve complete long repository names',async t=>{
  const {page,fixture}=await setup(t,390);
  const name='Long repository name '+ '业务模块与 source evidence '.repeat(12);
  const project={...fixture.projects[0],projectRoot:'/demo/'+name};
  await page.route('**/api/v1/projects',r=>r.fulfill({json:[project]}));
  await page.locator('#tools-refresh-projects').click();
  await page.waitForFunction(name=>document.querySelector('.tools-project h3').textContent===name,name);
  const heading=page.locator('.tools-project h3');
  assert.equal(await heading.textContent(),name);
  assert.equal(await heading.evaluate(e=>e.scrollHeight<=e.clientHeight+1),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const main=page.locator('[data-tools-action="overview"]');
  assert.match(await main.getAttribute('aria-label'),/Long repository name/);
  await main.focus();await page.keyboard.press('Enter');
  await page.locator('#panel-stats.active').waitFor();
  assert.equal(await page.locator('#global-project').inputValue(),project.projectId);
});

test('return from a repository task restores list scroll and never starts background work',async t=>{
  const {page,fixture}=await setup(t);
  const projects=Array.from({length:30},(_,i)=>({...fixture.projects[0],projectId:'demo-'+i,projectRoot:'/demo/Repository '+i}));
  await page.route('**/api/v1/projects',r=>r.fulfill({json:projects}));
  await page.locator('#tools-refresh-projects').click();
  await page.waitForFunction(()=>document.querySelectorAll('.tools-project').length===30);
  const target=page.locator('.tools-project[data-project-id="demo-20"] [data-tools-action="search"]');
  await target.scrollIntoViewIfNeeded();
  const scroll=await page.locator('#panel-tools .panel-body').evaluate(e=>e.scrollTop);
  await target.click();await page.locator('#panel-search.active').waitFor();
  await page.goBack();await page.locator('#panel-tools.active').waitFor();
  await page.waitForFunction(scroll=>Math.abs(document.querySelector('#panel-tools .panel-body').scrollTop-scroll)<2,scroll);
  assert.equal(fixture.requested.some(r=>!r.startsWith('GET ')),false);
});
test('same-named repositories keep the selected row identity through overview and source-to-graph navigation',async t=>{
  const {page,fixture}=await setup(t);
  const projects=fixture.projects.map((project,i)=>({...project,projectRoot:`/team-${i}/service`}));
  await page.route('**/api/v1/projects',route=>route.fulfill({json:projects}));
  await page.locator('#tools-refresh-projects').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.tools-project h3')].every(el=>el.textContent==='service'));
  await page.locator('#global-project').selectOption(projects[1].projectId);
  await page.locator(`.tools-project[data-project-id="${projects[1].projectId}"] [data-tools-action=overview]`).click();
  await page.locator('#stats-content[data-project-id]').waitFor();
  assert.equal(await page.locator('#stats-content').getAttribute('data-project-id'),projects[1].projectId);
  assert.equal(await page.locator('#global-project').inputValue(),projects[1].projectId);
  await page.locator('#main-navigation [data-workspace=understand]').click();
  await page.locator('#search-input').fill('orders');await page.locator('#search-input').press('Enter');
  const request=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/v1/graph/callers');
  await page.locator('.rc-open-graph').first().click();
  assert.equal(new URL((await request).url()).searchParams.get('projectId'),projects[1].projectId);
});

test('same-named repository overview keeps its exact identity through refresh, direct links and browser history',async t=>{
  const {page,fixture}=await setup(t);
  const projects=fixture.projects.map((project,i)=>({...project,projectRoot:`/team-${i}/service`}));
  const projectId=projects[1].projectId;
  await page.route('**/api/v1/projects',route=>route.fulfill({json:projects}));
  await page.locator('#tools-refresh-projects').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.tools-project h3')].every(el=>el.textContent==='service'));
  await page.locator(`.tools-project[data-project-id="${projectId}"] [data-tools-action=overview]`).click();
  await page.locator(`#stats-content[data-project-id="${projectId}"]`).waitFor();
  for(const navigate of [()=>page.reload(),async()=>{
    await page.goto(process.env.UI_BASE_URL+'/login');
    await page.goto(process.env.UI_BASE_URL+'/#stats='+projectId);
  }]) {
    const read=page.waitForRequest(request=>/^\/api\/v1\/projects\/[^/]+\/stats$/.test(new URL(request.url()).pathname));
    await navigate();
    assert.equal(new URL((await read).url()).pathname,`/api/v1/projects/${projectId}/stats`);
    await page.locator(`#stats-content[data-project-id="${projectId}"]`).waitFor();
    assert.equal(await page.locator('#global-project').inputValue(),projectId);
    assert.equal(await page.locator('#stats-project-input').inputValue(),projectId);
  }
  await page.locator('#main-navigation [data-workspace=understand]').click();
  await page.goBack();await page.locator('#panel-stats.active').waitFor();
  assert.equal(await page.locator('#stats-project-input').inputValue(),projectId);
  assert.equal(await page.locator('#stats-content').getAttribute('data-project-id'),projectId);
});

for(const newestFails of [true,false])test(newestFails
 ?'an explicit repository refresh reports failure when a language refresh replaces the same failed read'
 :'an older failed refresh observes a newer successful catalog instead of showing a stale error',async t=>{
 const {page,fixture}=await setup(t);
 let releaseFirst,releaseSecond,calls=0;
 const gates=[new Promise(resolve=>releaseFirst=resolve),new Promise(resolve=>releaseSecond=resolve)];
 await page.route('**/api/v1/projects',async route=>{
  const index=calls++;await gates[Math.min(index,1)];
  await route.fulfill(index===1&&!newestFails?{json:[fixture.projects[1]]}:{status:503,json:{error:'Catalog offline '+index}});
 });
 try {
  const first=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/v1/projects');
  await page.locator('#tools-refresh-projects').click();await first;
  const second=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/v1/projects');
  await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();await page.keyboard.press('Escape');
  await second;
  releaseSecond();releaseFirst();
  await page.waitForFunction(()=>!document.getElementById('tools-refresh-projects').disabled);
  if(newestFails) {
   await page.locator('.tools-error').filter({hasText:'Catalog offline'}).waitFor();
   assert.ok(await page.locator('.tools-project').count(),'Cached repositories remain available with an explicit error');
   await page.route('**/api/v1/projects',route=>route.fulfill({json:[fixture.projects[1]]}));
   await page.locator('#account-menu > summary').click();await page.locator('#lang-zh').click();await page.keyboard.press('Escape');
   await page.locator(`.tools-project[data-project-id="${fixture.projects[1].projectId}"]`).waitFor();
   await page.waitForFunction(()=>document.querySelectorAll('.tools-project').length===1);
   assert.equal(await page.locator('.tools-error').count(),0,'A later successful read clears the previous catalog failure');
   await page.route('**/api/v1/projects',route=>route.fulfill({status:503,json:{error:'Initial catalog unavailable'}}));
   await page.goto(process.env.UI_BASE_URL+'/login');await page.goto(process.env.UI_BASE_URL+'/#tools');
   await page.locator('.tools-error').filter({hasText:'Initial catalog unavailable'}).waitFor();
   assert.equal(await page.locator('.tools-project').count(),0);
   await page.route('**/api/v1/projects',route=>route.fulfill({json:[fixture.projects[1]]}));
   await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();await page.keyboard.press('Escape');
   await page.locator(`.tools-project[data-project-id="${fixture.projects[1].projectId}"]`).waitFor();
   assert.equal(await page.locator('.tools-error').count(),0,'Successful recovery also applies after the first catalog load failed');
  } else {
   assert.equal(await page.locator('.tools-error').count(),0);
   assert.equal(await page.locator('.tools-project').first().getAttribute('data-project-id'),fixture.projects[1].projectId);
  }
 } finally {releaseFirst();releaseSecond();}
});

'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fixtures=require('./fixtures.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>browser?.close());
async function setup(t,{width=1440,role='ADMIN',generation={configured:true,enabled:false,name:'Demo generation',model:'demo-model'}}={}) {
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=await fixtures(page);
  await page.route('**/api/v1/capabilities/generation',r=>r.fulfill({json:generation}));
  if(role!=='ADMIN') await page.route('**/api/v1/auth/me',r=>r.fulfill({json:{id:'reader',username:'reader',displayName:'Reader',role:'USER',status:'ACTIVE'}}));
  await page.addInitScript(()=>localStorage.setItem('repograph_active_project','d3e000000001'));
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
  return {page,fixture};
}
test('health explains task impact and separates generation configuration from Embedding connectivity',async t=>{
  const {page,fixture}=await setup(t);
  await page.goto(process.env.UI_BASE_URL+'/#health');
  await page.locator('[data-capability="search"][data-state="blocked"]').waitFor();
  assert.match(await page.locator('[data-capability="search"]').textContent(),/Embedding/);
  assert.match(await page.locator('[data-capability="facts"]').textContent(),/Embedding/);
  assert.equal(await page.locator('[data-capability="facts"] [data-capability-open]').isEnabled(),true);
  await page.locator('[data-capability="advisory"][data-state="disabled"]').waitFor();
  assert.match(await page.locator('[data-capability="advisory"]').textContent(),/未启用/);
  assert.match(await page.locator('[data-capability="review"]').textContent(),/冻结/);
  assert.equal(fixture.requested.some(r=>r.startsWith('POST ')||r.startsWith('PUT ')||r.startsWith('DELETE ')),false);
  assert.equal(fixture.requested.some(r=>r.includes('/test')),false);
});

test('enabled generation is unverified and a failed configuration read recovers explicitly',async t=>{
  const {page}=await setup(t,{generation:{configured:true,enabled:true,name:'Saved gateway',model:'model-a'}});
  await page.goto(process.env.UI_BASE_URL+'/#health');
  await page.locator('[data-capability="advisory"][data-state="unverified"]').waitFor();
  assert.match(await page.locator('[data-capability="advisory"]').textContent(),/未验证|尚未验证/);
  await page.route('**/api/v1/capabilities/generation',r=>r.fulfill({status:503,json:{error:'offline'}}));
  await page.locator('#capability-generation-refresh').click();
  await page.locator('[data-capability="advisory"][data-state="unknown"]').waitFor();
  assert.match(await page.locator('#capability-generation-freshness').textContent(),/读取失败/);
  await page.route('**/api/v1/capabilities/generation',r=>r.fulfill({json:{configured:false,enabled:false,name:'',model:''}}));
  await page.locator('#capability-generation-refresh').click();
  await page.locator('[data-capability="advisory"][data-state="notConfigured"]').waitFor();
});

test('readers retain reading paths without administrator controls or implicit model tests',async t=>{
  const {page,fixture}=await setup(t,{width:390,role:'USER'});
  await page.goto(process.env.UI_BASE_URL+'/#health');
  await page.locator('[data-capability="index"][data-state="permission"]').waitFor();
  await page.locator('[data-capability="advisory"][data-state="disabled"]').waitFor();
  await page.locator('[data-capability="advisory"] [data-capability-recover]').click();
  await page.waitForFunction(()=>document.querySelector('#toast-message').textContent.includes('管理员'));
  assert.match(await page.locator('#toast-message').textContent(),/管理员/);
  assert.equal(fixture.requested.some(r=>r.includes('/admin/')||r.includes('/test')||!r.startsWith('GET ')),false);
  await page.route('**/api/v1/projects',r=>r.fulfill({json:[]}));
  await page.locator('[data-capability="index"] [data-capability-open]').click();
  await page.locator('#panel-tools.active').waitFor();
  await page.waitForFunction(()=>document.querySelector('#global-project').value==='');
  await page.evaluate(()=>switchPanel('health'));
  await page.locator('[data-capability="review"][data-state="noProject"]').waitFor();
  assert.match(await page.locator('[data-capability="review"]').textContent(),/管理员分配/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});

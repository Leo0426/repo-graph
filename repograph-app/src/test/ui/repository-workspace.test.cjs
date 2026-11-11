'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const installFixtures=require('./fixtures.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>{await browser?.close();});
async function setup(t,viewport={width:1440,height:1000}) {
 const page=await browser.newPage({viewport,reducedMotion:'reduce'});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const fixture=await installFixtures(page);
 await page.route('**/api/v1/summaries?*',r=>r.fulfill({contentType:'application/json',body:'[]'}));
 t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
 return {page,fixture};
}
test('repository is the starting point and the five domains retain contextual deep links',async t=>{
 const {page}=await setup(t);await page.goto(process.env.UI_BASE_URL,{waitUntil:'networkidle'});
 await page.locator('#panel-tools.active').waitFor();assert.equal(await page.locator('#main-navigation .nav-btn').count(),5);
 assert.equal(await page.locator('.tools-project[data-current="true"]').count(),0);
 await page.locator('.tools-project[data-project-id="d3e000000002"] [data-tools-action="search"]').click();await page.locator('#panel-search.active').waitFor();
 assert.equal(await page.locator('#global-project').inputValue(),'d3e000000002');
 await page.locator('.workspace-tab[data-panel="wiki"]').click();await page.locator('#panel-wiki.active').waitFor();
 await page.reload({waitUntil:'networkidle'});await page.locator('#panel-wiki.active').waitFor();
 assert.equal(await page.locator('.nav-btn[data-workspace="understand"]').getAttribute('aria-current'),'page');
 await page.locator('.nav-btn[data-workspace="repository"]').click();
 await page.locator('.tools-project[data-project-id="d3e000000002"] [data-tools-action="vulns"]').click();await page.locator('#panel-vulns.active').waitFor();
 await page.waitForFunction(()=>document.querySelector('#vuln-project-select').value==='d3e000000002');
 await page.goBack();await page.locator('#panel-tools.active').waitFor();
 await page.locator('#global-project').selectOption('');assert.equal(await page.locator('.tools-project[data-current="true"]').count(),0);
});
test('empty repository workspace has no fabricated results and recovers failed listing',async t=>{
 const {page}=await setup(t);let broken=true;
 await page.route('**/api/v1/projects',route=>route.fulfill({status:broken?503:200,contentType:'application/json',body:broken?'{}':'[]'}));
 await page.goto(process.env.UI_BASE_URL);await page.locator('#tools-project-retry').waitFor();
 assert.equal(await page.locator('.tools-project').count(),0);
 broken=false;await page.locator('#tools-project-retry').click();await page.locator('.tools-empty').waitFor();
 assert.equal(await page.locator('.tools-project').count(),0);
 assert.equal(await page.locator('[data-tools-action="vulns"]').count(),0);
});
test('mobile workspace keeps repository context and translates new navigation',async t=>{
 const {page}=await setup(t,{width:390,height:844});await page.goto(process.env.UI_BASE_URL,{waitUntil:'networkidle'});
 await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();await page.locator('#account-menu > summary').click();assert.equal(await page.locator('#repository-start-title').textContent(),'Repository list');
 assert.equal(await page.locator('#main-navigation').getAttribute('aria-label'),'Main navigation');
 await page.locator('.tools-project').first().locator('[data-tools-action="search"]').click();await page.locator('#nav-toggle').click();
 await page.locator('.nav-btn[data-workspace="defects"]').click();await page.locator('.workspace-tab[data-panel="agent"]').click();
 assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'),'false');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/repograph-repository-mobile.png',animations:'disabled'});
});


test('ordinary users without repositories get an assignment path, not an indexing action',async t=>{
 const {page}=await setup(t);
 await page.route('**/api/v1/auth/me',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({id:'user',username:'reader',displayName:'Reader',role:'USER',status:'ACTIVE'})}));
 await page.route('**/api/v1/projects',r=>r.fulfill({contentType:'application/json',body:'[]'}));
 await page.goto(process.env.UI_BASE_URL,{waitUntil:'networkidle'});
 await page.locator('.tools-empty').waitFor();
 assert.match(await page.locator('.tools-empty').textContent(),/管理员/);
 assert.equal(await page.locator('.tools-empty a[href="#index"]').count(),0);
 assert.equal(await page.locator('.workspace-tab[data-panel="index"]').isVisible(),false);
 assert.equal(await page.locator('[data-tools-action="search"]').count(),0);
 await page.locator('.nav-btn[data-workspace="validation"]').click();
 assert.equal(await page.locator('.workspace-tab[data-panel="benchmark"]').isVisible(),false);
});

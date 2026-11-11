'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const installFixtures=require('./fixtures.cjs');
const audit=require('./visual-contrast.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:process.env.UI_BROWSER||'chrome',headless:true});});
after(async()=>{await browser?.close();});
async function setup(t,viewport,colorScheme = 'light') {
 const page=await browser.newPage({viewport,reducedMotion:'reduce',colorScheme});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const fixture=await installFixtures(page);
 await page.addInitScript(()=>{localStorage.setItem('repograph_active_project','d3e000000001');localStorage.setItem('repograph_lang','zh');});
 await page.route('**/api/v1/admin/**',r=>r.fulfill({contentType:'application/json',body:'[]'}));
 await page.route('**/api/v1/summaries?*',r=>r.fulfill({contentType:'application/json',body:'[]'}));
 t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
 return page;
}
for(const colorScheme of ['light','dark']) for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
 test(`shared visual roles remain readable and fit every workspace at ${viewport.width}px in ${colorScheme}`,async t=>{
  const page=await setup(t,viewport,colorScheme);
  for(const panel of ['tools','search','graph','symbol','stats','index','wiki','vulns','agent','metrics','sbom','health','benchmark','admin']) {
   // Force fresh panel data. Read the actual UI state: an unconsumed fixture 404
   // can remain in Playwright's network-idle accounting after the UI handles it.
   await page.goto(new URL('?visual='+panel+'#'+panel,process.env.UI_BASE_URL).href,{waitUntil:'domcontentloaded'});
   await page.locator('#panel-'+panel+'.active').waitFor();
   await page.waitForFunction(()=>document.querySelectorAll('#global-project option').length>1);
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForFunction(panel=>{
    if(panel==='tools')return document.querySelectorAll('.tools-project').length>0;
    if(panel==='stats')return document.getElementById('stats-content').dataset.projectId==='d3e000000001';
    if(panel==='agent')return agentUi.vulnerabilities.length>0&&agentUi.runs.length>0;
    if(panel==='wiki')return wikiView.projectId==='d3e000000001'&&!wikiView.loading;
    if(panel==='benchmark')return ['empty','ready','error'].includes(benchmarkState.status);
    if(panel==='health')return document.getElementById('sb-health').dataset.state!=='checking';
    return !document.querySelector('.panel.active [aria-busy="true"]');
   },panel);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const result=await audit(page);
   assert.equal(result.overflow,false,panel+' document overflow');
   assert.equal(result.panelOverflow,false,panel+' panel overflow');
   assert.ok(result.checked>8,panel+' has visible content to check');
   assert.deepEqual(result.fail,[],panel+' visible text contrast');
  }
 });
 test(`shell menus and dialogs retain contrast at ${viewport.width}px in ${colorScheme}`,async t=>{
  const page=await setup(t,viewport,colorScheme);
  await page.goto(process.env.UI_BASE_URL,{waitUntil:'networkidle'});
  await page.locator('#account-menu > summary').click();
  assert.deepEqual((await audit(page)).fail,[],'account and service menu contrast');
  await page.keyboard.press('Escape');
  await page.locator('.header-search').click();
  await page.locator('#command-query').waitFor();
  assert.deepEqual((await audit(page)).fail,[],'command palette contrast');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{showDeleteModal('d3e000000001','/demo/project');});
  assert.deepEqual((await audit(page)).fail,[],'delete modal contrast');
  await page.locator('#delete-modal-cancel').click();
 });
 test(`login and registration stay readable and keyboard accessible at ${viewport.width}px in ${colorScheme}`,async t=>{
  const page=await setup(t,viewport,colorScheme);await page.goto(new URL('/login',process.env.UI_BASE_URL).href);
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).colorScheme),colorScheme);
  assert.deepEqual((await audit(page)).fail,[]);
  await page.locator('#username').focus();await page.keyboard.press('Tab');
  assert.equal(await page.locator('#password').evaluate(el=>el===document.activeElement),true);
  await page.locator('#auth-toggle').click();await page.locator('#display-name').waitFor();
  await page.locator('#email').focus();await page.keyboard.press('Tab');
  assert.equal(await page.locator('#password').evaluate(el=>el===document.activeElement),true);
  const result=await audit(page);assert.equal(result.overflow,false);assert.deepEqual(result.fail,[]);
  await page.locator('#auth-toggle').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#auth-toggle').isVisible(),true);
  await page.screenshot({path:`/tmp/repograph-studio-register-${viewport.width}.png`,animations:'disabled'});
 });
}
test('search text stays clear of its icon and modal actions retain readable contrast',async t=>{
 const page=await setup(t,{width:1440,height:1000});await page.goto(new URL('#search',process.env.UI_BASE_URL).href);
 await page.fill('#search-input','find orders');
 const gap=await page.locator('.search-wrap').first().evaluate(el=>{
  const input=el.querySelector('input'),icon=el.querySelector('.search-icon');
  return input.getBoundingClientRect().left+parseFloat(getComputedStyle(input).paddingLeft)-icon.getBoundingClientRect().right;
 });assert.ok(gap>=5,'input text has space after the search icon');
 await page.evaluate(()=>{showDeleteModal('d3e000000001','/demo/project');});
 await page.locator('#delete-modal-confirm').waitFor();
 const result=await audit(page);assert.deepEqual(result.fail,[]);
 await page.locator('#delete-modal-cancel').click();
});


test('short mobile registration can scroll to the submit controls',async t=>{
 const page=await setup(t,{width:390,height:568});await page.goto(new URL('/login',process.env.UI_BASE_URL).href);
 await page.click('#auth-toggle');await page.mouse.move(350,450);await page.mouse.wheel(0,700);
 await page.waitForFunction(()=>document.querySelector('#auth-submit').getBoundingClientRect().bottom<=innerHeight);
 assert.ok(await page.evaluate(()=>scrollY>0),'short screens scroll instead of clipping the form');
});

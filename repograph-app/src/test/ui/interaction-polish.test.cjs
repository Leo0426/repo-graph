'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fixtures=require('./fixtures.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:process.env.UI_BROWSER||'chrome',headless:true});});
after(async()=>browser?.close());
async function setup(t, width=1440) {
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=await fixtures(page);
  await page.addInitScript(()=>{localStorage.setItem('repograph_lang','zh');localStorage.setItem('repograph_active_project','d3e000000001');});
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
  await page.goto(process.env.UI_BASE_URL+'/#tools');
  await page.waitForFunction(()=>document.querySelectorAll('#global-project option').length===3);
  return page;
}
test('current navigation preserves content and does not repeat project requests',async t=>{
  const page=await setup(t);let requests=0;page.on('request',r=>{if(r.url().includes('/api/v1/projects'))requests++;});
  await page.fill('#tools-project-search','Order');
  await page.locator('.workspace-tab[data-panel="tools"]').click();
  assert.equal(requests,0);
  assert.equal(await page.locator('#tools-project-search').inputValue(),'Order');
});
test('returning to search restores reading position and the query',async t=>{
  const page=await setup(t,390);
  await page.evaluate(()=>switchPanel('search'));
  await page.fill('#search-input','order');await page.press('#search-input','Enter');
  await page.locator('.result-card').first().waitFor();
  const position=await page.locator('#panel-search .panel-body').evaluate(el=>{el.scrollTop=420;return el.scrollTop;});
  assert.ok(position>100);
  await page.evaluate(()=>switchPanel('symbol'));
  await page.evaluate(()=>switchPanel('search'));
  assert.equal(await page.locator('#panel-search .panel-body').evaluate(el=>el.scrollTop),position);
  assert.equal(await page.locator('#search-input').inputValue(),'order');
});
test('mobile drawer isolates the background and closes without leaving it inert',async t=>{
  const page=await setup(t,390);await page.click('#nav-toggle');
  assert.equal(await page.locator('#main-content').evaluate(el=>el.inert),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#main-content').evaluate(el=>el.inert),false);
  assert.equal(await page.locator('#nav-toggle').evaluate(el=>el===document.activeElement),true);
  await page.click('#nav-toggle');await page.locator('.nav-btn[data-panel="search"]').click();
  assert.equal(await page.locator('#main-content').evaluate(el=>el.inert),false);
});
test('notifications pause for reading, resume and allow keyboard dismissal with focus return',async t=>{
  const page=await setup(t);await page.clock.install();
  await page.locator('#tools-project-search').focus();
  await page.evaluate(()=>showToast('操作已完成',1000));await page.clock.runFor(32);
  await page.hover('#toast');await page.clock.runFor(1500);
  assert.equal(await page.locator('#toast').evaluate(el=>el.classList.contains('show')),true);
  await page.locator('#toast-dismiss').focus();await page.mouse.move(0,0);await page.clock.runFor(1500);
  assert.equal(await page.locator('#toast').evaluate(el=>el.classList.contains('show')),true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#toast').evaluate(el=>el.inert),true);
  assert.equal(await page.locator('#tools-project-search').evaluate(el=>el===document.activeElement),true);
  await page.evaluate(()=>showToast('第二次操作',1000));await page.clock.runFor(1100);
  assert.equal(await page.locator('#toast').evaluate(el=>el.inert),true);
});
test('errors remain readable longer and replacing a toast cancels the old expiry',async t=>{
  const page=await setup(t);await page.clock.install();
  await page.evaluate(()=>showToast('第一次操作',1000));await page.clock.runFor(800);
  await page.evaluate(()=>showToast('连接失败，请重试',1000,'error'));await page.clock.runFor(4000);
  assert.equal(await page.locator('#toast-message').textContent(),'连接失败，请重试');
  assert.equal(await page.locator('#toast').evaluate(el=>el.inert),false);
  await page.clock.runFor(4100);
  assert.equal(await page.locator('#toast').evaluate(el=>el.inert),true);
});
test('Wiki chapter navigation follows manual reading without stealing focus',async t=>{
  const page=await setup(t);
  await page.route('**/api/v1/summaries?*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify([{id:'reading',projectId:'d3e000000001',title:'阅读测试',docVersion:1,status:'COMPLETED',sections:[0,1,2].map(i=>({title:'章节 '+i,source:'facts',body:Array(25).fill('段落：项目结构与职责。').join('\n\n')})),citations:[]}])}));
  await page.evaluate(()=>switchPanel('wiki'));await page.locator('#wiki-section-2').waitFor({state:'attached'});
  await page.locator('#wiki-toc [data-section="1"]').click();
  await page.waitForFunction(()=>document.querySelector('#wiki-toc [data-section="1"]').getAttribute('aria-current')==='location');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'wiki-section-1');
  await page.locator('#wiki-section-2').evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.waitForFunction(()=>document.querySelector('#wiki-toc [data-section="2"]').getAttribute('aria-current')==='location');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'wiki-section-1');
});

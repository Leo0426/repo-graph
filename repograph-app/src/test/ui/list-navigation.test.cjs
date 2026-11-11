'use strict';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const {chromium}=require('playwright');const install=require('./fixtures.cjs');let browser;
before(async()=>browser=await chromium.launch({channel:'chrome',headless:true}));after(async()=>browser?.close());
async function setup(t) {
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const fixture=await install(page);
 await page.addInitScript(()=>localStorage.setItem('repograph_active_project','d3e000000001'));
 t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[])});
 return {page,fixture};
}
test('repository pagination reports the actual range and returning from a task preserves page and density',async t=>{
 const {page,fixture}=await setup(t);
 const projects=Array.from({length:123},(_,i)=>({...fixture.projects[0],projectId:`repo-${i}`,projectRoot:`/fictional/Repository-${String(i).padStart(3,'0')}`}));
 await page.route('**/api/v1/projects',route=>route.fulfill({json:projects}));
 await page.goto(process.env.UI_BASE_URL);await page.locator('.tools-project').first().waitFor();
 assert.equal(await page.locator('.tools-project').count(),50);
 assert.match(await page.locator('#tools-project-pagination').textContent(),/1[–-]50.*123/);
 await page.locator('#tools-project-pagination [data-page-next]').click();
 assert.match(await page.locator('.tools-project').first().textContent(),/Repository-050/);
 await page.locator('#panel-tools [data-list-density-toggle]').click();
 assert.equal(await page.locator('#panel-tools [data-list-density-toggle]').getAttribute('aria-pressed'),'true');
 await page.locator('.tools-project').first().locator('[data-tools-action=search]').click();
 await page.locator('#panel-search.active').waitFor();
 await page.locator('#main-navigation [data-workspace=repository]').click();
 assert.match(await page.locator('#tools-project-pagination').textContent(),/51[–-]100.*123/);
 assert.equal(await page.locator('.tools-project').first().getAttribute('data-current'),'true');
 await page.locator('#tools-project-search').fill('Repository-122');
 assert.equal(await page.locator('.tools-project').count(),1);
 assert.match(await page.locator('#tools-project-pagination').textContent(),/1[–-]1.*1/);
 await page.reload();await page.locator('.tools-project').first().waitFor();
 assert.equal(await page.locator('#panel-tools [data-list-density-toggle]').getAttribute('aria-pressed'),'true');
});
test('findings retain total scope while paging and continuous reading crosses a page without losing the selected record',async t=>{
 const {page,fixture}=await setup(t);
 const findings=Array.from({length:123},(_,i)=>({...fixture.vulnerabilities[0],id:`finding-${i}`,ruleId:'READ_ONLY',title:`Fictional finding ${i}`}));
 await page.route('**/api/v1/vulns?*',route=>route.fulfill({json:findings}));
 await page.goto(process.env.UI_BASE_URL+'/#vulns');await page.locator('.vuln-finding').first().waitFor();
 assert.equal(await page.locator('.vuln-finding').count(),50);
 assert.equal(await page.locator('#vuln-result-count').textContent(),'123');
 await page.locator('.vuln-read').last().click();
 assert.match(await page.locator('#reader-position').textContent(),/50.*123/);
 await page.locator('#reader-next').click();
 assert.match(await page.locator('#reader-heading').textContent(),/Fictional finding 50/);
 await page.locator('#reader-close').click();
 assert.equal(await page.locator('.vuln-finding').first().getAttribute('data-finding-id'),'finding-50');
 assert.equal(await page.locator('[data-reader-finding="finding-50"]').evaluate(el=>el===document.activeElement),true);
 assert.match(await page.locator('#vuln-pagination').textContent(),/51[–-]100.*123/);
 await page.locator('#panel-vulns [data-list-density-toggle]').click();
 assert.equal(await page.locator('#panel-vulns [data-list-density-toggle]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('.vuln-finding').first().locator('.vuln-status').isVisible(),true);
 assert.equal(await page.locator('.vuln-finding').first().locator('.vuln-finding-location').isVisible(),true);
});
test('compact view reduces actual row height while retaining typography, titles, locations and actions',async t=>{
 const {page}=await setup(t);
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});
  for(const [panel,selector,title,location] of [
   ['tools','.tools-project','h3','.tools-project-root'],
   ['search','.result-card','.rc-title','.rc-path'],
   ['vulns','.vuln-finding','.vuln-finding-title','.vuln-finding-location']
  ]) {
   await page.goto(process.env.UI_BASE_URL+'/#'+panel);
   if(panel==='search'){await page.locator('#search-input').fill('orders');await page.locator('#search-input').press('Enter');}
   const row=page.locator(selector).first();await row.waitFor();
   await page.evaluate(()=>document.fonts.ready);
   const toggle=page.locator(`#panel-${panel} [data-list-density-toggle]`);
   if(await toggle.getAttribute('aria-pressed')==='true')await toggle.click();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const before=await row.boundingBox(),font=await row.locator(title).evaluate(el=>getComputedStyle(el).fontSize);
   await toggle.click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const after=await row.boundingBox();
   assert.ok(after.height<before.height,`${panel} at ${width}px becomes visibly more compact`);
   assert.equal(await row.locator(title).evaluate(el=>getComputedStyle(el).fontSize),font);
   assert.equal(await row.locator(location).isVisible(),true);
   assert.ok(await row.locator('button,a').count());
  }
 }
});

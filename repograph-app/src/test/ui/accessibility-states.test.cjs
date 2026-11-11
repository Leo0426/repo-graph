'use strict';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const {chromium}=require('playwright');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const fixtures=require('./fixtures.cjs');let browser;
const screenshots=path.resolve('repograph-app/build/ux-next/screens');fs.mkdirSync(screenshots,{recursive:true});
before(async()=>browser=await chromium.launch({channel:'chrome',headless:true}));after(async()=>browser?.close());
async function setup(t,options={}) {
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',...options});
 await prepare(t,page);return page;
}
async function prepare(t,page) {
 page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const fixture=await fixtures(page);await page.route('**/api/v1/admin/**',r=>r.fulfill({json:[]}));
 await page.addInitScript(()=>{localStorage.setItem('repograph_active_project','d3e000000001');localStorage.setItem('repograph_lang','en');});
 t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
}
async function noOverflow(page) {
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page has no horizontal overflow');
 assert.equal(await page.locator('.panel.active .panel-body').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'reading pane has no horizontal overflow');
}
async function captureZoomedPage(page, name) {
 // Without an explicit clip CDP captures the complete zoomed compositor surface.
 // Playwright's CSS-viewport clip captures only part of the surface at real browser zoom.
 const session=await page.context().newCDPSession(page);
 try {
  const {data}=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
  fs.writeFileSync(path.join(screenshots,name),Buffer.from(data,'base64'));
 } finally { await session.detach(); }
}
test('SVG relations, selection and keyboard focus remain distinguishable in both themes',async t=>{
 for(const colorScheme of ['light','dark'])await t.test(colorScheme,async t=>{
  const page=await setup(t,{colorScheme});await page.goto(process.env.UI_BASE_URL+'/#graph');
  await page.locator('#graph-target').fill('demo.orders.OrderController#findOrders(String)');
  await page.locator('#graph-query-btn').click();await page.locator('.graph-node').nth(1).waitFor();
  const contrasts=await page.evaluate(()=>{
   const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
   const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);
   const bg=lum(rgb(getComputedStyle(document.querySelector('.graph-canvas')).backgroundColor));
   return [...document.querySelectorAll('.graph-connection')].map(el=>{
    const cs=getComputedStyle(el),fg=lum(rgb(cs.stroke));
    return {ratio:(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05),opacity:Number(cs.strokeOpacity)*Number(cs.opacity)};
   });
  });
  assert.ok(contrasts.length);assert.ok(contrasts.every(edge=>edge.ratio>=3&&edge.opacity===1));
  const node=page.locator('.graph-node').nth(1);await node.focus();await page.keyboard.press('Enter');
  assert.equal(await node.getAttribute('aria-pressed'),'true');
  assert.equal(await node.evaluate(el=>el.matches(':focus-visible')),true);
  assert.ok(await node.locator('circle,rect').first().evaluate(el=>parseFloat(getComputedStyle(el).strokeWidth)>=3));
  assert.equal(await page.locator('.graph-connection.is-context').count(),1);
  await page.screenshot({path:path.join(screenshots,`graph-focus-${colorScheme}.png`)});
 });
});
test('short-screen menus and long command lists keep their focused option visible',async t=>{
 const page=await setup(t,{viewport:{width:390,height:260},colorScheme:'dark'});
 await page.goto(process.env.UI_BASE_URL);await page.locator('#account-menu > summary').click();
 const logout=page.locator('#account-menu button').last();await logout.focus();
 assert.equal(await logout.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),true);
 await page.keyboard.press('Escape');await page.keyboard.press('Control+k');
 await page.locator('#command-query').waitFor();await page.keyboard.press('ArrowUp');
 const selected=page.locator('#command-results [aria-selected=true]');
 assert.equal(await selected.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('#command-results').getBoundingClientRect();return r.top>=p.top-1&&r.bottom<=p.bottom+1&&r.top>=0&&r.bottom<=innerHeight}),true);
 assert.equal(await page.locator('#command-palette').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),true);
 await noOverflow(page);
 await page.screenshot({path:path.join(screenshots,'commands-short-dark.png')});
});
test('320px English forms and long repository names preserve readable controls and field drafts',async t=>{
 const page=await setup(t,{viewport:{width:320,height:844},colorScheme:'dark'});
 await page.route('**/api/v1/projects',r=>r.fulfill({json:[{projectId:'d3e000000001',nodeCount:99,projectRoot:'/fictional/'+('VeryLongRepositoryName-'.repeat(8))}]}));
 await page.goto(process.env.UI_BASE_URL);await page.locator('.tools-project').first().waitFor();await noOverflow(page);
 await page.locator('#nav-toggle').click();await page.locator('#main-navigation [data-panel=admin]').click();
 await page.locator('[data-tab=providers]').click();await page.locator('#provider-new').click();
 await page.locator('#provider-name').fill('Long enterprise model gateway configuration');await noOverflow(page);
 await page.screenshot({path:path.join(screenshots,'provider-english-320-dark.png')});
});
test('actual 200 percent Chrome page zoom keeps navigation, source reading and provider configuration usable',async t=>{
 // Chromium stores a partition-to-level map, not a single level. Empty partition => "x".
 // https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'repograph-ui-zoom-'));fs.mkdirSync(path.join(profile,'Default'));
 fs.writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(2)/Math.log(1.2)}}}));
 const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:null,reducedMotion:'reduce',args:['--window-size=1440,1000']});
 t.after(async()=>{await context.close();fs.rmSync(profile,{recursive:true,force:true});});
 const page=context.pages()[0];await prepare(t,page);
 await page.goto(process.env.UI_BASE_URL+'/#search');
 const zoom=await page.evaluate(()=>({width:innerWidth,outer:outerWidth,dpr:devicePixelRatio,pinch:visualViewport.scale}));
 assert.ok(zoom.dpr>=1.99&&zoom.width<=zoom.outer*.51,'Chrome applied real page zoom and reflow');assert.equal(zoom.pinch,1);
 await page.locator('#search-input').fill('HTTP handlers');await page.locator('#search-input').press('Enter');
 await page.locator('.rc-read').first().click();await page.locator('#result-reader[open]').waitFor();await noOverflow(page);
 assert.equal(await page.locator('#reader-close').evaluate(el=>{const r=el.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight}),true);
 await captureZoomedPage(page,'reader-chrome-zoom-200.png');
 await page.locator('#reader-close').click();await page.locator('#nav-toggle').click();await page.locator('#main-navigation [data-panel=admin]').click();
 await page.locator('[data-tab=providers]').click();await page.locator('#provider-new').click();await noOverflow(page);
 await captureZoomedPage(page,'provider-chrome-zoom-200.png');
});

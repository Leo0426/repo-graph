'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fixtures=require('./fixtures.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>browser?.close());
async function setup(t,width=1440,panel='search') {
 const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const fixture=await fixtures(page);
 await page.addInitScript(()=>localStorage.setItem('repograph_active_project','d3e000000001'));
 t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
 await page.goto(process.env.UI_BASE_URL+'/#'+panel);
 await page.waitForFunction(()=>document.querySelector('#global-project').options.length===3);
 if(panel==='search') {await page.fill('#search-input','orders');await page.press('#search-input','Enter');await page.locator('.result-card').first().waitFor();}
 else await page.locator('.vuln-finding').first().waitFor();
 return {page,fixture};
}
test('desktop reader keeps the list interactive and reads successive symbols without losing scope',async t=>{
 const {page,fixture}=await setup(t);
 const target=await page.locator('.rc-read').first().boundingBox();
 assert.ok(target.height>=34,`Desktop source-reading target is ${target.height}px tall`);
 await page.locator('.rc-read').first().click();
 await page.locator('#result-reader[open]').waitFor();
 assert.ok(await page.locator('.result-card').first().evaluate(el=>parseFloat(getComputedStyle(el).borderLeftWidth)>=2),'the selected list record has a visible marker');
 assert.equal(await page.locator('#result-reader').evaluate(e=>e.matches(':modal')),false);
 assert.match(await page.locator('#reader-content').textContent(),/OrderController/);
 assert.equal(await page.locator('#search-input').isEditable(),true);
 await page.locator('#reader-next').click();
 assert.match(await page.locator('#reader-content').textContent(),/OrderService/);
 assert.match(await page.locator('#reader-position').textContent(),/2.*3/);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#result-reader').evaluate(e=>e.open),false);
 assert.equal(await page.locator('.rc-read').nth(1).evaluate(e=>e===document.activeElement),true);
 assert.equal(await page.locator('#search-input').inputValue(),'orders');
 assert.equal(await page.locator('#global-project').inputValue(),'d3e000000001');
 assert.equal(fixture.requested.some(r=>!r.startsWith('GET ')),false);
});

test('mobile evidence reading stays modal, supports keyboard navigation and never changes a finding',async t=>{
 const {page,fixture}=await setup(t,390,'vulns');
 await page.locator('.vuln-read').first().click();
 await page.locator('#reader-evidence .reader-evidence-step').first().waitFor();
 assert.equal(await page.locator('#result-reader').evaluate(e=>e.matches(':modal')),true);
 assert.equal(await page.locator('.vuln-finding').first().evaluate(e=>e.open),false);
 assert.match(await page.locator('#reader-content').textContent(),/OrderController/);
 assert.equal(await page.locator('.reader-source-line > i').first().textContent(),'42');
 await page.locator('#reader-heading').focus();await page.keyboard.press('ArrowRight');
 assert.match(await page.locator('#reader-heading').textContent(),/导出文件名/);
 await page.locator('#reader-triage').click();
 await page.locator('#panel-agent.active').waitFor();
 await page.waitForFunction(()=>document.querySelector('.agent-vulnerability-item.selected')?.textContent.includes('导出文件名'));
 assert.equal(fixture.requested.some(r=>!r.startsWith('GET ')),false);
});

test('tablet evidence sidebar leaves readable titles and actions in the narrowed findings list',async t=>{
 const {page}=await setup(t,1024,'vulns');
 await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();
 await page.locator('.vuln-read').first().click();
 await page.waitForFunction(()=>document.getElementById('vuln-list').clientWidth<500);
 for(const colorScheme of ['light','dark']) {
  await page.emulateMedia({colorScheme});
  const layout=await page.locator('.vuln-finding').first().evaluate(card=>{
   const title=card.querySelector('.vuln-finding-title').getBoundingClientRect();
   const summary=card.querySelector('summary').getBoundingClientRect();
   const button=card.querySelector('.vuln-read').getBoundingClientRect();
   return {titleWidth:title.width,cardWidth:card.clientWidth,height:summary.height,buttonRight:button.right,cardRight:card.getBoundingClientRect().right};
  });
  assert.ok(layout.titleWidth>layout.cardWidth*.8,'The title keeps a reading line instead of collapsing into a vertical column');
  assert.ok(layout.height<360,'Three short facts do not grow into a page-height row');
  assert.ok(layout.buttonRight<=layout.cardRight,'Reading actions stay within the list');
 }
});

test('missing source retries actual lookup failures and rejects a mismatched code unit',async t=>{
 const {page,fixture}=await setup(t);
 const unit={...fixture.units[0],rawSource:'',id:'missing-source'};
 await page.route('**/api/v1/search/semantic?*',r=>r.fulfill({json:{results:[{unit,projectId:'d3e000000001',score:0.9}],hasMore:false}}));
 await page.fill('#search-input','missing');await page.press('#search-input','Enter');
 await page.locator('.rc-read').filter({hasText:'findOrders'}).click();
 assert.match(await page.locator('#reader-evidence').textContent(),/没有可显示/);
 let calls=0;
 await page.route('**/api/v1/symbol/**',r=>r.fulfill(++calls===1?{status:503,json:{error:'DEMO source offline'}}
   :calls===2?{json:{...unit,id:'different-unit',rawSource:'WRONG SOURCE'}}:{json:{...unit,rawSource:'correct source'}}));
 await page.locator('#reader-evidence button').click();
 await page.locator('.reader-error').filter({hasText:'DEMO source offline'}).waitFor();
 await page.locator('#reader-evidence button').click();
 await page.locator('.reader-error').filter({hasText:'不一致'}).waitFor();
 assert.doesNotMatch(await page.locator('#reader-content').textContent(),/WRONG SOURCE/);
 await page.locator('#reader-evidence button').click();
 await page.locator('.reader-source').filter({hasText:'correct source'}).waitFor();
});

test('long locations, duplicate names and multiline source remain complete through language and viewport changes',async t=>{
 const {page,fixture}=await setup(t);
 const file='src/'+('very-long-location/').repeat(14)+'Controller.java';
 const units=[0,1].map((i)=>({...fixture.units[i],simpleName:'sameName',qualifiedName:`demo.Owner${i}#sameName(String)`,filePath:file,
   startLine:120,endLine:122,signature:'public List<Order> sameName(\n  String customerId\n)',rawSource:'<script>never execute</script>\n'+('x'.repeat(600))+'\nreturn value;'}));
 await page.route('**/api/v1/search/semantic?*',r=>r.fulfill({json:{results:units.map(unit=>({unit,projectId:'d3e000000001',score:0.9})),hasMore:false}}));
 await page.fill('#search-input','duplicate');await page.press('#search-input','Enter');
 await page.locator('.rc-read').filter({hasText:'sameName'}).first().click();
 assert.equal(await page.locator('#reader-content script').count(),0);
 assert.equal(await page.locator('.reader-source-line > i').allTextContents().then(a=>a.join(',')),'120,121,122');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>{window.readerCopied=value;return Promise.resolve();}}}));
 await page.locator('#reader-copy-location').click();
 await page.waitForFunction(()=>document.querySelector('#reader-status').textContent.includes('复制'));
 assert.equal(await page.evaluate(()=>window.readerCopied),file+':120');
 await page.locator('.reader-source').evaluate(e=>e.scrollLeft=150);
 const left=await page.locator('.reader-source').evaluate(e=>e.scrollLeft);
 await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();
 assert.match(await page.locator('.rc-read').first().getAttribute('aria-label'),/^Read details:/);
 assert.equal(await page.locator('.reader-source').evaluate(e=>e.scrollLeft),left);
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.querySelector('#result-reader').matches(':modal'));
 assert.equal(await page.locator('#result-reader').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#reader-next').click();assert.match(await page.locator('#reader-heading').textContent(),/Owner1/);
 await page.locator('#reader-previous').click();assert.match(await page.locator('#reader-heading').textContent(),/Owner0/);
 await page.locator('#reader-close').click();
 assert.equal(await page.locator('.rc-read').first().evaluate(e=>e===document.activeElement),true);
 const target=await page.locator('.rc-read').first().boundingBox();
 assert.ok(target.height>=40,`Mobile source-reading target is ${target.height}px tall`);
});

test('changing repository while evidence loads prevents the old response from reviving the reader',async t=>{
 const {page}=await setup(t,1440,'vulns');
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/taint-evidence',async r=>{await gate;await r.fulfill({json:[{role:'SOURCE',methodQn:'OLD A',filePath:'old/A.java',startLine:1,sourceExcerpt:'OLD A SOURCE'}]});});
 const started=page.waitForRequest(r=>r.url().endsWith('/taint-evidence'));
 await page.locator('.vuln-read').first().click();await started;
 await page.locator('#global-project').selectOption('d3e000000002');
 const finished=page.waitForResponse(r=>r.url().endsWith('/taint-evidence'));release();await (await finished).finished();
 await page.evaluate(()=>new Promise(requestAnimationFrame));
 assert.equal(await page.locator('#result-reader').evaluate(e=>e.open),false);
 assert.doesNotMatch(await page.locator('#reader-content').textContent(),/OLD A SOURCE/);
 assert.equal(await page.locator('#global-project').inputValue(),'d3e000000002');
});

test('submitting a fresh search closes the old reading session and rejects its late source response',async t=>{
 const {page,fixture}=await setup(t);
 const old={...fixture.units[0],rawSource:''};
 await page.route('**/api/v1/search/semantic?*',r=>r.fulfill({json:{results:[{unit:old,projectId:'d3e000000001',score:0.9}],hasMore:false}}));
 await page.locator('#search-submit').click();await page.locator('.rc-read').first().click();
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/v1/symbol/**',async r=>{await gate;await r.fulfill({json:{...old,rawSource:'LATE OLD SOURCE'}});});
 const sourceStarted=page.waitForRequest(r=>new URL(r.url()).pathname.startsWith('/api/v1/symbol/'));
 await page.locator('#reader-evidence button').click();await sourceStarted;
 try {
  await page.route('**/api/v1/search/semantic?*',r=>r.fulfill({json:{results:[{unit:fixture.units[1],projectId:'d3e000000001',score:0.9}],hasMore:false}}));
  await page.locator('#search-submit').click();
  await page.locator('#search-results .rc-name').filter({hasText:'OrderService'}).waitFor();
  assert.equal(await page.locator('#result-reader').evaluate(e=>e.open),false);
  const sourceFinished=page.waitForResponse(r=>new URL(r.url()).pathname.startsWith('/api/v1/symbol/'));
  release();await(await sourceFinished).finished();
  await page.locator('.rc-read').first().click();
  assert.equal(await page.locator('#reader-heading').innerText(),fixture.units[1].qualifiedName);
  assert.doesNotMatch(await page.locator('#reader-content').textContent(),/LATE OLD SOURCE/);
  const graph=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/graph/callers');
  await page.locator('#reader-graph').click();
  assert.equal(new URL((await graph).url()).searchParams.get('target'),fixture.units[1].qualifiedName);
 } finally {release();}
});

test('closing after reading restores the scrolled list and loaded-page navigation can continue',async t=>{
 const {page,fixture}=await setup(t);
 const rows=Array.from({length:25},(_,i)=>({unit:{...fixture.units[0],id:'code-'+i,simpleName:'record'+i,qualifiedName:`demo.Service#record${i}()`},projectId:'d3e000000001',score:0.9}));
 await page.route('**/api/v1/search/semantic?*',r=>{
  const url=new URL(r.request().url()), offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
  return r.fulfill({json:{results:rows.slice(offset,offset+limit),hasMore:offset+limit<rows.length}});
 });
 await page.locator('#search-filter-disclosure > summary').click();await page.locator('#search-limit').selectOption('20');
 await page.locator('.rc-read').filter({hasText:'record12',exact:true}).waitFor();
 const trigger=page.locator('.rc-read').filter({hasText:'record12',exact:true});await trigger.scrollIntoViewIfNeeded();
 const before=await page.locator('#panel-search .panel-body').evaluate(e=>e.scrollTop);
 await trigger.click();
 assert.equal(await page.locator('#reader-triage').isVisible(),false);
 await page.locator('#reader-close').click();
 assert.ok(Math.abs(await page.locator('#panel-search .panel-body').evaluate(e=>e.scrollTop)-before)<2);
 await trigger.click();await page.locator('#reader-more').click();
 await page.waitForFunction(()=>document.querySelectorAll('.result-card').length===25);
 assert.match(await page.locator('#reader-position').textContent(),/25/);
 assert.equal(await page.locator('#reader-more').isVisible(),false);
});
test('reader pagination can continue after changing the selected record during an in-flight page',async t=>{
 const {page,fixture}=await setup(t);
 let release;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());
 const results=Array.from({length:30},(_,i)=>({projectId:fixture.projects[0].projectId,score:.9,
  unit:{...fixture.units[0],id:'paging-'+i,simpleName:'paging'+i,qualifiedName:`demo.Paging#record${i}()`}}));
 await page.route('**/api/v1/search/semantic?*',async route=>{
  const url=new URL(route.request().url()),offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit'));
  if(offset===10)await gate;
  await route.fulfill({json:{results:results.slice(offset,offset+limit),hasMore:offset+limit<results.length}});
 });
 await page.locator('#search-input').fill('paging');await page.locator('#search-input').press('Enter');
 await page.locator('.rc-read').first().click();
 const pending=page.waitForRequest(request=>new URL(request.url()).searchParams.get('offset')==='10');
 await page.locator('#reader-more').click();await pending;await page.locator('#reader-next').click();
 release();await page.waitForFunction(()=>document.querySelectorAll('.result-card').length===20);
 assert.equal(await page.locator('#reader-more').isEnabled(),true);
 await page.locator('#reader-more').click();await page.waitForFunction(()=>document.querySelectorAll('.result-card').length===30);
 assert.match(await page.locator('#reader-heading').textContent(),/record1\(/);
 assert.equal(await page.locator('#reader-more').isVisible(),false);
});

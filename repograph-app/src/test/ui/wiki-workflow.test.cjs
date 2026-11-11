'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const installFixtures = require('./fixtures.cjs');
const baseUrl = process.env.UI_BASE_URL;
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' }); });
after(async () => { await browser?.close(); });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const pid = 'd3e000000001';
function docs(projectId = pid) { return [{ id:'project-doc', projectId, title:'订单服务结构', scopeId:'__project__', level:'PROJECT', docVersion:2,
  status:'PARTIAL', generatedAt:'2026-11-10T10:00:00Z', model:null, missingInfo:['模型未启用'],
  sections:[{ title:'模块划分', source:'facts', body:'| 包 | 单元数 |\n|---|---:|\n| orders | 12 |' },
    { title:'安全边界', source:'facts', body:'<img src=x onerror="window.wikiXss=true">\n\n```java\nvoid demo() {}\n```' }],
  citations:[{qualifiedName:'demo.orders.OrderController#findOrders(String)',filePath:'src/main/java/demo/orders/OrderController.java',startLine:42,endLine:48}] },
  { id:'package-doc', projectId, title:'包职责', scopeId:'demo.orders', level:'PACKAGE', docVersion:1, status:'COMPLETED', sections:[{title:'职责',body:'- 订单查询',source:'facts'}], citations:[] }]; }
async function setup(t, configure, viewport = {width:1440,height:1000}) {
  const page = await browser.newPage({ viewport, reducedMotion:'reduce' }); page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=await installFixtures(page);
  await page.addInitScript(p=>{ localStorage.setItem('repograph_lang','zh');localStorage.setItem('repograph_active_project',p); },pid);
  await page.route('**/api/v1/summaries?*',route=>json(route,docs(new URL(route.request().url()).searchParams.get('projectId'))));
  if(configure) await configure(page);
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
  await page.goto(new URL('#wiki',baseUrl).href,{waitUntil:'domcontentloaded'});
  await page.locator('#panel-wiki.active').waitFor();
  return page;
}
test('Wiki reads facts, formats tables safely, filters and opens scoped source references',async t=>{
  const page=await setup(t);await page.locator('#wiki-document h2').waitFor();
  assert.equal(await page.locator('#wiki-document table tbody td').first().textContent(),' orders ');
  assert.equal(await page.locator('#wiki-document img').count(),0);
  assert.equal(await page.evaluate(()=>window.wikiXss),undefined);
  assert.match(await page.locator('#wiki-document').innerText(),/未使用模型/);
  await page.locator('#wiki-filter').fill('demo.orders');assert.equal(await page.locator('#wiki-tree button').count(),1);
  await page.locator('#wiki-filter').fill('');
  const request=page.waitForRequest(r=>r.url().includes('/api/v1/locate?'));
  await page.locator('[data-citation="0"]').click();
  const url=new URL((await request).url());assert.equal(url.searchParams.get('projectId'),pid);assert.equal(url.searchParams.get('line'),'42');
});
test('Wiki rejects late results after project switch and clears on empty scope',async t=>{
  let release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r);
  t.after(()=>release());
  const page=await setup(t,async page=>{
    await page.route('**/api/v1/summaries?*',async route=>{
      const scope=new URL(route.request().url()).searchParams.get('projectId');
      if(scope===pid){started();await gate;}
      const data=docs(scope);data[0].title=scope;await json(route,data);
    });
  });
  await start;await page.locator('#global-project').selectOption('d3e000000002');
  await page.getByRole('heading',{name:'d3e000000002',exact:true}).waitFor();release();
  await page.waitForTimeout(150);assert.equal(await page.locator('#wiki-document h2').textContent(),'d3e000000002');
  await page.locator('#global-project').selectOption('');assert.equal(await page.locator('#wiki-document h2').count(),0);
  assert.equal(await page.locator('#wiki-generate').isDisabled(),true);
});
test('generation polling recovers from connection errors and exposes partial completion',async t=>{
  let polls=0,submits=0;
  const page=await setup(t,async page=>{
    await page.route('**/api/v1/summaries/generate?*',route=>{submits++;return json(route,{agentRunId:'wiki-run'},202);});
    await page.route('**/api/v1/agent-runs/wiki-run',route=>{
      if(++polls===1)return json(route,{error:'temporary outage'},503);
      return json(route,{id:'wiki-run',projectId:pid,playbook:'WIKI_SUMMARY',status:'PARTIAL',statusReason:'模型超时',steps:[{capability:'LLM_ARCH',status:'FAILED',summary:'保留结构事实'}]});
    });
  });
  await page.locator('#wiki-generate').click();await page.locator('#wiki-run').getByText(/状态未知/).waitFor();
  assert.equal(await page.locator('#wiki-generate').isDisabled(),true);
  await page.locator('#wiki-run button').click();await page.locator('#wiki-run').getByText('模型超时',{exact:true}).waitFor();
  assert.equal(submits,1);assert.equal(await page.locator('#wiki-generate').isDisabled(),false);
  assert.match(await page.locator('#wiki-run').innerText(),/部分完成/);
});
test('Wiki read failure retains content, retry works and Markdown exports the selected document',async t=>{
  let fail=false;
  const page=await setup(t,async page=>{await page.route('**/api/v1/summaries?*',route=>json(route,fail?{error:'offline'}:docs(),fail?503:200));});
  await page.locator('#wiki-document h2').waitFor();fail=true;await page.locator('#wiki-refresh').click();
  await page.locator('#wiki-status button').waitFor();assert.match(await page.locator('#wiki-document h2').innerText(),/订单/);
  fail=false;await page.locator('#wiki-status button').click();await page.waitForFunction(()=>!wikiView.loading&&!wikiView.error);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载 Markdown'}).click();
  assert.match((await download).suggestedFilename(),/wiki-d3e000000001-v2.md/);
});
test('narrow Wiki layout supports keyboard reading and English labels without horizontal overflow',async t=>{
  const page=await setup(t,null,{width:390,height:844});await page.locator('#wiki-document h2').waitFor();
  await page.locator('#wiki-tree button').last().focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#wiki-document h2').textContent(),'包职责');
  await page.evaluate(()=>Alpine.store('repograph').setLang('en'));
  assert.equal(await page.locator('.workspace-tab[data-panel="wiki"]').textContent(),'Project documentation');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/repograph-wiki-mobile.png',fullPage:true});
});
test('reload restores the accepted run without submitting again',async t=>{
  let polls=0,submits=0;
  const page=await setup(t,async page=>{
    await page.route('**/api/v1/summaries/generate?*',route=>{submits++;return json(route,{agentRunId:'persistent-run'},202);});
    await page.route('**/api/v1/agent-runs/persistent-run',route=>{
      polls++;return json(route,{id:'persistent-run',projectId:pid,playbook:'WIKI_SUMMARY',status:polls===1?'RUNNING':'COMPLETED',steps:[]});
    });
  });
  await page.locator('#wiki-generate').click();await page.locator('#wiki-run strong').filter({hasText:'生成中'}).waitFor();
  await page.reload();await page.locator('#wiki-run strong').filter({hasText:'已完成'}).waitFor();
  assert.equal(submits,1);assert.ok(polls>=2);
});
test('empty Wiki can generate and rejected submission can be retried',async t=>{
  let posts=0;
  const page=await setup(t,async page=>{
    await page.route('**/api/v1/summaries?*',route=>json(route,[]));
    await page.route('**/api/v1/summaries/generate?*',route=>{posts++;return json(route,{error:'queue full'},503);});
  });
  await page.locator('#wiki-status').getByText(/尚未生成/).waitFor();
  await page.locator('#wiki-generate').click();await page.locator('#wiki-run').getByText(/queue full/).waitFor();
  assert.equal(await page.locator('#wiki-generate').isDisabled(),false);
  await page.locator('#wiki-run button').click();await page.waitForFunction(()=>!wikiView.submitting);
  assert.equal(posts,2);
});

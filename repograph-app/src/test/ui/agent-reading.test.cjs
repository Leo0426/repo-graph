'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fixtures=require('./fixtures.cjs');
const auditContrast=require('./visual-contrast.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>browser?.close());
async function setup(t,width=390) {
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
  page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=await fixtures(page);
  await page.addInitScript(()=>{localStorage.setItem('repograph_active_project','d3e000000001');localStorage.setItem('repograph_lang','zh');});
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
  return {page,fixture};
}
test('mobile shows the current task and human review action before preparation and optional settings',async t=>{
  const {page}=await setup(t);
  await page.goto(process.env.UI_BASE_URL+'/#agent');
  await page.locator('#agent-current-task[data-status="WAITING_FOR_REVIEW"]').waitFor();
  const summary=await page.locator('#agent-current-task').boundingBox();
  const preparation=await page.locator('#agent-preparation').boundingBox();
  assert.ok(summary.y<500&&summary.y<preparation.y);
  assert.match(await page.locator('#agent-current-action').textContent(),/审核/);
  assert.equal(await page.locator('#agent-current-heading').textContent(),'漏洞研判');
  await page.waitForFunction(()=>document.querySelector('#agent-generation-note').textContent.includes('未启用'));
  assert.equal(await page.locator('#agent-secondary').evaluate(e=>e.open),false);
  assert.equal(await page.locator('#agent-preparation').evaluate(e=>e.open),true);
});

test('current task describes an existing Wiki run without presenting it as SAST triage',async t=>{
 const {page,fixture}=await setup(t,1440);
 Object.assign(fixture.run,{playbook:'WIKI_SUMMARY',status:'COMPLETED',inputReference:'facts:graph:'+fixture.projects[0].projectId,
  outputReference:'summaries:project:'+fixture.projects[0].projectId,steps:[]});
 await page.goto(process.env.UI_BASE_URL+'/#agent');
 await page.locator('#agent-current-task[data-status=COMPLETED]').waitFor();
 assert.equal(await page.locator('#agent-current-heading').textContent(),'项目文档生成');
 await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();await page.keyboard.press('Escape');
 assert.equal(await page.locator('#agent-current-heading').textContent(),'Project documentation generation');
 await page.locator('#agent-current-action').click();
 assert.equal(fixture.requested.some(request=>!request.startsWith('GET ')),false);
});

test('human review reads a frozen report, requires explicit actions, and preserves a failed decision draft',async t=>{
  const {page,fixture}=await setup(t,1440);
  const entry={id:'demo-review-entry',snapshotId:'demo-order-review-snapshot',projectId:'d3e000000001',fingerprint:'demo-fingerprint',
    ruleId:'demo-rule',severity:'HIGH',verdict:'NEEDS_REVIEW',status:'PENDING',claimedBy:'',updatedAt:'2026-10-04T02:00:00Z'};
  const report={finding:{ruleId:entry.ruleId,message:'Frozen baseline finding',filePath:fixture.units[0].filePath,startLine:42,endLine:46},
    verdict:'NEEDS_REVIEW',developerSummary:'Frozen baseline summary',reasons:['Check [C1]'],missingInfo:['Binding behavior not verified'],
    remediation:'Check parameter binding',pack:{evidence:[{citationId:'C1',filePath:fixture.units[0].filePath,startLine:42,endLine:46,excerpt:'<script>do not execute</script>',truncated:true}],omittedReasons:['Budget limit']}};
  const snapshot={id:entry.snapshotId,projectId:entry.projectId,codeVersion:'frozen-code',ruleVersion:'frozen-rules',generatedAt:'2026-10-04T02:00:00Z',reports:[report]};
  const actions=[];let failConfirm=true;
  await page.route('**/api/v1/review-queue/**',async r=>{
    if(r.request().method()==='GET') return r.fulfill({json:{snapshot,items:[{entry,report,reportMatchCount:1}]}});
    const action=new URL(r.request().url()).pathname.split('/').at(-1);
    actions.push({action,body:r.request().postDataJSON()});
    if(action==='claim') {entry.status='IN_REVIEW';entry.claimedBy='admin';}
    if(action==='confirm'&&failConfirm) {failConfirm=false;return r.fulfill({status:503,json:{error:'DEMO decision failed'}});}
    if(action==='confirm') entry.status='CONFIRMED';
    return r.fulfill({json:{id:entry.id,status:entry.status}});
  });
  await page.goto(process.env.UI_BASE_URL+'/#agent');
  await page.locator('#agent-current-task[data-status="WAITING_FOR_REVIEW"]').waitFor();
  await page.locator('#agent-current-action').click();
  await page.locator('#agent-review-dialog[open] [data-review-entry]').waitFor();
  assert.equal(actions.length,0,'Reading a snapshot never claims or changes a review');
  assert.match(await page.locator('#agent-review-content').textContent(),/Frozen baseline summary|frozen-code/);
  assert.equal(await page.locator('#agent-review-content script').count(),0);
  await page.locator('[data-review-action="claim"]').click();
  await page.locator('[data-review-entry][data-status="IN_REVIEW"]').waitFor();
  assert.equal(await page.locator('[data-review-action="confirm"]').isDisabled(),true);
  await page.locator('[data-review-reason]').fill('Source and citation checked');
  await page.keyboard.press('Control+Enter');
  assert.equal(actions.length,1,'The review dialog cannot launch another Agent task through the background shortcut');
  await page.locator('[data-review-action="confirm"]').click();
  await page.waitForFunction(()=>document.querySelector('#agent-review-status').textContent.includes('DEMO decision failed'));
  assert.equal(await page.locator('[data-review-reason]').inputValue(),'Source and citation checked');
  assert.equal(await page.locator('[data-review-entry]').getAttribute('data-status'),'IN_REVIEW');
  await page.locator('[data-review-action="confirm"]').click();
  await page.locator('[data-review-entry][data-status="CONFIRMED"]').waitFor();
  assert.match(await page.locator('.review-baseline').textContent(),/需人工复核/);
  assert.deepEqual(actions.map(a=>a.action),['claim','confirm','confirm']);
  assert.equal(actions.at(-1).body.reason,'Source and citation checked');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#agent-current-action').evaluate(e=>document.activeElement===e),true);
});

test('a settled action on a closed snapshot releases the controls of another open report',async t=>{
 const {page,fixture}=await setup(t,1440);
 const runs=[fixture.run,{...fixture.run,id:'demo-second-run',outputReference:'report-snapshot:demo-second-snapshot'}];
 const entries=runs.map((run,i)=>({id:'review-entry-'+i,snapshotId:run.outputReference.slice('report-snapshot:'.length),projectId:run.projectId,
  fingerprint:'review-fingerprint-'+i,ruleId:'demo-rule',severity:'HIGH',verdict:'NEEDS_REVIEW',status:'PENDING',claimedBy:''}));
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route(/\/api\/v1\/agent-runs\?/,r=>r.fulfill({json:runs}));
 await page.route('**/api/v1/agent-runs/demo-second-run',r=>r.fulfill({json:runs[1]}));
 await page.route('**/api/v1/review-queue/**',async r=>{
  const url=new URL(r.request().url());
  const entry=entries.find(item=>url.pathname.includes(r.request().method()==='GET'?item.snapshotId:item.id));
  if(r.request().method()==='GET') {
   const report={finding:{ruleId:entry.ruleId,message:'Frozen '+entry.id,filePath:'Demo.java',startLine:1,endLine:1},
    verdict:'NEEDS_REVIEW',developerSummary:'Frozen '+entry.id,reasons:[],missingInfo:[],pack:{evidence:[],omittedReasons:[]}};
   return r.fulfill({json:{snapshot:{id:entry.snapshotId,projectId:entry.projectId,reports:[report]},items:[{entry,report,reportMatchCount:1}]}});
  }
  if(entry===entries[0])await gate;
  entry.status='IN_REVIEW';entry.claimedBy='admin';
  return r.fulfill({json:{id:entry.id,status:entry.status}});
 });
 await page.goto(process.env.UI_BASE_URL+'/#agent');
 await page.locator('#agent-current-task[data-status=WAITING_FOR_REVIEW]').waitFor();
 await page.locator('#agent-current-action').click();
 const started=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/review-queue/review-entry-0/claim');
 await page.locator('[data-review-action=claim]').click();await started;
 try {
  await page.locator('#agent-review-close').click();
  await page.locator('.agent-run-item[data-run-id=demo-second-run]').click();
  await page.waitForFunction(()=>document.getElementById('agent-current-context').textContent.includes('demo-second-run'));
  await page.locator('#agent-current-action').click();
  await page.locator('[data-review-entry=review-entry-1]').waitFor();
  assert.equal(await page.locator('[data-review-action=claim]').isDisabled(),true);
  const settled=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/review-queue/review-entry-0/claim');
  release();await(await settled).finished();
  await page.waitForFunction(()=>!document.querySelector('[data-review-entry="review-entry-1"] [data-review-action=claim]').disabled);
  assert.match(await page.locator('#agent-review-content').textContent(),/Frozen review-entry-1/);
  assert.equal(await page.locator('[data-review-entry]').getAttribute('data-status'),'PENDING');
  await page.locator('[data-review-action=claim]').click();
  await page.locator('[data-review-entry=review-entry-1][data-status=IN_REVIEW]').waitFor();
 } finally {release();}
});

test('all run outcomes retain real state, missing evidence and both reading sizes',async t=>{
  const {page,fixture}=await setup(t);
  await page.goto(process.env.UI_BASE_URL+'/#agent');
  await page.locator('#agent-current-task[data-status="WAITING_FOR_REVIEW"]').waitFor();
  const labels={QUEUED:/排队|队列|等待/,RUNNING:/执行|运行/,PARTIAL:/部分/,FAILED:/失败/,CANCELLED:/取消/,WAITING_FOR_REVIEW:/审核/,COMPLETED:/完成/};
  for(const [status,label] of Object.entries(labels)) {
    fixture.run.status=status;fixture.run.statusReason=['PARTIAL','FAILED'].includes(status)?'DEMO retained evidence and missing context':'';
    await page.locator('.agent-run-rail [onclick="loadAgentRuns()"]').click();
    await page.locator(`#agent-current-task[data-status="${status}"]`).waitFor();
    assert.match(await page.locator('#agent-current-status').textContent(),label);
    if(fixture.run.statusReason) assert.match(await page.locator('#agent-current-note').textContent(),/missing context/);
    const sizes=[];
    for(const size of ['standard','large']) {
      await page.evaluate(size=>setAgentTextSize(size),size);
      sizes.push(await page.locator('#agent-current-note').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)));
      assert.equal(await page.locator('#panel-agent .agent-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
    }
    assert.ok(sizes[1]>sizes[0]);
  }
});

test('background step changes preserve disclosure focus and never change preparation mode',async t=>{
  const {page,fixture}=await setup(t,1440);
  await page.goto(process.env.UI_BASE_URL+'/#agent');
  await page.locator('#agent-current-task[data-status="WAITING_FOR_REVIEW"]').waitFor();
  await page.locator('#agent-view-runs').click();
  const summary=page.locator('#agent-timeline [data-detail-kind="audit"] > summary').first();
  await summary.click();await summary.focus();
  const stepId=await summary.evaluate(e=>e.closest('[data-step-id]').dataset.stepId);
  fixture.run.steps.find(step=>step.id===stepId).summary+=' updated by background poll';
  await page.evaluate(()=>loadAgentRuns(true));
  assert.equal(await page.locator('#agent-preparation').evaluate(e=>e.open),false);
  assert.equal(await page.locator('#agent-timeline [data-detail-kind="audit"]').first().evaluate(e=>e.open),true);
  assert.equal(await summary.evaluate(e=>document.activeElement===e),true);
});

test('preparation drafts are retained per repository without applying another repository input',async t=>{
  const {page}=await setup(t,1440);
  await page.goto(process.env.UI_BASE_URL+'/#agent');
  await page.locator('#agent-current-task[data-status="WAITING_FOR_REVIEW"]').waitFor();
  await page.locator('#agent-mode-external-btn').click();
  const draft='{"results":[{"check_id":"repository-a-only"}]}';
  await page.locator('#agent-findings-json').fill(draft);
  await page.locator('.agent-advanced-options > summary').click();
  await page.locator('#agent-code-version').fill('repository-a-code');
  await page.locator('#global-project').selectOption('d3e000000002');
  assert.equal(await page.locator('#agent-findings-json').inputValue(),'');
  await page.locator('#global-project').selectOption('d3e000000001');
  await page.locator('#agent-findings-json').waitFor();
  assert.equal(await page.locator('#agent-findings-json').inputValue(),draft);
  assert.equal(await page.locator('#agent-code-version').inputValue(),'repository-a-code');
  assert.equal(await page.locator('.agent-advanced-options').evaluate(e=>e.open),true);
});

test('late runs and vulnerability inputs cannot refill Agent after switching repositories',async t=>{
  const {page,fixture}=await setup(t,1440);
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route(/\/api\/v1\/(agent-runs|vulns)\?/,async r=>{
    const url=new URL(r.request().url());
    const old=url.searchParams.get('projectId')==='d3e000000001';
    if(old) await gate;
    await r.fulfill({json:old?(url.pathname.endsWith('agent-runs')?[fixture.run]:fixture.vulnerabilities):[]});
  });
  const started=['agent-runs','vulns'].map(path=>page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/'+path&&new URL(r.url()).searchParams.get('projectId')==='d3e000000001'));
  await page.goto(process.env.UI_BASE_URL+'/#agent');await Promise.all(started);
  await page.locator('#global-project').selectOption('d3e000000002');
  await page.waitForFunction(()=>document.querySelector('#agent-run-count').textContent.includes('0'));
  const finished=['agent-runs','vulns'].map(path=>page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/'+path&&new URL(r.url()).searchParams.get('projectId')==='d3e000000001'));
  release();await Promise.all((await Promise.all(finished)).map(r=>r.finished()));
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await page.locator('.agent-vulnerability-item').count(),0);
  assert.equal(await page.locator('.agent-run-item').count(),0);
  assert.equal(await page.locator('#agent-current-task').getAttribute('data-status'),'PREPARING');
  assert.match(await page.locator('#agent-current-context').textContent(),/Inventory/);
});

test('snapshot reading retries failures and disables ambiguous or unauthorized report actions',async t=>{
  const {page,fixture}=await setup(t);
  const pattern='**/api/v1/review-queue/snapshots/*/review';
  await page.route(pattern,r=>r.fulfill({status:503,json:{error:'DEMO frozen unavailable'}}));
  await page.goto(process.env.UI_BASE_URL+'/#agent');
  await page.locator('#agent-current-task[data-status="WAITING_FOR_REVIEW"]').waitFor();
  await page.locator('#agent-current-action').click();
  await page.waitForFunction(()=>document.querySelector('#agent-review-status').textContent.includes('DEMO frozen unavailable'));
  assert.equal(await page.locator('[data-review-action]').count(),0);
  await page.unroute(pattern);
  const restored=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/review'));
  await page.locator('#agent-review-refresh').click();
  const data=await (await restored).json();
  await page.locator('[data-review-entry]').waitFor();
  data.items[0].report=null;data.items[0].reportMatchCount=2;
  await page.route(pattern,r=>r.fulfill({json:data}));
  await page.locator('#agent-review-refresh').click();
  await page.locator('.review-match-warning').waitFor();
  assert.equal(await page.locator('[data-review-action]').count(),0);
  assert.match(await page.locator('.review-match-warning').textContent(),/2/);
  await page.route(pattern,r=>r.fulfill({status:403,json:{error:'DEMO access revoked'}}));
  await page.locator('#agent-review-refresh').click();
  await page.waitForFunction(()=>document.querySelector('#agent-review-status').textContent.includes('DEMO access revoked'));
  assert.equal(await page.locator('[data-review-entry]').count(),0);
  assert.equal(fixture.requested.some(r=>r.startsWith('POST ')),false);
});

test('closing a loading snapshot prevents revival and the modal traps focus and background shortcuts',async t=>{
  const {page,fixture}=await setup(t);
  let release;const gate=new Promise(resolve=>release=resolve);
  const pattern='**/api/v1/review-queue/snapshots/*/review';
  await page.route(pattern,async r=>{await gate;await r.fulfill({status:503,json:{error:'DEMO late result'}});});
  await page.goto(process.env.UI_BASE_URL+'/#agent');
  await page.locator('#agent-current-task[data-status="WAITING_FOR_REVIEW"]').waitFor();
  const started=page.waitForRequest(r=>new URL(r.url()).pathname.endsWith('/review'));
  await page.locator('#agent-current-action').click();await started;
  for(let i=0;i<5;i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.querySelector('#agent-review-dialog').contains(document.activeElement)),true);
  }
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('#command-palette').evaluate(e=>e.open),false);
  await page.locator('#agent-review-close').click();
  const finished=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/review'));
  release();await (await finished).finished();await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await page.locator('#agent-review-dialog').evaluate(e=>e.open),false);
  assert.equal(await page.locator('#agent-current-action').evaluate(e=>document.activeElement===e),true);
  assert.equal(fixture.requested.some(r=>r.startsWith('POST ')),false);
});

for(const [action,status] of [['reject','REJECTED'],['return','PENDING']]) test(`human ${action} uses the existing queue transition and a fresh reason`,async t=>{
  const {page}=await setup(t,1440);
  await page.goto(process.env.UI_BASE_URL+'/#agent');
  await page.locator('#agent-current-task[data-status="WAITING_FOR_REVIEW"]').waitFor();
  await page.locator('#agent-current-action').click();
  await page.locator('[data-review-action="claim"]').click();
  await page.locator('[data-review-reason]').fill('Explicit human review reason');
  await page.locator(`[data-review-action="${action}"]`).click();
  await page.locator(`[data-review-entry][data-status="${status}"]`).waitFor();
  if(action==='return') {
    await page.locator('[data-review-action="claim"]').click();
    await page.locator('[data-review-reason]').waitFor();
    assert.equal(await page.locator('[data-review-reason]').inputValue(),'');
    assert.equal(await page.locator('[data-review-action="confirm"]').isDisabled(),true);
  }
});

test('review reading fits light and dark desktop, tablet and phone layouts in both sizes',async t=>{
  const {page}=await setup(t,1440);
  await page.goto(process.env.UI_BASE_URL+'/#agent');
  await page.locator('#agent-current-task[data-status="WAITING_FOR_REVIEW"]').waitFor();
  await page.locator('#agent-current-action').click();
  await page.locator('[data-review-entry]').waitFor();
  for(const width of [1440,1024,390]) for(const colorScheme of ['light','dark']) {
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme});
    await page.waitForFunction(scheme=>document.documentElement.dataset.colorScheme===scheme,colorScheme);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    for(const size of ['standard','large']) {
      await page.locator(`[data-agent-text-size="${size}"]`).click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.locator(`[data-agent-text-size="${size}"]`).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#agent-review-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,`${width}/${colorScheme}/${size}`);
      if(width>760) {
        const bounds=await page.locator('#agent-review-dialog').boundingBox();
        assert.ok(Math.abs(bounds.x-(width-bounds.width)/2)<2,'Desktop review is centered');
      }
      const contrast=await auditContrast(page);
      assert.deepEqual(contrast.fail,[],`${width}/${colorScheme}/${size} contrast`);
      assert.equal(contrast.overflow,false);
    }
  }
});
test('clearing the only repository does not load a hidden Agent target and explicit selection restores review access',async t=>{
  const {page,fixture}=await setup(t,1440);
  await page.route('**/api/v1/projects',route=>route.fulfill({json:[fixture.projects[0]]}));
  await page.goto(process.env.UI_BASE_URL+'/#tools');
  await page.waitForFunction(()=>document.querySelector('#global-project').options.length===2);
  await page.locator('#global-project').selectOption('');
  await page.locator('#main-navigation [data-workspace=defects]').click();
  await page.locator('.workspace-tab[data-panel=agent]').click();
  await page.locator('#panel-agent.active').waitFor();
  assert.equal(await page.locator('#global-project').inputValue(),'');
  assert.equal(await page.locator('#agent-project-select').inputValue(),'');
  assert.equal(await page.locator('#agent-run-btn').isEnabled(),false);
  if(!await page.locator('#agent-preparation').evaluate(el=>el.open))await page.locator('#agent-preparation > summary').click();
  await page.locator('#agent-project-select').selectOption(fixture.projects[0].projectId);
  await page.locator('#agent-current-task[data-status=WAITING_FOR_REVIEW]').waitFor();
  await page.locator('#agent-current-action').click();await page.locator('#agent-review-dialog[open]').waitFor();
});
test('an unchanged run read clears the current-task stale warning after a failed refresh',async t=>{
  const {page,fixture}=await setup(t,1440);
  await page.goto(process.env.UI_BASE_URL+'/#agent');
  await page.locator('#agent-current-task[data-status=WAITING_FOR_REVIEW]').waitFor();
  let failed=true;
  await page.route('**/api/v1/agent-runs/'+fixture.run.id,route=>failed
    ? route.fulfill({status:503,json:{error:'transient-run-read-error'}}) : route.fallback());
  await page.locator('button[onclick="loadAgentRuns()"]').click();
  await page.locator('#agent-current-note').filter({hasText:'transient-run-read-error'}).waitFor();
  failed=false;
  const fresh=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/agent-runs/'+fixture.run.id);
  await page.locator('button[onclick="loadAgentRuns()"]').click();await fresh;
  await page.waitForFunction(()=>!document.querySelector('#agent-run-detail').classList.contains('stale'));
  assert.doesNotMatch(await page.locator('#agent-current-note').textContent(),/transient-run-read-error/);
});

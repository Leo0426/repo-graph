// Real Spring/SQLite/Neo4j/Qdrant/parser journey, with a deterministic embedding substitute.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const output=path.join(root,'repograph-app/build/ux-next');
const config=JSON.parse(fs.readFileSync(path.join(output,'integration/runtime.json')));
const credentials=JSON.parse(fs.readFileSync(path.join(config.directory,'app-env.json')));
const base='http://127.0.0.1:18080';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(15000);
  const errors=[],writes=[],failures=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().startsWith(base+'/api/')&&r.method()!=='GET')writes.push({method:r.method(),path:new URL(r.url()).pathname});});
  page.on('response',r=>{if(r.url().startsWith(base+'/api/')&&r.status()>=400)failures.push({status:r.status(),path:new URL(r.url()).pathname});});
  await page.goto(base+'/login');
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(credentials.REPOGRAPH_ADMIN_PASSWORD);
  await page.locator('#auth-submit').click();await page.waitForURL(base+'/');
  await page.goto(base+'/#index');await page.locator('#index-root').fill(config.source);
  await page.locator('#index-btn').click();
  await page.locator('#index-state-card[data-state=done]').waitFor({timeout:90000});
  const indexedUnits=Number(await page.locator('#stat-units').innerText());assert.ok(indexedUnits>=2);
  await page.goto(base+'/#tools');await page.locator('.tools-project').waitFor();
  assert.equal(await page.locator('.tools-project').count(),1);
  await page.locator('[data-tools-action=search]').click();
  await page.locator('#search-input').fill('findByName');await page.locator('#search-input').press('Enter');
  await page.locator('.rc-read').first().click();
  await page.locator('.reader-source').filter({hasText:'executeQuery'}).waitFor();
  const sourceLocation=await page.locator('.reader-location code').innerText();
  await page.screenshot({path:path.join(output,'screens/real-stack-source.png')});
  await page.locator('#reader-close').click();
  await page.goto(base+'/#vulns');await page.locator('#vuln-scan-btn').click();
  await page.locator('.vuln-finding').first().waitFor();
  const findings=await page.locator('.vuln-finding').count();
  await page.locator('.vuln-read').first().click();await page.locator('#reader-triage').click();
  await page.locator('#agent-run-btn').click();
  await page.waitForFunction(()=>document.querySelector('#agent-current-task')?.dataset.status==='WAITING_FOR_REVIEW',null,{timeout:90000});
  const snapshotRead=page.waitForResponse(r=>r.url().includes('/review-queue/snapshots/')&&r.url().endsWith('/review')&&r.request().method()==='GET');
  await page.locator('#agent-current-action').click();
  const response=await snapshotRead;assert.equal(response.status(),200);const before=await response.json();
  assert.ok(before.snapshot.reports.length);const frozenHash=digest(before.snapshot);
  await page.locator('[data-review-action=claim]').first().click();
  await page.locator('[data-review-entry][data-status=IN_REVIEW]').waitFor();
  await page.locator('[data-review-reason]').first().fill('Synthetic acceptance review: deterministic fixture evidence inspected.');
  await page.locator('[data-review-action=confirm]').first().click();
  await page.locator('[data-review-entry][data-status=CONFIRMED]').waitFor();
  const afterResponse=await page.request.get(response.url());assert.equal(afterResponse.status(),200);
  const after=await afterResponse.json();assert.equal(digest(after.snapshot),frozenHash);
  await page.screenshot({path:path.join(output,'screens/real-stack-review.png')});
  const embedding=await(await page.request.get('http://127.0.0.1:11435/__requests')).json();
  assert.ok(embedding['/api/embed']>0);assert.ok(!embedding['/api/chat']&&!embedding['/api/generate']);
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  const report={scope:'Real packaged app, authentication/CSRF, SQLite, Neo4j, Qdrant, JavaParser and UI. Synthetic Java source; only embedding is a deterministic local HTTP substitute. No API route mocks.',
   indexedUnits,repositoryCount:1,findings,sourceLocation,frozenSnapshotUnchanged:true,snapshotHash:frozenHash,
   reviewStatus:after.items[0].entry.status,runStatus:await page.locator('#agent-current-task').getAttribute('data-status'),
   embeddingRequests:embedding,generationRequests:0,writes,failures,errors};
  fs.writeFileSync(path.join(output,'results/real-stack-journey.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});

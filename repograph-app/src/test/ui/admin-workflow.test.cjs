'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const installFixtures=require('./fixtures.cjs');
const auditContrast=require('./visual-contrast.cjs');
const baseUrl=process.env.UI_BASE_URL;
let browser;
before(async()=>{browser=await chromium.launch({headless:true,channel:process.env.UI_BROWSER||'chrome'});});
after(async()=>{await browser?.close();});
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
async function setup(t,role='ADMIN',viewport={width:1440,height:1000}){
 const page=await browser.newPage({viewport,reducedMotion:'reduce'});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const fixture=await installFixtures(page);
 const admin={id:'builtin-admin',username:'admin',displayName:'Administrator',email:'admin@localhost',status:'ACTIVE',role:'ADMIN'};
 const accounts=[admin,{id:'alice',username:'alice',displayName:'Alice',email:'alice@example.test',status:'PENDING',role:'USER'}];
 const organizations=[], audit=[], requests=[], providers=[];let members=[];
 const projects=fixture.projects.map(project=>({project,owner:null}));
 await page.route('**/api/v1/auth/me',r=>json(r,role==='ADMIN'?admin:{...accounts[1],status:'ACTIVE'}));
 await page.route('**/api/v1/admin/**',async route=>{
   const path=new URL(route.request().url()).pathname,method=route.request().method();
   requests.push({path,method,csrf:route.request().headers()['x-csrf-token']});
   const body=method==='GET'?null:route.request().postDataJSON();
   if(path.includes('/model-providers')) {
     if(path.endsWith('/model-providers')) {
       if(method==='GET')return json(route,providers);
       const {apiKey,...safe}=body;const saved={...safe,id:'provider-'+(providers.length+1),selected:false,apiKeyConfigured:!!apiKey};
       providers.push(saved);return json(route,saved,201);
     }
     const id=path.split('/model-providers/')[1].split('/')[0],provider=providers.find(p=>p.id===id);
     if(path.endsWith('/select')){providers.forEach(p=>p.selected=p===provider);return json(route,provider);}
     if(path.endsWith('/test'))return json(route,{connected:true,message:'连接与模型调用成功'});
     if(method==='PUT'){const {apiKey,...safe}=body;Object.assign(provider,safe);if(apiKey)provider.apiKeyConfigured=true;if(body.clearApiKey)provider.apiKeyConfigured=false;return json(route,provider);}
     if(method==='DELETE'){providers.splice(providers.indexOf(provider),1);return json(route,{deleted:true});}
   }
   if(path.endsWith('/accounts'))return json(route,accounts);
   if(path.endsWith('/review')){accounts[1].status=body.status;audit.push({action:'ACCOUNT_'+body.status,actorId:'builtin-admin',targetId:'alice',reason:body.reason});return json(route,accounts[1]);}
   if(path.endsWith('/organizations')){
     if(method==='POST')organizations.push({id:'org1',name:body.name,active:true});return json(route,method==='GET'?organizations:organizations.at(-1));
   }
   if(path.endsWith('/members'))return json(route,members);
   if(path.includes('/members/')){members=body.member?[accounts.find(a=>a.id===path.split('/').at(-1))]:[];return json(route,members);}
   if(path.endsWith('/organizations/org1')){Object.assign(organizations[0],body);return json(route,organizations[0]);}
   if(path.endsWith('/projects'))return json(route,projects);
   if(path.endsWith('/owner')){const project=projects.find(p=>path.includes(p.project.projectId));project.owner=body;return json(route,body);}
   if(path.endsWith('/audit'))return json(route,audit);
   throw new Error('Unexpected management API '+path);
 });
 t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(fixture.unhandledRequests,[]);});
 await page.goto(new URL('#admin',baseUrl).href,{waitUntil:'domcontentloaded'});
 await page.locator('#panel-admin.active').waitFor();await page.locator('#account-description').filter({hasText:role==='ADMIN'?'平台管理员':'普通账号'}).waitFor();
 return{page,requests,accounts,organizations,projects,providers};
}
test('admin approves registration, manages organization members and assigns project ownership with CSRF',async t=>{
 const {page,requests,accounts,projects}=await setup(t);
 await page.locator('[data-account="alice"]').waitFor();
 await page.locator('[data-account="alice"] input').fill('Verified employee');
 await page.locator('[data-account="alice"] [data-review="ACTIVE"]').click();
 await page.locator('[data-account="alice"] [data-review="DISABLED"]').waitFor();assert.equal(accounts[1].status,'ACTIVE');
 await page.locator('[data-tab="organizations"]').click();
 await page.locator('#organization-name').fill('Security Engineering');await page.locator('#organization-form button').click();
 await page.locator('[data-org-action="members"]').click();await page.locator('#admin-member-candidate').selectOption('alice');
 await page.locator('#admin-member-add').click();await page.locator('[data-remove-member="alice"]').waitFor();
 await page.locator('[data-tab="projects"]').click();
 await page.locator('[data-project-owner]').first().locator('select').selectOption('ORGANIZATION:org1');
 await page.locator('[data-project-owner]').first().locator('button').click();
 await page.waitForFunction(()=>!adminView.busy);
 assert.equal(projects[0].owner.ownerId,'org1');
 assert.ok(requests.filter(r=>r.method!=='GET').every(r=>r.csrf==='demo-csrf'));
 await page.screenshot({path:'/tmp/repograph-enterprise-admin.png',fullPage:true});
});
test('ordinary users see their account but no administrative sections or requests',async t=>{
 const {page,requests}=await setup(t,'USER',{width:390,height:844});
 assert.equal(await page.locator('#admin-tabs').isVisible(),false);
 assert.equal(await page.locator('.workspace-tab[data-panel="index"]').isVisible(),false);
 assert.equal(requests.length,0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/repograph-enterprise-user-mobile.png',fullPage:true});
});

test('management language changes translate dynamic controls and errors while preserving drafts and original data',async t=>{
 const {page}=await setup(t);
 await page.locator('[data-account="alice"] input').fill('用户输入不翻译');
 await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();await page.keyboard.press('Escape');
 assert.match(await page.locator('#account-description').textContent(),/Platform administrator/);
 assert.equal(await page.locator('[data-account="alice"] [data-review="ACTIVE"]').textContent(),'Approve');
 assert.match(await page.locator('[data-account="alice"] input').getAttribute('aria-label'),/Alice/);
 assert.equal(await page.locator('[data-account="alice"] input').inputValue(),'用户输入不翻译');
 await page.locator('[data-tab="providers"]').click();await page.locator('#provider-new').click();
 assert.match(await page.locator('#provider-editor-title').textContent(),/Add provider/);
 assert.equal(await page.locator('#provider-form [data-i18n="btn.cancel"]').textContent(),'Cancel');
 await page.locator('#provider-name').fill('Gateway 草稿');
 await page.locator('#provider-base-url').fill('https://models.example.test/v1');await page.locator('#provider-model').fill('draft-model');
 await page.locator('#provider-api-key').fill('draft-key');
 await page.route('**/api/v1/admin/model-providers',async route=>route.request().method()==='POST'
  ? json(route,{message:'Backend detail 原文'},503) : route.fallback());
 await page.locator('#provider-save').click();
 await page.locator('#provider-status').filter({hasText:'Operation failed'}).waitFor();
 await page.locator('#account-menu > summary').click();await page.locator('#lang-zh').click();await page.keyboard.press('Escape');
 assert.match(await page.locator('#provider-status').textContent(),/操作失败.*Backend detail 原文/);
 assert.equal(await page.locator('#provider-form [data-i18n="btn.cancel"]').textContent(),'取消');
 assert.equal(await page.locator('#provider-name').inputValue(),'Gateway 草稿');
 assert.equal(await page.locator('#provider-api-key').inputValue(),'draft-key');
 await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();await page.keyboard.press('Escape');
 assert.match(await page.locator('#provider-url-hint').textContent(),/API prefix/);
 assert.match(await page.locator('#provider-status').textContent(),/Operation failed.*Backend detail 原文/);
 assert.match(await page.locator('#provider-key-hint').textContent(),/not displayed/);
});
test('client-generated management error details follow later language changes',async t=>{
 const {page}=await setup(t);
 await page.route('**/api/v1/admin/model-providers',route=>json(route,{}));
 await page.locator('[data-tab=providers]').click();
 await page.locator('#provider-status').filter({hasText:'Provider 数据格式无效'}).waitFor();
 await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();await page.keyboard.press('Escape');
 assert.match(await page.locator('#provider-status').textContent(),/Invalid provider data/);
 assert.doesNotMatch(await page.locator('#provider-status').textContent(),/数据格式无效/);
 await page.route('**/api/v1/admin/accounts',route=>json(route,{}));
 await page.locator('#admin-refresh').click();
 await page.locator('#admin-status').filter({hasText:'Invalid administration data'}).waitFor();
 await page.locator('#account-menu > summary').click();await page.locator('#lang-zh').click();await page.keyboard.press('Escape');
 assert.match(await page.locator('#admin-status').textContent(),/管理数据格式无效/);
 assert.doesNotMatch(await page.locator('#admin-status').textContent(),/Invalid administration data/);
});
test('registration page submits a pending-account application and displays approval instructions',async t=>{
 const page=await browser.newPage();t.after(()=>page.close());
 await page.route('**/api/v1/auth/csrf',r=>json(r,{headerName:'X-CSRF-TOKEN',token:'public-token'}));
 let registration;
 await page.route('**/api/v1/auth/register',r=>{registration=r.request().postDataJSON();assert.equal(r.request().headers()['x-csrf-token'],'public-token');return json(r,{status:'PENDING'},201);});
 await page.goto(new URL('/login',baseUrl).href);
 await page.locator('#auth-toggle').click();await page.locator('#username').fill('newuser');
 await page.locator('#display-name').fill('New User');await page.locator('#email').fill('new@example.test');
 await page.locator('#password').fill('New-user-password-2026');await page.locator('#auth-submit').click();
 await page.locator('#auth-status').filter({hasText:'等待管理员审核'}).waitFor();
 assert.equal(registration.username,'newuser');assert.equal(registration.role,undefined);
 assert.equal(await page.locator('#password').inputValue(),'');
});
test('login and registration follow the saved language and switch without discarding credentials or server error detail',async t=>{
 const page=await browser.newPage({viewport:{width:390,height:844}});t.after(()=>page.close());
 await page.addInitScript(()=>localStorage.setItem('repograph_lang','en'));
 await page.route('**/api/v1/auth/csrf',r=>json(r,{headerName:'X-CSRF-TOKEN',token:'public-token'}));
 await page.route('**/api/v1/auth/login',r=>json(r,{error:'Server detail 原文'},503));
 await page.route('**/api/v1/auth/register',r=>json(r,{status:'PENDING'},201));
 await page.goto(new URL('/login',baseUrl).href);
 assert.equal(await page.locator('#auth-heading').textContent(),'Sign in');
 await page.locator('#username').fill('newuser');await page.locator('#password').fill('Fictional-password-2026');
 await page.locator('#auth-submit').click();await page.locator('#auth-status').filter({hasText:'Server detail 原文'}).waitFor();
 await page.locator('#auth-lang-zh').click();await page.locator('#auth-lang-en').click();
 assert.equal(await page.locator('#username').inputValue(),'newuser');assert.equal(await page.locator('#password').inputValue(),'Fictional-password-2026');
 assert.equal(await page.locator('#auth-status').textContent(),'Server detail 原文');
 await page.locator('#auth-toggle').click();assert.equal(await page.locator('#auth-heading').textContent(),'Request an account');
 await page.locator('#display-name').fill('New User');await page.locator('#email').fill('new@example.test');await page.locator('#auth-submit').click();
 await page.locator('#auth-status').filter({hasText:'awaiting administrator approval'}).waitFor();
 assert.equal(await page.locator('#password').inputValue(),'');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});

test('admin creates and selects a custom provider, keeps saved keys private, and disables generation',async t=>{
 const {page,requests,providers}=await setup(t);
 await page.locator('[data-tab="providers"]').click();
 await page.locator('#provider-new').click();
 await page.locator('#provider-name').fill('Company Claude');
 await page.locator('#provider-protocol').selectOption('ANTHROPIC');
 await page.locator('#provider-base-url').fill('https://models.example.test/v1');
 await page.locator('#provider-model').fill('claude-test');
 await page.locator('#provider-api-key').fill('private-provider-key');
 assert.equal(await page.locator('#provider-input-price, #provider-output-price').count(),0);
 await page.locator('#provider-enabled').check();
 await page.locator('#provider-save').click();
 await page.locator('[data-provider-select]').click();
 await page.waitForFunction(()=>!providerView.busy);
 assert.equal(providers[0].selected,true);assert.equal(providers[0].protocol,'ANTHROPIC');
 await page.locator('[data-provider-edit]').click();
 assert.equal(await page.locator('#provider-api-key').inputValue(),'');
 await page.locator('#provider-name').fill('Renamed Claude');
 await page.locator('#provider-save').click();
 await page.waitForFunction(()=>!providerView.busy);
 assert.equal(providers[0].apiKeyConfigured,true);
 assert.equal(providers[0].inputUsdPerMillionTokens,undefined);assert.equal(providers[0].outputUsdPerMillionTokens,undefined);
 await page.locator('[data-provider-edit]').click();await page.locator('#provider-enabled').uncheck();
 await page.locator('#provider-save').click();await page.waitForFunction(()=>!providerView.busy);
 assert.equal(providers[0].enabled,false);
 assert.equal((await page.locator('#admin-providers').innerText()).includes('private-provider-key'),false);
 assert.ok(requests.filter(r=>r.method!=='GET').every(r=>r.csrf==='demo-csrf'));
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/repograph-provider-mobile.png',fullPage:true});
});

test('provider save failure preserves the draft and connection failures can be retried',async t=>{
 const {page,providers}=await setup(t);
 let attempts=0;
 await page.route('**/api/v1/admin/model-providers',async route=>{
  if(route.request().method()==='POST'&&++attempts===1)return json(route,{error:'暂时不可用'},503);
  return route.fallback();
 });
 await page.locator('[data-tab="providers"]').click();await page.locator('#provider-new').click();
 await page.locator('#provider-name').fill('Retry gateway');
 await page.locator('#provider-base-url').fill('https://gateway.example.test/v1');
 await page.locator('#provider-model').fill('model');await page.locator('#provider-api-key').fill('retry-secret');
 await page.locator('#provider-save').click();
 await page.locator('#provider-status').filter({hasText:'操作失败'}).waitFor();
 assert.equal(await page.locator('#provider-name').inputValue(),'Retry gateway');
 assert.equal(await page.locator('#provider-api-key').inputValue(),'retry-secret');
 await page.locator('#provider-save').click();await page.locator('[data-provider-edit]').waitFor();
 assert.equal(providers.length,1);assert.equal(await page.locator('#provider-api-key').inputValue(),'');
 let checks=0;
 await page.route('**/api/v1/admin/model-providers/*/test',route=>json(route,++checks===1
  ?{connected:false,message:'模型认证失败'}:{connected:true,message:'连接成功'}));
 await page.locator('[data-provider-test]').click();
 await page.locator('#provider-status[data-state="error"]').filter({hasText:'模型认证失败'}).waitFor();
 await page.locator('[data-provider-test]').click();
 await page.locator('#provider-status[data-state="success"]').filter({hasText:'连接成功'}).waitFor();
});


test('all provider templates prepare editable drafts and never carry secrets or make requests', async t => {
 const {page, requests, providers}=await setup(t);
 await page.locator('[data-tab="providers"]').click(); await page.locator('#provider-new').click();
 const expected={openai:['OPENAI','https://api.openai.com/v1'],anthropic:['ANTHROPIC','https://api.anthropic.com/v1'],gemini:['OPENAI_COMPATIBLE','https://generativelanguage.googleapis.com/v1beta/openai'],deepseek:['OPENAI_COMPATIBLE','https://api.deepseek.com'],qwen:['OPENAI_COMPATIBLE','https://dashscope.aliyuncs.com/compatible-mode/v1'],siliconflow:['OPENAI_COMPATIBLE','https://api.siliconflow.cn/v1'],ollama:['OLLAMA','http://localhost:11434'],custom:['OPENAI_COMPATIBLE','']};
 for (const [key,[protocol,url]] of Object.entries(expected)) {
   await page.locator('#provider-api-key').fill('never-forward-this');
   await page.locator('#provider-model').fill('old-model');
   await page.locator('#provider-preset').selectOption(key); await page.locator('#provider-apply-preset').click();
   assert.equal(await page.locator('#provider-protocol').inputValue(),protocol);
   assert.equal(await page.locator('#provider-base-url').inputValue(),url);
   assert.equal(await page.locator('#provider-api-key').inputValue(),'');
   assert.equal(await page.locator('#provider-model').inputValue(),'');
 }
 assert.equal(requests.filter(r=>r.method!=='GET').length,0);
 await page.locator('#provider-name').fill('Enterprise gateway');
 await page.locator('#provider-base-url').fill('https://enterprise.example.test/ai/v1');
 await page.locator('#provider-model').fill('company-model');await page.locator('#provider-api-key').fill('company-key');
 await page.locator('#provider-save').click();await page.locator('[data-provider-edit]').waitFor();
 assert.equal(providers[0].protocol,'OPENAI_COMPATIBLE');assert.equal(providers[0].model,'company-model');
 await page.locator('[data-provider-edit]').click();assert.equal(await page.locator('#provider-preset-controls').isVisible(),false);
 assert.equal(await page.locator('#provider-api-key').inputValue(),'');
});


test('model discovery uses an unsaved draft, offers explicit selection and keeps manual entry', async t => {
 const {page,providers}=await setup(t);
 const drafts=[];
 await page.route('**/api/v1/admin/model-providers/models',route=>{
   drafts.push(route.request().postDataJSON());
   return json(route,{models:['alpha','team/beta']});
 });
 await page.locator('[data-tab="providers"]').click();await page.locator('#provider-new').click();
 await page.locator('#provider-base-url').fill('https://models.example.test/v1');
 await page.locator('#provider-api-key').fill('draft-secret');
 await page.locator('#provider-model').fill('manual-model');
 await page.locator('#provider-fetch-models').click();
 await page.locator('#provider-model-options option[value="team/beta"]').waitFor({state:'attached'});
 assert.equal(drafts[0].apiKey,'draft-secret');assert.equal(drafts[0].providerId,null);
 assert.equal(providers.length,0);
 assert.equal(await page.locator('#provider-model').inputValue(),'manual-model');
 await page.locator('#provider-model-options').selectOption('team/beta');
 assert.equal(await page.locator('#provider-model').inputValue(),'team/beta');
 assert.equal(await page.locator('#provider-api-key').inputValue(),'draft-secret');
 await page.locator('#account-menu > summary').click();await page.locator('#lang-en').click();await page.keyboard.press('Escape');
 assert.match(await page.locator('#provider-model-status').textContent(),/2 models/);
 await page.locator('#provider-model').fill('another-manual-model');
 await page.locator('#provider-name').fill('Draft gateway');
 await page.locator('#provider-save').click();await page.locator('[data-provider-edit]').waitFor();
 assert.equal(providers[0].model,'another-manual-model');
 assert.equal('inputUsdPerMillionTokens' in providers[0],false);
 assert.doesNotMatch(await page.locator('#admin-providers').innerText(),/单价|USD|configure before/);
 await page.locator('[data-provider-edit]').click();await page.locator('#provider-fetch-models').click();
 await page.waitForFunction(()=>document.querySelector('#provider-model-status').dataset.state==='success');
 assert.equal(drafts[1].providerId,providers[0].id);assert.equal(drafts[1].apiKey,'');
 assert.equal(await page.locator('#provider-api-key').inputValue(),'');
});

test('model discovery failures can retry, and endpoint edits discard late model lists', async t => {
 const {page}=await setup(t);
 let calls=0,finish;
 await page.route('**/api/v1/admin/model-providers/models',async route=>{
   calls++;
   if(calls===1)return json(route,{error:'HTTP 401'},502);
   if(calls===2)return json(route,{models:[]});
   await new Promise(resolve=>{finish=resolve;});
   return json(route,{models:['obsolete-model']}).catch(()=>{});
 });
 await page.locator('[data-tab="providers"]').click();await page.locator('#provider-new').click();
 await page.locator('#provider-base-url').fill('https://models.example.test/v1');
 await page.locator('#provider-api-key').fill('retry-secret');await page.locator('#provider-model').fill('manual');
 await page.locator('#provider-fetch-models').click();
 await page.locator('#provider-model-status[data-state="error"]').waitFor();
 assert.equal(await page.locator('#provider-api-key').inputValue(),'retry-secret');
 assert.equal(await page.locator('#provider-model').inputValue(),'manual');
 await page.locator('#provider-fetch-models').click();
 await page.locator('#provider-model-status').filter({hasText:'未返回可用模型'}).waitFor();
 assert.equal(await page.locator('#provider-model-picker').isVisible(),false);
 await page.locator('#provider-fetch-models').click();await page.waitForFunction(()=>document.querySelector('#provider-fetch-models').disabled);
 while(!finish)await new Promise(resolve=>setTimeout(resolve,10));
 await page.locator('#provider-base-url').fill('https://other.example.test/v1');finish();
 await page.waitForFunction(()=>!document.querySelector('#provider-fetch-models').disabled);
 assert.equal(await page.locator('#provider-model-picker').isVisible(),false);
 assert.equal(await page.locator('#provider-model-options option[value="obsolete-model"]').count(),0);
 assert.equal(await page.locator('#provider-model').inputValue(),'manual');
 assert.equal(await page.locator('#provider-model-status').textContent(),'');
});

test('editing historical provider prices retains them only while the model connection is unchanged', async t => {
 const {page,providers}=await setup(t);
 providers.push({id:'historical',name:'Historical',protocol:'OPENAI',baseUrl:'https://models.example.test/v1',
  model:'old-model',enabled:true,selected:false,apiKeyConfigured:true,timeoutMillis:30000,maxOutputTokens:2048,
  inputUsdPerMillionTokens:2,outputUsdPerMillionTokens:8});
 await page.locator('[data-tab="providers"]').click();await page.locator('[data-provider-edit]').click();
 await page.locator('#provider-name').fill('Renamed');await page.locator('#provider-save').click();
 await page.waitForFunction(()=>!providerView.busy);
 assert.equal(providers[0].inputUsdPerMillionTokens,2);assert.equal(providers[0].outputUsdPerMillionTokens,8);
 await page.locator('[data-provider-edit]').click();await page.locator('#provider-model').fill('new-model');
 await page.locator('#provider-save').click();await page.waitForFunction(()=>!providerView.busy);
 assert.equal(providers[0].model,'new-model');
 assert.equal(providers[0].inputUsdPerMillionTokens,null);assert.equal(providers[0].outputUsdPerMillionTokens,null);
 assert.equal(await page.locator('#provider-input-price, #provider-output-price').count(),0);
});

for(const colorScheme of ['light','dark'])for(const width of [1440,390]) {
 test(`model picker stays readable and fits at ${width}px in ${colorScheme}`,async t=>{
  const {page}=await setup(t,'ADMIN',{width,height:1000});
  await page.emulateMedia({colorScheme});
  const longModel='team/'+ 'long-model-name-'.repeat(10);
  await page.route('**/api/v1/admin/model-providers/models',route=>json(route,{models:['short',longModel]}));
  await page.locator('[data-tab="providers"]').click();await page.locator('#provider-new').click();
  await page.locator('#provider-base-url').fill('https://models.example.test/v1');
  await page.locator('#provider-fetch-models').click();await page.locator('#provider-model-picker').waitFor();
  await page.locator('#provider-model-options').selectOption(longModel);
  assert.equal(await page.locator('#provider-model').inputValue(),longModel);
  await page.locator('#provider-model-status').scrollIntoViewIfNeeded();
  const result=await auditContrast(page);
  assert.deepEqual(result.fail,[]);assert.equal(result.overflow,false);assert.equal(result.panelOverflow,false);
  await page.screenshot({path:`/tmp/repograph-model-picker-${colorScheme}-${width}.png`,fullPage:true});
 });
}

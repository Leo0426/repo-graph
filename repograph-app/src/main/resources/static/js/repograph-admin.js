const adminView = { accounts:[], organizations:[], projects:[], audit:[], selectedOrg:'', members:[], membersVersion:0, loading:false, busy:false, version:0 };
const accountStatus = value => ['PENDING','ACTIVE','REJECTED','DISABLED'].includes(value) ? t('admin.status.' + value) : value;
const accountStatusText = value => ['PENDING','ACTIVE','REJECTED','DISABLED'].includes(value) ? localizedText('admin.status.' + value) : esc(value);
function renderAccountDescription() {
  if (!sessionAccount) return;
  document.getElementById('account-name').textContent = sessionAccount.displayName || sessionAccount.username;
  document.getElementById('account-description').textContent = `${sessionAccount.username} · ${t(sessionAccount.role === 'ADMIN' ? 'admin.role.admin' : 'admin.role.user')} · ${accountStatus(sessionAccount.status)}`;
}
async function adminRequest(path, method = 'GET', body, signal) {
  const response = await fetch('/api/v1/' + path, { method, signal,
    ...(body === undefined ? {} : { headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }) });
  if (!response.ok) throw new Error(await apiError(response));
  return response.json();
}
async function loadAdmin() {
  await sessionReady;
  renderAccountDescription();
  if (sessionAccount.role !== 'ADMIN' || adminView.loading) return;
  const version = ++adminView.version;
  adminView.loading = true; document.getElementById('admin-refresh').disabled = true;
  setAdminStatus('admin.loading');
  try {
    const [accounts, organizations, projects, audit] = await Promise.all([
      adminRequest('admin/accounts'), adminRequest('admin/organizations'), adminRequest('admin/projects'), adminRequest('admin/audit')
    ]);
    if (version !== adminView.version) return;
    if (![accounts, organizations, projects, audit].every(Array.isArray)) throw clientMessageError('admin.invalid');
    Object.assign(adminView,{accounts,organizations,projects,audit});
    renderAdminAccounts(); renderAdminOrganizations(); renderAdminProjects(); renderAdminAudit();
    if (adminView.selectedOrg) await loadAdminMembers(adminView.selectedOrg);
    setAdminStatus('');
  } catch(error) { setAdminStatus('admin.loadFailed', errorMessageArgument(error)); }
  finally { adminView.loading = false; document.getElementById('admin-refresh').disabled = false; }
}
function setAdminStatus(message, ...args) {
  const element = document.getElementById('admin-status');
  if (message.startsWith('admin.')) setLocalizedText(element, message, ...args);
  else clearLocalizedText(element, message);
}
function selectAdminTab(tab) {
  if (tab === 'providers') loadProviders();
  if (tab === 'audit') loadAdmin();
  document.querySelectorAll('#admin-tabs button').forEach(button => {
    const selected = button.dataset.tab === tab; button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));
  });
  document.querySelectorAll('.admin-section').forEach(section => { section.hidden = section.id !== 'admin-' + tab; });
}
async function adminMutation(action) {
  if (adminView.busy) return;
  if (adminView.loading) { setAdminStatus('admin.refreshing'); return; }
  adminView.busy = true;
  document.querySelectorAll('#panel-admin button').forEach(button=>{button.disabled=true;});
  try { await action(); await loadAdmin(); setAdminStatus('admin.saved'); }
  catch(error) {
    if (error.translationKey) setAdminStatus(error.translationKey);
    else clearLocalizedText(document.getElementById('admin-status'), error.message);
  }
  finally { adminView.busy=false;document.querySelectorAll('#panel-admin button').forEach(button=>{button.disabled=false;}); }
}
function renderAdminAccounts() {
  const filter = document.getElementById('admin-account-filter').value;
  const accounts = adminView.accounts.filter(account => !filter || account.status === filter);
  document.getElementById('admin-account-list').innerHTML = accounts.map(account => {
    const actions = account.id === 'builtin-admin' ? [] : account.status === 'PENDING' ? [['ACTIVE','admin.approve'],['REJECTED','admin.reject']]
      : account.status === 'ACTIVE' ? [['DISABLED','admin.disable']] : [['ACTIVE','admin.enable']];
    return `<article class="card" data-account="${esc(account.id)}"><span class="admin-status-pill">${accountStatusText(account.status)}</span><h3>${esc(account.displayName)} · ${esc(account.username)}</h3><p>${esc(account.email)} · ${localizedText(account.role === 'ADMIN' ? 'admin.role.admin' : 'admin.role.user')}</p>${actions.length ? `<div class="admin-actions"><input aria-label="${esc(t('admin.reasonFor', account.displayName))}" data-i18n-aria-label="admin.reasonFor" data-i18n-args="${esc(JSON.stringify([account.displayName]))}" data-i18n-ph="admin.reasonPh" placeholder="${esc(t('admin.reasonPh'))}" maxlength="1000">${actions.map(([status,key])=>`<button class="btn btn-ghost" data-review="${status}">${localizedText(key)}</button>`).join('')}</div>` : `<p>${localizedText('admin.protected')}</p>`}</article>`;
  }).join('') || `<p>${localizedText('admin.noAccounts')}</p>`;
  document.querySelectorAll('[data-review]').forEach(button=>button.addEventListener('click',()=>{
    const row=button.closest('[data-account]'), input=row.querySelector('input');
    if(!input.value.trim()){setAdminStatus('admin.reasonRequired');input.focus();return;}
    adminMutation(()=>adminRequest(`admin/accounts/${encodeURIComponent(row.dataset.account)}/review`,'POST',{status:button.dataset.review,reason:input.value.trim()}));
  }));
}
async function createAdminOrganization() {
  const input=document.getElementById('organization-name');
  await adminMutation(async()=>{await adminRequest('admin/organizations','POST',{name:input.value});input.value='';});
}
function renderAdminOrganizations() {
  document.getElementById('admin-organization-list').innerHTML=adminView.organizations.map(org=>`<article class="card" data-org="${esc(org.id)}"><h3>${esc(org.name)}</h3><p>${localizedText(org.active?'admin.status.ACTIVE':'admin.orgDisabled')}</p><label>${localizedText('admin.orgName')}<input value="${esc(org.name)}" maxlength="100" aria-label="${esc(t('admin.orgNameFor', org.name))}" data-i18n-aria-label="admin.orgNameFor" data-i18n-args="${esc(JSON.stringify([org.name]))}"></label><div class="admin-actions"><button class="btn btn-ghost" data-org-action="rename">${localizedText('admin.saveName')}</button><button class="btn btn-ghost" data-org-action="toggle">${localizedText(org.active?'admin.disable':'admin.enable')}</button><button class="btn btn-primary" data-org-action="members">${localizedText('admin.manageMembers')}</button></div></article>`).join('') || `<p>${localizedText('admin.noOrganizations')}</p>`;
  document.querySelectorAll('[data-org-action]').forEach(button=>button.addEventListener('click',()=>{
    const row=button.closest('[data-org]'),org=adminView.organizations.find(o=>o.id===row.dataset.org);
    if(button.dataset.orgAction==='members')return loadAdminMembers(org.id);
    adminMutation(()=>adminRequest('admin/organizations/'+encodeURIComponent(org.id),'PUT',{name:row.querySelector('input').value,active:button.dataset.orgAction==='toggle'?!org.active:org.active}));
  }));
}
async function loadAdminMembers(id) {
  adminView.selectedOrg=id;
  const version=++adminView.membersVersion;
  const target=document.getElementById('admin-members');setLocalizedText(target,'admin.membersLoading');
  try {
    const members=await adminRequest(`admin/organizations/${encodeURIComponent(id)}/members`);
    if(adminView.selectedOrg!==id||version!==adminView.membersVersion)return;
    adminView.members=members;
    const org=adminView.organizations.find(o=>o.id===id);
    const candidates=adminView.accounts.filter(a=>a.status==='ACTIVE'&&!members.some(m=>m.id===a.id));
    clearLocalizedText(target);
    target.innerHTML=`<section class="card"><h3>${esc(org?.name)} · ${localizedText('admin.members')}</h3>${org?.active&&candidates.length?`<div class="admin-actions"><span class="select-control"><select id="admin-member-candidate" aria-label="${esc(t('admin.addMember'))}" data-i18n-aria-label="admin.addMember">${candidates.map(a=>`<option value="${esc(a.id)}">${esc(a.displayName)} (${esc(a.username)})</option>`).join('')}</select></span><button class="btn btn-primary" id="admin-member-add">${localizedText('admin.addMember')}</button></div>`:''}${members.map(member=>`<div class="admin-actions"><span>${esc(member.username)} · ${accountStatusText(member.status)}</span><button class="btn btn-ghost" data-remove-member="${esc(member.id)}" aria-label="${esc(t('admin.removeMemberFor',member.username))}" data-i18n-aria-label="admin.removeMemberFor" data-i18n-args="${esc(JSON.stringify([member.username]))}">${localizedText('admin.removeMember')}</button></div>`).join('')||`<p>${localizedText('admin.noMembers')}</p>`}</section>`;
    target.querySelector('#admin-member-add')?.addEventListener('click',()=>updateAdminMember(id,document.getElementById('admin-member-candidate').value,true));
    target.querySelectorAll('[data-remove-member]').forEach(button=>button.addEventListener('click',()=>updateAdminMember(id,button.dataset.removeMember,false)));
  } catch(error){ if(adminView.selectedOrg===id&&version===adminView.membersVersion)setLocalizedText(target,'admin.membersFailed',errorMessageArgument(error)); }
}
function updateAdminMember(org,account,member){return adminMutation(()=>adminRequest(`admin/organizations/${encodeURIComponent(org)}/members/${encodeURIComponent(account)}`,'PUT',{member}));}
function renderAdminProjects() {
  const owners=[...adminView.accounts.filter(a=>a.status==='ACTIVE').map(a=>({type:'PERSONAL',id:a.id,name:a.username})),...adminView.organizations.filter(o=>o.active).map(o=>({type:'ORGANIZATION',id:o.id,name:o.name}))];
  const ownerLabel = o => t('admin.owner.'+o.type,o.name);
  document.getElementById('admin-project-list').innerHTML=adminView.projects.map(({project,owner})=>{
    const knownOwner=owner&&owners.find(o=>o.id===owner.ownerId&&o.type===owner.ownerType);
    return `<article class="card" data-project-owner="${esc(project.projectId)}"><h3>${esc(projectName(project))}</h3><p>${esc(project.projectRoot)}</p><p>${esc(project.projectId)} · ${knownOwner?localizedText('admin.owner.'+knownOwner.type,knownOwner.name):owner?esc(owner.ownerType+' / '+owner.ownerId):localizedText('admin.unassigned')}</p><div class="admin-actions"><span class="select-control"><select aria-label="${esc(t('admin.ownerFor',projectName(project)))}" data-i18n-aria-label="admin.ownerFor" data-i18n-args="${esc(JSON.stringify([projectName(project)]))}"><option value="" data-i18n="admin.chooseOwner">${esc(t('admin.chooseOwner'))}</option>${owners.map(o=>`<option value="${esc(o.type+':'+o.id)}" data-i18n="admin.owner.${o.type}" data-i18n-args="${esc(JSON.stringify([o.name]))}" ${owner?.ownerId===o.id&&owner?.ownerType===o.type?'selected':''}>${esc(ownerLabel(o))}</option>`).join('')}</select></span><button class="btn btn-primary">${localizedText('admin.saveOwner')}</button></div></article>`;
  }).join('')||`<p>${localizedText('admin.noProjects')}</p>`;
  document.querySelectorAll('[data-project-owner] button').forEach(button=>button.addEventListener('click',()=>{
    const row=button.closest('[data-project-owner]'),value=row.querySelector('select').value;
    if(!value){setAdminStatus('admin.ownerRequired');return;}
    const [ownerType,ownerId]=value.split(':');
    adminMutation(()=>adminRequest(`admin/projects/${encodeURIComponent(row.dataset.projectOwner)}/owner`,'PUT',{ownerType,ownerId}));
  }));
}
function renderAdminAudit(){document.getElementById('admin-audit-list').innerHTML=adminView.audit.map(event=>`<div class="admin-audit-row"><strong>${esc(event.action)}</strong><p>${esc(event.createdAt)} · ${esc(event.actorId)}</p><p>${esc(event.targetId)} · ${esc(event.reason)}</p></div>`).join('')||`<p>${localizedText('admin.noAudit')}</p>`;}
async function changeAccountPassword(){
  const form=document.getElementById('password-form'),button=form.querySelector('button');button.disabled=true;
  try {await adminRequest('auth/password','POST',{oldPassword:document.getElementById('old-password').value,newPassword:document.getElementById('new-password').value});form.reset();location.assign('/login');}
  catch(error){clearLocalizedText(document.getElementById('admin-status'),error.message);}finally{button.disabled=false;}
}

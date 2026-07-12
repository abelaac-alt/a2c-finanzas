
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.A2C_CONFIG || {};
const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const sb = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

const state = {
  user: null, profile: null, tab: 'home',
  profiles: [], resources: [], members: [], invitations: [],
  transactions: [], notifications: [],
  filters: { query:'', kind:'', resourceId:'', from:'', to:'' }
};

const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format((Number(v)||0)/100);
const cents = v => { let t=String(v??'0').trim().replace(/\s|€/g,''); if(t.includes(','))t=t.replace(/\./g,'').replace(',','.'); const n=Number(t); return Number.isFinite(n)?Math.round(n*100):0; };
const today = () => new Date().toISOString().slice(0,10);
const isAdmin = () => state.profile?.role === 'admin';

function toast(message,bad=false){
  toastEl.textContent=message; toastEl.classList.toggle('bad',bad); toastEl.classList.add('show');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>toastEl.classList.remove('show'),2800);
}
function modal(html,wide=false){
  closeModal();
  document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="modal"><div class="modal-card ${wide?'wide':''}">${html}</div></div>`);
  document.querySelector('#modal').onclick=e=>{if(e.target.id==='modal'||e.target.closest('[data-close]'))closeModal()};
}
function closeModal(){document.querySelector('#modal')?.remove()}
function busy(button,on){if(!button)return;button.disabled=on;button.dataset.label??=button.textContent;button.textContent=on?'Procesando…':button.dataset.label}
function fatal(error){
  console.error(error);
  app.innerHTML=`<section class="auth-shell"><div class="auth-card"><h1>No se pudo cargar A2C Finanzas</h1><p class="muted">${esc(error?.message||'Error desconocido')}</p><button class="btn primary full" onclick="location.reload()">Reintentar</button></div></section>`;
}

if(!sb) fatal(new Error('Configura config.js con la URL y la clave pública de Supabase.'));
else boot().catch(fatal);

async function boot(){
  const {data:{session}}=await sb.auth.getSession();
  state.user=session?.user||null;
  if(state.user) await enter(); else renderLogin();

  sb.auth.onAuthStateChange(async(_event,session)=>{
    state.user=session?.user||null;
    if(state.user) await enter(); else renderLogin();
  });
}

function renderLogin(){
  app.innerHTML=`<section class="auth-shell"><form class="auth-card" id="login-form">
    <div class="brand"><div class="brand-mark">A2C</div><div><h1>A2C Finanzas</h1><p class="muted">Finanzas personales y compartidas</p></div></div>
    <div class="field"><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
    <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn primary full">Entrar</button>
  </form></section>`;
  document.querySelector('#login-form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);
    const {error}=await sb.auth.signInWithPassword({email:String(fd.get('email')).trim().toLowerCase(),password:String(fd.get('password'))});
    busy(b,false);if(error)toast('Email o contraseña incorrectos',true);
  };
}

async function enter(){
  const {data:profile,error}=await sb.from('profiles').select('*').eq('id',state.user.id).single();
  if(error)throw error;
  if(profile.active===false)throw new Error('Tu cuenta está desactivada.');
  state.profile=profile;
  await loadAll();
  renderShell();
}

async function loadAll(){
  const q=[
    sb.from('resources').select('*').order('created_at',{ascending:false}),
    sb.from('resource_members').select('*,profile:profiles(id,email,display_name)').order('created_at'),
    sb.from('resource_invitations').select('*').order('created_at',{ascending:false}),
    sb.from('finance_transactions').select('*,resource:resources(id,name,type)').order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
    sb.from('notifications').select('*').order('created_at',{ascending:false})
  ];
  if(isAdmin())q.push(sb.from('profiles').select('*').order('email'));
  const result=await Promise.all(q);
  for(const r of result)if(r.error)throw r.error;
  [state.resources,state.members,state.invitations,state.transactions,state.notifications]=result.map(r=>r.data||[]);
  state.profiles=isAdmin()?(result[5]?.data||[]):[];
}

async function refresh(render=true){await loadAll();if(render)renderShell()}

function nav(tab,label){return `<button class="nav-btn ${state.tab===tab?'active':''}" data-tab="${tab}">${label}</button>`}
function renderShell(){
  const unread=state.notifications.filter(n=>!n.read_at).length;
  app.innerHTML=`<div class="app-shell">
    <header class="topbar">
      <div class="top-brand"><div class="brand-mark">A2C</div><div><strong>A2C Finanzas</strong><small class="muted">${esc(state.profile.display_name||state.profile.email)}</small></div></div>
      <div class="top-actions">
        <button class="icon-btn" id="notifications">🔔${unread?`<span class="badge">${unread}</span>`:''}</button>
        ${isAdmin()?'<button class="icon-btn" id="admin">⚙</button>':''}
        <button class="icon-btn" id="profile">👤</button>
        <button class="icon-btn" id="logout">Salir</button>
      </div>
    </header>
    <main class="view">${renderPage()}</main>
    <nav class="bottom-nav">${nav('home','Inicio')}${nav('piggy','Huchas')}${nav('folder','Carpetas')}${nav('goal','Objetivos')}${nav('activity','Actividad')}${nav('stats','Estadísticas')}</nav>
  </div>`;
  bind();
}
function renderPage(){
  if(state.tab==='home')return renderHome();
  if(['piggy','folder','goal'].includes(state.tab))return renderResources(state.tab);
  if(state.tab==='activity')return renderActivity();
  return renderStats();
}

function totals(list=state.transactions){
  return list.reduce((a,t)=>{a[t.kind]=(a[t.kind]||0)+Number(t.amount_cents||0);return a},{income:0,expense:0,investment:0,saving:0});
}
function mainBalance(){
  return state.transactions.filter(t=>!t.resource_id).reduce((s,t)=>s+(t.kind==='income'?Number(t.amount_cents):-Number(t.amount_cents)),0);
}
function txRow(tx){
  return `<article class="row clickable" data-edit-tx="${tx.id}"><div><strong>${esc(tx.concept)}</strong><small>${esc(tx.occurred_on)}${tx.resource?.name?` · ${esc(tx.resource.name)}`:' · Cuenta principal'}</small></div><b class="${tx.kind}">${tx.kind==='income'?'+':'-'}${money(tx.amount_cents)}</b></article>`;
}
function renderHome(){
  const t=totals(),all=Math.max(1,t.income+t.expense+t.investment+t.saving);
  const i=Math.round(t.income/all*100),e=i+Math.round(t.expense/all*100),inv=e+Math.round(t.investment/all*100);
  return `<section>
    <article class="hero"><span>Cuenta principal</span><strong>${money(mainBalance())}</strong><small>Saldo disponible</small>
      <div class="quick-actions">
        <button class="quick-action income" data-quick="income">＋ Ingreso</button><button class="quick-action expense" data-quick="expense">− Gasto</button>
        <button class="quick-action investment" data-quick="investment">↗ Inversión</button><button class="quick-action saving" data-quick="saving">◎ Ahorro</button>
      </div>
    </article>
    <div class="grid four">
      <article class="card"><h3>Ingresos</h3><div class="metric income">${money(t.income)}</div></article>
      <article class="card"><h3>Gastos</h3><div class="metric expense">${money(t.expense)}</div></article>
      <article class="card"><h3>Inversión</h3><div class="metric investment">${money(t.investment)}</div></article>
      <article class="card"><h3>Ahorros</h3><div class="metric saving">${money(t.saving)}</div></article>
    </div>
    <article class="card" style="margin-top:16px"><h2>Distribución</h2><div class="pie-layout"><div class="pie-chart" style="--income:${i}%;--expense:${e}%;--investment:${inv}%"></div><div class="pie-legend">
      <span><i class="dot income"></i>Ingresos <b>${money(t.income)}</b></span><span><i class="dot expense"></i>Gastos <b>${money(t.expense)}</b></span>
      <span><i class="dot investment"></i>Inversión <b>${money(t.investment)}</b></span><span><i class="dot saving"></i>Ahorros <b>${money(t.saving)}</b></span>
    </div></div></article>
    <div class="section-head"><div><h2>Movimientos recientes</h2><p class="muted">Pulsa para editar</p></div><button class="btn primary" data-new-tx>Nuevo</button></div>
    <div class="list">${state.transactions.slice(0,10).map(txRow).join('')||'<div class="empty">No hay movimientos.</div>'}</div>
  </section>`;
}
function resourceBalance(id){return state.transactions.filter(t=>t.resource_id===id).reduce((s,t)=>s+(t.kind==='income'?Number(t.amount_cents):-Number(t.amount_cents)),0)}
function renderResources(type){
  const meta={piggy:['Huchas','Cuentas personales o compartidas'],folder:['Carpetas','Control de una misma cosa'],goal:['Objetivos','Metas económicas con fecha']}[type];
  const list=state.resources.filter(r=>r.type===type);
  return `<section><div class="section-head"><div><h2>${meta[0]}</h2><p class="muted">${meta[1]}</p></div><button class="btn primary" data-new-resource="${type}">Nuevo</button></div>
    <div class="grid two">${list.map(r=>{
      const balance=resourceBalance(r.id),members=state.members.filter(m=>m.resource_id===r.id).length,pct=r.target_cents?Math.min(100,Math.round(Math.max(0,balance)/r.target_cents*100)):0;
      return `<article class="card"><div class="entity-header"><div><h3>${esc(r.name)}</h3><p class="muted">${r.is_shared?`Compartido · ${members} miembros`:'Personal'}</p></div><button class="icon-btn" data-resource="${r.id}">•••</button></div><div class="metric">${money(balance)}</div>${type==='goal'?`<div class="progress"><i style="width:${pct}%"></i></div><small>${pct}% de ${money(r.target_cents)}${r.target_date?` · ${esc(r.target_date)}`:''}</small>`:''}${r.description?`<p class="muted">${esc(r.description)}</p>`:''}</article>`;
    }).join('')||'<div class="empty">No hay elementos.</div>'}</div></section>`;
}
function filtered(){
  const f=state.filters;
  return state.transactions.filter(t=>(!f.query||String(t.concept).toLowerCase().includes(f.query.toLowerCase()))&&(!f.kind||t.kind===f.kind)&&(!f.resourceId||t.resource_id===f.resourceId)&&(!f.from||t.occurred_on>=f.from)&&(!f.to||t.occurred_on<=f.to));
}
function renderActivity(){
  return `<section><div class="section-head"><div><h2>Actividad</h2><p class="muted">Busca, filtra y edita</p></div><button class="btn primary" data-new-tx>Nuevo</button></div>
    <form class="filters" id="activity-filter"><input name="query" placeholder="Concepto" value="${esc(state.filters.query)}"><input name="from" type="date" value="${esc(state.filters.from)}"><input name="to" type="date" value="${esc(state.filters.to)}">
      <select name="kind"><option value="">Todos</option>${['income','expense','investment','saving'].map(k=>`<option value="${k}" ${state.filters.kind===k?'selected':''}>${k}</option>`).join('')}</select>
      <select name="resourceId"><option value="">Todos los espacios</option>${state.resources.map(r=>`<option value="${r.id}" ${state.filters.resourceId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select>
    </form><div class="list" id="activity-list">${filtered().map(txRow).join('')||'<div class="empty">No hay movimientos.</div>'}</div></section>`;
}
function renderStats(){
  const list=state.transactions.filter(t=>(!state.filters.from||t.occurred_on>=state.filters.from)&&(!state.filters.to||t.occurred_on<=state.filters.to)),t=totals(list);
  return `<section><div class="section-head"><div><h2>Estadísticas</h2><p class="muted">Selecciona un periodo</p></div></div><form class="filters" id="stats-filter"><input name="from" type="date" value="${esc(state.filters.from)}"><input name="to" type="date" value="${esc(state.filters.to)}"></form>
    <div class="grid four"><article class="card"><h3>Ingresos</h3><div class="metric income">${money(t.income)}</div></article><article class="card"><h3>Gastos</h3><div class="metric expense">${money(t.expense)}</div></article><article class="card"><h3>Inversión</h3><div class="metric investment">${money(t.investment)}</div></article><article class="card"><h3>Ahorros</h3><div class="metric saving">${money(t.saving)}</div></article></div></section>`;
}

function bind(){
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;renderShell()});
  document.querySelector('#logout')?.addEventListener('click',()=>sb.auth.signOut());
  document.querySelector('#profile')?.addEventListener('click',openProfile);
  document.querySelector('#admin')?.addEventListener('click',openAdmin);
  document.querySelector('#notifications')?.addEventListener('click',openNotifications);
  document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>openTransaction({kind:b.dataset.quick}));
  document.querySelectorAll('[data-new-tx]').forEach(b=>b.onclick=()=>openTransaction({}));
  document.querySelectorAll('[data-edit-tx]').forEach(b=>b.onclick=()=>openTransaction(state.transactions.find(t=>t.id===b.dataset.editTx)));
  document.querySelectorAll('[data-new-resource]').forEach(b=>b.onclick=()=>openResource({type:b.dataset.newResource}));
  document.querySelectorAll('[data-resource]').forEach(b=>b.onclick=()=>openResourceMenu(b.dataset.resource));
  const af=document.querySelector('#activity-filter');
  if(af)af.oninput=()=>{const fd=new FormData(af);Object.assign(state.filters,{query:String(fd.get('query')||''),from:String(fd.get('from')||''),to:String(fd.get('to')||''),kind:String(fd.get('kind')||''),resourceId:String(fd.get('resourceId')||'')});document.querySelector('#activity-list').innerHTML=filtered().map(txRow).join('')||'<div class="empty">No hay movimientos.</div>';bind()};
  const sf=document.querySelector('#stats-filter');
  if(sf)sf.oninput=()=>{const fd=new FormData(sf);state.filters.from=String(fd.get('from')||'');state.filters.to=String(fd.get('to')||'');renderShell()};
}

function resourceOptions(selected=''){return `<option value="">Cuenta principal</option>${state.resources.map(r=>`<option value="${r.id}" ${selected===r.id?'selected':''}>${esc(r.name)} · ${r.type}</option>`).join('')}`}
function openTransaction(tx={}){
  const editing=Boolean(tx.id);
  modal(`<form id="tx-form"><div class="modal-head"><div><h2>${editing?'Editar':'Nuevo'} movimiento</h2></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Tipo</label><select name="kind">${['income','expense','investment','saving'].map(k=>`<option value="${k}" ${tx.kind===k?'selected':''}>${k}</option>`).join('')}</select></div>
    <div class="field"><label>Cuenta / espacio</label><select name="resource_id" ${editing?'disabled':''}>${resourceOptions(tx.resource_id||'')}</select></div>
    <div class="field"><label>Importe (€)</label><input name="amount" required value="${tx.amount_cents?Number(tx.amount_cents)/100:''}"></div>
    <div class="field"><label>Concepto</label><input name="concept" required value="${esc(tx.concept||'')}"></div>
    <div class="field"><label>Fecha</label><input name="date" type="date" required value="${tx.occurred_on||today()}"></div>
    <div class="field"><label>Notas</label><textarea name="notes">${esc(tx.notes||'')}</textarea></div>
    <div class="field"><label>Justificante</label><input name="receipt" type="file" accept="image/*"></div>
    <div class="actions">${editing?'<button type="button" class="btn danger" id="delete-tx">Borrar</button>':''}<button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
  </form>`,true);
  document.querySelector('#tx-form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);
    try{
      const payload={kind:fd.get('kind'),amount_cents:cents(fd.get('amount')),concept:String(fd.get('concept')).trim(),occurred_on:fd.get('date'),notes:String(fd.get('notes')||'')};
      let id=tx.id;
      if(editing){const {error}=await sb.from('finance_transactions').update(payload).eq('id',tx.id);if(error)throw error}
      else{payload.resource_id=fd.get('resource_id')||null;const {data,error}=await sb.from('finance_transactions').insert(payload).select('id').single();if(error)throw error;id=data.id}
      const file=fd.get('receipt');
      if(file instanceof File&&file.size){const ext=(file.name.split('.').pop()||'jpg').toLowerCase(),path=`${state.user.id}/${id}/${crypto.randomUUID()}.${ext}`;const {error}=await sb.storage.from('receipts').upload(path,file,{contentType:file.type||'image/jpeg'});if(error)throw error;const {error:pe}=await sb.from('finance_transactions').update({receipt_path:path}).eq('id',id);if(pe)throw pe}
      closeModal();await refresh();toast(editing?'Movimiento actualizado':'Movimiento guardado');
    }catch(error){toast(error.message,true)}finally{busy(b,false)}
  };
  document.querySelector('#delete-tx')?.addEventListener('click',async()=>{if(!confirm('¿Borrar movimiento?'))return;const {error}=await sb.from('finance_transactions').delete().eq('id',tx.id);if(error)return toast(error.message,true);closeModal();await refresh();toast('Movimiento eliminado')});
}

function openResource(resource){
  const editing=Boolean(resource.id),label=resource.type==='piggy'?'hucha':resource.type==='folder'?'carpeta':'objetivo';
  modal(`<form id="resource-form"><div class="modal-head"><h2>${editing?'Editar':'Nuevo'} ${label}</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Nombre</label><input name="name" required value="${esc(resource.name||'')}"></div><div class="field"><label>Descripción</label><textarea name="description">${esc(resource.description||'')}</textarea></div>
    ${resource.type==='goal'?`<div class="field"><label>Objetivo (€)</label><input name="target" required value="${resource.target_cents?Number(resource.target_cents)/100:''}"></div><div class="field"><label>Fecha</label><input name="target_date" type="date" value="${esc(resource.target_date||'')}"></div>`:''}
    <label class="field"><span>Compartido</span><select name="shared"><option value="false">No</option><option value="true" ${resource.is_shared?'selected':''}>Sí</option></select></label>
    <div class="actions">${editing?'<button type="button" class="btn danger" id="delete-resource">Borrar</button>':''}<button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
  </form>`);
  document.querySelector('#resource-form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);
    const payload={name:String(fd.get('name')).trim(),description:String(fd.get('description')||''),is_shared:fd.get('shared')==='true'};
    if(resource.type==='goal'){payload.target_cents=cents(fd.get('target'));payload.target_date=fd.get('target_date')||null}
    const q=editing?sb.from('resources').update(payload).eq('id',resource.id):sb.from('resources').insert({...payload,type:resource.type});
    const {error}=await q;busy(b,false);if(error)return toast(error.message,true);closeModal();await refresh();toast('Guardado');
  };
  document.querySelector('#delete-resource')?.addEventListener('click',async()=>{if(!confirm('¿Borrar este elemento y sus movimientos?'))return;const {error}=await sb.from('resources').delete().eq('id',resource.id);if(error)return toast(error.message,true);closeModal();await refresh();toast('Eliminado')});
}
function openResourceMenu(id){
  const r=state.resources.find(x=>x.id===id);if(!r)return;
  modal(`<div class="modal-head"><div><h2>${esc(r.name)}</h2><p class="muted">${r.is_shared?'Compartido':'Personal'}</p></div><button class="close-btn" data-close>×</button></div><div class="menu-stack">
    <button class="btn" id="resource-tx">Añadir movimiento</button><button class="btn" id="resource-edit">Editar</button>${r.is_shared?'<button class="btn" id="resource-invite">Invitar usuario</button>':''}<button class="btn" id="resource-view">Ver movimientos</button>
  </div>`);
  document.querySelector('#resource-tx').onclick=()=>openTransaction({resource_id:id});
  document.querySelector('#resource-edit').onclick=()=>openResource(r);
  document.querySelector('#resource-invite')?.addEventListener('click',()=>openInvite(r));
  document.querySelector('#resource-view').onclick=()=>{state.filters.resourceId=id;state.tab='activity';closeModal();renderShell()};
}
function openInvite(r){
  closeModal();modal(`<form id="invite-form"><div class="modal-head"><h2>Invitar a ${esc(r.name)}</h2><button type="button" class="close-btn" data-close>×</button></div><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Enviar</button></div></form>`);
  document.querySelector('#invite-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);const {error}=await sb.rpc('invite_resource_by_email',{p_resource_id:r.id,p_email:String(fd.get('email')).trim().toLowerCase()});busy(b,false);if(error)return toast(error.message,true);closeModal();await refresh();toast('Invitación enviada')};
}

function openNotifications(){
  modal(`<div class="modal-head"><div><h2>Notificaciones</h2></div><button class="close-btn" data-close>×</button></div><div class="list">${state.notifications.map(n=>`<article class="notification"><div><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p><small>${new Date(n.created_at).toLocaleString('es-ES')}</small></div><div class="notification-actions">
    ${n.type==='invitation'&&!n.read_at?`<button class="btn success" data-accept="${n.related_id}">Aceptar</button><button class="btn danger" data-reject="${n.related_id}">Rechazar</button>`:''}${!n.read_at?`<button class="btn" data-read="${n.id}">Leída</button>`:''}<button class="btn danger" data-delete-note="${n.id}">Borrar</button>
  </div></article>`).join('')||'<div class="empty">No hay notificaciones.</div>'}</div>`,true);
  document.querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>respondInvite(b.dataset.accept,true));
  document.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>respondInvite(b.dataset.reject,false));
  document.querySelectorAll('[data-read]').forEach(b=>b.onclick=async()=>{await sb.from('notifications').update({read_at:new Date().toISOString()}).eq('id',b.dataset.read);await refresh(false);openNotifications()});
  document.querySelectorAll('[data-delete-note]').forEach(b=>b.onclick=async()=>{await sb.from('notifications').delete().eq('id',b.dataset.deleteNote);await refresh(false);openNotifications()});
}
async function respondInvite(id,accept){const {error}=await sb.rpc('respond_resource_invitation',{p_invitation_id:id,p_accept:accept});if(error)return toast(error.message,true);await refresh(false);openNotifications();toast(accept?'Invitación aceptada':'Invitación rechazada')}

function openProfile(){
  modal(`<form id="profile-form"><div class="modal-head"><div><h2>Mi perfil</h2><p class="muted">${esc(state.profile.email)}</p></div><button type="button" class="close-btn" data-close>×</button></div><div class="field"><label>Nombre</label><input name="name" required value="${esc(state.profile.display_name||'')}"></div><div class="field"><label>Nueva contraseña</label><input name="password" type="password" minlength="10"></div><div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  document.querySelector('#profile-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);try{const {error}=await sb.from('profiles').update({display_name:String(fd.get('name')).trim()}).eq('id',state.user.id);if(error)throw error;const p=String(fd.get('password')||'');if(p){const {error:pe}=await sb.auth.updateUser({password:p});if(pe)throw pe}closeModal();await enter();toast('Perfil actualizado')}catch(error){toast(error.message,true)}finally{busy(b,false)}};
}
function openAdmin(){
  modal(`<div class="modal-head"><div><h2>Administración</h2><p class="muted">Usuarios y permisos</p></div><button class="close-btn" data-close>×</button></div><button class="btn primary" id="new-user">Crear usuario</button><div class="list" style="margin-top:14px">${state.profiles.map(p=>`<article class="row"><div><strong>${esc(p.display_name||p.email)}</strong><small>${esc(p.email)} · ${esc(p.role)} · ${p.active?'Activo':'Inactivo'}</small></div><button class="btn" data-user="${p.id}">Gestionar</button></article>`).join('')}</div>`,true);
  document.querySelector('#new-user').onclick=()=>openUserForm(null);
  document.querySelectorAll('[data-user]').forEach(b=>b.onclick=()=>openUserForm(state.profiles.find(p=>p.id===b.dataset.user)));
}
function openUserForm(p){
  closeModal();modal(`<form id="user-form"><div class="modal-head"><h2>${p?'Editar':'Crear'} usuario</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Email</label><input name="email" type="email" required value="${esc(p?.email||'')}" ${p?'disabled':''}></div><div class="field"><label>Nombre</label><input name="name" required value="${esc(p?.display_name||'')}"></div>
    <div class="field"><label>Rol</label><select name="role"><option value="user">Usuario</option><option value="admin" ${p?.role==='admin'?'selected':''}>Administrador</option></select></div>
    <div class="field"><label>Estado</label><select name="active"><option value="true">Activo</option><option value="false" ${p?.active===false?'selected':''}>Inactivo</option></select></div>
    <div class="field"><label>${p?'Nueva contraseña':'Contraseña inicial'}</label><input name="password" type="password" minlength="10" ${p?'':'required'}></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  document.querySelector('#user-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);const {data,error}=await sb.functions.invoke('admin-users',{body:{action:p?'update':'create',user_id:p?.id,email:p?.email||String(fd.get('email')).trim().toLowerCase(),display_name:String(fd.get('name')).trim(),role:fd.get('role'),active:fd.get('active')==='true',password:String(fd.get('password')||''),permissions:p?.permissions||{can_create_shared:true,can_invite:true,can_upload_receipts:true}}});busy(b,false);if(error||!data?.ok)return toast(data?.error||error?.message||'No se pudo guardar',true);closeModal();await refresh();openAdmin();toast('Usuario guardado')};
}

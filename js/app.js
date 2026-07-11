import { configured, sb } from './core/supabase.js';
import { state } from './core/store.js';
import { app, fatal, modal, closeModal, cents, today, toast, esc } from './core/ui.js';
import { renderLogin, loadIdentity, signOut, isAdmin } from './core/auth.js';
import { loadAll } from './core/data.js';
import { renderHome } from './pages/home.js';
import { renderPiggies } from './pages/piggies.js';
import { renderFolders } from './pages/folders.js';
import { renderGoals } from './pages/goals.js';
import { renderActivity, rows } from './pages/activity.js';
import { openAdmin } from './pages/admin.js';

const pages = {home:renderHome,piggies:renderPiggies,folders:renderFolders,goals:renderGoals,activity:renderActivity};

window.addEventListener('error', e => console.error(e.error || e.message));
window.addEventListener('unhandledrejection', e => fatal(e.reason));

if(!configured){
  fatal(new Error('Configura SUPABASE_URL y SUPABASE_ANON_KEY en config.js'));
}else{
  boot().catch(fatal);
}

async function boot(){
  const authenticated = await loadIdentity();
  if(authenticated){
    await enter();
  }else{
    renderLogin();
  }
  sb.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.user = session?.user || null;
    if(state.user){ await loadIdentity(); await enter(); }
    else renderLogin();
  });
}

async function enter(){
  await loadAll();
  renderShell();
}

function renderShell(){
  const adminButton = isAdmin() ? '<button class="icon-btn" id="admin-btn">⚙</button>' : '';
  app.innerHTML = `<div class="app-shell">
    <header class="topbar"><div class="top-brand"><div class="brand-mark">A2C</div><div><strong>A2C Finanzas</strong><small class="muted">${esc(state.profile?.display_name||state.profile?.email)}</small></div></div>
    <div class="top-actions">${adminButton}<button class="icon-btn" id="logout-btn">Salir</button></div></header>
    <main class="view" id="view">${pages[state.tab]()}</main>
    <nav class="bottom-nav">${nav('home','Inicio')}${nav('piggies','Huchas')}${nav('folders','Carpetas')}${nav('goals','Objetivos')}${nav('activity','Actividad')}</nav>
  </div>`;
  bind();
}

function nav(tab,label){ return `<button class="nav-btn ${state.tab===tab?'active':''}" data-tab="${tab}">${label}</button>`; }

function bind(){
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;renderShell();});
  document.querySelector('#logout-btn').onclick = signOut;
  document.querySelector('#admin-btn')?.addEventListener('click', openAdmin);
  document.querySelector('[data-new-movement]')?.addEventListener('click', openMovement);
  document.querySelector('[data-new-piggy]')?.addEventListener('click', openPiggy);
  document.querySelector('[data-new-folder]')?.addEventListener('click', openFolder);
  document.querySelector('[data-new-goal]')?.addEventListener('click', openGoal);
  document.querySelectorAll('[data-folder-view]').forEach(b=>b.onclick=()=>{state.tab='activity';renderShell();filterFolder(b.dataset.folderView);});
  const form = document.querySelector('#activity-filter');
  if(form) form.oninput = ()=>filterActivity(form);
}

async function refresh(){ await loadAll(); renderShell(); }

function openMovement(){
  modal(`<form id="movement-form"><div class="modal-head"><h2>Nuevo movimiento</h2><button type="button" class="close-btn" data-close>×</button></div>
  <div class="field"><label>Tipo</label><select name="kind"><option value="expense">Gasto</option><option value="income">Ingreso</option><option value="investment">Inversión</option></select></div>
  <div class="field"><label>Importe</label><input name="amount" required></div><div class="field"><label>Concepto</label><input name="concept" required></div>
  <div class="field"><label>Fecha</label><input name="date" type="date" value="${today()}" required></div>
  <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  document.querySelector('#movement-form').onsubmit = async e => {
    e.preventDefault(); const fd=new FormData(e.currentTarget);
    const {error}=await sb.from('ledger_transactions').insert({
      kind:fd.get('kind'),amount_cents:cents(fd.get('amount')),concept:fd.get('concept'),occurred_on:fd.get('date')
    });
    if(error)return toast(error.message,true);closeModal();await refresh();
  };
}

function openPiggy(){ simpleEntity('Nueva hucha','piggy_banks',{name:'name',is_shared:false}); }
function openFolder(){ simpleEntity('Nueva carpeta','folders',{name:'name'}); }
function openGoal(){
  modal(`<form id="goal-form"><div class="modal-head"><h2>Nuevo objetivo</h2><button type="button" class="close-btn" data-close>×</button></div>
  <div class="field"><label>Nombre</label><input name="name" required></div><div class="field"><label>Meta (€)</label><input name="target" required></div>
  <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Crear</button></div></form>`);
  document.querySelector('#goal-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);
    const {error}=await sb.from('goals').insert({name:fd.get('name'),target_cents:cents(fd.get('target')),is_shared:false});
    if(error)return toast(error.message,true);closeModal();await refresh();};
}

function simpleEntity(title,table){
  modal(`<form id="entity-form"><div class="modal-head"><h2>${title}</h2><button type="button" class="close-btn" data-close>×</button></div>
  <div class="field"><label>Nombre</label><input name="name" required></div>
  <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Crear</button></div></form>`);
  document.querySelector('#entity-form').onsubmit=async e=>{e.preventDefault();const name=new FormData(e.currentTarget).get('name');
    const payload=table==='piggy_banks'?{name,is_shared:false}:{name};
    const {error}=await sb.from(table).insert(payload);if(error)return toast(error.message,true);closeModal();await refresh();};
}

function filterActivity(form){
  const fd=new FormData(form);const q=String(fd.get('q')||'').toLowerCase(),from=fd.get('from'),to=fd.get('to'),kind=fd.get('kind');
  const filtered=state.ledger.filter(tx=>(!q||String(tx.concept).toLowerCase().includes(q))&&(!from||tx.occurred_on>=from)&&(!to||tx.occurred_on<=to)&&(!kind||tx.kind===kind));
  document.querySelector('#activity-list').innerHTML=rows(filtered);
}
function filterFolder(folderId){
  document.querySelector('#activity-list').innerHTML=rows(state.ledger.filter(x=>x.folder_id===folderId));
}

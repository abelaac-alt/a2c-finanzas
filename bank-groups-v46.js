import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const cfg=window.A2C_CONFIG||{};
if(cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY){
const sb=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format((Number(v)||0)/100);
const cents=v=>{let s=String(v||'').trim().replace(/\s|€/g,'');if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Math.round((Number(s)||0)*100)};
const toast=(m,b=false)=>{const e=document.querySelector('#toast');if(!e)return alert(m);e.textContent=m;e.classList.toggle('bad',b);e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),3500)};
const busy=(b,on)=>{if(!b)return;b.disabled=on;b.dataset.txt??=b.textContent;b.textContent=on?'Procesando…':b.dataset.txt};
const openLayer=html=>{document.querySelector('#a2c-v46-layer')?.remove();document.body.insertAdjacentHTML('beforeend',`<div id="a2c-v46-layer" class="a2c-v46-layer"><section class="a2c-v46-panel">${html}</section></div>`);const l=document.querySelector('#a2c-v46-layer');l.onclick=e=>{if(e.target===l||e.target.closest('[data-v46-close]'))l.remove()};return l};

let me,groups=[],members=[],txs=[],splits=[],resources=[],profiles=[],notifications=[];

let notificationsLoading=null;
let notificationsChannel=null;

async function refreshNotifications(){
 if(notificationsLoading)return notificationsLoading;
 notificationsLoading=(async()=>{
   const {data,error}=await sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(100);
   if(error)throw error;
   notifications=data||[];
   updateBellBadge();
   return notifications;
 })();
 try{return await notificationsLoading}
 finally{notificationsLoading=null}
}

function updateBellBadge(){
 document.querySelector('#a2c-notification-button')?.remove();
 const bell=document.querySelector('#notifications');
 if(!bell)return;
 const unread=notifications.filter(n=>!n.read_at).length;
 bell.querySelector('.badge')?.remove();
 if(unread)bell.insertAdjacentHTML('beforeend',`<span class="badge">${unread>99?'99+':unread}</span>`);
 bell.setAttribute('aria-label',unread?`Notificaciones: ${unread} sin leer`:'Notificaciones');
}

function startNotificationRealtime(){
 if(notificationsChannel||!me)return;
 notificationsChannel=sb.channel(`a2c-notifications-${me.id}`)
   .on('postgres_changes',{
     event:'*',
     schema:'public',
     table:'notifications',
     filter:`user_id=eq.${me.id}`
   },async()=>{
     try{
       await refreshNotifications();
       const panel=document.querySelector('#modal .v46-notifications');
       if(panel)renderNotificationRows(panel);
     }catch(error){console.error('No se pudieron actualizar las notificaciones.',error)}
   })
   .subscribe();
}

function renderNotificationRows(container){
 container.innerHTML=notifications.length?notifications.map(n=>`<article class="${n.read_at?'':'unread'}">
   <div><strong>${esc(n.title||'Notificación')}</strong><p>${esc(n.body||'')}</p><small>${new Date(n.created_at).toLocaleString('es-ES')}</small></div>
   <div>${actionFor(n)}${!n.read_at?`<button class="btn" data-read="${n.id}">Leída</button>`:''}</div>
 </article>`).join(''):'<div class="empty">No tienes notificaciones.</div>';
 bindNotificationActions(container);
}

function bindNotificationActions(root){
 root.querySelectorAll('[data-read]').forEach(b=>b.onclick=()=>rpcReload('mark_notification_read',{p_notification_id:b.dataset.read},b));
 root.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>rpcReload('a2c_pay_group_split',{p_split_id:b.dataset.pay},b,'Pago registrado.'));
 root.querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>rpcReload('a2c_respond_group_invitation',{p_group_id:b.dataset.accept,p_accept:true},b,'Te has unido al grupo.'));
 root.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>rpcReload('a2c_respond_group_invitation',{p_group_id:b.dataset.reject,p_accept:false},b,'Invitación rechazada.'));
}

async function load(){
 me=(await sb.auth.getUser()).data.user;if(!me)return;
 const q=await Promise.all([
  sb.from('a2c_groups').select('*').order('created_at',{ascending:false}),
  sb.from('a2c_group_members').select('*'),
  sb.from('a2c_group_transactions').select('*').order('occurred_on',{ascending:false}),
  sb.from('a2c_group_splits').select('*').order('created_at',{ascending:false}),
  sb.from('resources').select('*').order('created_at',{ascending:false}),
  sb.from('profiles').select('id,display_name,username,avatar_path'),
  sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(100)
 ]);
 for(const r of q)if(r.error)throw r.error;
 [groups,members,txs,splits,resources,profiles,notifications]=q.map(r=>r.data||[]);
 integrateBell();startNotificationRealtime();addGroupsTab();enhancePiggies();
}
const profile=id=>profiles.find(p=>String(p.id)===String(id))||{};
const gMembers=id=>members.filter(m=>m.group_id===id&&m.status==='accepted');
const gBalance=id=>txs.filter(t=>t.group_id===id).reduce((s,t)=>s+(t.kind==='income'?Number(t.amount_cents):-Number(t.amount_cents)),0);

function integrateBell(){
 document.querySelector('#a2c-notification-button')?.remove();
 updateBellBadge();
}
function actionFor(n){
 if(n.type==='group_expense'||n.type==='group_expense_reminder')return `<button class="btn primary" data-pay="${n.related_id}">Pagar</button>`;
 if(n.type==='group_invitation')return `<button class="btn success" data-accept="${n.related_id}">Aceptar</button><button class="btn" data-reject="${n.related_id}">Rechazar</button>`;
 return '';
}
async function enhanceOriginalNotificationModal(){
 try{
   await refreshNotifications();
   const modal=document.querySelector('#modal');
   const card=modal?.querySelector('.modal-card');
   if(!modal||!card)return;

   card.innerHTML=`<div class="modal-head"><div><h2>Notificaciones</h2><p class="muted">${notifications.filter(n=>!n.read_at).length} sin leer</p></div><button class="close-btn" data-close>×</button></div><div class="v46-notifications"></div>`;
   const box=card.querySelector('.v46-notifications');
   renderNotificationRows(box);
 }catch(error){
   console.error('No se pudieron actualizar las notificaciones.',error);
 }
}
async function rpcReload(fn,args,b,msg){
 busy(b,true);
 const {error}=await sb.rpc(fn,args);
 busy(b,false);
 if(error)return toast(error.message,true);
 toast(msg||'Actualizado.');
 await refreshNotifications();
 const box=document.querySelector('#modal .v46-notifications');
 if(box)renderNotificationRows(box);
}

function addGroupsTab(){
 const tabs=document.querySelector('.section-tabs');if(!tabs||tabs.querySelector('[data-v46-groups]'))return;
 const b=document.createElement('button');b.type='button';b.dataset.v46Groups='1';b.textContent='Grupos';b.onclick=renderGroups;tabs.appendChild(b);
}
function renderGroups(){
 const page=document.querySelector('.hub-page');if(!page)return;
 page.querySelectorAll('.section-tabs button').forEach(x=>x.classList.remove('active'));
 page.querySelector('[data-v46-groups]')?.classList.add('active');
 [...page.children].filter(x=>!x.classList.contains('dashboard-head')&&!x.classList.contains('section-tabs')).forEach(x=>x.remove());
 const s=document.createElement('section');s.className='v46-groups-page';
 s.innerHTML=`<div class="section-head"><div><h2>Grupos</h2><p class="muted">Viajes, vacaciones y gastos compartidos.</p></div><button class="btn primary" data-new-group>Nuevo grupo</button></div><div class="grid two">${groups.map(g=>`<article class="card v46-group-card" data-group="${g.id}"><h3>${esc(g.name)}</h3><p class="muted">${gMembers(g.id).length} integrantes</p><strong>${money(gBalance(g.id))}</strong>${g.description?`<p>${esc(g.description)}</p>`:''}</article>`).join('')||'<div class="empty">Todavía no tienes grupos.</div>'}</div>`;
 page.appendChild(s);s.querySelector('[data-new-group]').onclick=createGroup;s.querySelectorAll('[data-group]').forEach(c=>c.onclick=()=>openGroup(c.dataset.group));
}
function pickerMarkup(){return `<div class="field v46-friend-search"><label>Añadir amigos</label><input id="v46-friend-query" placeholder="Empieza a escribir su @usuario" autocomplete="off"><div id="v46-friend-results"></div><div id="v46-friend-selected"></div></div>`}
function bindPicker(l){
 const input=l.querySelector('#v46-friend-query'),results=l.querySelector('#v46-friend-results'),selected=l.querySelector('#v46-friend-selected'),ids=new Set;let timer;
 input.oninput=()=>{clearTimeout(timer);const q=input.value.trim();if(!q){results.innerHTML='';return}timer=setTimeout(async()=>{const {data,error}=await sb.rpc('a2c_search_accepted_friends',{p_query:q});if(error)return;results.innerHTML=(data||[]).map(f=>`<button type="button" data-f="${f.friend_id}">@${esc(f.username||'usuario')} · ${esc(f.display_name||'')}</button>`).join('')||'<small>Sin coincidencias entre tus amigos.</small>';results.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{if(ids.has(b.dataset.f))return;ids.add(b.dataset.f);selected.insertAdjacentHTML('beforeend',`<span data-s="${b.dataset.f}">${esc(b.textContent)} <button type="button">×</button></span>`);const chip=selected.lastElementChild;chip.querySelector('button').onclick=()=>{ids.delete(b.dataset.f);chip.remove()};input.value='';results.innerHTML=''})},220)};
 return ()=>[...ids];
}
function createGroup(){
 const l=openLayer(`<form><div class="modal-head"><div><h2>Nuevo grupo</h2><p class="muted">Solo amigos aceptados.</p></div><button type="button" class="close-btn" data-v46-close>×</button></div><div class="field"><label>Nombre</label><input name="name" required maxlength="100"></div><div class="field"><label>Descripción</label><textarea name="description"></textarea></div>${pickerMarkup()}<div class="actions"><button type="button" class="btn" data-v46-close>Cancelar</button><button class="btn primary">Crear</button></div></form>`);
 const get=bindPicker(l);l.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);const {error}=await sb.rpc('a2c_create_group',{p_name:fd.get('name'),p_description:fd.get('description'),p_friend_ids:get()});busy(b,false);if(error)return toast(error.message,true);toast('Grupo creado.');l.remove();await load();renderGroups()};
}
function openGroup(id){
 const g=groups.find(x=>x.id===id),gm=gMembers(id),rows=txs.filter(t=>t.group_id===id);if(!g)return;
 const l=openLayer(`<div class="modal-head"><div><span class="eyebrow">Grupo</span><h2>${esc(g.name)}</h2><p class="muted">${gm.length} integrantes · ${money(gBalance(id))}</p></div><button class="close-btn" data-v46-close>×</button></div><div class="v46-member-chips">${gm.map(m=>`<span>@${esc(profile(m.user_id).username||'usuario')}</span>`).join('')}</div><div class="v46-group-actions"><button class="btn primary" data-income>Ingresar dinero</button><button class="btn" data-expense>Registrar gasto</button></div><div class="list">${rows.map(t=>`<article class="transaction-row"><div class="transaction-icon ${t.kind}">${t.kind==='income'?'↗':'↘'}</div><div class="transaction-copy"><strong>${esc(t.concept)}</strong><small>${esc(t.occurred_on)} · ${esc(profile(t.created_by).display_name||'Integrante')}</small></div><b class="${t.kind}">${t.kind==='income'?'+':'−'}${money(t.amount_cents)}</b></article>`).join('')||'<div class="empty compact">No hay movimientos.</div>'}</div>`);
 l.querySelector('[data-income]').onclick=()=>groupIncome(g);
 l.querySelector('[data-expense]').onclick=()=>groupExpense(g,gm);
}
function groupIncome(g){
 const opts=`<option value="main:">Cuenta principal</option>${resources.filter(r=>['piggy','goal'].includes(r.type)).map(r=>`<option value="${r.type}:${r.id}">${r.type==='piggy'?'Hucha':'Objetivo'} · ${esc(r.name)}</option>`).join('')}`;
 const l=openLayer(`<form><div class="modal-head"><h2>Ingreso del grupo</h2><button type="button" class="close-btn" data-v46-close>×</button></div><div class="field"><label>Origen</label><select name="source">${opts}</select></div><div class="field"><label>Importe</label><input name="amount" required inputmode="decimal"></div><div class="field"><label>Concepto</label><input name="concept" required></div><div class="actions"><button type="button" class="btn" data-v46-close>Cancelar</button><button class="btn primary">Añadir</button></div></form>`);
 l.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget),[type,id]=String(fd.get('source')).split(':');busy(b,true);const {error}=await sb.rpc('a2c_add_group_income',{p_group_id:g.id,p_amount_cents:cents(fd.get('amount')),p_concept:fd.get('concept'),p_source_type:type,p_source_resource_id:id||null,p_notes:''});busy(b,false);if(error)return toast(error.message,true);toast('Ingreso añadido.');l.remove();await load();openGroup(g.id)};
}
function groupExpense(g,gm){
 const l=openLayer(`<form><div class="modal-head"><div><h2>Gasto del grupo</h2><p class="muted">Elige participantes e importes.</p></div><button type="button" class="close-btn" data-v46-close>×</button></div><div class="field"><label>Concepto</label><input name="concept" required></div><div class="field"><label>Importe total</label><input name="amount" inputmode="decimal" required></div><div class="v46-split-toolbar"><button type="button" class="btn" data-equal>Partes iguales</button><button type="button" class="btn" data-external>Añadir persona externa</button></div><div id="split-rows">${gm.map(m=>`<label class="v46-split-row"><input type="checkbox" data-user="${m.user_id}"><span>${esc(profile(m.user_id).display_name||profile(m.user_id).username||'Usuario')}</span><input data-amount inputmode="decimal" disabled></label>`).join('')}</div><div id="external-rows"></div><div class="actions"><button type="button" class="btn" data-v46-close>Cancelar</button><button class="btn primary">Guardar gasto</button></div></form>`);
 l.querySelectorAll('[data-user]').forEach(c=>c.onchange=()=>c.closest('label').querySelector('[data-amount]').disabled=!c.checked);
 l.querySelector('[data-external]').onclick=()=>l.querySelector('#external-rows').insertAdjacentHTML('beforeend',`<div class="v46-external-row"><input data-name placeholder="Nombre externo"><input data-amount inputmode="decimal"><button type="button">×</button></div>`);
 l.querySelector('#external-rows').onclick=e=>{if(e.target.tagName==='BUTTON')e.target.parentElement.remove()};
 l.querySelector('[data-equal]').onclick=()=>{const selected=[...l.querySelectorAll('[data-user]:checked')].map(c=>c.closest('label')).concat([...l.querySelectorAll('.v46-external-row')]);if(!selected.length)return toast('Selecciona participantes.',true);let rest=cents(l.querySelector('[name=amount]').value),total=rest;selected.forEach((r,i)=>{const v=i===selected.length-1?rest:Math.floor(total/selected.length);rest-=v;r.querySelector('[data-amount]').value=(v/100).toFixed(2).replace('.',',')})};
 l.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget),users=[...l.querySelectorAll('[data-user]:checked')].map(c=>({id:c.dataset.user,amount:cents(c.closest('label').querySelector('[data-amount]').value)})),ext=[...l.querySelectorAll('.v46-external-row')].map(r=>({name:r.querySelector('[data-name]').value.trim(),amount:cents(r.querySelector('[data-amount]').value)})).filter(x=>x.name);busy(b,true);const {error}=await sb.rpc('a2c_add_group_expense',{p_group_id:g.id,p_amount_cents:cents(fd.get('amount')),p_concept:fd.get('concept'),p_participant_ids:users.map(x=>x.id),p_participant_amounts:users.map(x=>x.amount),p_external_names:ext.map(x=>x.name),p_external_amounts:ext.map(x=>x.amount),p_notes:''});busy(b,false);if(error)return toast(error.message,true);toast('Gasto guardado y notificado.');l.remove();await load();openGroup(g.id)};
}
function enhancePiggies(){
 document.querySelectorAll('[data-resource]').forEach(menu=>{const r=resources.find(x=>String(x.id)===String(menu.dataset.resource));if(r?.type!=='piggy')return;const card=menu.closest('.card');if(!card||card.querySelector('[data-bank]'))return;const b=document.createElement('button');b.type='button';b.className='btn primary v46-bank-button';b.dataset.bank=r.id;b.textContent='Abrir banco';b.onclick=e=>{e.stopPropagation();openBank(r,menu)};card.appendChild(b)});
}
function openBank(r,menu){
 const l=openLayer(`<div class="modal-head"><div><span class="eyebrow">Hucha bancaria</span><h2>${esc(r.name)}</h2><p class="muted">Añade dinero y registra gastos desde la hucha.</p></div><button class="close-btn" data-v46-close>×</button></div><div class="v46-bank-actions"><button class="btn primary" data-add>Añadir dinero</button><button class="btn" data-spend>Realizar gasto</button><button class="btn" data-shared>Gasto compartido</button><button class="btn" data-history>Movimientos</button></div>`);
 const original=t=>{l.remove();menu.click();setTimeout(()=>[...document.querySelectorAll('#modal button')].find(b=>b.textContent.toLowerCase().includes(t))?.click(),100)};
 l.querySelector('[data-add]').onclick=()=>original('añadir');
 const expense=shared=>{l.remove();document.querySelector('#finance-fab')?.click();setTimeout(()=>{const f=document.querySelector('#tx-form');if(!f)return;f.elements.kind.value='expense';f.elements.kind.dispatchEvent(new Event('change'));f.elements.resource_id.value=r.id;f.elements.resource_id.dispatchEvent(new Event('change'));if(shared){const s=document.querySelector('#split-enabled');if(s&&!s.checked)s.click()}},150)};
 l.querySelector('[data-spend]').onclick=()=>expense(false);l.querySelector('[data-shared]').onclick=()=>expense(true);l.querySelector('[data-history]').onclick=()=>original('ver');
}



/*
 * Evita registros duplicados de gastos en huchas.
 * app.js utiliza form.onsubmit; las extensiones anteriores también podían
 * escuchar el mismo submit. Para gastos con origen hucha detenemos la
 * propagación y ejecutamos exactamente una vez el manejador principal.
 */

document.addEventListener('click',event=>{
 const bell=event.target.closest('#notifications');
 if(!bell)return;
 setTimeout(()=>enhanceOriginalNotificationModal(),0);
},false);

const piggyExpenseLocks=new WeakSet();

document.addEventListener('submit',event=>{
 const form=event.target;
 if(!(form instanceof HTMLFormElement)||form.id!=='tx-form')return;

 const kind=String(form.elements.kind?.value||'');
 const resourceId=String(form.elements.resource_id?.value||'');
 const resource=resources.find(r=>String(r.id)===resourceId);
 if(kind!=='expense'||resource?.type!=='piggy')return;

 if(piggyExpenseLocks.has(form)){
   event.preventDefault();
   event.stopPropagation();
   event.stopImmediatePropagation();
   return;
 }

 piggyExpenseLocks.add(form);
 const submitter=event.submitter||form.querySelector('button[type="submit"],button:not([type])');
 if(submitter)submitter.disabled=true;

 setTimeout(()=>{
   piggyExpenseLocks.delete(form);
   if(document.body.contains(form)&&submitter)submitter.disabled=false;
 },5000);
},true);

const obs=new MutationObserver(()=>{integrateBell();addGroupsTab();enhancePiggies()});obs.observe(document.documentElement,{subtree:true,childList:true});
load().catch(e=>console.error('A2C v46',e));
}

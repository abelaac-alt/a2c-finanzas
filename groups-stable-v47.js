import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg=window.A2C_CONFIG||{};
if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY) throw new Error('Falta la configuración de Supabase.');

const sb=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format((Number(v)||0)/100);
const cents=v=>{let s=String(v||'').trim().replace(/\s|€/g,'');if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Math.round((Number(s)||0)*100)};
const toast=(m,b=false)=>{const e=document.querySelector('#toast');if(!e)return alert(m);e.textContent=m;e.classList.toggle('bad',b);e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),3500)};
const busy=(b,on)=>{if(!b)return;b.disabled=on;b.dataset.old??=b.textContent;b.textContent=on?'Procesando…':b.dataset.old};

let groups=[],members=[],txs=[],resources=[],profiles=[],me=null;

function removeExtraBell(){
  document.querySelectorAll('#a2c-notification-button').forEach(n=>n.remove());
  document.querySelectorAll('[aria-label="Notificaciones"]').forEach((n,i)=>{if(i>0&&!n.matches('#notifications'))n.remove()});
}
function profile(id){return profiles.find(p=>String(p.id)===String(id))||{}}
function groupMembers(id){return members.filter(m=>m.group_id===id&&m.status==='accepted')}
function balance(id){return txs.filter(t=>t.group_id===id).reduce((s,t)=>s+(t.kind==='income'?Number(t.amount_cents):-Number(t.amount_cents)),0)}

async function load(){
  me=(await sb.auth.getUser()).data.user;
  if(!me)return;
  const q=await Promise.all([
    sb.from('a2c_groups').select('*').order('created_at',{ascending:false}),
    sb.from('a2c_group_members').select('*'),
    sb.from('a2c_group_transactions').select('*').order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
    sb.from('resources').select('*').order('created_at',{ascending:false}),
    sb.from('profiles').select('id,display_name,username,avatar_path')
  ]);
  for(const r of q)if(r.error)throw r.error;
  [groups,members,txs,resources,profiles]=q.map(r=>r.data||[]);
  removeExtraBell();
  enhanceToolsMenu();
}

function enhanceToolsMenu(){
  const nav=document.querySelector('.section-tabs');
  if(!nav)return;
  nav.classList.add('v47-tools-tabs');

  const labels=['Huchas','Carpetas','Objetivos'];
  [...nav.querySelectorAll('button')].forEach((button,index)=>{
    button.classList.add('v47-tool-tab');
    button.dataset.v47Icon=['◉','▣','◎'][index]||'•';
    if(labels[index])button.dataset.v47Label=labels[index];
  });

  let groupButton=nav.querySelector('[data-v47-groups]');
  if(!groupButton){
    groupButton=document.createElement('button');
    groupButton.type='button';
    groupButton.dataset.v47Groups='1';
    groupButton.dataset.v47Icon='👥';
    groupButton.dataset.v47Label='Grupos';
    groupButton.className='v47-tool-tab';
    groupButton.textContent='Grupos';
    groupButton.onclick=renderGroups;
    nav.appendChild(groupButton);
  }
}

function renderGroups(){
  const page=document.querySelector('.hub-page');
  if(!page)return;

  page.querySelectorAll('.section-tabs button').forEach(b=>b.classList.remove('active'));
  page.querySelector('[data-v47-groups]')?.classList.add('active');

  [...page.children]
    .filter(x=>!x.classList.contains('dashboard-head')&&!x.classList.contains('section-tabs'))
    .forEach(x=>x.remove());

  const section=document.createElement('section');
  section.className='v47-groups-page';
  section.innerHTML=`<div class="section-head">
    <div><h2>Grupos</h2><p class="muted">Viajes, vacaciones y gastos compartidos con amigos.</p></div>
    <button class="btn primary" data-v47-new-group>Nuevo grupo</button>
  </div>
  <div class="grid two">${groups.length?groups.map(g=>`
    <article class="card v47-group-card" data-v47-group="${g.id}">
      <div class="v47-group-head"><div><h3>${esc(g.name)}</h3><p class="muted">${groupMembers(g.id).length} integrantes</p></div><span>👥</span></div>
      <strong class="v47-group-balance">${money(balance(g.id))}</strong>
      ${g.description?`<p class="muted">${esc(g.description)}</p>`:''}
    </article>`).join(''):'<div class="empty">Todavía no tienes grupos.</div>'}</div>`;

  page.appendChild(section);
  section.querySelector('[data-v47-new-group]').onclick=openCreateGroup;
  section.querySelectorAll('[data-v47-group]').forEach(c=>c.onclick=()=>openGroup(c.dataset.v47Group));
}

function modal(html){
  document.querySelector('#v47-modal')?.remove();
  document.body.insertAdjacentHTML('beforeend',`<div id="v47-modal" class="v47-modal"><section class="v47-modal-card">${html}</section></div>`);
  const m=document.querySelector('#v47-modal');
  m.onclick=e=>{if(e.target===m||e.target.closest('[data-v47-close]'))m.remove()};
  return m;
}

function pickerMarkup(){
  return `<div class="field v47-picker"><label>Añadir amigos</label><input id="v47-friend-query" placeholder="Escribe las primeras letras de su @usuario" autocomplete="off"><div id="v47-friend-results"></div><div id="v47-friend-selected"></div></div>`;
}
function bindPicker(m){
  const input=m.querySelector('#v47-friend-query'),results=m.querySelector('#v47-friend-results'),selected=m.querySelector('#v47-friend-selected'),ids=new Set;
  let timer;
  input.oninput=()=>{
    clearTimeout(timer);
    const q=input.value.trim();
    if(!q){results.innerHTML='';return}
    timer=setTimeout(async()=>{
      const {data,error}=await sb.rpc('a2c_search_accepted_friends',{p_query:q});
      if(error)return toast(error.message,true);
      results.innerHTML=(data||[]).map(f=>`<button type="button" data-friend="${f.friend_id}">@${esc(f.username||'usuario')} · ${esc(f.display_name||'')}</button>`).join('')||'<small>Sin coincidencias entre tus amigos.</small>';
      results.querySelectorAll('[data-friend]').forEach(b=>b.onclick=()=>{
        if(ids.has(b.dataset.friend))return;
        ids.add(b.dataset.friend);
        selected.insertAdjacentHTML('beforeend',`<span data-id="${b.dataset.friend}">${esc(b.textContent)} <button type="button">×</button></span>`);
        const chip=selected.lastElementChild;
        chip.querySelector('button').onclick=()=>{ids.delete(b.dataset.friend);chip.remove()};
        input.value='';results.innerHTML='';
      });
    },220);
  };
  return ()=>[...ids];
}

function openCreateGroup(){
  const m=modal(`<form><div class="modal-head"><div><h2>Nuevo grupo</h2><p class="muted">Solo se pueden añadir amigos aceptados.</p></div><button type="button" class="close-btn" data-v47-close>×</button></div>
  <div class="field"><label>Nombre</label><input name="name" required maxlength="100" placeholder="Vacaciones"></div>
  <div class="field"><label>Descripción</label><textarea name="description" maxlength="500"></textarea></div>
  ${pickerMarkup()}
  <div class="actions"><button type="button" class="btn" data-v47-close>Cancelar</button><button class="btn primary">Crear grupo</button></div></form>`);
  const ids=bindPicker(m);
  m.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);
    const {error}=await sb.rpc('a2c_create_group',{p_name:fd.get('name'),p_description:fd.get('description'),p_friend_ids:ids()});
    busy(b,false);if(error)return toast(error.message,true);
    toast('Grupo creado.');m.remove();await load();renderGroups();
  };
}

function openGroup(id){
  const g=groups.find(x=>x.id===id);if(!g)return;
  const gm=groupMembers(id),rows=txs.filter(t=>t.group_id===id);
  const m=modal(`<div class="modal-head"><div><span class="eyebrow">Grupo</span><h2>${esc(g.name)}</h2><p class="muted">${gm.length} integrantes · ${money(balance(id))}</p></div><button class="close-btn" data-v47-close>×</button></div>
  <div class="v47-members">${gm.map(x=>`<span>@${esc(profile(x.user_id).username||'usuario')}</span>`).join('')}</div>
  <div class="v47-group-actions"><button class="btn primary" data-income>Ingresar dinero</button><button class="btn" data-expense>Registrar gasto</button></div>
  <div class="list">${rows.length?rows.map(t=>`<article class="transaction-row"><div class="transaction-icon ${t.kind}">${t.kind==='income'?'↗':'↘'}</div><div class="transaction-copy"><strong>${esc(t.concept)}</strong><small>${esc(t.occurred_on)} · ${esc(profile(t.created_by).display_name||'Integrante')}</small></div><b class="${t.kind}">${t.kind==='income'?'+':'−'}${money(t.amount_cents)}</b></article>`).join(''):'<div class="empty compact">No hay movimientos.</div>'}</div>`);
  m.querySelector('[data-income]').onclick=()=>openIncome(g);
  m.querySelector('[data-expense]').onclick=()=>openExpense(g,gm);
}

function openIncome(g){
  const options=`<option value="main:">Cuenta principal</option>${resources.filter(r=>['piggy','goal'].includes(r.type)).map(r=>`<option value="${r.type}:${r.id}">${r.type==='piggy'?'Hucha':'Objetivo'} · ${esc(r.name)}</option>`).join('')}`;
  const m=modal(`<form><div class="modal-head"><h2>Ingreso del grupo</h2><button type="button" class="close-btn" data-v47-close>×</button></div>
  <div class="field"><label>Origen</label><select name="source">${options}</select></div>
  <div class="field"><label>Importe</label><input name="amount" inputmode="decimal" required></div>
  <div class="field"><label>Concepto</label><input name="concept" required></div>
  <div class="actions"><button type="button" class="btn" data-v47-close>Cancelar</button><button class="btn primary">Añadir</button></div></form>`);
  m.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget),[type,id]=String(fd.get('source')).split(':');busy(b,true);
    const {error}=await sb.rpc('a2c_add_group_income',{p_group_id:g.id,p_amount_cents:cents(fd.get('amount')),p_concept:fd.get('concept'),p_source_type:type,p_source_resource_id:id||null,p_notes:''});
    busy(b,false);if(error)return toast(error.message,true);
    toast('Ingreso añadido.');m.remove();await load();openGroup(g.id);
  };
}

function openExpense(g,gm){
  const m=modal(`<form><div class="modal-head"><div><h2>Gasto del grupo</h2><p class="muted">Selecciona integrantes y reparte el importe.</p></div><button type="button" class="close-btn" data-v47-close>×</button></div>
  <div class="field"><label>Concepto</label><input name="concept" required></div>
  <div class="field"><label>Importe total</label><input name="amount" inputmode="decimal" required></div>
  <div class="v47-split-tools"><button type="button" class="btn" data-equal>Partes iguales</button><button type="button" class="btn" data-external>Añadir externo</button></div>
  <div id="v47-splits">${gm.map(x=>`<label class="v47-split-row"><input type="checkbox" data-user="${x.user_id}"><span>${esc(profile(x.user_id).display_name||profile(x.user_id).username||'Usuario')}</span><input data-amount inputmode="decimal" disabled placeholder="0,00"></label>`).join('')}</div>
  <div id="v47-externals"></div>
  <div class="actions"><button type="button" class="btn" data-v47-close>Cancelar</button><button class="btn primary">Guardar gasto</button></div></form>`);

  m.querySelectorAll('[data-user]').forEach(c=>c.onchange=()=>c.closest('label').querySelector('[data-amount]').disabled=!c.checked);
  m.querySelector('[data-external]').onclick=()=>m.querySelector('#v47-externals').insertAdjacentHTML('beforeend',`<div class="v47-external-row"><input data-name placeholder="Nombre externo"><input data-amount inputmode="decimal" placeholder="0,00"><button type="button">×</button></div>`);
  m.querySelector('#v47-externals').onclick=e=>{if(e.target.tagName==='BUTTON')e.target.parentElement.remove()};
  m.querySelector('[data-equal]').onclick=()=>{
    const rows=[...m.querySelectorAll('[data-user]:checked')].map(c=>c.closest('label')).concat([...m.querySelectorAll('.v47-external-row')]);
    if(!rows.length)return toast('Selecciona participantes.',true);
    const total=cents(m.querySelector('[name=amount]').value);let rest=total;
    rows.forEach((r,i)=>{const value=i===rows.length-1?rest:Math.floor(total/rows.length);rest-=value;r.querySelector('[data-amount]').value=(value/100).toFixed(2).replace('.',',')});
  };

  m.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);
    const users=[...m.querySelectorAll('[data-user]:checked')].map(c=>({id:c.dataset.user,amount:cents(c.closest('label').querySelector('[data-amount]').value)}));
    const externals=[...m.querySelectorAll('.v47-external-row')].map(r=>({name:r.querySelector('[data-name]').value.trim(),amount:cents(r.querySelector('[data-amount]').value)})).filter(x=>x.name);
    busy(b,true);
    const {error}=await sb.rpc('a2c_add_group_expense',{p_group_id:g.id,p_amount_cents:cents(fd.get('amount')),p_concept:fd.get('concept'),p_participant_ids:users.map(x=>x.id),p_participant_amounts:users.map(x=>x.amount),p_external_names:externals.map(x=>x.name),p_external_amounts:externals.map(x=>x.amount),p_notes:''});
    busy(b,false);if(error)return toast(error.message,true);
    toast('Gasto guardado y notificado.');m.remove();await load();openGroup(g.id);
  };
}

const observer=new MutationObserver(()=>{removeExtraBell();enhanceToolsMenu()});
observer.observe(document.documentElement,{subtree:true,childList:true});

load().catch(error=>console.error('A2C v47:',error));

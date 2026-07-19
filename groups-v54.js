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

let groups=[],members=[],txs=[],resources=[],profiles=[],me=null,groupBalances=new Map();

function removeExtraBell(){
  document.querySelectorAll('#a2c-notification-button').forEach(n=>n.remove());
  document.querySelectorAll('[aria-label="Notificaciones"]').forEach((n,i)=>{if(i>0&&!n.matches('#notifications'))n.remove()});
}
function profile(id){
  return profiles.find(p=>String(p.id)===String(id))
    ||members.find(m=>String(m.user_id)===String(id))
    ||{};
}
function sameId(a,b){return String(a??'')===String(b??'')}
function groupMembers(id){return members.filter(m=>sameId(m.group_id,id)&&m.status==='accepted')}
function localBalance(id){
  return txs.filter(t=>sameId(t.group_id,id))
    .reduce((sum,t)=>sum+(t.kind==='income'?Number(t.amount_cents||0):-Number(t.amount_cents||0)),0);
}
function balance(id){
  const key=String(id);
  return groupBalances.has(key)?Number(groupBalances.get(key)||0):localBalance(id);
}

async function load(){
  me=(await sb.auth.getUser()).data.user;
  if(!me)return;

  const [snapshotResult,balancesResult,resourcesResult,profilesResult]=await Promise.all([
    sb.rpc('a2c_group_snapshot_v51'),
    sb.rpc('a2c_group_balances_v59'),
    sb.from('resources').select('*').order('created_at',{ascending:false}),
    sb.from('profiles').select('id,display_name,username,avatar_path')
  ]);

  if(snapshotResult.error)throw snapshotResult.error;

  const snapshot=snapshotResult.data||{};
  groups=Array.isArray(snapshot.groups)?snapshot.groups:[];
  members=Array.isArray(snapshot.members)?snapshot.members:[];
  txs=Array.isArray(snapshot.transactions)?snapshot.transactions:[];
  groupBalances=new Map(
    (!balancesResult.error&&Array.isArray(balancesResult.data)?balancesResult.data:[])
      .map(row=>[String(row.group_id),Number(row.balance_cents||0)])
  );
  resources=resourcesResult.error?[]:(resourcesResult.data||[]);
  profiles=profilesResult.error?[]:(profilesResult.data||[]);

  removeExtraBell();
  enhanceToolsMenu();
}

function enhanceToolsMenu(){
  const nav=document.querySelector('.section-tabs[aria-label="Herramientas"]');
  if(!nav)return;

  nav.classList.add('v47-tools-tabs');

  const labels=['Huchas','Carpetas','Objetivos'];
  [...nav.querySelectorAll('button')].forEach((button,index)=>{
    if(button.matches('[data-v47-groups],[data-v49-groups],[data-v49-groups-visible]'))return;
    button.classList.add('v47-tool-tab');
    button.dataset.v47Icon=['piggy','folder','goal'][index]||'tool';
    if(labels[index])button.dataset.v47Label=labels[index];
  });

  const groupButtons=[...nav.querySelectorAll('[data-v47-groups],[data-v49-groups],[data-v49-groups-visible]')];
  let groupButton=groupButtons[0];

  groupButtons.slice(1).forEach(button=>button.remove());

  if(!groupButton){
    groupButton=document.createElement('button');
    groupButton.type='button';
    groupButton.dataset.v47Groups='1';
    groupButton.textContent='Grupos';
    nav.appendChild(groupButton);
  }

  groupButton.classList.add('v47-tool-tab');
  groupButton.classList.toggle('active',document.body.dataset.a2cToolsSection==='groups');
  groupButton.dataset.v47Icon='groups';
  groupButton.dataset.v47Label='Grupos';
  groupButton.setAttribute('aria-label','Grupos');
  groupButton.title='Grupos';
  groupButton.onclick=renderGroups;

  [...nav.querySelectorAll('button:not([data-v47-groups]):not([data-v49-groups]):not([data-v49-groups-visible])')].forEach(button=>{
    if(button.dataset.v54NativeBound)return;
    button.dataset.v54NativeBound='1';
    button.addEventListener('click',()=>{
      document.body.dataset.a2cToolsSection='native';
      groupButton.classList.remove('active');
    },true);
  });
}

function renderGroups(){
  document.body.dataset.a2cToolsSection='groups';
  const page=document.querySelector('.section-tabs[aria-label="Herramientas"]')?.closest('.hub-page');
  if(!page)return;

  page.querySelectorAll('.section-tabs button').forEach(b=>b.classList.remove('active'));
  const activeGroupTab=page.querySelector('[data-v47-groups],[data-v49-groups],[data-v49-groups-visible]');
  activeGroupTab?.classList.add('active');

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
      <div class="v47-group-head">
        <div><h3>${esc(g.name)}</h3><p class="muted">${groupMembers(g.id).length} integrantes</p></div>
        <button type="button" class="v49-group-menu-button" data-v49-group-menu="${g.id}" aria-label="Abrir menú del grupo">⋮</button>
      </div>
      <strong class="v47-group-balance">${money(balance(g.id))}</strong>
      ${g.description?`<p class="muted">${esc(g.description)}</p>`:''}
    </article>`).join(''):'<div class="empty">Todavía no tienes grupos.</div>'}</div>`;

  page.appendChild(section);
  section.querySelector('[data-v47-new-group]').onclick=openCreateGroup;
  section.querySelectorAll('[data-v47-group]').forEach(c=>c.onclick=event=>{
    if(event.target.closest('[data-v49-group-menu]'))return;
    openGroup(c.dataset.v47Group);
  });
  section.querySelectorAll('[data-v49-group-menu]').forEach(button=>{
    button.onclick=event=>{
      event.preventDefault();
      event.stopPropagation();
      openGroupMenu(button.dataset.v49GroupMenu);
    };
  });
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
  <label class="v59-switch-row">
    <span><strong>Permitir retirar dinero</strong><small>Los integrantes podrán transferir saldo del grupo a una cuenta autorizada.</small></span>
    <input type="checkbox" name="allow_withdrawals">
    <i></i>
  </label>
  ${pickerMarkup()}
  <div class="actions"><button type="button" class="btn" data-v47-close>Cancelar</button><button class="btn primary">Crear grupo</button></div></form>`);
  const ids=bindPicker(m);
  m.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);
    const {data:groupId,error}=await sb.rpc('a2c_create_group_v51',{
      p_name:fd.get('name'),
      p_description:fd.get('description'),
      p_friend_ids:ids()
    });
    busy(b,false);
    if(error)return toast(error.message,true);
    if(!groupId)return toast('Supabase no confirmó la creación del grupo.',true);

    const {error:settingsError}=await sb.rpc('a2c_set_group_withdrawals_v59',{
      p_group_id:groupId,
      p_allow_withdrawals:fd.get('allow_withdrawals')==='on'
    });
    if(settingsError)return toast(settingsError.message,true);

    m.remove();
    await load();

    const created=groups.some(group=>String(group.id)===String(groupId));
    if(!created)return toast('El grupo se creó, pero no pudo cargarse. Recarga la aplicación.',true);

    renderGroups();
    toast('Grupo creado correctamente.');
  };
}


function openGroupMenu(groupId){
  document.querySelector('#v49-group-menu')?.remove();
  const group=groups.find(g=>String(g.id)===String(groupId));
  if(!group)return;

  const owner=String(group.owner_id)===String(me.id);
  const m=modal(`
    <div class="modal-head">
      <div>
        <h2>${esc(group.name)}</h2>
        <p class="muted">Grupo compartido · ${groupMembers(group.id).length} integrantes</p>
      </div>
      <button type="button" class="close-btn" data-v47-close>×</button>
    </div>
    <div class="menu-stack v54-group-menu-stack">
      <button type="button" class="btn" data-v54-group-action="edit">Editar</button>
      <button type="button" class="btn" data-v54-group-action="view">Ver movimientos</button>
      <button type="button" class="btn" data-v54-group-action="income">Añadir fondos</button>
      <button type="button" class="btn" data-v54-group-action="expense">Realizar gasto</button>
      <button type="button" class="btn" data-v54-group-action="members">Integrantes</button>
      ${owner?'<button type="button" class="btn danger" data-v54-group-action="delete">Eliminar grupo</button>':''}
    </div>`);

  m.querySelectorAll('[data-v54-group-action]').forEach(button=>{
    button.onclick=()=>{
      const action=button.dataset.v54GroupAction;
      m.remove();
      if(action==='edit')return openEditGroup(group);
      if(action==='view')return openGroup(group.id);
      if(action==='income')return openIncome(group);
      if(action==='expense')return openExpense(group,groupMembers(group.id));
      if(action==='members')return openGroupMembers(group);
      if(action==='delete')return deleteGroup(group);
    };
  });
}

function openEditGroup(group){
  const m=modal(`<form>
    <div class="modal-head">
      <div><h2>Editar grupo</h2><p class="muted">Actualiza el nombre y la descripción.</p></div>
      <button type="button" class="close-btn" data-v47-close>×</button>
    </div>
    <div class="field"><label>Nombre</label><input name="name" required maxlength="100" value="${esc(group.name)}"></div>
    <div class="field"><label>Descripción</label><textarea name="description" maxlength="500">${esc(group.description||'')}</textarea></div>
    <label class="v59-switch-row">
      <span><strong>Permitir retirar dinero</strong><small>Activa o desactiva las retiradas desde este grupo.</small></span>
      <input type="checkbox" name="allow_withdrawals" ${group.allow_withdrawals?'checked':''}>
      <i></i>
    </label>
    <div class="actions">
      <button type="button" class="btn" data-v47-close>Cancelar</button>
      <button class="btn primary">Guardar cambios</button>
    </div>
  </form>`);

  m.querySelector('form').onsubmit=async event=>{
    event.preventDefault();
    const button=event.submitter;
    const fd=new FormData(event.currentTarget);
    busy(button,true);
    const {error}=await sb.rpc('a2c_update_group',{
      p_group_id:group.id,
      p_name:String(fd.get('name')||'').trim(),
      p_description:String(fd.get('description')||'')
    });
    if(error){busy(button,false);return toast(error.message,true);}
    const {error:settingsError}=await sb.rpc('a2c_set_group_withdrawals_v59',{
      p_group_id:group.id,
      p_allow_withdrawals:fd.get('allow_withdrawals')==='on'
    });
    busy(button,false);
    if(settingsError)return toast(settingsError.message,true);
    toast('Grupo actualizado.');
    m.remove();
    await load();
    renderGroups();
  };
}

async function deleteGroup(group){
  if(!confirm(`¿Eliminar el grupo "${group.name}"? Esta acción también eliminará sus movimientos y repartos.`))return;
  const {error}=await sb.rpc('a2c_delete_group_v52',{p_group_id:group.id});
  if(error)return toast(error.message,true);
  toast('Grupo eliminado.');
  await load();
  renderGroups();
}

function openGroupMembers(group){
  const current=groupMembers(group.id);
  const m=modal(`
    <div class="modal-head">
      <div><h2>Integrantes</h2><p class="muted">${esc(group.name)}</p></div>
      <button class="close-btn" data-v47-close>×</button>
    </div>
    <div class="v49-members-list">
      ${current.map(member=>{
        const p=profile(member.user_id);
        const owner=member.role==='owner'||String(member.user_id)===String(group.owner_id);
        return `<article class="v49-member-row">
          <div>
            <strong>${esc(p.display_name||'Usuario')}</strong>
            <small>@${esc(p.username||'usuario')} · ${owner?'Propietario':'Integrante'}</small>
          </div>
          ${String(group.owner_id)===String(me.id)&&!owner?`<button type="button" class="btn danger" data-v49-remove-member="${member.user_id}">Quitar</button>`:''}
        </article>`;
      }).join('')||'<div class="empty compact">No hay integrantes.</div>'}
    </div>
    ${String(group.owner_id)===String(me.id)?`
      <div class="v49-add-member">
        <h3>Añadir integrante</h3>
        ${pickerMarkup()}
        <button type="button" class="btn primary full" data-v49-add-members>Enviar invitación</button>
      </div>`:''}
  `);

  m.querySelectorAll('[data-v49-remove-member]').forEach(button=>{
    button.onclick=async()=>{
      if(!confirm('¿Quitar a este integrante del grupo?'))return;
      busy(button,true);
      const {error}=await sb.rpc('a2c_remove_group_member',{
        p_group_id:group.id,
        p_member_id:button.dataset.v49RemoveMember
      });
      busy(button,false);
      if(error)return toast(error.message,true);
      toast('Integrante eliminado.');
      m.remove();
      await load();
      openGroupMembers(groups.find(g=>g.id===group.id)||group);
    };
  });

  if(String(group.owner_id)===String(me.id)){
    const selected=bindPicker(m);
    const addButton=m.querySelector('[data-v49-add-members]');
    addButton.onclick=async()=>{
      const ids=selected();
      if(!ids.length)return toast('Selecciona al menos un amigo.',true);
      busy(addButton,true);
      for(const friendId of ids){
        const {error}=await sb.rpc('a2c_add_group_member',{
          p_group_id:group.id,
          p_friend_id:friendId
        });
        if(error){
          busy(addButton,false);
          return toast(error.message,true);
        }
      }
      busy(addButton,false);
      toast('Invitaciones enviadas.');
      m.remove();
      await load();
      openGroupMembers(groups.find(g=>g.id===group.id)||group);
    };
  }
}

function transactionOwnerId(t){return t.created_by||t.creator_id||t.user_id||null}
function canManageTransaction(t){return sameId(transactionOwnerId(t),me?.id)}

function transactionMarkup(t){
  const owner=canManageTransaction(t);
  const creator=profile(transactionOwnerId(t));
  return `<article class="transaction-row v58-group-transaction" data-group-transaction="${t.id}">
    <div class="transaction-icon ${t.kind}">${t.kind==='income'?'↗':'↘'}</div>
    <div class="transaction-copy">
      <strong>${esc(t.concept)}</strong>
      <small>${esc(t.occurred_on)} · ${esc(creator.display_name||creator.username||'Integrante')}</small>
    </div>
    <b class="${t.kind}">${t.kind==='income'?'+':'−'}${money(t.amount_cents)}</b>
    ${owner?`<button type="button" class="v58-tx-menu" data-edit-group-tx="${t.id}" aria-label="Editar movimiento">⋮</button>`:''}
  </article>`;
}

function openGroup(id){
  const g=groups.find(x=>sameId(x.id,id));if(!g)return;
  const gm=groupMembers(id),rows=txs.filter(t=>sameId(t.group_id,id));
  const total=balance(id);
  const m=modal(`<div class="modal-head"><div><span class="eyebrow">Grupo</span><h2>${esc(g.name)}</h2><p class="muted">${gm.length} integrantes</p></div><div class="v49-modal-head-actions"><button type="button" class="v49-group-menu-button" data-v49-group-menu="${g.id}" aria-label="Abrir menú del grupo">⋮</button><button class="close-btn" data-v47-close>×</button></div></div>
  <section class="v58-group-balance-card">
    <span>Saldo disponible</span>
    <strong>${money(total)}</strong>
    <small>${rows.length} ${rows.length===1?'movimiento':'movimientos'} registrados</small>
  </section>
  <div class="v47-members">${gm.map(x=>`<span>@${esc(profile(x.user_id).username||'usuario')}</span>`).join('')}</div>
  <div class="v58-group-actions"><button class="btn primary" data-income>Ingresar dinero</button><button class="btn" data-expense>Registrar gasto</button>${g.allow_withdrawals?'<button class="btn v58-transfer" data-transfer>Retirar / transferir</button>':'<button class="btn v58-transfer" disabled title="Las retiradas están desactivadas">Retiradas desactivadas</button>'}</div>
  <div class="v58-group-list-head"><h3>Movimientos</h3><span>${money(total)}</span></div>
  <div class="list">${rows.length?rows.map(transactionMarkup).join(''):'<div class="empty compact">No hay movimientos.</div>'}</div>`);
  m.querySelector('[data-income]').onclick=()=>openIncome(g);
  m.querySelector('[data-expense]').onclick=()=>openExpense(g,gm);
  m.querySelector('[data-transfer]')?.addEventListener('click',()=>openGroupTransfer(g));
  m.querySelectorAll('[data-edit-group-tx]').forEach(button=>button.onclick=event=>{event.stopPropagation();openGroupTransactionEditor(g,button.dataset.editGroupTx)});
  m.querySelector('[data-v49-group-menu]')?.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();openGroupMenu(g.id);
  });
}

function openGroupTransactionEditor(g,transactionId){
  const t=txs.find(row=>sameId(row.id,transactionId));
  if(!t||!canManageTransaction(t))return toast('Solo el creador puede editar este movimiento.',true);
  const m=modal(`<form><div class="modal-head"><div><h2>Editar movimiento</h2><p class="muted">Solo tú puedes modificarlo o eliminarlo.</p></div><button type="button" class="close-btn" data-v47-close>×</button></div>
    <div class="field"><label>Concepto</label><input name="concept" required maxlength="160" value="${esc(t.concept||'')}"></div>
    <div class="field"><label>Importe</label><input name="amount" inputmode="decimal" required ${t.kind==='expense'?'readonly':''} value="${(Number(t.amount_cents||0)/100).toFixed(2).replace('.',',')}">${t.kind==='expense'?'<small class="v58-field-help">Para mantener el reparto, el importe de un gasto no se modifica; puedes borrarlo y crearlo de nuevo.</small>':''}</div>
    <div class="v58-editor-actions"><button type="button" class="btn danger" data-delete>Eliminar</button><button type="button" class="btn" data-v47-close>Cancelar</button><button class="btn primary">Guardar</button></div>
  </form>`);
  m.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const button=event.submitter,fd=new FormData(event.currentTarget);busy(button,true);
    const {error}=await sb.rpc('a2c_update_group_transaction_v58',{p_transaction_id:t.id,p_concept:String(fd.get('concept')||'').trim(),p_amount_cents:cents(fd.get('amount'))});
    busy(button,false);if(error)return toast(error.message,true);
    m.remove();await load();openGroup(g.id);toast('Movimiento actualizado.');
  };
  m.querySelector('[data-delete]').onclick=async()=>{
    if(!confirm('¿Eliminar este movimiento?'))return;
    const button=m.querySelector('[data-delete]');busy(button,true);
    const {error}=await sb.rpc('a2c_delete_group_transaction_v58',{p_transaction_id:t.id});
    busy(button,false);if(error)return toast(error.message,true);
    m.remove();await load();openGroup(g.id);toast('Movimiento eliminado.');
  };
}

function openGroupTransfer(g){
  if(!g.allow_withdrawals)return toast('Las retiradas están desactivadas para este grupo.',true);
  const available=Math.max(0,balance(g.id));
  const destinations=`<option value="main:">Cuenta principal</option>${resources.map(r=>`<option value="${r.type}:${r.id}">${r.type==='piggy'?'Hucha':r.type==='folder'?'Carpeta':'Objetivo'} · ${esc(r.name)}</option>`).join('')}`;
  const m=modal(`<form><div class="modal-head"><div><h2>Retirar dinero</h2><p class="muted">Disponible en el grupo: ${money(available)}</p></div><button type="button" class="close-btn" data-v47-close>×</button></div>
    <div class="field"><label>Cuenta de destino</label><select name="destination">${destinations}</select></div>
    <div class="field"><label>Importe</label><input name="amount" inputmode="decimal" required placeholder="0,00"></div>
    <div class="field"><label>Concepto</label><input name="concept" required value="Retirada de ${esc(g.name)}"></div>
    <div class="v58-transfer-preview">Saldo restante: <strong data-after>${money(available)}</strong></div>
    <div class="actions"><button type="button" class="btn" data-v47-close>Cancelar</button><button class="btn primary">Transferir</button></div>
  </form>`);
  const amount=m.querySelector('[name=amount]'),after=m.querySelector('[data-after]');
  const updatePreview=()=>after.textContent=money(Math.max(0,available-cents(amount.value)));
  amount.addEventListener('input',updatePreview);
  m.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const button=event.submitter,fd=new FormData(event.currentTarget),value=cents(fd.get('amount'));
    if(value<=0)return toast('Introduce un importe válido.',true);
    if(value>available)return toast('El importe supera el saldo disponible.',true);
    const [destinationType,destinationId]=String(fd.get('destination')).split(':');busy(button,true);
    const {error}=await sb.rpc('a2c_transfer_group_money_v58',{p_group_id:g.id,p_amount_cents:value,p_concept:String(fd.get('concept')||'').trim(),p_destination_type:destinationType,p_destination_resource_id:destinationId||null});
    busy(button,false);if(error)return toast(error.message,true);
    m.remove();await load();openGroup(g.id);toast('Dinero transferido.');
  };
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
  const m=modal(`<form><div class="modal-head"><div><h2>Gasto del grupo</h2><p class="muted">Reparte el gasto en partes iguales o con importes personalizados.</p></div><button type="button" class="close-btn" data-v47-close>×</button></div>
  <div class="field"><label>Concepto</label><input name="concept" required></div>
  <div class="field"><label>Importe total</label><input name="amount" inputmode="decimal" required></div>
  <div class="v58-split-mode" role="group" aria-label="Modo de reparto"><button type="button" class="btn primary" data-mode="equal">Partes iguales</button><button type="button" class="btn" data-mode="custom">Importes diferentes</button></div>
  <div class="v47-split-tools"><button type="button" class="btn" data-external>Añadir externo</button></div>
  <div class="v58-split-summary"><div><span>Total</span><strong data-split-total>0,00 €</strong></div><div><span>Repartido</span><strong data-split-assigned>0,00 €</strong></div><div class="remaining"><span>Restante por repartir</span><strong data-split-remaining>0,00 €</strong></div></div>
  <div id="v47-splits">${gm.map(x=>`<label class="v47-split-row"><input type="checkbox" data-user="${x.user_id}"><span>${esc(profile(x.user_id).display_name||profile(x.user_id).username||'Usuario')}</span><input data-amount inputmode="decimal" disabled placeholder="0,00"></label>`).join('')}</div>
  <div id="v47-externals"></div>
  <div class="actions"><button type="button" class="btn" data-v47-close>Cancelar</button><button class="btn primary">Guardar gasto</button></div></form>`);

  let mode='equal';
  const totalInput=m.querySelector('[name=amount]');
  const rows=()=>[...m.querySelectorAll('[data-user]:checked')].map(c=>c.closest('label')).concat([...m.querySelectorAll('.v47-external-row')]);
  const distributeEqual=()=>{
    if(mode!=='equal')return;
    const active=rows(),total=cents(totalInput.value);let rest=total;
    active.forEach((r,i)=>{const value=i===active.length-1?rest:Math.floor(total/Math.max(1,active.length));rest-=value;r.querySelector('[data-amount]').value=(value/100).toFixed(2).replace('.',',')});
    updateSummary();
  };
  const updateSummary=()=>{
    const total=cents(totalInput.value);const assigned=rows().reduce((sum,row)=>sum+cents(row.querySelector('[data-amount]').value),0);const remaining=total-assigned;
    m.querySelector('[data-split-total]').textContent=money(total);
    m.querySelector('[data-split-assigned]').textContent=money(assigned);
    const remainingEl=m.querySelector('[data-split-remaining]');remainingEl.textContent=money(remaining);remainingEl.classList.toggle('bad',remaining<0);remainingEl.classList.toggle('ok',remaining===0&&total>0);
  };
  const bindAmount=input=>input.addEventListener('input',updateSummary);
  m.querySelectorAll('[data-user]').forEach(c=>c.onchange=()=>{const input=c.closest('label').querySelector('[data-amount]');input.disabled=!c.checked;if(!c.checked)input.value='';mode==='equal'?distributeEqual():updateSummary()});
  m.querySelectorAll('[data-amount]').forEach(bindAmount);
  totalInput.addEventListener('input',()=>mode==='equal'?distributeEqual():updateSummary());
  m.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.mode;m.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('primary',x===button));rows().forEach(r=>r.querySelector('[data-amount]').readOnly=mode==='equal');mode==='equal'?distributeEqual():updateSummary()});
  m.querySelector('[data-external]').onclick=()=>{m.querySelector('#v47-externals').insertAdjacentHTML('beforeend',`<div class="v47-external-row"><input data-name placeholder="Nombre externo"><input data-amount inputmode="decimal" placeholder="0,00"><button type="button">×</button></div>`);const row=m.querySelector('#v47-externals').lastElementChild;bindAmount(row.querySelector('[data-amount]'));row.querySelector('button').onclick=()=>{row.remove();mode==='equal'?distributeEqual():updateSummary()};mode==='equal'?distributeEqual():updateSummary()};

  m.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget),total=cents(fd.get('amount'));
    const users=[...m.querySelectorAll('[data-user]:checked')].map(c=>({id:c.dataset.user,amount:cents(c.closest('label').querySelector('[data-amount]').value)}));
    const externals=[...m.querySelectorAll('.v47-external-row')].map(r=>({name:r.querySelector('[data-name]').value.trim(),amount:cents(r.querySelector('[data-amount]').value)})).filter(x=>x.name);
    const assigned=[...users,...externals].reduce((sum,x)=>sum+x.amount,0);
    if(!users.length&&!externals.length)return toast('Selecciona al menos un participante.',true);
    if(assigned!==total)return toast(`El reparto debe coincidir con el total. Restante: ${money(total-assigned)}.`,true);
    busy(b,true);
    const {error}=await sb.rpc('a2c_add_group_expense',{p_group_id:g.id,p_amount_cents:total,p_concept:fd.get('concept'),p_participant_ids:users.map(x=>x.id),p_participant_amounts:users.map(x=>x.amount),p_external_names:externals.map(x=>x.name),p_external_amounts:externals.map(x=>x.amount),p_notes:''});
    busy(b,false);if(error)return toast(error.message,true);
    toast('Gasto guardado y notificado.');m.remove();await load();openGroup(g.id);
  };
  updateSummary();
}


let v51RefreshTimer=null;

function scheduleV51Refresh(){
  clearTimeout(v51RefreshTimer);
  v51RefreshTimer=setTimeout(async()=>{
    try{
      await load();
      if(document.querySelector('[data-v47-groups].active'))renderGroups();
    }catch(error){
      console.error('Actualización v51:',error);
    }
  },180);
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible')scheduleV51Refresh();
});

window.addEventListener('focus',scheduleV51Refresh);


const observer=new MutationObserver(()=>{
  removeExtraBell();
  enhanceToolsMenu();

});
observer.observe(document.documentElement,{subtree:true,childList:true});

load().catch(error=>console.error('A2C grupos:',error));

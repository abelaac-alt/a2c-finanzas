import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg=window.A2C_CONFIG||{};
if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY){
  console.error('A2C Social v45: falta la configuración de Supabase.');
}else{
const sb=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format((Number(c)||0)/100);
const toast=(message,bad=false)=>{
  const el=document.querySelector('#toast');
  if(!el)return alert(message);
  el.textContent=message;el.classList.toggle('bad',bad);el.classList.add('show');
  clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('show'),3600);
};
const busy=(b,on)=>{if(!b)return;b.disabled=on;b.dataset.old??=b.textContent;b.textContent=on?'Procesando…':b.dataset.old};

let notificationRows=[];
let resourceRows=[];
let currentResourceId=null;

async function authUser(){
  const {data}=await sb.auth.getUser();
  return data.user||null;
}
async function loadResources(){
  const {data}=await sb.from('resources').select('id,type,name,owner_id,is_shared,members_can_withdraw');
  resourceRows=data||[];
}
async function loadNotifications(){
  const {data,error}=await sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(80);
  if(error)throw error;
  notificationRows=data||[];
  renderNotificationBell();
}
function unreadCount(){return notificationRows.filter(n=>!n.read_at).length}

function renderNotificationBell(){
  let button=document.querySelector('#a2c-notification-button');
  if(!button){
    button=document.createElement('button');
    button.id='a2c-notification-button';
    button.className='a2c-notification-button';
    button.type='button';
    button.setAttribute('aria-label','Notificaciones');
    button.onclick=openNotifications;
    document.body.appendChild(button);
  }
  const count=unreadCount();
  button.innerHTML=`<span>🔔</span>${count?`<b>${count>99?'99+':count}</b>`:''}`;
}

function notificationActions(n){
  if(['expense_split','expense_reminder'].includes(n.type))
    return `<button class="btn primary" data-pay-split="${n.related_id}">Pagar</button>`;
  return '';
}
function openNotifications(){
  document.querySelector('#a2c-notification-layer')?.remove();
  const layer=document.createElement('div');
  layer.id='a2c-notification-layer';
  layer.className='a2c-v45-layer';
  layer.innerHTML=`<section class="a2c-v45-panel">
    <div class="modal-head"><div><span class="eyebrow">Actividad</span><h2>Notificaciones</h2>
    <p class="muted">${unreadCount()} sin leer</p></div><button class="close-btn" data-v45-close>×</button></div>
    <div class="a2c-notification-list">${notificationRows.length?notificationRows.map(n=>`
      <article class="a2c-notification ${n.read_at?'':'unread'}" data-notification="${n.id}">
        <span class="a2c-notification-icon">${iconFor(n.type)}</span>
        <div><strong>${esc(n.title||'Notificación')}</strong><p>${esc(n.body||'')}</p>
        <small>${n.created_at?new Date(n.created_at).toLocaleString('es-ES'):''}</small></div>
        <div class="a2c-notification-actions">${notificationActions(n)}
          ${!n.read_at?`<button class="btn" data-read-notification="${n.id}">Leída</button>`:''}
        </div>
      </article>`).join(''):'<div class="empty">No tienes notificaciones.</div>'}</div>
  </section>`;
  document.body.appendChild(layer);
  layer.querySelector('[data-v45-close]').onclick=()=>layer.remove();
  layer.onclick=e=>{if(e.target===layer)layer.remove()};
  layer.querySelectorAll('[data-read-notification]').forEach(b=>b.onclick=()=>markRead(b.dataset.readNotification));
  layer.querySelectorAll('[data-pay-split]').forEach(b=>b.onclick=()=>paySplit(b.dataset.paySplit,b));
}
function iconFor(type){
  if(type?.includes('like'))return '♥';
  if(type?.includes('comment'))return '💬';
  if(type?.includes('friend'))return '👥';
  if(type?.includes('follow'))return '➕';
  if(type?.includes('expense'))return '€';
  if(type?.includes('piggy'))return '🐷';
  return '🔔';
}
async function markRead(id){
  const {error}=await sb.rpc('mark_notification_read',{p_notification_id:id});
  if(error)return toast(error.message,true);
  await loadNotifications();openNotifications();
}
async function paySplit(id,b){
  if(!confirm('¿Marcar este gasto como pagado y registrar el pago?'))return;
  busy(b,true);
  const {error}=await sb.rpc('a2c_pay_expense_split',{p_split_id:id});
  busy(b,false);
  if(error)return toast(error.message,true);
  toast('Pago registrado correctamente.');
  await loadNotifications();openNotifications();
}

async function friendAutocomplete(input,onPick){
  let box=input.parentElement.querySelector('.a2c-friend-suggestions');
  if(!box){box=document.createElement('div');box.className='a2c-friend-suggestions';input.parentElement.appendChild(box)}
  let timer;
  input.addEventListener('input',()=>{
    clearTimeout(timer);
    const q=input.value.trim().replace(/^@/,'');
    if(!q){box.innerHTML='';box.hidden=true;return}
    timer=setTimeout(async()=>{
      const {data,error}=await sb.rpc('a2c_search_accepted_friends',{p_query:q});
      if(error){box.innerHTML='';box.hidden=true;return}
      box.hidden=false;
      box.innerHTML=(data||[]).map(f=>`<button type="button" data-friend-id="${f.friend_id}">
        <span>@${esc(f.username||'usuario')}</span><small>${esc(f.display_name||'Usuario')}</small>
      </button>`).join('')||'<div class="a2c-no-friends">No hay amigos que coincidan.</div>';
      box.querySelectorAll('[data-friend-id]').forEach(btn=>btn.onclick=()=>{
        const f=(data||[]).find(x=>String(x.friend_id)===btn.dataset.friendId);
        input.value=f?.username?`@${f.username}`:'';
        input.dataset.friendId=btn.dataset.friendId;
        box.hidden=true;
        onPick?.(f);
      });
    },220);
  });
}

function addFriendPicker(container,label='Añadir amigo'){
  const wrap=document.createElement('div');
  wrap.className='a2c-friend-picker';
  wrap.innerHTML=`<label>${esc(label)}</label><div class="a2c-friend-input-wrap">
    <input type="text" placeholder="Escribe las primeras letras de su @usuario" autocomplete="off">
    <button type="button" class="btn primary" disabled>Añadir</button>
  </div><div class="a2c-selected-friends"></div>`;
  container.appendChild(wrap);
  const input=wrap.querySelector('input'),add=wrap.querySelector('button');
  const selected=wrap.querySelector('.a2c-selected-friends');
  const ids=new Set;
  friendAutocomplete(input,f=>{add.disabled=!f});
  add.onclick=()=>{
    const id=input.dataset.friendId;
    if(!id||ids.has(id))return;
    ids.add(id);
    selected.insertAdjacentHTML('beforeend',`<span data-selected-friend="${id}">@${esc(input.value.replace(/^@/,''))}<button type="button">×</button></span>`);
    selected.lastElementChild.querySelector('button').onclick=e=>{ids.delete(id);e.currentTarget.parentElement.remove()};
    input.value='';delete input.dataset.friendId;add.disabled=true;
  };
  wrap.getIds=()=>[...ids];
  return wrap;
}

async function enhanceResourceForm(){
  const form=document.querySelector('#resource-form');
  if(!form||form.dataset.v45)return;
  form.dataset.v45='1';
  const actions=form.querySelector('.actions');
  if(!actions)return;
  const block=document.createElement('div');
  block.className='a2c-resource-friends-block';
  actions.before(block);
  const picker=addFriendPicker(block,'Compartir con amigos');
  form._a2cFriendPicker=picker;
}

async function inviteSelectedFriends(resourceId,ids){
  for(const friendId of ids){
    const {error}=await sb.rpc('a2c_invite_friend_to_resource',{
      p_resource_id:resourceId,p_friend_id:friendId
    });
    if(error)throw error;
  }
}

async function openAddFriendToResource(resourceId){
  const resource=resourceRows.find(r=>String(r.id)===String(resourceId));
  const layer=document.createElement('div');
  layer.className='a2c-v45-layer';
  layer.innerHTML=`<section class="a2c-v45-panel"><div class="modal-head"><div>
    <h2>Añadir amigo</h2><p class="muted">${esc(resource?.name||'Elemento compartido')}</p>
    </div><button class="close-btn" data-v45-close>×</button></div>
    <div id="a2c-existing-resource-picker"></div>
    <div class="actions"><button class="btn" data-v45-close>Cancelar</button>
    <button class="btn primary" id="a2c-send-resource-invites">Enviar invitación</button></div>
  </section>`;
  document.body.appendChild(layer);
  layer.querySelectorAll('[data-v45-close]').forEach(b=>b.onclick=()=>layer.remove());
  const picker=addFriendPicker(layer.querySelector('#a2c-existing-resource-picker'));
  layer.querySelector('#a2c-send-resource-invites').onclick=async e=>{
    const ids=picker.getIds();
    if(!ids.length)return toast('Selecciona al menos un amigo.',true);
    busy(e.currentTarget,true);
    try{await inviteSelectedFriends(resourceId,ids);toast('Invitaciones enviadas.');layer.remove()}
    catch(error){toast(error.message,true);busy(e.currentTarget,false)}
  };
}

function addResourceMenuButton(){
  document.querySelectorAll('[data-resource]').forEach(btn=>{
    const id=btn.dataset.resource;
    const card=btn.closest('.card');
    if(!card||card.querySelector(`[data-add-friend-resource="${id}"]`))return;
    const add=document.createElement('button');
    add.type='button';add.className='btn a2c-add-friend-resource';
    add.dataset.addFriendResource=id;add.textContent='Añadir amigo';
    card.appendChild(add);
  });
}
async function openPiggy(resourceId){
  const r=resourceRows.find(x=>String(x.id)===String(resourceId));
  if(r?.type!=='piggy')return;
  const user=await authUser();
  const owner=String(r.owner_id)===String(user?.id);
  const layer=document.createElement('div');
  layer.className='a2c-v45-layer';
  layer.innerHTML=`<section class="a2c-v45-panel"><div class="modal-head"><div>
    <span class="eyebrow">Hucha</span><h2>${esc(r.name)}</h2>
    <p class="muted">Todas las operaciones se realizan desde aquí.</p></div>
    <button class="close-btn" data-v45-close>×</button></div>
    ${owner?`<label class="a2c-permission-toggle"><input type="checkbox" id="a2c-withdraw-permission" ${r.members_can_withdraw?'checked':''}>
      <span><strong>Permitir retiradas a miembros</strong><small>El creador controla este permiso.</small></span></label>`:''}
    <div class="a2c-piggy-actions">
      <button class="btn primary" data-piggy-action="add">Añadir dinero</button>
      <button class="btn" data-piggy-action="withdraw">Retirar dinero</button>
      <button class="btn" data-piggy-action="expense">Registrar gasto</button>
      <button class="btn" data-piggy-action="history">Ver transacciones</button>
    </div>
  </section>`;
  document.body.appendChild(layer);
  layer.querySelector('[data-v45-close]').onclick=()=>layer.remove();
  layer.querySelector('#a2c-withdraw-permission')?.addEventListener('change',async e=>{
    const {error}=await sb.rpc('a2c_set_piggy_withdraw_permission',{p_resource_id:r.id,p_allowed:e.target.checked});
    if(error){e.target.checked=!e.target.checked;return toast(error.message,true)}
    r.members_can_withdraw=e.target.checked;toast('Permiso actualizado.');
  });
  layer.querySelectorAll('[data-piggy-action]').forEach(b=>b.onclick=()=>{
    const action=b.dataset.piggyAction;
    if(action==='withdraw')return openWithdrawPiggy(r);
    const menu=document.querySelector(`[data-resource="${CSS.escape(r.id)}"]`);
    if(menu){layer.remove();menu.click();setTimeout(()=>selectOriginalPiggyAction(action),100)}
  });
}
function selectOriginalPiggyAction(action){
  const text={add:'añadir',expense:'movimiento',history:'ver'}[action]||action;
  const buttons=[...document.querySelectorAll('#modal button')];
  buttons.find(b=>b.textContent.toLowerCase().includes(text))?.click();
}
function openWithdrawPiggy(r){
  document.querySelector('.a2c-v45-layer')?.remove();
  const layer=document.createElement('div');layer.className='a2c-v45-layer';
  layer.innerHTML=`<form class="a2c-v45-panel" id="a2c-withdraw-form"><div class="modal-head"><div>
    <h2>Retirar dinero</h2><p class="muted">${esc(r.name)}</p></div>
    <button type="button" class="close-btn" data-v45-close>×</button></div>
    <div class="field"><label>Importe</label><input name="amount" inputmode="decimal" required placeholder="0,00"></div>
    <div class="field"><label>Concepto</label><input name="concept" required placeholder="Motivo de la retirada"></div>
    <div class="actions"><button type="button" class="btn" data-v45-close>Cancelar</button>
    <button class="btn primary">Retirar</button></div></form>`;
  document.body.appendChild(layer);
  layer.querySelectorAll('[data-v45-close]').forEach(b=>b.onclick=()=>layer.remove());
  layer.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);
    const amount=Math.round(Number(String(fd.get('amount')).replace(',','.'))*100);
    busy(b,true);
    const {error}=await sb.rpc('a2c_withdraw_from_shared_piggy',{
      p_resource_id:r.id,p_amount_cents:amount,p_concept:String(fd.get('concept')||'')
    });
    busy(b,false);
    if(error)return toast(error.message,true);
    toast('Retirada registrada.');location.reload();
  };
}

async function addExpenseReminderButtons(){
  const user=await authUser();if(!user)return;
  const {data}=await sb.from('expense_splits').select('id,transaction_id,owner_id,debtor_user_id,amount_cents,paid_at');
  for(const split of data||[]){
    if(String(split.owner_id)!==String(user.id)||split.paid_at)continue;
    const txButton=document.querySelector(`[data-tx="${CSS.escape(split.transaction_id)}"],[data-transaction="${CSS.escape(split.transaction_id)}"]`);
    const row=txButton?.closest('.row,.transaction-row,.card');
    if(!row||row.querySelector(`[data-remind-split="${split.id}"]`))continue;
    const b=document.createElement('button');b.type='button';b.className='btn a2c-remind-btn';
    b.dataset.remindSplit=split.id;b.textContent='Notificar';
    row.appendChild(b);
  }
}

document.addEventListener('click',e=>{
  const add=e.target.closest('[data-add-friend-resource]');
  if(add){e.preventDefault();e.stopImmediatePropagation();openAddFriendToResource(add.dataset.addFriendResource);return}
  const remind=e.target.closest('[data-remind-split]');
  if(remind){e.preventDefault();e.stopImmediatePropagation();busy(remind,true);sb.rpc('a2c_remind_expense_split',{p_split_id:remind.dataset.remindSplit}).then(({error})=>{busy(remind,false);toast(error?error.message:'Recordatorio enviado.',!!error)});return}
  const card=e.target.closest('.card');
  const menu=card?.querySelector('[data-resource]');
  const res=menu&&resourceRows.find(r=>String(r.id)===String(menu.dataset.resource));
  if(res?.type==='piggy'&&e.target.closest('.metric,h3')){
    e.preventDefault();openPiggy(res.id);
  }
},true);

document.addEventListener('submit',e=>{
  const form=e.target;
  if(form?.id!=='resource-form'||!form._a2cFriendPicker)return;
  const ids=form._a2cFriendPicker.getIds();
  if(!ids.length)return;
  sessionStorage.setItem('a2c_pending_friend_invites',JSON.stringify(ids));
},true);

const observer=new MutationObserver(()=>{
  enhanceResourceForm();
  addResourceMenuButton();
  addExpenseReminderButtons();
});
observer.observe(document.documentElement,{subtree:true,childList:true});

(async()=>{
  try{
    await Promise.all([loadResources(),loadNotifications()]);
    enhanceResourceForm();addResourceMenuButton();addExpenseReminderButtons();

    const pending=sessionStorage.getItem('a2c_pending_friend_invites');
    if(pending){
      const ids=JSON.parse(pending);
      sessionStorage.removeItem('a2c_pending_friend_invites');
      const newest=[...resourceRows].sort((a,b)=>String(b.id).localeCompare(String(a.id)))[0];
      if(newest&&ids.length){
        try{await inviteSelectedFriends(newest.id,ids);toast('Elemento creado e invitaciones enviadas.')}
        catch(error){toast('Elemento creado, pero alguna invitación no se pudo enviar: '+error.message,true)}
      }
    }
  }catch(error){console.error('A2C v45:',error)}
})();
}


/* ==========================
   A2C Finanzas 5.3
   Mensajes y gastos divididos
   ========================== */

function a2c54FindSplit(splitId){
  return state.expenseSplits.find(row=>String(row.id)===String(splitId));
}
function openA2C54EditSplit(splitId,transactionId=null,onDone=null){
  const split=a2c54FindSplit(splitId);
  if(!split)return toast('El reparto ya no está disponible.',true);
  modal(`<form id="a2c54-edit-split-form">
    <div class="modal-head"><div><h2>Editar parte compartida</h2><p class="muted">${esc(split.transaction?.concept||'Gasto compartido')}</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Importe pendiente</label><input name="amount" inputmode="decimal" value="${(Number(split.amount_cents)/100).toFixed(2).replace('.',',')}" required></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
  </form>`);
  document.querySelector('#a2c54-edit-split-form').onsubmit=async event=>{
    event.preventDefault();const button=event.submitter,amount=cents(new FormData(event.currentTarget).get('amount'));
    busy(button,true);const {error}=await sb.rpc('a2c_update_expense_split_v53',{p_split_id:splitId,p_amount_cents:amount});busy(button,false);
    if(error)return toast(error.message,true);
    closeModal();await refresh();toast('Importe actualizado.');
    if(onDone)onDone();else if(transactionId){const tx=state.transactions.find(row=>row.id===transactionId);if(tx)openTransaction(tx);}
  };
}
async function a2c54SettleSplit(splitId,transactionId=null,onDone=null){
  const split=a2c54FindSplit(splitId);
  if(!split)return toast('El reparto ya no está disponible.',true);
  if(!confirm(`¿Confirmas que quieres liquidar manualmente ${money(split.amount_cents)}? Se aumentará tu balance, pero no se descontará del saldo del amigo.`))return;
  const {error}=await sb.rpc('a2c_mark_expense_split_paid_v53',{p_split_id:splitId,p_payment_method:'cash'});
  if(error)return toast(error.message,true);
  closeModal();await refresh();toast('Reparto liquidado manualmente.');
  if(onDone)onDone();else if(transactionId){const tx=state.transactions.find(row=>row.id===transactionId);if(tx)openTransaction(tx);}
}
async function a2c54DeleteSplit(splitId,transactionId=null,onDone=null){
  if(!confirm('¿Eliminar este reparto compartido? El amigo dejará de tenerlo pendiente.'))return;
  const {error}=await sb.rpc('a2c_delete_expense_split_v54',{p_split_id:splitId});
  if(error)return toast(error.message,true);
  closeModal();await refresh();toast('Reparto eliminado.');
  if(onDone)onDone();else if(transactionId){const tx=state.transactions.find(row=>row.id===transactionId);if(tx)openTransaction(tx);}
}

function renderMessagesPage(){
  setTimeout(()=>a2c42RefreshMessagesView?.(),80);
  const unread=a2c42.conversations.reduce((sum,row)=>sum+Number(row.unread_count||0),0);
  return `<section class="messages-page">
    <div class="dashboard-head">
      <div>
        <span class="eyebrow">Conversaciones</span>
        <h1>Mensajes</h1>
        <p class="muted">${unread?`${unread} mensaje${unread===1?'':'s'} sin leer`:'Habla con tus amigos y gestiona gastos compartidos.'}</p>
      </div>
      <button type="button" class="btn primary" id="messages-new-chat">Nuevo chat</button>
    </div>
    <div class="wa-conversation-list">
      ${a2c42.conversations.length?a2c42.conversations.map(c=>`
        <button type="button" class="wa-conversation-row" data-message-conversation="${c.conversation_id}" data-friend="${c.friend_id}">
          ${a2c42PersonAvatar(c)}
          <span class="wa-conversation-info">
            <strong>${esc(c.display_name||c.username||'Usuario')}</strong>
            <small>${esc(c.last_message||'Sin mensajes todavía')}</small>
          </span>
          <span class="wa-conversation-meta">
            <small>${c.last_message_at?new Date(c.last_message_at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):''}</small>
            ${Number(c.unread_count||0)>0?`<b>${Number(c.unread_count)}</b>`:''}
          </span>
        </button>`).join(''):'<div class="empty">Todavía no tienes conversaciones.</div>'}
    </div>
    <style>
      .messages-page{padding-bottom:90px}
      .wa-conversation-list{background:#fff;border:1px solid #ece8ef;border-radius:18px;overflow:hidden}
      .wa-conversation-row{width:100%;display:flex;align-items:center;gap:12px;padding:12px 14px;border:0;border-bottom:1px solid #f0edf2;background:#fff;text-align:left}
      .wa-conversation-row:last-child{border-bottom:0}.wa-conversation-info{flex:1;min-width:0}
      .wa-conversation-info strong,.wa-conversation-info small{display:block}.wa-conversation-info small{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}
      .wa-conversation-meta{text-align:right}.wa-conversation-meta small{display:block;font-size:10px;color:var(--muted)}
      .wa-conversation-meta b{display:inline-grid;place-items:center;min-width:21px;height:21px;padding:0 6px;border-radius:99px;background:#7557ff;color:#fff;font-size:10px;margin-top:5px}
    </style>
  </section>`;
}

const a2c53BindBase=bind;
bind=function(){
  a2c53BindBase();
  document.querySelectorAll('[data-message-conversation]').forEach(button=>{
    button.onclick=()=>openA2C42Conversation(
      button.dataset.messageConversation,
      button.dataset.friend
    );
  });
  document.querySelector('#messages-new-chat')?.addEventListener('click',()=>openA2C42SocialHub('friends'));
};

function a2c53AccountOptions(){
  const rows=[`<option value="">Cuenta principal · ${money(mainBalance())}</option>`];
  state.resources.filter(r=>r.type==='folder'||r.type==='piggy').forEach(r=>{
    rows.push(`<option value="${r.id}">${esc(r.name)} · ${money(resourceBalance(r.id))}</option>`);
  });
  return rows.join('');
}

function openA2C53Pay(splitId,onDone=null){
  const split=state.expenseSplits.find(row=>String(row.id)===String(splitId));
  modal(`<form id="a2c53-pay-form">
    <div class="modal-head"><div><h2>Pagar gasto</h2><p class="muted">${esc(split?.transaction?.concept||'Gasto compartido')}</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="metric">${money(split?.amount_cents||0)}</div>
    <div class="field"><label>Cuenta</label><select name="resource_id">${a2c53AccountOptions()}</select></div>
    <div class="field"><label>Método</label><select name="payment_method"><option value="bank">Banco</option><option value="cash">Efectivo</option></select></div>
    <div class="notice">Al pagar, se restará de tu saldo y se añadirá al balance del amigo.</div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Pagar ahora</button></div>
  </form>`);
  document.querySelector('#a2c53-pay-form').onsubmit=async event=>{
    event.preventDefault();const button=event.submitter,fd=new FormData(event.currentTarget);busy(button,true);
    let {error}=await sb.rpc('a2c_pay_expense_split_v53',{
      p_split_id:splitId,
      p_resource_id:fd.get('resource_id')||null,
      p_payment_method:fd.get('payment_method')
    });
    if(error&&/function|does not exist|schema cache/i.test(String(error.message||''))){
      const fallback=await sb.rpc('a2c_pay_shared_expense_v52',{
        p_split_id:splitId,
        p_resource_id:fd.get('resource_id')||null,
        p_payment_method:fd.get('payment_method')
      });
      error=fallback.error;
    }
    busy(button,false);if(error)return toast(error.message,true);
    closeModal();
    await refresh();
    await a2c42RefreshMessagesView?.();
    toast('Pago realizado.');
    onDone?.();
  };
}

function openA2C53Manage(split,conversationId,friendId){
  modal(`<div>
    <div class="modal-head"><div><h2>Gestionar reparto</h2><p class="muted">${esc(split.concept)}</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="a2c54-manage-summary"><span>Importe pendiente</span><strong>${money(split.split_amount_cents)}</strong></div>
    <div class="actions vertical">
      <button type="button" class="btn" id="a2c54-chat-edit">Editar importe</button>
      <button type="button" class="btn primary" id="a2c54-chat-settle">Liquidar manualmente</button>
      <button type="button" class="btn danger" id="a2c54-chat-delete">Eliminar reparto</button>
    </div>
    <div class="notice">La liquidación manual aumenta tu balance, pero no descuenta dinero del saldo del amigo.</div>
    <style>.a2c54-manage-summary{display:flex;justify-content:space-between;align-items:center;padding:13px;border:1px solid #ebe7f1;border-radius:14px;margin-bottom:12px}.a2c54-manage-summary span{color:var(--muted)}.actions.vertical{display:grid}.actions.vertical .btn{width:100%}</style>
  </div>`);
  const reopen=()=>openA2C42Conversation(conversationId,friendId);
  document.querySelector('#a2c54-chat-edit').onclick=()=>openA2C54EditSplit(split.split_id,null,reopen);
  document.querySelector('#a2c54-chat-settle').onclick=()=>a2c54SettleSplit(split.split_id,null,reopen);
  document.querySelector('#a2c54-chat-delete').onclick=()=>a2c54DeleteSplit(split.split_id,null,reopen);
}

openA2C42Conversation=async function(conversationId,friendId){
  const friend=a2c42.friends.find(p=>String(p.id)===String(friendId))
    ||a2c42.conversations.find(c=>String(c.friend_id)===String(friendId))
    ||{};
  const messagesResult=await sb.rpc(
    'a2c_list_messages_v42',
    {p_conversation_id:conversationId,p_limit:200}
  );
  if(messagesResult.error)return toast(messagesResult.error.message,true);

  let splitsResult=await sb.rpc(
    'a2c_list_conversation_splits_v55',
    {p_conversation_id:conversationId}
  );
  if(splitsResult.error){
    const fallback=await sb.rpc(
      'a2c_list_conversation_splits_v53',
      {p_conversation_id:conversationId}
    );
    if(!fallback.error){
      splitsResult={
        data:(fallback.data||[]).map(row=>({
          ...row,
          version_number:1,
          is_current:true,
          version_status:row.split_status||'pending'
        })),
        error:null
      };
    }
  }
  if(splitsResult.error){
    console.warn('No se pudieron cargar los repartos del chat:',splitsResult.error);
    splitsResult={data:[],error:null};
  }
  const messages=messagesResult.data||[],splits=splitsResult.data||[];

  modal(`<div class="wa-chat-shell">
    <div class="wa-chat-header">
      <button class="wa-back" data-close>‹</button>
      ${a2c42PersonAvatar(friend)}
      <div><strong>${esc(friend.display_name||friend.username||'Conversación')}</strong><small>@${esc(friend.username||'usuario')}</small></div>
    </div>
    <div class="wa-chat-body" id="a2c42-message-list">
      ${messages.map(m=>`<article class="wa-bubble ${m.mine?'mine':'theirs'}"><p>${esc(m.body)}</p><small>${new Date(m.created_at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</small></article>`).join('')}
      ${splits.map(s=>`<article class="wa-expense-card ${s.is_current?'current':'historic'}">
        <div>
          <small>${s.is_current?'GASTO COMPARTIDO':'HISTORIAL DEL REPARTO'}</small>
          <strong>${esc(s.concept)}</strong>
          <span>Total ${money(s.transaction_amount_cents)} · Parte ${money(s.split_amount_cents)}</span>
          <em>${esc(s.version_label||'')}</em>
        </div>
        <div class="wa-expense-actions">
          <b class="${s.split_status==='paid'?'paid':s.is_current?'pending':'disabled'}">${s.split_status==='paid'?'Pagado':s.is_current?'Pendiente':'Sin vigencia'}</b>
          ${s.is_current&&s.mine_to_pay?`<button class="btn primary" data-wa-pay="${s.split_id}">Pagar</button>`:''}
          ${s.is_current&&s.mine_to_manage?`<button class="btn" data-wa-manage="${s.split_id}">Gestionar</button>`:''}
        </div>
      </article>`).join('')}
    </div>
    <form class="wa-compose" id="a2c42-compose">
      <textarea name="body" maxlength="4000" required placeholder="Mensaje"></textarea>
      <button class="wa-send" aria-label="Enviar">➤</button>
    </form>
    <style>
      #modal .modal-card.wide{padding:0;overflow:hidden}.wa-chat-shell{height:min(78vh,720px);display:flex;flex-direction:column;background:#efeae2}
      .wa-chat-header{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border-bottom:1px solid #e8e4e8}.wa-chat-header>div{flex:1}.wa-chat-header strong,.wa-chat-header small{display:block}.wa-chat-header small{font-size:11px;color:var(--muted)}
      .wa-back{border:0;background:transparent;font-size:34px;line-height:1}.wa-chat-body{flex:1;overflow:auto;padding:14px 12px;display:flex;flex-direction:column;gap:7px;background-color:#efeae2;background-image:radial-gradient(#d9d2c9 0.7px,transparent 0.7px);background-size:18px 18px}
      .wa-bubble{max-width:82%;padding:8px 10px 6px;border-radius:9px;box-shadow:0 1px 1px rgba(0,0,0,.08)}.wa-bubble p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.wa-bubble small{display:block;text-align:right;font-size:9px;color:#777;margin-top:3px}
      .wa-bubble.mine{align-self:flex-end;background:#dcf8c6;border-top-right-radius:2px}.wa-bubble.theirs{align-self:flex-start;background:#fff;border-top-left-radius:2px}
      .wa-expense-card{display:flex;align-items:center;gap:10px;background:#fff;padding:11px;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.1)}.wa-expense-card>div:first-child{flex:1}.wa-expense-card small,.wa-expense-card strong,.wa-expense-card span,.wa-expense-card em{display:block}.wa-expense-card em{font-size:10px;font-style:normal;color:#9b8fa1;margin-top:4px}.wa-expense-card.historic{opacity:.62;background:#f4f1f3}.wa-expense-card.historic .btn{display:none}.wa-expense-card small{font-size:9px;color:#7557ff}.wa-expense-card span{font-size:11px;color:#666;margin-top:3px}.wa-expense-actions{text-align:right}.wa-expense-actions b{display:block;font-size:10px}.wa-expense-actions b.pending{color:#d9851f}.wa-expense-actions b.paid{color:#16835c}.wa-expense-actions b.disabled{color:#888}.wa-expense-actions .btn{padding:6px 9px;margin-top:5px}
      .wa-compose{display:flex;align-items:flex-end;gap:7px;padding:9px;background:#f0f2f5}.wa-compose textarea{flex:1;min-height:42px;max-height:110px;border:0;border-radius:22px;padding:11px 15px;resize:none;background:#fff}.wa-send{width:44px;height:44px;border:0;border-radius:50%;background:#7557ff;color:#fff;font-size:18px}
    </style>
  </div>`,true);

  const list=document.querySelector('#a2c42-message-list');list.scrollTop=list.scrollHeight;
  document.querySelectorAll('[data-wa-pay]').forEach(button=>button.onclick=()=>openA2C53Pay(button.dataset.waPay,()=>openA2C42Conversation(conversationId,friendId)));
  document.querySelectorAll('[data-wa-manage]').forEach(button=>{
    const split=splits.find(row=>String(row.split_id)===String(button.dataset.waManage));
    button.onclick=()=>openA2C53Manage(split,conversationId,friendId);
  });
  document.querySelector('#a2c42-compose').onsubmit=async event=>{
    event.preventDefault();const button=event.submitter,body=String(new FormData(event.currentTarget).get('body')||'').trim();if(!body)return;
    busy(button,true);const {error}=await sb.rpc('a2c_send_message_v42',{p_friend_id:friendId,p_body:body});busy(button,false);
    if(error)return toast(error.message,true);
    await a2c42LoadConversations();
    openA2C42Conversation(conversationId,friendId);
  };
};


/* ==========================
   A2C Finanzas 5.1
   Transacciones compartidas
   ========================== */
function a2c51PendingDebts(){
  return state.expenseSplits.filter(row=>row.debtor_user_id===state.user.id&&row.status==='pending');
}
function a2c51AccountOptions(){
  const options=[`<option value="">Cuenta principal · ${money(mainBalance())}</option>`];
  state.resources.filter(r=>r.type==='folder'||r.type==='piggy').forEach(r=>{
    options.push(`<option value="${r.id}">${esc(r.name)} · ${money(resourceBalance(r.id))}</option>`);
  });
  return options.join('');
}
async function openShareTransaction(tx){
  try{await a2c42LoadFriends();}catch(error){return toast(error.message,true);}
  if(!a2c42.friends.length)return toast('Añade al menos un amigo antes de compartir.',true);
  modal(`<form id="a2c51-share-transaction"><div class="modal-head"><div><h2>Compartir con un amigo</h2><p class="muted">El amigo podrá consultar esta transacción dentro de vuestra conversación.</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <article class="a2c51-share-preview"><div><strong>${esc(tx.concept||'Movimiento')}</strong><small>${esc(tx.occurred_on)} · ${esc(kindLabels[tx.kind]||'Movimiento')}</small></div><b>${money(tx.amount_cents)}</b></article>
    <div class="field"><label>Amigo</label><select name="friend_id" required>${a2c42.friends.map(p=>`<option value="${p.id}">${esc(p.display_name||p.username)} · @${esc(p.username||'usuario')}</option>`).join('')}</select></div>
    ${tx.kind==='expense'?`<label class="a2c51-shared-toggle"><input type="checkbox" id="a2c51-create-debt"><span><strong>Es un gasto compartido</strong><small>El amigo podrá pagarlo directamente desde el chat.</small></span></label><div class="field hidden" id="a2c51-amount-field"><label>Importe que debe pagar</label><input name="shared_amount" inputmode="decimal" value="${(Number(tx.amount_cents)/200).toFixed(2).replace('.',',')}"></div>`:''}
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Compartir</button></div>
    <style>.a2c51-share-preview{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #ebe7f1;border-radius:14px;margin-bottom:13px}.a2c51-share-preview div{flex:1}.a2c51-share-preview strong,.a2c51-share-preview small{display:block}.a2c51-share-preview small{font-size:11px;color:var(--muted);margin-top:3px}.a2c51-shared-toggle{display:flex;gap:9px;align-items:flex-start;padding:11px;border:1px solid #ebe7f1;border-radius:14px;margin-bottom:10px}.a2c51-shared-toggle strong,.a2c51-shared-toggle small{display:block}.a2c51-shared-toggle small{font-size:11px;color:var(--muted);margin-top:2px}</style></form>`);
  const toggle=document.querySelector('#a2c51-create-debt'),amount=document.querySelector('#a2c51-amount-field');
  toggle?.addEventListener('change',()=>amount.classList.toggle('hidden',!toggle.checked));
  document.querySelector('#a2c51-share-transaction').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);
    const sharedAmount=toggle?.checked?cents(fd.get('shared_amount')):0;
    if(toggle?.checked&&sharedAmount<=0)return toast('Indica el importe que debe pagar tu amigo.',true);
    busy(b,true);
    const {error}=await sb.rpc('a2c_share_transaction_with_friend_v51',{
      p_transaction_id:tx.id,
      p_friend_id:fd.get('friend_id'),
      p_shared_amount_cents:sharedAmount
    });
    busy(b,false);
    if(error)return toast(error.message,true);
    closeModal();await refresh();toast(toggle?.checked?'Gasto compartido enviado.':'Transacción compartida.');
  };
}
function a2c51PendingHistoryMarkup(){
  const rows=a2c51PendingDebts();
  if(!rows.length)return '';
  return `<div class="a2c51-pending-history"><div class="section-head"><div><h3>Pagos pendientes con amigos</h3><p class="muted">No descuentan saldo hasta que los pagues.</p></div></div>${rows.map(row=>`<button type="button" class="a2c51-debt-row" data-a2c51-pay="${row.id}"><span class="tx-icon expense">⌛</span><span><strong>${esc(row.transaction?.concept||'Gasto compartido')}</strong><small>${esc(row.owner?.display_name||row.person_name||'Amigo')} · Pendiente de pago</small></span><b>${money(row.amount_cents)}</b><em>Pagar</em></button>`).join('')}</div>
  <style>.a2c51-pending-history{margin-bottom:15px}.a2c51-debt-row{width:100%;display:flex;align-items:center;gap:10px;padding:10px 8px;border:0;border-bottom:1px solid #eee9f2;background:#fff;text-align:left}.a2c51-debt-row>span:nth-child(2){flex:1;min-width:0}.a2c51-debt-row strong,.a2c51-debt-row small{display:block}.a2c51-debt-row small{font-size:11px;color:var(--muted)}.a2c51-debt-row b{color:#d9851f}.a2c51-debt-row em{font-style:normal;font-size:11px;color:#7557ff}</style>`;
}
const a2c51RenderActivityBase=renderActivity;
renderActivity=function(){
  return a2c51RenderActivityBase().replace('<form class="filters filters-pro"',`${a2c51PendingHistoryMarkup()}<form class="filters filters-pro"`);
};
const a2c51BindBase=bind;
bind=function(){
  a2c51BindBase();
  document.querySelectorAll('[data-a2c51-pay]').forEach(button=>button.onclick=()=>openA2C51Pay(button.dataset.a2c51Pay));
};
function openA2C51Pay(splitId,onPaid=null){
  const split=state.expenseSplits.find(row=>String(row.id)===String(splitId));
  if(!split)return toast('El pago ya no está disponible.',true);
  modal(`<form id="a2c51-pay-form"><div class="modal-head"><div><h2>Pagar gasto compartido</h2><p class="muted">${esc(split.transaction?.concept||'Gasto compartido')}</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="metric">${money(split.amount_cents)}</div>
    <div class="field"><label>Cuenta utilizada</label><select name="resource_id">${a2c51AccountOptions()}</select></div>
    <div class="field"><label>Método</label><select name="payment_method"><option value="bank">Banco</option><option value="cash">Efectivo</option></select></div>
    <div class="notice">Hasta que confirmes, este pago no reduce tu saldo disponible.</div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Confirmar pago</button></div></form>`);
  document.querySelector('#a2c51-pay-form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);
    const {error}=await sb.rpc('a2c_pay_shared_expense_v51',{
      p_split_id:splitId,
      p_resource_id:fd.get('resource_id')||null,
      p_payment_method:fd.get('payment_method')
    });
    busy(b,false);if(error)return toast(error.message,true);
    closeModal();await refresh();toast('Pago registrado correctamente.');if(onPaid)onPaid();
  };
}
const a2c51ConversationBase=openA2C42Conversation;
openA2C42Conversation=async function(conversationId,friendId){
  const friend=a2c42.friends.find(p=>String(p.id)===String(friendId))||a2c42.conversations.find(c=>String(c.friend_id)===String(friendId))||{};
  const [messagesResult,sharesResult]=await Promise.all([
    sb.rpc('a2c_list_messages_v42',{p_conversation_id:conversationId,p_limit:200}),
    sb.rpc('a2c_list_conversation_transaction_shares_v51',{p_conversation_id:conversationId})
  ]);
  if(messagesResult.error)return toast(messagesResult.error.message,true);
  if(sharesResult.error)return toast(sharesResult.error.message,true);
  const messages=messagesResult.data||[],shares=sharesResult.data||[];
  a2c42.activeConversation=conversationId;
  modal(`<div class="modal-head"><div><h2>${esc(friend.display_name||friend.username||'Conversación')}</h2><p class="muted">@${esc(friend.username||'usuario')} · conversación privada</p></div><button class="close-btn" data-close>×</button></div>
    <section class="a2c42-chat"><div class="a2c42-messages" id="a2c42-message-list">
      ${messages.map(m=>`<article class="a2c42-message ${m.mine?'mine':''}"><p>${esc(m.body)}</p><small>${new Date(m.created_at).toLocaleString('es-ES')}</small></article>`).join('')}
      ${shares.map(s=>`<article class="a2c51-chat-share"><div><small>${s.kind==='expense'?'Gasto compartido':'Transacción compartida'}</small><strong>${esc(s.concept)}</strong><span>${esc(s.occurred_on)} · ${money(s.transaction_amount_cents)}</span></div>${s.split_id?`<div class="a2c51-chat-debt"><b>${money(s.split_amount_cents)}</b><small>${s.split_status==='paid'?'Pagado':'Pendiente'}</small>${s.mine_to_pay?`<button class="btn primary" data-chat-pay="${s.split_id}">Pagar</button>`:''}</div>`:''}</article>`).join('')}
      ${!messages.length&&!shares.length?'<div class="empty compact">Escribe el primer mensaje.</div>':''}
    </div><form class="a2c42-compose" id="a2c42-compose"><textarea name="body" maxlength="4000" required placeholder="Escribe un mensaje…"></textarea><button class="btn primary">Enviar</button></form></section>
    <style>.a2c51-chat-share{display:flex;gap:10px;align-items:center;padding:11px;border:1px solid #ded6ed;border-radius:14px;background:#fff}.a2c51-chat-share>div:first-child{flex:1;min-width:0}.a2c51-chat-share small,.a2c51-chat-share strong,.a2c51-chat-share span{display:block}.a2c51-chat-share small{font-size:10px;color:var(--muted)}.a2c51-chat-share span{font-size:11px;color:var(--muted);margin-top:3px}.a2c51-chat-debt{text-align:right}.a2c51-chat-debt b{display:block;color:#d9851f}.a2c51-chat-debt .btn{margin-top:5px;padding:6px 10px}</style>`,true);
  const list=document.querySelector('#a2c42-message-list');list.scrollTop=list.scrollHeight;
  document.querySelectorAll('[data-chat-pay]').forEach(b=>b.onclick=()=>openA2C51Pay(b.dataset.chatPay,()=>openA2C42Conversation(conversationId,friendId)));
  document.querySelector('#a2c42-compose').onsubmit=async e=>{e.preventDefault();const b=e.submitter,body=String(new FormData(e.currentTarget).get('body')||'').trim();if(!body)return;busy(b,true);const{error}=await sb.rpc('a2c_send_message_v42',{p_friend_id:friendId,p_body:body});busy(b,false);if(error)return toast(error.message,true);openA2C42Conversation(conversationId,friendId);};
};

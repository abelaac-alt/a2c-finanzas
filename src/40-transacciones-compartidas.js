
/* ==========================
   A2C Finanzas 5.2
   Gastos compartidos simplificados
   ========================== */
function a2c52PendingDebts(){
  return state.expenseSplits.filter(row=>
    row.debtor_user_id===state.user.id && row.status==='pending'
  );
}
function a2c52AccountOptions(){
  const options=[
    `<option value="">Cuenta principal · ${money(mainBalance())}</option>`
  ];
  state.resources
    .filter(r=>r.type==='folder'||r.type==='piggy')
    .forEach(r=>{
      options.push(
        `<option value="${r.id}">${esc(r.name)} · ${money(resourceBalance(r.id))}</option>`
      );
    });
  return options.join('');
}
async function openShareTransaction(tx){
  if(tx.kind!=='expense'){
    return toast('Solo se pueden compartir gastos.',true);
  }
  try{
    await a2c42LoadFriends();
  }catch(error){
    return toast(error.message,true);
  }
  if(!a2c42.friends.length){
    return toast('Añade al menos un amigo antes de compartir.',true);
  }

  modal(`<form id="a2c52-share-expense">
    <div class="modal-head">
      <div>
        <h2>Compartir gasto</h2>
        <p class="muted">Se enviará al chat del amigo y recibirá una notificación.</p>
      </div>
      <button type="button" class="close-btn" data-close>×</button>
    </div>

    <article class="a2c52-preview">
      <div>
        <strong>${esc(tx.concept||'Gasto')}</strong>
        <small>${esc(tx.occurred_on)} · Gasto</small>
      </div>
      <b>${money(tx.amount_cents)}</b>
    </article>

    <div class="field">
      <label>Amigo</label>
      <select name="friend_id" required>
        ${a2c42.friends.map(p=>`
          <option value="${p.id}">
            ${esc(p.display_name||p.username)} · @${esc(p.username||'usuario')}
          </option>`).join('')}
      </select>
    </div>

    <div class="field">
      <label>Parte que debe pagar</label>
      <input
        name="shared_amount"
        inputmode="decimal"
        value="${(Number(tx.amount_cents)/200).toFixed(2).replace('.',',')}"
        required
      >
    </div>

    <div class="notice">
      El importe quedará pendiente y no descontará saldo al amigo hasta que lo pague.
    </div>

    <div class="actions">
      <button type="button" class="btn" data-close>Cancelar</button>
      <button class="btn primary">Compartir</button>
    </div>

    <style>
      .a2c52-preview{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #ebe7f1;border-radius:14px;margin-bottom:13px}
      .a2c52-preview div{flex:1}.a2c52-preview strong,.a2c52-preview small{display:block}
      .a2c52-preview small{font-size:11px;color:var(--muted);margin-top:3px}
    </style>
  </form>`);

  document.querySelector('#a2c52-share-expense').onsubmit=async event=>{
    event.preventDefault();
    const button=event.submitter;
    const form=new FormData(event.currentTarget);
    const amount=cents(form.get('shared_amount'));

    if(amount<=0 || amount>Number(tx.amount_cents)){
      return toast('El importe compartido no es válido.',true);
    }

    busy(button,true);
    const {error}=await sb.rpc('a2c_share_expense_with_friend_v52',{
      p_transaction_id:tx.id,
      p_friend_id:form.get('friend_id'),
      p_shared_amount_cents:amount
    });
    busy(button,false);

    if(error)return toast(error.message,true);

    closeModal();
    await refresh();
    toast('Gasto enviado al amigo.');
  };
}

function a2c52PendingHistoryMarkup(){
  const rows=a2c52PendingDebts();
  if(!rows.length)return '';

  return `<div class="a2c52-pending-history">
    <div class="section-head">
      <div>
        <h3>Pagos pendientes con amigos</h3>
        <p class="muted">No descuentan saldo hasta que los pagues.</p>
      </div>
    </div>
    ${rows.map(row=>`
      <button type="button" class="a2c52-debt-row" data-a2c52-pay="${row.id}">
        <span class="tx-icon expense">⌛</span>
        <span>
          <strong>${esc(row.transaction?.concept||'Gasto compartido')}</strong>
          <small>${esc(row.owner?.display_name||row.person_name||'Amigo')} · Pendiente</small>
        </span>
        <b>${money(row.amount_cents)}</b>
        <em>Pagar</em>
      </button>`).join('')}
  </div>
  <style>
    .a2c52-pending-history{margin-bottom:15px}
    .a2c52-debt-row{width:100%;display:flex;align-items:center;gap:10px;padding:10px 8px;border:0;border-bottom:1px solid #eee9f2;background:#fff;text-align:left}
    .a2c52-debt-row>span:nth-child(2){flex:1;min-width:0}
    .a2c52-debt-row strong,.a2c52-debt-row small{display:block}
    .a2c52-debt-row small{font-size:11px;color:var(--muted)}
    .a2c52-debt-row b{color:#d9851f}.a2c52-debt-row em{font-style:normal;font-size:11px;color:#7557ff}
  </style>`;
}

const a2c52RenderActivityBase=renderActivity;
renderActivity=function(){
  return a2c52RenderActivityBase().replace(
    '<form class="filters filters-pro"',
    `${a2c52PendingHistoryMarkup()}<form class="filters filters-pro"`
  );
};

const a2c52BindBase=bind;
bind=function(){
  a2c52BindBase();
  document.querySelectorAll('[data-a2c52-pay]').forEach(button=>{
    button.onclick=()=>openA2C52Pay(button.dataset.a2c52Pay);
  });
};

function openA2C52Pay(splitId,onPaid=null){
  const split=state.expenseSplits.find(row=>String(row.id)===String(splitId));
  if(!split)return toast('El pago ya no está disponible.',true);

  modal(`<form id="a2c52-pay-form">
    <div class="modal-head">
      <div>
        <h2>Pagar gasto compartido</h2>
        <p class="muted">${esc(split.transaction?.concept||'Gasto compartido')}</p>
      </div>
      <button type="button" class="close-btn" data-close>×</button>
    </div>

    <div class="metric">${money(split.amount_cents)}</div>

    <div class="field">
      <label>Cuenta utilizada</label>
      <select name="resource_id">${a2c52AccountOptions()}</select>
    </div>

    <div class="field">
      <label>Método</label>
      <select name="payment_method">
        <option value="bank">Banco</option>
        <option value="cash">Efectivo</option>
      </select>
    </div>

    <div class="notice">
      Al confirmar, el importe se descontará de tu saldo y se sumará al balance del amigo.
    </div>

    <div class="actions">
      <button type="button" class="btn" data-close>Cancelar</button>
      <button class="btn primary">Confirmar pago</button>
    </div>
  </form>`);

  document.querySelector('#a2c52-pay-form').onsubmit=async event=>{
    event.preventDefault();
    const button=event.submitter;
    const form=new FormData(event.currentTarget);

    busy(button,true);
    const {error}=await sb.rpc('a2c_pay_shared_expense_v52',{
      p_split_id:splitId,
      p_resource_id:form.get('resource_id')||null,
      p_payment_method:form.get('payment_method')
    });
    busy(button,false);

    if(error)return toast(error.message,true);

    closeModal();
    await refresh();
    toast('Pago registrado correctamente.');
    if(onPaid)onPaid();
  };
}

function openA2C52Manage(split,conversationId,friendId){
  modal(`<form id="a2c52-manage-form">
    <div class="modal-head">
      <div>
        <h2>Gestionar gasto compartido</h2>
        <p class="muted">${esc(split.concept||'Gasto compartido')}</p>
      </div>
      <button type="button" class="close-btn" data-close>×</button>
    </div>

    <div class="field">
      <label>Importe pendiente</label>
      <input
        name="amount"
        inputmode="decimal"
        value="${(Number(split.split_amount_cents)/100).toFixed(2).replace('.',',')}"
        required
      >
    </div>

    <div class="actions">
      <button type="button" class="btn" id="a2c52-manual-paid">Registrar pago manual</button>
      <button class="btn primary">Guardar importe</button>
    </div>
  </form>`);

  document.querySelector('#a2c52-manage-form').onsubmit=async event=>{
    event.preventDefault();
    const button=event.submitter;
    const amount=cents(new FormData(event.currentTarget).get('amount'));

    busy(button,true);
    const {error}=await sb.rpc('a2c_update_shared_expense_v52',{
      p_split_id:split.split_id,
      p_amount_cents:amount
    });
    busy(button,false);

    if(error)return toast(error.message,true);

    closeModal();
    await refresh();
    toast('Importe actualizado.');
    openA2C42Conversation(conversationId,friendId);
  };

  document.querySelector('#a2c52-manual-paid').onclick=async()=>{
    const confirmed=confirm(
      `¿Confirmas que el amigo ya ha pagado ${money(split.split_amount_cents)}?`
    );
    if(!confirmed)return;

    const {error}=await sb.rpc('a2c_mark_shared_expense_paid_v52',{
      p_split_id:split.split_id,
      p_payment_method:'cash'
    });

    if(error)return toast(error.message,true);

    closeModal();
    await refresh();
    toast('Pago manual registrado.');
    openA2C42Conversation(conversationId,friendId);
  };
}

openA2C42Conversation=async function(conversationId,friendId){
  const friend=
    a2c42.friends.find(p=>String(p.id)===String(friendId))||
    a2c42.conversations.find(c=>String(c.friend_id)===String(friendId))||
    {};

  const [messagesResult,sharesResult]=await Promise.all([
    sb.rpc('a2c_list_messages_v42',{
      p_conversation_id:conversationId,
      p_limit:200
    }),
    sb.rpc('a2c_list_conversation_transaction_shares_v52',{
      p_conversation_id:conversationId
    })
  ]);

  if(messagesResult.error)return toast(messagesResult.error.message,true);
  if(sharesResult.error)return toast(sharesResult.error.message,true);

  const messages=messagesResult.data||[];
  const shares=sharesResult.data||[];

  a2c42.activeConversation=conversationId;

  modal(`<div class="modal-head">
      <div>
        <h2>${esc(friend.display_name||friend.username||'Conversación')}</h2>
        <p class="muted">@${esc(friend.username||'usuario')} · conversación privada</p>
      </div>
      <button class="close-btn" data-close>×</button>
    </div>

    <section class="a2c42-chat">
      <div class="a2c42-messages" id="a2c42-message-list">
        ${messages.map(message=>`
          <article class="a2c42-message ${message.mine?'mine':''}">
            <p>${esc(message.body)}</p>
            <small>${new Date(message.created_at).toLocaleString('es-ES')}</small>
          </article>`).join('')}

        ${shares.map(share=>`
          <article class="a2c52-chat-share">
            <div>
              <small>Gasto compartido</small>
              <strong>${esc(share.concept)}</strong>
              <span>${esc(share.occurred_on)} · Total ${money(share.transaction_amount_cents)}</span>
            </div>
            <div class="a2c52-chat-debt">
              <b>${money(share.split_amount_cents)}</b>
              <small>${share.split_status==='paid'?'Pagado':'Pendiente'}</small>
              ${share.mine_to_pay
                ? `<button class="btn primary" data-chat-pay="${share.split_id}">Pagar</button>`
                : ''}
              ${share.mine_to_manage
                ? `<button class="btn" data-chat-manage="${share.split_id}">Editar</button>`
                : ''}
            </div>
          </article>`).join('')}

        ${!messages.length&&!shares.length
          ? '<div class="empty compact">Escribe el primer mensaje.</div>'
          : ''}
      </div>

      <form class="a2c42-compose" id="a2c42-compose">
        <textarea name="body" maxlength="4000" required placeholder="Escribe un mensaje…"></textarea>
        <button class="btn primary">Enviar</button>
      </form>
    </section>

    <style>
      .a2c52-chat-share{display:flex;gap:10px;align-items:center;padding:11px;border:1px solid #ded6ed;border-radius:14px;background:#fff}
      .a2c52-chat-share>div:first-child{flex:1;min-width:0}
      .a2c52-chat-share small,.a2c52-chat-share strong,.a2c52-chat-share span{display:block}
      .a2c52-chat-share small{font-size:10px;color:var(--muted)}
      .a2c52-chat-share span{font-size:11px;color:var(--muted);margin-top:3px}
      .a2c52-chat-debt{text-align:right}.a2c52-chat-debt b{display:block;color:#d9851f}
      .a2c52-chat-debt .btn{margin-top:5px;padding:6px 10px}
    </style>`,true);

  const list=document.querySelector('#a2c42-message-list');
  list.scrollTop=list.scrollHeight;

  document.querySelectorAll('[data-chat-pay]').forEach(button=>{
    button.onclick=()=>openA2C52Pay(
      button.dataset.chatPay,
      ()=>openA2C42Conversation(conversationId,friendId)
    );
  });

  document.querySelectorAll('[data-chat-manage]').forEach(button=>{
    const share=shares.find(
      row=>String(row.split_id)===String(button.dataset.chatManage)
    );
    button.onclick=()=>openA2C52Manage(share,conversationId,friendId);
  });

  document.querySelector('#a2c42-compose').onsubmit=async event=>{
    event.preventDefault();
    const button=event.submitter;
    const body=String(new FormData(event.currentTarget).get('body')||'').trim();
    if(!body)return;

    busy(button,true);
    const {error}=await sb.rpc('a2c_send_message_v42',{
      p_friend_id:friendId,
      p_body:body
    });
    busy(button,false);

    if(error)return toast(error.message,true);

    openA2C42Conversation(conversationId,friendId);
  };
};

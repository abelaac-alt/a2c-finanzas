/* ==========================
   A2C Finanzas 4.2
   Amigos y mensajes cifrados
   ========================== */
const a2c42={friends:[],conversations:[],activeConversation:null,realtime:null,realtimeUserId:null,loading:false};

async function a2c42LoadFriends(){
  const {data,error}=await sb.rpc('a2c_list_friends_v42');
  if(error)throw error;
  a2c42.friends=data||[];
  return a2c42.friends;
}
async function a2c42LoadConversations(){
  if(!state.user)return [];
  const {data,error}=await sb.rpc('a2c_list_conversations_v42');
  if(error)throw error;
  a2c42.conversations=(data||[]).sort((a,b)=>
    String(b.last_message_at||'').localeCompare(String(a.last_message_at||''))
  );
  return a2c42.conversations;
}
function a2c42PersonAvatar(profile){
  return avatarMarkup(profile,'small');
}
function a2c42FriendRequests(){
  return state.friendships.filter(row=>row.addressee_id===state.user.id&&row.status==='pending');
}
function a2c42FriendProfile(id){
  return state.socialProfiles.find(p=>p.id===id)||state.profiles.find(p=>p.id===id)||{};
}
async function openA2C42SocialHub(tab='friends'){
  try{await Promise.all([a2c42LoadFriends(),a2c42LoadConversations()]);}catch(error){return toast(error.message,true);}
  modal(`<div class="modal-head"><div><h2>Amigos y mensajes</h2><p class="muted">Busca por @usuario, comparte recursos y conversa de forma privada.</p></div><button class="close-btn" data-close>×</button></div>
    <nav class="a2c42-tabs">
      <button data-a2c42-tab="friends" class="${tab==='friends'?'active':''}">Amigos</button>
      <button data-a2c42-tab="messages" class="${tab==='messages'?'active':''}">Mensajes${a2c42.conversations.reduce((n,c)=>n+Number(c.unread_count||0),0)?` · ${a2c42.conversations.reduce((n,c)=>n+Number(c.unread_count||0),0)}`:''}</button>
    </nav>
    <section id="a2c42-panel"></section>
    <style>
      .a2c42-tabs{display:flex;gap:7px;margin-bottom:12px}.a2c42-tabs button{border:0;border-radius:999px;padding:9px 14px;background:#f0edf7}.a2c42-tabs button.active{background:#211a31;color:#fff}
      .a2c42-search{display:flex;gap:8px}.a2c42-search input{flex:1}.a2c42-list{display:grid;gap:8px;margin-top:12px}.a2c42-person,.a2c42-conversation{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #ebe7f1;border-radius:14px;background:#fff;text-align:left;width:100%}
      .a2c42-person>div,.a2c42-conversation>div{flex:1;min-width:0}.a2c42-person strong,.a2c42-person small,.a2c42-conversation strong,.a2c42-conversation small{display:block}.a2c42-person small,.a2c42-conversation small{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .a2c42-actions{display:flex;gap:6px}.a2c42-unread{min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#7557ff;color:#fff;display:grid;place-items:center;font-size:11px}
      .a2c42-chat{height:min(58vh,520px);display:flex;flex-direction:column}.a2c42-messages{flex:1;overflow:auto;display:flex;flex-direction:column;gap:7px;padding:8px;background:#f7f5fa;border-radius:14px}.a2c42-message{max-width:82%;padding:9px 11px;border-radius:14px 14px 14px 4px;background:#fff;border:1px solid #ebe7f1}.a2c42-message.mine{align-self:flex-end;background:#2d2540;color:#fff;border-color:#2d2540;border-radius:14px 14px 4px 14px}.a2c42-message p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.a2c42-message small{display:block;margin-top:4px;font-size:9px;opacity:.68}.a2c42-compose{display:flex;gap:7px;margin-top:8px}.a2c42-compose textarea{flex:1;min-height:44px;max-height:110px;resize:none}
    </style>`,true);
  const draw=async current=>{
    document.querySelectorAll('[data-a2c42-tab]').forEach(b=>b.classList.toggle('active',b.dataset.a2c42Tab===current));
    document.querySelector('#a2c42-panel').innerHTML=current==='friends'?a2c42FriendsMarkup():a2c42MessagesMarkup();
    a2c42Bind(current);
  };
  document.querySelectorAll('[data-a2c42-tab]').forEach(b=>b.onclick=()=>draw(b.dataset.a2c42Tab));
  await draw(tab);
}
function a2c42FriendsMarkup(){
  const requests=a2c42FriendRequests();
  return `<div class="a2c42-search"><input id="a2c42-user-query" placeholder="@usuario" autocomplete="off" autocapitalize="none"><button class="btn primary" id="a2c42-search-button">Buscar</button></div>
    <div id="a2c42-search-results" class="a2c42-list"></div>
    ${requests.length?`<div class="section-head"><div><h3>Solicitudes</h3></div></div><div class="a2c42-list">${requests.map(row=>{const p=a2c42FriendProfile(row.requester_id);return `<article class="a2c42-person">${a2c42PersonAvatar(p)}<div><strong>${esc(p.display_name||'Usuario')}</strong><small>@${esc(p.username||'usuario')}</small></div><div class="a2c42-actions"><button class="btn" data-a2c42-reject="${row.id}">Rechazar</button><button class="btn primary" data-a2c42-accept="${row.id}">Aceptar</button></div></article>`}).join('')}</div>`:''}
    <div class="section-head"><div><h3>Mis amigos</h3><p class="muted">${a2c42.friends.length} contactos</p></div></div>
    <div class="a2c42-list">${a2c42.friends.length?a2c42.friends.map(p=>`<article class="a2c42-person">${a2c42PersonAvatar(p)}<div><strong>${esc(p.display_name||'Usuario')}</strong><small>@${esc(p.username||'usuario')}</small></div><button class="btn" data-a2c42-message-friend="${p.id}">Mensaje</button></article>`).join(''):'<div class="empty compact">Busca un @usuario para añadir tu primer amigo.</div>'}</div>`;
}
function a2c42MessagesMarkup(){
  return `<div class="a2c42-list">${a2c42.conversations.length?a2c42.conversations.map(c=>`<button class="a2c42-conversation" data-a2c42-conversation="${c.conversation_id}" data-friend="${c.friend_id}">${a2c42PersonAvatar(c)}<div><strong>${esc(c.display_name||c.username||'Usuario')}</strong><small>${esc(c.last_message||'Sin mensajes todavía')}</small><small>${c.last_message_at?new Date(c.last_message_at).toLocaleString('es-ES'):''}</small></div>${Number(c.unread_count||0)>0?`<b class="a2c42-unread">${Number(c.unread_count)}</b>`:'<em>›</em>'}</button>`).join(''):'<div class="empty compact">Todavía no tienes conversaciones.</div>'}</div>`;
}
function a2c42Bind(tab){
  if(tab==='friends'){
    const search=async()=>{
      const q=String(document.querySelector('#a2c42-user-query')?.value||'').trim();
      if(!q)return toast('Escribe un @usuario.',true);
      const {data,error}=await sb.rpc('a2c_search_users_by_username_v42',{p_query:q});
      if(error)return toast(error.message,true);
      const box=document.querySelector('#a2c42-search-results');
      box.innerHTML=(data||[]).map(p=>{
        let action='';
        if(p.friendship_status==='accepted')action='<span class="status-chip">Amigo</span>';
        else if(p.friendship_status==='pending'&&p.friendship_direction==='outgoing')action='<span class="status-chip">Pendiente</span>';
        else if(p.friendship_status==='pending'&&p.friendship_direction==='incoming')action=`<button class="btn primary" data-a2c42-accept="${p.friendship_id}">Aceptar</button>`;
        else action=`<button class="btn primary" data-a2c42-add="${p.id}">Añadir</button>`;
        return `<article class="a2c42-person">${a2c42PersonAvatar(p)}<div><strong>${esc(p.display_name||'Usuario')}</strong><small>@${esc(p.username)}</small></div>${action}</article>`;
      }).join('')||'<div class="empty compact">No se ha encontrado ese usuario.</div>';
      a2c42BindFriendActions();
    };
    document.querySelector('#a2c42-search-button').onclick=search;
    document.querySelector('#a2c42-user-query').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();search()}};
    a2c42BindFriendActions();
  }
  if(tab==='messages'){
    document.querySelectorAll('[data-a2c42-conversation]').forEach(b=>b.onclick=()=>openA2C42Conversation(b.dataset.a2c42Conversation,b.dataset.friend));
  }
}
function a2c42BindFriendActions(){
  document.querySelectorAll('[data-a2c42-add]').forEach(b=>b.onclick=async()=>{const{data,error}=await sb.rpc('a2c_send_friend_request_v42',{p_user_id:b.dataset.a2c42Add});if(error)return toast(error.message,true);await refresh();await openA2C42SocialHub('friends');toast(data==='accepted'?'Ya sois amigos.':'Solicitud enviada.');});
  document.querySelectorAll('[data-a2c42-accept]').forEach(b=>b.onclick=async()=>{const{error}=await sb.rpc('a2c_respond_friend_request_v42',{p_friendship_id:b.dataset.a2c42Accept,p_accept:true});if(error)return toast(error.message,true);await refresh();await openA2C42SocialHub('friends');toast('Solicitud aceptada.');});
  document.querySelectorAll('[data-a2c42-reject]').forEach(b=>b.onclick=async()=>{const{error}=await sb.rpc('a2c_respond_friend_request_v42',{p_friendship_id:b.dataset.a2c42Reject,p_accept:false});if(error)return toast(error.message,true);await refresh();await openA2C42SocialHub('friends');});
  document.querySelectorAll('[data-a2c42-message-friend]').forEach(b=>b.onclick=async()=>{const{data,error}=await sb.rpc('a2c_get_or_create_conversation_v42',{p_friend_id:b.dataset.a2c42MessageFriend});if(error)return toast(error.message,true);openA2C42Conversation(data,b.dataset.a2c42MessageFriend);});
}
async function openA2C42Conversation(conversationId,friendId){
  const friend=a2c42.friends.find(p=>String(p.id)===String(friendId))||a2c42.conversations.find(c=>String(c.friend_id)===String(friendId))||{};
  const {data,error}=await sb.rpc('a2c_list_messages_v42',{p_conversation_id:conversationId,p_limit:200});
  if(error)return toast(error.message,true);
  a2c42.activeConversation=conversationId;
  modal(`<div class="modal-head"><div><h2>${esc(friend.display_name||friend.username||'Conversación')}</h2><p class="muted">@${esc(friend.username||'usuario')} · mensajes cifrados en el servidor</p></div><button class="close-btn" data-close>×</button></div>
    <section class="a2c42-chat"><div class="a2c42-messages" id="a2c42-message-list">${(data||[]).map(m=>`<article class="a2c42-message ${m.mine?'mine':''}"><p>${esc(m.body)}</p><small>${new Date(m.created_at).toLocaleString('es-ES')}</small></article>`).join('')||'<div class="empty compact">Escribe el primer mensaje.</div>'}</div>
      <form class="a2c42-compose" id="a2c42-compose"><textarea name="body" maxlength="4000" required placeholder="Escribe un mensaje…"></textarea><button class="btn primary">Enviar</button></form></section>`,true);
  const list=document.querySelector('#a2c42-message-list');list.scrollTop=list.scrollHeight;
  document.querySelector('#a2c42-compose').onsubmit=async e=>{e.preventDefault();const b=e.submitter,body=String(new FormData(e.currentTarget).get('body')||'').trim();if(!body)return;busy(b,true);const{error}=await sb.rpc('a2c_send_message_v42',{p_friend_id:friendId,p_body:body});busy(b,false);if(error)return toast(error.message,true);openA2C42Conversation(conversationId,friendId);};
}
async function openInvite(r){
  try{await a2c42LoadFriends();}catch(error){return toast(error.message,true);}
  closeModal();modal(`<div class="modal-head"><div><h2>Invitar a ${esc(r.name)}</h2><p class="muted">Solo puedes añadir amigos aceptados.</p></div><button class="close-btn" data-close>×</button></div><div class="a2c42-list">${a2c42.friends.length?a2c42.friends.map(p=>`<article class="a2c42-person">${a2c42PersonAvatar(p)}<div><strong>${esc(p.display_name||'Usuario')}</strong><small>@${esc(p.username||'usuario')}</small></div><button class="btn primary" data-invite-friend="${p.id}">Invitar</button></article>`).join(''):'<div class="empty compact">Añade amigos antes de compartir este elemento.</div>'}</div>`,true);
  document.querySelectorAll('[data-invite-friend]').forEach(b=>b.onclick=async()=>{busy(b,true);const{data,error}=await sb.rpc('a2c_invite_resource_friend_v42',{p_resource_id:r.id,p_friend_id:b.dataset.inviteFriend});busy(b,false);if(error)return toast(error.message,true);closeModal();await refresh();toast(data==='already_member'?'Ya forma parte del elemento.':data==='already_pending'?'Ya tiene una invitación pendiente.':'Invitación enviada.');});
}

async function a2c42RefreshMessagesView(){
  if(a2c42.loading||!state.user)return;
  a2c42.loading=true;
  try{
    await Promise.all([a2c42LoadFriends(),a2c42LoadConversations()]);
    if(state.tab==='messages'){
      renderShell();
    }
  }catch(error){
    console.warn('No se pudieron actualizar las conversaciones:',error);
  }finally{
    a2c42.loading=false;
  }
}

function a2c42StartRealtime(){
  if(!state.user)return;
  if(a2c42.realtime&&a2c42.realtimeUserId===state.user.id)return;
  if(a2c42.realtime){
    sb.removeChannel(a2c42.realtime).catch(()=>{});
    a2c42.realtime=null;
  }
  a2c42.realtimeUserId=state.user.id;
  a2c42.realtime=sb.channel(`a2c42-user-${state.user.id}`)
    .on('postgres_changes',{
      event:'INSERT',
      schema:'public',
      table:'notifications',
      filter:`user_id=eq.${state.user.id}`
    },payload=>{
      const row=payload.new||{};
      if(row.type==='direct_message'||row.type==='friend_request'||/expense|split|shared/i.test(String(row.type||''))){
        a2c42RefreshMessagesView();
        if(row.type==='direct_message'){
          window.A2CNative?.showMessageNotification?.(
            String(row.title||'Nuevo mensaje'),
            String(row.message||'Tienes un mensaje nuevo.'),
            String(row.related_id||'')
          );
        }
      }
    })
    .on('postgres_changes',{
      event:'INSERT',
      schema:'public',
      table:'direct_messages'
    },()=>a2c42RefreshMessagesView())
    .subscribe();
}


const a2c42OldNotificationDestination=openNotificationDestination;
openNotificationDestination=async function(notification){
  if(notification.type==='direct_message'){
    try{
      await deleteNotification(notification.id);
      await Promise.all([a2c42LoadFriends(),a2c42LoadConversations()]);
      const c=a2c42.conversations.find(row=>String(row.conversation_id)===String(notification.related_id));
      closeModal();
      if(c)return openA2C42Conversation(c.conversation_id,c.friend_id);
      return openA2C42SocialHub('messages');
    }catch(error){return toast(error.message,true);}
  }
  if(notification.type==='friend_request'){
    await deleteNotification(notification.id).catch(()=>{});
    closeModal();await refresh(false);return openA2C42SocialHub('friends');
  }
  return a2c42OldNotificationDestination(notification);
};

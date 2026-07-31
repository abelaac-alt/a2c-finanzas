(function(){
  'use strict';
  const A=window.A2C;
  const pages=new Map();const afterRender=new Map();const actions=new Map();let delegated=false;
  A.ui={
    registerPage(name,renderer,binder=null){pages.set(name,renderer);if(binder)afterRender.set(name,binder);},
    action(name,handler){actions.set(name,handler);},
    installDelegation(){
      if(delegated)return;delegated=true;
      document.addEventListener('click',async event=>{
        const close=event.target.closest('[data-close]');if(close){event.preventDefault();A.closeModal();return;}
        const nav=event.target.closest('[data-nav]');if(nav){event.preventDefault();await A.navigate(nav.dataset.nav);return;}
        const node=event.target.closest('[data-action]');if(!node)return;
        const handler=actions.get(node.dataset.action);if(!handler)return;
        event.preventDefault();
        if(node.dataset.actionRunning==='1')return;
        node.dataset.actionRunning='1';
        try{await handler({event,node,data:node.dataset});}
        catch(error){console.error(error);A.toast(error.message||'No se pudo completar la acción.',true);}
        finally{delete node.dataset.actionRunning;}
      });
    },
    render({preserveScroll=false}={}){
      if(!A.state.user){A.auth.render();return;}
      const scrollY=preserveScroll?window.scrollY:0;
      const renderer=pages.get(A.state.page)||pages.get('home');
      const unread=A.state.notifications.filter(row=>!row.read_at).length;
      const profile=A.state.profile||{};
      A.root.innerHTML=`<div class="app-shell">
        <header class="topbar">
          <button class="topbar-brand" data-nav="home" aria-label="Ir al inicio">${A.brandMark(38)}<span><strong>A2C Finanzas</strong><small>${A.escape(profile.display_name||profile.username||profile.email||'Tu espacio financiero')}</small></span></button>
          <button class="icon-button" data-action="open-notifications" aria-label="Notificaciones">${A.icon('bell',21)}${unread?`<span class="notification-dot">${unread>9?'9+':unread}</span>`:''}</button>
        </header>
        <main class="page" id="page-content">${renderer?renderer():''}</main>
        ${A.state.page==='activity'?`<button class="fab" data-action="new-transaction" aria-label="Añadir movimiento">${A.icon('plus',25)}</button>`:''}
        <nav class="bottom-nav" aria-label="Navegación principal">
          ${A.ui.nav('home','home','Inicio')}${A.ui.nav('tools','tools','Herramientas')}${A.ui.nav('messages','messages','Mensajes')}${A.ui.nav('activity','activity','Actividad')}${A.ui.nav('profile','profile','Perfil')}
        </nav>
      </div>`;
      if(preserveScroll)window.scrollTo({top:scrollY,behavior:'auto'});
      requestAnimationFrame(()=>afterRender.get(A.state.page)?.());
    },
    nav(page,icon,label){return `<button class="nav-button ${A.state.page===page?'active':''}" data-nav="${page}" aria-current="${A.state.page===page?'page':'false'}">${A.icon(icon,22)}<small>${label}</small></button>`;},
    header(eyebrow,title,subtitle,action=''){return `<div class="page-header"><div><span class="eyebrow">${A.escape(eyebrow)}</span><h1>${A.escape(title)}</h1><p>${A.escape(subtitle)}</p></div>${action}</div>`;},
    empty(title,text=''){return `<div class="empty-state">${A.icon('other',30)}<strong>${A.escape(title)}</strong>${text?`<small>${A.escape(text)}</small>`:''}</div>`;},
    modal(content,{wide=false,className=''}={}){
      A.modalRoot.innerHTML=`<div class="modal-backdrop"><section class="modal-card ${wide?'wide':''} ${A.escape(className)}">${content}</section></div>`;
      A.modalRoot.querySelector('.modal-backdrop')?.addEventListener('click',event=>{if(event.target===event.currentTarget)A.closeModal();},{once:true});
    },
    confirm({title='Confirmar',message,confirmLabel='Confirmar',danger=false,onConfirm}){
      A.ui.modal(`<div class="modal-head"><div><h2>${A.escape(title)}</h2><p>${A.escape(message||'')}</p></div><button class="modal-close" data-close>${A.icon('close',21)}</button></div><div class="actions"><button class="btn secondary" data-close>Cancelar</button><button class="btn ${danger?'danger':'primary'}" id="confirm-action">${A.escape(confirmLabel)}</button></div>`);
      A.modalRoot.querySelector('#confirm-action').addEventListener('click',async event=>{A.setBusy(event.currentTarget,true);try{await onConfirm?.();A.closeModal();}catch(error){A.toast(error.message,true);A.setBusy(event.currentTarget,false);}});
    },
    sectionTitle(title,subtitle='',action=''){return `<div class="section-title"><div><h2>${A.escape(title)}</h2>${subtitle?`<p>${A.escape(subtitle)}</p>`:''}</div>${action}</div>`;}
  };
  A.modal=(content,wide=false)=>A.ui.modal(content,{wide});
  A.closeModal=()=>{
    A.modalRoot.innerHTML='';
    if(A.messages?.chatTimer){clearInterval(A.messages.chatTimer);A.messages.chatTimer=null;}
    if(A.messages){A.messages.activeConversation=null;A.messages.activeFriend=null;}
  };
  A.ui.installDelegation();
})();

(function(){
  'use strict';
  const A=window.A2C;
  const pages={};
  A.ui={
    registerPage(name,renderer){pages[name]=renderer;},
    render(){
      if(!A.state.user){A.auth.render();return;}
      const renderer=pages[A.state.page]||pages.home;
      const unread=A.state.notifications.filter(row=>!row.read_at).length;
      const profile=A.state.profile||{};
      A.root.innerHTML=`<div class="app-shell">
        <header class="topbar">
          <div class="topbar-brand"><img src="./logo-a2c.png" alt=""><div><strong>A2C Finanzas</strong><small>${A.escape(profile.display_name||profile.username||profile.email||'Tu espacio financiero')}</small></div></div>
          <button class="icon-button" id="notification-button" aria-label="Notificaciones">🔔${unread?`<span class="badge danger">${unread}</span>`:''}</button>
        </header>
        <section class="page" id="page-content">${renderer?renderer():''}</section>
        ${A.state.page==='activity'?'<button class="fab" id="fab-add" aria-label="Añadir movimiento">＋</button>':''}
        <nav class="bottom-nav">
          ${A.ui.nav('home','⌂','Inicio')}${A.ui.nav('tools','▦','Herramientas')}${A.ui.nav('messages','●','Mensajes')}${A.ui.nav('activity','↕','Actividad')}${A.ui.nav('profile','○','Perfil')}
        </nav>
      </div>`;
      A.root.querySelectorAll('[data-nav]').forEach(button=>button.addEventListener('click',()=>A.navigate(button.dataset.nav)));
      A.root.querySelector('#notification-button')?.addEventListener('click',A.profile.openNotifications);
      A.root.querySelector('#fab-add')?.addEventListener('click',()=>A.transactions.openForm());
      A.ui.bindPage();
    },
    nav(page,icon,label){return `<button class="nav-button ${A.state.page===page?'active':''}" data-nav="${page}"><span>${icon}</span><small>${label}</small></button>`;},
    bindPage(){
      const modules=[A.dashboard,A.transactions,A.resources,A.budgets,A.messages,A.profile];
      modules.forEach(module=>module?.bind?.());
    },
    header(eyebrow,title,subtitle,action=''){return `<div class="page-header"><div><span class="eyebrow">${A.escape(eyebrow)}</span><h1>${A.escape(title)}</h1><p class="muted">${A.escape(subtitle)}</p></div>${action}</div>`;},
    empty(text){return `<div class="empty">${A.escape(text)}</div>`;},
    confirm({title='Confirmar',message,confirmLabel='Confirmar',danger=false,onConfirm}){
      A.modal(`<div class="modal-head"><div><h2>${A.escape(title)}</h2><p>${A.escape(message||'')}</p></div><button class="modal-close" data-close>×</button></div><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn ${danger?'danger':'primary'}" id="confirm-action">${A.escape(confirmLabel)}</button></div>`);
      A.modalRoot.querySelector('#confirm-action').addEventListener('click',async event=>{A.setBusy(event.currentTarget,true);try{await onConfirm?.();A.closeModal();}catch(error){A.toast(error.message,true);A.setBusy(event.currentTarget,false);}});
    },
    avatar(profile){return A.avatar(profile);}
  };
})();

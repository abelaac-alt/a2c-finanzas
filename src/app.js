(function(){
  'use strict';
  const A=window.A2C;
  async function start(){
    try{
      await A.auth.start();
      if(A.state.user){
        await A.messages.load({force:true});
        if(A.state.page==='messages')A.ui.render({preserveScroll:true});
      }
      window.__A2C_BOOT_STATUS='ready';window.dispatchEvent(new CustomEvent('a2c:ready'));
      if(A.platform==='web'&&'serviceWorker' in navigator){
        navigator.serviceWorker.register('./sw.js?v=820').catch(error=>console.warn('Service worker no disponible:',error));
      }
      const destination=new URLSearchParams(location.search).get('destination');if(destination&&window.a2cAndroidOpenDestination)window.a2cAndroidOpenDestination(destination);
      document.addEventListener('visibilitychange',async()=>{
        if(document.hidden||!A.state.user||A.modalRoot.childElementCount)return;
        if(Date.now()-A.state.lastLoadedAt>60000){await A.store.load({force:true});A.ui.render({preserveScroll:true});}
      });
      window.addEventListener('pageshow',async event=>{if(event.persisted&&A.state.user&&!A.modalRoot.childElementCount){await A.store.load({force:true});A.ui.render({preserveScroll:true});}});
    }catch(error){
      console.error(error);A.root.innerHTML=`<section class="auth-page"><div class="auth-card"><div class="auth-brand">${A.brandMark(64)}<div><h1>No se pudo iniciar</h1><p>${A.escape(error.message||'Error inesperado')}</p></div></div><button class="btn primary full" onclick="location.reload()">Reintentar</button></div></section>`;
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

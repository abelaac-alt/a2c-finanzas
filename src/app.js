(function(){
  'use strict';
  const A=window.A2C;
  async function start(){
    try{
      await A.auth.start();
      if(A.state.user){await A.messages.load(true);A.ui.render();}
      window.__A2C_BOOT_STATUS='ready';window.dispatchEvent(new CustomEvent('a2c:ready'));
      const destination=new URLSearchParams(location.search).get('destination');if(destination&&window.a2cAndroidOpenDestination)window.a2cAndroidOpenDestination(destination);
      setInterval(()=>{if(A.state.user&&A.state.page==='messages'&&!document.hidden)A.messages.load();},12000);
      document.addEventListener('visibilitychange',()=>{if(!document.hidden&&A.state.user)A.refresh();});
    }catch(error){
      console.error(error);A.root.innerHTML=`<section class="auth-page"><div class="auth-card"><div class="brand"><img src="./logo-a2c.png" alt=""><div><h1>No se pudo iniciar</h1><p>${A.escape(error.message||'Error inesperado')}</p></div></div><button class="btn primary full" onclick="location.reload()">Reintentar</button></div></section>`;
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

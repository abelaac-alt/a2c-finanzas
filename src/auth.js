(function(){
  'use strict';
  const A=window.A2C;
  A.auth={
    render(){
      A.root.innerHTML=`<section class="auth-page"><form class="auth-card" id="login-form">
        <div class="auth-brand">${A.brandMark(68)}<div><h1>A2C Finanzas</h1><p>Control financiero profesional</p></div></div>
        <div class="field"><label>Email o @usuario</label><input name="identifier" autocomplete="username" required placeholder="correo@ejemplo.com o @usuario"></div>
        <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" minlength="6" required></div>
        <label class="check-row"><input name="remember" type="checkbox"><span><b>Recordar acceso</b><small>Mantiene la sesión en este dispositivo.</small></span></label>
        <button class="btn primary full">Entrar</button>
      </form></section>`;
      const form=A.root.querySelector('#login-form');const remembered=localStorage.getItem('a2c_identifier')||'';
      if(remembered){form.elements.identifier.value=remembered;form.elements.remember.checked=true;}
      form.addEventListener('submit',A.auth.login);
    },
    async login(event){
      event.preventDefault();const form=event.currentTarget;const button=event.submitter;
      const identifier=String(form.elements.identifier.value||'').trim().toLowerCase();const password=String(form.elements.password.value||'');
      A.setBusy(button,true,'Entrando…');
      try{
        let session=null;
        if(identifier.includes('@')&&!identifier.startsWith('@')){
          const result=await A.sb.auth.signInWithPassword({email:identifier,password});if(result.error)throw result.error;session=result.data.session;
        }else{
          const result=await A.sb.functions.invoke('secure-login',{body:{identifier,password}});if(result.error||!result.data?.session)throw new Error('Usuario o contraseña incorrectos.');
          const set=await A.sb.auth.setSession({access_token:result.data.session.access_token,refresh_token:result.data.session.refresh_token});if(set.error)throw set.error;session=set.data.session;
        }
        if(!session)throw new Error('No se pudo crear la sesión.');
        if(form.elements.remember.checked)localStorage.setItem('a2c_identifier',identifier);else localStorage.removeItem('a2c_identifier');
        window.A2CNative?.saveAuthSession?.(session.access_token,session.refresh_token,session.user.id);
      }catch(error){A.toast(error.message||'No se pudo iniciar sesión.',true);A.setBusy(button,false);}
    },
    async start(){
      const session=await A.requireAuth();if(!session){A.state.user=null;A.auth.render();return;}
      A.state.user=session.user;await A.store.load({force:true});
      const hash=location.hash.replace('#','');A.state.page=['home','tools','messages','activity','profile'].includes(hash)?hash:'home';
      A.ui.render();
    },
    async signOut(){await A.sb.auth.signOut();window.A2CNative?.clearAuthSession?.();A.state.user=null;A.state.profile=null;A.auth.render();}
  };
  A.sb.auth.onAuthStateChange(async(event,session)=>{
    if(session?.access_token&&session?.refresh_token)window.A2CNative?.saveAuthSession?.(session.access_token,session.refresh_token,session.user.id);
    if(event==='SIGNED_IN'&&session&&!A.state.user){A.state.user=session.user;await A.store.load({force:true});A.ui.render();}
    if(event==='SIGNED_OUT'){A.state.user=null;A.auth.render();}
  });
})();

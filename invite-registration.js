import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg=window.A2C_CONFIG||{};
if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY) throw new Error('Falta la configuración pública de Supabase.');
const client=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

const safeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const normalizeUsername=value=>String(value||'').trim().toLowerCase().replace(/^@/,'');
const normalizeCode=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
const showToast=(message,bad=false)=>{const el=document.querySelector('#toast');if(!el)return;el.textContent=message;el.classList.toggle('bad',bad);el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),3200)};

function registrationForm(){
  return `<form class="auth-card" id="registration-form" novalidate>
    <div class="brand"><img class="brand-logo brand-logo-login" src="./logo-a2c.png" alt="Logotipo de A2C Finanzas"><div><h1>Crear cuenta</h1><p class="muted">Registro mediante invitación</p></div></div>
    <div class="auth-mode-switch"><button type="button" data-auth-mode="login">Entrar</button><button type="button" class="active" data-auth-mode="register">Registrarse</button></div>
    <p class="register-help">Necesitas un código generado por otro usuario de A2C. El código es de un solo uso y caduca en 10 minutos.</p>
    <div class="field"><label>Correo electrónico</label><input name="email" type="email" autocomplete="email" maxlength="254" autocapitalize="none" spellcheck="false" required placeholder="correo@ejemplo.com"></div>
    <div class="field"><label>Nombre de usuario</label><div class="input-prefix"><span>@</span><input name="username" type="text" autocomplete="username" minlength="3" maxlength="30" pattern="[a-z0-9._]+" autocapitalize="none" spellcheck="false" required placeholder="abel.atero"></div><small class="muted">Minúsculas, números, punto y guion bajo.</small></div>
    <div class="field"><label>Nombre visible</label><input name="display_name" type="text" autocomplete="name" minlength="2" maxlength="80" required placeholder="Tu nombre"></div>
    <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div>
    <p class="register-help">Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo.</p>
    <div class="field invite-code-field"><label>Código de invitación</label><input name="invite_code" type="text" inputmode="text" autocomplete="one-time-code" minlength="8" maxlength="8" required placeholder="AB12CD34"></div>
    <button class="btn primary full">Crear cuenta</button>
  </form>`;
}

function addLoginSwitch(form){
  if(form.querySelector('.auth-mode-switch'))return;
  const brand=form.querySelector('.brand');
  brand?.insertAdjacentHTML('afterend','<div class="auth-mode-switch"><button type="button" class="active" data-auth-mode="login">Entrar</button><button type="button" data-auth-mode="register">Registrarse</button></div>');
}

function showRegister(){document.querySelector('#app').innerHTML=`<section class="auth-shell">${registrationForm()}</section>`;bindRegistration();}
function showLogin(){location.reload();}

function bindModeButtons(root=document){
  root.querySelectorAll('[data-auth-mode="register"]').forEach(button=>button.onclick=showRegister);
  root.querySelectorAll('[data-auth-mode="login"]').forEach(button=>button.onclick=showLogin);
}

function bindRegistration(){
  bindModeButtons();
  const form=document.querySelector('#registration-form');
  if(!form)return;
  const username=form.elements.username,code=form.elements.invite_code;
  username.addEventListener('input',()=>{username.value=normalizeUsername(username.value)});
  code.addEventListener('input',()=>{code.value=normalizeCode(code.value)});
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=event.submitter;
    const payload={
      email:String(form.elements.email.value||'').trim().toLowerCase(),
      username:normalizeUsername(username.value),
      display_name:String(form.elements.display_name.value||'').trim(),
      password:String(form.elements.password.value||''),
      invite_code:normalizeCode(code.value)
    };
    button.disabled=true;button.dataset.label??=button.textContent;button.textContent='Creando cuenta…';
    try{
      const {data,error}=await client.functions.invoke('register-with-invite',{body:payload});
      if(error||!data?.ok)throw new Error(data?.error||'No se pudo completar el registro.');
      document.querySelector('#app').innerHTML=`<section class="auth-shell"><div class="auth-card"><div class="brand"><img class="brand-logo brand-logo-login" src="./logo-a2c.png" alt="A2C Finanzas"><div><h1>Cuenta creada</h1><p class="muted">Ya puedes entrar en A2C Finanzas</p></div></div><div class="registration-success">El registro se ha completado correctamente para <strong>@${safeText(payload.username)}</strong>.</div><button class="btn primary full" id="go-login">Ir al inicio de sesión</button></div></section>`;
      document.querySelector('#go-login').onclick=showLogin;
    }catch(error){showToast(error.message||'No se pudo completar el registro.',true);button.disabled=false;button.textContent=button.dataset.label;}
  };
}

async function generateInvite(){
  const {data,error}=await client.functions.invoke('create-registration-invite',{body:{}});
  if(error||!data?.ok)throw new Error(data?.error||'No se pudo generar el código.');
  openInviteModal(data.code,data.expires_at);
}

function openInviteModal(code,expiresAt){
  document.querySelector('#invite-modal-layer')?.remove();
  document.body.insertAdjacentHTML('beforeend',`<div class="invite-modal-layer" id="invite-modal-layer" role="dialog" aria-modal="true"><div class="invite-modal-card"><div class="invite-modal-head"><div><h2>Código de invitación</h2><p>Compártelo únicamente con la persona que quieras invitar.</p></div><button class="invite-close" id="invite-modal-close" aria-label="Cerrar">×</button></div><div class="invite-code-display"><strong>${safeText(code)}</strong><small id="invite-countdown">Válido durante 10:00</small></div><div class="invite-modal-actions"><button class="btn primary" id="copy-invite-code">Copiar código</button><button class="btn" id="new-invite-code">Generar otro</button></div></div></div>`);
  const layer=document.querySelector('#invite-modal-layer');
  const close=()=>{clearInterval(layer._timer);layer.remove()};
  document.querySelector('#invite-modal-close').onclick=close;
  layer.onclick=event=>{if(event.target===layer)close()};
  document.querySelector('#copy-invite-code').onclick=async()=>{await navigator.clipboard.writeText(code);showToast('Código copiado')};
  document.querySelector('#new-invite-code').onclick=async event=>{event.currentTarget.disabled=true;try{close();await generateInvite()}catch(error){showToast(error.message,true)}};
  const update=()=>{const seconds=Math.max(0,Math.ceil((new Date(expiresAt).getTime()-Date.now())/1000));const min=String(Math.floor(seconds/60)).padStart(2,'0'),sec=String(seconds%60).padStart(2,'0');const el=document.querySelector('#invite-countdown');if(el)el.textContent=seconds?`Válido durante ${min}:${sec}`:'Código caducado';if(!seconds)clearInterval(layer._timer)};
  update();layer._timer=setInterval(update,1000);
}

function addInviteButton(){
  const topActions=document.querySelector('.top-actions');
  if(!topActions||document.querySelector('#generate-invite-code'))return;
  topActions.insertAdjacentHTML('afterbegin',`<button class="icon-btn invite-top-button" id="generate-invite-code" aria-label="Generar código de invitación" title="Invitar usuario"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><path d="M3 20c0-4 2.5-7 6-7s6 3 6 7M18 7v6M15 10h6"></path></svg></button>`);
  document.querySelector('#generate-invite-code').onclick=async event=>{event.currentTarget.disabled=true;try{await generateInvite()}catch(error){showToast(error.message,true)}finally{event.currentTarget.disabled=false}};
}

const observer=new MutationObserver(()=>{
  const login=document.querySelector('#login-form');if(login){addLoginSwitch(login);bindModeButtons(login)}
  addInviteButton();
});
observer.observe(document.documentElement,{childList:true,subtree:true});

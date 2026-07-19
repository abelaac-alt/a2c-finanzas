import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg=window.A2C_CONFIG||{};
if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY) throw new Error('Falta la configuración pública de Supabase.');
const client=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

const safeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const normalizeUsername=value=>String(value||'').trim().toLowerCase().replace(/^@/,'');
const normalizeCode=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
const showToast=(message,bad=false)=>{const el=document.querySelector('#toast');if(!el)return;el.textContent=message;el.classList.toggle('bad',bad);el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),3600)};

function authHeader(title,subtitle,active='login'){
  return `<div class="auth-brand">
    <div class="auth-logo-wrap"><img class="brand-logo brand-logo-login" src="./logo-a2c.png" alt="Logotipo de A2C Finanzas"></div>
    <div class="auth-brand-copy"><span class="auth-eyebrow">A2C Finanzas</span><h1>${title}</h1><p>${subtitle}</p></div>
  </div>
  <div class="auth-mode-switch" role="tablist" aria-label="Acceso a A2C Finanzas">
    <button type="button" class="${active==='login'?'active':''}" data-auth-mode="login" role="tab" aria-selected="${active==='login'}">Iniciar sesión</button>
    <button type="button" class="${active==='register'?'active':''}" data-auth-mode="register" role="tab" aria-selected="${active==='register'}">Crear cuenta</button>
  </div>`;
}

function registrationForm(){
  return `<form class="auth-card auth-card-register" id="registration-form" novalidate>
    ${authHeader('Crear cuenta','Registro seguro mediante invitación','register')}
    <div class="auth-notice"><strong>Necesitas una invitación</strong><span>El código es de un solo uso y caduca en 10 minutos.</span></div>
    <div class="field"><label>Correo electrónico</label><input name="email" type="email" autocomplete="email" maxlength="254" autocapitalize="none" spellcheck="false" required placeholder="correo@ejemplo.com"></div>
    <div class="field"><label>Nombre de usuario</label><div class="input-prefix"><span>@</span><input name="username" type="text" autocomplete="username" minlength="3" maxlength="30" pattern="[a-z0-9._]+" autocapitalize="none" spellcheck="false" required placeholder="usuario"></div><small class="field-help">Minúsculas, números, punto y guion bajo.</small></div>
    <div class="field"><label>Nombre visible</label><input name="display_name" type="text" autocomplete="name" minlength="2" maxlength="80" required placeholder="Tu nombre"></div>
    <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required placeholder="Mínimo 12 caracteres"></div>
    <small class="field-help password-help">Incluye mayúscula, minúscula, número y símbolo.</small>
    <div class="field invite-code-field"><label>Código de invitación</label><input name="invite_code" type="text" inputmode="text" autocomplete="one-time-code" minlength="8" maxlength="8" required placeholder="AB12CD34"></div>
    <button class="btn primary full auth-submit">Crear cuenta</button>
    <p class="auth-security">Tus datos se envían mediante una conexión segura.</p>
  </form>`;
}

function improveLogin(form){
  if(!form||form.dataset.authEnhanced==='true')return;
  form.dataset.authEnhanced='true';
  form.classList.add('auth-card-login');
  const oldBrand=form.querySelector('.brand');
  if(oldBrand)oldBrand.outerHTML=authHeader('Bienvenido','Accede a tu espacio financiero','login');
  else form.insertAdjacentHTML('afterbegin',authHeader('Bienvenido','Accede a tu espacio financiero','login'));

  const submit=form.querySelector('button[type="submit"],button:not([type])');
  if(submit){
    submit.classList.add('auth-submit');
    submit.textContent='Iniciar sesión';
  }
  if(!form.querySelector('.auth-register-prompt')){
    form.insertAdjacentHTML('beforeend',`<div class="auth-register-prompt">
      <span>¿Todavía no tienes cuenta?</span>
      <button type="button" data-auth-mode="register">Registrarme ahora</button>
    </div>
    <p class="auth-security">Acceso protegido y cifrado.</p>`);
  }
  bindModeButtons(form);
}

function showRegister(){
  const app=document.querySelector('#app');
  if(!app)return;
  app.innerHTML=`<section class="auth-shell auth-shell-scroll">${registrationForm()}</section>`;
  document.documentElement.classList.add('auth-page-open');
  bindRegistration();
  requestAnimationFrame(()=>document.querySelector('.auth-shell')?.scrollTo({top:0}));
}

function showLogin(){
  document.documentElement.classList.remove('auth-page-open');
  location.reload();
}

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
    const button=event.submitter||form.querySelector('.auth-submit');
    const payload={
      email:String(form.elements.email.value||'').trim().toLowerCase(),
      username:normalizeUsername(username.value),
      display_name:String(form.elements.display_name.value||'').trim(),
      password:String(form.elements.password.value||''),
      invite_code:normalizeCode(code.value)
    };
    if(!form.reportValidity())return;
    button.disabled=true;button.dataset.label??=button.textContent;button.textContent='Creando cuenta…';
    try{
      const {data,error}=await client.functions.invoke('register-with-invite',{body:payload});
      if(error){
        let message=data?.error||'No se pudo completar el registro.';
        try{
          const response=error.context;
          if(response instanceof Response){
            const parsed=await response.clone().json();
            if(parsed?.error)message=parsed.error;
          }
        }catch{}
        throw new Error(message);
      }
      if(!data?.ok)throw new Error(data?.error||'No se pudo completar el registro.');
      document.querySelector('#app').innerHTML=`<section class="auth-shell auth-shell-scroll"><div class="auth-card auth-success-card">${authHeader('Cuenta creada','El registro se completó correctamente','register')}<div class="registration-success">Ya puedes iniciar sesión como <strong>@${safeText(payload.username)}</strong>.</div><button class="btn primary full auth-submit" id="go-login">Ir al inicio de sesión</button></div></section>`;
      document.querySelector('#go-login').onclick=showLogin;
    }catch(error){
      showToast(error.message||'No se pudo completar el registro.',true);
      button.disabled=false;button.textContent=button.dataset.label;
    }
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

function enhanceCurrentScreen(){
  const login=document.querySelector('#login-form');
  if(login)improveLogin(login);
  addInviteButton();
}

const observer=new MutationObserver(enhanceCurrentScreen);
observer.observe(document.documentElement,{childList:true,subtree:true});
enhanceCurrentScreen();
window.addEventListener('DOMContentLoaded',enhanceCurrentScreen);
window.addEventListener('load',enhanceCurrentScreen);
setTimeout(enhanceCurrentScreen,100);
setTimeout(enhanceCurrentScreen,500);

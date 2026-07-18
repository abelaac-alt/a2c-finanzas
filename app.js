let deferredInstallPrompt=null;
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.error));
}
window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  document.querySelector("#install-app")?.classList.remove("hidden");
});
window.addEventListener("appinstalled",()=>{
  deferredInstallPrompt=null;
  document.querySelector("#install-app")?.classList.add("hidden");
});


import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.A2C_CONFIG || {};
const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const sb = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

const state = {
  user: null, profile: null, tab: 'home', socialSection: 'feed',
  profiles: [], resources: [], members: [], invitations: [],
  transactions: [], notifications: [],
  recurring: [], cryptoHoldings: [], cryptoLedger: [],
  socialPosts: [], friendships: [], follows: [], socialProfiles: [],
  expenseSplits: [], leaderboard: [],
  filters: { query:'', kind:'', resourceId:'', resourceType:'', from:'', to:'' }
};

const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format((Number(v)||0)/100);
const cents = v => { let t=String(v??'0').trim().replace(/\s|€/g,''); if(t.includes(','))t=t.replace(/\./g,'').replace(',','.'); const n=Number(t); return Number.isFinite(n)?Math.round(n*100):0; };

async function compressReceipt(file){
  if(!(file instanceof File)||!file.size||!String(file.type||'').startsWith('image/'))return file;
  try{
    const bitmap=await createImageBitmap(file);
    const maxSide=1600;
    const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
    bitmap.close?.();
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('No se pudo comprimir la imagen.')),'image/jpeg',0.72));
    const base=(file.name||'justificante').replace(/\.[^.]+$/,'');
    return new File([blob],`${base}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
  }catch(error){
    console.warn('No se pudo comprimir el justificante; se subirá el original.',error);
    return file;
  }
}


async function compressAvatar(file){
  if(!(file instanceof File)||!file.size||!String(file.type||'').startsWith('image/'))return file;
  try{
    const bitmap=await createImageBitmap(file);
    const side=Math.min(bitmap.width,bitmap.height);
    const sx=Math.max(0,(bitmap.width-side)/2),sy=Math.max(0,(bitmap.height-side)/2);
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,512,512);ctx.drawImage(bitmap,sx,sy,side,side,0,0,512,512);bitmap.close?.();
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('No se pudo procesar la foto.')),'image/jpeg',0.78));
    return new File([blob],'avatar.jpg',{type:'image/jpeg',lastModified:Date.now()});
  }catch(error){console.warn('No se pudo comprimir el avatar.',error);return file;}
}
function avatarUrl(path){
  if(!path)return '';
  return sb.storage.from('avatars').getPublicUrl(path).data?.publicUrl||'';
}
function profileInitials(profile){
  const value=String(profile?.display_name||profile?.email||'?').trim();
  const parts=value.split(/\s+/).filter(Boolean);return (parts.length>1?parts[0][0]+parts.at(-1)[0]:value.slice(0,2)).toUpperCase();
}
function avatarMarkup(profile,extra=''){
  const url=avatarUrl(profile?.avatar_path);
  return url?`<img class="user-avatar ${extra}" src="${esc(url)}" alt="Foto de ${esc(profile?.display_name||profile?.email||'usuario')}" loading="lazy">`:`<span class="user-avatar avatar-fallback ${extra}" aria-hidden="true">${esc(profileInitials(profile))}</span>`;
}

let activeCameraStream=null;
function stopActiveCamera(){
  activeCameraStream?.getTracks?.().forEach(track=>track.stop());
  activeCameraStream=null;
  document.querySelector('#camera-capture-overlay')?.remove();
}
function cameraErrorMessage(error){
  if(!window.isSecureContext)return 'La cámara necesita una conexión HTTPS segura.';
  if(error?.name==='NotAllowedError')return 'Permiso de cámara rechazado. Actívalo en los ajustes del navegador para este sitio.';
  if(error?.name==='NotFoundError')return 'No se encontró ninguna cámara disponible.';
  if(error?.name==='NotReadableError')return 'La cámara está siendo utilizada por otra aplicación.';
  if(error?.name==='OverconstrainedError')return 'La cámara solicitada no está disponible en este dispositivo.';
  return error?.message||'No se pudo abrir la cámara.';
}
async function openIntegratedCamera(onCapture){
  stopActiveCamera();
  if(!navigator.mediaDevices?.getUserMedia){
    toast('Este navegador no permite usar la cámara integrada. Usa “Elegir imagen”.',true);
    return;
  }
  if(!window.isSecureContext){
    toast('Abre la aplicación mediante HTTPS para usar la cámara.',true);
    return;
  }
  let facingMode='environment';
  document.body.insertAdjacentHTML('beforeend',`<div class="camera-overlay" id="camera-capture-overlay" role="dialog" aria-modal="true" aria-label="Cámara">
    <div class="camera-shell">
      <div class="camera-head"><div><strong>Hacer foto</strong><small>Permite el acceso cuando lo solicite el navegador</small></div><button type="button" class="camera-close" id="camera-cancel" aria-label="Cerrar">×</button></div>
      <div class="camera-stage"><video id="camera-video" autoplay muted playsinline></video><div class="camera-loading" id="camera-loading">Solicitando permiso de cámara…</div></div>
      <div class="camera-actions"><button type="button" class="btn" id="camera-switch">Cambiar cámara</button><button type="button" class="camera-shutter" id="camera-take" aria-label="Tomar fotografía"><span></span></button><button type="button" class="btn" id="camera-cancel-bottom">Cancelar</button></div>
    </div>
  </div>`);
  const overlay=document.querySelector('#camera-capture-overlay');
  const video=document.querySelector('#camera-video');
  const loading=document.querySelector('#camera-loading');
  const take=document.querySelector('#camera-take');
  const switchButton=document.querySelector('#camera-switch');
  const start=async()=>{
    activeCameraStream?.getTracks?.().forEach(track=>track.stop());
    activeCameraStream=null;
    loading.hidden=false;
    take.disabled=true;
    try{
      activeCameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080}}});
      video.srcObject=activeCameraStream;
      await video.play();
      loading.hidden=true;
      take.disabled=false;
    }catch(error){
      console.error('Camera error',error);
      stopActiveCamera();
      toast(cameraErrorMessage(error),true);
    }
  };
  const close=()=>stopActiveCamera();
  document.querySelector('#camera-cancel').onclick=close;
  document.querySelector('#camera-cancel-bottom').onclick=close;
  overlay.addEventListener('click',event=>{if(event.target===overlay)close()});
  switchButton.onclick=async()=>{facingMode=facingMode==='environment'?'user':'environment';await start()};
  take.onclick=async()=>{
    if(!video.videoWidth||!video.videoHeight)return toast('La cámara todavía no está preparada.',true);
    take.disabled=true;
    try{
      const maxSide=2000;
      const scale=Math.min(1,maxSide/Math.max(video.videoWidth,video.videoHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
      canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
      const ctx=canvas.getContext('2d',{alpha:false});
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('No se pudo capturar la fotografía.')),'image/jpeg',0.82));
      const file=new File([blob],`foto-${Date.now()}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
      close();
      onCapture?.(file);
    }catch(error){
      take.disabled=false;
      toast(error.message||'No se pudo hacer la fotografía.',true);
    }
  };
  await start();
}

const today = () => new Date().toISOString().slice(0,10);
const isAdmin = () => state.profile?.role === 'admin';
const kindLabels = { income:'Ingreso', expense:'Gasto', investment:'Inversión', saving:'Ahorro' };
const resourceLabels = { piggy:'Hucha', folder:'Carpeta', goal:'Objetivo' };
const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const CRYPTO_ALIASES={bitcoin:'BTC',btc:'BTC',ethereum:'ETH',ether:'ETH',eth:'ETH',solana:'SOL',sol:'SOL',cardano:'ADA',ada:'ADA',ripple:'XRP',xrp:'XRP',dogecoin:'DOGE',doge:'DOGE',litecoin:'LTC',ltc:'LTC',polkadot:'DOT',dot:'DOT',avalanche:'AVAX',avax:'AVAX',chainlink:'LINK',link:'LINK',polygon:'POL',matic:'POL',tether:'USDT',usdt:'USDT',usdcoin:'USDC',usdc:'USDC'};
const cryptoSymbolFromConcept=value=>{const text=String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();for(const [name,symbol] of Object.entries(CRYPTO_ALIASES))if(text.includes(name))return symbol;return '';};
const isCryptoConcept=value=>Boolean(cryptoSymbolFromConcept(value));
const cryptoQty=v=>{const n=Number(String(v??'').trim().replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)&&n>0?n:0};
const FUEL_TERMS=['combustible','gasolina','gasoil','diesel','diésel','repostaje','carburante'];
const decimal=v=>{const n=Number(String(v??'').trim().replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:0};
const positive=v=>{const n=decimal(v);return n>0?Number(n.toFixed(3)):null};
const isFuelConcept=concept=>{const text=String(concept||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return FUEL_TERMS.some(term=>text.includes(term.normalize('NFD').replace(/[\u0300-\u036f]/g,'')))};
const fuelTotalCents=fuel=>fuel?.liters&&fuel?.price_per_liter_milli?Math.round(Number(fuel.liters)*Number(fuel.price_per_liter_milli)/10):0;
const fuelConsumption=fuel=>fuel?.liters&&fuel?.km?Number((Number(fuel.liters)/Number(fuel.km)*100).toFixed(2)):null;


function toast(message,bad=false){
  toastEl.textContent=message; toastEl.classList.toggle('bad',bad); toastEl.classList.add('show');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>toastEl.classList.remove('show'),2800);
}
function modal(html,wide=false){
  closeModal();
  document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="modal"><div class="modal-card ${wide?'wide':''}">${html}</div></div>`);
  document.querySelector('#modal').onclick=e=>{if(e.target.id==='modal'||e.target.closest('[data-close]'))closeModal()};
}
function closeModal(){stopActiveCamera();document.querySelector('#modal')?.remove()}
function busy(button,on){if(!button)return;button.disabled=on;button.dataset.label??=button.textContent;button.textContent=on?'Procesando…':button.dataset.label}
function fatal(error){
  console.error(error);
  app.innerHTML=`<section class="auth-shell"><div class="auth-card"><h1>No se pudo cargar A2C Finanzas</h1><p class="muted">${esc(error?.message||'Error desconocido')}</p><button class="btn primary full" onclick="location.reload()">Reintentar</button></div></section>`;
}

if(!sb) fatal(new Error('Configura config.js con la URL y la clave pública de Supabase.'));
else boot().catch(fatal);

async function boot(){
  const {data:{session}}=await sb.auth.getSession();
  state.user=session?.user||null;
  if(state.user) await enter(); else renderLogin();

  sb.auth.onAuthStateChange(async(_event,session)=>{
    state.user=session?.user||null;
    if(state.user) await enter(); else renderLogin();
  });
}

function renderLogin(){
  app.innerHTML=`<section class="auth-shell"><form class="auth-card" id="login-form">
    <div class="brand"><img class="brand-logo brand-logo-login" src="./logo-a2c.png" alt="Logotipo de A2C Finanzas"><div><h1>A2C Finanzas</h1><p class="muted">Finanzas personales y compartidas</p></div></div>
    <div class="field"><label>Email o @usuario</label><input name="identifier" type="text" autocomplete="username" maxlength="254" autocapitalize="none" spellcheck="false" required placeholder="correo@ejemplo.com o @usuario"></div>
    <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" minlength="6" maxlength="256" required></div>
    <button class="btn primary full">Entrar</button>
  </form></section>`;
  document.querySelector('#login-form').onsubmit=async e=>{
    e.preventDefault();
    const b=e.submitter,fd=new FormData(e.currentTarget);
    const identifier=String(fd.get('identifier')||'').trim().toLowerCase();
    const password=String(fd.get('password')||'');
    busy(b,true);
    try{
      const {data,error}=await sb.functions.invoke('secure-login',{body:{identifier,password}});
      if(error||!data?.ok||!data?.session?.access_token||!data?.session?.refresh_token){
        if(data?.code==='locked')toast('Demasiados intentos. Inténtalo de nuevo más tarde.',true);
        else toast('Email o contraseña incorrecta',true);
        return;
      }
      const {error:setError}=await sb.auth.setSession({
        access_token:data.session.access_token,
        refresh_token:data.session.refresh_token
      });
      if(setError)throw setError;
    }catch(error){
      console.error('No se pudo completar el inicio de sesión.',error);
      toast('No se pudo iniciar sesión. Inténtalo de nuevo.',true);
    }finally{busy(b,false)}
  };
}

async function enter(){
  state.tab='home';
  const {data:profile,error}=await sb.from('profiles').select('*').eq('id',state.user.id).single();
  if(error)throw error;
  if(profile.active===false)throw new Error('Tu cuenta está desactivada.');
  state.profile=profile;
  await loadAll();
  renderShell();
}

async function loadAll(){
  const q=[
    sb.from('resources').select('*').order('created_at',{ascending:false}),
    sb.from('resource_members').select('*,profile:profiles(id,email,display_name,avatar_path)').order('created_at'),
    sb.from('resource_invitations').select('*').order('created_at',{ascending:false}),
    sb.from('finance_transactions').select('*,resource:resources(id,name,type)').order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
    sb.from('notifications').select('*').order('created_at',{ascending:false}),
    sb.from('recurring_transactions').select('*,resource:resources(id,name,type)').order('next_date'),
    sb.from('crypto_holdings').select('*,resource:resources(id,name,type)').order('symbol'),
    sb.from('crypto_ledger').select('*,source:resources!crypto_ledger_source_resource_id_fkey(id,name,type),destination:resources!crypto_ledger_destination_resource_id_fkey(id,name,type)').order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
    sb.from('social_posts').select('*,author:profiles!social_posts_user_id_fkey(id,email,display_name,avatar_path,username,is_public),transaction:finance_transactions(id,kind,concept,amount_cents,occurred_on)').order('created_at',{ascending:false}).limit(100),
    sb.from('friendships').select('*').or(`requester_id.eq.${state.user.id},addressee_id.eq.${state.user.id}`).order('created_at',{ascending:false}),
    sb.from('profile_follows').select('*').or(`follower_id.eq.${state.user.id},followed_id.eq.${state.user.id}`).order('created_at',{ascending:false}),
    sb.from('profiles').select('id,email,display_name,avatar_path,username,is_public').order('username').limit(500),
    sb.from('expense_splits').select('*').or(`owner_id.eq.${state.user.id},debtor_user_id.eq.${state.user.id}`).order('created_at',{ascending:false}),
    sb.from('social_leaderboard').select('*').order('investment_cents',{ascending:false})
  ];
  if(isAdmin())q.push(sb.from('profiles').select('*').order('email'));
  const result=await Promise.all(q);
  for(const r of result)if(r.error)throw r.error;
  [state.resources,state.members,state.invitations,state.transactions,state.notifications,state.recurring,state.cryptoHoldings,state.cryptoLedger,state.socialPosts,state.friendships,state.follows,state.socialProfiles,state.expenseSplits,state.leaderboard]=result.slice(0,14).map(r=>r.data||[]);
  state.profiles=isAdmin()?(result[14]?.data||[]):[];
  await Promise.all(state.socialPosts.map(async post=>{if(!post.image_path)return;const {data}=await sb.storage.from('social').createSignedUrl(post.image_path,3600);post.signed_url=data?.signedUrl||'';}));
}

async function refresh(render=true){await loadAll();if(render)renderShell()}

const uiIcons={
  home:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-7H9v7H3.5a.5.5 0 0 1-.5-.5z"/></svg>',
  piggy:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10a7 7 0 0 1 12.5-4.3L21 5v5h-2a7 7 0 0 1-3 5.7V20h-3v-3H9v3H6v-4.1A6.9 6.9 0 0 1 5 10Zm3-2h4"/></svg>',
  folder:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
  goal:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m12 12 7-7"/></svg>',
  activity:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V9m5 9V5m5 13v-7m5 7V3"/></svg>',
  social:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>',
  stats:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>',
  bell:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
  settings:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
  user:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  logout:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5m5 5H3m10-9h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg>'
};
function nav(tab,label){return `<button class="nav-btn ${state.tab===tab?'active':''}" data-tab="${tab}" aria-label="${label}" title="${label}">${uiIcons[tab]}<span>${label}</span></button>`}
function renderShell(){
  const unread=state.notifications.filter(n=>!n.read_at).length;
  app.innerHTML=`<div class="app-shell">
    <header class="topbar">
      <button class="brand-compact" id="profile" aria-label="Abrir perfil">${avatarMarkup(state.profile,'header-avatar')}</button>
      <div class="top-title"><strong>A2C Finanzas</strong><small>${esc(state.profile.display_name||state.profile.email)}</small></div>
      <div class="top-actions">
        <button class="icon-btn hidden" id="install-app" aria-label="Instalar aplicación">${uiIcons.download||'↓'}</button>
        <button class="icon-btn" id="notifications" aria-label="Notificaciones">${uiIcons.bell}${unread?`<span class="badge">${unread}</span>`:''}</button>
        ${isAdmin()?`<button class="icon-btn" id="admin" aria-label="Administración">${uiIcons.settings}</button>`:''}
        <button class="icon-btn" id="logout" aria-label="Cerrar sesión">${uiIcons.logout}</button>
      </div>
    </header>
    <main class="view">${renderPage()}</main>
    <button class="finance-fab" id="finance-fab" aria-label="Añadir movimiento"><span>＋</span></button>
    <nav class="bottom-nav" aria-label="Navegación principal">${nav('home','Inicio')}${nav('piggy','Huchas')}${nav('folder','Carpetas')}${nav('goal','Objetivos')}${nav('activity','Actividad')}${nav('social','Social')}${nav('stats','Estadísticas')}</nav>
  </div>`;
  bind();
}
function renderPage(){
  if(state.tab==='home')return renderHome();
  if(['piggy','folder','goal'].includes(state.tab))return renderResources(state.tab);
  if(state.tab==='activity')return renderActivity();
  if(state.tab==='social')return renderSocial();
  return renderStats();
}

function totals(list=state.transactions){
  return list
    .filter(t=>!(t.is_transfer&&t.transfer_role==='destination'))
    .reduce((a,t)=>{a[t.kind]=(a[t.kind]||0)+Number(t.amount_cents||0);return a},{income:0,expense:0,investment:0,saving:0});
}
function mainBalance(){
  return state.transactions
    .filter(t=>{
      if(t.is_transfer&&t.transfer_role==='destination')return false;
      if(t.payment_method==='crypto')return false;
      return !t.resource_id||t.resource?.type==='folder';
    })
    .reduce((s,t)=>s+(t.kind==='income'?Number(t.amount_cents):-Number(t.amount_cents)),0);
}
function txRow(tx){
  const splitCount=state.expenseSplits.filter(row=>row.transaction_id===tx.id&&row.owner_id===state.user.id).length;
  const space=tx.resource?.name?esc(tx.resource.name):'Cuenta principal';
  const payment=tx.payment_method==='cash'?'Efectivo':tx.payment_method==='crypto'?'Cripto':'Banco';
  const symbol=tx.kind==='income'?'↗':tx.kind==='expense'?'↘':tx.kind==='investment'?'◆':'◎';
  const fuel=tx.fuel_liters?` · ${Number(tx.fuel_liters).toLocaleString('es-ES',{maximumFractionDigits:2})} L${tx.fuel_consumption_l100km?` · ${Number(tx.fuel_consumption_l100km).toLocaleString('es-ES',{maximumFractionDigits:2})} L/100 km`:''}`:'';
  const crypto=tx.crypto_symbol?` · ${esc(tx.crypto_symbol)} · ${Number(tx.crypto_quantity||0).toLocaleString('es-ES',{maximumFractionDigits:8})}`:'';
  const investment=tx.kind==='investment'&&tx.investment_isin?` · ${esc(String(tx.investment_isin).toUpperCase())}${tx.investment_quantity?` · ${Number(tx.investment_quantity).toLocaleString('es-ES',{maximumFractionDigits:6})} acc.`:''}`:'';
  return `<article class="transaction-row clickable" data-edit-tx="${tx.id}" tabindex="0">
    <div class="transaction-icon ${tx.kind}">${symbol}</div>
    <div class="transaction-copy"><strong>${esc(tx.concept)}</strong><small>${esc(tx.occurred_on)} · ${space} · ${payment}${tx.is_transfer?' · Traspaso':''}${fuel}${investment}${crypto}</small></div>
    <div class="transaction-tail"><b class="${tx.kind}">${tx.kind==='income'?'+':'−'}${money(tx.amount_cents)}</b><div class="transaction-mini-actions">${splitCount?`<span class="tx-split-badge">${splitCount} personas</span>`:''}${tx.receipt_path?`<button type="button" class="receipt-thumb-btn" data-receipt-path="${esc(tx.receipt_path)}" aria-label="Ver imagen adjunta" title="Ver imagen">🖼️</button>`:''}</div></div>
  </article>`;
}

function currentMonthKey(){
  return new Date().toISOString().slice(0,7);
}
function monthTransactions(offset=0){
  const d=new Date();
  d.setMonth(d.getMonth()+offset);
  const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  return state.transactions.filter(t=>String(t.occurred_on).startsWith(key));
}
function savingsRate(list=monthTransactions()){
  const t=totals(list);
  return t.income>0?Math.round(((t.income-t.expense-t.investment)/t.income)*100):0;
}
function monthlySeries(months=6,source=state.transactions){
  const rows=[];
  const now=new Date();
  for(let i=months-1;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const list=source.filter(t=>String(t.occurred_on).startsWith(key));
    const t=totals(list);
    rows.push({label:`${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`,income:t.income,expense:t.expense,net:t.income-t.expense-t.investment-t.saving});
  }
  return rows;
}
function professionalLineChart(series){
  const width=760,height=270,pad=42;
  const values=series.flatMap(r=>[r.income,r.expense]);
  const max=Math.max(1,...values);
  const x=i=>pad+i*((width-pad*2)/Math.max(1,series.length-1));
  const y=v=>height-pad-(v/max)*(height-pad*2);
  const line=key=>series.map((r,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${y(r[key]).toFixed(1)}`).join(' ');
  const grid=[0,.25,.5,.75,1].map(p=>`<line x1="${pad}" y1="${y(max*p)}" x2="${width-pad}" y2="${y(max*p)}" />`).join('');
  const labels=series.map((r,i)=>`<text x="${x(i)}" y="${height-12}" text-anchor="middle">${r.label}</text>`).join('');
  return `<svg class="pro-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolución mensual">
    <g class="chart-grid">${grid}</g>
    <path class="chart-line income-line" d="${line('income')}"></path>
    <path class="chart-line expense-line" d="${line('expense')}"></path>
    ${series.map((r,i)=>`<circle class="chart-point income-point" cx="${x(i)}" cy="${y(r.income)}" r="4"></circle><circle class="chart-point expense-point" cx="${x(i)}" cy="${y(r.expense)}" r="4"></circle>`).join('')}
    <g class="chart-labels">${labels}</g>
  </svg>`;
}
function conceptSpending(list=monthTransactions(),kind='expense'){
  const map=new Map();
  for(const tx of list.filter(t=>t.kind===kind)){
    const name=String(tx.concept||'Sin concepto').trim()||'Sin concepto';
    const key=name.toLowerCase();
    const current=map.get(key)||{name,value:0,count:0};
    current.value+=Number(tx.amount_cents)||0; current.count++;
    map.set(key,current);
  }
  return [...map.values()].sort((a,b)=>b.value-a.value);
}

function financeDonut(values,balance){
  const items=[
    {key:'income',label:'Ingresos',value:Number(values.income)||0,color:'var(--green)'},
    {key:'expense',label:'Gastos',value:Number(values.expense)||0,color:'var(--red)'},
    {key:'saving',label:'Ahorro',value:Number(values.saving)||0,color:'var(--amber)'},
    {key:'investment',label:'Inversión',value:Number(values.investment)||0,color:'var(--blue)'}
  ];
  const total=items.reduce((sum,item)=>sum+item.value,0);
  const cx=80,cy=80,radius=66;
  const point=angle=>{
    const radians=(angle-90)*Math.PI/180;
    return {x:cx+radius*Math.cos(radians),y:cy+radius*Math.sin(radians)};
  };
  const wedge=(startAngle,endAngle)=>{
    const start=point(startAngle),end=point(endAngle);
    const largeArc=endAngle-startAngle>180?1:0;
    return `M ${cx} ${cy} L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
  };
  let angle=0;
  const visible=items.filter(item=>item.value>0);
  const slices=visible.map((item,index)=>{
    const ratio=total>0?item.value/total:0;
    const startAngle=angle;
    const endAngle=index===visible.length-1?360:angle+(ratio*360);
    angle=endAngle;
    return `<path class="finance-donut-slice" d="${wedge(startAngle,endAngle)}" fill="${item.color}" data-donut-key="${item.key}" data-donut-label="${item.label}" data-donut-value="${item.value}" tabindex="0" role="button" aria-label="${item.label}: ${money(item.value)}"></path>`;
  }).join('');
  const empty=total<=0?`<circle class="finance-pie-empty" cx="${cx}" cy="${cy}" r="${radius}"></circle>`:'';
  return `<div class="finance-donut-layout">
    <div class="finance-donut-wrap" id="finance-donut-wrap">
      <svg class="finance-donut" viewBox="0 0 160 160" role="img" aria-label="Distribución financiera del mes">
        ${empty}${slices}
      </svg>
      <div class="finance-donut-center" id="finance-donut-center"><small>Patrimonio disponible</small><strong>${money(balance)}</strong></div>
    </div>
  </div>`;
}

function renderHome(){
  const month=totals(monthTransactions());
  const recent=state.transactions.filter(t=>!(t.is_transfer&&t.transfer_role==='destination')).slice(0,10);
  return `<section class="dashboard home-overview">
    <div class="dashboard-head"><div><span class="eyebrow">Resumen financiero</span><h1>Hola, ${esc(state.profile.display_name||'')}</h1><p class="muted">Tu situación financiera actual.</p></div></div>


    <article class="card finance-donut-card">
      <div class="card-head"><div><h2>Distribución del mes</h2><p class="muted">Pulsa una porción para consultar su importe</p></div></div>
      ${financeDonut(month,mainBalance())}
    </article>

    <article class="card home-history">
      <div class="card-head"><div><h2>Últimas transacciones</h2><p class="muted">Las 10 operaciones más recientes</p></div><button class="text-btn" data-tab-shortcut="activity">Ver todas</button></div>
      <div class="list">${recent.length?recent.map(txRow).join(''):'<div class="empty compact">Todavía no hay movimientos.</div>'}</div>
    </article>
  </section>`;
}
function resourceBalance(id){const resource=state.resources.find(r=>r.id===id);return state.transactions.filter(t=>t.resource_id===id).reduce((sum,t)=>{const positive=t.kind==='income'||(t.kind==='saving'&&(resource?.type==='goal'||resource?.type==='piggy'));return sum+(positive?Number(t.amount_cents):-Number(t.amount_cents));},0)}
function renderResources(type){
  const meta={piggy:['Huchas','Cuentas personales o compartidas'],folder:['Carpetas','Control de una misma cosa'],goal:['Objetivos','Metas económicas con fecha']}[type];
  const list=state.resources.filter(r=>r.type===type);
  return `<section><div class="section-head"><div><h2>${meta[0]}</h2><p class="muted">${meta[1]}</p></div><button class="btn primary" data-new-resource="${type}">Nuevo</button></div>
    <div class="grid two">${list.map(r=>{
      const balance=resourceBalance(r.id),resourceMembers=state.members.filter(m=>m.resource_id===r.id&&m.profile),members=resourceMembers.length,pct=r.target_cents?Math.min(100,Math.round(Math.max(0,balance)/r.target_cents*100)):0,cryptoSummary=cryptoResourceSummary(r.id);
      const avatars=r.is_shared?`<div class="shared-avatars" aria-label="Usuarios que comparten este elemento">${resourceMembers.slice(0,5).map(m=>`<button type="button" class="avatar-button" data-profile-id="${m.profile.id}" aria-label="Ver perfil de ${esc(m.profile.display_name||m.profile.email)}">${avatarMarkup(m.profile)}</button>`).join('')}${members>5?`<span class="avatar-more">+${members-5}</span>`:''}</div>`:'';
      return `<article class="card"><div class="entity-header"><div><h3>${esc(r.name)}</h3><p class="muted">${r.is_shared?`Compartido · ${members} miembros`:'Personal'}</p></div><button class="icon-btn" data-resource="${r.id}">•••</button></div>${avatars}<div class="metric">${money(balance)}</div>${cryptoSummary.count?`<button type="button" class="resource-crypto-summary" data-resource-crypto="${r.id}"><span>₿ ${cryptoSummary.count} ${cryptoSummary.count===1?'criptomoneda':'criptomonedas'}</span><small>${cryptoSummary.rows.map(h=>`${esc(h.symbol)} ${Number(h.quantity).toLocaleString('es-ES',{maximumFractionDigits:6})}`).join(' · ')}</small></button>`:''}${type==='goal'?`<div class="progress"><i style="width:${pct}%"></i></div><small>${pct}% de ${money(r.target_cents)}${r.target_date?` · ${esc(r.target_date)}`:''}</small>`:''}${r.description?`<p class="muted">${esc(r.description)}</p>`:''}</article>`;
    }).join('')||'<div class="empty">No hay elementos.</div>'}</div></section>`;
}
function filtered(){
  const f=state.filters;
  return state.transactions.filter(t=>{
    if(!f.resourceId && t.is_transfer && t.transfer_role==='destination') return false;
    if(f.query && !String(t.concept||'').toLowerCase().includes(f.query.toLowerCase())) return false;
    if(f.kind && t.kind!==f.kind) return false;
    if(f.resourceId && t.resource_id!==f.resourceId) return false;
    if(f.resourceType==='main' && t.resource_id) return false;
    if(f.resourceType && f.resourceType!=='main' && t.resource?.type!==f.resourceType) return false;
    if(f.from && t.occurred_on<f.from) return false;
    if(f.to && t.occurred_on>f.to) return false;
    return true;
  });
}
function renderActivity(){
  return `<section><div class="section-head"><div><h2>Actividad</h2><p class="muted">Busca, filtra y edita</p></div></div>
    <form class="filters filters-pro" id="activity-filter"><input name="query" placeholder="Concepto" value="${esc(state.filters.query)}"><input name="from" type="date" value="${esc(state.filters.from)}"><input name="to" type="date" value="${esc(state.filters.to)}">
      <select name="kind"><option value="">Todos los tipos</option>${Object.entries(kindLabels).map(([k,label])=>`<option value="${k}" ${state.filters.kind===k?'selected':''}>${label}</option>`).join('')}</select>
      <select name="resourceType"><option value="">Todos los espacios</option><option value="main" ${state.filters.resourceType==='main'?'selected':''}>Cuenta principal</option><option value="piggy" ${state.filters.resourceType==='piggy'?'selected':''}>Huchas</option><option value="folder" ${state.filters.resourceType==='folder'?'selected':''}>Carpetas</option><option value="goal" ${state.filters.resourceType==='goal'?'selected':''}>Objetivos</option></select>
      <select name="resourceId"><option value="">Todos los elementos</option>${state.resources.filter(r=>!state.filters.resourceType||state.filters.resourceType===r.type).map(r=>`<option value="${r.id}" ${state.filters.resourceId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select>
    </form><div class="list" id="activity-list">${filtered().map(txRow).join('')||'<div class="empty">No hay movimientos.</div>'}</div></section>`;
}
function investmentPortfolio(list){
  const map=new Map();
  for(const tx of list.filter(t=>t.kind==='investment')){
    const isin=String(tx.investment_isin||'SIN ISIN').trim().toUpperCase()||'SIN ISIN';
    const company=String(tx.concept||'Inversión').trim()||'Inversión';
    const row=map.get(isin)||{isin,company,shares:0,total:0,count:0};
    row.shares+=Number(tx.investment_quantity)||0;
    row.total+=Number(tx.amount_cents)||0;
    row.count++;
    if(row.company==='Inversión'&&company!=='Inversión')row.company=company;
    map.set(isin,row);
  }
  return [...map.values()].map(row=>({...row,averagePriceCents:row.shares>0?Math.round(row.total/row.shares):0})).sort((a,b)=>b.total-a.total);
}
function statsTransactions(){
  return filtered();
}
function fuelStatistics(list){
  const rows=list.filter(tx=>tx.kind==='expense'&&Number(tx.fuel_liters)>0);
  const liters=rows.reduce((sum,tx)=>sum+Number(tx.fuel_liters||0),0);
  const spent=rows.reduce((sum,tx)=>sum+Number(tx.amount_cents||0),0);
  const averagePriceMilli=liters>0?Math.round((spent/100)/liters*1000):0;
  return {rows,liters,spent,averagePriceMilli};
}
function cryptoStats(){
  const holdings=state.cryptoHoldings.filter(h=>Number(h.quantity)>0);
  const ledger=state.cryptoLedger.filter(row=>{
    if(state.filters.from&&row.occurred_on<state.filters.from)return false;
    if(state.filters.to&&row.occurred_on>state.filters.to)return false;
    if(state.filters.resourceId&&row.source_resource_id!==state.filters.resourceId&&row.destination_resource_id!==state.filters.resourceId)return false;
    return true;
  });
  return {holdings,ledger,totalCost:holdings.reduce((sum,h)=>sum+Number(h.total_cost_cents||0),0)};
}
function holdingLabel(h){return `${h.symbol}${h.resource?.name?` · ${h.resource.name}`:' · Cuenta principal'}`;}
function cryptoHoldingOptions(resourceId=undefined){return state.cryptoHoldings.filter(h=>Number(h.quantity)>0&&(resourceId===undefined||String(h.resource_id||'')===String(resourceId||''))).map(h=>`<option value="${h.id}">${esc(holdingLabel(h))} · ${Number(h.quantity).toLocaleString('es-ES',{maximumFractionDigits:8})}</option>`).join('');}
function cryptoHoldingsForResource(resourceId=null){return state.cryptoHoldings.filter(h=>Number(h.quantity)>0&&String(h.resource_id||'')===String(resourceId||''));}
function cryptoResourceSummary(resourceId){const rows=cryptoHoldingsForResource(resourceId);return {rows,count:rows.length,totalUnits:rows.reduce((sum,h)=>sum+Number(h.quantity||0),0)};}
function cryptoPaymentOptions(selected=''){return state.cryptoHoldings.filter(h=>Number(h.quantity)>0).map(h=>`<option value="crypto:${h.id}" ${selected===`crypto:${h.id}`?'selected':''}>₿ ${esc(h.crypto_name||h.symbol)} · ${esc(h.symbol)} · ${Number(h.quantity).toLocaleString('es-ES',{maximumFractionDigits:8})} · ${h.resource?.name?esc(h.resource.name):'Cuenta principal'}</option>`).join('');}

function friendshipWith(userId){return state.friendships.find(f=>(f.requester_id===state.user.id&&f.addressee_id===userId)||(f.addressee_id===state.user.id&&f.requester_id===userId));}
function followFromMe(userId){return state.follows.find(f=>f.follower_id===state.user.id&&f.followed_id===userId);}
function followerCount(userId){return state.follows.filter(f=>f.followed_id===userId&&f.status==='accepted').length;}
function followingCount(userId){return state.follows.filter(f=>f.follower_id===userId&&f.status==='accepted').length;}
function canSeeProfilePosts(userId){const p=state.socialProfiles.find(x=>x.id===userId);return userId===state.user.id||p?.is_public||followFromMe(userId)?.status==='accepted'||friendshipWith(userId)?.status==='accepted';}
function canSeePost(post){return post.user_id===state.user.id||post.author?.is_public||followFromMe(post.user_id)?.status==='accepted'||friendshipWith(post.user_id)?.status==='accepted';}
function socialImageUrl(post){return post?.signed_url||'';}
function sharedMetricsFor(userId){return state.leaderboard.find(r=>r.user_id===userId)||{income_cents:0,expense_cents:0,saving_cents:0,investment_cents:0,shared_count:0};}
function metricCards(userId){const m=sharedMetricsFor(userId);return `<div class="public-metrics-grid"><div><span>Ingresos compartidos</span><strong class="income">${money(m.income_cents)}</strong></div><div><span>Gastos compartidos</span><strong class="expense">${money(m.expense_cents)}</strong></div><div><span>Ahorro compartido</span><strong class="saving">${money(m.saving_cents)}</strong></div><div><span>Inversión compartida</span><strong class="investment">${money(m.investment_cents)}</strong></div></div>`;}
function rankingBadgesFor(userId){
  const categories=[
    ['investment_cents','Inversión','◆'],
    ['saving_cents','Ahorro','◎'],
    ['income_cents','Ingresos','↗']
  ];
  return categories.flatMap(([key,label,icon])=>{
    const rows=[...state.leaderboard].filter(r=>Number(r[key])>0).sort((a,b)=>Number(b[key])-Number(a[key])).slice(0,3);
    const pos=rows.findIndex(r=>r.user_id===userId);
    return pos<0?[]:[{key,label,icon,position:pos+1}];
  });
}
function rankingBadgesMarkup(userId,large=false){
  const badges=rankingBadgesFor(userId);
  if(!badges.length)return '';
  return `<div class="profile-ranking-badges ${large?'large':''}" aria-label="Insignias de clasificación">${badges.map(b=>`<span class="ranking-badge rank-${b.position}" title="Top ${b.position} en ${esc(b.label)}"><b>${b.icon}</b><em>#${b.position}</em><small>${esc(b.label)}</small></span>`).join('')}</div>`;
}
function leaderboardSection(){
  const cats=[['investment_cents','Más invierten','Inversión'],['saving_cents','Más ahorran','Ahorro'],['income_cents','Más ganan','Ingresos']];
  return `<section class="social-ranking"><div class="section-head"><div><h2>Ranking</h2><p class="muted">Solo cuentan las transacciones que los usuarios han decidido publicar.</p></div></div>${cats.map(([key,title,label])=>{const rows=[...state.leaderboard].filter(r=>Number(r[key])>0).sort((a,b)=>Number(b[key])-Number(a[key])).slice(0,5);const me=state.leaderboard.find(r=>r.user_id===state.user.id);const third=rows[2];const gap=third?Math.max(0,Number(third[key])-Number(me?.[key]||0)+1):0;return `<article class="ranking-card"><h3>${title}</h3><div class="ranking-list">${rows.length?rows.map((r,i)=>`<button data-social-profile="${r.user_id}"><b>#${i+1}</b>${avatarMarkup(r,'small')}<span><strong>${esc(r.display_name||r.username||'Usuario')}</strong><small>@${esc(r.username||'usuario')}</small></span><em>${money(r[key])}</em></button>`).join(''):'<div class="empty compact">Todavía no hay datos compartidos.</div>'}</div>${gap>0?`<p class="ranking-gap">Te quedan <strong>${money(gap)}</strong> para entrar en el top 3 de ${label.toLowerCase()}.</p>`:`<p class="ranking-gap success">¡Estás en el top 3 de ${label.toLowerCase()}!</p>`}</article>`}).join('')}</section>`;
}
function socialPostMarkup(post){const image=socialImageUrl(post),tx=post.transaction;return `<article class="social-post"><div class="social-post-head"><button class="social-author" data-social-profile="${post.user_id}">${avatarMarkup(post.author,'small')}<span><strong>${esc(post.author?.display_name||'Usuario')}</strong><small>@${esc(post.author?.username||'usuario')} · ${new Date(post.created_at).toLocaleDateString('es-ES')}</small></span></button>${post.user_id===state.user.id?`<button class="icon-btn" data-delete-post="${post.id}" aria-label="Borrar publicación">×</button>`:''}</div><div class="social-photo-wrap"><img src="${esc(image)}" alt="Publicación de ${esc(post.author?.display_name||'usuario')}" loading="lazy"><div class="social-overlay"><strong>${esc(post.caption||tx?.concept||'Publicación')}</strong>${tx?`<span>${esc(kindLabels[tx.kind]||'Movimiento')}</span><span class="share-transaction-meta"><b>${money(tx.amount_cents)}</b><time>${esc(tx.occurred_on)}</time></span>`:''}</div></div></article>`;}
function socialTabs(){
  const tabs=[['feed','Inicio'],['profile','Perfil'],['ranking','Ranking']];
  return `<nav class="social-tabs" aria-label="Secciones de la red social">${tabs.map(([key,label])=>`<button class="${state.socialSection===key?'active':''}" data-social-section="${key}">${label}</button>`).join('')}</nav>`;
}
function renderOwnSocialProfile(){
  const posts=state.socialPosts.filter(p=>p.user_id===state.user.id);
  return `<section class="social-profile-tab"><div class="social-profile-summary profile-tab-card"><div class="social-profile-identity">${rankingBadgesMarkup(state.user.id,true)}<button class="social-own-profile" data-social-profile="${state.user.id}">${avatarMarkup(state.profile,'profile-avatar-large')}<span><strong>${esc(state.profile.display_name||'Usuario')}</strong><small>@${esc(state.profile.username||'usuario')}</small></span></button></div><div class="social-counts"><button data-social-list="followers"><strong>${followerCount(state.user.id)}</strong><span>Seguidores</span></button><button data-social-list="following"><strong>${followingCount(state.user.id)}</strong><span>Seguidos</span></button><button><strong>${posts.length}</strong><span>Publicaciones</span></button></div>${metricCards(state.user.id)}</div><div class="section-head"><div><h2>Mis publicaciones</h2><p class="muted">Todo lo que has compartido con la comunidad.</p></div><button class="btn" data-find-people>Buscar personas</button></div><div class="profile-post-grid social-profile-grid">${posts.length?posts.map(p=>`<button data-open-own-post="${p.id}"><img src="${esc(socialImageUrl(p))}" alt="Publicación" loading="lazy"></button>`).join(''):'<div class="empty compact">Todavía no has publicado imágenes.</div>'}</div></section>`;
}
function renderSocialFeed(){
  const posts=state.socialPosts.filter(canSeePost);
  const pendingFriends=state.friendships.filter(f=>f.addressee_id===state.user.id&&f.status==='pending');
  const pendingFollows=state.follows.filter(f=>f.followed_id===state.user.id&&f.status==='pending');
  return `<section class="social-feed-tab"><div class="section-head"><div><h2>Inicio</h2><p class="muted">Publicaciones recientes de usuarios que sigues y cuentas públicas.</p></div><button class="btn" data-find-people>Buscar personas</button></div>${(pendingFriends.length||pendingFollows.length)?`<article class="card social-requests"><h3>Solicitudes</h3>${pendingFriends.map(f=>{const p=state.socialProfiles.find(x=>x.id===f.requester_id);return `<div class="row">${avatarMarkup(p,'small')}<div><strong>${esc(p?.display_name||'Usuario')}</strong><small>@${esc(p?.username||'usuario')} · amistad</small></div><div><button class="btn success" data-friend-accept="${f.id}">Aceptar</button><button class="btn danger" data-friend-reject="${f.id}">Rechazar</button></div></div>`}).join('')}${pendingFollows.map(f=>{const p=state.socialProfiles.find(x=>x.id===f.follower_id);return `<div class="row">${avatarMarkup(p,'small')}<div><strong>${esc(p?.display_name||'Usuario')}</strong><small>@${esc(p?.username||'usuario')} · seguimiento</small></div><div><button class="btn success" data-follow-accept="${f.id}">Aceptar</button><button class="btn danger" data-follow-reject="${f.id}">Rechazar</button></div></div>`}).join('')}</article>`:''}<div class="social-feed">${posts.length?posts.map(socialPostMarkup).join(''):'<div class="empty">Todavía no hay publicaciones visibles.</div>'}</div></section>`;
}
function renderSocial(){
  const content=state.socialSection==='profile'?renderOwnSocialProfile():state.socialSection==='ranking'?leaderboardSection():renderSocialFeed();
  return `<section class="social-page">${socialTabs()}${content}</section>`;
}
async function toggleFollow(userId){const profile=state.socialProfiles.find(p=>p.id===userId);const existing=followFromMe(userId);if(existing){const {error}=await sb.from('profile_follows').delete().eq('id',existing.id);if(error)return toast(error.message,true);await refresh(false);openUserProfile(userId);return toast('Has dejado de seguir a este usuario.');}const {error}=await sb.from('profile_follows').insert({follower_id:state.user.id,followed_id:userId,status:profile?.is_public?'accepted':'pending'});if(error)return toast(error.message,true);await refresh(false);openUserProfile(userId);toast(profile?.is_public?'Ahora sigues a este usuario.':'Solicitud de seguimiento enviada.');}
async function respondFollow(id,status){const {error}=await sb.from('profile_follows').update({status,responded_at:new Date().toISOString()}).eq('id',id);if(error)return toast(error.message,true);await refresh();toast(status==='accepted'?'Solicitud aceptada':'Solicitud rechazada');}
function openSocialList(kind){const ids=kind==='followers'?state.follows.filter(f=>f.followed_id===state.user.id&&f.status==='accepted').map(f=>f.follower_id):state.follows.filter(f=>f.follower_id===state.user.id&&f.status==='accepted').map(f=>f.followed_id);const rows=ids.map(id=>state.socialProfiles.find(p=>p.id===id)).filter(Boolean);modal(`<div class="modal-head"><div><h2>${kind==='followers'?'Seguidores':'Seguidos'}</h2></div><button class="close-btn" data-close>×</button></div><div class="list">${rows.length?rows.map(p=>`<button class="row social-person-row" data-social-profile="${p.id}">${avatarMarkup(p,'small')}<div><strong>${esc(p.display_name||'Usuario')}</strong><small>@${esc(p.username||'usuario')}</small></div></button>`).join(''):'<div class="empty compact">No hay usuarios todavía.</div>'}</div>`,true);document.querySelectorAll('[data-social-profile]').forEach(b=>b.onclick=()=>openUserProfile(b.dataset.socialProfile));}
async function sendFriendRequest(userId){const {error}=await sb.from('friendships').insert({requester_id:state.user.id,addressee_id:userId,status:'pending'});if(error)return toast(error.message,true);await refresh();toast('Solicitud enviada');}
function openPeopleSearch(){modal(`<div class="modal-head"><div><h2>Buscar personas</h2><p class="muted">Busca por nombre o @usuario.</p></div><button class="close-btn" data-close>×</button></div><div class="field"><input id="people-query" placeholder="@usuario o nombre"></div><div id="people-results" class="list"></div>`,true);const input=document.querySelector('#people-query'),box=document.querySelector('#people-results');const draw=()=>{const q=input.value.trim().toLowerCase().replace(/^@/,'');const rows=state.socialProfiles.filter(p=>p.id!==state.user.id&&(!q||String(p.username||'').includes(q)||String(p.display_name||'').toLowerCase().includes(q))).slice(0,30);box.innerHTML=rows.map(p=>{const follow=followFromMe(p.id);return `<div class="row"><button class="social-author" data-social-profile="${p.id}">${avatarMarkup(p,'small')}<span><strong>${esc(p.display_name||'Usuario')}</strong><small>@${esc(p.username||'sin_usuario')} · ${p.is_public?'Pública':'Privada'}</small></span></button>${follow?`<span class="status-chip">${follow.status==='accepted'?'Siguiendo':'Pendiente'}</span>`:`<button class="btn" data-follow-user="${p.id}">Seguir</button>`}</div>`}).join('')||'<div class="empty compact">Sin resultados.</div>';box.querySelectorAll('[data-follow-user]').forEach(b=>b.onclick=()=>toggleFollow(b.dataset.followUser));box.querySelectorAll('[data-social-profile]').forEach(b=>b.onclick=()=>openUserProfile(b.dataset.socialProfile));};input.oninput=draw;draw();}
async function respondFriendship(id,status){const {error}=await sb.from('friendships').update({status,responded_at:new Date().toISOString()}).eq('id',id);if(error)return toast(error.message,true);await refresh();toast(status==='accepted'?'Solicitud aceptada':'Solicitud rechazada');}
async function deleteSocialPost(id){if(!confirm('¿Borrar esta publicación?'))return;const post=state.socialPosts.find(p=>p.id===id);if(post?.image_path)await sb.storage.from('social').remove([post.image_path]);const {error}=await sb.from('social_posts').delete().eq('id',id);if(error)return toast(error.message,true);await refresh();toast('Publicación eliminada');}
async function receiptFileForSharing(tx){
  if(!tx?.receipt_path)return null;
  const {data,error}=await sb.storage.from('receipts').download(tx.receipt_path);
  if(error)throw error;
  const type=data.type||'image/jpeg';
  const ext=type==='image/png'?'png':type==='image/webp'?'webp':'jpg';
  return new File([data],`justificante-${tx.id}.${ext}`,{type});
}
function sharePreviewMarkup(tx,url=''){
  return `<div class="share-image-preview ${url?'has-image':''}" id="share-image-preview">${url?`<img src="${esc(url)}" alt="Vista previa de la publicación">`:'<div class="share-image-placeholder">Selecciona una imagen</div>'}<div class="social-overlay share-overlay-preview"><strong id="share-preview-caption">${esc(tx.concept)}</strong><span>${esc(kindLabels[tx.kind]||'Movimiento')}</span><span class="share-transaction-meta"><b>${money(tx.amount_cents)}</b><time>${esc(tx.occurred_on)}</time></span></div></div>`;
}
async function openShareTransaction(tx){
  let selectedFile=null,previewUrl='';
  if(tx.receipt_path){
    try{selectedFile=await receiptFileForSharing(tx);previewUrl=URL.createObjectURL(selectedFile);}catch(error){console.error('No se pudo reutilizar el justificante:',error);toast('No se pudo cargar automáticamente la imagen de la transacción.',true);}
  }
  modal(`<form id="share-post-form"><div class="modal-head"><div><h2>Compartir movimiento</h2><p class="muted">La fecha y el importe quedarán integrados dentro de la imagen.</p></div><button type="button" class="close-btn" data-close>×</button></div>${sharePreviewMarkup(tx,previewUrl)}<div class="field"><label>${selectedFile?'Cambiar foto':'Foto'}</label><input id="share-image-input" name="image" type="file" accept="image/*" ${selectedFile?'':'required'}><small class="muted">${selectedFile?'Se usará automáticamente el justificante de esta transacción. Puedes sustituirlo.':'Selecciona una imagen para publicar.'}</small></div><div class="field"><label>Texto personalizado</label><textarea name="caption" maxlength="180" placeholder="Añade un comentario…">${esc(tx.concept||'')}</textarea></div><div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Publicar</button></div></form>`);
  const form=document.querySelector('#share-post-form'),input=document.querySelector('#share-image-input'),caption=form.elements.caption;
  const updateCaption=()=>{const el=document.querySelector('#share-preview-caption');if(el)el.textContent=String(caption.value||tx.concept||'Movimiento').trim()||tx.concept||'Movimiento';};
  caption.addEventListener('input',updateCaption);
  input.addEventListener('change',()=>{const file=input.files?.[0];if(!file)return;selectedFile=file;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);const preview=document.querySelector('#share-image-preview');if(preview){preview.classList.add('has-image');preview.querySelector('img')?.remove();const img=document.createElement('img');img.src=previewUrl;img.alt='Vista previa de la publicación';preview.prepend(img);preview.querySelector('.share-image-placeholder')?.remove();}});
  form.onsubmit=async e=>{e.preventDefault();const b=e.submitter;if(!(selectedFile instanceof File)||!selectedFile.size)return toast('Selecciona una imagen.',true);busy(b,true);try{const file=await compressReceipt(selectedFile);const path=`${state.user.id}/${crypto.randomUUID()}.jpg`;const {error:up}=await sb.storage.from('social').upload(path,file,{contentType:'image/jpeg'});if(up)throw up;const {error}=await sb.from('social_posts').insert({user_id:state.user.id,transaction_id:tx.id,image_path:path,caption:String(caption.value||'').trim()});if(error)throw error;if(previewUrl)URL.revokeObjectURL(previewUrl);closeModal();await refresh();state.tab='social';renderShell();toast('Publicado');}catch(err){toast(err.message,true)}finally{busy(b,false)}};
}

function previousMonthReport(){
  const now=new Date(),start=new Date(now.getFullYear(),now.getMonth()-1,1),end=new Date(now.getFullYear(),now.getMonth(),0);
  const key=`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}`;
  const list=state.transactions.filter(t=>String(t.occurred_on||'').startsWith(key)&&!(t.is_transfer&&t.transfer_role==='destination'));
  return {label:start.toLocaleDateString('es-ES',{month:'long',year:'numeric'}),from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10),totals:totals(list),count:list.length};
}
function monthlyReportCard(){if(new Date().getDate()!==1)return '';const r=previousMonthReport();return `<article class="card monthly-report-card"><div class="card-head"><div><h2>Informe de ${esc(r.label)}</h2><p class="muted">Resumen automático del mes anterior · ${r.count} movimientos</p></div><button class="btn primary" data-share-month-report>Compartir</button></div><div class="monthly-report-grid"><div><span>Ingresos</span><strong class="income">${money(r.totals.income)}</strong></div><div><span>Gastos</span><strong class="expense">${money(r.totals.expense)}</strong></div><div><span>Ahorro</span><strong class="saving">${money(r.totals.saving)}</strong></div><div><span>Inversión</span><strong class="investment">${money(r.totals.investment)}</strong></div></div></article>`;}
function drawMonthlyReportImage(report,hidden,caption){
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1080;const ctx=canvas.getContext('2d');
  const grad=ctx.createLinearGradient(0,0,1080,1080);grad.addColorStop(0,'#0f172a');grad.addColorStop(1,'#0f766e');ctx.fillStyle=grad;ctx.fillRect(0,0,1080,1080);
  ctx.fillStyle='rgba(255,255,255,.08)';ctx.beginPath();ctx.arc(900,130,260,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(160,940,330,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#fff';ctx.font='700 68px sans-serif';ctx.fillText('A2C Finanzas',72,105);ctx.font='500 42px sans-serif';ctx.fillText(`Informe · ${report.label}`,72,175);
  const rows=[['Ingresos',report.totals.income,'#34d399','income'],['Gastos',report.totals.expense,'#fb7185','expense'],['Ahorro',report.totals.saving,'#fbbf24','saving'],['Inversión',report.totals.investment,'#60a5fa','investment']];
  rows.forEach((row,i)=>{const y=300+i*135;ctx.fillStyle='rgba(255,255,255,.12)';ctx.fillRect(72,y-58,936,102);ctx.fillStyle=row[2];ctx.font='600 35px sans-serif';ctx.fillText(row[0],100,y);ctx.fillStyle='#fff';ctx.font='700 42px sans-serif';const value=hidden[row[3]]?'Privado':money(row[1]);ctx.textAlign='right';ctx.fillText(value,972,y);ctx.textAlign='left';});
  ctx.fillStyle='#fff';ctx.font='400 34px sans-serif';const words=String(caption||'').trim().split(/\s+/);let line='',y=880;for(const word of words){const test=line?line+' '+word:word;if(ctx.measureText(test).width>900){ctx.fillText(line,72,y);line=word;y+=46;}else line=test;}if(line)ctx.fillText(line,72,y);
  ctx.font='400 24px sans-serif';ctx.fillStyle='rgba(255,255,255,.72)';ctx.fillText(`${report.from} — ${report.to}`,72,1010);
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(new File([b],`informe-${report.from}.jpg`,{type:'image/jpeg'})):reject(new Error('No se pudo generar la imagen.')),'image/jpeg',.86));
}
function openMonthlyReportShare(){const report=previousMonthReport(),hidden={income:false,expense:false,saving:false,investment:false};modal(`<form id="monthly-report-share"><div class="modal-head"><div><h2>Compartir informe mensual</h2><p class="muted">Pulsa el * de un importe para ocultarlo antes de publicar.</p></div><button type="button" class="close-btn" data-close>×</button></div><div class="monthly-report-share-grid">${[['income','Ingresos'],['expense','Gastos'],['saving','Ahorro'],['investment','Inversión']].map(([k,l])=>`<div class="monthly-share-row"><span>${l}</span><strong data-report-value="${k}">${money(report.totals[k])}</strong><button type="button" class="report-private-toggle" data-report-private="${k}" aria-label="Hacer privado ${l}">*</button></div>`).join('')}</div><div class="field"><label>Texto personalizado</label><textarea name="caption" maxlength="180" placeholder="Añade un comentario…"></textarea></div><div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Publicar informe</button></div></form>`);const form=document.querySelector('#monthly-report-share');form.querySelectorAll('[data-report-private]').forEach(b=>b.onclick=()=>{const k=b.dataset.reportPrivate;hidden[k]=!hidden[k];b.classList.toggle('active',hidden[k]);form.querySelector(`[data-report-value="${k}"]`).textContent=hidden[k]?'Privado':money(report.totals[k]);});form.onsubmit=async e=>{e.preventDefault();const b=e.submitter;busy(b,true);try{const caption=String(new FormData(form).get('caption')||'').trim();const file=await drawMonthlyReportImage(report,hidden,caption);const path=`${state.user.id}/report-${report.from}-${crypto.randomUUID()}.jpg`;const {error:up}=await sb.storage.from('social').upload(path,file,{contentType:'image/jpeg'});if(up)throw up;const {error}=await sb.from('social_posts').insert({user_id:state.user.id,transaction_id:null,image_path:path,caption:caption||`Informe de ${report.label}`});if(error)throw error;closeModal();await refresh();state.tab='social';renderShell();toast('Informe publicado');}catch(err){toast(err.message,true)}finally{busy(b,false)}};}

function renderStats(){
  const list=statsTransactions(),t=totals(list),series=monthlySeries(12,list);
  const expenses=conceptSpending(list,'expense'),portfolio=investmentPortfolio(list.filter(t=>!t.crypto_symbol)),savings=conceptSpending(list,'saving'),fuel=fuelStatistics(list),crypto=cryptoStats();
  const investmentTotalShares=portfolio.reduce((sum,row)=>sum+row.shares,0),investmentTotalMoney=portfolio.reduce((sum,row)=>sum+row.total,0);
  const maxExpense=Math.max(1,...expenses.map(c=>c.value));
  const cashflow=t.income-t.expense-t.investment-t.saving;
  const rate=t.income?Math.round((t.income-t.expense-t.investment)/t.income*100):0;
  return `<section>
    <div class="dashboard-head"><div><span class="eyebrow">Inteligencia financiera</span><h1>Estadísticas</h1><p class="muted">Analiza conceptos, ahorro, inversión y combustible.</p></div><div class="head-actions"><button class="btn ghost" data-export-csv>Exportar CSV</button></div></div>
    ${monthlyReportCard()}
    <form class="stats-toolbar stats-segments" id="stats-filter"><label>Desde<input name="from" type="date" value="${esc(state.filters.from)}"></label><label>Hasta<input name="to" type="date" value="${esc(state.filters.to)}"></label><label>Tipo<select name="kind"><option value="">Todos</option>${Object.entries(kindLabels).map(([k,l])=>`<option value="${k}" ${state.filters.kind===k?'selected':''}>${l}</option>`).join('')}</select></label><label>Segmento<select name="resourceType"><option value="">Todos</option><option value="main" ${state.filters.resourceType==='main'?'selected':''}>Cuenta principal</option><option value="piggy" ${state.filters.resourceType==='piggy'?'selected':''}>Huchas</option><option value="folder" ${state.filters.resourceType==='folder'?'selected':''}>Carpetas</option><option value="goal" ${state.filters.resourceType==='goal'?'selected':''}>Objetivos</option></select></label><label>Elemento<select name="resourceId"><option value="">Todos</option>${state.resources.filter(r=>!state.filters.resourceType||state.filters.resourceType===r.type).map(r=>`<option value="${r.id}" ${state.filters.resourceId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label><button type="button" class="period-chip" data-period="month">Este mes</button><button type="button" class="period-chip" data-period="quarter">3 meses</button><button type="button" class="period-chip" data-period="year">Este año</button></form>
    <div class="kpi-grid"><article class="kpi-card"><span>Flujo neto</span><strong class="${cashflow>=0?'income':'expense'}">${money(cashflow)}</strong><small>Ingresos menos salidas</small></article><article class="kpi-card"><span>Tasa de ahorro</span><strong class="${rate>=20?'income':'saving'}">${rate}%</strong><small>Sobre ingresos</small></article><article class="kpi-card"><span>Ahorro</span><strong class="saving">${money(t.saving)}</strong><small>Total seleccionado</small></article><article class="kpi-card"><span>Inversión</span><strong class="investment">${money(t.investment)}</strong><small>Total seleccionado</small></article></div>
    <article class="card chart-card"><div class="card-head"><div><h2>Tendencia financiera</h2><p class="muted">Ingresos y gastos mensuales</p></div><div class="chart-key"><span class="key-income">Ingresos</span><span class="key-expense">Gastos</span></div></div>${professionalLineChart(series)}</article>
    <div class="dashboard-grid"><article class="card"><div class="card-head"><div><h2>Gastos por concepto</h2><p class="muted">Sin categorías: agrupación por el texto del movimiento</p></div></div><div class="category-bars">${expenses.length?expenses.map(c=>`<div class="category-bar"><div><span>${esc(c.name)}</span><b>${money(c.value)}</b></div><div class="bar-track"><i style="width:${Math.round(c.value/maxExpense*100)}%"></i></div></div>`).join(''):'<div class="empty compact">No hay gastos en este periodo.</div>'}</div></article><article class="card investment-stats-card"><div class="card-head"><div><h2>Inversiones por ISIN</h2><p class="muted">Compras realizadas dentro de las fechas seleccionadas</p></div></div><div class="investment-summary-grid"><div class="fuel-stat"><span>Acciones compradas</span><strong>${investmentTotalShares.toLocaleString('es-ES',{maximumFractionDigits:6})}</strong></div><div class="fuel-stat"><span>Dinero invertido</span><strong>${money(investmentTotalMoney)}</strong></div><div class="fuel-stat"><span>ISIN distintos</span><strong>${portfolio.length}</strong></div></div><div class="portfolio-list">${portfolio.length?portfolio.map(p=>`<div class="portfolio-row investment-isin-row"><div><strong>${esc(p.company)}</strong><small>${esc(p.isin)} · ${p.count} compra${p.count===1?'':'s'} · ${p.shares.toLocaleString('es-ES',{maximumFractionDigits:6})} acciones</small></div><div><b>${money(p.total)}</b><small>Precio medio: ${p.averagePriceCents?money(p.averagePriceCents):'—'}</small></div></div>`).join(''):'<div class="empty compact">No hay inversiones en este segmento.</div>'}</div></article></div>
    <div class="dashboard-grid"><article class="card"><div class="card-head"><div><h2>Ahorro por objetivo o concepto</h2><p class="muted">Aportaciones registradas</p></div></div><div class="portfolio-list">${savings.length?savings.map(p=>`<div class="portfolio-row"><div><strong>${esc(p.name)}</strong><small>${p.count} aportación${p.count===1?'':'es'}</small></div><div><b>${money(p.value)}</b></div></div>`).join(''):'<div class="empty compact">No hay ahorros en este segmento.</div>'}</div></article><article class="card fuel-stats-card"><div class="card-head"><div><h2>Combustible</h2><p class="muted">Resumen según las fechas y filtros seleccionados</p></div></div><div class="fuel-stats-grid"><div class="fuel-stat"><span>Litros repostados</span><strong>${fuel.liters.toLocaleString('es-ES',{minimumFractionDigits:0,maximumFractionDigits:2})} L</strong></div><div class="fuel-stat"><span>Gasto total</span><strong>${money(fuel.spent)}</strong></div><div class="fuel-stat"><span>Precio medio</span><strong>${fuel.averagePriceMilli?(fuel.averagePriceMilli/1000).toLocaleString('es-ES',{minimumFractionDigits:3,maximumFractionDigits:3})+' €/L':'—'}</strong></div></div><div class="portfolio-list fuel-history">${fuel.rows.length?fuel.rows.map(x=>`<div class="portfolio-row"><div><strong>${esc(x.concept)}</strong><small>${esc(x.occurred_on)} · ${Number(x.fuel_liters).toLocaleString('es-ES',{maximumFractionDigits:2})} L · ${(Number(x.fuel_price_per_liter_milli||0)/1000).toLocaleString('es-ES',{minimumFractionDigits:3,maximumFractionDigits:3})} €/L</small></div><div><b>${money(x.amount_cents)}</b></div></div>`).join(''):'<div class="empty compact">No hay repostajes en el rango seleccionado.</div>'}</div></article></div>
    <article class="card crypto-stats-card"><div class="card-head"><div><h2>Criptomonedas</h2><p class="muted">Cartera actual y operaciones dentro de las fechas seleccionadas</p></div></div><div class="crypto-summary-grid"><div class="fuel-stat"><span>Criptos distintas</span><strong>${crypto.holdings.length}</strong></div><div class="fuel-stat"><span>Coste acumulado</span><strong>${money(crypto.totalCost)}</strong></div><div class="fuel-stat"><span>Operaciones</span><strong>${crypto.ledger.length}</strong></div></div><div class="portfolio-list">${crypto.holdings.length?crypto.holdings.map(h=>`<div class="portfolio-row crypto-row"><div><strong>${esc(h.crypto_name||h.symbol)} · ${esc(h.symbol)}</strong><small>${h.resource?.name?esc(h.resource.name):'Cuenta principal'} · ${Number(h.quantity).toLocaleString('es-ES',{maximumFractionDigits:8})} unidades</small></div><div><b>${money(h.total_cost_cents)}</b><small>Precio medio: ${Number(h.quantity)>0?money(Math.round(Number(h.total_cost_cents)/Number(h.quantity))):'—'}</small></div></div>`).join(''):'<div class="empty compact">Todavía no tienes criptomonedas.</div>'}</div><div class="crypto-ledger-list">${crypto.ledger.slice(0,20).map(row=>`<div class="mini-row"><div><strong>${esc(row.crypto_name||row.symbol)} · ${esc(row.action)}</strong><small>${esc(row.occurred_on)} · ${Number(row.quantity).toLocaleString('es-ES',{maximumFractionDigits:8})} ${esc(row.symbol)}</small></div><b>${row.eur_amount_cents?money(row.eur_amount_cents):''}</b></div>`).join('')}</div></article>
    <article class="card stats-history"><div class="card-head"><div><h2>Historial del segmento</h2><p class="muted">${list.length} movimientos según los filtros seleccionados</p></div></div><div class="list">${list.length?list.map(txRow).join(''):'<div class="empty compact">No hay movimientos para estos filtros.</div>'}</div></article>
  </section>`;
}

function bind(){
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;renderShell()});
  document.querySelector('#logout')?.addEventListener('click', async () => {
    try {
      const { error } = await sb.auth.signOut({ scope: 'local' });
      if (error) throw error;

      state.user = null;
      state.profile = null;
      state.profiles = [];
      state.resources = [];
      state.members = [];
      state.invitations = [];
      state.transactions = [];
      state.notifications = [];
      state.recurring = [];

      renderLogin();
    } catch (error) {
      console.error('Error al cerrar la sesión local:', error);
      toast(`No se pudo cerrar la sesión: ${error.message}`, true);
    }
  });
  document.querySelector('#install-app')?.addEventListener('click',async()=>{
    if(!deferredInstallPrompt){toast('Usa el menú del navegador y selecciona “Instalar aplicación”.');return;}
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    document.querySelector('#install-app')?.classList.add('hidden');
  });
  document.querySelector('#profile')?.addEventListener('click',openProfile);
  document.querySelector('#admin')?.addEventListener('click',openAdmin);
  document.querySelector('#notifications')?.addEventListener('click',openNotifications);
  document.querySelector('#finance-fab')?.addEventListener('click',openFloatingTransactionMenu);
  document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>openTransaction({kind:b.dataset.quick}));
  document.querySelectorAll('[data-new-tx]').forEach(b=>b.onclick=()=>openTransaction({}));
  document.querySelectorAll('[data-edit-tx]').forEach(b=>b.onclick=()=>openTransaction(state.transactions.find(t=>t.id===b.dataset.editTx)));
  document.querySelectorAll('[data-new-resource]').forEach(b=>b.onclick=()=>openResource({type:b.dataset.newResource}));
  document.querySelectorAll('[data-resource]').forEach(b=>b.onclick=()=>openResourceMenu(b.dataset.resource));
  document.querySelectorAll('[data-resource-crypto]').forEach(b=>b.onclick=e=>{e.stopPropagation();openResourceCryptoDetails(b.dataset.resourceCrypto)});
  document.querySelectorAll('[data-profile-id]').forEach(b=>b.onclick=e=>{e.stopPropagation();openUserProfile(b.dataset.profileId)});
  document.querySelectorAll('[data-tab-shortcut]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tabShortcut;renderShell()});
    document.querySelectorAll('[data-manage-recurring]').forEach(b=>b.onclick=openRecurring);
  document.querySelector('[data-export-csv]')?.addEventListener('click',exportCsv);
  document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>applyPeriod(b.dataset.period));
  document.querySelector('[data-find-people]')?.addEventListener('click',openPeopleSearch);
  document.querySelectorAll('[data-friend-accept]').forEach(b=>b.onclick=()=>respondFriendship(b.dataset.friendAccept,'accepted'));
  document.querySelectorAll('[data-friend-reject]').forEach(b=>b.onclick=()=>respondFriendship(b.dataset.friendReject,'rejected'));
  document.querySelectorAll('[data-follow-accept]').forEach(b=>b.onclick=()=>respondFollow(b.dataset.followAccept,'accepted'));
  document.querySelectorAll('[data-follow-reject]').forEach(b=>b.onclick=()=>respondFollow(b.dataset.followReject,'rejected'));
  document.querySelectorAll('[data-social-section]').forEach(b=>b.onclick=()=>{state.socialSection=b.dataset.socialSection;renderShell()});
  document.querySelectorAll('[data-social-list]').forEach(b=>b.onclick=()=>openSocialList(b.dataset.socialList));
  document.querySelector('[data-share-month-report]')?.addEventListener('click',openMonthlyReportShare);
  document.querySelectorAll('[data-social-profile]').forEach(b=>b.onclick=()=>openUserProfile(b.dataset.socialProfile));
  document.querySelectorAll('[data-open-own-post]').forEach(b=>b.onclick=()=>{const post=state.socialPosts.find(p=>p.id===b.dataset.openOwnPost);if(post)modal(`<div class="modal-head"><div><h2>@${esc(state.profile.username||'usuario')}</h2></div><button class="close-btn" data-close>×</button></div>${socialPostMarkup(post)}`,true)});
  document.querySelectorAll('[data-delete-post]').forEach(b=>b.onclick=()=>deleteSocialPost(b.dataset.deletePost));
  document.querySelectorAll('[data-receipt-path]').forEach(button=>button.onclick=async event=>{event.preventDefault();event.stopPropagation();await openReceipt(button.dataset.receiptPath)});
  const home=document.querySelector('.home-overview');
  if(home){
    const blocked=target=>Boolean(target.closest('button,a,input,select,textarea,.finance-donut-slice,[data-edit-tx]'));
    home.ondblclick=event=>{if(!blocked(event.target))openTransaction({kind:'expense'});};
    let lastTap=0;
    home.addEventListener('touchend',event=>{if(blocked(event.target))return;const now=Date.now();if(now-lastTap<360){event.preventDefault();lastTap=0;openTransaction({kind:'expense'});}else lastTap=now;},{passive:false});
  }
  const clearDonutSelection=()=>{const center=document.querySelector('#finance-donut-center');document.querySelectorAll('.finance-donut-slice.active').forEach(x=>x.classList.remove('active'));if(center)center.innerHTML=`<small>Patrimonio disponible</small><strong>${money(mainBalance())}</strong>`;};
  const showDonutValue=el=>{const center=document.querySelector('#finance-donut-center');if(!center)return;const label=el.dataset.donutLabel||'';const value=Number(el.dataset.donutValue)||0;document.querySelectorAll('.finance-donut-slice').forEach(x=>x.classList.toggle('active',x===el));center.innerHTML=`<small>${esc(label)}</small><strong>${money(value)}</strong>`;};
  document.querySelectorAll('.finance-donut-slice').forEach(el=>{el.onclick=e=>{e.stopPropagation();showDonutValue(el)};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();showDonutValue(el)}}});
  document.querySelector('.view')?.addEventListener('click',e=>{if(!e.target.closest('.finance-donut-slice'))clearDonutSelection()});
  const af=document.querySelector('#activity-filter');
  if(af)af.oninput=()=>{const fd=new FormData(af);Object.assign(state.filters,{query:String(fd.get('query')||''),from:String(fd.get('from')||''),to:String(fd.get('to')||''),kind:String(fd.get('kind')||''),resourceType:String(fd.get('resourceType')||''),resourceId:String(fd.get('resourceId')||'')});document.querySelector('#activity-list').innerHTML=filtered().map(txRow).join('')||'<div class="empty">No hay movimientos.</div>';bind()};
  const sf=document.querySelector('#stats-filter');
  if(sf)sf.onchange=()=>{const fd=new FormData(sf);Object.assign(state.filters,{from:String(fd.get('from')||''),to:String(fd.get('to')||''),kind:String(fd.get('kind')||''),resourceType:String(fd.get('resourceType')||''),resourceId:String(fd.get('resourceId')||'')});renderShell()};
}

function openFloatingTransactionMenu(){
  modal(`<div class="modal-head"><div><h2>Nuevo movimiento</h2><p class="muted">Selecciona el tipo de operación.</p></div><button class="close-btn" data-close>×</button></div>
    <div class="movement-type-grid">
      <button class="movement-type income" data-fab-kind="income"><span>↗</span><strong>Ingreso</strong></button>
      <button class="movement-type expense" data-fab-kind="expense"><span>↘</span><strong>Gasto</strong></button>
      <button class="movement-type saving" data-fab-kind="saving"><span>◎</span><strong>Ahorro</strong></button>
      <button class="movement-type investment" data-fab-kind="investment"><span>◆</span><strong>Inversión</strong></button>
    </div>`);
  document.querySelectorAll('[data-fab-kind]').forEach(b=>b.onclick=()=>openTransaction({kind:b.dataset.fabKind}));
}

function resourceOptions(selected='',kind='expense'){
  const allowed=state.resources.filter(r=>kind!=='saving'||r.type!=='goal');
  const normal=`<option value="">Cuenta principal</option>${allowed.map(r=>`<option value="${r.id}" ${selected===r.id?'selected':''}>${esc(r.name)} · ${resourceLabels[r.type]||r.type}</option>`).join('')}`;
  const crypto=kind==='expense'&&state.cryptoHoldings.some(h=>Number(h.quantity)>0)?`<optgroup label="Pagar con criptomonedas">${cryptoPaymentOptions(selected)}</optgroup>`:'';
  return normal+crypto;
}
function goalOptions(selected=''){return `<option value="">Sin objetivo</option>${state.resources.filter(r=>r.type==='goal').map(r=>`<option value="${r.id}" ${selected===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}`}
function openTransaction(tx={}){
  const editing=Boolean(tx.id),selectedKind=tx.kind||'expense',txCryptoLedger=tx.payment_method==='crypto'?state.cryptoLedger.find(row=>row.transaction_id===tx.id):null,txCryptoHolding=txCryptoLedger?state.cryptoHoldings.find(h=>h.symbol===txCryptoLedger.symbol&&String(h.resource_id||'')===String(txCryptoLedger.source_resource_id||'')):null,selectedResource=txCryptoHolding?`crypto:${txCryptoHolding.id}`:(tx.resource_id||'');
  modal(`<form id="tx-form"><div class="modal-head"><div><h2>${editing?'Editar':'Nuevo'} movimiento</h2><p class="muted">Registra el concepto, el importe y los detalles necesarios.</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="form-grid"><div class="field"><label>Tipo</label><select name="kind">${Object.entries(kindLabels).map(([k,label])=>`<option value="${k}" ${selectedKind===k?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label>Forma de pago</label><select name="payment_method"><option value="bank" ${tx.payment_method!=='cash'?'selected':''}>Banco</option><option value="cash" ${tx.payment_method==='cash'?'selected':''}>Efectivo</option></select></div></div>
    <div class="field"><label>Concepto</label><input name="concept" required value="${esc(tx.concept||'')}" placeholder="Ej. Nómina, gasolina, fondo indexado…"></div>
    <div class="field" id="resource-field"><label>Cuenta / espacio</label><select name="resource_id">${resourceOptions(selectedResource,selectedKind)}</select><small class="muted" id="piggy-transfer-note"></small></div><div class="crypto-payment-detail hidden" id="crypto-payment-detail"><div class="fuel-title">₿ Pago con criptomoneda</div><p class="muted">El gasto se registra en euros y descuenta unidades de la cripto seleccionada, sin reducir el saldo bancario.</p><div class="form-grid"><div class="field"><label>Cantidad utilizada</label><input name="crypto_spend_quantity" inputmode="decimal" value="${tx.payment_method==='crypto'?(tx.crypto_quantity||''):''}"></div><div class="field"><label>Valor por unidad al pagar (€)</label><input name="crypto_spend_unit_price" inputmode="decimal" value="${tx.payment_method==='crypto'&&tx.crypto_unit_price_cents?Number(tx.crypto_unit_price_cents)/100:''}"></div></div><div class="fuel-calculated" id="crypto-payment-calculated">Selecciona una criptomoneda e indica cantidad y valor.</div></div>
    <div class="field hidden" id="saving-goal-field"><label>Objetivo de ahorro</label><select name="saving_goal_id">${goalOptions(tx.kind==='saving'&&tx.resource?.type==='goal'?tx.resource_id:'')}</select><small class="muted">Puedes asignar el ahorro a un objetivo o dejarlo sin objetivo.</small></div>
    <div class="investment-detail hidden" id="investment-detail"><div class="fuel-title">◆ Detalle de inversión</div><div class="field"><label>Nombre de la empresa o criptomoneda</label><input name="investment_company" value="${esc(tx.kind==='investment'?(tx.concept||''):'')}" placeholder="Ej. Apple, Bitcoin, Ethereum…"></div><div id="stock-investment-fields"><div class="form-grid"><div class="field"><label>ISIN</label><input name="investment_isin" maxlength="12" value="${esc(tx.investment_isin||'')}" placeholder="Ej. US0378331005" autocapitalize="characters"></div><div class="field"><label>Número de acciones</label><input name="investment_quantity" inputmode="decimal" value="${tx.investment_quantity||''}" placeholder="0"></div><div class="field"><label>Precio por acción (€)</label><input name="investment_unit_price" inputmode="decimal" value="${tx.investment_unit_price_cents?Number(tx.investment_unit_price_cents)/100:''}" placeholder="0,00"></div></div></div><div id="crypto-investment-fields" class="hidden"><div class="crypto-badge">₿ Compra de criptomoneda detectada</div><div class="form-grid"><div class="field"><label>Símbolo</label><input name="crypto_symbol" value="${esc(tx.crypto_symbol||'')}" maxlength="12" placeholder="BTC"></div><div class="field"><label>Precio de compra (€)</label><input name="crypto_unit_price" inputmode="decimal" value="${tx.crypto_unit_price_cents?Number(tx.crypto_unit_price_cents)/100:''}" placeholder="0,00"></div><div class="field"><label>Cantidad comprada</label><input name="crypto_quantity" inputmode="decimal" value="${tx.crypto_quantity||''}" placeholder="0,00000000"></div><div class="field"><label>Comisión (€)</label><input name="crypto_fee" inputmode="decimal" value="${tx.crypto_fee_cents?Number(tx.crypto_fee_cents)/100:''}" placeholder="0,00"></div></div><div class="fee-mode"><span>La comisión:</span><button type="button" class="fee-mode-btn ${tx.crypto_fee_mode!=='subtract'?'active':''}" data-fee-mode="add">＋ Se añade al total</button><button type="button" class="fee-mode-btn ${tx.crypto_fee_mode==='subtract'?'active':''}" data-fee-mode="subtract">− Se resta de la compra</button><input type="hidden" name="crypto_fee_mode" value="${tx.crypto_fee_mode||'add'}"></div><p class="muted crypto-help">Al restarla, mantienes el desembolso base y recibes una cantidad ligeramente menor de cripto.</p></div><div class="fuel-calculated" id="investment-calculated">Introduce los datos para calcular el total.</div></div>
    <div class="fuel-detail hidden" id="fuel-detail"><div class="fuel-title">⛽ Detalle de combustible</div><p class="muted">Al escribir “Combustible” —también gasolina, diésel o repostaje— se activan estos campos.</p><div class="form-grid"><div class="field"><label>Precio por litro (€)</label><input name="fuel_price" inputmode="decimal" value="${tx.fuel_price_per_liter_milli?Number(tx.fuel_price_per_liter_milli)/1000:''}" placeholder="1,650"></div><div class="field"><label>Litros repostados</label><input name="fuel_liters" inputmode="decimal" value="${tx.fuel_liters||''}" placeholder="0,00"></div><div class="field"><label>Km desde anterior</label><input name="fuel_km" inputmode="decimal" value="${tx.fuel_km||''}" placeholder="Opcional"></div></div><div class="fuel-calculated" id="fuel-calculated">Introduce el precio por litro y los litros repostados para calcular el total.</div></div>
    <div class="split-expense-detail hidden" id="split-expense-detail"><div class="fuel-title">Dividir gasto</div><label class="split-enable"><input type="checkbox" id="split-enabled"><span><b>Compartir este gasto</b><small>Añade personas en partes iguales o con importes personalizados.</small></span></label><div id="split-controls" class="hidden"><div class="split-mode-grid"><button type="button" class="split-mode-btn active" data-split-mode="equal">Partes iguales</button><button type="button" class="split-mode-btn" data-split-mode="custom">Importes diferentes</button></div><div id="split-people-list" class="split-people-list"></div><button type="button" class="btn" id="add-split-person">＋ Añadir persona</button><div class="split-summary" id="split-summary">Restante: ${money(tx.amount_cents||0)}</div></div></div>
    <div class="field"><label>Importe total (€)</label><input name="amount" inputmode="decimal" required value="${tx.amount_cents?Number(tx.amount_cents)/100:''}"></div><div class="field"><label>Fecha</label><input name="date" type="date" required value="${tx.occurred_on||today()}"></div><div class="field"><label>Notas</label><textarea name="notes">${esc(tx.notes||'')}</textarea></div>
    <div class="field receipt-picker"><label>Justificante</label><div class="receipt-picker-actions"><button type="button" class="btn receipt-source-btn" id="open-integrated-camera">📷 Abrir cámara</button><label class="btn receipt-source-btn" for="receipt-gallery">▣ Elegir imagen</label></div><input id="receipt-gallery" name="receipt_gallery" class="receipt-file-input" type="file" accept="image/*"><small class="muted receipt-selection" id="receipt-selection">No se ha seleccionado ninguna imagen.</small></div>
    <div class="actions tx-form-actions">${editing?'<button type="button" class="btn danger" id="delete-tx">Borrar</button><button type="button" class="btn" id="share-tx-modal">▣ Compartir</button><button type="button" class="btn repeat-action-btn" id="repeat-tx-modal"><span>🔁</span> Repetir</button>':''}<button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,true);
  const form=document.querySelector('#tx-form'),kind=form.elements.kind,resource=form.elements.resource_id,concept=form.elements.concept,amount=form.elements.amount;
  const galleryInput=document.querySelector('#receipt-gallery'),receiptSelection=document.querySelector('#receipt-selection');
  let pendingReceiptFile=null;
  const setReceiptSelection=file=>{pendingReceiptFile=file||null;if(receiptSelection)receiptSelection.textContent=file?`Imagen seleccionada: ${file.name||'foto tomada'}`:'No se ha seleccionado ninguna imagen.';};
  document.querySelector('#open-integrated-camera')?.addEventListener('click',()=>openIntegratedCamera(file=>{if(galleryInput)galleryInput.value='';setReceiptSelection(file)}));
  galleryInput?.addEventListener('change',()=>setReceiptSelection(galleryInput.files?.[0]||null));
  const splitBox=document.querySelector('#split-expense-detail'),splitToggle=document.querySelector('#split-enabled'),splitControls=document.querySelector('#split-controls'),splitList=document.querySelector('#split-people-list'),splitSummary=document.querySelector('#split-summary');
  let splitMode='equal';
  const existingSplits=editing?state.expenseSplits.filter(x=>x.transaction_id===tx.id&&x.owner_id===state.user.id):[];
  const splitPersonOptions=()=>`<option value="">Persona externa</option>${state.socialProfiles.filter(p=>p.id!==state.user.id).map(p=>`<option value="${p.id}">@${esc(p.username||'usuario')} · ${esc(p.display_name||'Usuario')}</option>`).join('')}`;
  const addSplitRow=(row={})=>{splitList?.insertAdjacentHTML('beforeend',`<div class="split-person-row"><select class="split-user">${splitPersonOptions()}</select><input class="split-name" placeholder="Nombre" value="${esc(row.person_name||'')}"><input class="split-amount" inputmode="decimal" placeholder="0,00" value="${row.amount_cents?Number(row.amount_cents)/100:''}"><button type="button" class="split-remove">×</button></div>`);const el=splitList.lastElementChild;if(row.debtor_user_id)el.querySelector('.split-user').value=row.debtor_user_id;el.querySelector('.split-remove').onclick=()=>{el.remove();recalcSplits()};el.querySelectorAll('input,select').forEach(x=>x.oninput=x.onchange=recalcSplits);recalcSplits();};
  const recalcSplits=()=>{if(!splitSummary)return;const rows=[...splitList.querySelectorAll('.split-person-row')],total=cents(amount.value);if(splitMode==='equal'&&rows.length){const each=Math.floor(total/(rows.length+1));rows.forEach(r=>r.querySelector('.split-amount').value=(each/100).toFixed(2));}const assigned=rows.reduce((sum,r)=>sum+cents(r.querySelector('.split-amount').value),0),remaining=Math.max(0,total-assigned);splitSummary.innerHTML=`Asignado: <strong>${money(assigned)}</strong> · Tu parte/restante: <strong>${money(remaining)}</strong>`;};
  splitToggle?.addEventListener('change',()=>{splitControls.classList.toggle('hidden',!splitToggle.checked);if(splitToggle.checked&&!splitList.children.length)addSplitRow();});
  document.querySelector('#add-split-person')?.addEventListener('click',()=>addSplitRow());
  document.querySelectorAll('[data-split-mode]').forEach(b=>b.onclick=()=>{splitMode=b.dataset.splitMode;document.querySelectorAll('[data-split-mode]').forEach(x=>x.classList.toggle('active',x===b));recalcSplits()});
  amount.addEventListener('input',recalcSplits);
  if(existingSplits.length){splitToggle.checked=true;splitControls.classList.remove('hidden');existingSplits.forEach(addSplitRow);}
  const syncInvestment=()=>{const box=document.querySelector('#investment-calculated');if(!box)return;const crypto=isCryptoConcept(form.elements.investment_company?.value||concept.value);document.querySelector('#stock-investment-fields')?.classList.toggle('hidden',crypto);document.querySelector('#crypto-investment-fields')?.classList.toggle('hidden',!crypto);if(crypto){const symbol=cryptoSymbolFromConcept(form.elements.investment_company?.value||concept.value);if(symbol&&!form.elements.crypto_symbol.value)form.elements.crypto_symbol.value=symbol;const quantity=cryptoQty(form.elements.crypto_quantity?.value),unit=decimal(form.elements.crypto_unit_price?.value),fee=decimal(form.elements.crypto_fee?.value),mode=form.elements.crypto_fee_mode?.value||'add';if(quantity>0&&unit>0){const base=quantity*unit,total=mode==='add'?base+Math.max(0,fee):base;const received=mode==='subtract'&&fee>0?Math.max(0,(base-fee)/unit):quantity;amount.value=total.toFixed(2);box.textContent=`Total: ${new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(total)} · Recibirás ${received.toLocaleString('es-ES',{maximumFractionDigits:8})} ${form.elements.crypto_symbol.value||symbol}.`;}else box.textContent='Introduce precio y cantidad para calcular la compra.';return;}const quantity=positive(form.elements.investment_quantity?.value),unitPrice=positive(form.elements.investment_unit_price?.value);if(quantity&&unitPrice){const total=quantity*unitPrice;amount.value=total.toFixed(2);box.textContent=`Total calculado: ${new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(total)} (${quantity.toLocaleString('es-ES',{maximumFractionDigits:6})} acciones × ${unitPrice.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:4})} €).`;}else box.textContent='Introduce el número de acciones y el precio para calcular el total.';};
  const syncCryptoPayment=()=>{const box=document.querySelector('#crypto-payment-calculated');if(!box)return;const holding=String(resource.value).startsWith('crypto:')?state.cryptoHoldings.find(h=>h.id===String(resource.value).slice(7)):null;const qty=cryptoQty(form.elements.crypto_spend_quantity?.value),unit=positive(form.elements.crypto_spend_unit_price?.value);if(holding&&qty>0&&unit>0){amount.value=(qty*unit).toFixed(2);box.textContent=`Pagarás ${qty.toLocaleString('es-ES',{maximumFractionDigits:8})} ${holding.symbol} · Valor: ${new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(qty*unit)}.`;}else box.textContent='Selecciona una criptomoneda e indica cantidad y valor.';};
  const update=()=>{const saving=kind.value==='saving',investment=kind.value==='investment',cryptoPayment=kind.value==='expense'&&String(resource.value).startsWith('crypto:'),fuel=kind.value==='expense'&&!cryptoPayment&&isFuelConcept(concept.value);document.querySelector('#saving-goal-field').classList.toggle('hidden',!saving);splitBox?.classList.toggle('hidden',kind.value!=='expense');document.querySelector('#investment-detail').classList.toggle('hidden',!investment);document.querySelector('#fuel-detail').classList.toggle('hidden',!fuel);document.querySelector('#crypto-payment-detail')?.classList.toggle('hidden',!cryptoPayment);form.elements.payment_method.disabled=cryptoPayment;if(cryptoPayment)form.elements.payment_method.value='bank';if(investment&&form.elements.investment_company&&!form.elements.investment_company.value)form.elements.investment_company.value=concept.value;const selected=state.resources.find(r=>r.id===resource.value),selectedHolding=String(resource.value).startsWith('crypto:')?state.cryptoHoldings.find(h=>h.id===String(resource.value).slice(7)):null;document.querySelector('#piggy-transfer-note').textContent=selected?.type==='piggy'&&(kind.value==='income'||saving)?'Esta aportación se restará automáticamente de la cuenta principal.':selected?.type==='folder'?'Este movimiento afectará al saldo de la cuenta principal.':selectedHolding?`Disponible: ${Number(selectedHolding.quantity).toLocaleString('es-ES',{maximumFractionDigits:8})} ${selectedHolding.symbol}.`:'';syncFuel();syncInvestment();syncCryptoPayment();};
  const syncFuel=()=>{const liters=positive(form.elements.fuel_liters?.value),price=positive(form.elements.fuel_price?.value),km=positive(form.elements.fuel_km?.value),box=document.querySelector('#fuel-calculated');if(!box)return;if(liters&&price){const total=liters*price;amount.value=total.toFixed(2);const consumption=km?liters/km*100:null;box.textContent=`Total calculado: ${new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(total)} (${liters.toLocaleString('es-ES')} L × ${price.toLocaleString('es-ES',{minimumFractionDigits:3,maximumFractionDigits:3})} €/L).${consumption?` Consumo estimado: ${consumption.toLocaleString('es-ES',{maximumFractionDigits:2})} L/100 km.`:''}`;}else box.textContent='Introduce litros y precio por litro para calcular el total.';};
  kind.onchange=()=>{const old=resource.value;resource.innerHTML=resourceOptions(old,kind.value);update()};resource.onchange=update;concept.oninput=()=>{if(kind.value==='investment'&&form.elements.investment_company&&!form.elements.investment_company.dataset.edited)form.elements.investment_company.value=concept.value;update();};form.elements.investment_company?.addEventListener('input',()=>{form.elements.investment_company.dataset.edited='1';concept.value=form.elements.investment_company.value;});form.elements.investment_quantity?.addEventListener('input',syncInvestment);form.elements.investment_unit_price?.addEventListener('input',syncInvestment);form.elements.crypto_unit_price?.addEventListener('input',syncInvestment);form.elements.crypto_quantity?.addEventListener('input',syncInvestment);form.elements.crypto_spend_quantity?.addEventListener('input',syncCryptoPayment);form.elements.crypto_spend_unit_price?.addEventListener('input',syncCryptoPayment);form.elements.crypto_fee?.addEventListener('input',syncInvestment);document.querySelectorAll('[data-fee-mode]').forEach(btn=>btn.onclick=()=>{form.elements.crypto_fee_mode.value=btn.dataset.feeMode;document.querySelectorAll('[data-fee-mode]').forEach(x=>x.classList.toggle('active',x===btn));syncInvestment();});form.elements.fuel_liters?.addEventListener('input',syncFuel);form.elements.fuel_price?.addEventListener('input',syncFuel);form.elements.fuel_km?.addEventListener('input',syncFuel);update();
  form.onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(form);busy(b,true);try{const kindValue=String(fd.get('kind')),goalId=kindValue==='saving'?(fd.get('saving_goal_id')||null):null;const rawResource=String(fd.get('resource_id')||'');const cryptoPayment=kindValue==='expense'&&rawResource.startsWith('crypto:');const selectedHolding=cryptoPayment?state.cryptoHoldings.find(h=>h.id===rawResource.slice(7)):null;const selectedResourceId=cryptoPayment?(selectedHolding?.resource_id||null):(goalId||rawResource||null),selectedResource=state.resources.find(r=>r.id===selectedResourceId);const fuelActive=kindValue==='expense'&&!cryptoPayment&&isFuelConcept(fd.get('concept'));const investmentActive=kindValue==='investment';const cryptoActive=investmentActive&&isCryptoConcept(fd.get('investment_company')||fd.get('concept'));const liters=fuelActive?positive(fd.get('fuel_liters')):null,price=fuelActive?positive(fd.get('fuel_price')):null,km=fuelActive?positive(fd.get('fuel_km')):null;const investmentCompany=investmentActive?String(fd.get('investment_company')||fd.get('concept')||'').trim():String(fd.get('concept')||'').trim();const investmentIsin=investmentActive?String(fd.get('investment_isin')||'').trim().toUpperCase():null;const investmentQuantity=investmentActive?positive(fd.get('investment_quantity')):null;const investmentUnitPriceCents=investmentActive&&!cryptoActive?cents(fd.get('investment_unit_price')):null;const cryptoSymbol=cryptoActive?String(fd.get('crypto_symbol')||cryptoSymbolFromConcept(investmentCompany)).trim().toUpperCase():null;const cryptoRequestedQty=cryptoActive?cryptoQty(fd.get('crypto_quantity')):null;const cryptoUnitPriceCents=cryptoActive?cents(fd.get('crypto_unit_price')):null;const cryptoFeeCents=cryptoActive?Math.max(0,cents(fd.get('crypto_fee'))):0;const cryptoFeeMode=cryptoActive?String(fd.get('crypto_fee_mode')||'add'):null;const cryptoBaseCents=cryptoActive?Math.round(cryptoRequestedQty*cryptoUnitPriceCents):0;const cryptoEffectiveQty=cryptoActive&&cryptoFeeMode==='subtract'&&cryptoFeeCents>0&&cryptoUnitPriceCents>0?Math.max(0,(cryptoBaseCents-cryptoFeeCents)/cryptoUnitPriceCents):cryptoRequestedQty;const payload={kind:kindValue,category_id:null,merchant:'',payment_method:String(fd.get('payment_method')||'bank'),amount_cents:cents(fd.get('amount')),concept:investmentCompany,occurred_on:fd.get('date'),notes:String(fd.get('notes')||''),investment_isin:investmentIsin,investment_quantity:investmentQuantity,investment_unit_price_cents:investmentUnitPriceCents,crypto_symbol:cryptoSymbol,crypto_quantity:cryptoEffectiveQty,crypto_unit_price_cents:cryptoUnitPriceCents,crypto_fee_cents:cryptoFeeCents,crypto_fee_mode:cryptoFeeMode,fuel_liters:liters,fuel_price_per_liter_milli:price?Math.round(price*1000):null,fuel_km:km,fuel_consumption_l100km:liters&&km?Number((liters/km*100).toFixed(2)):null};if(fuelActive&&(!price||!liters))throw new Error('Indica el precio por litro y los litros repostados.');if(investmentActive){if(!investmentCompany)throw new Error('Indica el nombre de la inversión.');if(cryptoActive){if(!cryptoSymbol)throw new Error('Indica el símbolo de la criptomoneda.');if(!(cryptoRequestedQty>0))throw new Error('La cantidad de cripto debe ser mayor que cero.');if(!(cryptoUnitPriceCents>0))throw new Error('El precio de compra debe ser mayor que cero.');if(cryptoFeeMode==='subtract'&&cryptoFeeCents>=cryptoBaseCents)throw new Error('La comisión no puede ser igual o superior al importe de la compra.');payload.amount_cents=cryptoFeeMode==='add'?cryptoBaseCents+cryptoFeeCents:cryptoBaseCents;payload.investment_isin=null;payload.investment_quantity=null;payload.investment_unit_price_cents=null;}else{if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(investmentIsin||''))throw new Error('El ISIN debe contener 12 caracteres válidos.');if(!(investmentQuantity>0))throw new Error('El número de acciones debe ser mayor que cero.');if(!(investmentUnitPriceCents>0))throw new Error('El precio por acción debe ser mayor que cero.');payload.amount_cents=Math.round(investmentQuantity*investmentUnitPriceCents);}}if(payload.amount_cents<=0)throw new Error('El importe debe ser mayor que cero.');let id=tx.id;if(cryptoPayment){const qty=cryptoQty(fd.get('crypto_spend_quantity')),unit=cents(fd.get('crypto_spend_unit_price'));if(!selectedHolding)throw new Error('Selecciona una criptomoneda disponible.');if(qty<=0||(!editing&&qty>Number(selectedHolding.quantity)))throw new Error('La cantidad no es válida o supera el saldo disponible.');if(unit<=0)throw new Error('Indica un valor por unidad válido.');if(editing&&tx.payment_method==='crypto'){const {error}=await sb.rpc('a2c_update_crypto_payment',{p_transaction_id:tx.id,p_symbol:selectedHolding.symbol,p_quantity:qty,p_unit_price_cents:unit,p_resource_id:selectedHolding.resource_id||null,p_concept:payload.concept,p_occurred_on:payload.occurred_on,p_notes:payload.notes});if(error)throw error;id=tx.id;}else{const {data,error}=await sb.rpc('a2c_spend_crypto',{p_symbol:selectedHolding.symbol,p_quantity:qty,p_unit_price_cents:unit,p_resource_id:selectedHolding.resource_id||null,p_concept:payload.concept,p_occurred_on:payload.occurred_on,p_notes:payload.notes});if(error)throw error;id=data;}}else if(editing&&tx.crypto_symbol&&tx.kind==='investment'){const {error}=await sb.rpc('a2c_update_crypto_purchase',{p_transaction_id:tx.id,p_symbol:payload.crypto_symbol,p_crypto_name:payload.concept,p_quantity:payload.crypto_quantity,p_unit_price_cents:payload.crypto_unit_price_cents,p_fee_cents:payload.crypto_fee_cents,p_fee_mode:payload.crypto_fee_mode,p_resource_id:selectedResourceId});if(error)throw error;}else if(editing){const {error}=await sb.rpc('update_finance_transaction_v4',{p_transaction_id:tx.id,p_kind:payload.kind,p_category_id:null,p_merchant:'',p_payment_method:payload.payment_method,p_amount_cents:payload.amount_cents,p_concept:payload.concept,p_occurred_on:payload.occurred_on,p_notes:payload.notes,p_investment_isin:payload.investment_isin,p_investment_quantity:payload.investment_quantity,p_investment_unit_price_cents:payload.investment_unit_price_cents});if(error)throw error;const {error:extra}=await sb.from('finance_transactions').update({fuel_liters:payload.fuel_liters,fuel_price_per_liter_milli:payload.fuel_price_per_liter_milli,fuel_km:payload.fuel_km,fuel_consumption_l100km:payload.fuel_consumption_l100km,category_id:null,merchant:''}).eq('id',id);if(extra)throw extra;}else if(selectedResource?.type==='piggy'&&(kindValue==='income'||kindValue==='saving')){const {data,error}=await sb.rpc('create_piggy_transfer_v4',{p_piggy_id:selectedResource.id,p_amount_cents:payload.amount_cents,p_concept:payload.concept,p_occurred_on:payload.occurred_on,p_notes:payload.notes,p_payment_method:payload.payment_method});if(error)throw error;id=data;}else{const {data,error}=await sb.from('finance_transactions').insert({...payload,resource_id:selectedResourceId}).select('id').single();if(error)throw error;id=data.id;}if(cryptoActive&&!editing){const {error:cryptoError}=await sb.rpc('a2c_record_crypto_purchase',{p_transaction_id:id,p_symbol:payload.crypto_symbol,p_crypto_name:payload.concept,p_quantity:payload.crypto_quantity,p_unit_price_cents:payload.crypto_unit_price_cents,p_fee_cents:payload.crypto_fee_cents,p_fee_mode:payload.crypto_fee_mode,p_resource_id:selectedResourceId});if(cryptoError)throw cryptoError;}const originalFile=pendingReceiptFile||galleryInput?.files?.[0]||null;if(originalFile instanceof File&&originalFile.size){const file=await compressReceipt(originalFile);const ext=(file.type==='image/jpeg'?'jpg':(file.name.split('.').pop()||'img').toLowerCase());const path=`${state.user.id}/${id}/${crypto.randomUUID()}.${ext}`;const {error}=await sb.storage.from('receipts').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(error)throw error;const {error:pe}=await sb.from('finance_transactions').update({receipt_path:path}).eq('id',id);if(pe)throw pe;}if(kindValue==='expense'){await sb.from('expense_splits').delete().eq('transaction_id',id).eq('owner_id',state.user.id);if(splitToggle?.checked){const splitRows=[...splitList.querySelectorAll('.split-person-row')].map(r=>({owner_id:state.user.id,transaction_id:id,debtor_user_id:r.querySelector('.split-user').value||null,person_name:String(r.querySelector('.split-name').value||'').trim()||null,amount_cents:cents(r.querySelector('.split-amount').value),status:'pending'})).filter(r=>r.amount_cents>0);if(splitRows.length){const {error:splitError}=await sb.from('expense_splits').insert(splitRows);if(splitError)throw splitError;}}}closeModal();await refresh();toast(editing?'Movimiento actualizado':cryptoPayment?'Pago con cripto registrado':fuelActive?'Repostaje guardado':investmentActive?'Inversión guardada':goalId?'Ahorro asignado al objetivo':'Movimiento guardado');}catch(error){toast(error.message,true)}finally{busy(b,false)}};
  document.querySelector('#share-tx-modal')?.addEventListener('click',()=>openShareTransaction(tx));
  document.querySelector('#repeat-tx-modal')?.addEventListener('click',()=>{const copy={...tx,id:null,occurred_on:today(),receipt_path:null,is_transfer:false,transfer_group_id:null,transfer_role:null};openTransaction(copy);});
  document.querySelector('#delete-tx')?.addEventListener('click',async()=>{if(!confirm('¿Borrar este movimiento?'))return;const {error}=tx.crypto_symbol?await sb.rpc('a2c_delete_crypto_transaction',{p_transaction_id:tx.id}):await sb.rpc('delete_finance_transaction_v4',{p_transaction_id:tx.id});if(error)return toast(error.message,true);closeModal();await refresh();toast('Movimiento eliminado')});
}

function openResource(resource){
  const editing=Boolean(resource.id),label=resource.type==='piggy'?'hucha':resource.type==='folder'?'carpeta':'objetivo';
  modal(`<form id="resource-form"><div class="modal-head"><h2>${editing?'Editar':'Nuevo'} ${label}</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Nombre</label><input name="name" required value="${esc(resource.name||'')}"></div><div class="field"><label>Descripción</label><textarea name="description">${esc(resource.description||'')}</textarea></div>
    ${resource.type==='goal'?`<div class="field"><label>Objetivo (€)</label><input name="target" required value="${resource.target_cents?Number(resource.target_cents)/100:''}"></div><div class="field"><label>Fecha</label><input name="target_date" type="date" value="${esc(resource.target_date||'')}"></div>`:''}
    <label class="field"><span>Compartido</span><select name="shared"><option value="false">No</option><option value="true" ${resource.is_shared?'selected':''}>Sí</option></select></label>
    <div class="actions">${editing?'<button type="button" class="btn danger" id="delete-resource">Borrar</button>':''}<button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
  </form>`);
  document.querySelector('#resource-form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);
    const payload={name:String(fd.get('name')).trim(),description:String(fd.get('description')||''),is_shared:fd.get('shared')==='true'};
    if(resource.type==='goal'){payload.target_cents=cents(fd.get('target'));payload.target_date=fd.get('target_date')||null}
    const q=editing?sb.from('resources').update(payload).eq('id',resource.id):sb.from('resources').insert({...payload,type:resource.type});
    const {error}=await q;busy(b,false);if(error)return toast(error.message,true);closeModal();await refresh();toast('Guardado');
  };
  document.querySelector('#delete-resource')?.addEventListener('click',async()=>{if(!confirm('¿Borrar este elemento y sus movimientos?'))return;const {error}=await sb.from('resources').delete().eq('id',resource.id);if(error)return toast(error.message,true);closeModal();await refresh();toast('Eliminado')});
}
function openResourceMenu(id){
  const r=state.resources.find(x=>x.id===id);if(!r)return;
  modal(`<div class="modal-head"><div><h2>${esc(r.name)}</h2><p class="muted">${r.is_shared?'Compartido':'Personal'}</p></div><button class="close-btn" data-close>×</button></div><div class="menu-stack">
    <button class="btn" id="resource-edit">Editar</button>${r.is_shared?'<button class="btn" id="resource-invite">Invitar usuario</button>':''}<button class="btn" id="resource-view">Ver movimientos</button><button class="btn" id="resource-add-crypto">Agregar criptos</button><button class="btn" id="resource-crypto-history">Criptos e historial</button>
  </div>`);
  document.querySelector('#resource-edit').onclick=()=>openResource(r);
  document.querySelector('#resource-invite')?.addEventListener('click',()=>openInvite(r));
  document.querySelector('#resource-view').onclick=()=>{state.filters.resourceId=id;state.tab='activity';closeModal();renderShell()};document.querySelector('#resource-add-crypto').onclick=()=>openCryptoTransfer(id);document.querySelector('#resource-crypto-history').onclick=()=>openResourceCryptoDetails(id);
}
function openCryptoTransfer(destinationResourceId){
  const available=state.cryptoHoldings.filter(h=>Number(h.quantity)>0&&String(h.resource_id||'')!==String(destinationResourceId||''));
  if(!available.length)return toast('Primero debes comprar criptomonedas para poder agregarlas.',true);
  const destination=state.resources.find(r=>r.id===destinationResourceId);
  modal(`<form id="crypto-transfer-form"><div class="modal-head"><div><h2>Agregar criptos</h2><p class="muted">Mover a ${esc(destination?.name||'este elemento')} sin cambiar tu cantidad total.</p></div><button type="button" class="close-btn" data-close>×</button></div><div class="field"><label>Criptomoneda disponible</label><select name="holding_id" required>${available.map(h=>`<option value="${h.id}">${esc(holdingLabel(h))} · ${Number(h.quantity).toLocaleString('es-ES',{maximumFractionDigits:8})}</option>`).join('')}</select></div><div class="field"><label>Cantidad a mover</label><input name="quantity" inputmode="decimal" required placeholder="0,00000000"></div><div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Agregar criptos</button></div></form>`);
  document.querySelector('#crypto-transfer-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget),holding=available.find(h=>h.id===fd.get('holding_id')),qty=cryptoQty(fd.get('quantity'));if(!holding||qty<=0||qty>Number(holding.quantity))return toast('La cantidad no es válida o supera el saldo disponible.',true);busy(b,true);const {error}=await sb.rpc('a2c_transfer_crypto',{p_symbol:holding.symbol,p_quantity:qty,p_source_resource_id:holding.resource_id||null,p_destination_resource_id:destinationResourceId,p_occurred_on:today()});busy(b,false);if(error)return toast(error.message,true);closeModal();await refresh();toast('Criptomonedas agregadas');};
}
function openResourceCryptoDetails(resourceId){
  const resource=state.resources.find(r=>r.id===resourceId);if(!resource)return;
  const holdings=cryptoHoldingsForResource(resourceId),ledger=state.cryptoLedger.filter(row=>String(row.source_resource_id||'')===String(resourceId)||String(row.destination_resource_id||'')===String(resourceId));
  modal(`<div class="modal-head"><div><h2>Criptos de ${esc(resource.name)}</h2><p class="muted">${holdings.length} ${holdings.length===1?'criptomoneda':'criptomonedas'} con saldo · ${ledger.length} operaciones</p></div><button class="close-btn" data-close>×</button></div><div class="crypto-resource-holdings">${holdings.length?holdings.map(h=>`<article class="crypto-resource-card"><div><strong>${esc(h.crypto_name||h.symbol)} · ${esc(h.symbol)}</strong><small>${Number(h.quantity).toLocaleString('es-ES',{maximumFractionDigits:8})} unidades</small></div><b>${money(h.total_cost_cents)}</b></article>`).join(''):'<div class="empty compact">Este elemento no contiene criptomonedas.</div>'}</div><div class="card-head crypto-history-head"><div><h3>Historial cripto</h3><p class="muted">Compras, traspasos y pagos relacionados</p></div></div><div class="crypto-ledger-list">${ledger.length?ledger.map(row=>`<button type="button" class="crypto-ledger-item" data-edit-crypto-ledger="${row.id}"><div><strong>${esc(row.action)} · ${esc(row.crypto_name||row.symbol)}</strong><small>${esc(row.occurred_on)} · ${Number(row.quantity).toLocaleString('es-ES',{maximumFractionDigits:8})} ${esc(row.symbol)}</small></div><span>Editar</span></button>`).join(''):'<div class="empty compact">No hay operaciones cripto.</div>'}</div>`,true);
  document.querySelectorAll('[data-edit-crypto-ledger]').forEach(b=>b.onclick=()=>openCryptoLedgerEditor(b.dataset.editCryptoLedger,resourceId));
}
function openCryptoLedgerEditor(ledgerId,returnResourceId=null){
  const row=state.cryptoLedger.find(x=>x.id===ledgerId);if(!row)return;
  if(row.transaction_id){const tx=state.transactions.find(t=>t.id===row.transaction_id);if(tx)return openTransaction(tx);}
  if(row.action!=='TRASPASO')return toast('Esta operación no tiene un movimiento editable asociado.',true);
  const sourceOptions=`<option value="">Cuenta principal</option>${state.resources.map(r=>`<option value="${r.id}" ${String(r.id)===String(row.source_resource_id||'')?'selected':''}>${esc(r.name)}</option>`).join('')}`;
  const destOptions=`<option value="">Cuenta principal</option>${state.resources.map(r=>`<option value="${r.id}" ${String(r.id)===String(row.destination_resource_id||'')?'selected':''}>${esc(r.name)}</option>`).join('')}`;
  modal(`<form id="crypto-ledger-edit"><div class="modal-head"><div><h2>Editar traspaso cripto</h2><p class="muted">${esc(row.symbol)} · se recalcularán los saldos.</p></div><button type="button" class="close-btn" data-close>×</button></div><div class="field"><label>Origen</label><select name="source">${sourceOptions}</select></div><div class="field"><label>Destino</label><select name="destination">${destOptions}</select></div><div class="field"><label>Cantidad</label><input name="quantity" inputmode="decimal" value="${row.quantity}" required></div><div class="field"><label>Fecha</label><input name="date" type="date" value="${esc(row.occurred_on)}" required></div><div class="actions"><button type="button" class="btn danger" id="delete-crypto-ledger">Borrar</button><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  const form=document.querySelector('#crypto-ledger-edit');form.onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(form),qty=cryptoQty(fd.get('quantity'));if(qty<=0)return toast('Indica una cantidad válida.',true);busy(b,true);const {error}=await sb.rpc('a2c_update_crypto_transfer',{p_ledger_id:row.id,p_quantity:qty,p_source_resource_id:fd.get('source')||null,p_destination_resource_id:fd.get('destination')||null,p_occurred_on:fd.get('date')});busy(b,false);if(error)return toast(error.message,true);closeModal();await refresh(false);returnResourceId?openResourceCryptoDetails(returnResourceId):renderShell();toast('Traspaso actualizado');};
  document.querySelector('#delete-crypto-ledger').onclick=async()=>{if(!confirm('¿Borrar este traspaso cripto?'))return;const {error}=await sb.rpc('a2c_delete_crypto_transfer',{p_ledger_id:row.id});if(error)return toast(error.message,true);closeModal();await refresh(false);returnResourceId?openResourceCryptoDetails(returnResourceId):renderShell();toast('Traspaso eliminado');};
}
function openInvite(r){
  closeModal();modal(`<form id="invite-form"><div class="modal-head"><h2>Invitar a ${esc(r.name)}</h2><button type="button" class="close-btn" data-close>×</button></div><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Enviar</button></div></form>`);
  document.querySelector('#invite-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);const {error}=await sb.rpc('invite_resource_by_email',{p_resource_id:r.id,p_email:String(fd.get('email')).trim().toLowerCase()});busy(b,false);if(error)return toast(error.message,true);closeModal();await refresh();toast('Invitación enviada')};
}

function openNotifications(){
  modal(`<div class="modal-head"><div><h2>Notificaciones</h2></div><button class="close-btn" data-close>×</button></div><div class="list">${state.notifications.map(n=>`<article class="notification"><div><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p><small>${new Date(n.created_at).toLocaleString('es-ES')}</small></div><div class="notification-actions">
    ${n.type==='invitation'&&!n.read_at?`<button class="btn success" data-accept="${n.related_id}">Aceptar</button><button class="btn danger" data-reject="${n.related_id}">Rechazar</button>`:''}${!n.read_at?`<button class="btn" data-read="${n.id}">Leída</button>`:''}<button class="btn danger" data-delete-note="${n.id}">Borrar</button>
  </div></article>`).join('')||'<div class="empty">No hay notificaciones.</div>'}</div>`,true);
  document.querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>respondInvite(b.dataset.accept,true));
  document.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>respondInvite(b.dataset.reject,false));
  document.querySelectorAll('[data-read]').forEach(b=>b.onclick=async()=>{await sb.from('notifications').update({read_at:new Date().toISOString()}).eq('id',b.dataset.read);await refresh(false);openNotifications()});
  document.querySelectorAll('[data-delete-note]').forEach(b=>b.onclick=async()=>{await sb.from('notifications').delete().eq('id',b.dataset.deleteNote);await refresh(false);openNotifications()});
}
async function respondInvite(id,accept){const {error}=await sb.rpc('respond_resource_invitation',{p_invitation_id:id,p_accept:accept});if(error)return toast(error.message,true);await refresh(false);openNotifications();toast(accept?'Invitación aceptada':'Invitación rechazada')}


function applyPeriod(period){
  const now=new Date(),to=now.toISOString().slice(0,10);
  let from=new Date(now);
  if(period==='month')from=new Date(now.getFullYear(),now.getMonth(),1);
  if(period==='quarter')from=new Date(now.getFullYear(),now.getMonth()-2,1);
  if(period==='year')from=new Date(now.getFullYear(),0,1);
  state.filters.from=from.toISOString().slice(0,10);
  state.filters.to=to;
  renderShell();
}
function exportCsv(){
  const rows=[['Fecha','Tipo','Concepto / Empresa','ISIN','Acciones','Precio acción','Forma de pago','Espacio','Litros','Precio litro','Km','Consumo L/100 km','Símbolo cripto','Cantidad cripto','Precio cripto','Comisión cripto','Modo comisión','Importe']];
  for(const t of filtered())rows.push([t.occurred_on,kindLabels[t.kind],t.concept,t.investment_isin||'',t.investment_quantity||'',t.investment_unit_price_cents?(Number(t.investment_unit_price_cents)/100).toFixed(4):'',t.payment_method==='cash'?'Efectivo':'Banco',t.resource?.name||'Cuenta principal',t.fuel_liters||'',t.fuel_price_per_liter_milli?(Number(t.fuel_price_per_liter_milli)/1000).toFixed(3):'',t.fuel_km||'',t.fuel_consumption_l100km||'',t.crypto_symbol||'',t.crypto_quantity||'',t.crypto_unit_price_cents?(Number(t.crypto_unit_price_cents)/100).toFixed(4):'',t.crypto_fee_cents?(Number(t.crypto_fee_cents)/100).toFixed(2):'',t.crypto_fee_mode||'',(Number(t.amount_cents)/100).toFixed(2)]);
  const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(';')).join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`a2c-movimientos-${today()}.csv`;a.click();URL.revokeObjectURL(url);
}
function openRecurring(){
  modal(`<div class="modal-head"><div><h2>Movimientos recurrentes</h2><p class="muted">Suscripciones, nómina, alquiler y pagos periódicos.</p></div><button class="close-btn" data-close>×</button></div>
    <button class="btn primary" id="new-recurring">Nuevo recurrente</button>
    <div class="list" style="margin-top:14px">${state.recurring.map(r=>`<div class="row"><div><strong>${esc(r.concept)}</strong><small>${kindLabels[r.kind]} · Próximo: ${esc(r.next_date)} · ${esc(r.frequency)}</small></div><div><b>${money(r.amount_cents)}</b> <button class="btn danger" data-delete-recurring="${r.id}">Borrar</button></div></div>`).join('')||'<div class="empty compact">Sin movimientos recurrentes.</div>'}</div>`,true);
  document.querySelector('#new-recurring').onclick=openRecurringForm;
  document.querySelectorAll('[data-delete-recurring]').forEach(b=>b.onclick=async()=>{const {error}=await sb.from('recurring_transactions').delete().eq('id',b.dataset.deleteRecurring);if(error)return toast(error.message,true);await refresh(false);openRecurring()});
}
function openRecurringForm(){
  closeModal();
  modal(`<form id="recurring-form"><div class="modal-head"><h2>Nuevo movimiento recurrente</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="form-grid">
      <div class="field"><label>Tipo</label><select name="kind">${Object.entries(kindLabels).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="field"><label>Frecuencia</label><select name="frequency"><option value="weekly">Semanal</option><option value="monthly" selected>Mensual</option><option value="quarterly">Trimestral</option><option value="yearly">Anual</option></select></div>
    </div>
    <div class="field"><label>Concepto</label><input name="concept" required></div>
    <div class="form-grid"><div class="field"><label>Importe (€)</label><input name="amount" required></div><div class="field"><label>Próxima fecha</label><input name="next_date" type="date" value="${today()}" required></div></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
  </form>`);
  document.querySelector('#recurring-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),b=e.submitter;busy(b,true);const {error}=await sb.from('recurring_transactions').insert({user_id:state.user.id,kind:fd.get('kind'),frequency:fd.get('frequency'),concept:fd.get('concept'),amount_cents:cents(fd.get('amount')),next_date:fd.get('next_date'),active:true});busy(b,false);if(error)return toast(error.message,true);closeModal();await refresh();toast('Movimiento recurrente guardado')};
}

async function openReceipt(path){
  if(!path)return;
  try{
    const {data,error}=await sb.storage.from('receipts').createSignedUrl(path,300);
    if(error)throw error;
    const url=data?.signedUrl;
    if(!url)throw new Error('No se pudo obtener la imagen.');
    modal(`<div class="modal-head"><div><h2>Justificante</h2><p class="muted">Pulsa fuera para cerrar</p></div><button type="button" class="close-btn" data-close>×</button></div><div class="receipt-preview"><img src="${esc(url)}" alt="Justificante de la transacción"></div>`,true);
  }catch(error){toast(error.message||'No se pudo abrir el justificante.',true);}
}

function findProfile(profileId){
  if(state.profile?.id===profileId)return state.profile;
  return state.members.find(m=>m.profile?.id===profileId)?.profile||state.profiles.find(p=>p.id===profileId)||null;
}
function openUserProfile(profileId){
  const profile=state.socialProfiles.find(p=>p.id===profileId)||findProfile(profileId);if(!profile)return toast('No se pudo cargar el perfil.',true);
  const own=profileId===state.user.id,visible=canSeeProfilePosts(profileId),posts=visible?state.socialPosts.filter(p=>p.user_id===profileId):[];
  const follow=own?null:followFromMe(profileId);
  modal(`<div class="modal-head"><div><h2>Perfil</h2><p class="muted">@${esc(profile.username||'usuario')}</p></div><button type="button" class="close-btn" data-close>×</button></div><div class="public-profile social-public-profile">${rankingBadgesMarkup(profileId,true)}${avatarMarkup(profile,'profile-avatar-large')}<h3>${esc(profile.display_name||'Usuario')}</h3><p>@${esc(profile.username||'usuario')}</p><div class="social-counts"><div><strong>${followerCount(profileId)}</strong><span>Seguidores</span></div><div><strong>${followingCount(profileId)}</strong><span>Seguidos</span></div><div><strong>${posts.length}</strong><span>Publicaciones</span></div></div>${metricCards(profileId)}${!own?`<button class="btn ${follow?.status==='accepted'?'':'primary'}" id="profile-follow">${follow?.status==='accepted'?'Dejar de seguir':follow?.status==='pending'?'Cancelar solicitud':'Seguir'}</button>`:''}</div>${visible?`<div class="profile-post-grid">${posts.length?posts.map(p=>`<button data-open-post="${p.id}"><img src="${esc(socialImageUrl(p))}" alt="Publicación" loading="lazy"></button>`).join(''):'<div class="empty compact">Sin publicaciones.</div>'}</div>`:'<div class="empty">Esta cuenta es privada. Sigue al usuario para ver sus publicaciones.</div>'}`,true);
  document.querySelector('#profile-follow')?.addEventListener('click',()=>toggleFollow(profileId));
  document.querySelectorAll('[data-open-post]').forEach(b=>b.onclick=()=>{const post=state.socialPosts.find(p=>p.id===b.dataset.openPost);if(post)modal(`<div class="modal-head"><div><h2>@${esc(profile.username||'usuario')}</h2></div><button class="close-btn" data-close>×</button></div>${socialPostMarkup(post)}`,true);});
}
function openProfile(){
  modal(`<form id="profile-form"><div class="modal-head"><div><h2>Mi perfil</h2><p class="muted">${esc(state.profile.email)}</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="profile-photo-editor">${avatarMarkup(state.profile,'profile-avatar-large')}<div><label class="btn receipt-source-btn" for="avatar-file">Cambiar foto</label><input class="receipt-file-input" id="avatar-file" name="avatar" type="file" accept="image/*"><button type="button" class="text-btn ${state.profile.avatar_path?'':'hidden'}" id="remove-avatar">Eliminar foto</button><small class="muted" id="avatar-selection">Imagen cuadrada, comprimida automáticamente.</small></div></div>
    <div class="field"><label>Nombre</label><input name="name" required minlength="2" maxlength="80" value="${esc(state.profile.display_name||'')}"></div><div class="field"><label>Nombre de usuario</label><div class="input-prefix"><span>@</span><input name="username" required minlength="3" maxlength="30" pattern="[a-z0-9._]+" value="${esc(state.profile.username||'')}" placeholder="abel.atero"></div><small class="muted">Solo minúsculas, números, punto y guion bajo.</small></div><div class="field"><label>Privacidad</label><select name="is_public"><option value="true" ${state.profile.is_public!==false?'selected':''}>Cuenta pública</option><option value="false" ${state.profile.is_public===false?'selected':''}>Cuenta privada</option></select></div><div class="field"><label>Nueva contraseña</label><input name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password"></div><div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  const form=document.querySelector('#profile-form'),fileInput=document.querySelector('#avatar-file'),selection=document.querySelector('#avatar-selection');let removeAvatar=false;
  fileInput.onchange=()=>{const f=fileInput.files?.[0];if(f){selection.textContent=f.name;removeAvatar=false;}};
  document.querySelector('#remove-avatar')?.addEventListener('click',()=>{removeAvatar=true;fileInput.value='';selection.textContent='La foto se eliminará al guardar.';});
  form.onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(form);busy(b,true);try{
    let avatarPath=state.profile.avatar_path||null;const file=fileInput.files?.[0];
    if(removeAvatar&&avatarPath){await sb.storage.from('avatars').remove([avatarPath]);avatarPath=null;}
    if(file instanceof File&&file.size){const compressed=await compressAvatar(file);const path=`${state.user.id}/avatar.jpg`;const {error:uploadError}=await sb.storage.from('avatars').upload(path,compressed,{contentType:'image/jpeg',upsert:true,cacheControl:'3600'});if(uploadError)throw uploadError;avatarPath=path;}
    const p=String(fd.get('password')||'');
    const {data,error}=await sb.functions.invoke('account-settings',{body:{display_name:String(fd.get('name')||''),username:String(fd.get('username')||''),is_public:fd.get('is_public')==='true',avatar_path:avatarPath,password:p}});
    if(error||!data?.ok)throw new Error(data?.error||error?.message||'No se pudo actualizar el perfil.');
    closeModal();await enter();toast('Perfil actualizado');
  }catch(error){toast(error.message,true)}finally{busy(b,false)}};
}
function openAdmin(){
  modal(`<div class="modal-head"><div><h2>Administración</h2><p class="muted">Usuarios y permisos</p></div><button class="close-btn" data-close>×</button></div><button class="btn primary" id="new-user">Crear usuario</button><div class="list" style="margin-top:14px">${state.profiles.map(p=>`<article class="row"><div><strong>${esc(p.display_name||p.email)}</strong><small>${esc(p.email)} · ${esc(p.role)} · ${p.active?'Activo':'Inactivo'}</small></div><button class="btn" data-user="${p.id}">Gestionar</button></article>`).join('')}</div>`,true);
  document.querySelector('#new-user').onclick=()=>openUserForm(null);
  document.querySelectorAll('[data-user]').forEach(b=>b.onclick=()=>openUserForm(state.profiles.find(p=>p.id===b.dataset.user)));
}
function openUserForm(p){
  closeModal();modal(`<form id="user-form"><div class="modal-head"><h2>${p?'Editar':'Crear'} usuario</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Email</label><input name="email" type="email" maxlength="254" autocapitalize="none" spellcheck="false" required value="${esc(p?.email||'')}" ${p?'disabled':''}></div><div class="field"><label>Nombre</label><input name="name" minlength="2" maxlength="80" required value="${esc(p?.display_name||'')}"></div>
    <div class="field"><label>Rol</label><select name="role"><option value="user">Usuario</option><option value="admin" ${p?.role==='admin'?'selected':''}>Administrador</option></select></div>
    <div class="field"><label>Estado</label><select name="active"><option value="true">Activo</option><option value="false" ${p?.active===false?'selected':''}>Inactivo</option></select></div>
    <div class="field"><label>${p?'Nueva contraseña':'Contraseña inicial'}</label><input name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" ${p?'':'required'}></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  document.querySelector('#user-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);const {data,error}=await sb.functions.invoke('admin-users',{body:{action:p?'update':'create',user_id:p?.id,email:p?.email||String(fd.get('email')).trim().toLowerCase(),display_name:String(fd.get('name')).trim(),role:fd.get('role'),active:fd.get('active')==='true',password:String(fd.get('password')||''),permissions:p?.permissions||{can_create_shared:true,can_invite:true,can_upload_receipts:true}}});busy(b,false);if(error||!data?.ok)return toast(data?.error||error?.message||'No se pudo guardar',true);closeModal();await refresh();openAdmin();toast('Usuario guardado')};
}

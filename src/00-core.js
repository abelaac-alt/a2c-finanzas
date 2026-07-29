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


const createClient = window.supabase?.createClient;
if (!createClient) {
  throw new Error('No se pudo cargar el componente de conexión de Supabase.');
}


const A2C_BOOT_TIMEOUT_MS = 18000;
window.__A2C_BOOT_STATUS = 'starting';

function a2cWithTimeout(promise, milliseconds, label='operación') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Tiempo agotado durante ${label}. Comprueba la conexión e inténtalo de nuevo.`)),
      milliseconds
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function a2cMarkReady() {
  window.__A2C_BOOT_STATUS = 'ready';
  window.dispatchEvent(new CustomEvent('a2c:ready'));
}

const cfg = window.A2C_CONFIG || {};
const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const sb = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

const state = {
  user: null, profile: null, tab: 'home', socialSection: 'feed', toolsSection: 'piggy', statsSection: 'stats', legalFilters: {from:'',to:''},
  profiles: [], resources: [], members: [], invitations: [],
  transactions: [], notifications: [],
  recurring: [], scheduledExpenses: [], cryptoHoldings: [], cryptoLedger: [],
  socialPosts: [], socialLikes: [], socialComments: [], friendships: [], follows: [], socialProfiles: [],
  expenseSplits: [], stockSales: [], leaderboard: [], budgets: [],
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
      activeCameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:1280,max:1920},height:{ideal:720,max:1080},frameRate:{ideal:30,max:30}}});
      video.srcObject=activeCameraStream;
      await video.play();
      if(video.requestVideoFrameCallback)await new Promise(resolve=>video.requestVideoFrameCallback(()=>resolve()));
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
      video.classList.add('capturing');
      const maxSide=1600;
      const scale=Math.min(1,maxSide/Math.max(video.videoWidth,video.videoHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
      canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
      const ctx=canvas.getContext('2d',{alpha:false});
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('No se pudo capturar la fotografía.')),'image/jpeg',0.76));
      const file=new File([blob],`foto-${Date.now()}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
      video.pause();
      close();
      requestAnimationFrame(()=>onCapture?.(file));
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
async function retrySupabase(operation,attempts=2){
  let lastError;
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const result=await operation();
      if(result?.error)throw result.error;
      return result;
    }catch(error){
      lastError=error;
      const transient=error instanceof TypeError||/load failed|failed to fetch|network/i.test(String(error?.message||''));
      if(!transient||attempt===attempts-1)throw error;
      await new Promise(resolve=>setTimeout(resolve,650));
    }
  }
  throw lastError;
}
function fatal(error){
  window.__A2C_BOOT_STATUS='error';
  console.error(error);
  app.innerHTML=`<section class="auth-shell"><div class="auth-card"><h1>No se pudo cargar A2C Finanzas</h1><p class="muted">${esc(error?.message||'Error desconocido')}</p><button class="btn primary full" onclick="location.reload()">Reintentar</button></div></section>`;
}


window.addEventListener('error', event => {
  if (window.__A2C_BOOT_STATUS !== 'ready') {
    fatal(event.error || new Error(event.message || 'Error durante el inicio.'));
  }
});
window.addEventListener('unhandledrejection', event => {
  if (window.__A2C_BOOT_STATUS !== 'ready') {
    fatal(event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Error durante el inicio.')));
  }
});

if(!sb) fatal(new Error('Configura config.js con la URL y la clave pública de Supabase.'));
else boot().catch(fatal);

async function boot(){
  const {data:{session}}=await a2cWithTimeout(sb.auth.getSession(), A2C_BOOT_TIMEOUT_MS, 'la sesión');
  state.user=session?.user||null;
  if(state.user) await a2cWithTimeout(enter(), A2C_BOOT_TIMEOUT_MS, 'la carga de tus datos'); else renderLogin();
  a2cMarkReady();

  sb.auth.onAuthStateChange(async(_event,session)=>{
    state.user=session?.user||null;
    if(state.user) await a2cWithTimeout(enter(), A2C_BOOT_TIMEOUT_MS, 'la actualización de la sesión'); else renderLogin();
    a2cMarkReady();
  });
}

function renderLogin(){
  a2cMarkReady();
  app.innerHTML=`<section class="auth-shell"><form class="auth-card" id="login-form">
    <div class="brand"><img class="brand-logo brand-logo-login" src="./logo-a2c.png" alt="Logotipo de A2C Finanzas"><div><h1>A2C Finanzas</h1><p class="muted">Finanzas personales y compartidas</p></div></div>
    <div class="field"><label>Email o @usuario</label><input name="identifier" type="text" autocomplete="username" maxlength="254" autocapitalize="none" spellcheck="false" required placeholder="correo@ejemplo.com o @usuario"></div>
    <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" minlength="6" maxlength="256" required></div>
    <label class="remember-login"><input name="remember" type="checkbox"><span>Recordar acceso en este dispositivo</span></label>
    <button class="btn primary full">Entrar</button>
  </form></section>`;
  const rememberedIdentifier=localStorage.getItem('a2c_remembered_identifier')||'';
  const loginForm=document.querySelector('#login-form');
  if(rememberedIdentifier){
    loginForm.elements.identifier.value=rememberedIdentifier;
    loginForm.elements.remember.checked=true;
  }
  loginForm.onsubmit=async e=>{
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
      const remember=fd.get('remember')==='on';
      if(remember)localStorage.setItem('a2c_remembered_identifier',identifier);
      else localStorage.removeItem('a2c_remembered_identifier');
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

  setTimeout(async()=>{
    try{
      const [transferRun,expenseRun]=await Promise.all([
        sb.rpc('a2c_process_my_scheduled_movements_v63'),
        sb.rpc('a2c_process_my_scheduled_expenses_v66')
      ]);
      if(transferRun.error)console.warn(transferRun.error);
      if(expenseRun.error)console.warn(expenseRun.error);
      const processed=Number(transferRun.data||0)+Number(expenseRun.data||0);
      if(processed>0){
        await loadAll();
        renderShell();
        toast(`${processed} movimiento(s) programado(s) ejecutado(s).`);
      }
    }catch(error){
      console.warn('Los movimientos programados no bloquearon la aplicación:',error);
    }
  },700);
}

async function loadAll(){
  const q=[
    sb.from('resources').select('*').order('created_at',{ascending:false}),
    sb.from('resource_members').select('*,profile:profiles(id,email,display_name,avatar_path)').order('created_at'),
    sb.from('resource_invitations').select('*').order('created_at',{ascending:false}),
    sb.from('finance_transactions').select('*,resource:resources(id,name,type)').order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
    sb.from('notifications').select('*').order('created_at',{ascending:false}),
    sb.from('scheduled_movements_v63').select('*').order('next_run',{ascending:true}),
    sb.from('scheduled_expenses_v66').select('*').order('next_run',{ascending:true}),
    sb.from('crypto_holdings').select('*,resource:resources(id,name,type)').order('symbol'),
    sb.from('crypto_ledger').select('*,source:resources!crypto_ledger_source_resource_id_fkey(id,name,type),destination:resources!crypto_ledger_destination_resource_id_fkey(id,name,type)').order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
    sb.from('friendships').select('*').or(`requester_id.eq.${state.user.id},addressee_id.eq.${state.user.id}`).order('created_at',{ascending:false}),
    sb.from('profiles').select('id,email,display_name,avatar_path,username,is_public').order('username').limit(500),
    sb.from('expense_splits').select('*,transaction:finance_transactions(id,concept,amount_cents,occurred_on,kind,resource_id),owner:profiles!expense_splits_owner_id_fkey(id,display_name,username),debtor:profiles!expense_splits_debtor_user_id_fkey(id,display_name,username)').or(`owner_id.eq.${state.user.id},debtor_user_id.eq.${state.user.id}`).order('created_at',{ascending:false}),
    sb.from('stock_sales').select('*').order('occurred_on',{ascending:false})
  ];
  if(isAdmin())q.push(sb.from('profiles').select('*').order('email'));

  const result=await Promise.all(q);
  result.forEach((row,index)=>{
    if(!row?.error)return;
    console.warn(`A2C: consulta opcional ${index} no disponible`,row.error);
    result[index]={data:[]};
  });

  [
    state.resources,
    state.members,
    state.invitations,
    state.transactions,
    state.notifications,
    state.recurring,
    state.scheduledExpenses,
    state.cryptoHoldings,
    state.cryptoLedger,
    state.friendships,
    state.socialProfiles,
    state.expenseSplits,
    state.stockSales
  ]=result.slice(0,13).map(row=>row.data||[]);

  // Red social retirada: no se cargan publicaciones, imágenes, likes,
  // comentarios, seguidores ni clasificaciones.
  state.socialPosts=[];
  state.socialLikes=[];
  state.socialComments=[];
  state.follows=[];
  state.leaderboard=[];

  const accessibleResourceIds=new Set(state.resources.map(resource=>String(resource.id)));
  state.transactions=state.transactions.filter(row=>{
    const creator=row?.creator_id;
    if(creator!=null&&String(creator)===String(state.user.id))return true;
    return row?.resource_id!=null&&accessibleResourceIds.has(String(row.resource_id));
  });

  state.recurring=state.recurring.filter(row=>String(row.user_id)===String(state.user.id));
  state.scheduledExpenses=state.scheduledExpenses.filter(row=>String(row.user_id)===String(state.user.id));
  state.notifications=state.notifications.filter(row=>String(row.user_id)===String(state.user.id));
  state.expenseSplits=state.expenseSplits.filter(row=>
    String(row.owner_id)===String(state.user.id)
    ||String(row.debtor_user_id)===String(state.user.id)
  );

  state.profiles=isAdmin()?(result[13]?.data||[]):[];
  const budgetResult=await sb.from('budgets_v67').select('*').eq('user_id',state.user.id).order('period_month',{ascending:false}).order('created_at',{ascending:false});
  state.budgets=budgetResult.error?[]:(budgetResult.data||[]);
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
uiIcons.tools=uiIcons.folder;
function nav(tab,label){return `<button class="nav-btn ${state.tab===tab?'active':''}" data-tab="${tab}" aria-label="${label}" title="${label}">${uiIcons[tab]}<span>${label}</span></button>`}
function renderShell(){
  a2cMarkReady();
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
    <nav class="bottom-nav" aria-label="Navegación principal">${nav('home','Inicio')}${nav('tools','Herramientas')}${nav('activity','Actividad')}${nav('stats','Estadísticas')}</nav>
  </div>`;
  bind();
}
function toolsTabs(){
  const tabs=[['piggy','Huchas'],['folder','Carpetas'],['goal','Objetivos'],['budget','Presupuestos']];
  const budgetMask="url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cg fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='5' y='3' width='14' height='18' rx='3'/%3E%3Cpath d='M9 8h6M9 12h6M9 16h4M8 3v3M12 3v3M16 3v3'/%3E%3C/g%3E%3C/svg%3E\")";
  return `<style id="a2c-budget-tab-style">
    .v47-tools-tabs .v47-tool-tab[data-tools-section="budget"]::before{
      content:""!important;width:24px!important;height:24px!important;display:block!important;
      background-color:currentColor!important;-webkit-mask:${budgetMask} center/contain no-repeat!important;
      mask:${budgetMask} center/contain no-repeat!important;
    }
    .v47-tools-tabs .v47-tool-tab[data-tools-section="budget"]{gap:7px!important}
  </style><nav class="section-tabs" aria-label="Herramientas">${tabs.map(([key,label])=>`<button class="${state.toolsSection===key?'active':''}" data-tools-section="${key}" ${key==='budget'?'data-v47-icon="budget" data-v47-label="Presupuestos"':''}><span>${label}</span></button>`).join('')}</nav>`;
}
function renderTools(){return `<section class="hub-page"><div class="dashboard-head"><div><span class="eyebrow">Organización</span><h1>Herramientas</h1><p class="muted">Gestiona huchas, carpetas, objetivos, presupuestos y movimientos automáticos.</p></div><div class="head-actions"><button type="button" class="btn primary" data-manage-recurring>Movimientos programados</button></div></div>${toolsTabs()}${state.toolsSection==='budget'?renderBudgets():renderResources(state.toolsSection)}</section>`;}

const budgetCategoryMeta={
  alimentacion:{label:'Alimentación',icon:'🛒'},
  ocio:{label:'Ocio',icon:'🎟️'},
  salud:{label:'Salud',icon:'❤'},
  combustible:{label:'Combustible',icon:'⛽'},
  suscripciones:{label:'Suscripciones',icon:'↻'},
  otros:{label:'Otros',icon:'◌'}
};
function normalizeBudgetText(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function detectBudgetCategory(tx){
  if(tx?.budget_category&&budgetCategoryMeta[tx.budget_category])return tx.budget_category;
  const text=normalizeBudgetText(`${tx?.concept||''} ${tx?.merchant||''} ${tx?.notes||''}`);
  const rules={
    combustible:['gasolina','diesel','gasoil','combustible','repostaje','gasolinera','cepsa','repsol','galp','shell','bp '],
    alimentacion:['mercadona','lidl','aldi','carrefour','supermercado','alimentacion','comida','panaderia','carniceria','fruteria','hipercor','eroski','alcampo','dia%',' dia '],
    salud:['medico','padel','futbol','farmacia','medicina','medicinas','salud','clinica','dentista','fisioterapia','gimnasio','deporte'],
    suscripciones:['netflix','google one','google storage','amazon prime','prime video','chatgpt','openai','claude','anthropic','hbo','max','disney','spotify','youtube premium','apple music','icloud','dropbox','microsoft 365','office 365'],
    ocio:['cine','escapada','hotel','concierto','bar','restaurante','discoteca','teatro','viaje','vacaciones','pub','ocio']
  };
  for(const [category,words] of Object.entries(rules))if(words.some(word=>text.includes(word.replace('%',''))))return category;
  return 'otros';
}
function budgetMonthLabel(value){const [year,month]=String(value||currentMonthKey()).split('-').map(Number);return new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(new Date(year,Math.max(0,month-1),1));}
function budgetSpent(budget){return state.transactions.filter(tx=>tx.kind==='expense'&&String(tx.occurred_on||'').startsWith(budget.period_month)&&detectBudgetCategory(tx)===budget.category_key).reduce((sum,tx)=>sum+Number(tx.amount_cents||0),0);}
function budgetSeriesId(budget){return String(budget?.series_id||budget?.id||'');}
function budgetTransactions(budget){return state.transactions.filter(tx=>tx.kind==='expense'&&String(tx.occurred_on||'').startsWith(budget.period_month)&&detectBudgetCategory(tx)===budget.category_key);}
function budgetCard(budget){
  const rows=budgetTransactions(budget),spent=rows.reduce((sum,tx)=>sum+Number(tx.amount_cents||0),0),limit=Number(budget.amount_cents||0),remaining=Math.max(0,limit-spent),pct=limit>0?Math.min(100,Math.round(spent/limit*100)):0,meta=budgetCategoryMeta[budget.category_key]||budgetCategoryMeta.otros;
  const status=pct>=100?'exceeded':pct>=80?'warning':'healthy';
  return `<article class="budget-card-compact ${status}" data-open-budget="${budget.id}" role="button" tabindex="0">
    <div class="budget-compact-main"><span class="budget-compact-icon">${meta.icon}</span><div class="budget-compact-copy"><strong>${esc(budget.name||meta.label)}</strong><small>${money(spent)} de ${money(limit)} · ${rows.length} movimientos</small></div><b>${pct}%</b><button type="button" class="icon-btn budget-menu" data-edit-budget="${budget.id}" aria-label="Editar presupuesto">⋮</button></div>
    <div class="budget-progress"><i style="width:${pct}%"></i></div><div class="budget-compact-foot"><span>${money(remaining)} disponibles</span><span>${esc(meta.label)}</span></div>
  </article>`;
}
function openBudgetDetails(budget){
  if(!budget)return;
  const txs=budgetTransactions(budget),meta=budgetCategoryMeta[budget.category_key]||budgetCategoryMeta.otros;
  modal(`<div class="modal-head"><div><span class="eyebrow">${esc(meta.label)}</span><h2>${esc(budget.name)}</h2><p class="muted">${esc(budgetMonthLabel(budget.period_month))} · ${txs.length} transacciones</p></div><button class="close-btn" data-close>×</button></div>
    <div class="budget-detail-list">${txs.length?txs.map(tx=>`<button type="button" class="budget-detail-tx" data-edit-tx="${tx.id}"><span><strong>${esc(tx.merchant||tx.concept||'Gasto')}</strong><small>${esc(tx.occurred_on)}</small></span><b>${money(tx.amount_cents)}</b></button>`).join(''):'<div class="empty compact">Todavía no hay gastos asignados.</div>'}</div>
    <div class="actions"><button type="button" class="btn" id="budget-add-transactions">Añadir transacciones</button><button type="button" class="btn primary" id="budget-edit-current">Editar presupuesto</button></div>`,true);
  document.querySelector('#budget-edit-current').onclick=()=>openBudgetForm(budget);
  document.querySelector('#budget-add-transactions').onclick=()=>openBudgetTransactionPicker(budget);
  document.querySelectorAll('.budget-detail-tx').forEach(button=>button.onclick=()=>openTransaction(state.transactions.find(tx=>String(tx.id)===String(button.dataset.editTx))));
}
function openBudgetTransactionPicker(budget){
  const candidates=state.transactions.filter(tx=>tx.kind==='expense'&&String(tx.occurred_on||'').startsWith(budget.period_month));
  modal(`<div class="modal-head"><div><h2>Añadir transacciones</h2><p class="muted">Al asignarlas, A2C aprenderá el comercio para futuras compras.</p></div><button class="close-btn" data-close>×</button></div><div class="budget-picker-list">${candidates.map(tx=>`<label class="budget-picker-row"><input type="checkbox" value="${tx.id}" ${detectBudgetCategory(tx)===budget.category_key?'checked':''}><span><strong>${esc(tx.merchant||tx.concept||'Gasto')}</strong><small>${esc(tx.occurred_on)} · ${money(tx.amount_cents)}</small></span><em>${esc((budgetCategoryMeta[detectBudgetCategory(tx)]||budgetCategoryMeta.otros).label)}</em></label>`).join('')||'<div class="empty compact">No hay gastos este mes.</div>'}</div><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="save-budget-transactions">Guardar selección</button></div>`,true);
  document.querySelector('#save-budget-transactions').onclick=async()=>{const ids=[...document.querySelectorAll('.budget-picker-row input:checked')].map(input=>input.value);if(!ids.length)return toast('Selecciona al menos una transacción.',true);const {error}=await sb.rpc('a2c_assign_transactions_budget_v70',{p_transaction_ids:ids,p_category_key:budget.category_key});if(error)return toast(error.message,true);closeModal();await refresh();toast('Transacciones asignadas y regla aprendida.');};
}
function renderBudgets(){
  const month=currentMonthKey(),rows=state.budgets.filter(row=>row.active!==false&&row.period_month===month);
  const total=rows.reduce((sum,row)=>sum+Number(row.amount_cents||0),0),spent=rows.reduce((sum,row)=>sum+budgetSpent(row),0),pct=total>0?Math.min(100,Math.round(spent/total*100)):0;
  return `<style>
    .section-tabs [data-tools-section="budget"]{display:inline-flex;align-items:center;gap:7px}
    .budget-overview{background:linear-gradient(135deg,#17131f,#34275c);color:#fff;border-radius:20px;padding:16px 17px;margin-bottom:12px;box-shadow:0 10px 24px rgba(47,35,81,.14)}
    .budget-overview-top,.budget-card-head,.budget-numbers,.budget-foot{display:flex;align-items:center;justify-content:space-between;gap:12px}.budget-overview h2{margin:3px 0 0;font-size:28px}.budget-overview .muted{color:rgba(255,255,255,.68)}
    .budget-overview-track,.budget-progress{height:11px;background:rgba(255,255,255,.13);border-radius:999px;overflow:hidden;margin-top:16px}.budget-overview-track i,.budget-progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#7557ff,#9d83ff);transition:width .35s ease}.budget-overview-foot{display:flex;justify-content:space-between;margin-top:9px;font-size:12px;color:rgba(255,255,255,.72)}
    .budget-grid{display:grid;grid-template-columns:1fr;gap:9px}.budget-card-compact{background:#fff;border:1px solid rgba(104,78,190,.10);border-radius:17px;padding:12px 13px;box-shadow:0 5px 16px rgba(27,20,45,.05);cursor:pointer}.budget-compact-main{display:flex;align-items:center;gap:10px}.budget-compact-icon{width:34px;height:34px;border-radius:11px;background:#f2effc;display:grid;place-items:center}.budget-compact-copy{min-width:0;flex:1}.budget-compact-copy strong,.budget-compact-copy small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.budget-compact-copy small{font-size:11px;color:var(--muted);margin-top:2px}.budget-compact-main>b{font-size:13px}.budget-compact-foot{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:6px}.budget-detail-list,.budget-picker-list{display:grid;gap:7px;max-height:54vh;overflow:auto}.budget-detail-tx,.budget-picker-row{display:flex;align-items:center;gap:10px;width:100%;border:1px solid #ece9f3;background:#fff;border-radius:14px;padding:11px;text-align:left}.budget-detail-tx span,.budget-picker-row span{min-width:0;flex:1}.budget-detail-tx strong,.budget-detail-tx small,.budget-picker-row strong,.budget-picker-row small{display:block}.budget-detail-tx small,.budget-picker-row small{font-size:11px;color:var(--muted);margin-top:2px}.budget-picker-row em{font-size:10px;color:var(--muted);font-style:normal}.budget-icon{width:46px;height:46px;border-radius:15px;background:linear-gradient(145deg,#f1edff,#e7fbf7);display:grid;place-items:center;font-size:22px}.budget-card-head>div:nth-child(2){flex:1}.budget-card-head h3{margin:0}.budget-card-head p{margin:3px 0 0}.budget-menu{font-size:22px}.budget-numbers{margin-top:20px}.budget-numbers strong{font-size:21px}.budget-numbers strong small{font-size:11px;font-weight:500;color:var(--muted)}.budget-numbers span{font-size:13px;color:var(--muted)}.budget-progress{height:10px;background:#edeaf3}.budget-card.warning .budget-progress i{background:linear-gradient(90deg,#efb145,#f08e4b)}.budget-card.exceeded .budget-progress i{background:linear-gradient(90deg,#dc4c4c,#ef7272)}.budget-foot{margin-top:8px;font-size:12px;color:var(--muted)}.budget-foot b{color:var(--text)}
    .budget-empty{padding:34px;text-align:center;border:1px dashed rgba(104,78,190,.25);border-radius:22px;background:rgba(255,255,255,.6)}
    .budget-duration-note{padding:11px 13px;border-radius:14px;background:#f5f2ff;color:#5c489a;font-size:12px}
  </style><section class="budgets-page">
    <div class="budget-overview"><div class="budget-overview-top"><div><span class="eyebrow">Presupuesto del mes en curso</span><h2>${money(Math.max(0,total-spent))}</h2><p class="muted">Disponible de ${money(total)}</p></div><button type="button" class="btn primary" data-new-budget>Nuevo presupuesto</button></div><div class="budget-overview-track"><i style="width:${pct}%"></i></div><div class="budget-overview-foot"><span>${money(spent)} consumidos</span><span>${pct}%</span></div></div>
    ${rows.length?`<div class="budget-grid">${rows.map(budgetCard).join('')}</div>`:`<div class="budget-empty"><h3>Crea tu primer presupuesto</h3><p class="muted">Define un límite para alimentación, ocio, salud, combustible o suscripciones durante uno o varios meses.</p><button class="btn primary" data-new-budget>Crear presupuesto</button></div>`}
  </section>`;
}
function openBudgetForm(existing=null){
  const month=existing?.start_month||existing?.period_month||currentMonthKey(),category=existing?.category_key||'alimentacion';
  const seriesRows=existing?state.budgets.filter(row=>budgetSeriesId(row)===budgetSeriesId(existing)):[];
  const defaultMonths=Math.max(1,Number(existing?.months_count||seriesRows.length||1));
  modal(`<form id="budget-form"><div class="modal-head"><div><h2>${existing?'Editar':'Nuevo'} presupuesto</h2><p class="muted">Se guardará en tu cuenta y los gastos se clasificarán automáticamente.</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Nombre</label><input name="name" maxlength="80" required value="${esc(existing?.name||budgetCategoryMeta[category].label)}" placeholder="Presupuesto de alimentación"></div>
    <div class="field"><label>Categoría</label><select name="category_key">${Object.entries(budgetCategoryMeta).filter(([key])=>key!=='otros').map(([key,meta])=>`<option value="${key}" ${key===category?'selected':''}>${meta.icon} ${meta.label}</option>`).join('')}</select></div>
    <div class="field"><label>Importe máximo por mes</label><input name="amount" inputmode="decimal" required value="${existing?(Number(existing.amount_cents||0)/100).toLocaleString('es-ES',{minimumFractionDigits:2}):''}" placeholder="300,00"></div>
    <div class="grid two"><div class="field"><label>Mes de inicio</label><input name="start_month" type="month" required value="${esc(month)}"></div><div class="field"><label>Número de meses</label><input name="months_count" type="number" min="1" max="60" step="1" required value="${defaultMonths}"></div></div>
    <div class="budget-duration-note">Se creará el mismo límite mensual durante el número de meses indicado. Podrás consultar los meses anteriores y futuros en Estadísticas.</div>
    <label class="v59-switch-row"><span><strong>Presupuesto activo</strong><small>Se mostrará en Herramientas y en el widget durante cada mes programado.</small></span><input type="checkbox" name="active" ${existing?.active===false?'':'checked'}><i></i></label>
    <div class="actions">${existing?'<button type="button" class="btn danger" id="delete-budget">Eliminar</button>':''}<button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  const form=document.querySelector('#budget-form');
  form.querySelector('[name="category_key"]').onchange=e=>{if(!existing||form.elements.name.value===budgetCategoryMeta[category].label)form.elements.name.value=budgetCategoryMeta[e.target.value].label;};
  form.onsubmit=async e=>{
    e.preventDefault();
    const button=e.submitter,fd=new FormData(form),amount=cents(fd.get('amount')),months=Math.max(1,Math.min(60,Number(fd.get('months_count')||1)));
    if(amount<=0)return toast('Indica un importe mayor que cero.',true);
    busy(button,true);
    const {data,error}=await sb.rpc('a2c_save_budget_series_v68',{
      p_series_id:existing?budgetSeriesId(existing):null,
      p_name:String(fd.get('name')||'').trim(),
      p_category_key:String(fd.get('category_key')),
      p_amount_cents:amount,
      p_start_month:String(fd.get('start_month')),
      p_months:months,
      p_active:fd.get('active')==='on'
    });
    busy(button,false);
    if(error)return toast(`No se pudo guardar el presupuesto: ${error.message}`,true);
    closeModal();await refresh();state.tab='tools';state.toolsSection='budget';renderShell();toast(existing?'Presupuesto actualizado':'Presupuesto guardado correctamente');
  };
  document.querySelector('#delete-budget')?.addEventListener('click',async()=>{
    if(!confirm('¿Eliminar este presupuesto y todos los meses asociados?'))return;
    const {error}=await sb.rpc('a2c_delete_budget_series_v68',{p_series_id:budgetSeriesId(existing)});
    if(error)return toast(error.message,true);
    closeModal();await refresh();state.tab='tools';state.toolsSection='budget';renderShell();toast('Presupuesto eliminado');
  });
}
function budgetStatsArchive(){
  const current=currentMonthKey();
  const rows=state.budgets
    .filter(row=>row.period_month!==current)
    .sort((a,b)=>String(b.period_month).localeCompare(String(a.period_month)));
  if(!rows.length)return '';
  const byMonth=new Map();
  rows.forEach(row=>{
    const key=String(row.period_month||'');
    if(!byMonth.has(key))byMonth.set(key,[]);
    byMonth.get(key).push(row);
  });
  const months=[...byMonth.entries()].sort((a,b)=>String(b[0]).localeCompare(String(a[0])));
  return `<article class="card budget-history-card budget-history-discreet"><style>
    .budget-history-discreet{margin-top:18px;padding:0;overflow:hidden;border:1px solid rgba(104,78,190,.10);box-shadow:none;background:rgba(255,255,255,.62)}
    .budget-history-intro{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 17px;border-bottom:1px solid rgba(104,78,190,.08)}
    .budget-history-intro h2{font-size:15px;margin:0}.budget-history-intro p{font-size:11px;margin:3px 0 0}.budget-history-count{font-size:11px;color:var(--muted);white-space:nowrap}
    .budget-month-details{border-bottom:1px solid rgba(104,78,190,.07)}.budget-month-details:last-child{border-bottom:0}
    .budget-month-details>summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 17px;cursor:pointer;font-size:13px;font-weight:650;color:var(--text)}
    .budget-month-details>summary::-webkit-details-marker{display:none}.budget-month-details>summary::after{content:'⌄';font-size:16px;color:var(--muted);transition:transform .2s ease}.budget-month-details[open]>summary::after{transform:rotate(180deg)}
    .budget-month-summary-copy{display:flex;align-items:center;gap:10px;min-width:0}.budget-month-dot{width:8px;height:8px;border-radius:999px;background:#8065e8;flex:0 0 auto}.budget-month-details.future .budget-month-dot{background:#42aa89}
    .budget-month-summary-copy span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.budget-month-summary-copy small{font-size:10px;color:var(--muted);font-weight:500;white-space:nowrap}
    .budget-month-content{padding:0 13px 13px;display:grid;gap:7px}.budget-archive-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 11px;border-radius:13px;background:#f8f7fb}
    .budget-archive-row strong,.budget-archive-row small{display:block}.budget-archive-row strong{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.budget-archive-row small{font-size:10px;color:var(--muted);margin-top:2px}.budget-archive-row>div:last-child{text-align:right}.budget-archive-row b{font-size:11px;white-space:nowrap}
  </style><div class="budget-history-intro"><div><h2>Presupuestos por mes</h2><p class="muted">Pulsa un mes para consultar sus presupuestos.</p></div><span class="budget-history-count">${months.length} mes${months.length===1?'':'es'}</span></div>
  <div class="budget-month-list">${months.map(([month,monthRows])=>{
    const isFuture=month>current,total=monthRows.reduce((sum,row)=>sum+Number(row.amount_cents||0),0),spent=monthRows.reduce((sum,row)=>sum+budgetSpent(row),0);
    return `<details class="budget-month-details ${isFuture?'future':'previous'}"><summary><span class="budget-month-summary-copy"><i class="budget-month-dot"></i><span>${esc(budgetMonthLabel(month))}</span><small>${monthRows.length} presupuesto${monthRows.length===1?'':'s'}</small></span><b>${money(spent)} / ${money(total)}</b></summary><div class="budget-month-content">${monthRows.map(row=>{const meta=budgetCategoryMeta[row.category_key]||budgetCategoryMeta.otros,rowSpent=budgetSpent(row),pct=Math.min(100,Math.round(rowSpent/Math.max(1,Number(row.amount_cents))*100));return `<div class="budget-archive-row"><div><strong>${esc(row.name)}</strong><small>${esc(meta.label)} · ${pct}% consumido</small></div><div><b>${money(rowSpent)} / ${money(row.amount_cents)}</b></div></div>`;}).join('')}</div></details>`;
  }).join('')}</div></article>`;
}

function statsTabs(){const tabs=[['stats','Estadísticas'],['legal','Legal']];return `<nav class="section-tabs" aria-label="Estadísticas y legal">${tabs.map(([key,label])=>`<button class="${state.statsSection===key?'active':''}" data-stats-section="${key}">${label}</button>`).join('')}</nav>`;}
function renderStatsHub(){return `<section class="hub-page">${statsTabs()}${state.statsSection==='legal'?renderLegalReport():renderStatsDashboard()}</section>`;}
function renderPage(){
  if(state.tab==='home')return renderHome();
  if(state.tab==='tools')return renderTools();
  if(state.tab==='activity')return renderActivity();
  return renderStatsHub();
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
    {key:'investment',label:'Inversión',value:Number(values.investment)||0,color:'var(--blue)'},
    {key:'debt',label:'Debes',value:Number(values.debt)||0,color:'#D9851F'}
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
  month.debt=state.expenseSplits.filter(row=>row.debtor_user_id===state.user.id&&row.status==='pending').reduce((sum,row)=>sum+Number(row.amount_cents||0),0);
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
    ['income_cents','Ingresos','↗'],
    ['investment_profit_cents','Mejor inversor','★']
  ];
  return categories.flatMap(([key,label,icon])=>{
    const rows=[...state.leaderboard].filter(r=>Number(r[key])>0).sort((a,b)=>Number(b[key])-Number(a[key])).slice(0,3);
    const pos=rows.findIndex(r=>r.user_id===userId);
    return pos<0?[]:[{key,label,icon,position:pos+1}];
  });
}
function rankingBadgeAsset(badge){
  const category={investment_cents:'inversiones',saving_cents:'ahorro',income_cents:'ingresos',investment_profit_cents:'mejor-inversor'}[badge.key]||'ingresos';
  return `./assets/badges/${category}-top-${badge.position}.webp`;
}
function rankingBadgesMarkup(userId,large=false){
  const badges=rankingBadgesFor(userId);
  if(!badges.length)return '';
  return `<div class="profile-ranking-badges ${large?'large':''}" aria-label="Insignias de clasificación">${badges.map(b=>`<figure class="ranking-badge-image rank-${b.position}" title="Top ${b.position} en ${esc(b.label)}"><img src="${rankingBadgeAsset(b)}" alt="Insignia Top ${b.position} en ${esc(b.label)}" loading="lazy"><figcaption><strong>Top ${b.position}</strong><span>${esc(b.label)}</span></figcaption></figure>`).join('')}</div>`;
}
function leaderboardSection(){
  const cats=[['investment_profit_cents','Mejor inversor','beneficio de inversión'],['investment_cents','Más invierten','Inversión'],['saving_cents','Más ahorran','Ahorro'],['income_cents','Más ganan','Ingresos']];
  return `<section class="social-ranking"><div class="section-head"><div><h2>Ranking</h2><p class="muted">Solo cuentan las transacciones que los usuarios han decidido publicar.</p></div></div>${cats.map(([key,title,label])=>{const rows=[...state.leaderboard].filter(r=>Number(r[key])>0).sort((a,b)=>Number(b[key])-Number(a[key])).slice(0,5);const me=state.leaderboard.find(r=>r.user_id===state.user.id);const third=rows[2];const gap=third?Math.max(0,Number(third[key])-Number(me?.[key]||0)+1):0;return `<article class="ranking-card"><h3>${title}</h3><div class="ranking-list">${rows.length?rows.map((r,i)=>`<button data-social-profile="${r.user_id}"><b>#${i+1}</b>${avatarMarkup(r,'small')}<span><strong>${esc(r.display_name||r.username||'Usuario')}</strong><small>@${esc(r.username||'usuario')}</small></span><em>${money(r[key])}</em></button>`).join(''):'<div class="empty compact">Todavía no hay datos compartidos.</div>'}</div>${gap>0?`<p class="ranking-gap">Te quedan <strong>${money(gap)}</strong> para entrar en el top 3 de ${label.toLowerCase()}.</p>`:`<p class="ranking-gap success">¡Estás en el top 3 de ${label.toLowerCase()}!</p>`}</article>`}).join('')}</section>`;
}
function postLikes(postId){return state.socialLikes.filter(x=>x.post_id===postId);}
function postComments(postId){return state.socialComments.filter(x=>x.post_id===postId);}
function hasLikedPost(postId){return state.socialLikes.some(x=>x.post_id===postId&&x.user_id===state.user.id);}
function socialPostMarkup(post){
  const image=socialImageUrl(post),tx=state.transactions.find(row=>row.id===post.transaction_id)||post.transaction,likes=postLikes(post.id),comments=postComments(post.id),liked=hasLikedPost(post.id),sale=tx?.investment_operation==='sale'?saleForTransaction(tx.id):null;
  const saleMeta=sale?`<span class="share-sale-meta"><b>Compra media ${money(sale.buy_unit_price_cents)}</b><b>Venta ${money(sale.sell_unit_price_cents)}</b><b class="${Number(sale.net_profit_cents)>=0?'income':'expense'}">Beneficio ${money(sale.net_profit_cents)}</b></span>`:'';
  return `<article class="social-post" data-social-post="${post.id}"><div class="social-post-head"><button class="social-author" data-social-profile="${post.user_id}">${avatarMarkup(post.author,'small')}<span><strong>${esc(post.author?.display_name||'Usuario')}</strong><small>@${esc(post.author?.username||'usuario')} · ${new Date(post.created_at).toLocaleDateString('es-ES')}</small></span></button></div><div class="social-photo-wrap" data-double-like="${post.id}"><img src="${esc(image)}" alt="Publicación de ${esc(post.author?.display_name||'usuario')}" loading="lazy"><div class="heart-burst" aria-hidden="true">♥</div><div class="social-overlay"><strong>${esc(post.caption||tx?.concept||'Publicación')}</strong>${tx?`<span>${esc(tx.investment_operation==='sale'?'Venta de acciones':kindLabels[tx.kind]||'Movimiento')}</span><span class="share-transaction-meta"><b>${money(tx.amount_cents)}</b><time>${esc(tx.occurred_on)}</time></span>${saleMeta}`:''}</div></div><div class="social-post-actions"><button type="button" class="social-like-btn ${liked?'active':''}" data-like-post="${post.id}" aria-pressed="${liked}"><span>${liked?'♥':'♡'}</span><b>${likes.length}</b><small>Me gusta</small></button><button type="button" class="social-comment-btn" data-comments-post="${post.id}"><span>◯</span><b>${comments.length}</b><small>Comentarios</small></button><button type="button" class="social-view-btn" data-view-post="${post.id}"><span>↗</span><small>Ver</small></button></div>${comments.length?`<div class="social-comment-preview">${comments.slice(-2).map(c=>`<p><strong>@${esc(c.author?.username||'usuario')}</strong> ${esc(c.body)}</p>`).join('')}${comments.length>2?`<button type="button" data-comments-post="${post.id}">Ver los ${comments.length} comentarios</button>`:''}</div>`:''}</article>`;
}
async function togglePostLike(postId){
  const existing=state.socialLikes.find(x=>x.post_id===postId&&x.user_id===state.user.id);
  const result=existing?await sb.from('social_post_likes').delete().eq('id',existing.id):await sb.from('social_post_likes').insert({post_id:postId,user_id:state.user.id});
  if(result.error)return toast(result.error.message,true);
  await refresh(false);renderShell();
}
async function likePostWithBurst(postId,wrap){
  if(!hasLikedPost(postId)){
    const {error}=await sb.from('social_post_likes').insert({post_id:postId,user_id:state.user.id});
    if(error)return toast(error.message,true);
    await refresh(false);
  }
  const heart=wrap?.querySelector('.heart-burst');
  if(heart){heart.classList.remove('show');void heart.offsetWidth;heart.classList.add('show');setTimeout(()=>heart.classList.remove('show'),900);}
  const btn=document.querySelector(`[data-like-post="${postId}"]`);if(btn){btn.classList.add('active');btn.setAttribute('aria-pressed','true');btn.querySelector('span').textContent='♥';btn.querySelector('b').textContent=postLikes(postId).length;}
}
function openPostComments(postId){
  const post=state.socialPosts.find(p=>p.id===postId);if(!post)return;
  const comments=postComments(postId);
  modal(`<div class="modal-head"><div><h2>Comentarios</h2><p class="muted">${comments.length} comentario${comments.length===1?'':'s'}</p></div><button class="close-btn" data-close>×</button></div><div class="social-comments-list">${comments.length?comments.map(c=>`<article class="social-comment-row">${avatarMarkup(c.author,'small')}<div><p><strong>@${esc(c.author?.username||'usuario')}</strong> ${esc(c.body)}</p><small>${new Date(c.created_at).toLocaleString('es-ES')}</small></div>${c.user_id===state.user.id?`<button type="button" data-delete-comment="${c.id}" aria-label="Borrar comentario">×</button>`:''}</article>`).join(''):'<div class="empty compact">Sé la primera persona en comentar.</div>'}</div><form id="social-comment-form" class="social-comment-form"><input name="body" maxlength="500" required placeholder="Escribe un comentario…" autocomplete="off"><button class="btn primary">Publicar</button></form>`,true);
  const form=document.querySelector('#social-comment-form');form.onsubmit=async e=>{e.preventDefault();const b=e.submitter,body=String(new FormData(form).get('body')||'').trim();if(!body)return;busy(b,true);const {error}=await sb.from('social_post_comments').insert({post_id:postId,user_id:state.user.id,body});busy(b,false);if(error)return toast(error.message,true);await refresh(false);openPostComments(postId);};
  document.querySelectorAll('[data-delete-comment]').forEach(b=>b.onclick=async()=>{const {error}=await sb.from('social_post_comments').delete().eq('id',b.dataset.deleteComment);if(error)return toast(error.message,true);await refresh(false);openPostComments(postId);});
}
function bindSocialPostActions(root=document){
  root.querySelectorAll('[data-like-post]').forEach(b=>b.onclick=e=>{e.stopPropagation();togglePostLike(b.dataset.likePost)});
  root.querySelectorAll('[data-double-like]').forEach(w=>{let lastTap=0;w.ondblclick=e=>{e.preventDefault();likePostWithBurst(w.dataset.doubleLike,w)};w.ontouchend=e=>{const now=Date.now();if(now-lastTap<360){e.preventDefault();likePostWithBurst(w.dataset.doubleLike,w);lastTap=0}else lastTap=now;};});
  root.querySelectorAll('[data-comments-post]').forEach(b=>b.onclick=e=>{e.stopPropagation();openPostComments(b.dataset.commentsPost)});
  root.querySelectorAll('[data-delete-post]').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteSocialPost(b.dataset.deletePost)});
  root.querySelectorAll('[data-view-post]').forEach(b=>b.onclick=e=>{e.stopPropagation();openSocialPostDetail(b.dataset.viewPost)});
  root.querySelectorAll('[data-social-profile]').forEach(b=>b.onclick=()=>openUserProfile(b.dataset.socialProfile));
}
function socialTabs(){
  const tabs=[['feed','Inicio'],['profile','Perfil'],['ranking','Ranking']];
  return `<nav class="social-tabs" aria-label="Secciones de la red social">${tabs.map(([key,label])=>`<button class="${state.socialSection===key?'active':''}" data-social-section="${key}">${label}</button>`).join('')}</nav>`;
}
function renderOwnSocialProfile(){
  const posts=state.socialPosts.filter(p=>p.user_id===state.user.id);
  return `<section class="social-profile-tab"><div class="social-profile-summary profile-tab-card"><div class="social-profile-identity"><button class="social-own-profile" data-social-profile="${state.user.id}">${avatarMarkup(state.profile,'profile-avatar-large')}<span><strong>${esc(state.profile.display_name||'Usuario')}</strong><small>@${esc(state.profile.username||'usuario')}</small></span></button></div><div class="social-counts"><button data-social-list="followers"><strong>${followerCount(state.user.id)}</strong><span>Seguidores</span></button><button data-social-list="following"><strong>${followingCount(state.user.id)}</strong><span>Seguidos</span></button><button><strong>${posts.length}</strong><span>Publicaciones</span></button></div>${rankingBadgesMarkup(state.user.id,true)}</div><div class="section-head"><div><h2>Mis publicaciones</h2><p class="muted">Todo lo que has compartido con la comunidad.</p></div><button class="btn" data-find-people>Buscar personas</button></div><div class="profile-post-grid social-profile-grid">${posts.length?posts.map(p=>`<div class="profile-post-tile"><button data-open-own-post="${p.id}"><img src="${esc(socialImageUrl(p))}" alt="Publicación" loading="lazy"></button></div>`).join(''):'<div class="empty compact">Todavía no has publicado imágenes.</div>'}</div></section>`;
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
function openSocialPostDetail(postId){
  const post=state.socialPosts.find(p=>p.id===postId);if(!post)return;
  const own=post.user_id===state.user.id;
  modal(`<div class="modal-head"><div><h2>Publicación</h2><p class="muted">@${esc(post.author?.username||state.profile.username||'usuario')}</p></div><button class="close-btn" data-close>×</button></div>${socialPostMarkup(post)}${own?`<div class="post-owner-actions"><button type="button" class="btn" id="edit-social-post">Editar publicación</button><button type="button" class="btn danger" id="delete-social-post-detail">Borrar publicación</button></div>`:''}`,true);
  const root=document.querySelector('#modal');bindSocialPostActions(root);
  document.querySelector('#edit-social-post')?.addEventListener('click',()=>openEditSocialPost(postId));
  document.querySelector('#delete-social-post-detail')?.addEventListener('click',()=>deleteSocialPost(postId));
}
function openEditSocialPost(postId){
  const post=state.socialPosts.find(p=>p.id===postId);if(!post||post.user_id!==state.user.id)return;
  modal(`<form id="edit-social-post-form"><div class="modal-head"><div><h2>Editar publicación</h2><p class="muted">Puedes cambiar el texto o sustituir la imagen.</p></div><button type="button" class="close-btn" data-close>×</button></div><div class="share-image-preview has-image"><img src="${esc(socialImageUrl(post))}" alt="Imagen actual"></div><div class="field"><label>Texto</label><textarea name="caption" maxlength="180">${esc(post.caption||'')}</textarea></div><div class="field"><label>Sustituir imagen (opcional)</label><input name="image" type="file" accept="image/*"></div><div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar cambios</button></div></form>`);
  const form=document.querySelector('#edit-social-post-form');form.onsubmit=async e=>{e.preventDefault();const b=e.submitter;busy(b,true);try{let imagePath=post.image_path;const file=form.elements.image.files?.[0];if(file){const processed=await compressReceipt(file);const newPath=`${state.user.id}/${crypto.randomUUID()}.jpg`;const {error:up}=await sb.storage.from('social').upload(newPath,processed,{contentType:'image/jpeg'});if(up)throw up;imagePath=newPath;}const {error}=await sb.from('social_posts').update({caption:String(form.elements.caption.value||'').trim(),image_path:imagePath}).eq('id',postId);if(error)throw error;if(file&&post.image_path)await sb.storage.from('social').remove([post.image_path]);closeModal();await refresh();state.tab='social';state.socialSection='profile';renderShell();toast('Publicación actualizada');}catch(err){toast(err.message,true)}finally{busy(b,false)}};
}
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
  const sale=tx?.investment_operation==='sale'?saleForTransaction(tx.id):null;
  const saleMeta=sale?`<span class="share-sale-meta"><b>Compra media ${money(sale.buy_unit_price_cents)}</b><b>Venta ${money(sale.sell_unit_price_cents)}</b><b>Beneficio ${money(sale.net_profit_cents)}</b></span>`:'';
  return `<div class="share-image-preview ${url?'has-image':''}" id="share-image-preview">${url?`<img src="${esc(url)}" alt="Vista previa de la publicación">`:'<div class="share-image-placeholder">Selecciona una imagen</div>'}<div class="social-overlay share-overlay-preview"><strong id="share-preview-caption">${esc(tx.concept)}</strong><span>${esc(tx.investment_operation==='sale'?'Venta de acciones':kindLabels[tx.kind]||'Movimiento')}</span><span class="share-transaction-meta"><b>${money(tx.amount_cents)}</b><time>${esc(tx.occurred_on)}</time></span>${saleMeta}</div></div>`;
}
async function openShareTransaction(tx){
  let selectedFile=tx._shareFile||null,previewUrl=selectedFile?URL.createObjectURL(selectedFile):'';
  if(!selectedFile&&tx.receipt_path){
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

function renderStatsDashboard(){
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
    ${budgetStatsArchive()}
    <article class="card stats-history"><div class="card-head"><div><h2>Historial del segmento</h2><p class="muted">${list.length} movimientos según los filtros seleccionados</p></div></div><div class="list">${list.length?list.map(txRow).join(''):'<div class="empty compact">No hay movimientos para estos filtros.</div>'}</div></article>
  </section>`;
}

function bind(){
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;renderShell()});
  document.querySelectorAll('[data-tools-section]').forEach(b=>b.onclick=()=>{state.toolsSection=b.dataset.toolsSection;renderShell()});
  document.querySelectorAll('[data-stats-section]').forEach(b=>b.onclick=()=>{state.statsSection=b.dataset.statsSection;renderShell()});
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
  document.querySelectorAll('[data-edit-tx]').forEach(b=>b.onclick=()=>{const tx=state.transactions.find(t=>t.id===b.dataset.editTx);tx?.investment_operation==='sale'?openStockSale(tx):openTransaction(tx)});
  document.querySelectorAll('[data-new-resource]').forEach(b=>b.onclick=()=>openResource({type:b.dataset.newResource}));
  document.querySelectorAll('[data-resource]').forEach(b=>b.onclick=()=>openResourceMenu(b.dataset.resource));
  document.querySelectorAll('[data-resource-crypto]').forEach(b=>b.onclick=e=>{e.stopPropagation();openResourceCryptoDetails(b.dataset.resourceCrypto)});
  document.querySelectorAll('[data-profile-id]').forEach(b=>b.onclick=e=>{e.stopPropagation();openUserProfile(b.dataset.profileId)});
  document.querySelectorAll('[data-tab-shortcut]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tabShortcut;renderShell()});
    document.querySelectorAll('[data-manage-recurring]').forEach(b=>b.onclick=openRecurring);
  document.querySelectorAll('[data-new-budget]').forEach(b=>b.onclick=()=>openBudgetForm());
  document.querySelectorAll('[data-edit-budget]').forEach(b=>b.onclick=e=>{e.stopPropagation();openBudgetForm(state.budgets.find(row=>String(row.id)===String(b.dataset.editBudget)))});
  document.querySelectorAll('[data-open-budget]').forEach(b=>{b.onclick=()=>openBudgetDetails(state.budgets.find(row=>String(row.id)===String(b.dataset.openBudget)));b.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')b.click()}});
  document.querySelector('[data-export-csv]')?.addEventListener('click',exportCsv);
  document.querySelector('[data-download-legal]')?.addEventListener('click',downloadLegalReport);
  document.querySelectorAll('[data-legal-period]').forEach(b=>b.onclick=()=>{const now=new Date();if(b.dataset.legalPeriod==='year'){state.legalFilters.from=`${now.getFullYear()}-01-01`;state.legalFilters.to=today();}else{state.legalFilters.from='';state.legalFilters.to='';}renderShell();});
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
  document.querySelectorAll('[data-open-own-post]').forEach(b=>b.onclick=()=>openSocialPostDetail(b.dataset.openOwnPost));
  bindSocialPostActions(document);
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
  const lf=document.querySelector('#legal-filter');
  if(lf)lf.onchange=()=>{const fd=new FormData(lf);state.legalFilters.from=String(fd.get('from')||'');state.legalFilters.to=String(fd.get('to')||'');renderShell();};
  const sf=document.querySelector('#stats-filter');
  if(sf)sf.onchange=()=>{const fd=new FormData(sf);Object.assign(state.filters,{from:String(fd.get('from')||''),to:String(fd.get('to')||''),kind:String(fd.get('kind')||''),resourceType:String(fd.get('resourceType')||''),resourceId:String(fd.get('resourceId')||'')});renderShell()};
}

function openFloatingTransactionMenu(){
  modal(`<div class="modal-head"><div><h2>Nuevo movimiento</h2><p class="muted">Selecciona el tipo de operación.</p></div><button class="close-btn" data-close>×</button></div>
    <div class="movement-type-grid">
      <button class="movement-type income" data-fab-kind="income"><span>↗</span><strong>Ingreso</strong></button>
      <button class="movement-type expense" data-fab-kind="expense"><span>↘</span><strong>Gasto</strong></button>
      <button class="movement-type saving" data-fab-kind="saving"><span>◎</span><strong>Ahorro</strong></button>
      <button class="movement-type investment" data-fab-kind="investment"><span>◆</span><strong>Inversión</strong></button><button class="movement-type investment" id="open-stock-sale"><span>⇄</span><strong>Vender acciones</strong></button>
    </div>`);
  document.querySelectorAll('[data-fab-kind]').forEach(b=>b.onclick=()=>openTransaction({kind:b.dataset.fabKind}));document.querySelector('#open-stock-sale')?.addEventListener('click',()=>openStockSale());
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
  form.onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(form);busy(b,true);try{const kindValue=String(fd.get('kind')),goalId=kindValue==='saving'?(fd.get('saving_goal_id')||null):null;const rawResource=String(fd.get('resource_id')||'');const cryptoPayment=kindValue==='expense'&&rawResource.startsWith('crypto:');const selectedHolding=cryptoPayment?state.cryptoHoldings.find(h=>h.id===rawResource.slice(7)):null;const selectedResourceId=cryptoPayment?(selectedHolding?.resource_id||null):(goalId||rawResource||null),selectedResource=state.resources.find(r=>r.id===selectedResourceId);const fuelActive=kindValue==='expense'&&!cryptoPayment&&isFuelConcept(fd.get('concept'));const investmentActive=kindValue==='investment';const cryptoActive=investmentActive&&isCryptoConcept(fd.get('investment_company')||fd.get('concept'));const liters=fuelActive?positive(fd.get('fuel_liters')):null,price=fuelActive?positive(fd.get('fuel_price')):null,km=fuelActive?positive(fd.get('fuel_km')):null;const investmentCompany=investmentActive?String(fd.get('investment_company')||fd.get('concept')||'').trim():String(fd.get('concept')||'').trim();const investmentIsin=investmentActive?String(fd.get('investment_isin')||'').trim().toUpperCase():null;const investmentQuantity=investmentActive?positive(fd.get('investment_quantity')):null;const investmentUnitPriceCents=investmentActive&&!cryptoActive?cents(fd.get('investment_unit_price')):null;const cryptoSymbol=cryptoActive?String(fd.get('crypto_symbol')||cryptoSymbolFromConcept(investmentCompany)).trim().toUpperCase():null;const cryptoRequestedQty=cryptoActive?cryptoQty(fd.get('crypto_quantity')):null;const cryptoUnitPriceCents=cryptoActive?cents(fd.get('crypto_unit_price')):null;const cryptoFeeCents=cryptoActive?Math.max(0,cents(fd.get('crypto_fee'))):0;const cryptoFeeMode=cryptoActive?String(fd.get('crypto_fee_mode')||'add'):null;const cryptoBaseCents=cryptoActive?Math.round(cryptoRequestedQty*cryptoUnitPriceCents):0;const cryptoEffectiveQty=cryptoActive&&cryptoFeeMode==='subtract'&&cryptoFeeCents>0&&cryptoUnitPriceCents>0?Math.max(0,(cryptoBaseCents-cryptoFeeCents)/cryptoUnitPriceCents):cryptoRequestedQty;const payload={kind:kindValue,category_id:null,merchant:'',payment_method:String(fd.get('payment_method')||'bank'),amount_cents:cents(fd.get('amount')),concept:investmentCompany,occurred_on:fd.get('date'),notes:String(fd.get('notes')||''),investment_isin:investmentIsin,investment_quantity:investmentQuantity,investment_unit_price_cents:investmentUnitPriceCents,crypto_symbol:cryptoSymbol,crypto_quantity:cryptoEffectiveQty,crypto_unit_price_cents:cryptoUnitPriceCents,crypto_fee_cents:cryptoFeeCents,crypto_fee_mode:cryptoFeeMode,fuel_liters:liters,fuel_price_per_liter_milli:price?Math.round(price*1000):null,fuel_km:km,fuel_consumption_l100km:liters&&km?Number((liters/km*100).toFixed(2)):null};if(fuelActive&&(!price||!liters))throw new Error('Indica el precio por litro y los litros repostados.');if(investmentActive){if(!investmentCompany)throw new Error('Indica el nombre de la inversión.');if(cryptoActive){if(!cryptoSymbol)throw new Error('Indica el símbolo de la criptomoneda.');if(!(cryptoRequestedQty>0))throw new Error('La cantidad de cripto debe ser mayor que cero.');if(!(cryptoUnitPriceCents>0))throw new Error('El precio de compra debe ser mayor que cero.');if(cryptoFeeMode==='subtract'&&cryptoFeeCents>=cryptoBaseCents)throw new Error('La comisión no puede ser igual o superior al importe de la compra.');payload.amount_cents=cryptoFeeMode==='add'?cryptoBaseCents+cryptoFeeCents:cryptoBaseCents;payload.investment_isin=null;payload.investment_quantity=null;payload.investment_unit_price_cents=null;}else{if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(investmentIsin||''))throw new Error('El ISIN debe contener 12 caracteres válidos.');if(!(investmentQuantity>0))throw new Error('El número de acciones debe ser mayor que cero.');if(!(investmentUnitPriceCents>0))throw new Error('El precio por acción debe ser mayor que cero.');payload.amount_cents=Math.round(investmentQuantity*investmentUnitPriceCents);}}if(payload.amount_cents<=0)throw new Error('El importe debe ser mayor que cero.');let id=tx.id;if(cryptoPayment){const qty=cryptoQty(fd.get('crypto_spend_quantity')),unit=cents(fd.get('crypto_spend_unit_price'));if(!selectedHolding)throw new Error('Selecciona una criptomoneda disponible.');if(qty<=0||(!editing&&qty>Number(selectedHolding.quantity)))throw new Error('La cantidad no es válida o supera el saldo disponible.');if(unit<=0)throw new Error('Indica un valor por unidad válido.');if(editing&&tx.payment_method==='crypto'){const {error}=await sb.rpc('a2c_update_crypto_payment',{p_transaction_id:tx.id,p_symbol:selectedHolding.symbol,p_quantity:qty,p_unit_price_cents:unit,p_resource_id:selectedHolding.resource_id||null,p_concept:payload.concept,p_occurred_on:payload.occurred_on,p_notes:payload.notes});if(error)throw error;id=tx.id;}else{const {data,error}=await sb.rpc('a2c_spend_crypto',{p_symbol:selectedHolding.symbol,p_quantity:qty,p_unit_price_cents:unit,p_resource_id:selectedHolding.resource_id||null,p_concept:payload.concept,p_occurred_on:payload.occurred_on,p_notes:payload.notes});if(error)throw error;id=data;}}else if(editing&&tx.crypto_symbol&&tx.kind==='investment'){const {error}=await sb.rpc('a2c_update_crypto_purchase',{p_transaction_id:tx.id,p_symbol:payload.crypto_symbol,p_crypto_name:payload.concept,p_quantity:payload.crypto_quantity,p_unit_price_cents:payload.crypto_unit_price_cents,p_fee_cents:payload.crypto_fee_cents,p_fee_mode:payload.crypto_fee_mode,p_resource_id:selectedResourceId});if(error)throw error;}else if(editing){const {error}=await sb.rpc('update_finance_transaction_v4',{p_transaction_id:tx.id,p_kind:payload.kind,p_category_id:null,p_merchant:'',p_payment_method:payload.payment_method,p_amount_cents:payload.amount_cents,p_concept:payload.concept,p_occurred_on:payload.occurred_on,p_notes:payload.notes,p_investment_isin:payload.investment_isin,p_investment_quantity:payload.investment_quantity,p_investment_unit_price_cents:payload.investment_unit_price_cents});if(error)throw error;const {error:extra}=await sb.from('finance_transactions').update({fuel_liters:payload.fuel_liters,fuel_price_per_liter_milli:payload.fuel_price_per_liter_milli,fuel_km:payload.fuel_km,fuel_consumption_l100km:payload.fuel_consumption_l100km,category_id:null,merchant:''}).eq('id',id);if(extra)throw extra;}else if(selectedResource?.type==='piggy'&&(kindValue==='income'||kindValue==='saving')){const {data,error}=await sb.rpc('create_piggy_transfer_v4',{p_piggy_id:selectedResource.id,p_amount_cents:payload.amount_cents,p_concept:payload.concept,p_occurred_on:payload.occurred_on,p_notes:payload.notes,p_payment_method:payload.payment_method});if(error)throw error;id=data;}else{const {data}=await retrySupabase(()=>sb.from('finance_transactions').insert({...payload,creator_id:state.user.id,resource_id:selectedResourceId}).select('id').single());id=data.id;}if(cryptoActive&&!editing){const {error:cryptoError}=await sb.rpc('a2c_record_crypto_purchase',{p_transaction_id:id,p_symbol:payload.crypto_symbol,p_crypto_name:payload.concept,p_quantity:payload.crypto_quantity,p_unit_price_cents:payload.crypto_unit_price_cents,p_fee_cents:payload.crypto_fee_cents,p_fee_mode:payload.crypto_fee_mode,p_resource_id:selectedResourceId});if(cryptoError)throw cryptoError;}const originalFile=pendingReceiptFile||galleryInput?.files?.[0]||null;if(originalFile instanceof File&&originalFile.size){const file=await compressReceipt(originalFile);const ext=(file.type==='image/jpeg'?'jpg':(file.name.split('.').pop()||'img').toLowerCase());const path=`${state.user.id}/${id}/${crypto.randomUUID()}.${ext}`;const {error}=await sb.storage.from('receipts').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(error)throw error;const {error:pe}=await sb.from('finance_transactions').update({receipt_path:path}).eq('id',id);if(pe)throw pe;}if(kindValue==='expense'){await sb.from('expense_splits').delete().eq('transaction_id',id).eq('owner_id',state.user.id);if(splitToggle?.checked){const splitRows=[...splitList.querySelectorAll('.split-person-row')].map(r=>({owner_id:state.user.id,transaction_id:id,debtor_user_id:r.querySelector('.split-user').value||null,person_name:String(r.querySelector('.split-name').value||'').trim()||null,amount_cents:cents(r.querySelector('.split-amount').value),status:'pending'})).filter(r=>r.amount_cents>0);if(splitRows.length){const {error:splitError}=await sb.from('expense_splits').insert(splitRows);if(splitError)throw splitError;}}}closeModal();await refresh();toast(editing?'Movimiento actualizado':cryptoPayment?'Pago con cripto registrado':fuelActive?'Repostaje guardado':investmentActive?'Inversión guardada':goalId?'Ahorro asignado al objetivo':'Movimiento guardado');}catch(error){toast(error.message,true)}finally{busy(b,false)}};
  document.querySelector('#share-tx-modal')?.addEventListener('click',()=>openShareTransaction(tx));
  document.querySelector('#repeat-tx-modal')?.addEventListener('click',()=>{const copy={...tx,id:null,occurred_on:today(),receipt_path:null,is_transfer:false,transfer_group_id:null,transfer_role:null};openTransaction(copy);});
  document.querySelector('#delete-tx')?.addEventListener('click',async()=>{if(!confirm('¿Borrar este movimiento?'))return;const linked=state.socialPosts.filter(p=>p.transaction_id===tx.id);for(const post of linked){if(post.image_path)await sb.storage.from('social').remove([post.image_path]);await sb.from('social_posts').delete().eq('id',post.id);}if(tx.investment_operation==='sale'){const {error}=await sb.rpc('a2c_delete_stock_sale',{p_transaction_id:tx.id});if(error)return toast(error.message,true);closeModal();await refresh();return toast('Venta eliminada');}const {error}=tx.crypto_symbol?await sb.rpc('a2c_delete_crypto_transaction',{p_transaction_id:tx.id}):await sb.rpc('delete_finance_transaction_v4',{p_transaction_id:tx.id});if(error)return toast(error.message,true);closeModal();await refresh();toast('Movimiento eliminado')});
}


function stockPortfolio(){
  const map=new Map();
  for(const tx of state.transactions.filter(t=>t.kind==='investment'&&!t.crypto_symbol&&t.investment_isin&&t.investment_operation!=='sale')){
    const key=String(tx.investment_isin).toUpperCase(),row=map.get(key)||{isin:key,company:tx.concept,shares:0,cost:0};
    row.shares+=Number(tx.investment_quantity||0);row.cost+=Number(tx.amount_cents||0);map.set(key,row);
  }
  for(const sale of state.stockSales){const row=map.get(String(sale.isin).toUpperCase());if(row)row.shares-=Number(sale.quantity||0);}
  return [...map.values()].filter(r=>r.shares>0).map(r=>({...r,average:r.cost/Math.max(0.00000001,r.shares)}));
}
function saleForTransaction(id){return state.stockSales.find(s=>s.transaction_id===id);}
function saleCalculations(quantity,buyPriceCents,sellPriceCents,commissionCents,taxCents){const gross=Math.round(quantity*sellPriceCents),cost=Math.round(quantity*buyPriceCents),profitBefore=gross-cost,net=Math.max(0,gross-commissionCents-taxCents),profit=net-cost;return{gross,cost,profitBefore,net,profit};}
async function drawStockSaleReceipt(sale){const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1500;const c=canvas.getContext('2d');c.fillStyle='#f7f7f4';c.fillRect(0,0,1200,1500);c.fillStyle='#101010';c.font='700 54px sans-serif';c.fillText('EXTRACTO DE VENTA',80,110);c.font='28px monospace';c.fillStyle='#666';c.fillText(`${sale.company} · ${sale.isin}`,80,160);const rows=[['Acciones vendidas',Number(sale.quantity).toLocaleString('es-ES',{maximumFractionDigits:8})],['Precio medio de compra',money(sale.buy_unit_price_cents)],['Precio de venta',money(sale.sell_unit_price_cents)],['Importe bruto',money(sale.gross_proceeds_cents)],['Comisiones',money(sale.commission_cents)],['Impuestos / retenciones',money(sale.tax_cents)],['Coste histórico',money(sale.cost_basis_cents)],['Beneficio neto',money(sale.net_profit_cents)],['Ingreso al patrimonio',money(sale.net_proceeds_cents)],['Fecha',sale.occurred_on]];let y=270;c.font='28px sans-serif';for(const [label,value] of rows){c.fillStyle='#777';c.fillText(label,80,y);c.fillStyle='#111';c.font='700 32px sans-serif';c.fillText(String(value),650,y);c.font='28px sans-serif';c.strokeStyle='#ddd';c.beginPath();c.moveTo(80,y+28);c.lineTo(1120,y+28);c.stroke();y+=115;}c.fillStyle=sale.net_profit_cents>=0?'#11875d':'#c33';c.font='700 64px sans-serif';c.fillText(sale.net_profit_cents>=0?'BENEFICIO':'PÉRDIDA',80,1370);return new Promise(resolve=>canvas.toBlob(b=>resolve(new File([b],`extracto-${sale.isin}-${sale.occurred_on}.jpg`,{type:'image/jpeg'})),'image/jpeg',.9));}
async function downloadStockSaleReceipt(sale){const file=await drawStockSaleReceipt(sale),url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
function openStockSale(tx=null){
  const editing=Boolean(tx?.id),existing=editing?saleForTransaction(tx.id):null,portfolio=stockPortfolio();
  if(!editing&&!portfolio.length)return toast('No tienes acciones disponibles para vender.',true);
  const selected=existing?.isin||portfolio[0]?.isin||'';
  const existingProfitBefore=existing?Number(existing.gross_proceeds_cents)-Number(existing.cost_basis_cents)-Number(existing.commission_cents):0;
  const initialTaxRate=existing&&existingProfitBefore>0?Math.max(0,Number(existing.tax_cents)/existingProfitBefore*100):19;
  modal(`<form id="stock-sale-form"><div class="modal-head"><div><h2>${editing?'Editar':'Nueva'} venta de acciones</h2><p class="muted">La aplicación propone una estimación orientativa del 19 % sobre la ganancia positiva. La tributación real es progresiva y puede variar.</p></div><button type="button" class="close-btn" data-close>×</button></div><div class="field"><label>Empresa / ISIN</label><select name="isin" ${editing?'disabled':''}>${portfolio.map(r=>`<option value="${esc(r.isin)}" ${selected===r.isin?'selected':''}>${esc(r.company)} · ${esc(r.isin)} · ${r.shares.toLocaleString('es-ES',{maximumFractionDigits:8})} acc.</option>`).join('')}${editing&&!portfolio.some(r=>r.isin===selected)?`<option value="${esc(selected)}" selected>${esc(existing.company)} · ${esc(selected)}</option>`:''}</select></div><div class="form-grid"><div class="field"><label>Cantidad de acciones</label><input name="quantity" inputmode="decimal" required value="${existing?.quantity||''}"></div><div class="field"><label>Precio de venta (€)</label><input name="sell_price" inputmode="decimal" required value="${existing?.sell_unit_price_cents?existing.sell_unit_price_cents/100:''}"></div><div class="field"><label>Comisiones (€)</label><input name="commission" inputmode="decimal" value="${existing?.commission_cents?existing.commission_cents/100:'0'}"></div><div class="field"><label>Estimación fiscal (%)</label><input name="tax_rate" inputmode="decimal" value="${initialTaxRate.toFixed(2).replace('.',',')}"><small class="muted">Editable. Se aplica solo sobre la ganancia positiva después de comisiones.</small></div></div><div class="field"><label>Impuestos estimados (€)</label><input name="tax" readonly value="${existing?.tax_cents?existing.tax_cents/100:'0'}"></div><div class="field"><label>Fecha</label><input name="date" type="date" required value="${existing?.occurred_on||today()}"></div><div class="field"><label>Notas</label><textarea name="notes">${esc(existing?.notes||'')}</textarea></div><div class="stock-sale-preview" id="stock-sale-preview"></div><div class="actions stock-sale-actions">${editing?'<button type="button" class="btn danger" id="delete-stock-sale">Borrar</button><button type="button" class="btn" id="download-stock-sale">Descargar extracto</button><button type="button" class="btn" id="share-stock-sale">Compartir</button>':''}<button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar venta</button></div></form>`,true);
  const form=document.querySelector('#stock-sale-form');
  const current=()=>{const isin=editing?existing.isin:form.elements.isin.value,row=portfolio.find(r=>r.isin===isin),quantity=positive(form.elements.quantity.value),sell=cents(form.elements.sell_price.value),commission=Math.max(0,cents(form.elements.commission.value)),buy=existing?.buy_unit_price_cents||Math.round(row?.average||0),gross=Math.round(quantity*sell),cost=Math.round(quantity*buy),taxable=Math.max(0,gross-cost-commission),taxRate=Math.max(0,positive(form.elements.tax_rate.value)),tax=Math.round(taxable*taxRate/100),calc=saleCalculations(quantity,buy,sell,commission,tax);form.elements.tax.value=(tax/100).toFixed(2);return{row,isin,quantity,sell,commission,tax,taxRate,buy,calc};};
  const draw=()=>{const x=current();document.querySelector('#stock-sale-preview').innerHTML=`<div><span>Precio medio de compra</span><b>${money(x.buy)}</b></div><div><span>Impuestos estimados</span><b>${money(x.tax)} · ${x.taxRate.toLocaleString('es-ES',{maximumFractionDigits:2})}%</b></div><div><span>Ingreso neto</span><b>${money(x.calc.net)}</b></div><div><span>Beneficio neto</span><b class="${x.calc.profit>=0?'income':'expense'}">${money(x.calc.profit)}</b></div>`;};
  form.addEventListener('input',draw);draw();
  form.onsubmit=async e=>{e.preventDefault();const b=e.submitter,x=current();if(!(x.quantity>0)||!(x.sell>0))return toast('Indica cantidad y precio de venta válidos.',true);if(!editing&&x.quantity>Number(x.row?.shares||0))return toast('No tienes suficientes acciones disponibles.',true);busy(b,true);try{const args={p_transaction_id:editing?tx.id:null,p_isin:x.isin,p_company:existing?.company||x.row.company,p_quantity:x.quantity,p_sell_unit_price_cents:x.sell,p_commission_cents:x.commission,p_tax_cents:x.tax,p_occurred_on:form.elements.date.value,p_notes:form.elements.notes.value};const {error}=await sb.rpc(editing?'a2c_update_stock_sale':'a2c_create_stock_sale',args);if(error)throw error;closeModal();await refresh();toast(editing?'Venta recalculada':'Venta registrada');}catch(err){toast(err.message,true)}finally{busy(b,false)}};
  document.querySelector('#download-stock-sale')?.addEventListener('click',()=>downloadStockSaleReceipt(existing));
  document.querySelector('#share-stock-sale')?.addEventListener('click',async()=>{const file=await drawStockSaleReceipt(existing);openShareTransaction({...tx,receipt_path:null,_shareFile:file});});
  document.querySelector('#delete-stock-sale')?.addEventListener('click',async()=>{if(!confirm('¿Borrar esta venta?'))return;const {error}=await sb.rpc('a2c_delete_stock_sale',{p_transaction_id:tx.id});if(error)return toast(error.message,true);closeModal();await refresh();toast('Venta eliminada')});
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
  document.querySelector('#delete-resource')?.addEventListener('click',async()=>{
    if(!confirm('¿Borrar este elemento? El saldo disponible se devolverá a la cuenta principal de su propietario.'))return;
    const {data,error}=await sb.rpc('a2c_delete_resource_with_refund_v60',{p_resource_id:resource.id});
    if(error)return toast(error.message,true);
    closeModal();await refresh();
    toast(Number(data||0)>0?`Eliminado. Se han devuelto ${money(Number(data||0))}.`:'Eliminado');
  });
}
function openResourceMenu(id){
  const r=state.resources.find(x=>String(x.id)===String(id));
  if(!r)return;

  const owner=String(r.owner_id||'')===String(state.user.id);
  const typeLabel=r.type==='piggy'?'Hucha':r.type==='folder'?'Carpeta':'Objetivo';

  modal(`<div class="modal-head">
    <div>
      <h2>${esc(r.name)}</h2>
      <p class="muted">${typeLabel} · ${r.is_shared?'Compartido':'Personal'}</p>
    </div>
    <button type="button" class="close-btn" data-close>×</button>
  </div>
  <div class="menu-stack resource-popup-menu">
    ${owner?'<button type="button" class="btn" data-resource-action="edit">Editar</button>':''}
    <button type="button" class="btn" data-resource-action="view">Ver movimientos</button>
    <button type="button" class="btn" data-resource-action="income">Añadir fondos</button>
    <button type="button" class="btn" data-resource-action="expense">Realizar gasto</button>
    ${r.is_shared&&owner?'<button type="button" class="btn" data-resource-action="invite">Invitar usuario</button>':''}
    <button type="button" class="btn" data-resource-action="crypto-add">Agregar criptos</button>
    <button type="button" class="btn" data-resource-action="crypto-history">Criptos e historial</button>
    ${owner?'<button type="button" class="btn danger" data-resource-action="delete">Eliminar</button>':''}
  </div>`);

  document.querySelectorAll('[data-resource-action]').forEach(button=>{
    button.onclick=async()=>{
      const action=button.dataset.resourceAction;
      closeModal();

      if(action==='edit')return openResource(r);
      if(action==='view'){
        state.filters.resourceId=r.id;
        state.tab='activity';
        renderShell();
        return;
      }
      if(action==='income')return openTransaction({kind:'income',resource_id:r.id});
      if(action==='expense')return openTransaction({kind:'expense',resource_id:r.id});
      if(action==='invite')return openInvite(r);
      if(action==='crypto-add')return openCryptoTransfer(r.id);
      if(action==='crypto-history')return openResourceCryptoDetails(r.id);
      if(action==='delete'){
        if(!confirm(`¿Eliminar ${typeLabel.toLowerCase()} "${r.name}" y sus movimientos?`))return;
        const {error}=await sb.from('resources').delete().eq('id',r.id);
        if(error)return toast(error.message,true);
        await refresh();
        toast(`${typeLabel} eliminada.`);
      }
    };
  });
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
  document.querySelector('#invite-form').onsubmit=async e=>{
    e.preventDefault();
    const b=e.submitter,fd=new FormData(e.currentTarget);
    busy(b,true);
    const {data,error}=await sb.rpc('a2c_invite_resource_safe_v60',{
      p_resource_id:r.id,
      p_email:String(fd.get('email')).trim().toLowerCase()
    });
    busy(b,false);
    if(error)return toast(error.message,true);
    closeModal();await refresh();
    toast(data==='already_pending'?'Ese usuario ya tiene una invitación pendiente.':'Invitación enviada');
  };
}


async function deleteNotification(id){
  const {error}=await sb.from('notifications').delete().eq('id',id).eq('user_id',state.user.id);
  if(error)throw error;
}

async function openExpenseNotification(notification){
  const {data,error}=await sb.rpc('a2c_expense_split_detail_v52',{
    p_split_id:notification.related_id
  });
  if(error)return toast(error.message,true);

  const detail=Array.isArray(data)?data[0]:data;
  if(!detail){
    await deleteNotification(notification.id).catch(()=>{});
    await refresh(false);
    return openNotifications();
  }

  modal(`<div class="modal-head"><div><span class="eyebrow">Pago pendiente</span><h2>${esc(detail.concept||'Gasto compartido')}</h2><p class="muted">${esc(detail.owner_name||'Un usuario')}${detail.resource_name?` · ${esc(detail.resource_name)}`:''}</p></div><button class="close-btn" data-close>×</button></div>
    <div class="expense-notification-detail">
      <div><span>Importe</span><strong>${money(detail.amount_cents)}</strong></div>
      <div><span>Fecha</span><strong>${esc(detail.occurred_on||'Sin fecha')}</strong></div>
    </div>
    <div class="actions">
      <button type="button" class="btn" data-close>Cerrar</button>
      ${detail.paid_at?'<span class="status-chip">Pagado</span>':`<button type="button" class="btn primary" id="pay-expense-notification">Pagar</button>`}
    </div>`,true);

  document.querySelector('#pay-expense-notification')?.addEventListener('click',async event=>{
    const button=event.currentTarget;
    busy(button,true);
    const {error}=await sb.rpc('a2c_pay_expense_split_v52',{
      p_split_id:detail.split_id
    });
    busy(button,false);
    if(error)return toast(error.message,true);
    await deleteNotification(notification.id).catch(()=>{});
    closeModal();
    await refresh();
    toast('Pago registrado');
  });
}

async function openNotificationDestination(notification){
  const type=String(notification.type||'');

  if(type==='expense_split'||type==='expense_reminder'){
    return openExpenseNotification(notification);
  }

  try{
    await deleteNotification(notification.id);
  }catch(error){
    return toast(error.message,true);
  }

  closeModal();
  await refresh(false);

  if(type==='social_like'||type==='social_comment'){
    state.tab='social';
    renderShell();
    if(notification.related_id){
      setTimeout(()=>openSocialPostDetail(notification.related_id),80);
    }
    return;
  }

  if(type.startsWith('group_')){
    state.tab='tools';
    renderShell();
    setTimeout(()=>{
      const button=document.querySelector('[data-v47-groups]');
      button?.click();
      if(notification.related_id){
        setTimeout(()=>document.querySelector(`[data-v47-group="${notification.related_id}"]`)?.click(),100);
      }
    },80);
    return;
  }

  if(type.includes('resource')||type==='invitation'){
    state.tab='tools';
    renderShell();
    if(notification.related_id){
      setTimeout(()=>document.querySelector(`[data-resource="${notification.related_id}"]`)?.click(),100);
    }
    return;
  }

  if(type.includes('friend')||type.includes('follow')){
    state.tab='social';
    renderShell();
    return;
  }

  state.tab=type.includes('expense')?'activity':'home';
  renderShell();
}

async function respondGroupInvitation(notification,accept){
  const {error}=await sb.rpc('a2c_respond_group_invitation',{
    p_group_id:notification.related_id,
    p_accept:accept
  });
  if(error)return toast(error.message,true);
  await deleteNotification(notification.id).catch(()=>{});
  await refresh(false);
  openNotifications();
  toast(accept?'Te has unido al grupo':'Invitación rechazada');
}

async function openNotifications(){
  const {data,error}=await sb.from('notifications')
    .select('*')
    .eq('user_id',state.user.id)
    .order('created_at',{ascending:false})
    .limit(100);

  if(error)return toast(error.message,true);

  state.notifications=data||[];

  modal(`<div class="modal-head"><div><h2>Notificaciones</h2><p class="muted">${state.notifications.length} pendiente${state.notifications.length===1?'':'s'}</p></div><button class="close-btn" data-close>×</button></div>
    <div class="list">${state.notifications.map(n=>`<article class="notification" data-notification-id="${n.id}">
      <button type="button" class="notification-main ${(n.type==='expense_split'||n.type==='expense_reminder')?'notification-expense-direct':''}" data-open-note="${n.id}" ${(n.type==='expense_split'||n.type==='expense_reminder')?'aria-label="Abrir gasto compartido y pagarlo"':''}>
        <strong>${esc(n.title||'Notificación')}</strong>
        <p>${esc(n.body||'')}</p>
        <small>${n.created_at?new Date(n.created_at).toLocaleString('es-ES'):''}</small>
      </button>
      <div class="notification-actions">
        ${n.type==='invitation'?`<button class="btn success" data-accept="${n.related_id}">Aceptar</button><button class="btn danger" data-reject="${n.related_id}">Rechazar</button>`:''}
        ${n.type==='group_invitation'?`<button class="btn success" data-group-accept="${n.id}">Aceptar</button><button class="btn danger" data-group-reject="${n.id}">Rechazar</button>`:''}
        <button class="btn danger" data-delete-note="${n.id}">Borrar</button>
      </div>
    </article>`).join('')||'<div class="empty">No hay notificaciones.</div>'}</div>`,true);

  document.querySelectorAll('[data-open-note]').forEach(button=>{
    button.onclick=()=>{
      const notification=state.notifications.find(n=>String(n.id)===String(button.dataset.openNote));
      if(notification)openNotificationDestination(notification);
    };
  });

  document.querySelectorAll('[data-accept]').forEach(button=>{
    button.onclick=()=>respondInvite(button.dataset.accept,true);
  });
  document.querySelectorAll('[data-reject]').forEach(button=>{
    button.onclick=()=>respondInvite(button.dataset.reject,false);
  });

  document.querySelectorAll('[data-group-accept]').forEach(button=>{
    const notification=state.notifications.find(n=>String(n.id)===String(button.dataset.groupAccept));
    button.onclick=()=>notification&&respondGroupInvitation(notification,true);
  });
  document.querySelectorAll('[data-group-reject]').forEach(button=>{
    const notification=state.notifications.find(n=>String(n.id)===String(button.dataset.groupReject));
    button.onclick=()=>notification&&respondGroupInvitation(notification,false);
  });

  document.querySelectorAll('[data-delete-note]').forEach(button=>{
    button.onclick=async()=>{
      try{
        await deleteNotification(button.dataset.deleteNote);
        await refresh(false);
        openNotifications();
      }catch(error){
        toast(error.message,true);
      }
    };
  });
}

async function respondInvite(id,accept){const {error}=await sb.rpc('respond_resource_invitation',{p_invitation_id:id,p_accept:accept});if(error)return toast(error.message,true);await refresh(false);openNotifications();toast(accept?'Invitación aceptada':'Invitación rechazada')}


function legalReportData(){
  const {from,to}=state.legalFilters;
  const inRange=date=>(!from||date>=from)&&(!to||date<=to);
  const transactions=state.transactions.filter(t=>inRange(String(t.occurred_on||''))&&!(t.is_transfer&&t.transfer_role==='destination'));
  const sales=state.stockSales.filter(s=>inRange(String(s.occurred_on||'')));
  const crypto=state.cryptoLedger.filter(row=>inRange(String(row.occurred_on||'')));
  return {transactions,sales,crypto,totals:totals(transactions)};
}
function renderLegalReport(){
  const report=legalReportData(),net=report.totals.income-report.totals.expense-report.totals.saving-report.totals.investment;
  return `<section class="legal-report-page"><div class="dashboard-head"><div><span class="eyebrow">Documentación financiera</span><h1>Informe financiero</h1><p class="muted">Resumen formal de movimientos para archivo personal o revisión por una entidad.</p></div><button class="btn primary" data-download-legal>Descargar PDF</button></div><div class="legal-disclaimer"><strong>Importante:</strong> este documento se genera con los datos introducidos por el usuario. No es un certificado bancario, fiscal ni contable y debe contrastarse con los extractos oficiales.</div><form id="legal-filter" class="stats-toolbar"><label>Desde<input name="from" type="date" value="${esc(state.legalFilters.from)}"></label><label>Hasta<input name="to" type="date" value="${esc(state.legalFilters.to)}"></label><button type="button" class="period-chip" data-legal-period="year">Este año</button><button type="button" class="period-chip" data-legal-period="all">Todo</button></form><div class="legal-summary-grid"><article><span>Ingresos</span><strong class="income">${money(report.totals.income)}</strong></article><article><span>Gastos</span><strong class="expense">${money(report.totals.expense)}</strong></article><article><span>Ahorro</span><strong class="saving">${money(report.totals.saving)}</strong></article><article><span>Inversión</span><strong class="investment">${money(report.totals.investment)}</strong></article><article><span>Flujo neto</span><strong>${money(net)}</strong></article><article><span>Operaciones</span><strong>${report.transactions.length}</strong></article></div><article class="card legal-table-card"><div class="card-head"><div><h2>Movimientos</h2><p class="muted">${report.transactions.length} registros en el periodo</p></div></div><div class="legal-table"><div class="legal-table-head"><span>Fecha</span><span>Tipo</span><span>Concepto</span><span>Importe</span></div>${report.transactions.slice(0,200).map(tx=>`<div><span>${esc(tx.occurred_on)}</span><span>${esc(kindLabels[tx.kind]||tx.kind)}</span><span>${esc(tx.concept)}</span><b>${money(tx.amount_cents)}</b></div>`).join('')||'<p class="empty compact">No hay movimientos.</p>'}</div></article><div class="dashboard-grid"><article class="card"><h2>Ventas de inversiones</h2><div class="portfolio-list">${report.sales.length?report.sales.map(sale=>`<div class="portfolio-row"><div><strong>${esc(sale.company)}</strong><small>${esc(sale.isin)} · ${esc(sale.occurred_on)} · ${Number(sale.quantity).toLocaleString('es-ES',{maximumFractionDigits:8})} acciones</small></div><div><b>${money(sale.net_proceeds_cents)}</b><small>Impuestos: ${money(sale.tax_cents)} · Beneficio: ${money(sale.net_profit_cents)}</small></div></div>`).join(''):'<div class="empty compact">Sin ventas.</div>'}</div></article><article class="card"><h2>Criptomonedas</h2><div class="portfolio-list">${report.crypto.length?report.crypto.slice(0,100).map(row=>`<div class="portfolio-row"><div><strong>${esc(row.symbol)} · ${esc(row.action)}</strong><small>${esc(row.occurred_on)} · ${Number(row.quantity||0).toLocaleString('es-ES',{maximumFractionDigits:8})}</small></div><b>${row.eur_amount_cents?money(row.eur_amount_cents):'—'}</b></div>`).join(''):'<div class="empty compact">Sin operaciones.</div>'}</div></article></div></section>`;
}
async function downloadLegalReport(){
  const report=legalReportData();
  try{
    const {jsPDF}=await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm');
    const doc=new jsPDF({unit:'mm',format:'a4'});const margin=14,pageH=297,pageW=210;let y=18;
    const line=(label,value)=>{if(y>276){doc.addPage();y=18;}doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(90);doc.text(label,margin,y);doc.setFont('helvetica','bold');doc.setTextColor(20);doc.text(String(value),pageW-margin,y,{align:'right'});y+=7;};
    const title=text=>{if(y>270){doc.addPage();y=18;}doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(15);doc.text(text,margin,y);y+=8;};
    doc.setFont('helvetica','bold');doc.setFontSize(20);doc.text('A2C FINANZAS - INFORME FINANCIERO',margin,y);y+=9;doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(90);doc.text(`Titular: ${state.profile.display_name||state.profile.email}`,margin,y);y+=5;doc.text(`Periodo: ${state.legalFilters.from||'inicio'} a ${state.legalFilters.to||today()}`,margin,y);y+=5;doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`,margin,y);y+=8;doc.setFillColor(245,244,240);doc.roundedRect(margin,y,pageW-margin*2,18,2,2,'F');doc.setFontSize(8);doc.setTextColor(80);const disclaimer='Documento generado a partir de datos introducidos por el usuario. No constituye certificacion bancaria, fiscal ni contable.';doc.text(doc.splitTextToSize(disclaimer,pageW-margin*2-8),margin+4,y+6);y+=25;
    title('Resumen');line('Ingresos',money(report.totals.income));line('Gastos',money(report.totals.expense));line('Ahorro',money(report.totals.saving));line('Inversiones',money(report.totals.investment));line('Numero de movimientos',report.transactions.length);
    title('Movimientos');for(const tx of report.transactions){const concept=String(tx.concept||'').slice(0,70);line(`${tx.occurred_on} | ${kindLabels[tx.kind]||tx.kind} | ${concept}`,money(tx.amount_cents));}
    title('Ventas de acciones');for(const sale of report.sales){line(`${sale.occurred_on} | ${sale.company} | ${sale.quantity} acc. | impuestos ${money(sale.tax_cents)}`,`Neto ${money(sale.net_proceeds_cents)} | Beneficio ${money(sale.net_profit_cents)}`);}
    title('Operaciones con criptomonedas');for(const row of report.crypto){line(`${row.occurred_on} | ${row.symbol} | ${row.action} | ${Number(row.quantity||0).toLocaleString('es-ES',{maximumFractionDigits:8})}`,row.eur_amount_cents?money(row.eur_amount_cents):'');}
    const pages=doc.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(130);doc.text(`A2C Finanzas · Página ${i} de ${pages}`,pageW/2,290,{align:'center'});}doc.save(`a2c-informe-financiero-${state.legalFilters.from||'inicio'}-${state.legalFilters.to||today()}.pdf`);
  }catch(error){console.error(error);toast('No se pudo generar el PDF. Comprueba tu conexión.',true);}
}
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
function scheduledPlaceLabel(type,id){
  if(type==='main')return 'Cuenta principal';
  if(type==='resource'){
    const resource=state.resources.find(item=>String(item.id)===String(id));
    return resource?.name||'Espacio';
  }
  if(type==='group')return 'Grupo';
  if(type==='expense')return 'Gasto';
  return 'Destino';
}
function scheduledFrequencyLabel(row){
  if(row.frequency==='daily')return 'Todos los días';
  if(row.frequency==='weekly'){
    const days=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    return `Cada ${days[Number(row.weekday||0)]}`;
  }
  return `Día ${row.day_of_month||1} de cada mes`;
}
function allScheduledRows(){
  return [
    ...state.recurring.map(row=>({...row,_schedule_kind:'transfer'})),
    ...state.scheduledExpenses.map(row=>({...row,_schedule_kind:'expense'}))
  ].sort((a,b)=>String(a.next_run||'').localeCompare(String(b.next_run||'')));
}
function openRecurring(){
  const rows=allScheduledRows();
  modal(`<div class="modal-head">
    <div><h2>Movimientos programados</h2><p class="muted">Programa transferencias y gastos automáticos desde la cuenta que elijas.</p></div>
    <button class="close-btn" data-close>×</button>
  </div>
  <button class="btn primary full" id="new-recurring">Nuevo movimiento programado</button>
  <div class="scheduled-v63-list">
    ${rows.length?rows.map(row=>`
      <article class="scheduled-v63-card ${row.active?'':'is-paused'}">
        <div class="scheduled-v63-route">
          <span>${esc(row._schedule_kind==='expense'?(row.source_resource_id?scheduledPlaceLabel('resource',row.source_resource_id):'Cuenta principal'):scheduledPlaceLabel(row.source_type,row.source_id))}</span>
          <b>→</b>
          <span>${row._schedule_kind==='expense'?'Gasto':esc(scheduledPlaceLabel(row.destination_type,row.destination_id))}</span>
        </div>
        <div class="scheduled-v63-main">
          <div>
            <strong>${esc(row.concept)}</strong>
            <small>${scheduledFrequencyLabel(row)} · Próximo: ${esc(row.next_run)}</small>
            ${row.last_error?`<small class="scheduled-v63-error">${esc(row.last_error)}</small>`:''}
          </div>
          <b>${money(row.amount_cents)}</b>
        </div>
        <div class="scheduled-v63-status">${row.active?'Activo':'Pausado'} · ${row._schedule_kind==='expense'?'Gasto':'Transferencia'}</div>
        <div class="scheduled-v63-actions">
          <button class="btn" data-edit-scheduled="${row._schedule_kind}:${row.id}">Editar</button>
          <button class="btn danger" data-delete-scheduled="${row._schedule_kind}:${row.id}">Borrar</button>
        </div>
      </article>`).join(''):'<div class="empty compact">No hay movimientos programados.</div>'}
  </div>`,true);

  document.querySelector('#new-recurring').onclick=()=>openRecurringForm();
  document.querySelectorAll('[data-edit-scheduled]').forEach(button=>{
    button.onclick=()=>{
      const [kind,id]=button.dataset.editScheduled.split(':');
      const row=(kind==='expense'?state.scheduledExpenses:state.recurring).find(item=>String(item.id)===String(id));
      openRecurringForm(row?{...row,_schedule_kind:kind}:null);
    };
  });
  document.querySelectorAll('[data-delete-scheduled]').forEach(button=>{
    button.onclick=async()=>{
      if(!confirm('¿Borrar este movimiento programado?'))return;
      const [kind,id]=button.dataset.deleteScheduled.split(':');
      const table=kind==='expense'?'scheduled_expenses_v66':'scheduled_movements_v63';
      const {error}=await sb.from(table).delete().eq('id',id);
      if(error)return toast(error.message,true);
      await refresh(false);openRecurring();toast('Movimiento programado eliminado');
    };
  });
}
async function openRecurringForm(existing=null){
  const {data:places,error}=await sb.rpc('a2c_schedule_places_v63');
  if(error)return toast(error.message,true);
  const allPlaces=[{place_type:'main',place_id:null,place_label:'Cuenta principal'},...(places||[])];
  const accountPlaces=allPlaces.filter(place=>place.place_type==='main'||place.place_type==='resource');
  const encoded=(type,id)=>`${type}:${id||''}`;
  const options=allPlaces.map(place=>`<option value="${encoded(place.place_type,place.place_id)}">${esc(place.place_label)}</option>`).join('');
  const accountOptions=accountPlaces.map(place=>`<option value="${place.place_id||''}">${esc(place.place_label)}</option>`).join('');
  const initialKind=existing?existing._schedule_kind||'transfer':'expense';

  modal(`<form id="scheduled-v63-form">
    <div class="modal-head"><div><h2>${existing?'Editar':'Nuevo'} movimiento programado</h2><p class="muted">Elige entre un gasto recurrente o una transferencia.</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Tipo de movimiento</label><select name="schedule_kind"><option value="expense">Gasto programado</option><option value="transfer">Transferencia programada</option></select></div>
    <div id="scheduled-expense-fields">
      <div class="field"><label>Cuenta desde la que se paga</label><select name="expense_source">${accountOptions}</select></div>
    </div>
    <div class="scheduled-v63-direction" id="scheduled-transfer-fields">
      <div class="field"><label>Desde</label><select name="source">${options}</select></div><div class="scheduled-v63-arrow">→</div><div class="field"><label>Hacia</label><select name="destination">${options}</select></div>
    </div>
    <div class="field"><label>Concepto</label><input name="concept" required maxlength="140" value="${esc(existing?.concept||'')}"></div>
    <div class="field"><label>Importe (€)</label><input name="amount" inputmode="decimal" required value="${existing?(Number(existing.amount_cents)/100).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}):''}"></div>
    <div class="form-grid"><div class="field"><label>Frecuencia</label><select name="frequency"><option value="monthly">Mensual</option><option value="weekly">Semanal</option><option value="daily">Diaria</option></select></div>
      <div class="field" id="scheduled-v63-monthly"><label>Día del mes</label><input name="day_of_month" type="number" min="1" max="28" value="${existing?.day_of_month||1}"></div>
      <div class="field hidden" id="scheduled-v63-weekly"><label>Día de la semana</label><select name="weekday"><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="0">Domingo</option></select></div>
    </div>
    <div class="field"><label>Primera ejecución</label><input name="next_run" type="date" required value="${esc(existing?.next_run||today())}"></div>
    <label class="remember-login"><input name="active" type="checkbox" ${existing?.active===false?'':'checked'}><span>Programación activa</span></label>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
  </form>`);

  const form=document.querySelector('#scheduled-v63-form');
  const firstNonMain=allPlaces.find(place=>place.place_type!=='main');
  form.elements.schedule_kind.value=initialKind;
  form.elements.source.value=encoded(existing?.source_type||'main',existing?.source_id||null);
  form.elements.destination.value=encoded(existing?.destination_type||firstNonMain?.place_type||'main',existing?.destination_id||firstNonMain?.place_id||null);
  form.elements.expense_source.value=existing?.source_resource_id||'';
  form.elements.frequency.value=existing?.frequency||'monthly';form.elements.weekday.value=String(existing?.weekday??1);
  const syncType=()=>{const expense=form.elements.schedule_kind.value==='expense';document.querySelector('#scheduled-expense-fields').classList.toggle('hidden',!expense);document.querySelector('#scheduled-transfer-fields').classList.toggle('hidden',expense);};
  const syncFrequency=()=>{const frequency=form.elements.frequency.value;document.querySelector('#scheduled-v63-monthly').classList.toggle('hidden',frequency!=='monthly');document.querySelector('#scheduled-v63-weekly').classList.toggle('hidden',frequency!=='weekly');};
  form.elements.schedule_kind.onchange=syncType;form.elements.frequency.onchange=syncFrequency;syncType();syncFrequency();

  form.onsubmit=async event=>{
    event.preventDefault();const button=event.submitter,fd=new FormData(form),kind=String(fd.get('schedule_kind'));
    const common={user_id:state.user.id,concept:String(fd.get('concept')||'').trim(),amount_cents:cents(fd.get('amount')),frequency:String(fd.get('frequency')),day_of_month:fd.get('frequency')==='monthly'?Number(fd.get('day_of_month')||1):null,weekday:fd.get('frequency')==='weekly'?Number(fd.get('weekday')||1):null,next_run:String(fd.get('next_run')),active:fd.get('active')==='on',updated_at:new Date().toISOString()};
    if(!common.concept||common.amount_cents<=0)return toast('Indica un concepto y un importe válido.',true);
    busy(button,true);let result;
    if(kind==='expense'){
      const payload={...common,source_resource_id:String(fd.get('expense_source')||'')||null,payment_method:'bank'};
      if(existing&&existing._schedule_kind==='expense')result=await sb.from('scheduled_expenses_v66').update(payload).eq('id',existing.id);
      else result=await sb.from('scheduled_expenses_v66').insert(payload);
      if(!result.error&&existing&&existing._schedule_kind==='transfer')await sb.from('scheduled_movements_v63').delete().eq('id',existing.id);
    }else{
      const [sourceType,sourceId]=String(fd.get('source')).split(':'),[destinationType,destinationId]=String(fd.get('destination')).split(':');
      if(sourceType===destinationType&&String(sourceId||'')===String(destinationId||'')){busy(button,false);return toast('El origen y el destino no pueden ser iguales.',true);}
      if(sourceType!=='main'&&destinationType!=='main'){busy(button,false);return toast('Uno de los dos extremos debe ser la cuenta principal.',true);}
      const payload={...common,source_type:sourceType,source_id:sourceId||null,destination_type:destinationType,destination_id:destinationId||null};
      if(existing&&existing._schedule_kind==='transfer')result=await sb.from('scheduled_movements_v63').update(payload).eq('id',existing.id);
      else result=await sb.from('scheduled_movements_v63').insert(payload);
      if(!result.error&&existing&&existing._schedule_kind==='expense')await sb.from('scheduled_expenses_v66').delete().eq('id',existing.id);
    }
    busy(button,false);if(result.error)return toast(result.error.message,true);closeModal();await refresh(false);openRecurring();toast(existing?'Programación actualizada':'Movimiento programado creado');
  };
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
  modal(`<div class="modal-head"><div><h2>Perfil</h2><p class="muted">@${esc(profile.username||'usuario')}</p></div><button type="button" class="close-btn" data-close>×</button></div><div class="public-profile social-public-profile">${avatarMarkup(profile,'profile-avatar-large')}<h3>${esc(profile.display_name||'Usuario')}</h3><p>@${esc(profile.username||'usuario')}</p><div class="social-counts"><div><strong>${followerCount(profileId)}</strong><span>Seguidores</span></div><div><strong>${followingCount(profileId)}</strong><span>Seguidos</span></div><div><strong>${posts.length}</strong><span>Publicaciones</span></div></div>${rankingBadgesMarkup(profileId,true)}${!own?`<button class="btn ${follow?.status==='accepted'?'':'primary'}" id="profile-follow">${follow?.status==='accepted'?'Dejar de seguir':follow?.status==='pending'?'Cancelar solicitud':'Seguir'}</button>`:''}</div>${visible?`<div class="profile-post-grid">${posts.length?posts.map(p=>`<button data-open-post="${p.id}"><img src="${esc(socialImageUrl(p))}" alt="Publicación" loading="lazy"></button>`).join(''):'<div class="empty compact">Sin publicaciones.</div>'}</div>`:'<div class="empty">Esta cuenta es privada. Sigue al usuario para ver sus publicaciones.</div>'}`,true);
  document.querySelector('#profile-follow')?.addEventListener('click',()=>toggleFollow(profileId));
  document.querySelectorAll('[data-open-post]').forEach(b=>b.onclick=()=>openSocialPostDetail(b.dataset.openPost));
}
function openProfile(){
  modal(`<form id="profile-form"><div class="modal-head"><div><h2>Mi perfil</h2><p class="muted">${esc(state.profile.email)}</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="profile-photo-editor">${avatarMarkup(state.profile,'profile-avatar-large')}<div><label class="btn receipt-source-btn" for="avatar-file">Cambiar foto</label><input class="receipt-file-input" id="avatar-file" name="avatar" type="file" accept="image/*"><button type="button" class="text-btn ${state.profile.avatar_path?'':'hidden'}" id="remove-avatar">Eliminar foto</button><small class="muted" id="avatar-selection">Imagen cuadrada, comprimida automáticamente.</small></div></div>
    <div class="field"><label>Nombre</label><input name="name" required minlength="2" maxlength="80" value="${esc(state.profile.display_name||'')}"></div><div class="field"><label>Nombre de usuario</label><div class="input-prefix"><span>@</span><input name="username" required minlength="3" maxlength="30" pattern="[a-z0-9._]+" value="${esc(state.profile.username||'')}" placeholder="abel.atero"></div><small class="muted">Solo minúsculas, números, punto y guion bajo.</small></div><div class="field"><label>Privacidad</label><select name="is_public"><option value="true" ${state.profile.is_public!==false?'selected':''}>Cuenta pública</option><option value="false" ${state.profile.is_public===false?'selected':''}>Cuenta privada</option></select></div><div class="field"><label>Nueva contraseña</label><input name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password"></div><div class="a2c41-profile-menu">
      <button type="button" class="a2c41-profile-option" id="a2c41-control-financial"><span>◫</span><div><strong>Control financiero</strong><small>Reglas, categorías y presupuestos</small></div><em>›</em></button>
      <button type="button" class="a2c41-profile-option" id="a2c42-friends-messages"><span>◎</span><div><strong>Amigos y mensajes</strong><small>Busca por @usuario y conversa de forma privada</small></div><em>›</em></button>
      ${window.A2CNative?`<button type="button" class="a2c41-profile-option" id="a2c41-profile-notifications"><span>◉</span><div><strong>Notificaciones</strong><small>Configura pagos y avisos</small></div><em>›</em></button>`:''}
      ${window.A2CNative?`<button type="button" class="a2c41-profile-option" id="android-native-settings"><span>⌁</span><div><strong>Pagos y avisos Android</strong><small>Detección, permisos y diagnóstico</small></div><em>›</em></button>`:''}
      <button type="button" class="a2c41-profile-option" id="a2c41-profile-settings"><span>⚙</span><div><strong>Ajustes</strong><small>Copias de seguridad y aplicación Android</small></div><em>›</em></button>
    </div><style>
      .a2c41-profile-menu{display:grid;gap:8px;margin:16px 0}
      .a2c41-profile-option{display:flex;align-items:center;gap:11px;width:100%;padding:11px 12px;border:1px solid #ebe7f1;border-radius:14px;background:#fff;text-align:left}
      .a2c41-profile-option>span{width:34px;height:34px;border-radius:11px;background:#f1edfa;display:grid;place-items:center;font-size:18px}
      .a2c41-profile-option>div{flex:1;min-width:0}.a2c41-profile-option strong,.a2c41-profile-option small{display:block}
      .a2c41-profile-option small{font-size:11px;color:var(--muted);margin-top:2px}.a2c41-profile-option em{font-style:normal;color:#978da5;font-size:20px}
    </style><div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  document.querySelector('#android-native-settings')?.addEventListener('click',()=>window.A2CNative?.openAndroidSettings());
  document.querySelector('#a2c41-control-financial')?.addEventListener('click',()=>{closeModal();openA2C40Control('rules')});
  document.querySelector('#a2c42-friends-messages')?.addEventListener('click',()=>{closeModal();openA2C42SocialHub()});
  document.querySelector('#a2c41-profile-notifications')?.addEventListener('click',()=>{if(window.A2CNative){closeModal();openA2C40Control('notifications')}});
  document.querySelector('#a2c41-profile-settings')?.addEventListener('click',()=>{closeModal();openA2C41Settings()});
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

// Integración Android 2.0: registra en Supabase el pago confirmado por el usuario.
window.a2cAndroidRegisterPayment = async function (payment) {
  try {
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError || !user) return { ok:false, error:'Inicia sesión en A2C antes de registrar el pago.' };

    const amountCents=Number(payment?.amount_cents||0);
    const merchant=String(payment?.merchant||'Pago con Google Pay').trim().slice(0,120);
    if(!Number.isInteger(amountCents)||amountCents<=0) return {ok:false,error:'El importe detectado no es válido.'};
    if(!merchant) return {ok:false,error:'Indica el comercio o concepto del pago.'};

    const paymentTime=Number(payment?.payment_time||Date.now());
    const date=new Date(paymentTime);
    const occurredOn=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const nativeFingerprint=String(payment?.fingerprint||'').trim();
    const fallbackFingerprint=`${amountCents}|${merchant.toLowerCase()}|${Math.floor(paymentTime/60000)}`;
    const noteTag=`[A2C-ANDROID:${nativeFingerprint||fallbackFingerprint}]`;

    const {data:duplicate,error:duplicateError}=await sb.from('finance_transactions')
      .select('id').eq('creator_id',user.id).eq('notes',noteTag).limit(1);
    if(duplicateError)return {ok:false,error:duplicateError.message};
    if(duplicate?.length)return {ok:false,duplicate:true,error:'Esta transacción ya estaba registrada.'};

    const {error}=await sb.from('finance_transactions').insert({
      creator_id:user.id,
      resource_id:null,
      kind:'expense',
      category_id:null,
      merchant,
      payment_method:'bank',
      amount_cents:amountCents,
      concept:merchant,
      occurred_on:occurredOn,
      notes:noteTag,
      fuel_liters:Number(payment?.fuel_liters)||null,
      fuel_price_per_liter_milli:Number(payment?.fuel_price_per_liter_milli)||null,
      fuel_consumption_l100km:null
    });
    if(error)return {ok:false,error:error.message};
    if(typeof refresh==='function')await refresh();
    return {ok:true};
  }catch(error){
    return {ok:false,error:error?.message||'No se pudo registrar la transacción.'};
  }
};


// Datos actualizados para widgets y avisos nativos Android 2.5.
window.a2cAndroidGetNativeData = async function(){
  try{
    const {data:{user},error:userError}=await sb.auth.getUser();
    if(userError||!user)return {error:'not_authenticated'};
    const now=new Date(),monthKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const since30=new Date(now);since30.setDate(since30.getDate()-29);const since30Key=since30.toISOString().slice(0,10);
    const [txResult,scheduledResult,scheduledExpenseResult,budgetResult,notificationResult]=await Promise.all([
      sb.from('finance_transactions').select('amount_cents,kind,occurred_on,resource_id,payment_method,is_transfer,transfer_role,fuel_liters,fuel_price_per_liter_milli,budget_category,concept,merchant,notes,resource:resources(type)'),
      sb.from('scheduled_movements_v63').select('id,user_id,concept,amount_cents,next_run,active').eq('user_id',user.id).eq('active',true).order('next_run',{ascending:true}),
      sb.from('scheduled_expenses_v66').select('id,user_id,concept,amount_cents,next_run,active').eq('user_id',user.id).eq('active',true).order('next_run',{ascending:true}),
      sb.from('budgets_v67').select('id,name,category_key,amount_cents,period_month,active').eq('user_id',user.id).eq('active',true).eq('period_month',monthKey).order('created_at',{ascending:true}),
      sb.from('notifications').select('id,type,title,message,created_at,related_id').eq('user_id',user.id).is('read_at',null).order('created_at',{ascending:false}).limit(20)
    ]);
    if(txResult.error)return {error:txResult.error.message,retry:true};
    const transactions=(txResult.data||[]).filter(row=>!(row?.is_transfer&&row?.transfer_role==='destination'));
    const available=transactions.filter(row=>row?.payment_method!=='crypto'&&(!row?.resource_id||row?.resource?.type==='folder')).reduce((sum,row)=>sum+(row.kind==='income'?Number(row.amount_cents||0):-Number(row.amount_cents||0)),0);
    const monthRows=transactions.filter(row=>String(row.occurred_on||'').startsWith(monthKey));
    const totals={income:0,expense:0,saving:0,investment:0};
    monthRows.forEach(row=>{if(Object.prototype.hasOwnProperty.call(totals,row.kind))totals[row.kind]+=Number(row.amount_cents||0);});
    const fuelRows=transactions.filter(row=>row.kind==='expense'&&String(row.occurred_on||'')>=since30Key&&Number(row.fuel_liters)>0);
    const fuelLiters=fuelRows.reduce((sum,row)=>sum+Number(row.fuel_liters||0),0);
    const fuelTotal=fuelRows.reduce((sum,row)=>sum+Number(row.amount_cents||0),0);
    const weightedFuelCost=fuelRows.reduce((sum,row)=>sum+(Number(row.fuel_price_per_liter_milli||0)*Number(row.fuel_liters||0)),0);
    const fuelAverageMilli=fuelLiters>0?Math.round(weightedFuelCost/fuelLiters):0;
    const transferScheduled=scheduledResult.error?[]:(scheduledResult.data||[]);
    const expenseScheduled=scheduledExpenseResult.error?[]:(scheduledExpenseResult.data||[]);
    const scheduled=[...transferScheduled,...expenseScheduled].map(row=>({id:row.id,concept:row.concept,amount_cents:row.amount_cents,next_run:row.next_run,active:row.active})).sort((a,b)=>String(a.next_run).localeCompare(String(b.next_run))).slice(0,6);
    const budgets=(budgetResult.error?[]:(budgetResult.data||[])).map(budget=>{const spent=transactions.filter(row=>row.kind==='expense'&&String(row.occurred_on||'').startsWith(budget.period_month)&&detectBudgetCategory(row)===budget.category_key).reduce((sum,row)=>sum+Number(row.amount_cents||0),0);return {id:budget.id,name:budget.name,category_key:budget.category_key,amount_cents:Number(budget.amount_cents||0),spent_cents:spent,remaining_cents:Math.max(0,Number(budget.amount_cents||0)-spent),percentage:Number(budget.amount_cents||0)>0?Math.min(100,Math.round(spent/Number(budget.amount_cents||0)*100)):0};});
    const collaboration_notifications=(notificationResult.error?[]:(notificationResult.data||[])).filter(n=>/expense|request|resource|group|invitation|goal|folder|piggy/i.test(String(n.type||'')+' '+String(n.title||'')+' '+String(n.message||'')));
    const latestExpense=transactions.filter(row=>row.kind==='expense').sort((a,b)=>String(b.occurred_on||'').localeCompare(String(a.occurred_on||'')))[0]||null;
    return {available_cents:available,month_income_cents:totals.income,month_expenses_cents:totals.expense,month_saving_cents:totals.saving,month_investment_cents:totals.investment,fuel_30d_liters:fuelLiters,fuel_30d_total_cents:fuelTotal,fuel_30d_average_milli:fuelAverageMilli,latest_expense_amount_cents:Number(latestExpense?.amount_cents||0),latest_expense_concept:String(latestExpense?.merchant||latestExpense?.concept||''),latest_expense_date:String(latestExpense?.occurred_on||''),scheduled,budgets,collaboration_notifications};
  }catch(error){return {error:error?.message||'sync_failed',retry:true};}
};

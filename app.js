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
  user: null, profile: null, tab: 'home',
  profiles: [], resources: [], members: [], invitations: [],
  transactions: [], notifications: [],
  recurring: [],
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
    <div class="field"><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
    <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn primary full">Entrar</button>
  </form></section>`;
  document.querySelector('#login-form').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);
    const {error}=await sb.auth.signInWithPassword({email:String(fd.get('email')).trim().toLowerCase(),password:String(fd.get('password'))});
    busy(b,false);if(error)toast('Email o contraseña incorrectos',true);
  };
}

async function enter(){
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
    sb.from('resource_members').select('*,profile:profiles(id,email,display_name)').order('created_at'),
    sb.from('resource_invitations').select('*').order('created_at',{ascending:false}),
    sb.from('finance_transactions').select('*,resource:resources(id,name,type)').order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
    sb.from('notifications').select('*').order('created_at',{ascending:false}),
    sb.from('recurring_transactions').select('*,resource:resources(id,name,type)').order('next_date')
  ];
  if(isAdmin())q.push(sb.from('profiles').select('*').order('email'));
  const result=await Promise.all(q);
  for(const r of result)if(r.error)throw r.error;
  [state.resources,state.members,state.invitations,state.transactions,state.notifications,state.recurring]=result.slice(0,6).map(r=>r.data||[]);
  state.profiles=isAdmin()?(result[6]?.data||[]):[];
}

async function refresh(render=true){await loadAll();if(render)renderShell()}

const uiIcons={
  home:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-7H9v7H3.5a.5.5 0 0 1-.5-.5z"/></svg>',
  piggy:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10a7 7 0 0 1 12.5-4.3L21 5v5h-2a7 7 0 0 1-3 5.7V20h-3v-3H9v3H6v-4.1A6.9 6.9 0 0 1 5 10Zm3-2h4"/></svg>',
  folder:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
  goal:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m12 12 7-7"/></svg>',
  activity:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V9m5 9V5m5 13v-7m5 7V3"/></svg>',
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
      <button class="brand-compact" id="profile" aria-label="Abrir perfil"><img class="brand-logo brand-logo-header" src="./logo-a2c.png" alt=""></button>
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
    <nav class="bottom-nav" aria-label="Navegación principal">${nav('home','Inicio')}${nav('piggy','Huchas')}${nav('folder','Carpetas')}${nav('goal','Objetivos')}${nav('activity','Actividad')}${nav('stats','Estadísticas')}</nav>
  </div>`;
  bind();
}
function renderPage(){
  if(state.tab==='home')return renderHome();
  if(['piggy','folder','goal'].includes(state.tab))return renderResources(state.tab);
  if(state.tab==='activity')return renderActivity();
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
      return !t.resource_id||t.resource?.type==='folder';
    })
    .reduce((s,t)=>s+(t.kind==='income'?Number(t.amount_cents):-Number(t.amount_cents)),0);
}
function txRow(tx){
  const space=tx.resource?.name?esc(tx.resource.name):'Cuenta principal';
  const payment=tx.payment_method==='cash'?'Efectivo':'Banco';
  const symbol=tx.kind==='income'?'↗':tx.kind==='expense'?'↘':tx.kind==='investment'?'◆':'◎';
  const fuel=tx.fuel_liters?` · ${Number(tx.fuel_liters).toLocaleString('es-ES',{maximumFractionDigits:2})} L${tx.fuel_consumption_l100km?` · ${Number(tx.fuel_consumption_l100km).toLocaleString('es-ES',{maximumFractionDigits:2})} L/100 km`:''}`:'';
  return `<article class="transaction-row clickable" data-edit-tx="${tx.id}" tabindex="0">
    <div class="transaction-icon ${tx.kind}">${symbol}</div>
    <div class="transaction-copy"><strong>${esc(tx.concept)}</strong><small>${esc(tx.occurred_on)} · ${space} · ${payment}${tx.is_transfer?' · Traspaso':''}${fuel}</small></div>
    <div class="transaction-tail"><b class="${tx.kind}">${tx.kind==='income'?'+':'−'}${money(tx.amount_cents)}</b>${tx.receipt_path?`<button type="button" class="receipt-thumb-btn" data-receipt-path="${esc(tx.receipt_path)}" aria-label="Ver imagen adjunta" title="Ver imagen">🖼️</button>`:''}</div>
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
      const balance=resourceBalance(r.id),members=state.members.filter(m=>m.resource_id===r.id).length,pct=r.target_cents?Math.min(100,Math.round(Math.max(0,balance)/r.target_cents*100)):0;
      return `<article class="card"><div class="entity-header"><div><h3>${esc(r.name)}</h3><p class="muted">${r.is_shared?`Compartido · ${members} miembros`:'Personal'}</p></div><button class="icon-btn" data-resource="${r.id}">•••</button></div><div class="metric">${money(balance)}</div>${type==='goal'?`<div class="progress"><i style="width:${pct}%"></i></div><small>${pct}% de ${money(r.target_cents)}${r.target_date?` · ${esc(r.target_date)}`:''}</small>`:''}${r.description?`<p class="muted">${esc(r.description)}</p>`:''}</article>`;
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
    const name=String(tx.concept||'Inversión').trim()||'Inversión';
    const key=name.toLowerCase();
    const row=map.get(key)||{concept:name,total:0,count:0};
    row.total+=Number(tx.amount_cents)||0; row.count++;
    map.set(key,row);
  }
  return [...map.values()].sort((a,b)=>b.total-a.total);
}
function statsTransactions(){
  return filtered();
}
function renderStats(){
  const list=statsTransactions(),t=totals(list),series=monthlySeries(12,list);
  const expenses=conceptSpending(list,'expense'),portfolio=investmentPortfolio(list),savings=conceptSpending(list,'saving');
  const maxExpense=Math.max(1,...expenses.map(c=>c.value));
  const cashflow=t.income-t.expense-t.investment-t.saving;
  const rate=t.income?Math.round((t.income-t.expense-t.investment)/t.income*100):0;
  return `<section>
    <div class="dashboard-head"><div><span class="eyebrow">Inteligencia financiera</span><h1>Estadísticas</h1><p class="muted">Analiza conceptos, ahorro, inversión y combustible.</p></div><div class="head-actions"><button class="btn ghost" data-export-csv>Exportar CSV</button></div></div>
    <form class="stats-toolbar stats-segments" id="stats-filter"><label>Desde<input name="from" type="date" value="${esc(state.filters.from)}"></label><label>Hasta<input name="to" type="date" value="${esc(state.filters.to)}"></label><label>Tipo<select name="kind"><option value="">Todos</option>${Object.entries(kindLabels).map(([k,l])=>`<option value="${k}" ${state.filters.kind===k?'selected':''}>${l}</option>`).join('')}</select></label><label>Segmento<select name="resourceType"><option value="">Todos</option><option value="main" ${state.filters.resourceType==='main'?'selected':''}>Cuenta principal</option><option value="piggy" ${state.filters.resourceType==='piggy'?'selected':''}>Huchas</option><option value="folder" ${state.filters.resourceType==='folder'?'selected':''}>Carpetas</option><option value="goal" ${state.filters.resourceType==='goal'?'selected':''}>Objetivos</option></select></label><label>Elemento<select name="resourceId"><option value="">Todos</option>${state.resources.filter(r=>!state.filters.resourceType||state.filters.resourceType===r.type).map(r=>`<option value="${r.id}" ${state.filters.resourceId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label><button type="button" class="period-chip" data-period="month">Este mes</button><button type="button" class="period-chip" data-period="quarter">3 meses</button><button type="button" class="period-chip" data-period="year">Este año</button></form>
    <div class="kpi-grid"><article class="kpi-card"><span>Flujo neto</span><strong class="${cashflow>=0?'income':'expense'}">${money(cashflow)}</strong><small>Ingresos menos salidas</small></article><article class="kpi-card"><span>Tasa de ahorro</span><strong class="${rate>=20?'income':'saving'}">${rate}%</strong><small>Sobre ingresos</small></article><article class="kpi-card"><span>Ahorro</span><strong class="saving">${money(t.saving)}</strong><small>Total seleccionado</small></article><article class="kpi-card"><span>Inversión</span><strong class="investment">${money(t.investment)}</strong><small>Total seleccionado</small></article></div>
    <article class="card chart-card"><div class="card-head"><div><h2>Tendencia financiera</h2><p class="muted">Ingresos y gastos mensuales</p></div><div class="chart-key"><span class="key-income">Ingresos</span><span class="key-expense">Gastos</span></div></div>${professionalLineChart(series)}</article>
    <div class="dashboard-grid"><article class="card"><div class="card-head"><div><h2>Gastos por concepto</h2><p class="muted">Sin categorías: agrupación por el texto del movimiento</p></div></div><div class="category-bars">${expenses.length?expenses.map(c=>`<div class="category-bar"><div><span>${esc(c.name)}</span><b>${money(c.value)}</b></div><div class="bar-track"><i style="width:${Math.round(c.value/maxExpense*100)}%"></i></div></div>`).join(''):'<div class="empty compact">No hay gastos en este periodo.</div>'}</div></article><article class="card"><div class="card-head"><div><h2>Inversión por concepto</h2><p class="muted">No requiere ISIN ni número de acciones</p></div></div><div class="portfolio-list">${portfolio.length?portfolio.map(p=>`<div class="portfolio-row"><div><strong>${esc(p.concept)}</strong><small>${p.count} movimiento${p.count===1?'':'s'}</small></div><div><b>${money(p.total)}</b></div></div>`).join(''):'<div class="empty compact">No hay inversiones en este segmento.</div>'}</div></article></div>
    <div class="dashboard-grid"><article class="card"><div class="card-head"><div><h2>Ahorro por objetivo o concepto</h2><p class="muted">Aportaciones registradas</p></div></div><div class="portfolio-list">${savings.length?savings.map(p=>`<div class="portfolio-row"><div><strong>${esc(p.name)}</strong><small>${p.count} aportación${p.count===1?'':'es'}</small></div><div><b>${money(p.value)}</b></div></div>`).join(''):'<div class="empty compact">No hay ahorros en este segmento.</div>'}</div></article><article class="card"><div class="card-head"><div><h2>Combustible</h2><p class="muted">Repostajes detectados por concepto</p></div></div><div class="portfolio-list">${list.filter(x=>x.fuel_liters).length?list.filter(x=>x.fuel_liters).map(x=>`<div class="portfolio-row"><div><strong>${esc(x.concept)}</strong><small>${Number(x.fuel_liters).toLocaleString('es-ES',{maximumFractionDigits:2})} L · ${x.fuel_price_per_liter_milli?(Number(x.fuel_price_per_liter_milli)/1000).toLocaleString('es-ES',{minimumFractionDigits:3,maximumFractionDigits:3})+' €/L':'—'}${x.fuel_consumption_l100km?' · '+Number(x.fuel_consumption_l100km).toLocaleString('es-ES',{maximumFractionDigits:2})+' L/100 km':''}</small></div><div><b>${money(x.amount_cents)}</b></div></div>`).join(''):'<div class="empty compact">No hay repostajes con detalle.</div>'}</div></article></div>
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
  document.querySelectorAll('[data-tab-shortcut]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tabShortcut;renderShell()});
    document.querySelectorAll('[data-manage-recurring]').forEach(b=>b.onclick=openRecurring);
  document.querySelector('[data-export-csv]')?.addEventListener('click',exportCsv);
  document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>applyPeriod(b.dataset.period));
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
  return `<option value="">Cuenta principal</option>${allowed.map(r=>`<option value="${r.id}" ${selected===r.id?'selected':''}>${esc(r.name)} · ${resourceLabels[r.type]||r.type}</option>`).join('')}`;
}
function goalOptions(selected=''){return `<option value="">Sin objetivo</option>${state.resources.filter(r=>r.type==='goal').map(r=>`<option value="${r.id}" ${selected===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}`}
function openTransaction(tx={}){
  const editing=Boolean(tx.id),selectedKind=tx.kind||'expense',selectedResource=tx.resource_id||'';
  modal(`<form id="tx-form"><div class="modal-head"><div><h2>${editing?'Editar':'Nuevo'} movimiento</h2><p class="muted">Registra el concepto, el importe y los detalles necesarios.</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="form-grid"><div class="field"><label>Tipo</label><select name="kind">${Object.entries(kindLabels).map(([k,label])=>`<option value="${k}" ${selectedKind===k?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label>Forma de pago</label><select name="payment_method"><option value="bank" ${tx.payment_method!=='cash'?'selected':''}>Banco</option><option value="cash" ${tx.payment_method==='cash'?'selected':''}>Efectivo</option></select></div></div>
    <div class="field"><label>Concepto</label><input name="concept" required value="${esc(tx.concept||'')}" placeholder="Ej. Nómina, gasolina, fondo indexado…"></div>
    <div class="field" id="resource-field"><label>Cuenta / espacio</label><select name="resource_id" ${editing?'disabled':''}>${resourceOptions(selectedResource,selectedKind)}</select><small class="muted" id="piggy-transfer-note"></small></div>
    <div class="field hidden" id="saving-goal-field"><label>Objetivo de ahorro</label><select name="saving_goal_id">${goalOptions(tx.kind==='saving'&&tx.resource?.type==='goal'?tx.resource_id:'')}</select><small class="muted">Puedes asignar el ahorro a un objetivo o dejarlo sin objetivo.</small></div>
    <div class="fuel-detail hidden" id="fuel-detail"><div class="fuel-title">⛽ Detalle de combustible</div><p class="muted">Al escribir gasolina, diésel, combustible o repostaje se activa este cálculo.</p><div class="form-grid"><div class="field"><label>Litros</label><input name="fuel_liters" inputmode="decimal" value="${tx.fuel_liters||''}" placeholder="0,00"></div><div class="field"><label>Precio por litro (€)</label><input name="fuel_price" inputmode="decimal" value="${tx.fuel_price_per_liter_milli?Number(tx.fuel_price_per_liter_milli)/1000:''}" placeholder="1,650"></div><div class="field"><label>Km desde anterior</label><input name="fuel_km" inputmode="decimal" value="${tx.fuel_km||''}" placeholder="Opcional"></div></div><div class="fuel-calculated" id="fuel-calculated">Introduce litros y precio por litro para calcular el total.</div></div>
    <div class="field"><label>Importe total (€)</label><input name="amount" inputmode="decimal" required value="${tx.amount_cents?Number(tx.amount_cents)/100:''}"></div><div class="field"><label>Fecha</label><input name="date" type="date" required value="${tx.occurred_on||today()}"></div><div class="field"><label>Notas</label><textarea name="notes">${esc(tx.notes||'')}</textarea></div>
    <div class="field receipt-picker"><label>Justificante</label><div class="receipt-picker-actions"><button type="button" class="btn receipt-source-btn" id="open-integrated-camera">📷 Abrir cámara</button><label class="btn receipt-source-btn" for="receipt-gallery">▣ Elegir imagen</label></div><input id="receipt-gallery" name="receipt_gallery" class="receipt-file-input" type="file" accept="image/*"><small class="muted receipt-selection" id="receipt-selection">No se ha seleccionado ninguna imagen.</small></div>
    <div class="actions">${editing?'<button type="button" class="btn danger" id="delete-tx">Borrar</button>':''}<button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,true);
  const form=document.querySelector('#tx-form'),kind=form.elements.kind,resource=form.elements.resource_id,concept=form.elements.concept,amount=form.elements.amount;
  const galleryInput=document.querySelector('#receipt-gallery'),receiptSelection=document.querySelector('#receipt-selection');
  let pendingReceiptFile=null;
  const setReceiptSelection=file=>{pendingReceiptFile=file||null;if(receiptSelection)receiptSelection.textContent=file?`Imagen seleccionada: ${file.name||'foto tomada'}`:'No se ha seleccionado ninguna imagen.';};
  document.querySelector('#open-integrated-camera')?.addEventListener('click',()=>openIntegratedCamera(file=>{if(galleryInput)galleryInput.value='';setReceiptSelection(file)}));
  galleryInput?.addEventListener('change',()=>setReceiptSelection(galleryInput.files?.[0]||null));
  const update=()=>{const saving=kind.value==='saving',fuel=kind.value==='expense'&&isFuelConcept(concept.value);document.querySelector('#saving-goal-field').classList.toggle('hidden',!saving);document.querySelector('#fuel-detail').classList.toggle('hidden',!fuel);const selected=state.resources.find(r=>r.id===resource.value);document.querySelector('#piggy-transfer-note').textContent=selected?.type==='piggy'&&(kind.value==='income'||saving)?'Esta aportación se restará automáticamente de la cuenta principal.':selected?.type==='folder'?'Este movimiento afectará al saldo de la cuenta principal.':'';syncFuel()};
  const syncFuel=()=>{const liters=positive(form.elements.fuel_liters?.value),price=positive(form.elements.fuel_price?.value),km=positive(form.elements.fuel_km?.value),box=document.querySelector('#fuel-calculated');if(!box)return;if(liters&&price){const total=liters*price;amount.value=total.toFixed(2);const consumption=km?liters/km*100:null;box.textContent=`Total calculado: ${new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(total)} (${liters.toLocaleString('es-ES')} L × ${price.toLocaleString('es-ES',{minimumFractionDigits:3,maximumFractionDigits:3})} €/L).${consumption?` Consumo estimado: ${consumption.toLocaleString('es-ES',{maximumFractionDigits:2})} L/100 km.`:''}`;}else box.textContent='Introduce litros y precio por litro para calcular el total.'};
  kind.onchange=()=>{const old=resource.value;resource.innerHTML=resourceOptions(old,kind.value);update()};resource.onchange=update;concept.oninput=update;form.elements.fuel_liters?.addEventListener('input',syncFuel);form.elements.fuel_price?.addEventListener('input',syncFuel);form.elements.fuel_km?.addEventListener('input',syncFuel);update();
  form.onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(form);busy(b,true);try{const kindValue=String(fd.get('kind')),goalId=kindValue==='saving'?(fd.get('saving_goal_id')||null):null;const selectedResourceId=editing?tx.resource_id:(goalId||fd.get('resource_id')||null),selectedResource=state.resources.find(r=>r.id===selectedResourceId);const fuelActive=kindValue==='expense'&&isFuelConcept(fd.get('concept'));const liters=fuelActive?positive(fd.get('fuel_liters')):null,price=fuelActive?positive(fd.get('fuel_price')):null,km=fuelActive?positive(fd.get('fuel_km')):null;const payload={kind:kindValue,category_id:null,merchant:'',payment_method:String(fd.get('payment_method')||'bank'),amount_cents:cents(fd.get('amount')),concept:String(fd.get('concept')).trim(),occurred_on:fd.get('date'),notes:String(fd.get('notes')||''),investment_isin:null,investment_quantity:null,investment_unit_price_cents:null,fuel_liters:liters,fuel_price_per_liter_milli:price?Math.round(price*1000):null,fuel_km:km,fuel_consumption_l100km:liters&&km?Number((liters/km*100).toFixed(2)):null};if(payload.amount_cents<=0)throw new Error('El importe debe ser mayor que cero.');let id=tx.id;if(editing){const {error}=await sb.rpc('update_finance_transaction_v4',{p_transaction_id:tx.id,p_kind:payload.kind,p_category_id:null,p_merchant:'',p_payment_method:payload.payment_method,p_amount_cents:payload.amount_cents,p_concept:payload.concept,p_occurred_on:payload.occurred_on,p_notes:payload.notes,p_investment_isin:null,p_investment_quantity:null,p_investment_unit_price_cents:null});if(error)throw error;const {error:extra}=await sb.from('finance_transactions').update({fuel_liters:payload.fuel_liters,fuel_price_per_liter_milli:payload.fuel_price_per_liter_milli,fuel_km:payload.fuel_km,fuel_consumption_l100km:payload.fuel_consumption_l100km,category_id:null,merchant:''}).eq('id',id);if(extra)throw extra;}else if(selectedResource?.type==='piggy'&&(kindValue==='income'||kindValue==='saving')){const {data,error}=await sb.rpc('create_piggy_transfer_v4',{p_piggy_id:selectedResource.id,p_amount_cents:payload.amount_cents,p_concept:payload.concept,p_occurred_on:payload.occurred_on,p_notes:payload.notes,p_payment_method:payload.payment_method});if(error)throw error;id=data;}else{const {data,error}=await sb.from('finance_transactions').insert({...payload,resource_id:selectedResourceId}).select('id').single();if(error)throw error;id=data.id;}const originalFile=pendingReceiptFile||galleryInput?.files?.[0]||null;if(originalFile instanceof File&&originalFile.size){const file=await compressReceipt(originalFile);const ext=(file.type==='image/jpeg'?'jpg':(file.name.split('.').pop()||'img').toLowerCase());const path=`${state.user.id}/${id}/${crypto.randomUUID()}.${ext}`;const {error}=await sb.storage.from('receipts').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(error)throw error;const {error:pe}=await sb.from('finance_transactions').update({receipt_path:path}).eq('id',id);if(pe)throw pe;}closeModal();await refresh();toast(editing?'Movimiento actualizado':fuelActive?'Repostaje guardado':goalId?'Ahorro asignado al objetivo':'Movimiento guardado');}catch(error){toast(error.message,true)}finally{busy(b,false)}};
  document.querySelector('#delete-tx')?.addEventListener('click',async()=>{if(!confirm('¿Borrar este movimiento?'))return;const {error}=await sb.rpc('delete_finance_transaction_v4',{p_transaction_id:tx.id});if(error)return toast(error.message,true);closeModal();await refresh();toast('Movimiento eliminado')});
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
    <button class="btn" id="resource-edit">Editar</button>${r.is_shared?'<button class="btn" id="resource-invite">Invitar usuario</button>':''}<button class="btn" id="resource-view">Ver movimientos</button>
  </div>`);
  document.querySelector('#resource-edit').onclick=()=>openResource(r);
  document.querySelector('#resource-invite')?.addEventListener('click',()=>openInvite(r));
  document.querySelector('#resource-view').onclick=()=>{state.filters.resourceId=id;state.tab='activity';closeModal();renderShell()};
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
  const rows=[['Fecha','Tipo','Concepto','Forma de pago','Espacio','Litros','Precio litro','Km','Consumo L/100 km','Importe']];
  for(const t of filtered())rows.push([t.occurred_on,kindLabels[t.kind],t.concept,t.payment_method==='cash'?'Efectivo':'Banco',t.resource?.name||'Cuenta principal',t.fuel_liters||'',t.fuel_price_per_liter_milli?(Number(t.fuel_price_per_liter_milli)/1000).toFixed(3):'',t.fuel_km||'',t.fuel_consumption_l100km||'',(Number(t.amount_cents)/100).toFixed(2)]);
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

function openProfile(){
  modal(`<form id="profile-form"><div class="modal-head"><div><h2>Mi perfil</h2><p class="muted">${esc(state.profile.email)}</p></div><button type="button" class="close-btn" data-close>×</button></div><div class="field"><label>Nombre</label><input name="name" required value="${esc(state.profile.display_name||'')}"></div><div class="field"><label>Nueva contraseña</label><input name="password" type="password" minlength="10"></div><div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  document.querySelector('#profile-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);try{const {error}=await sb.from('profiles').update({display_name:String(fd.get('name')).trim()}).eq('id',state.user.id);if(error)throw error;const p=String(fd.get('password')||'');if(p){const {error:pe}=await sb.auth.updateUser({password:p});if(pe)throw pe}closeModal();await enter();toast('Perfil actualizado')}catch(error){toast(error.message,true)}finally{busy(b,false)}};
}
function openAdmin(){
  modal(`<div class="modal-head"><div><h2>Administración</h2><p class="muted">Usuarios y permisos</p></div><button class="close-btn" data-close>×</button></div><button class="btn primary" id="new-user">Crear usuario</button><div class="list" style="margin-top:14px">${state.profiles.map(p=>`<article class="row"><div><strong>${esc(p.display_name||p.email)}</strong><small>${esc(p.email)} · ${esc(p.role)} · ${p.active?'Activo':'Inactivo'}</small></div><button class="btn" data-user="${p.id}">Gestionar</button></article>`).join('')}</div>`,true);
  document.querySelector('#new-user').onclick=()=>openUserForm(null);
  document.querySelectorAll('[data-user]').forEach(b=>b.onclick=()=>openUserForm(state.profiles.find(p=>p.id===b.dataset.user)));
}
function openUserForm(p){
  closeModal();modal(`<form id="user-form"><div class="modal-head"><h2>${p?'Editar':'Crear'} usuario</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Email</label><input name="email" type="email" required value="${esc(p?.email||'')}" ${p?'disabled':''}></div><div class="field"><label>Nombre</label><input name="name" required value="${esc(p?.display_name||'')}"></div>
    <div class="field"><label>Rol</label><select name="role"><option value="user">Usuario</option><option value="admin" ${p?.role==='admin'?'selected':''}>Administrador</option></select></div>
    <div class="field"><label>Estado</label><select name="active"><option value="true">Activo</option><option value="false" ${p?.active===false?'selected':''}>Inactivo</option></select></div>
    <div class="field"><label>${p?'Nueva contraseña':'Contraseña inicial'}</label><input name="password" type="password" minlength="10" ${p?'':'required'}></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
  document.querySelector('#user-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.currentTarget);busy(b,true);const {data,error}=await sb.functions.invoke('admin-users',{body:{action:p?'update':'create',user_id:p?.id,email:p?.email||String(fd.get('email')).trim().toLowerCase(),display_name:String(fd.get('name')).trim(),role:fd.get('role'),active:fd.get('active')==='true',password:String(fd.get('password')||''),permissions:p?.permissions||{can_create_shared:true,can_invite:true,can_upload_receipts:true}}});busy(b,false);if(error||!data?.ok)return toast(data?.error||error?.message||'No se pudo guardar',true);closeModal();await refresh();openAdmin();toast('Usuario guardado')};
}

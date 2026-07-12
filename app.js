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
  categories: [], budgets: [], recurring: [],
  filters: { query:'', kind:'', resourceId:'', resourceType:'', categoryId:'', from:'', to:'' }
};

const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format((Number(v)||0)/100);
const cents = v => { let t=String(v??'0').trim().replace(/\s|€/g,''); if(t.includes(','))t=t.replace(/\./g,'').replace(',','.'); const n=Number(t); return Number.isFinite(n)?Math.round(n*100):0; };
const today = () => new Date().toISOString().slice(0,10);
const isAdmin = () => state.profile?.role === 'admin';
const kindLabels = { income:'Ingreso', expense:'Gasto', investment:'Inversión', saving:'Ahorro' };
const resourceLabels = { piggy:'Hucha', folder:'Carpeta', goal:'Objetivo' };
const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function toast(message,bad=false){
  toastEl.textContent=message; toastEl.classList.toggle('bad',bad); toastEl.classList.add('show');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>toastEl.classList.remove('show'),2800);
}
function modal(html,wide=false){
  closeModal();
  document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="modal"><div class="modal-card ${wide?'wide':''}">${html}</div></div>`);
  document.querySelector('#modal').onclick=e=>{if(e.target.id==='modal'||e.target.closest('[data-close]'))closeModal()};
}
function closeModal(){document.querySelector('#modal')?.remove()}
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
    <div class="brand"><div class="brand-mark">A2C</div><div><h1>A2C Finanzas</h1><p class="muted">Finanzas personales y compartidas</p></div></div>
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
    sb.from('finance_transactions').select('*,resource:resources(id,name,type),category:finance_categories(id,name,icon)').order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
    sb.from('notifications').select('*').order('created_at',{ascending:false}),
    sb.from('finance_categories').select('*').order('sort_order').order('name'),
    sb.from('monthly_budgets').select('*,category:finance_categories(id,name,icon)').order('month',{ascending:false}),
    sb.from('recurring_transactions').select('*,category:finance_categories(id,name,icon),resource:resources(id,name,type)').order('next_date')
  ];
  if(isAdmin())q.push(sb.from('profiles').select('*').order('email'));
  const result=await Promise.all(q);
  for(const r of result)if(r.error)throw r.error;
  [state.resources,state.members,state.invitations,state.transactions,state.notifications,state.categories,state.budgets,state.recurring]=result.map(r=>r.data||[]);
  state.profiles=isAdmin()?(result[8]?.data||[]):[];
}

async function refresh(render=true){await loadAll();if(render)renderShell()}

function nav(tab,label){return `<button class="nav-btn ${state.tab===tab?'active':''}" data-tab="${tab}">${label}</button>`}
function renderShell(){
  const unread=state.notifications.filter(n=>!n.read_at).length;
  app.innerHTML=`<div class="app-shell">
    <header class="topbar">
      <div class="top-brand"><div class="brand-mark">A2C</div><div><strong>A2C Finanzas</strong><small class="muted">${esc(state.profile.display_name||state.profile.email)}</small></div></div>
      <div class="top-actions">
        <button class="icon-btn hidden" id="install-app">Instalar</button>
        <button class="icon-btn" id="notifications">🔔${unread?`<span class="badge">${unread}</span>`:''}</button>
        ${isAdmin()?'<button class="icon-btn" id="admin">⚙</button>':''}
        <button class="icon-btn" id="profile">👤</button>
        <button class="icon-btn" id="logout">Salir</button>
      </div>
    </header>
    <main class="view">${renderPage()}</main>
    <button class="finance-fab" id="finance-fab" aria-label="Añadir movimiento">＋</button>
    <nav class="bottom-nav">${nav('home','Inicio')}${nav('piggy','Huchas')}${nav('folder','Carpetas')}${nav('goal','Objetivos')}${nav('activity','Actividad')}${nav('stats','Estadísticas')}</nav>
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
  const category = tx.kind==='expense'&&tx.category ? ` · ${esc(tx.category.icon || '•')} ${esc(tx.category.name)}` : '';
  const payment = tx.payment_method==='cash' ? ' · Efectivo' : ' · Banco';
  const transfer = tx.is_transfer ? ' · Traspaso' : '';
  return `<article class="transaction-row clickable" data-edit-tx="${tx.id}">
    <div class="transaction-icon ${tx.kind}">${tx.kind==='income'?'↗':tx.kind==='expense'?'↘':tx.kind==='investment'?'◆':'◎'}</div>
    <div class="transaction-copy"><strong>${esc(tx.concept)}</strong><small>${esc(tx.occurred_on)}${category}${tx.resource?.name?` · ${esc(tx.resource.name)}`:' · Cuenta principal'}${payment}${transfer}</small></div>
    <b class="${tx.kind}">${tx.kind==='income'?'+':'-'}${money(tx.amount_cents)}</b>
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
function categorySpending(list=monthTransactions()){
  const map=new Map();
  for(const tx of list.filter(t=>t.kind==='expense')){
    const name=tx.category?.name||'Sin categoría';
    const icon=tx.category?.icon||'•';
    const current=map.get(name)||{name,icon,value:0};
    current.value+=Number(tx.amount_cents)||0;
    map.set(name,current);
  }
  return [...map.values()].sort((a,b)=>b.value-a.value);
}
function budgetStatus(){
  const month=currentMonthKey();
  return state.budgets.filter(b=>b.month===month).map(b=>{
    const spent=state.transactions.filter(t=>t.kind==='expense'&&t.category_id===b.category_id&&String(t.occurred_on).startsWith(month)).reduce((s,t)=>s+Number(t.amount_cents),0);
    return {...b,spent,percent:Math.min(100,Math.round(spent/Math.max(1,Number(b.limit_cents))*100))};
  });
}

function renderHome(){
  const t=totals(),month=totals(monthTransactions()),rate=savingsRate(),budgets=budgetStatus();
  const due=state.recurring.filter(r=>r.active&&r.next_date).slice(0,4);
  return `<section class="dashboard">
    <div class="dashboard-head">
      <div><span class="eyebrow">Resumen financiero</span><h1>Hola, ${esc(state.profile.display_name||'')}</h1><p class="muted">Tu situación financiera, de un vistazo.</p></div>

    </div>

    <article class="hero pro-hero">
      <div><span>Patrimonio disponible</span><strong>${money(mainBalance())}</strong><small>Cuenta principal</small></div>
    </article>

    <div class="kpi-grid">
      <article class="kpi-card"><span>Ingresos del mes</span><strong class="income">${money(month.income)}</strong><small>Flujo entrante</small></article>
      <article class="kpi-card"><span>Gastos del mes</span><strong class="expense">${money(month.expense)}</strong><small>${month.income?Math.round(month.expense/month.income*100):0}% de ingresos</small></article>
      <article class="kpi-card"><span>Tasa de ahorro</span><strong class="${rate>=20?'income':rate>=0?'saving':'expense'}">${rate}%</strong><small>Objetivo recomendado: 20%</small></article>
      <article class="kpi-card"><span>Invertido este mes</span><strong class="investment">${money(month.investment)}</strong><small>Construcción de patrimonio</small></article>
    </div>

    <div class="dashboard-grid">
      <article class="card chart-card">
        <div class="card-head"><div><h2>Evolución de ingresos y gastos</h2><p class="muted">Últimos 6 meses</p></div><div class="chart-key"><span class="key-income">Ingresos</span><span class="key-expense">Gastos</span></div></div>
        ${professionalLineChart(monthlySeries())}
      </article>
      <article class="card">
        <div class="card-head"><div><h2>Presupuestos</h2><p class="muted">Mes actual</p></div><button class="text-btn" data-manage-budgets>Gestionar</button></div>
        <div class="budget-list">${budgets.length?budgets.slice(0,5).map(b=>`<div class="budget-item"><div><span>${esc(b.category?.icon||'•')} ${esc(b.category?.name||'Categoría')}</span><b>${money(b.spent)} / ${money(b.limit_cents)}</b></div><div class="budget-bar ${b.percent>=90?'danger':''}"><i style="width:${b.percent}%"></i></div></div>`).join(''):'<div class="empty compact">Todavía no has configurado presupuestos.</div>'}</div>
      </article>
    </div>

    <div class="dashboard-grid">
      <article class="card">
        <div class="card-head"><div><h2>Próximos movimientos</h2><p class="muted">Operaciones recurrentes</p></div><button class="text-btn" data-manage-recurring>Gestionar</button></div>
        <div class="list">${due.length?due.map(r=>`<div class="mini-row"><div><strong>${esc(r.concept)}</strong><small>${esc(r.next_date)} · ${kindLabels[r.kind]}</small></div><b>${money(r.amount_cents)}</b></div>`).join(''):'<div class="empty compact">No hay movimientos recurrentes próximos.</div>'}</div>
      </article>
      <article class="card">
        <div class="card-head"><div><h2>Últimos movimientos</h2><p class="muted">Actividad reciente</p></div><button class="text-btn" data-tab-shortcut="activity">Ver todos</button></div>
        <div class="list">${state.transactions.filter(t=>!(t.is_transfer&&t.transfer_role==='destination')).slice(0,6).map(txRow).join('')||'<div class="empty compact">No hay movimientos.</div>'}</div>
      </article>
    </div>
  </section>`;
}
function resourceBalance(id){return state.transactions.filter(t=>t.resource_id===id).reduce((s,t)=>s+(t.kind==='income'?Number(t.amount_cents):-Number(t.amount_cents)),0)}
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
    if(f.categoryId && t.category_id!==f.categoryId) return false;
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
      <select name="categoryId"><option value="">Todas las categorías</option>${state.categories.map(c=>`<option value="${c.id}" ${state.filters.categoryId===c.id?'selected':''}>${esc(c.icon||'•')} ${esc(c.name)}</option>`).join('')}</select>
    </form><div class="list" id="activity-list">${filtered().map(txRow).join('')||'<div class="empty">No hay movimientos.</div>'}</div></section>`;
}
function investmentPortfolio(list){
  const map=new Map();
  for(const tx of list.filter(t=>t.kind==='investment'&&t.investment_isin)){
    const isin=String(tx.investment_isin).toUpperCase();
    const row=map.get(isin)||{isin,shares:0,total:0,concept:tx.concept};
    row.shares+=Number(tx.investment_quantity)||0;
    row.total+=Number(tx.amount_cents)||0;
    map.set(isin,row);
  }
  return [...map.values()].map(row=>({...row,average:row.shares>0?Math.round(row.total/row.shares):0})).sort((a,b)=>b.total-a.total);
}
function statsTransactions(){
  return filtered();
}
function renderStats(){
  const list=statsTransactions(),t=totals(list),series=monthlySeries(12,list),categories=categorySpending(list);
  const portfolio=investmentPortfolio(list);
  const maxCategory=Math.max(1,...categories.map(c=>c.value));
  const cashflow=t.income-t.expense-t.investment-t.saving;
  const rate=t.income?Math.round((t.income-t.expense-t.investment)/t.income*100):0;
  return `<section>
    <div class="dashboard-head">
      <div><span class="eyebrow">Inteligencia financiera</span><h1>Estadísticas</h1><p class="muted">Segmenta por espacios, tipo de movimiento y periodo.</p></div>
      <div class="head-actions"><button class="btn ghost" data-export-csv>Exportar CSV</button><button class="btn primary" data-manage-budgets>Presupuestos</button></div>
    </div>

    <form class="stats-toolbar stats-segments" id="stats-filter">
      <label>Desde<input name="from" type="date" value="${esc(state.filters.from)}"></label>
      <label>Hasta<input name="to" type="date" value="${esc(state.filters.to)}"></label>
      <label>Tipo<select name="kind"><option value="">Todos</option>${Object.entries(kindLabels).map(([k,l])=>`<option value="${k}" ${state.filters.kind===k?'selected':''}>${l}</option>`).join('')}</select></label>
      <label>Segmento<select name="resourceType"><option value="">Todos</option><option value="main" ${state.filters.resourceType==='main'?'selected':''}>Cuenta principal</option><option value="piggy" ${state.filters.resourceType==='piggy'?'selected':''}>Huchas</option><option value="folder" ${state.filters.resourceType==='folder'?'selected':''}>Carpetas</option><option value="goal" ${state.filters.resourceType==='goal'?'selected':''}>Objetivos</option></select></label>
      <label>Elemento<select name="resourceId"><option value="">Todos</option>${state.resources.filter(r=>!state.filters.resourceType||state.filters.resourceType===r.type).map(r=>`<option value="${r.id}" ${state.filters.resourceId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label>
      <button type="button" class="period-chip" data-period="month">Este mes</button>
      <button type="button" class="period-chip" data-period="quarter">3 meses</button>
      <button type="button" class="period-chip" data-period="year">Este año</button>
    </form>

    <div class="kpi-grid">
      <article class="kpi-card"><span>Flujo neto</span><strong class="${cashflow>=0?'income':'expense'}">${money(cashflow)}</strong><small>Ingresos menos salidas</small></article>
      <article class="kpi-card"><span>Tasa de ahorro</span><strong class="${rate>=20?'income':'saving'}">${rate}%</strong><small>Sobre ingresos</small></article>
      <article class="kpi-card"><span>Gasto medio</span><strong>${money(list.filter(x=>x.kind==='expense').length?t.expense/list.filter(x=>x.kind==='expense').length:0)}</strong><small>Por transacción</small></article>
      <article class="kpi-card"><span>Movimientos</span><strong>${list.length}</strong><small>En el segmento</small></article>
    </div>

    <article class="card chart-card">
      <div class="card-head"><div><h2>Tendencia financiera</h2><p class="muted">Ingresos y gastos mensuales</p></div><div class="chart-key"><span class="key-income">Ingresos</span><span class="key-expense">Gastos</span></div></div>
      ${professionalLineChart(series)}
    </article>

    <div class="dashboard-grid">
      <article class="card">
        <div class="card-head"><div><h2>Gastos por categoría</h2><p class="muted">Transporte, ocio, comida, suscripciones y otros</p></div></div>
        <div class="category-bars">${categories.length?categories.map(c=>`<div class="category-bar"><div><span>${esc(c.icon)} ${esc(c.name)}</span><b>${money(c.value)}</b></div><div class="bar-track"><i style="width:${Math.round(c.value/maxCategory*100)}%"></i></div></div>`).join(''):'<div class="empty compact">No hay gastos en este periodo.</div>'}</div>
      </article>
      <article class="card">
        <div class="card-head"><div><h2>Cartera de inversión</h2><p class="muted">Agrupada por ISIN</p></div></div>
        <div class="portfolio-list">${portfolio.length?portfolio.map(p=>`<div class="portfolio-row"><div><strong>${esc(p.concept||p.isin)}</strong><small>${esc(p.isin)} · ${p.shares.toLocaleString('es-ES',{maximumFractionDigits:6})} acciones</small></div><div><b>${money(p.total)}</b><small>Precio medio: ${money(p.average)}</small></div></div>`).join(''):'<div class="empty compact">No hay inversiones con ISIN en este segmento.</div>'}</div>
      </article>
    </div>

    <article class="card stats-history">
      <div class="card-head"><div><h2>Historial del segmento</h2><p class="muted">${list.length} movimientos según los filtros seleccionados</p></div></div>
      <div class="list">${list.length?list.map(txRow).join(''):'<div class="empty compact">No hay movimientos para estos filtros.</div>'}</div>
    </article>
  </section>`;
}

function bind(){
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;renderShell()});
  document.querySelector('#logout')?.addEventListener('click',()=>sb.auth.signOut());
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
  document.querySelectorAll('[data-manage-budgets]').forEach(b=>b.onclick=openBudgets);
  document.querySelectorAll('[data-manage-recurring]').forEach(b=>b.onclick=openRecurring);
  document.querySelector('[data-export-csv]')?.addEventListener('click',exportCsv);
  document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>applyPeriod(b.dataset.period));
  const af=document.querySelector('#activity-filter');
  if(af)af.oninput=()=>{const fd=new FormData(af);Object.assign(state.filters,{query:String(fd.get('query')||''),from:String(fd.get('from')||''),to:String(fd.get('to')||''),kind:String(fd.get('kind')||''),resourceType:String(fd.get('resourceType')||''),categoryId:String(fd.get('categoryId')||''),resourceId:String(fd.get('resourceId')||'')});document.querySelector('#activity-list').innerHTML=filtered().map(txRow).join('')||'<div class="empty">No hay movimientos.</div>';bind()};
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

function resourceOptions(selected=''){return `<option value="">Cuenta principal</option>${state.resources.map(r=>`<option value="${r.id}" ${selected===r.id?'selected':''}>${esc(r.name)} · ${r.type}</option>`).join('')}`}
function openTransaction(tx={}){
  const editing=Boolean(tx.id);
  const selectedKind=tx.kind||'expense';
  const selectedResource=tx.resource_id||'';
  modal(`<form id="tx-form"><div class="modal-head"><div><h2>${editing?'Editar':'Nuevo'} movimiento</h2><p class="muted">${editing?'Los cambios se aplicarán al movimiento relacionado.':'Registra una operación financiera.'}</p></div><button type="button" class="close-btn" data-close>×</button></div>
    <div class="form-grid">
      <div class="field"><label>Tipo</label><select name="kind">${Object.entries(kindLabels).map(([k,label])=>`<option value="${k}" ${selectedKind===k?'selected':''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label>Forma de pago</label><select name="payment_method"><option value="bank" ${tx.payment_method!=='cash'?'selected':''}>Banco</option><option value="cash" ${tx.payment_method==='cash'?'selected':''}>Efectivo</option></select></div>
    </div>

    <div class="field"><label>Cuenta / espacio</label><select name="resource_id" ${editing?'disabled':''}>${resourceOptions(selectedResource)}</select>
      <small class="muted" id="piggy-transfer-note"></small>
    </div>

    <div id="expense-fields">
      <div class="form-grid">
        <div class="field"><label>Categoría del gasto</label><select name="category_id"><option value="">Selecciona una categoría</option>${state.categories.map(c=>`<option value="${c.id}" ${tx.category_id===c.id?'selected':''}>${esc(c.icon||'•')} ${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Comercio</label><input name="merchant" value="${esc(tx.merchant||'')}" placeholder="Ej. Supermercado"></div>
      </div>
    </div>

    <div id="investment-fields" class="investment-form hidden">
      <div class="field"><label>ISIN</label><input name="investment_isin" maxlength="12" value="${esc(tx.investment_isin||'')}" placeholder="Ej. US0378331005"></div>
      <div class="form-grid">
        <div class="field"><label>Cantidad de acciones</label><input name="investment_quantity" inputmode="decimal" value="${tx.investment_quantity||''}"></div>
        <div class="field"><label>Precio por acción (€)</label><input name="investment_unit_price" inputmode="decimal" value="${tx.investment_unit_price_cents?Number(tx.investment_unit_price_cents)/100:''}"></div>
      </div>
      <div class="investment-total"><span>Importe total calculado</span><strong id="investment-total-value">${money(tx.amount_cents||0)}</strong></div>
    </div>

    <div class="field"><label>Importe total (€)</label><input name="amount" inputmode="decimal" required value="${tx.amount_cents?Number(tx.amount_cents)/100:''}"></div>
    <div class="field"><label>Concepto</label><input name="concept" required value="${esc(tx.concept||'')}"></div>
    <div class="field"><label>Fecha</label><input name="date" type="date" required value="${tx.occurred_on||today()}"></div>
    <div class="field"><label>Notas</label><textarea name="notes">${esc(tx.notes||'')}</textarea></div>
    <div class="field"><label>Justificante</label><input name="receipt" type="file" accept="image/*"></div>

    <div class="actions">${editing?'<button type="button" class="btn danger" id="delete-tx">Borrar</button>':''}<button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
  </form>`,true);

  const form=document.querySelector('#tx-form');
  const kind=form.elements.kind;
  const resource=form.elements.resource_id;
  const expenseFields=document.querySelector('#expense-fields');
  const investmentFields=document.querySelector('#investment-fields');
  const amountInput=form.elements.amount;
  const isinInput=form.elements.investment_isin;
  const quantityInput=form.elements.investment_quantity;
  const priceInput=form.elements.investment_unit_price;
  const transferNote=document.querySelector('#piggy-transfer-note');

  const updateVisibility=()=>{
    expenseFields.classList.toggle('hidden',kind.value!=='expense');
    investmentFields.classList.toggle('hidden',kind.value!=='investment');
    form.elements.category_id.required=kind.value==='expense';
    const selected=state.resources.find(r=>r.id===resource.value);
    const isDeposit=selected?.type==='piggy'&&(kind.value==='income'||kind.value==='saving');
    if(isDeposit){
      transferNote.textContent='Este ingreso en la hucha se restará automáticamente de la cuenta principal.';
    }else if(selected?.type==='folder'){
      transferNote.textContent='Este movimiento quedará asociado a la carpeta y afectará al saldo de la cuenta principal.';
    }else{
      transferNote.textContent='';
    }
  };

  const calculateInvestment=()=>{
    const quantity=Number(String(quantityInput?.value||'').replace(',','.'));
    const unit=Number(String(priceInput?.value||'').replace(',','.'));
    if(Number.isFinite(quantity)&&quantity>0&&Number.isFinite(unit)&&unit>0){
      const total=quantity*unit;
      amountInput.value=total.toFixed(2);
      document.querySelector('#investment-total-value').textContent=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(total);
    }
  };

  kind.onchange=updateVisibility;
  resource.onchange=updateVisibility;
  quantityInput?.addEventListener('input',calculateInvestment);
  priceInput?.addEventListener('input',calculateInvestment);
  updateVisibility();

  form.onsubmit=async e=>{
    e.preventDefault();
    const b=e.submitter,fd=new FormData(form);
    busy(b,true);
    try{
      const kindValue=String(fd.get('kind'));
      const selectedResourceId=editing?tx.resource_id:(fd.get('resource_id')||null);
      const selectedResource=state.resources.find(r=>r.id===selectedResourceId);
      const payload={
        kind:kindValue,
        category_id:kindValue==='expense'?(fd.get('category_id')||null):null,
        merchant:kindValue==='expense'?String(fd.get('merchant')||'').trim():'',
        payment_method:String(fd.get('payment_method')||'bank'),
        amount_cents:cents(fd.get('amount')),
        concept:String(fd.get('concept')).trim(),
        occurred_on:fd.get('date'),
        notes:String(fd.get('notes')||''),
        investment_isin:kindValue==='investment'?String(fd.get('investment_isin')||'').trim().toUpperCase():null,
        investment_quantity:kindValue==='investment'?Number(String(fd.get('investment_quantity')||'0').replace(',','.')):null,
        investment_unit_price_cents:kindValue==='investment'?cents(fd.get('investment_unit_price')):null
      };

      if(payload.amount_cents<=0)throw new Error('El importe debe ser mayor que cero.');
      if(kindValue==='investment'){
        if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(payload.investment_isin||''))throw new Error('El ISIN debe tener 12 caracteres válidos.');
        if(!(payload.investment_quantity>0))throw new Error('La cantidad de acciones debe ser mayor que cero.');
        if(!(payload.investment_unit_price_cents>0))throw new Error('El precio por acción debe ser mayor que cero.');
      }

      let id=tx.id;
      if(editing){
        const {error}=await sb.rpc('update_finance_transaction_v4',{
          p_transaction_id:tx.id,
          p_kind:payload.kind,
          p_category_id:payload.category_id,
          p_merchant:payload.merchant,
          p_payment_method:payload.payment_method,
          p_amount_cents:payload.amount_cents,
          p_concept:payload.concept,
          p_occurred_on:payload.occurred_on,
          p_notes:payload.notes,
          p_investment_isin:payload.investment_isin,
          p_investment_quantity:payload.investment_quantity,
          p_investment_unit_price_cents:payload.investment_unit_price_cents
        });
        if(error)throw error;
      }else if(selectedResource?.type==='piggy'&&(kindValue==='income'||kindValue==='saving')){
        const {data,error}=await sb.rpc('create_piggy_transfer_v4',{
          p_piggy_id:selectedResource.id,
          p_amount_cents:payload.amount_cents,
          p_concept:payload.concept,
          p_occurred_on:payload.occurred_on,
          p_notes:payload.notes,
          p_payment_method:payload.payment_method
        });
        if(error)throw error;
        id=data;
      }else{
        const {data,error}=await sb.from('finance_transactions').insert({...payload,resource_id:selectedResourceId}).select('id').single();
        if(error)throw error;
        id=data.id;
      }

      const file=fd.get('receipt');
      if(file instanceof File&&file.size){
        const ext=(file.name.split('.').pop()||'jpg').toLowerCase(),path=`${state.user.id}/${id}/${crypto.randomUUID()}.${ext}`;
        const {error}=await sb.storage.from('receipts').upload(path,file,{contentType:file.type||'image/jpeg'});
        if(error)throw error;
        const {error:pe}=await sb.from('finance_transactions').update({receipt_path:path}).eq('id',id);
        if(pe)throw pe;
      }

      closeModal();
      await refresh();
      toast(editing?'Movimiento actualizado':'Movimiento guardado');
    }catch(error){
      toast(error.message,true);
    }finally{
      busy(b,false);
    }
  };

  document.querySelector('#delete-tx')?.addEventListener('click',async()=>{
    if(!confirm('¿Borrar este movimiento?'))return;
    const {error}=await sb.rpc('delete_finance_transaction_v4',{p_transaction_id:tx.id});
    if(error)return toast(error.message,true);
    closeModal();
    await refresh();
    toast('Movimiento eliminado');
  });
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
  const rows=[['Fecha','Tipo','Concepto','Forma de pago','Comercio','Categoría','Espacio','ISIN','Acciones','Precio unitario','Importe']];
  for(const t of filtered()){
    rows.push([t.occurred_on,kindLabels[t.kind],t.concept,t.payment_method==='cash'?'Efectivo':'Banco',t.merchant||'',t.category?.name||'',t.resource?.name||'Cuenta principal',t.investment_isin||'',t.investment_quantity||'',t.investment_unit_price_cents?(Number(t.investment_unit_price_cents)/100).toFixed(2):'',(Number(t.amount_cents)/100).toFixed(2)]);
  }
  const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(';')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`a2c-movimientos-${today()}.csv`;a.click();URL.revokeObjectURL(url);
}
function openBudgets(){
  modal(`<div class="modal-head"><div><h2>Presupuestos mensuales</h2><p class="muted">Define límites por categoría.</p></div><button class="close-btn" data-close>×</button></div>
    <button class="btn primary" id="new-budget">Nuevo presupuesto</button>
    <div class="list" style="margin-top:14px">${state.budgets.map(b=>`<div class="row"><div><strong>${esc(b.category?.icon||'•')} ${esc(b.category?.name||'Categoría')}</strong><small>${esc(b.month)}</small></div><div><b>${money(b.limit_cents)}</b> <button class="btn danger" data-delete-budget="${b.id}">Borrar</button></div></div>`).join('')||'<div class="empty compact">Sin presupuestos.</div>'}</div>`,true);
  document.querySelector('#new-budget').onclick=openBudgetForm;
  document.querySelectorAll('[data-delete-budget]').forEach(b=>b.onclick=async()=>{const {error}=await sb.from('monthly_budgets').delete().eq('id',b.dataset.deleteBudget);if(error)return toast(error.message,true);await refresh(false);openBudgets()});
}
function openBudgetForm(){
  closeModal();
  modal(`<form id="budget-form"><div class="modal-head"><h2>Nuevo presupuesto</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Mes</label><input name="month" type="month" value="${currentMonthKey()}" required></div>
    <div class="field"><label>Categoría</label><select name="category_id" required>${state.categories.filter(c=>c.kind==='expense'||c.kind==='both').map(c=>`<option value="${c.id}">${esc(c.icon||'•')} ${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Límite (€)</label><input name="limit" inputmode="decimal" required></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
  </form>`);
  document.querySelector('#budget-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),b=e.submitter;busy(b,true);const {error}=await sb.from('monthly_budgets').upsert({user_id:state.user.id,month:fd.get('month'),category_id:fd.get('category_id'),limit_cents:cents(fd.get('limit'))},{onConflict:'user_id,month,category_id'});busy(b,false);if(error)return toast(error.message,true);closeModal();await refresh();toast('Presupuesto guardado')};
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
    <div class="field"><label>Categoría</label><select name="category_id"><option value="">Sin categoría</option>${state.categories.map(c=>`<option value="${c.id}">${esc(c.icon||'•')} ${esc(c.name)}</option>`).join('')}</select></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
  </form>`);
  document.querySelector('#recurring-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),b=e.submitter;busy(b,true);const {error}=await sb.from('recurring_transactions').insert({user_id:state.user.id,kind:fd.get('kind'),frequency:fd.get('frequency'),concept:fd.get('concept'),amount_cents:cents(fd.get('amount')),next_date:fd.get('next_date'),category_id:fd.get('category_id')||null,active:true});busy(b,false);if(error)return toast(error.message,true);closeModal();await refresh();toast('Movimiento recurrente guardado')};
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

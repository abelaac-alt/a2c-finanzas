/* ==========================
   A2C Finanzas 4.0
   Control financiero avanzado
   ========================== */
const a2c40 = {
  pending:[], rules:[], customCategories:[], preferences:null,
  comments:[], approvals:[], loaded:false
};
const a2c40Device=()=>window.A2CNative?'Android':'Web';
async function a2c40Heartbeat(){
  try{await sb.rpc('a2c_touch_last_seen',{p_device:a2c40Device()});}catch(_){}
}
a2c40Heartbeat(); setInterval(a2c40Heartbeat,60000);

async function a2c40Load(){
  if(!state.user)return;
  const uid=state.user.id;
  const [p,r,c,n,cm,ap]=await Promise.all([
    sb.from('detected_payments').select('*').eq('user_id',uid).order('payment_time',{ascending:false}).limit(100),
    sb.from('smart_rules').select('*').eq('user_id',uid).order('priority').order('created_at',{ascending:false}),
    sb.from('custom_categories').select('*').eq('user_id',uid).order('name'),
    sb.from('notification_preferences').select('*').eq('user_id',uid).maybeSingle(),
    sb.from('shared_movement_comments').select('*').eq('user_id',uid).order('created_at',{ascending:false}).limit(100),
    sb.from('shared_movement_approvals').select('*').or(`requested_by.eq.${uid},approver_id.eq.${uid}`).order('created_at',{ascending:false}).limit(100)
  ]);
  a2c40.pending=p.data||[];a2c40.rules=r.data||[];a2c40.customCategories=c.data||[];
  a2c40.preferences=n.data||null;a2c40.comments=cm.data||[];a2c40.approvals=ap.data||[];a2c40.loaded=true;
}
const a2c40RefreshBase=refresh;
refresh=async function(){const value=await a2c40RefreshBase();await a2c40Load();return value;};

function a2c40Download(name,text,type='application/json'){
  const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function a2c40Csv(rows){
  if(!rows.length)return '';
  const cols=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  const q=v=>`"${String(v??'').replaceAll('"','""')}"`;
  return [cols.map(q).join(';'),...rows.map(row=>cols.map(key=>q(typeof row[key]==='object'?JSON.stringify(row[key]):row[key])).join(';'))].join('\n');
}
function a2c40Normalize(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();}
function a2c40CategoryOptions(selected=''){
  const built=Object.entries(budgetCategoryMeta).map(([key,m])=>({key,name:m.label,icon:m.icon}));
  const custom=a2c40.customCategories.filter(c=>c.active!==false).map(c=>({key:c.category_key,name:c.name,icon:c.icon}));
  return [...built,...custom].map(c=>`<option value="${esc(c.key)}" ${c.key===selected?'selected':''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('');
}
function a2c40SuggestCategory(merchant){
  const text=a2c40Normalize(merchant);
  const rule=a2c40.rules.filter(r=>r.active!==false).find(r=>{
    const p=a2c40Normalize(r.pattern);
    return r.match_type==='exact'?text===p:r.match_type==='starts_with'?text.startsWith(p):text.includes(p);
  });
  if(rule)return rule.category_key;
  return detectBudgetCategory({merchant,concept:merchant,notes:''});
}
async function a2c40SaveDetected(rows){
  if(!state.user||!rows?.length)return;
  const payload=rows.map(row=>({
    user_id:state.user.id,fingerprint:String(row.fingerprint||`${row.amount_cents}|${row.merchant}|${row.payment_time}`),
    source_app:row.source_app||'',source_package:row.source_package||'',merchant:row.merchant||'Pago detectado',
    amount_cents:Number(row.amount_cents||0),raw_text:row.raw_text||'',payment_time:new Date(Number(row.payment_time)||Date.now()).toISOString(),
    suggested_category:a2c40SuggestCategory(row.merchant),status:row.status||'pending'
  })).filter(row=>row.amount_cents>0);
  if(payload.length)await sb.from('detected_payments').upsert(payload,{onConflict:'user_id,fingerprint',ignoreDuplicates:true});
}
window.a2cAndroidImportPendingPayments=async function(rows){
  try{await a2c40SaveDetected(Array.isArray(rows)?rows:JSON.parse(rows||'[]'));await a2c40Load();return{ok:true};}
  catch(error){return{ok:false,error:error.message};}
};

function a2c40PendingTab(){
  const pending=a2c40.pending.filter(p=>p.status==='pending');
  return `<div class="a2c40-toolbar"><div><h3>Pagos pendientes</h3><p class="muted">${pending.length} pendientes de revisar</p></div><button class="btn" id="a2c40-register-selected">Registrar seleccionados</button></div>
  <div class="a2c40-list">${pending.length?pending.map(p=>`<label class="a2c40-row"><input type="checkbox" data-pending-check value="${p.id}"><span><strong>${esc(p.merchant)}</strong><small>${esc(p.source_app||'Notificación')} · ${new Date(p.payment_time).toLocaleString('es-ES')}</small><em>${esc((budgetCategoryMeta[p.suggested_category]||{label:p.suggested_category||'Sin categoría'}).label)}</em></span><b>${money(p.amount_cents)}</b><button type="button" class="icon-btn" data-review-pending="${p.id}">›</button></label>`).join(''):'<div class="empty compact">No hay pagos pendientes.</div>'}</div>`;
}
function a2c40RulesTab(){
  return `<div class="a2c40-toolbar"><div><h3>Reglas inteligentes</h3><p class="muted">A2C aprende cómo clasificar cada comercio.</p></div><button class="btn primary" id="a2c40-new-rule">Nueva regla</button></div>
  <div class="a2c40-list">${a2c40.rules.length?a2c40.rules.map(r=>`<article class="a2c40-row"><span><strong>${esc(r.pattern)}</strong><small>${esc(r.match_type)} · confianza ${Number(r.confidence||100)}%</small><em>${esc((budgetCategoryMeta[r.category_key]||{label:r.category_key}).label)}</em></span><button class="btn" data-edit-rule="${r.id}">Editar</button></article>`).join(''):'<div class="empty compact">Todavía no hay reglas.</div>'}</div>`;
}
function a2c40CategoriesTab(){
  return `<div class="a2c40-toolbar"><div><h3>Categorías personalizadas</h3><p class="muted">Crea categorías con icono, color y palabras clave.</p></div><button class="btn primary" id="a2c40-new-category">Nueva categoría</button></div>
  <div class="a2c40-category-grid">${a2c40.customCategories.length?a2c40.customCategories.map(c=>`<button class="a2c40-category" data-edit-category="${c.id}" style="--cat:${esc(c.color)}"><i>${esc(c.icon)}</i><span><strong>${esc(c.name)}</strong><small>${esc((c.keywords||[]).join(', '))}</small></span></button>`).join(''):'<div class="empty compact">No hay categorías personalizadas.</div>'}</div>`;
}
function a2c40NotificationsTab(){
  const p=a2c40.preferences||{};
  const fields=[['payment_detected','Pago detectado'],['money_request','Solicitud de dinero'],['shared_movement','Movimiento compartido'],['budget_50','Presupuesto al 50 %'],['budget_75','Presupuesto al 75 %'],['budget_90','Presupuesto al 90 %'],['budget_100','Presupuesto al 100 %'],['scheduled_movement','Movimiento programado'],['subscription_charge','Cobro de suscripción'],['goal_completed','Objetivo alcanzado'],['low_balance','Saldo bajo']];
  return `<form id="a2c40-notification-form"><h3>Notificaciones configurables</h3><div class="a2c40-switches">${fields.map(([key,label])=>`<label><span>${esc(label)}</span><input type="checkbox" name="${key}" ${p[key]!==false?'checked':''}></label>`).join('')}</div><div class="grid two"><div class="field"><label>Silencio desde</label><input type="time" name="quiet_from" value="${esc(p.quiet_from||'')}"></div><div class="field"><label>Silencio hasta</label><input type="time" name="quiet_to" value="${esc(p.quiet_to||'')}"></div></div><div class="actions"><button class="btn primary">Guardar notificaciones</button></div></form>`;
}
function a2c40SharedTab(){
  const approvals=a2c40.approvals.filter(a=>a.status==='pending');
  return `<div class="a2c40-toolbar"><div><h3>Movimientos compartidos</h3><p class="muted">Aprobaciones y actividad conjunta.</p></div></div>
  <div class="a2c40-list">${approvals.length?approvals.map(a=>`<article class="a2c40-row"><span><strong>Movimiento pendiente de aprobación</strong><small>${new Date(a.created_at).toLocaleString('es-ES')}</small></span><div><button class="btn" data-approval="${a.id}" data-status="rejected">Rechazar</button><button class="btn primary" data-approval="${a.id}" data-status="approved">Aprobar</button></div></article>`).join(''):'<div class="empty compact">No tienes aprobaciones pendientes.</div>'}</div>`;
}
function a2c40BackupTab(){
 return `<h3>Copias de seguridad, exportación e importación</h3><p class="muted">Exporta tus datos completos o impórtalos en otra instalación de A2C.</p><div class="a2c40-backup-actions"><button class="btn primary" id="a2c40-export-json">Exportar copia JSON</button><button class="btn" id="a2c40-export-csv">Exportar transacciones CSV</button><label class="btn">Importar copia JSON<input type="file" id="a2c40-import-json" accept=".json,application/json" hidden></label></div><div class="notice">La importación no elimina datos existentes. Las transacciones duplicadas se omiten cuando conservan el mismo identificador.</div>`;
}
function a2c40BudgetTab(){
 return `<h3>Presupuestos inteligentes</h3><div class="a2c40-list">${state.budgets.filter(b=>b.period_month===currentMonthKey()).map(b=>`<article class="a2c40-row"><span><strong>${esc(b.name)}</strong><small>${b.weekly_limit_cents?`Límite semanal: ${money(b.weekly_limit_cents)}`:'Sin límite semanal'} · ${b.rollover_enabled?'Acumula sobrante':'No acumula sobrante'}</small></span><button class="btn" data-advanced-budget="${b.id}">Configurar</button></article>`).join('')||'<div class="empty compact">No hay presupuestos este mes.</div>'}</div>`;
}
function openA2C40Control(tab='pending'){
  const labels={pending:'Pagos',rules:'Reglas',categories:'Categorías',budgets:'Presupuestos',shared:'Compartido',backup:'Copias'};
  if(window.A2CNative) labels.notifications='Notificaciones';
  modal(`<style>
  .a2c40-tabs{display:flex;gap:6px;overflow:auto;padding-bottom:8px}.a2c40-tabs button{border:0;border-radius:999px;padding:9px 12px;background:#f0edf7;white-space:nowrap}.a2c40-tabs button.active{background:#211a31;color:#fff}.a2c40-panel{margin-top:12px}.a2c40-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px}.a2c40-toolbar h3{margin:0}.a2c40-list{display:grid;gap:8px;margin-top:12px}.a2c40-row{display:flex;align-items:center;gap:10px;border:1px solid #ece9f2;border-radius:14px;padding:10px;background:#fff}.a2c40-row>span{min-width:0;flex:1}.a2c40-row strong,.a2c40-row small,.a2c40-row em{display:block}.a2c40-row small{font-size:11px;color:var(--muted)}.a2c40-row em{font-size:10px;color:#6a53b2;font-style:normal;margin-top:3px}.a2c40-category-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:12px}.a2c40-category{display:flex;align-items:center;gap:10px;text-align:left;border:1px solid #ece9f2;border-left:4px solid var(--cat);border-radius:14px;padding:11px;background:#fff}.a2c40-category i{font-size:24px;font-style:normal}.a2c40-category span{min-width:0}.a2c40-category strong,.a2c40-category small{display:block;overflow:hidden;text-overflow:ellipsis}.a2c40-category small{font-size:10px;color:var(--muted);white-space:nowrap}.a2c40-switches{display:grid;gap:7px;margin:12px 0}.a2c40-switches label{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid #ece9f2;border-radius:13px}.a2c40-backup-actions{display:grid;gap:9px;margin:16px 0}
  </style><div class="modal-head"><div><span class="eyebrow">Gestión avanzada</span><h2>Control financiero</h2></div><button class="close-btn" data-close>×</button></div><nav class="a2c40-tabs">${Object.entries(labels).map(([key,label])=>`<button data-a2c40-tab="${key}" class="${key===tab?'active':''}">${label}</button>`).join('')}</nav><section class="a2c40-panel" id="a2c40-panel"></section>`,true);
  const render=key=>{const panel=document.querySelector('#a2c40-panel');if(!panel)return;document.querySelectorAll('[data-a2c40-tab]').forEach(b=>b.classList.toggle('active',b.dataset.a2c40Tab===key));panel.innerHTML=key==='pending'?a2c40PendingTab():key==='rules'?a2c40RulesTab():key==='categories'?a2c40CategoriesTab():key==='budgets'?a2c40BudgetTab():key==='notifications'?a2c40NotificationsTab():key==='shared'?a2c40SharedTab():a2c40BackupTab();a2c40BindPanel(key);};
  document.querySelectorAll('[data-a2c40-tab]').forEach(b=>b.onclick=()=>render(b.dataset.a2c40Tab));render(tab);
}
function a2c40BindPanel(tab){
 if(tab==='pending'){
   document.querySelectorAll('[data-review-pending]').forEach(b=>b.onclick=()=>a2c40ReviewPending(b.dataset.reviewPending));
   document.querySelector('#a2c40-register-selected')?.addEventListener('click',async()=>{const ids=[...document.querySelectorAll('[data-pending-check]:checked')].map(x=>x.value);for(const id of ids)await a2c40RegisterPending(id,false);await a2c40Load();openA2C40Control('pending');});
 }
 if(tab==='rules'){document.querySelector('#a2c40-new-rule').onclick=()=>a2c40RuleForm();document.querySelectorAll('[data-edit-rule]').forEach(b=>b.onclick=()=>a2c40RuleForm(a2c40.rules.find(r=>r.id===b.dataset.editRule)));}
 if(tab==='categories'){document.querySelector('#a2c40-new-category').onclick=()=>a2c40CategoryForm();document.querySelectorAll('[data-edit-category]').forEach(b=>b.onclick=()=>a2c40CategoryForm(a2c40.customCategories.find(c=>c.id===b.dataset.editCategory)));}
 if(tab==='notifications')document.querySelector('#a2c40-notification-form').onsubmit=a2c40SaveNotifications;
 if(tab==='shared')document.querySelectorAll('[data-approval]').forEach(b=>b.onclick=()=>a2c40DecideApproval(b.dataset.approval,b.dataset.status));
 if(tab==='backup'){
   document.querySelector('#a2c40-export-json').onclick=a2c40ExportJson;
   document.querySelector('#a2c40-export-csv').onclick=()=>a2c40Download(`a2c-transacciones-${today()}.csv`,a2c40Csv(state.transactions),'text/csv;charset=utf-8');
   document.querySelector('#a2c40-import-json').onchange=a2c40ImportJson;
 }
 if(tab==='budgets')document.querySelectorAll('[data-advanced-budget]').forEach(b=>b.onclick=()=>a2c40BudgetAdvanced(state.budgets.find(x=>x.id===b.dataset.advancedBudget)));
}
async function a2c40RegisterPending(id,close=true){
 const p=a2c40.pending.find(x=>x.id===id);if(!p)return;
 const result=await window.a2cAndroidRegisterPayment({amount_cents:Number(p.amount_cents),merchant:p.merchant,payment_time:new Date(p.payment_time).getTime(),fingerprint:p.fingerprint});
 if(!result.ok)return toast(result.error||'No se pudo registrar',true);
 await sb.from('detected_payments').update({status:'registered',updated_at:new Date().toISOString()}).eq('id',id);
 if(close){closeModal();await refresh();toast('Pago registrado.');}
}
function a2c40ReviewPending(id){
 const p=a2c40.pending.find(x=>x.id===id);if(!p)return;
 modal(`<form id="a2c40-review-form"><div class="modal-head"><h2>Revisar pago</h2><button class="close-btn" data-close>×</button></div><div class="field"><label>Comercio</label><input name="merchant" value="${esc(p.merchant)}" required></div><div class="field"><label>Importe</label><input name="amount" inputmode="decimal" value="${(Number(p.amount_cents)/100).toFixed(2).replace('.',',')}" required></div><div class="field"><label>Categoría</label><select name="category">${a2c40CategoryOptions(p.suggested_category)}</select></div><div class="actions"><button type="button" class="btn danger" id="a2c40-discard">Descartar</button><button class="btn primary">Registrar</button></div></form>`);
 document.querySelector('#a2c40-discard').onclick=async()=>{await sb.from('detected_payments').update({status:'discarded'}).eq('id',id);closeModal();await a2c40Load();toast('Pago descartado.');};
 document.querySelector('#a2c40-review-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);p.merchant=String(fd.get('merchant')).trim();p.amount_cents=cents(fd.get('amount'));p.suggested_category=fd.get('category');const r=await window.a2cAndroidRegisterPayment({amount_cents:p.amount_cents,merchant:p.merchant,payment_time:new Date(p.payment_time).getTime(),fingerprint:p.fingerprint});if(!r.ok)return toast(r.error,true);await sb.from('detected_payments').update({status:'registered',merchant:p.merchant,amount_cents:p.amount_cents,suggested_category:p.suggested_category}).eq('id',id);if(p.merchant)await sb.from('smart_rules').upsert({user_id:state.user.id,pattern:a2c40Normalize(p.merchant),category_key:p.suggested_category},{onConflict:'user_id,pattern,category_key'});closeModal();await refresh();toast('Pago registrado y regla aprendida.');};
}
function a2c40RuleForm(rule=null){
 modal(`<form id="a2c40-rule-form"><div class="modal-head"><h2>${rule?'Editar':'Nueva'} regla</h2><button class="close-btn" data-close>×</button></div><div class="field"><label>Texto o comercio</label><input name="pattern" required value="${esc(rule?.pattern||'')}"></div><div class="field"><label>Coincidencia</label><select name="match_type"><option value="contains">Contiene</option><option value="exact" ${rule?.match_type==='exact'?'selected':''}>Exacta</option><option value="starts_with" ${rule?.match_type==='starts_with'?'selected':''}>Empieza por</option></select></div><div class="field"><label>Categoría</label><select name="category">${a2c40CategoryOptions(rule?.category_key)}</select></div><label><input type="checkbox" name="history" ${rule?.apply_to_history?'checked':''}> Aplicar a movimientos anteriores</label><div class="actions">${rule?'<button type="button" class="btn danger" id="a2c40-delete-rule">Eliminar</button>':''}<button class="btn primary">Guardar</button></div></form>`);
 document.querySelector('#a2c40-delete-rule')?.addEventListener('click',async()=>{await sb.from('smart_rules').delete().eq('id',rule.id);closeModal();await a2c40Load();openA2C40Control('rules');});
 document.querySelector('#a2c40-rule-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),payload={user_id:state.user.id,pattern:a2c40Normalize(fd.get('pattern')),match_type:fd.get('match_type'),category_key:fd.get('category'),apply_to_history:fd.get('history')==='on'};const q=rule?sb.from('smart_rules').update(payload).eq('id',rule.id):sb.from('smart_rules').insert(payload);const{error}=await q;if(error)return toast(error.message,true);if(payload.apply_to_history)await sb.from('finance_transactions').update({budget_category:payload.category_key}).eq('creator_id',state.user.id).eq('kind','expense').ilike('merchant',`%${payload.pattern}%`);closeModal();await refresh();openA2C40Control('rules');};
}
function a2c40CategoryForm(category=null){
 modal(`<form id="a2c40-category-form"><div class="modal-head"><h2>${category?'Editar':'Nueva'} categoría</h2><button class="close-btn" data-close>×</button></div><div class="grid two"><div class="field"><label>Icono</label><input name="icon" value="${esc(category?.icon||'🗂️')}" maxlength="4"></div><div class="field"><label>Color</label><input name="color" type="color" value="${esc(category?.color||'#7557ff')}"></div></div><div class="field"><label>Nombre</label><input name="name" required value="${esc(category?.name||'')}"></div><div class="field"><label>Clave</label><input name="key" pattern="[a-z0-9_]+" required value="${esc(category?.category_key||'')}"></div><div class="field"><label>Palabras clave</label><textarea name="keywords" placeholder="veterinario, mascota, pienso">${esc((category?.keywords||[]).join(', '))}</textarea></div><div class="actions">${category?'<button type="button" class="btn danger" id="a2c40-delete-category">Eliminar</button>':''}<button class="btn primary">Guardar</button></div></form>`);
 document.querySelector('#a2c40-delete-category')?.addEventListener('click',async()=>{await sb.from('custom_categories').delete().eq('id',category.id);closeModal();await a2c40Load();openA2C40Control('categories');});
 document.querySelector('#a2c40-category-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),payload={user_id:state.user.id,name:String(fd.get('name')).trim(),category_key:a2c40Normalize(fd.get('key')).replace(/\s+/g,'_'),icon:String(fd.get('icon')||'🗂️'),color:fd.get('color'),keywords:String(fd.get('keywords')||'').split(',').map(x=>x.trim()).filter(Boolean)};const q=category?sb.from('custom_categories').update(payload).eq('id',category.id):sb.from('custom_categories').insert(payload);const{error}=await q;if(error)return toast(error.message,true);closeModal();await a2c40Load();openA2C40Control('categories');};
}
async function a2c40SaveNotifications(e){
 e.preventDefault();const fd=new FormData(e.currentTarget),payload={user_id:state.user.id};for(const key of ['payment_detected','money_request','shared_movement','budget_50','budget_75','budget_90','budget_100','scheduled_movement','subscription_charge','goal_completed','low_balance'])payload[key]=fd.get(key)==='on';payload.quiet_from=fd.get('quiet_from')||null;payload.quiet_to=fd.get('quiet_to')||null;const{error}=await sb.from('notification_preferences').upsert(payload);if(error)return toast(error.message,true);a2c40.preferences=payload;toast('Notificaciones guardadas.');}
async function a2c40DecideApproval(id,status){await sb.from('shared_movement_approvals').update({status,decided_at:new Date().toISOString()}).eq('id',id);await a2c40Load();openA2C40Control('shared');}
function a2c40BudgetAdvanced(b){
 modal(`<form id="a2c40-budget-advanced"><div class="modal-head"><h2>${esc(b.name)}</h2><button class="close-btn" data-close>×</button></div><label><input type="checkbox" name="rollover" ${b.rollover_enabled?'checked':''}> Acumular el dinero no gastado al siguiente mes</label><div class="field"><label>Límite semanal opcional</label><input name="weekly" inputmode="decimal" value="${b.weekly_limit_cents?(b.weekly_limit_cents/100).toFixed(2).replace('.',','):''}"></div><div class="field"><label>Avisos</label><label><input type="checkbox" name="n50" ${b.notify_50?'checked':''}> 50 %</label> <label><input type="checkbox" name="n75" ${b.notify_75!==false?'checked':''}> 75 %</label> <label><input type="checkbox" name="n90" ${b.notify_90!==false?'checked':''}> 90 %</label> <label><input type="checkbox" name="n100" ${b.notify_100!==false?'checked':''}> 100 %</label></div><div class="actions"><button class="btn primary">Guardar</button></div></form>`);
 document.querySelector('#a2c40-budget-advanced').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const{error}=await sb.from('budgets_v67').update({rollover_enabled:fd.get('rollover')==='on',weekly_limit_cents:fd.get('weekly')?cents(fd.get('weekly')):null,notify_50:fd.get('n50')==='on',notify_75:fd.get('n75')==='on',notify_90:fd.get('n90')==='on',notify_100:fd.get('n100')==='on'}).eq('id',b.id);if(error)return toast(error.message,true);closeModal();await refresh();toast('Presupuesto actualizado.');};
}
async function a2c40ExportJson(){
 const tables=['finance_transactions','resources','budgets_v67','smart_rules','custom_categories','notification_preferences','scheduled_movements_v63','scheduled_expenses_v66'];
 const data={format:'A2C-BACKUP-4.0',exported_at:new Date().toISOString(),user_id:state.user.id,tables:{}};
 for(const table of tables){const{data:rows,error}=await sb.from(table).select('*');if(!error)data.tables[table]=rows||[];}
 await sb.from('backup_history').insert({user_id:state.user.id,operation:'export',format:'json',row_count:Object.values(data.tables).reduce((n,r)=>n+r.length,0)});
 a2c40Download(`a2c-copia-${today()}.json`,JSON.stringify(data,null,2));
}
async function a2c40ImportJson(e){
 const file=e.target.files?.[0];if(!file)return;
 try{const backup=JSON.parse(await file.text());if(!backup?.tables)throw new Error('Copia no válida.');let count=0;for(const [table,rows] of Object.entries(backup.tables)){if(!Array.isArray(rows)||!rows.length)continue;const cleaned=rows.map(row=>({...row,user_id:row.user_id?state.user.id:row.user_id,creator_id:row.creator_id?state.user.id:row.creator_id}));const{error}=await sb.from(table).upsert(cleaned,{ignoreDuplicates:true});if(error)console.warn(table,error);else count+=rows.length;}await sb.from('backup_history').insert({user_id:state.user.id,operation:'import',format:'json',row_count:count});await refresh();toast(`Importación completada: ${count} registros.`);}catch(error){toast(error.message,true);}
}

const a2c40OldOpenAdmin=openAdmin;
openAdmin=function(){
 modal(`<div class="modal-head"><div><h2>Administración</h2><p class="muted">Usuarios, permisos y última conexión</p></div><button class="close-btn" data-close>×</button></div><button class="btn primary" id="new-user">Crear usuario</button><div class="list" style="margin-top:14px">${state.profiles.map(p=>`<article class="row"><div><strong>${esc(p.display_name||p.email)}</strong><small>${esc(p.email)} · ${esc(p.role)} · ${p.active?'Activo':'Inactivo'}</small><small>Última conexión: ${p.last_seen_at?new Date(p.last_seen_at).toLocaleString('es-ES'):'Nunca'}${p.last_device?` · ${esc(p.last_device)}`:''}</small></div><button class="btn" data-user="${p.id}">Gestionar</button></article>`).join('')}</div>`,true);
 document.querySelector('#new-user').onclick=()=>openUserForm(null);document.querySelectorAll('[data-user]').forEach(b=>b.onclick=()=>openUserForm(state.profiles.find(p=>p.id===b.dataset.user)));
};

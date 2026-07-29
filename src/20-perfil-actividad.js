/* ==========================
   A2C Finanzas 4.1
   Perfil, actividad y ajustes
   ========================== */
const A2C_ANDROID_DIRECT_DOWNLOAD='./downloads/A2C-Finanzas.apk';

function a2c41PendingCount(){
  return a2c40.pending.filter(row=>row.status==='pending').length;
}

const a2c41RenderActivityOriginal=renderActivity;
renderActivity=function(){
  const count=a2c41PendingCount();
  const block=`<button type="button" class="a2c41-pending-card ${count?'active':''}" id="a2c41-open-pending">
    <span class="a2c41-pending-card-icon">⌁</span>
    <span><strong>Pagos pendientes</strong><small>${count?`${count} pago${count===1?'':'s'} pendiente${count===1?'':'s'} de revisar`:'Todos los pagos están revisados'}</small></span>
    ${count?`<b>${count}</b>`:'<em>›</em>'}
  </button>
  <style>
    .a2c41-pending-card{width:100%;display:flex;align-items:center;gap:11px;padding:11px 12px;margin:0 0 12px;border:1px solid #e9e5ef;border-radius:14px;background:#fff;text-align:left}
    .a2c41-pending-card.active{border-color:#d9cffa;background:#faf8ff}
    .a2c41-pending-card-icon{width:36px;height:36px;border-radius:12px;background:#eee9fa;display:grid;place-items:center;font-size:19px}
    .a2c41-pending-card>span:nth-child(2){flex:1}.a2c41-pending-card strong,.a2c41-pending-card small{display:block}
    .a2c41-pending-card small{font-size:11px;color:var(--muted);margin-top:2px}
    .a2c41-pending-card b{min-width:24px;height:24px;padding:0 7px;border-radius:999px;background:#7557ff;color:#fff;display:grid;place-items:center}
    .a2c41-pending-card em{font-style:normal;font-size:20px;color:#968ca3}
  </style>`;
  return a2c41RenderActivityOriginal().replace('<form class="filters filters-pro"',`${block}<form class="filters filters-pro"`);
};

const a2c41BindOriginal=bind;
bind=function(){
  a2c41BindOriginal();
  document.querySelector('#a2c41-open-pending')?.addEventListener('click',()=>openA2C40Control('pending'));
};

function openA2C41Settings(){
  modal(`<div class="modal-head"><div><h2>Ajustes</h2><p class="muted">Aplicación, copias y datos</p></div><button class="close-btn" data-close>×</button></div>
    <div class="a2c41-settings-list">
      <button type="button" id="a2c41-backups"><span>↻</span><div><strong>Copias de seguridad</strong><small>Exportar, importar y descargar CSV</small></div><em>›</em></button>
      <a href="${A2C_ANDROID_DIRECT_DOWNLOAD}" download="A2C-Finanzas.apk" id="a2c41-download-android"><span>↓</span><div><strong>Descargar aplicación Android</strong><small>Descarga directa desde A2C Finanzas</small></div><em>›</em></a>
    </div>
    <style>
      .a2c41-settings-list{display:grid;gap:9px}.a2c41-settings-list button,.a2c41-settings-list a{display:flex;align-items:center;gap:11px;padding:12px;border:1px solid #ebe7f1;border-radius:14px;background:#fff;color:inherit;text-decoration:none;text-align:left}
      .a2c41-settings-list>*>span{width:36px;height:36px;border-radius:12px;background:#f1edfa;display:grid;place-items:center;font-size:19px}
      .a2c41-settings-list div{flex:1}.a2c41-settings-list strong,.a2c41-settings-list small{display:block}.a2c41-settings-list small{font-size:11px;color:var(--muted);margin-top:2px}.a2c41-settings-list em{font-style:normal;font-size:20px;color:#978da5}
    </style>`);
  document.querySelector('#a2c41-backups')?.addEventListener('click',()=>{closeModal();openA2C40Control('backup')});
}

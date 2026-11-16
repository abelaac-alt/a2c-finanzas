(function(){
  'use strict';
  const A=window.A2C;
  const TG=A.telegram={bot:null,link:null,problems:[],poll:null};
  const METHODS={bank:'Banco / tarjeta',cash:'Efectivo',crypto:'Cripto'};

  TG.stopPolling=()=>{if(TG.poll){clearInterval(TG.poll);TG.poll=null;}};
  TG.botUrl=(start='')=>TG.bot?.bot_username?`https://t.me/${encodeURIComponent(TG.bot.bot_username)}${start?`?start=${encodeURIComponent(start)}`:''}`:'';

  TG.loadBot=async(action='status')=>{
    try{
      const {data,error}=await A.sb.functions.invoke('a2c-telegram',{body:{action}});
      if(error){
        let detail='';try{detail=(await error.context?.json?.())?.problems?.join(' ')||'';}catch(_){}
        throw new Error(detail||'La función a2c-telegram no responde. ¿Está desplegada en Supabase?');
      }
      TG.bot=data||null;TG.problems=data?.problems||[];
    }catch(error){TG.bot=null;TG.problems=[error.message||'No se pudo contactar con el bot.'];}
  };
  TG.loadLink=async()=>{
    try{TG.link=await A.rpc('a2c_tg_status');}
    catch(error){TG.link=null;TG.problems=[...TG.problems,'Falta ejecutar database/A2C_SUPABASE_TELEGRAM_V9.sql en Supabase.'];}
  };

  TG.body=()=>{
    const link=TG.link||{};const bot=TG.bot;
    const problems=TG.problems.length?`<div class="tg-alert">${A.icon('bell',18)}<div><b>Hay que revisar la configuración</b>${TG.problems.map(item=>`<small>${A.escape(item)}</small>`).join('')}</div></div>`:'';
    if(!bot?.bot_username)return `${problems}<div class="actions"><button type="button" class="btn secondary" data-close>Cerrar</button><button type="button" class="btn primary" id="tg-retry">Reintentar</button></div>`;
    if(link.linked){
      return `${problems}<section class="tg-status ok"><span>${A.icon('send',22)}</span><div><strong>Vinculado${link.telegram_username?` con @${A.escape(link.telegram_username)}`:link.telegram_name?` con ${A.escape(link.telegram_name)}`:''}</strong><small>${Number(link.receipts_count||0)} gasto${Number(link.receipts_count||0)===1?'':'s'} registrado${Number(link.receipts_count||0)===1?'':'s'} desde Telegram${link.last_receipt_at?` · último ${new Date(link.last_receipt_at).toLocaleDateString('es-ES')}`:''}</small></div></section>
        <ol class="tg-steps"><li>Abre el chat con <b>@${A.escape(bot.bot_username)}</b>.</li><li>Envía la <b>foto del ticket</b> (o el PDF como archivo).</li><li>En unos segundos tendrás el gasto registrado con importe, fecha, comercio y categoría. Puedes cambiar el método de pago o deshacerlo desde el propio mensaje.</li></ol>
        <div class="field"><label>Método de pago si el ticket no lo indica</label><select id="tg-method">${Object.entries(METHODS).map(([key,label])=>`<option value="${key}" ${link.default_payment_method===key?'selected':''}>${label}</option>`).join('')}</select></div>
        <div class="actions"><button type="button" class="btn danger" id="tg-unlink">Desvincular</button><button type="button" class="btn secondary" id="tg-check">Comprobar conexión</button><a class="btn primary" href="${TG.botUrl()}" target="_blank" rel="noopener">${A.icon('send',16)} Abrir Telegram</a></div>`;
    }
    return `${problems}<section class="tg-status"><span>${A.icon('camera',22)}</span><div><strong>Registra gastos con una foto</strong><small>Envía la foto de un ticket a <b>@${A.escape(bot.bot_username)}</b> y A2C lo registrará como gasto automáticamente.</small></div></section>
      <ol class="tg-steps"><li>Pulsa <b>Vincular con Telegram</b>: se abrirá el bot.</li><li>En Telegram pulsa <b>Iniciar</b> (o <i>Start</i>).</li><li>Cuando el bot confirme la vinculación, envíale fotos de tus tickets.</li></ol>
      <div id="tg-code" class="hidden"></div>
      <div class="actions"><button type="button" class="btn secondary" data-close>Cerrar</button><button type="button" class="btn primary" id="tg-link">${A.icon('send',16)} Vincular con Telegram</button></div>`;
  };

  TG.renderModal=()=>{
    if(!A.modalRoot.querySelector('#telegram-modal'))return;
    A.modalRoot.querySelector('#tg-body').innerHTML=TG.body();TG.bind();
  };

  TG.bind=()=>{
    const root=A.modalRoot;
    root.querySelector('#tg-retry')?.addEventListener('click',async event=>{A.setBusy(event.currentTarget,true,'Comprobando…');await TG.loadBot('setup');await TG.loadLink();TG.renderModal();});
    root.querySelector('#tg-check')?.addEventListener('click',async event=>{A.setBusy(event.currentTarget,true,'Comprobando…');await TG.loadBot('setup');await TG.loadLink();TG.renderModal();if(!TG.problems.length)A.toast('El bot está conectado y funcionando.');});
    root.querySelector('#tg-method')?.addEventListener('change',async event=>{try{await A.rpc('a2c_tg_set_payment_method',{p_method:event.target.value});A.toast('Preferencia guardada.');}catch(error){A.toast(error.message,true);}});
    root.querySelector('#tg-unlink')?.addEventListener('click',async event=>{A.setBusy(event.currentTarget,true,'Desvinculando…');try{await A.rpc('a2c_tg_unlink');await TG.loadLink();TG.renderModal();A.toast('Telegram desvinculado.');}catch(error){A.toast(error.message,true);A.setBusy(event.currentTarget,false);}});
    root.querySelector('#tg-link')?.addEventListener('click',async event=>{
      const button=event.currentTarget;A.setBusy(button,true,'Generando…');
      try{
        const result=await A.rpc('a2c_tg_create_link_code');const url=TG.botUrl(result.code);
        const box=root.querySelector('#tg-code');box.classList.remove('hidden');
        box.innerHTML=`<div class="tg-code"><small>Si Telegram no se abre solo, abre <b>@${A.escape(TG.bot.bot_username)}</b> y envía:</small><code>/start ${A.escape(result.code)}</code><small>El código caduca en 15 minutos.</small><a class="btn primary full" href="${url}" target="_blank" rel="noopener">${A.icon('send',16)} Abrir Telegram</a></div><p class="smart-hint active">Esperando la confirmación del bot…</p>`;
        button.remove();
        const opener=document.createElement('a');opener.href=url;opener.target='_blank';opener.rel='noopener';document.body.appendChild(opener);opener.click();opener.remove();
        TG.stopPolling();let tries=0;
        TG.poll=setInterval(async()=>{
          tries++;if(!A.modalRoot.querySelector('#telegram-modal')||tries>300){TG.stopPolling();return;}
          try{const status=await A.rpc('a2c_tg_status');if(status?.linked){TG.stopPolling();TG.link=status;TG.renderModal();A.toast('¡Telegram vinculado! Ya puedes enviar tickets.');}}catch(_){}
        },3000);
      }catch(error){A.toast(error.message,true);A.setBusy(button,false);}
    });
  };

  TG.open=async()=>{
    TG.stopPolling();
    A.ui.modal(`<div id="telegram-modal"><div class="modal-head"><div><h2>Tickets por Telegram</h2><p>Envía una foto del ticket y el gasto se registra solo.</p></div><button type="button" class="modal-close" data-close>${A.icon('close',21)}</button></div><div id="tg-body"><div class="tg-loading"><div class="spinner"></div><small>Conectando con el bot…</small></div></div></div>`);
    await Promise.all([TG.loadBot('status'),TG.loadLink()]);
    TG.renderModal();
  };

  // Al volver de Telegram, refresca los movimientos para ver los gastos nuevos.
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&A.modalRoot?.querySelector('#telegram-modal')&&!TG.link?.linked)A.rpc('a2c_tg_status').then(status=>{if(status?.linked){TG.stopPolling();TG.link=status;TG.renderModal();}}).catch(()=>{});});
  const originalClose=A.closeModal;A.closeModal=()=>{TG.stopPolling();originalClose();};
  A.ui.action('open-telegram',TG.open);
})();

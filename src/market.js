(function(){
  'use strict';
  const A=window.A2C;

  /* ---------- Almacenamiento local (por dispositivo) ---------- */
  const KEYS={settings:'a2c_market_settings',watch:'a2c_market_watchlist',alerts:'a2c_market_alerts',log:'a2c_market_alert_log'};
  const read=(key,fallback)=>{try{const value=JSON.parse(localStorage.getItem(key)||'null');return value??fallback;}catch(error){return fallback;}};
  const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch(error){console.warn('A2C: no se pudo guardar',key,error);}};

  const COLORS={up:'#1E7050',down:'#B3261E',flat:'#6B7077',grid:'#EFEEEA',text:'#6B7077',ink:'#15181C',volume:'#D2D1CB'};
  const RANGES=[['1d','1D'],['5d','5D'],['1mo','1M'],['6mo','6M'],['1y','1A'],['5y','5A']];
  const SUGGESTIONS=[['SAN.MC','Banco Santander'],['IBE.MC','Iberdrola'],['ITX.MC','Inditex'],['^IBEX','IBEX 35'],['AAPL','Apple'],['MSFT','Microsoft'],['NVDA','NVIDIA'],['^GSPC','S&P 500']];
  const ALERT_TYPES={above:'Precio igual o superior a',below:'Precio igual o inferior a',up:'Sube en el día al menos',down:'Baja en el día al menos'};
  const LIB_URL='https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  const MAX_HOME=6,MAX_WATCH=20;

  const M=A.market={quotes:new Map(),chartCache:new Map(),selected:null,range:'1mo',chartType:'area',lastFetch:0,loading:false,loadingPromise:null,error:'',serverOk:null,timer:null,chart:null,mode:''};

  M.settings=()=>({provider:'auto',twelveKey:'',interval:5,notify:true,...read(KEYS.settings,{})});
  M.saveSettings=settings=>write(KEYS.settings,settings);
  M.watchlist=()=>read(KEYS.watch,[]);
  M.saveWatchlist=list=>{write(KEYS.watch,list);M.syncNative();};
  M.alerts=()=>read(KEYS.alerts,[]);
  M.saveAlerts=list=>write(KEYS.alerts,list);
  M.log=()=>read(KEYS.log,[]);
  M.pushLog=entry=>write(KEYS.log,[entry,...M.log()].slice(0,30));

  /* ---------- Formato ---------- */
  M.tone=value=>Number(value)>0?'up':Number(value)<0?'down':'flat';
  M.num=(value,digits=2)=>new Intl.NumberFormat('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value)||0);
  M.price=(value,currency)=>{
    if(value==null||!Number.isFinite(Number(value)))return '—';
    const digits=Math.abs(value)<1?4:2;
    try{return currency?new Intl.NumberFormat('es-ES',{style:'currency',currency:String(currency).toUpperCase(),minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value):M.num(value,digits);}
    catch(error){return `${M.num(value,digits)} ${A.escape(currency)}`;}
  };
  M.pct=value=>value==null||!Number.isFinite(Number(value))?'—':`${value>0?'+':value<0?'−':''}${M.num(Math.abs(value),2)} %`;
  M.signed=(value,currency)=>value==null||!Number.isFinite(Number(value))?'—':`${value>0?'+':value<0?'−':''}${M.price(Math.abs(value),currency)}`;
  M.compact=value=>value==null||!Number.isFinite(Number(value))?'—':new Intl.NumberFormat('es-ES',{notation:'compact',maximumFractionDigits:1}).format(value);
  M.time=seconds=>seconds?new Date(seconds*1000).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  M.arrow=value=>Number(value)>0?'▲':Number(value)<0?'▼':'■';

  /* ---------- Proveedores de datos ---------- */
  M.server={
    label:'Yahoo Finance (servidor A2C)',
    async call(body){const result=await A.sb.functions.invoke('a2c-market',{body});if(result.error)throw result.error;if(result.data?.error)throw new Error(result.data.error);return result.data;},
    async quotes(symbols){return (await this.call({action:'quote',symbols})).quotes||[];},
    async chart(symbol,range){return this.call({action:'chart',symbol,range});},
    async search(q){return (await this.call({action:'search',q})).results||[];}
  };
  M.twelve={
    label:'Twelve Data',
    async get(path,params){
      const url=new URL(`https://api.twelvedata.com${path}`);
      Object.entries({...params,apikey:M.settings().twelveKey}).forEach(([key,value])=>url.searchParams.set(key,value));
      const response=await fetch(url);const data=await response.json();
      if(data.status==='error')throw new Error(data.message||'Twelve Data no ha devuelto datos.');
      return data;
    },
    async quotes(symbols){
      const data=await this.get('/quote',{symbol:symbols.join(',')});
      const rows=symbols.length===1?{[symbols[0]]:data}:data;
      return symbols.map(symbol=>{const q=rows[symbol];if(!q||q.status==='error'||q.close==null)return {symbol,error:q?.message||'Sin datos'};
        return {symbol,name:q.name,currency:q.currency,exchange:q.exchange,price:Number(q.close),previousClose:Number(q.previous_close),open:Number(q.open),dayHigh:Number(q.high),dayLow:Number(q.low),volume:Number(q.volume)||null,high52:Number(q.fifty_two_week?.high)||null,low52:Number(q.fifty_two_week?.low)||null,change:Number(q.change),changePct:Number(q.percent_change),time:Number(q.timestamp)||null,spark:null};});
    },
    async chart(symbol,range){
      const map={'1d':['5min',78],'5d':['30min',65],'1mo':['1day',23],'6mo':['1day',126],'1y':['1day',252],'5y':['1week',260]};
      const [interval,outputsize]=map[range]||map['1mo'];
      const data=await this.get('/time_series',{symbol,interval,outputsize,order:'ASC'});
      const points=(data.values||[]).map(row=>{const iso=row.datetime.length>10?row.datetime.replace(' ','T'):`${row.datetime}T00:00:00`;return {t:Math.floor(new Date(iso).getTime()/1000),o:Number(row.open),h:Number(row.high),l:Number(row.low),c:Number(row.close),v:Number(row.volume)||0};});
      return {meta:{symbol,currency:data.meta?.currency,exchange:data.meta?.exchange},range,points};
    },
    async search(q){const data=await this.get('/symbol_search',{symbol:q,outputsize:12});return (data.data||[]).map(row=>({symbol:row.symbol,name:row.instrument_name,exchange:row.exchange,type:row.instrument_type}));}
  };
  M.provider=async()=>{
    const settings=M.settings();
    if(settings.provider==='twelve')return settings.twelveKey?M.twelve:null;
    if(settings.provider==='server')return M.server;
    if(M.serverOk===null){try{await M.server.call({action:'quote',symbols:[]});M.serverOk=true;}catch(error){console.warn('A2C: servidor de mercado no disponible',error);M.serverOk=false;}}
    if(M.serverOk)return M.server;
    return settings.twelveKey?M.twelve:null;
  };

  /* ---------- Cotizaciones ---------- */
  M.refresh=async({force=false}={})=>{
    const list=M.watchlist();
    if(!A.state.user||!list.length){M.updateViews();return;}
    if(M.loadingPromise){if(force)M.pendingForce=true;return M.loadingPromise;}
    if(!force&&Date.now()-M.lastFetch<60000)return;
    M.loading=true;
    M.loadingPromise=(async()=>{
      try{
        const provider=await M.provider();
        if(!provider){M.error='setup';return;}
        const rows=await provider.quotes(list.map(row=>row.symbol));
        let renamed=false;
        rows.forEach(quote=>{if(quote.error||quote.price==null)return;M.quotes.set(quote.symbol,quote);const item=list.find(row=>row.symbol===quote.symbol);if(item&&quote.name&&(!item.name||item.name===item.symbol)){item.name=quote.name;renamed=true;}if(item&&quote.currency&&!item.currency){item.currency=quote.currency;renamed=true;}});
        if(renamed)write(KEYS.watch,list);
        const failed=rows.filter(row=>row.error).map(row=>row.symbol);
        M.error=failed.length===rows.length&&rows.length?`No hay datos para ${failed.join(', ')}.`:'';
        M.lastFetch=Date.now();
        M.checkAlerts();M.syncNative();
      }catch(error){console.warn(error);M.error=error.message||'No se pudieron obtener las cotizaciones.';}
      finally{M.loading=false;M.loadingPromise=null;M.updateViews();if(M.pendingForce){M.pendingForce=false;setTimeout(()=>M.refresh({force:true}),0);}}
    })();
    return M.loadingPromise;
  };
  M.startTimer=()=>{
    clearInterval(M.timer);
    const minutes=Math.max(1,Number(M.settings().interval)||5);
    M.timer=setInterval(()=>{if(!document.hidden)M.refresh({force:true});},minutes*60000);
  };

  /* ---------- Alertas y notificaciones ---------- */
  M.alertMatches=(alert,quote)=>{
    if(!quote||quote.price==null)return false;
    if(alert.type==='above')return quote.price>=alert.value;
    if(alert.type==='below')return quote.price<=alert.value;
    if(alert.type==='up')return quote.changePct!=null&&quote.changePct>=alert.value;
    if(alert.type==='down')return quote.changePct!=null&&quote.changePct<=-alert.value;
    return false;
  };
  M.alertLabel=alert=>{const currency=M.watchlist().find(row=>row.symbol===alert.symbol)?.currency||M.quotes.get(alert.symbol)?.currency;return `${ALERT_TYPES[alert.type]||alert.type} ${['up','down'].includes(alert.type)?`${M.num(alert.value,2)} %`:M.price(alert.value,currency)}`;};
  M.checkAlerts=()=>{
    const alerts=M.alerts();let changed=false;
    alerts.forEach(alert=>{
      if(!alert.active)return;const quote=M.quotes.get(alert.symbol);
      if(!M.alertMatches(alert,quote))return;
      alert.active=false;alert.triggeredAt=Date.now();alert.triggerPrice=quote.price;changed=true;
      const rising=alert.type==='above'||alert.type==='up';
      const title=`${alert.symbol} ${rising?'sube':'baja'} · ${M.price(quote.price,quote.currency)}`;
      const body=`${M.alertLabel(alert)}. Variación del día: ${M.pct(quote.changePct)}.`;
      M.pushLog({id:A.unique('log'),symbol:alert.symbol,title,body,at:Date.now(),tone:rising?'up':'down'});
      M.notify(title,body);
    });
    if(changed)M.saveAlerts(alerts);
  };
  M.permission=()=>window.A2CNative?.showNotification?'native':('Notification' in window?Notification.permission:'unsupported');
  M.requestPermission=async()=>{
    if(window.A2CNative?.showNotification){A.toast('Las alertas se enviarán como notificaciones de Android.');return 'native';}
    if(!('Notification' in window)){A.toast('Este dispositivo no admite notificaciones del navegador. Las alertas se mostrarán dentro de la aplicación.',true);return 'unsupported';}
    const result=await Notification.requestPermission();
    A.toast(result==='granted'?'Notificaciones activadas.':'No se han concedido permisos de notificación.',result!=='granted');
    M.updateViews();return result;
  };
  M.notify=async(title,body)=>{
    A.toast(`${title}. ${body}`);
    if(!M.settings().notify)return;
    try{if(window.A2CNative?.showNotification){window.A2CNative.showNotification(title,body);return;}}catch(error){console.warn(error);}
    if(!('Notification' in window)||Notification.permission!=='granted')return;
    try{const registration=await navigator.serviceWorker?.getRegistration?.();if(registration){await registration.showNotification(title,{body,icon:'./icon-192.png',badge:'./icon-192.png',tag:`a2c-${title}`});return;}}catch(error){console.warn(error);}
    try{new Notification(title,{body,icon:'./icon-192.png'});}catch(error){console.warn(error);}
  };

  /* ---------- Widget nativo (si la app Android lo admite) ---------- */
  M.syncNative=()=>{
    if(!window.A2CNative?.saveStockWidget)return;
    const rows=M.watchlist().filter(row=>row.home).map(row=>{const q=M.quotes.get(row.symbol)||{};return {symbol:row.symbol,name:row.name,price:q.price??null,changePct:q.changePct??null,currency:q.currency||row.currency||''};});
    try{window.A2CNative.saveStockWidget(JSON.stringify(rows));window.A2CNative.refreshStockWidget?.();}catch(error){console.warn(error);}
  };

  /* ---------- Piezas de interfaz ---------- */
  M.spark=(values,tone)=>{
    const data=(values||[]).filter(Number.isFinite);
    if(data.length<2)return '<span class="market-spark empty"></span>';
    const min=Math.min(...data),max=Math.max(...data),span=max-min||1,w=72,h=26;
    const pts=data.map((v,i)=>`${(i/(data.length-1)*w).toFixed(1)},${(h-2-(v-min)/span*(h-4)).toFixed(1)}`).join(' ');
    return `<svg class="market-spark ${tone}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  };
  M.changeBadge=quote=>`<span class="market-change ${M.tone(quote?.changePct)}">${quote?`${M.arrow(quote.changePct)} ${M.pct(quote.changePct)}`:'—'}</span>`;
  M.rowMarkup=(item,{active=false,compact=false}={})=>{
    const q=M.quotes.get(item.symbol);
    return `<button class="market-row ${active?'active':''}" data-action="market-open" data-symbol="${A.escape(item.symbol)}"><span class="market-id"><strong>${A.escape(item.symbol)}${item.home&&!compact?`<span class="market-home" title="Visible en Inicio">${A.icon('home',12)}</span>`:''}</strong><small>${A.escape(item.name||item.exchange||'')}</small></span>${M.spark(q?.spark,M.tone(q?.changePct))}<span class="market-quote"><b>${M.price(q?.price,q?.currency||item.currency)}</b>${M.changeBadge(q)}</span></button>`;
  };
  M.sourceLabel=()=>{const s=M.settings();if(s.provider==='twelve')return M.twelve.label;if(s.provider==='server'||M.serverOk)return M.server.label;return s.twelveKey?M.twelve.label:'sin configurar';};
  M.updatedLabel=()=>M.lastFetch?`Actualizado a las ${new Date(M.lastFetch).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}`:(M.loading?'Actualizando…':'Sin actualizar');

  M.widgetMarkup=()=>{
    const home=M.watchlist().filter(row=>row.home);
    const open='<button class="text-button" data-action="open-tool" data-tool="investment">Ver inversión</button>';
    if(!home.length)return `<section class="card dashboard-section market-widget" id="market-widget">${A.ui.sectionTitle('Mis acciones','Sigue cotizaciones desde la pantalla de inicio',open)}<div class="market-widget-empty"><span>${A.icon('investment',20)}</span><p>Elige qué acciones quieres ver aquí desde la zona de inversión.</p><button class="btn small secondary" data-action="open-tool" data-tool="investment">${A.icon('plus',15)} Añadir acciones</button></div></section>`;
    const body=M.error==='setup'?`<div class="info-strip">Configura la fuente de datos en Herramientas › Inversión para ver los precios.</div>`:`<div class="market-list">${home.map(item=>M.rowMarkup(item,{compact:true})).join('')}</div>${M.error?`<p class="market-note error">${A.escape(M.error)}</p>`:''}`;
    return `<section class="card dashboard-section market-widget" id="market-widget">${A.ui.sectionTitle('Mis acciones',M.updatedLabel(),open)}${body}</section>`;
  };

  M.setupMarkup=()=>`<section class="card market-setup"><div class="market-setup-head"><span>${A.icon('investment',22)}</span><div><h3>Conecta una fuente de cotizaciones</h3><p>A2C necesita una fuente de datos de bolsa. Elige una de estas dos opciones:</p></div></div>
    <ol class="market-steps"><li><b>Servidor A2C (recomendado).</b> Publica la función <code>a2c-market</code> incluida en el proyecto en tu Supabase. Usa Yahoo Finance, no necesita clave y cubre el Mercado Continuo, Europa, EE. UU., índices y criptomonedas.</li><li><b>Twelve Data.</b> Crea una clave gratuita en twelvedata.com y pégala en «Fuente de datos». El plan gratuito incluye bolsa de EE. UU., divisas y criptomonedas (800 consultas al día).</li></ol>
    <div class="actions"><button class="btn primary" data-action="market-settings">${A.icon('tools',16)} Fuente de datos</button></div></section>`;

  M.emptyMarkup=()=>`<section class="card">${A.ui.empty('Tu lista de seguimiento está vacía','Añade acciones, índices o ETF para ver su evolución, recibir alertas y mostrarlos en Inicio.')}<div class="market-suggestions"><span>Sugerencias</span>${SUGGESTIONS.map(([symbol,name])=>`<button class="filter-pill" data-action="market-add-suggestion" data-symbol="${symbol}" data-name="${A.escape(name)}">${A.escape(name)}</button>`).join('')}</div></section>`;

  M.overviewMarkup=()=>{
    const quotes=M.watchlist().map(row=>M.quotes.get(row.symbol)).filter(Boolean);
    const up=quotes.filter(q=>q.changePct>0).length,down=quotes.filter(q=>q.changePct<0).length;
    const best=quotes.slice().sort((a,b)=>b.changePct-a.changePct)[0],worst=quotes.slice().sort((a,b)=>a.changePct-b.changePct)[0];
    const avg=quotes.length?quotes.reduce((sum,q)=>sum+(q.changePct||0),0)/quotes.length:null;
    return `<div class="market-overview" id="market-overview"><article><small>En subida</small><strong class="up">${up}</strong><em>de ${quotes.length} valores</em></article><article><small>En bajada</small><strong class="down">${down}</strong><em>de ${quotes.length} valores</em></article><article><small>Media de la lista</small><strong class="${M.tone(avg)}">${M.pct(avg)}</strong><em>variación del día</em></article><article><small>Mejor / peor</small><strong>${best?A.escape(best.symbol):'—'} <span class="${M.tone(best?.changePct)}">${best?M.pct(best.changePct):''}</span></strong><em>${worst&&worst!==best?`${A.escape(worst.symbol)} ${M.pct(worst.changePct)}`:'—'}</em></article></div>`;
  };

  M.quoteHeadMarkup=()=>{
    const item=M.watchlist().find(row=>row.symbol===M.selected)||{symbol:M.selected};const q=M.quotes.get(M.selected);
    return `<div class="market-head" id="market-quote-head"><div class="market-head-id"><h3>${A.escape(item.name||item.symbol)}</h3><p>${A.escape(item.symbol)}${q?.exchange||item.exchange?` · ${A.escape(q?.exchange||item.exchange)}`:''}${q?.currency?` · ${A.escape(q.currency)}`:''}</p></div><div class="market-head-price"><strong>${M.price(q?.price,q?.currency||item.currency)}</strong><span class="${M.tone(q?.change)}">${q?`${M.arrow(q.change)} ${M.signed(q.change,q.currency)} (${M.pct(q.changePct)}) hoy`:'Sin cotización'}</span><small>${q?.time?`Último dato: ${M.time(q.time)}`:''}</small></div></div>`;
  };
  M.statsMarkup=()=>{
    const q=M.quotes.get(M.selected)||{};const cur=q.currency;
    const cell=(label,value)=>`<div><small>${label}</small><b>${value}</b></div>`;
    return `<div class="market-stats" id="market-stats">${cell('Apertura',M.price(q.open,cur))}${cell('Máximo del día',M.price(q.dayHigh,cur))}${cell('Mínimo del día',M.price(q.dayLow,cur))}${cell('Cierre anterior',M.price(q.previousClose,cur))}${cell('Volumen',M.compact(q.volume))}${cell('Máx. 52 semanas',M.price(q.high52,cur))}${cell('Mín. 52 semanas',M.price(q.low52,cur))}${cell('Variación del periodo','<span id="market-period-change">—</span>')}</div>`;
  };
  M.chartCardMarkup=()=>{
    const item=M.watchlist().find(row=>row.symbol===M.selected);
    return `${M.quoteHeadMarkup()}<div class="market-toolbar"><div class="period-pills market-ranges" role="tablist" aria-label="Periodo">${RANGES.map(([key,label])=>`<button type="button" class="${M.range===key?'active':''}" data-action="market-range" data-range="${key}" aria-pressed="${M.range===key}">${label}</button>`).join('')}</div><div class="period-pills market-types" aria-label="Tipo de gráfico"><button type="button" class="${M.chartType==='area'?'active':''}" data-action="market-type" data-type="area">Línea</button><button type="button" class="${M.chartType==='candles'?'active':''}" data-action="market-type" data-type="candles">Velas</button></div></div>
      <div class="market-chart-wrap"><div class="market-legend" id="market-legend"></div><div id="market-chart" class="market-chart" role="img" aria-label="Gráfico de precio de ${A.escape(M.selected)}"></div><div class="market-chart-status" id="market-chart-status"><div class="spinner"></div></div></div>
      ${M.statsMarkup()}
      <div class="market-actions"><button class="btn small primary" data-action="market-new-alert" data-symbol="${A.escape(M.selected)}">${A.icon('bell',15)} Crear alerta</button><button class="btn small secondary" data-action="market-toggle-home" data-symbol="${A.escape(M.selected)}">${A.icon('home',15)} ${item?.home?'Quitar de Inicio':'Mostrar en Inicio'}</button><button class="btn small danger" data-action="market-remove" data-symbol="${A.escape(M.selected)}">${A.icon('trash',15)} Dejar de seguir</button></div>`;
  };
  M.listMarkup=()=>`<div class="market-list" id="market-list">${M.watchlist().map(item=>M.rowMarkup(item,{active:item.symbol===M.selected})).join('')}</div>`;
  M.moversMarkup=()=>{
    const rows=M.watchlist().map(row=>({row,q:M.quotes.get(row.symbol)})).filter(x=>x.q&&x.q.changePct!=null).sort((a,b)=>b.q.changePct-a.q.changePct);
    if(!rows.length)return `<div id="market-movers">${A.ui.empty('Sin datos del día todavía')}</div>`;
    const max=Math.max(1,...rows.map(x=>Math.abs(x.q.changePct)));
    return `<div class="market-movers" id="market-movers" role="table" aria-label="Variación del día por valor">${rows.map(({row,q})=>{const w=Math.abs(q.changePct)/max*50;const tone=M.tone(q.changePct);return `<button class="mover-row" role="row" data-action="market-open" data-symbol="${A.escape(row.symbol)}" title="${A.escape(row.name||row.symbol)}: ${M.pct(q.changePct)}"><span class="mover-symbol" role="cell">${A.escape(row.symbol)}</span><span class="mover-track" role="cell"><i class="${tone}" style="${q.changePct>=0?'left:50%':`right:50%`};width:${w.toFixed(2)}%"></i></span><span class="mover-value ${tone}" role="cell">${M.pct(q.changePct)}</span></button>`;}).join('')}</div>`;
  };
  M.alertsMarkup=()=>{
    const alerts=M.alerts();const log=M.log().slice(0,8);const permission=M.permission();
    const permissionText={granted:'Notificaciones del sistema activadas.',native:'Las alertas llegan como notificaciones de Android.',denied:'Las notificaciones están bloqueadas en este navegador; las alertas se verán dentro de la app.',default:'Permite las notificaciones para recibir avisos aunque estés en otra pantalla.',unsupported:'Este dispositivo no admite notificaciones del navegador; las alertas se verán dentro de la app.'}[permission];
    return `<div id="market-alerts"><div class="info-strip market-permission">${A.escape(permissionText)}${permission==='default'?' <button class="text-button" data-action="market-permission">Permitir</button>':''}</div>
      ${alerts.length?`<div class="market-alert-list">${alerts.map(alert=>`<div class="market-alert ${alert.active?'':'done'}"><span class="market-alert-icon ${alert.type==='above'||alert.type==='up'?'up':'down'}">${A.icon(alert.type==='above'||alert.type==='up'?'income':'expense',16)}</span><div><strong>${A.escape(alert.symbol)}</strong><small>${A.escape(M.alertLabel(alert))}${alert.active?'':` · saltó ${new Date(alert.triggeredAt).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}`}</small></div>${alert.active?'<span class="status-pill">Activa</span>':`<button class="btn tiny secondary" data-action="market-rearm-alert" data-id="${alert.id}">Reactivar</button>`}<button class="icon-action" data-action="market-delete-alert" data-id="${alert.id}" aria-label="Eliminar alerta">${A.icon('trash',15)}</button></div>`).join('')}</div>`:A.ui.empty('No hay alertas','Crea una alerta para que A2C te avise cuando un valor suba o baje.')}
      ${log.length?`<details class="market-log"><summary>Últimos avisos (${log.length})</summary>${log.map(entry=>`<div class="market-log-row"><b class="${entry.tone}">${A.escape(entry.title)}</b><small>${new Date(entry.at).toLocaleString('es-ES')} · ${A.escape(entry.body)}</small></div>`).join('')}</details>`:''}</div>`;
  };

  M.contentMarkup=()=>{
    const list=M.watchlist();
    if(M.error==='setup'){M.mode='setup';return M.setupMarkup();}
    if(!list.length){M.mode='empty';return M.emptyMarkup();}
    if(!list.some(row=>row.symbol===M.selected))M.selected=list[0].symbol;
    M.mode='list';
    return `${M.error?`<div class="info-strip error market-error">${A.escape(M.error)}</div>`:''}${M.overviewMarkup()}
      <div class="market-layout"><section class="card market-chart-card" id="market-chart-card">${M.chartCardMarkup()}</section>
      <section class="card market-watch">${A.ui.sectionTitle('Lista de seguimiento',`${list.length} valor${list.length===1?'':'es'} · ${M.updatedLabel()}`,`<button class="icon-action" data-action="market-refresh" aria-label="Actualizar cotizaciones">${A.icon('subscriptions',16)}</button>`)}${M.listMarkup()}</section></div>
      <div class="market-layout even"><section class="card">${A.ui.sectionTitle('Subidas y bajadas de hoy','Variación porcentual de cada valor')}${M.moversMarkup()}</section>
      <section class="card">${A.ui.sectionTitle('Alertas de precio','Avisos cuando un valor sube o baja',`<button class="btn small secondary" data-action="market-new-alert" data-symbol="${A.escape(M.selected)}">${A.icon('plus',15)} Nueva</button>`)}${M.alertsMarkup()}</section></div>
      <p class="market-note">Fuente: ${A.escape(M.sourceLabel())}. Las cotizaciones pueden llevar hasta 15 minutos de retraso y no constituyen asesoramiento financiero. Gráficos: <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts™</a>.</p>`;
  };

  M.render=()=>`${A.ui.sectionTitle('Inversión','Cotizaciones, gráficos profesionales y alertas de precio',`<div class="section-actions"><button class="btn small secondary" data-action="market-settings">${A.icon('tools',15)} Fuente de datos</button><button class="btn small primary" data-action="market-add">${A.icon('plus',15)} Añadir valor</button></div>`)}<div id="market-content">${M.contentMarkup()}</div>`;
  M.afterRender=()=>{if(M.mode==='list')M.drawChart();if(!M.lastFetch||Date.now()-M.lastFetch>60000)M.refresh();};

  M.updateViews=()=>{
    const widget=document.querySelector('#market-widget');if(widget)widget.outerHTML=M.widgetMarkup();
    const content=document.querySelector('#market-content');if(!content)return;
    const previousMode=M.mode;const previousSelected=M.selected;
    if(previousMode!=='list'||M.error==='setup'||!M.watchlist().length||!document.querySelector('#market-chart')){content.innerHTML=M.contentMarkup();if(M.mode==='list')M.drawChart();return;}
    if(!M.watchlist().some(row=>row.symbol===M.selected)){content.innerHTML=M.contentMarkup();M.drawChart();return;}
    const swap=(selector,html)=>{const node=document.querySelector(selector);if(node)node.outerHTML=html;};
    swap('#market-overview',M.overviewMarkup());swap('#market-quote-head',M.quoteHeadMarkup());swap('#market-list',M.listMarkup());swap('#market-movers',M.moversMarkup());swap('#market-alerts',M.alertsMarkup());
    const stats=document.querySelector('#market-stats');if(stats){const period=document.querySelector('#market-period-change')?.outerHTML;stats.outerHTML=M.statsMarkup();if(period)swap('#market-period-change',period);}
    const watchSubtitle=document.querySelector('.market-watch .section-title p');if(watchSubtitle){const n=M.watchlist().length;watchSubtitle.textContent=`${n} valor${n===1?'':'es'} · ${M.updatedLabel()}`;}
    if(previousSelected!==M.selected)M.drawChart();
  };

  /* ---------- Gráfico de precios ---------- */
  M.loadLibrary=()=>M._library||(M._library=new Promise((resolve,reject)=>{
    if(window.LightweightCharts)return resolve(window.LightweightCharts);
    const script=document.createElement('script');script.src=LIB_URL;script.async=true;
    script.onload=()=>window.LightweightCharts?resolve(window.LightweightCharts):reject(new Error('Módulo de gráficos no disponible.'));
    script.onerror=()=>{M._library=null;reject(new Error('No se pudo cargar el módulo de gráficos. Comprueba la conexión.'));};
    document.head.appendChild(script);
  }));
  M.disposeChart=()=>{try{M.chart?.remove();}catch(error){}M.chart=null;};
  M.chartData=async(symbol,range)=>{
    const key=`${symbol}|${range}`;const cached=M.chartCache.get(key);const ttl=range==='1d'?60000:600000;
    if(cached&&Date.now()-cached.at<ttl)return cached.data;
    const provider=await M.provider();if(!provider)throw new Error('Configura una fuente de datos.');
    const data=await provider.chart(symbol,range);M.chartCache.set(key,{at:Date.now(),data});return data;
  };
  M.drawChart=async()=>{
    const el=document.querySelector('#market-chart');if(!el||!M.selected)return;
    const status=document.querySelector('#market-chart-status');const symbol=M.selected,range=M.range,type=M.chartType;
    const token=M._drawToken=(M._drawToken||0)+1;
    M.disposeChart();if(status){status.className='market-chart-status';status.innerHTML='<div class="spinner"></div>';}
    try{
      const [data,LW]=await Promise.all([M.chartData(symbol,range),M.loadLibrary()]);
      if(token!==M._drawToken||!document.body.contains(el))return;
      const seen=new Set();
      const points=(data.points||[]).filter(p=>Number.isFinite(p.c)&&!seen.has(p.t)&&seen.add(p.t)).sort((a,b)=>a.t-b.t);
      if(points.length<2)throw new Error('No hay suficientes datos para este periodo.');
      const shift=t=>t-new Date(t*1000).getTimezoneOffset()*60;
      const intraday=range==='1d'||range==='5d';
      const first=points[0].c,last=points[points.length-1].c;const periodChange=(last-first)/first*100;const tone=M.tone(periodChange);const color=COLORS[tone];
      const periodNode=document.querySelector('#market-period-change');if(periodNode){periodNode.className=tone;periodNode.textContent=M.pct(periodChange);}
      const chart=LW.createChart(el,{autoSize:true,
        layout:{attributionLogo:false,background:{type:'solid',color:'transparent'},textColor:COLORS.text,fontSize:11,fontFamily:getComputedStyle(document.body).fontFamily},
        grid:{vertLines:{visible:false},horzLines:{color:COLORS.grid}},
        rightPriceScale:{borderVisible:false,scaleMargins:{top:.12,bottom:.24}},
        timeScale:{borderVisible:false,timeVisible:intraday,secondsVisible:false,fixLeftEdge:true,fixRightEdge:true,lockVisibleTimeRangeOnResize:true},
        crosshair:{mode:LW.CrosshairMode.Magnet,vertLine:{color:COLORS.text,width:1,style:LW.LineStyle.Dashed,labelBackgroundColor:COLORS.ink},horzLine:{color:COLORS.text,width:1,style:LW.LineStyle.Dashed,labelBackgroundColor:COLORS.ink}},
        handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
        handleScale:{mouseWheel:false,pinch:true,axisPressedMouseMove:false,axisDoubleClickReset:true},
        localization:{locale:'es-ES',priceFormatter:value=>M.num(value,Math.abs(value)<1?4:2)}});
      M.chart=chart;
      let series;
      if(type==='candles'){series=chart.addCandlestickSeries({upColor:COLORS.up,downColor:COLORS.down,borderVisible:false,wickUpColor:COLORS.up,wickDownColor:COLORS.down,priceLineVisible:false});series.setData(points.map(p=>({time:shift(p.t),open:p.o,high:p.h,low:p.l,close:p.c})));}
      else{const rgb=color==='#1E7050'?'30,112,80':color==='#B3261E'?'179,38,30':'107,112,119';series=chart.addAreaSeries({lineColor:color,lineWidth:2,topColor:`rgba(${rgb},.16)`,bottomColor:`rgba(${rgb},0)`,priceLineVisible:false,crosshairMarkerRadius:4,crosshairMarkerBorderColor:'#FFFFFF',crosshairMarkerBackgroundColor:color});series.setData(points.map(p=>({time:shift(p.t),value:p.c})));}
      if(points.some(p=>p.v>0)){const volume=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});chart.priceScale('volume').applyOptions({scaleMargins:{top:.82,bottom:0}});volume.setData(points.map((p,i)=>({time:shift(p.t),value:p.v,color:(p.c>=(i?points[i-1].c:p.o))?'rgba(30,112,80,.28)':'rgba(179,38,30,.28)'})));}
      const prev=M.quotes.get(symbol)?.previousClose;
      if(range==='1d'&&prev)series.createPriceLine({price:prev,color:COLORS.text,lineWidth:1,lineStyle:LW.LineStyle.Dashed,axisLabelVisible:true,title:'Cierre ant.'});
      chart.timeScale().fitContent();
      const legend=document.querySelector('#market-legend');const currency=data.meta?.currency||M.quotes.get(symbol)?.currency;
      const byTime=new Map(points.map(p=>[shift(p.t),p]));
      const showLegend=point=>{if(!legend||!point)return;const when=new Date((point.t)*1000).toLocaleString('es-ES',intraday?{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}:{day:'2-digit',month:'short',year:'numeric'});
        legend.innerHTML=type==='candles'?`<span>${when}</span><span>A ${M.num(point.o)}</span><span>Máx ${M.num(point.h)}</span><span>Mín ${M.num(point.l)}</span><b>C ${M.price(point.c,currency)}</b>${point.v?`<span>Vol ${M.compact(point.v)}</span>`:''}`:`<span>${when}</span><b>${M.price(point.c,currency)}</b>${point.v?`<span>Vol ${M.compact(point.v)}</span>`:''}`;};
      showLegend(points[points.length-1]);
      chart.subscribeCrosshairMove(param=>{const point=param?.time!=null?byTime.get(param.time):null;showLegend(point||points[points.length-1]);});
      if(status)status.className='market-chart-status hidden';
    }catch(error){
      if(token!==M._drawToken)return;
      console.warn(error);if(status){status.className='market-chart-status error';status.innerHTML=`<p>${A.escape(error.message||'No se pudo cargar el gráfico.')}</p><button class="btn tiny secondary" data-action="market-redraw">Reintentar</button>`;}
    }
  };

  /* ---------- Ventanas ---------- */
  M.addSymbol=({symbol,name='',exchange='',currency=''})=>{
    symbol=String(symbol||'').trim().toUpperCase();if(!symbol)return false;
    const list=M.watchlist();if(list.some(row=>row.symbol===symbol)){A.toast(`${symbol} ya está en tu lista.`);return false;}
    if(list.length>=MAX_WATCH){A.toast(`Puedes seguir hasta ${MAX_WATCH} valores.`,true);return false;}
    list.push({symbol,name,exchange,currency,home:list.filter(row=>row.home).length<MAX_HOME,addedAt:Date.now()});
    M.saveWatchlist(list);M.selected=symbol;M.refresh({force:true});A.toast(`${symbol} añadido a tu lista.`);return true;
  };
  M.openSearch=()=>{
    A.ui.modal(`<div class="modal-head"><div><h2>Añadir valor</h2><p>Busca por nombre o símbolo: Santander, IBE.MC, Apple, ^IBEX…</p></div><button class="modal-close" data-close>${A.icon('close',21)}</button></div>
      <label class="search-field market-search">${A.icon('search',18)}<input id="market-search-input" autocomplete="off" placeholder="Nombre o símbolo"></label>
      <div id="market-search-results" class="market-search-results"><div class="market-suggestions"><span>Sugerencias</span>${SUGGESTIONS.map(([symbol,name])=>`<button class="filter-pill" data-action="market-add-suggestion" data-symbol="${symbol}" data-name="${A.escape(name)}">${A.escape(name)}</button>`).join('')}</div></div>`);
    const input=A.modalRoot.querySelector('#market-search-input');const results=A.modalRoot.querySelector('#market-search-results');input.focus();
    let request=0;
    input.addEventListener('input',A.debounce(async()=>{
      const q=input.value.trim();const id=++request;if(q.length<2)return;
      results.innerHTML='<div class="stats-loading"><div class="spinner"></div><p>Buscando…</p></div>';
      try{const provider=await M.provider();if(!provider)throw new Error('Configura primero la fuente de datos.');const rows=await provider.search(q);if(id!==request)return;
        const owned=new Set(M.watchlist().map(row=>row.symbol));
        results.innerHTML=rows.length?`<div class="market-search-list">${rows.map(row=>`<div class="market-search-row"><div><strong>${A.escape(row.symbol)}</strong><small>${A.escape(row.name||'')}${row.exchange?` · ${A.escape(row.exchange)}`:''}${row.type?` · ${A.escape(String(row.type).toLowerCase())}`:''}</small></div>${owned.has(String(row.symbol).toUpperCase())?'<span class="status-pill">En tu lista</span>':`<button class="btn tiny primary" data-action="market-add-result" data-symbol="${A.escape(row.symbol)}" data-name="${A.escape(row.name||'')}" data-exchange="${A.escape(row.exchange||'')}">Añadir</button>`}</div>`).join('')}</div>`:A.ui.empty('Sin resultados','Prueba con otro nombre o con el símbolo exacto.');
      }catch(error){if(id===request)results.innerHTML=`<div class="info-strip error">${A.escape(error.message||'No se pudo buscar.')}</div>`;}
    },350));
  };
  M.openAlertForm=symbol=>{
    const list=M.watchlist();if(!list.length){A.toast('Añade primero un valor a tu lista.',true);return;}
    const selected=list.some(row=>row.symbol===symbol)?symbol:list[0].symbol;
    A.ui.modal(`<form id="market-alert-form" class="stack-form"><div class="modal-head"><div><h2>Nueva alerta de precio</h2><p>A2C comprueba las cotizaciones mientras la aplicación está abierta y te avisa una vez cuando se cumpla.</p></div><button type="button" class="modal-close" data-close>${A.icon('close',21)}</button></div>
      <div class="field"><label>Valor</label><select name="symbol">${list.map(row=>`<option value="${A.escape(row.symbol)}" ${row.symbol===selected?'selected':''}>${A.escape(row.symbol)} · ${A.escape(row.name||'')}</option>`).join('')}</select><small id="market-alert-price"></small></div>
      <div class="form-grid two"><div class="field"><label>Condición</label><select name="type">${Object.entries(ALERT_TYPES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></div><div class="field"><label id="market-alert-unit">Precio</label><input name="value" inputmode="decimal" required placeholder="0,00"></div></div>
      <div class="actions"><button type="button" class="btn secondary" data-close>Cancelar</button><button class="btn primary">Crear alerta</button></div></form>`);
    const form=A.modalRoot.querySelector('#market-alert-form');
    const sync=()=>{const q=M.quotes.get(form.elements.symbol.value);const pct=['up','down'].includes(form.elements.type.value);A.modalRoot.querySelector('#market-alert-unit').textContent=pct?'Porcentaje (%)':`Precio${q?.currency?` (${q.currency})`:''}`;A.modalRoot.querySelector('#market-alert-price').textContent=q?`Ahora: ${M.price(q.price,q.currency)} · ${M.pct(q.changePct)} hoy`:'Cotización todavía no disponible.';if(!pct&&q&&!form.elements.value.value)form.elements.value.placeholder=M.num(q.price);};
    form.elements.symbol.addEventListener('change',sync);form.elements.type.addEventListener('change',sync);sync();
    form.addEventListener('submit',async event=>{event.preventDefault();
      const value=A.parseNumber(form.elements.value.value);if(!(value>0)){A.toast('Indica un valor mayor que cero.',true);return;}
      const alert={id:A.unique('alert'),symbol:form.elements.symbol.value,type:form.elements.type.value,value,active:true,createdAt:Date.now()};
      const q=M.quotes.get(alert.symbol);
      if(q&&M.alertMatches(alert,q)&&!confirm('La condición ya se cumple con el precio actual y la alerta saltará enseguida. ¿Crearla igualmente?'))return;
      M.saveAlerts([...M.alerts(),alert]);A.closeModal();A.toast('Alerta creada.');
      if(M.permission()==='default')await M.requestPermission();
      M.checkAlerts();M.updateViews();
    });
  };
  M.openSettings=()=>{
    const s=M.settings();const permission=M.permission();
    A.ui.modal(`<form id="market-settings-form" class="stack-form"><div class="modal-head"><div><h2>Fuente de datos</h2><p>Se guarda solo en este dispositivo.</p></div><button type="button" class="modal-close" data-close>${A.icon('close',21)}</button></div>
      <div class="field"><label>Proveedor</label><select name="provider"><option value="auto" ${s.provider==='auto'?'selected':''}>Automático (servidor A2C y, si no está, Twelve Data)</option><option value="server" ${s.provider==='server'?'selected':''}>Servidor A2C · Yahoo Finance (todos los mercados)</option><option value="twelve" ${s.provider==='twelve'?'selected':''}>Twelve Data · clave gratuita (EE. UU.)</option></select><small>El servidor A2C es la función <code>a2c-market</code> de tu proyecto de Supabase.</small></div>
      <div class="field"><label>Clave de Twelve Data</label><input name="twelveKey" value="${A.escape(s.twelveKey)}" autocomplete="off" spellcheck="false" placeholder="Opcional"><small>Consíguela gratis en twelvedata.com. Plan gratuito: 8 consultas por minuto.</small></div>
      <div class="form-grid two"><div class="field"><label>Actualizar cada</label><select name="interval">${[1,5,15,30].map(n=>`<option value="${n}" ${Number(s.interval)===n?'selected':''}>${n} min</option>`).join('')}</select></div><div class="field"><label>Estado del servidor</label><button type="button" class="btn secondary" id="market-test">Probar conexión</button></div></div>
      <label class="option-card"><input type="checkbox" name="notify" ${s.notify?'checked':''}><span class="option-icon">${A.icon('bell',18)}</span><span><b>Notificaciones de alertas</b><small>${permission==='granted'?'Permiso concedido.':permission==='native'?'Se usarán las notificaciones de Android.':permission==='denied'?'Bloqueadas en el navegador; se mostrarán dentro de la app.':permission==='unsupported'?'No disponibles en este dispositivo; se mostrarán dentro de la app.':'Se pedirá permiso al guardar.'}</small></span></label>
      <div class="actions"><button type="button" class="btn secondary" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
    const form=A.modalRoot.querySelector('#market-settings-form');
    A.modalRoot.querySelector('#market-test').addEventListener('click',async event=>{const button=event.currentTarget;A.setBusy(button,true,'Probando…');try{await M.server.call({action:'quote',symbols:[]});M.serverOk=true;A.toast('El servidor A2C responde correctamente.');}catch(error){M.serverOk=false;A.toast('El servidor A2C no responde. ¿Has publicado la función a2c-market?',true);}finally{A.setBusy(button,false);}});
    form.addEventListener('submit',async event=>{event.preventDefault();
      const next={provider:form.elements.provider.value,twelveKey:String(form.elements.twelveKey.value||'').trim(),interval:Number(form.elements.interval.value)||5,notify:form.elements.notify.checked};
      M.saveSettings(next);M.serverOk=null;M.error='';M.chartCache.clear();M.quotes.clear();M.lastFetch=0;A.closeModal();M.startTimer();
      if(next.notify&&M.permission()==='default')await M.requestPermission();
      M.updateViews();await M.refresh({force:true});A.toast('Fuente de datos guardada.');
    });
  };

  /* ---------- Acciones ---------- */
  const goInvestment=()=>{A.closeModal();A.state.page='tools';A.state.tool='investment';history.replaceState(null,'','#tools');A.ui.render();window.scrollTo({top:0,behavior:'auto'});};
  A.ui.action('market-open',({data})=>{M.selected=data.symbol;if(A.state.page==='tools'&&A.state.tool==='investment'){const card=document.querySelector('#market-chart-card');if(card){card.innerHTML=M.chartCardMarkup();const list=document.querySelector('#market-list');if(list)list.outerHTML=M.listMarkup();M.drawChart();card.scrollIntoView({behavior:'smooth',block:'start'});return;}}goInvestment();});
  A.ui.action('market-range',({data})=>{M.range=data.range;const card=document.querySelector('#market-chart-card');if(card){card.innerHTML=M.chartCardMarkup();M.drawChart();}});
  A.ui.action('market-type',({data})=>{M.chartType=data.type;const card=document.querySelector('#market-chart-card');if(card){card.innerHTML=M.chartCardMarkup();M.drawChart();}});
  A.ui.action('market-redraw',()=>{M.chartCache.delete(`${M.selected}|${M.range}`);M.drawChart();});
  A.ui.action('market-refresh',async({node})=>{node.classList.add('spinning');await M.refresh({force:true});node.classList.remove('spinning');});
  A.ui.action('market-add',()=>M.openSearch());
  A.ui.action('market-settings',()=>M.openSettings());
  A.ui.action('market-permission',()=>M.requestPermission());
  A.ui.action('market-add-suggestion',({data})=>{M.addSymbol({symbol:data.symbol,name:data.name});if(A.modalRoot.childElementCount)A.closeModal();M.updateViews();});
  A.ui.action('market-add-result',({data,node})=>{if(M.addSymbol({symbol:data.symbol,name:data.name,exchange:data.exchange}))node.replaceWith(Object.assign(document.createElement('span'),{className:'status-pill',textContent:'En tu lista'}));M.updateViews();});
  A.ui.action('market-toggle-home',({data})=>{const list=M.watchlist();const item=list.find(row=>row.symbol===data.symbol);if(!item)return;if(!item.home&&list.filter(row=>row.home).length>=MAX_HOME){A.toast(`Puedes mostrar hasta ${MAX_HOME} valores en Inicio.`,true);return;}item.home=!item.home;M.saveWatchlist(list);A.toast(item.home?`${item.symbol} se mostrará en Inicio.`:`${item.symbol} ya no se muestra en Inicio.`);const card=document.querySelector('#market-chart-card .market-actions');if(card){const button=card.querySelector('[data-action="market-toggle-home"]');if(button)button.innerHTML=`${A.icon('home',15)} ${item.home?'Quitar de Inicio':'Mostrar en Inicio'}`;}const listNode=document.querySelector('#market-list');if(listNode)listNode.outerHTML=M.listMarkup();});
  A.ui.action('market-remove',({data})=>A.ui.confirm({title:`Dejar de seguir ${data.symbol}`,message:'También se eliminarán sus alertas de precio.',confirmLabel:'Dejar de seguir',danger:true,onConfirm:async()=>{M.saveWatchlist(M.watchlist().filter(row=>row.symbol!==data.symbol));M.saveAlerts(M.alerts().filter(row=>row.symbol!==data.symbol));M.quotes.delete(data.symbol);if(M.selected===data.symbol)M.selected=null;const content=document.querySelector('#market-content');if(content){content.innerHTML=M.contentMarkup();if(M.mode==='list')M.drawChart();}M.syncNative();A.toast('Valor eliminado de la lista.');}}));
  A.ui.action('market-new-alert',({data})=>M.openAlertForm(data.symbol||M.selected));
  A.ui.action('market-delete-alert',({data})=>{M.saveAlerts(M.alerts().filter(row=>row.id!==data.id));M.updateViews();});
  A.ui.action('market-rearm-alert',({data})=>{const alerts=M.alerts();const alert=alerts.find(row=>row.id===data.id);if(alert){alert.active=true;delete alert.triggeredAt;M.saveAlerts(alerts);M.checkAlerts();M.updateViews();A.toast('Alerta reactivada.');}});

  /* ---------- Arranque ---------- */
  window.addEventListener('a2c:ready',()=>{M.startTimer();if(M.watchlist().length)M.refresh({force:true});});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&A.state.user&&M.watchlist().length)M.refresh();});
})();

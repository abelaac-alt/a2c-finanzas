(function(){
  'use strict';
  const A=window.A2C=window.A2C||{};
  A.VERSION='8.0.0';
  A.platform=window.A2CNative?'android':'web';
  A.config=window.A2C_CONFIG||{};
  A.root=document.querySelector('#app');
  A.modalRoot=document.querySelector('#modal-root');
  A.toastRoot=document.querySelector('#toast');
  A.state={
    user:null,profile:null,page:'home',tool:'statistics',loading:false,lastLoadedAt:0,
    resources:[],transactions:[],transfers:[],budgets:[],scheduled:[],friends:[],friendships:[],
    conversations:[],notifications:[],shares:[],profiles:[],filters:{query:'',kind:''}
  };

  if(!window.supabase?.createClient)throw new Error('No se pudo cargar Supabase.');
  if(!A.config.SUPABASE_URL||!A.config.SUPABASE_ANON_KEY)throw new Error('Falta la configuración de Supabase.');
  A.sb=window.supabase.createClient(A.config.SUPABASE_URL,A.config.SUPABASE_ANON_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},
    global:{headers:{'x-client-info':'a2c-finanzas-8'}}
  });

  A.escape=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  A.money=cents=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format((Number(cents)||0)/100);
  A.number=(value,digits=2)=>new Intl.NumberFormat('es-ES',{maximumFractionDigits:digits,minimumFractionDigits:0}).format(Number(value)||0);
  A.toCents=value=>{
    let text=String(value??'').trim().replace(/[\s€]/g,'');
    if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');
    const number=Number(text);return Number.isFinite(number)?Math.round(number*100):0;
  };
  A.parseNumber=value=>{
    let text=String(value??'').trim().replace(/[\s€]/g,'');
    if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');
    const number=Number(text);return Number.isFinite(number)?number:0;
  };
  A.today=()=>{
    const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  A.monthKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  A.startOfMonth=(date=new Date())=>`${A.monthKey(date)}-01`;
  A.endOfMonth=(date=new Date())=>{
    const end=new Date(date.getFullYear(),date.getMonth()+1,0);
    return `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
  };
  A.addDays=(iso,days)=>{const d=new Date(`${iso}T12:00:00`);d.setDate(d.getDate()+days);return A.isoDate(d);};
  A.isoDate=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  A.formatDate=iso=>{if(!iso)return '';const d=new Date(`${iso}T12:00:00`);return new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short',year:'numeric'}).format(d);};
  A.initials=profile=>String(profile?.display_name||profile?.username||profile?.email||'?').trim().split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
  A.avatar=profile=>profile?.avatar_path
    ?`<img class="avatar" src="${A.escape(A.sb.storage.from('avatars').getPublicUrl(profile.avatar_path).data.publicUrl)}" alt="">`
    :`<span class="avatar">${A.escape(A.initials(profile))}</span>`;
  A.sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  A.unique=prefix=>`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

  const iconPaths={
    home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    tools:'<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    messages:'<path d="M4 5.5h16v11H9l-5 3v-14Z"/><path d="M8 10h8M8 13h5"/>',
    activity:'<path d="M4 7h10"/><path d="m11 4 3 3-3 3"/><path d="M20 17H10"/><path d="m13 14-3 3 3 3"/>',
    profile:'<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    fuel:'<path d="M5 21V4h10v17"/><path d="M7 7h6v5H7z"/><path d="M15 8h2l2 2v7.5a1.5 1.5 0 0 0 3 0V10l-2-2"/><path d="M3 21h14"/>',
    income:'<path d="M12 19V5"/><path d="m7 10 5-5 5 5"/><path d="M5 21h14"/>',
    expense:'<path d="M12 5v14"/><path d="m7 14 5 5 5-5"/><path d="M5 3h14"/>',
    saving:'<path d="M5 8.5A7 7 0 0 1 18 7"/><path d="M19 7h-4V3"/><path d="M19 15.5A7 7 0 0 1 6 17"/><path d="M5 17h4v4"/><circle cx="12" cy="12" r="2.5"/>',
    investment:'<path d="M4 19 10 13l4 4 6-9"/><path d="M15 8h5v5"/>',
    transfer:'<path d="M4 8h13"/><path d="m14 5 3 3-3 3"/><path d="M20 16H7"/><path d="m10 13-3 3 3 3"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/><path d="M8 14h3M13 14h3M8 17h3"/>',
    budget:'<path d="M4 5h16v14H4z"/><path d="M4 9h16"/><path d="M8 13h3M8 16h6"/>',
    chart:'<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    wallet:'<path d="M4 6.5h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2v-12a2 2 0 0 0 2 2Z"/><path d="M16 11h6v5h-6a2.5 2.5 0 0 1 0-5Z"/><path d="M5 3h11v3.5"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    edit:'<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
    trash:'<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    chevron:'<path d="m9 6 6 6-6 6"/>',
    userAdd:'<path d="M15 20a7 7 0 0 0-14 0"/><circle cx="8" cy="7" r="4"/><path d="M19 8v6M16 11h6"/>',
    send:'<path d="m3 3 18 9-18 9 4-9-4-9Z"/><path d="M7 12h14"/>',
    camera:'<rect x="3" y="6" width="18" height="14" rx="2"/><path d="m8 6 1.5-3h5L16 6"/><circle cx="12" cy="13" r="4"/>',
    folder:'<path d="M3 6h7l2 2h9v11H3z"/>',
    piggy:'<path d="M5 11a7 5 0 0 1 13-2h3v5h-3a7 5 0 0 1-5 3.8V21h-3v-3H7v3H4v-5a5 5 0 0 1 1-5Z"/><circle cx="15.5" cy="10" r=".6" fill="currentColor" stroke="none"/><path d="M8 7.5 7 4l4 2"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    food:'<path d="M4 5h2l2 11h9l2-7H7"/><circle cx="10" cy="20" r="1"/><circle cx="17" cy="20" r="1"/>',
    leisure:'<path d="M4 7h16v10H4z"/><path d="M9 7v3M9 14v3M15 7v3M15 14v3"/>',
    health:'<path d="M12 21S3 16 3 9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 7-9 12-9 12Z"/><path d="M8 12h8M12 8v8"/>',
    subscriptions:'<path d="M6 8a7 7 0 0 1 12-2l2 2"/><path d="M20 4v4h-4"/><path d="M18 16a7 7 0 0 1-12 2l-2-2"/><path d="M4 20v-4h4"/>',
    shopping:'<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    housing:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5M10 20v-6h4v6"/>',
    transport:'<path d="m5 16 1-6h12l1 6"/><path d="M4 16h16v4h-2M6 20H4v-4"/><circle cx="7" cy="17" r="1"/><circle cx="17" cy="17" r="1"/>',
    other:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/>'
  };
  A.icon=(name,size=22,className='')=>`<svg class="app-icon ${A.escape(className)}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]||iconPaths.other}</svg>`;
  A.brandMark=(size=42)=>`<span class="brand-mark" style="--brand-size:${size}px">${A.icon('wallet',Math.round(size*.62))}</span>`;

  A.categoryDefinitions={
    food:{name:'Alimentación',icon:'food',keywords:['mercadona','lidl','aldi','carrefour','supermercado','alimentación','comida']},
    leisure:{name:'Ocio',icon:'leisure',keywords:['cine','hotel','concierto','bar','restaurante','escapada','viaje']},
    health:{name:'Salud',icon:'health',keywords:['médico','medico','farmacia','medicina','pádel','padel','fútbol','futbol']},
    fuel:{name:'Combustible',icon:'fuel',keywords:['gasolina','diésel','diesel','combustible','repsol','cepsa','bp','galp']},
    subscriptions:{name:'Suscripciones',icon:'subscriptions',keywords:['netflix','google','amazon prime','chatgpt','claude','hbo','spotify','disney']},
    shopping:{name:'Compras',icon:'shopping',keywords:['amazon','tienda','compra']},
    housing:{name:'Vivienda',icon:'housing',keywords:['alquiler','hipoteca','luz','agua','gas','internet']},
    transport:{name:'Transporte',icon:'transport',keywords:['uber','cabify','taxi','tren','bus','parking']},
    other:{name:'Otros',icon:'other',keywords:[]}
  };
  A.classify=concept=>{
    const value=String(concept||'').toLowerCase();
    for(const [key,definition] of Object.entries(A.categoryDefinitions)){
      if(definition.keywords.some(word=>value.includes(word)))return key;
    }
    return 'other';
  };
  A.kindMeta={
    income:{label:'Ingreso',icon:'income',tone:'blue'},
    expense:{label:'Gasto',icon:'expense',tone:'black'},
    saving:{label:'Ahorro',icon:'saving',tone:'blue-soft'},
    investment:{label:'Inversión',icon:'investment',tone:'blue-pale'},
    transfer:{label:'Traspaso',icon:'transfer',tone:'neutral'}
  };

  A.toast=(message,error=false)=>{
    const node=A.toastRoot;if(!node)return;node.textContent=String(message||'');node.className=error?'show error':'show';
    clearTimeout(A._toastTimer);A._toastTimer=setTimeout(()=>node.className='',3200);
  };
  A.setBusy=(button,busy=true,label='Guardando…')=>{
    if(!button)return;
    if(busy){if(!button.dataset.label)button.dataset.label=button.textContent;button.textContent=label;button.disabled=true;button.setAttribute('aria-busy','true');}
    else{button.textContent=button.dataset.label||button.textContent;button.disabled=false;button.removeAttribute('aria-busy');}
  };
  A.rpc=async(name,args={})=>{const result=await A.sb.rpc(name,args);if(result.error)throw result.error;return result.data;};
  A.query=async(query,{optional=false}={})=>{try{const result=await query;if(result.error)throw result.error;return result.data??[];}catch(error){if(optional){console.warn(error);return [];}throw error;}};
  A.requireAuth=async()=>{
    let session=(await A.sb.auth.getSession()).data.session;
    if(!session&&window.A2CNative?.getAuthSession){
      try{
        const stored=JSON.parse(window.A2CNative.getAuthSession()||'{}');
        if(stored.access_token&&stored.refresh_token){
          const restored=await A.sb.auth.setSession({access_token:stored.access_token,refresh_token:stored.refresh_token});
          session=restored.data.session;
        }
      }catch(error){console.warn('Sesión nativa no restaurada',error);}
    }
    if(!session)return null;
    if(session.access_token&&session.refresh_token)window.A2CNative?.saveAuthSession?.(session.access_token,session.refresh_token,session.user.id);
    return session;
  };

  A.balance=()=>A.state.transactions.reduce((sum,row)=>sum+(row.kind==='income'?Number(row.amount_cents):-Number(row.amount_cents)),0);
  A.resourceBalance=id=>{
    const transactionTotal=A.state.transactions
      .filter(row=>String(row.resource_id||'')===String(id))
      .reduce((sum,row)=>sum+(row.kind==='income'?Number(row.amount_cents):-Number(row.amount_cents)),0);
    const transferTotal=A.state.transfers.reduce((sum,row)=>{
      if(String(row.source_resource_id||'')===String(id))sum-=Number(row.amount_cents||0);
      if(String(row.target_resource_id||'')===String(id))sum+=Number(row.amount_cents||0);
      return sum;
    },0);
    return transactionTotal+transferTotal;
  };
  A.currentMonthTransactions=()=>A.state.transactions.filter(row=>String(row.occurred_on||'').slice(0,7)===A.monthKey());
  A.monthTotals=()=>A.currentMonthTransactions().reduce((totals,row)=>{totals[row.kind]=(totals[row.kind]||0)+Number(row.amount_cents||0);return totals;},{income:0,expense:0,saving:0,investment:0});
  A.pendingOwed=()=>A.state.shares.filter(row=>row.participant_user_id===A.state.user?.id&&row.status==='pending').reduce((sum,row)=>sum+Number(row.amount_cents||0),0);
  A.pendingReceivable=()=>A.state.shares.filter(row=>row.owner_id===A.state.user?.id&&row.status==='pending').reduce((sum,row)=>sum+Number(row.amount_cents||0),0);
  A.timeline=()=>{
    const tx=A.state.transactions.map(row=>({...row,item_type:'transaction',sort_key:`${row.occurred_on||''}T${row.created_at||'00:00:00'}`}));
    const transfers=A.state.transfers.map(row=>({...row,item_type:'transfer',kind:'transfer',sort_key:`${row.occurred_on||''}T${row.created_at||'00:00:00'}`}));
    return [...tx,...transfers].sort((a,b)=>String(b.sort_key).localeCompare(String(a.sort_key)));
  };
  A.pendingScheduled=()=>A.state.scheduled.filter(row=>row.active&&String(row.next_run||'')>=A.today()).sort((a,b)=>String(a.next_run).localeCompare(String(b.next_run)));

  A.donutSegments=values=>{
    const total=values.reduce((sum,row)=>sum+Math.max(0,Number(row.value)||0),0);
    if(total<=0)return {total:0,segments:[]};
    let angle=-90;
    const point=(degrees,r=42)=>{const radians=degrees*Math.PI/180;return [50+r*Math.cos(radians),50+r*Math.sin(radians)];};
    const segments=values.map(row=>{
      const sweep=Math.max(0,Number(row.value)||0)/total*360;
      const start=point(angle);const end=point(angle+sweep);
      const large=sweep>180?1:0;
      const path=sweep>=359.999
        ?'M 50 8 A 42 42 0 1 1 49.999 8'
        :`M ${start[0].toFixed(3)} ${start[1].toFixed(3)} A 42 42 0 ${large} 1 ${end[0].toFixed(3)} ${end[1].toFixed(3)}`;
      const result={...row,path,sweep};angle+=sweep;return result;
    });
    return {total,segments};
  };

  A.refresh=async({render=true,preserveScroll=true,force=true}={})=>{await A.store.load({force});if(render)A.ui.render({preserveScroll});};
  A.navigate=async page=>{
    if(!['home','tools','messages','activity','profile'].includes(page))page='home';
    if(page===A.state.page){window.scrollTo({top:0,behavior:'auto'});return;}
    A.state.page=page;history.replaceState(null,'',`#${page}`);
    if(page==='messages')await A.messages.load({force:false});
    A.ui.render({preserveScroll:false});
  };
  A.throttle=(fn,delay)=>{let last=0,timer=null;return(...args)=>{const now=Date.now();const remaining=delay-(now-last);if(remaining<=0){last=now;fn(...args);}else{clearTimeout(timer);timer=setTimeout(()=>{last=Date.now();fn(...args);},remaining);}};};
  A.debounce=(fn,delay)=>{let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),delay);};};

  window.addEventListener('error',event=>console.error(event.error||event.message));
  window.addEventListener('unhandledrejection',event=>console.error(event.reason));
})();

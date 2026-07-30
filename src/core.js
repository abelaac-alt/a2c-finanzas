(function(){
  'use strict';
  const A=window.A2C=window.A2C||{};
  A.VERSION='7.0.0';
  A.platform=window.A2CNative?'android':'web';
  A.config=window.A2C_CONFIG||{};
  A.root=document.querySelector('#app');
  A.modalRoot=document.querySelector('#modal-root');
  A.toastRoot=document.querySelector('#toast');
  A.state={
    user:null,profile:null,page:'home',tool:'resources',loading:false,
    resources:[],transactions:[],budgets:[],scheduled:[],friends:[],friendships:[],
    conversations:[],notifications:[],shares:[],profiles:[],filters:{query:'',kind:''}
  };

  if(!window.supabase?.createClient){throw new Error('No se pudo cargar Supabase.');}
  if(!A.config.SUPABASE_URL||!A.config.SUPABASE_ANON_KEY){throw new Error('Falta la configuración de Supabase.');}
  A.sb=window.supabase.createClient(A.config.SUPABASE_URL,A.config.SUPABASE_ANON_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},
    global:{headers:{'x-client-info':'a2c-finanzas-7'}}
  });

  A.escape=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  A.money=cents=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format((Number(cents)||0)/100);
  A.toCents=value=>{
    let text=String(value??'').trim().replace(/[\s€]/g,'');
    if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');
    const number=Number(text);return Number.isFinite(number)?Math.round(number*100):0;
  };
  A.today=()=>{
    const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  A.monthKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  A.initials=profile=>String(profile?.display_name||profile?.username||profile?.email||'?').trim().split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
  A.avatar=profile=>profile?.avatar_path
    ?`<img class="avatar" src="${A.escape(A.sb.storage.from('avatars').getPublicUrl(profile.avatar_path).data.publicUrl)}" alt="">`
    :`<span class="avatar">${A.escape(A.initials(profile))}</span>`;
  A.sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  A.unique=id=>`${id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  A.categoryDefinitions={
    food:{name:'Alimentación',icon:'🛒',keywords:['mercadona','lidl','aldi','carrefour','supermercado','alimentación','comida']},
    leisure:{name:'Ocio',icon:'🎟️',keywords:['cine','hotel','concierto','bar','restaurante','escapada','viaje']},
    health:{name:'Salud',icon:'💊',keywords:['médico','medico','farmacia','medicina','pádel','padel','fútbol','futbol']},
    fuel:{name:'Combustible',icon:'⛽',keywords:['gasolina','diésel','diesel','combustible','repsol','cepsa','bp','galp']},
    subscriptions:{name:'Suscripciones',icon:'🔁',keywords:['netflix','google','amazon prime','chatgpt','claude','hbo','spotify','disney']},
    shopping:{name:'Compras',icon:'🛍️',keywords:['amazon','tienda','compra']},
    housing:{name:'Vivienda',icon:'🏠',keywords:['alquiler','hipoteca','luz','agua','gas','internet']},
    transport:{name:'Transporte',icon:'🚗',keywords:['uber','cabify','taxi','tren','bus','parking']},
    other:{name:'Otros',icon:'🧾',keywords:[]}
  };
  A.classify=concept=>{
    const value=String(concept||'').toLowerCase();
    for(const [key,definition] of Object.entries(A.categoryDefinitions)){
      if(definition.keywords.some(word=>value.includes(word)))return key;
    }
    return 'other';
  };
  A.kindMeta={
    expense:{label:'Gasto',icon:'−',class:'expense'},income:{label:'Ingreso',icon:'+',class:'income'},
    saving:{label:'Ahorro',icon:'◆',class:'saving'},investment:{label:'Inversión',icon:'↗',class:'investment'}
  };
  A.toast=(message,error=false)=>{
    const node=A.toastRoot;node.textContent=String(message||'');node.className=error?'show error':'show';
    clearTimeout(A._toastTimer);A._toastTimer=setTimeout(()=>node.className='',3300);
  };
  A.setBusy=(button,busy=true,label='Guardando…')=>{
    if(!button)return;if(busy){button.dataset.label=button.textContent;button.textContent=label;button.disabled=true;}
    else{button.textContent=button.dataset.label||button.textContent;button.disabled=false;}
  };
  A.modal=(content,wide=false)=>{
    A.modalRoot.innerHTML=`<div class="modal-backdrop"><section class="modal-card ${wide?'wide':''}">${content}</section></div>`;
    A.modalRoot.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',A.closeModal));
    A.modalRoot.querySelector('.modal-backdrop')?.addEventListener('click',event=>{if(event.target===event.currentTarget)A.closeModal();});
  };
  A.closeModal=()=>{A.modalRoot.innerHTML='';};
  A.rpc=async(name,args={})=>{
    const result=await A.sb.rpc(name,args);if(result.error)throw result.error;return result.data;
  };
  A.query=async(promise,optional=false)=>{
    try{const result=await promise;if(result.error)throw result.error;return result.data||[];}
    catch(error){if(optional){console.warn(error);return [];}throw error;}
  };
  A.requireAuth=async()=>{
    let session=(await A.sb.auth.getSession()).data.session;
    if(!session&&window.A2CNative?.getAuthSession){
      try{
        const stored=JSON.parse(window.A2CNative.getAuthSession()||'{}');
        if(stored.access_token&&stored.refresh_token){
          session=(await A.sb.auth.setSession({access_token:stored.access_token,refresh_token:stored.refresh_token})).data.session;
        }
      }catch(error){console.warn('Sesión nativa no restaurada',error);}
    }
    if(!session)return null;
    if(session.access_token&&session.refresh_token){
      window.A2CNative?.saveAuthSession?.(session.access_token,session.refresh_token,session.user.id);
    }
    return session;
  };
  A.balance=()=>A.state.transactions.reduce((sum,row)=>sum+(row.kind==='income'?Number(row.amount_cents):-Number(row.amount_cents)),0);
  A.resourceBalance=id=>A.state.transactions.filter(row=>String(row.resource_id||'')===String(id)).reduce((sum,row)=>sum+(['income','saving','investment'].includes(row.kind)?Number(row.amount_cents):-Number(row.amount_cents)),0);
  A.currentMonthTransactions=()=>A.state.transactions.filter(row=>String(row.occurred_on||'').slice(0,7)===A.monthKey());
  A.monthTotals=()=>A.currentMonthTransactions().reduce((totals,row)=>{totals[row.kind]=(totals[row.kind]||0)+Number(row.amount_cents||0);return totals;},{income:0,expense:0,saving:0,investment:0});
  A.pendingOwed=()=>A.state.shares.filter(row=>row.participant_user_id===A.state.user?.id&&row.status==='pending').reduce((sum,row)=>sum+Number(row.amount_cents||0),0);
  A.pendingReceivable=()=>A.state.shares.filter(row=>row.owner_id===A.state.user?.id&&row.status==='pending').reduce((sum,row)=>sum+Number(row.amount_cents||0),0);
  A.refresh=async(render=true)=>{await A.store.load();if(render)A.ui.render();};
  A.navigate=async page=>{A.state.page=page;history.replaceState(null,'',`#${page}`);if(page==='messages')await A.messages.load();A.ui.render();window.scrollTo({top:0,behavior:'smooth'});};

  window.addEventListener('error',event=>{console.error(event.error||event.message);});
  window.addEventListener('unhandledrejection',event=>{console.error(event.reason);});
  if('serviceWorker' in navigator&&A.platform==='web')window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
})();

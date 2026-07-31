(function(){
  'use strict';
  const A=window.A2C;
  const cache=new Map();
  let loadingPromise=null;
  A.store={
    async load({force=false}={}){
      if(!A.state.user)return;
      if(loadingPromise)return loadingPromise;
      if(!force&&Date.now()-A.state.lastLoadedAt<30000)return;
      loadingPromise=(async()=>{
        A.state.loading=true;
        const userId=A.state.user.id;
        const tasks={
          profile:A.sb.from('profiles').select('*').eq('id',userId).single(),
          resources:A.sb.from('resources').select('*').eq('owner_id',userId).order('created_at',{ascending:false}),
          transactions:A.sb.from('finance_transactions').select('*').eq('creator_id',userId).order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
          transfers:A.sb.from('a2c_resource_transfers_v8').select('*').eq('owner_id',userId).order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
          budgets:A.sb.from('budgets_v67').select('*').eq('user_id',userId).order('period_month',{ascending:false}),
          budgetRules:A.sb.from('a2c_budget_rules_v81').select('*').eq('user_id',userId).order('last_used_at',{ascending:false}),
          scheduled:A.sb.from('scheduled_expenses_v66').select('*').eq('user_id',userId).order('next_run',{ascending:true}),
          friendships:A.sb.from('friendships').select('*').or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).order('created_at',{ascending:false}),
          profiles:A.sb.from('profiles').select('id,username,display_name,avatar_path,email,active').limit(500),
          notifications:A.sb.from('notifications').select('*').eq('user_id',userId).order('created_at',{ascending:false}).limit(100),
          shares:A.sb.from('a2c_shared_expenses_v7').select('*,transaction:finance_transactions(id,concept,amount_cents,occurred_on),owner:profiles!a2c_shared_expenses_v7_owner_id_fkey(id,username,display_name,avatar_path),participant:profiles!a2c_shared_expenses_v7_participant_user_id_fkey(id,username,display_name,avatar_path)').or(`owner_id.eq.${userId},participant_user_id.eq.${userId}`).order('created_at',{ascending:false})
        };
        const entries=Object.entries(tasks);
        const results=await Promise.allSettled(entries.map(([,query])=>query));
        results.forEach((result,index)=>{
          const key=entries[index][0];
          if(result.status==='rejected'||result.value?.error){
            console.warn(`A2C: ${key} no disponible`,result.reason||result.value?.error);
            if(key==='profile')return;
            A.state[key]=[];return;
          }
          const data=result.value.data;
          if(key==='profile')A.state.profile=data||null;else A.state[key]=Array.isArray(data)?data:[];
        });
        try{A.state.friends=await A.rpc('a2c_v7_list_friends');}catch(error){console.warn(error);A.state.friends=[];}
        try{A.state.goals=await A.rpc('a2c_v81_list_goals');}catch(error){console.warn('Objetivos 8.1 no disponibles',error);A.state.goals=[];}
        A.state.lastLoadedAt=Date.now();A.state.loading=false;
        const session=(await A.sb.auth.getSession()).data.session;
        if(session?.access_token&&session?.refresh_token)window.A2CNative?.saveAuthSession?.(session.access_token,session.refresh_token,userId);
        const lastTouch=Number(sessionStorage.getItem('a2c_last_seen_touch')||0);
        if(Date.now()-lastTouch>600000){sessionStorage.setItem('a2c_last_seen_touch',String(Date.now()));(async()=>{try{await A.sb.rpc('a2c_v7_touch_last_seen',{p_device:A.platform});}catch(error){console.warn(error);}})();}
      })().finally(()=>{loadingPromise=null;A.state.loading=false;});
      return loadingPromise;
    },
    async statistics(from,to,{force=false}={}){
      const key=`${from}|${to}`;const cached=cache.get(key);
      if(!force&&cached&&Date.now()-cached.at<120000)return cached.data;
      const data=await A.rpc('a2c_v81_statistics',{p_from:from,p_to:to});cache.set(key,{at:Date.now(),data});return data;
    },
    clearStatistics(){cache.clear();},
    profileById(id){return A.state.profiles.find(row=>String(row.id)===String(id))||null;},
    resourceById(id){return A.state.resources.find(row=>String(row.id)===String(id))||null;},
    transactionById(id){return A.state.transactions.find(row=>String(row.id)===String(id))||null;},
    transferById(id){return A.state.transfers.find(row=>String(row.id)===String(id))||null;},
    budgetById(id){return A.state.budgets.find(row=>String(row.id)===String(id))||null;},
    goalById(id){return A.state.goals.find(row=>String(row.id)===String(id))||null;},
    activeSharesForTransaction(id){return A.state.shares.filter(row=>String(row.transaction_id)===String(id)&&['pending','paid','settled'].includes(row.status));},
    currentShare(id){return A.state.shares.find(row=>String(row.id)===String(id))||null;},
    friendRequests(){return A.state.friendships.filter(row=>row.status==='pending'&&row.addressee_id===A.state.user?.id);}
  };
})();

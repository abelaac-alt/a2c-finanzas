(function(){
  'use strict';
  const A=window.A2C;
  A.store={
    async load(){
      if(!A.state.user)return;
      A.state.loading=true;
      const userId=A.state.user.id;
      const tasks={
        profile:A.sb.from('profiles').select('*').eq('id',userId).single(),
        resources:A.sb.from('resources').select('*').order('created_at',{ascending:false}),
        transactions:A.sb.from('finance_transactions').select('*').order('occurred_on',{ascending:false}).order('created_at',{ascending:false}),
        budgets:A.sb.from('budgets_v67').select('*').eq('user_id',userId).order('period_month',{ascending:false}),
        scheduled:A.sb.from('scheduled_expenses_v66').select('*').eq('user_id',userId).order('next_run',{ascending:true}),
        friendships:A.sb.from('friendships').select('*').or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).order('created_at',{ascending:false}),
        profiles:A.sb.from('profiles').select('id,username,display_name,avatar_path,email,active').limit(500),
        notifications:A.sb.from('notifications').select('*').eq('user_id',userId).order('created_at',{ascending:false}).limit(100),
        shares:A.sb.from('a2c_shared_expenses_v7').select('*,transaction:finance_transactions(id,concept,amount_cents,occurred_on),owner:profiles!a2c_shared_expenses_v7_owner_id_fkey(id,username,display_name,avatar_path),participant:profiles!a2c_shared_expenses_v7_participant_user_id_fkey(id,username,display_name,avatar_path)').or(`owner_id.eq.${userId},participant_user_id.eq.${userId}`).order('created_at',{ascending:false})
      };
      const entries=Object.entries(tasks);
      const results=await Promise.allSettled(entries.map(([,promise])=>promise));
      results.forEach((result,index)=>{
        const key=entries[index][0];
        if(result.status==='rejected'||result.value?.error){
          console.warn(`A2C: ${key} no disponible`,result.reason||result.value?.error);
          if(key==='profile')return;
          A.state[key]=[];return;
        }
        const data=result.value.data;
        if(key==='profile')A.state.profile=data||null;
        else A.state[key]=Array.isArray(data)?data:[];
      });
      try{A.state.friends=await A.rpc('a2c_v7_list_friends');}catch(error){console.warn(error);A.state.friends=[];}
      A.state.loading=false;
      window.A2CNative?.saveAuthSession?.(
        (await A.sb.auth.getSession()).data.session?.access_token||'',
        (await A.sb.auth.getSession()).data.session?.refresh_token||'',
        userId
      );
      A.sb.rpc('a2c_v7_touch_last_seen',{p_device:A.platform}).catch(()=>{});
    },
    profileById(id){return A.state.profiles.find(row=>String(row.id)===String(id))||null;},
    resourceById(id){return A.state.resources.find(row=>String(row.id)===String(id))||null;},
    transactionById(id){return A.state.transactions.find(row=>String(row.id)===String(id))||null;},
    activeSharesForTransaction(id){return A.state.shares.filter(row=>String(row.transaction_id)===String(id)&&['pending','paid','settled'].includes(row.status));},
    currentShare(id){return A.state.shares.find(row=>String(row.id)===String(id))||null;},
    friendRequests(){return A.state.friendships.filter(row=>row.status==='pending'&&row.addressee_id===A.state.user?.id);}
  };
})();

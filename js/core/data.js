import { sb } from './supabase.js';
import { state } from './store.js';
import { isAdmin } from './auth.js';

async function safe(query, fallback=[]){
  const { data, error } = await query;
  if(error){
    console.warn(error.message);
    return fallback;
  }
  return data ?? fallback;
}

export async function loadAll(){
  const requests = [
    safe(sb.from('ledger_transactions').select('*').order('occurred_on',{ascending:false})),
    safe(sb.from('piggy_banks').select('*,piggy_members(*)').order('created_at',{ascending:false})),
    safe(sb.from('piggy_transactions').select('*').order('occurred_on',{ascending:false})),
    safe(sb.from('folders').select('*').order('created_at',{ascending:false})),
    safe(sb.from('goals').select('*').order('created_at',{ascending:false})),
    safe(sb.from('goal_contributions').select('*').order('created_at',{ascending:false})),
    safe(sb.from('notifications').select('*').order('created_at',{ascending:false}))
  ];
  if(isAdmin()) requests.push(safe(sb.from('profiles').select('*').order('email')));
  const result = await Promise.all(requests);
  [state.ledger,state.piggies,state.piggyTx,state.folders,state.goals,state.contributions,state.notifications] = result;
  if(isAdmin()) state.users = result[7] || [];
}

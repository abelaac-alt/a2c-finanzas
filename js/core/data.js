import { sb } from './supabase.js';
import { state } from './store.js';
import { isAdmin } from './auth.js';

async function safe(query, fallback = []) {
  const { data, error } = await query;
  if (error) {
    console.warn(error.message);
    return fallback;
  }
  return data ?? fallback;
}

export async function loadAll() {
  const requests = [
    safe(
      sb.from('ledger_transactions')
        .select('*, folder:folders(id,name)')
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })
    ),
    safe(
      sb.from('piggy_banks')
        .select('*, piggy_members(user_id, profile:profiles(id,email,display_name))')
        .order('created_at', { ascending: false })
    ),
    safe(
      sb.from('piggy_transactions')
        .select('*')
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })
    ),
    safe(sb.from('folders').select('*').order('created_at', { ascending: false })),
    safe(
      sb.from('goals')
        .select('*, goal_members(user_id, profile:profiles(id,email,display_name))')
        .order('created_at', { ascending: false })
    ),
    safe(sb.from('goal_contributions').select('*').order('created_at', { ascending: false })),
    safe(sb.from('notifications').select('*').order('created_at', { ascending: false })),
    safe(sb.from('shared_invitations').select('*').order('created_at', { ascending: false })),
    safe(sb.from('expense_splits').select('*').order('created_at', { ascending: false })),
    safe(
      sb.from('expense_split_members')
        .select('*, profile:profiles(id,email,display_name)')
        .order('created_at', { ascending: true })
    )
  ];

  if (isAdmin()) {
    requests.push(safe(sb.from('profiles').select('*').order('email')));
  }

  const result = await Promise.all(requests);

  [
    state.ledger,
    state.piggies,
    state.piggyTx,
    state.folders,
    state.goals,
    state.contributions,
    state.notifications,
    state.invitations,
    state.expenseSplits,
    state.splitMembers
  ] = result;

  if (isAdmin()) {
    state.users = result[10] || [];
  }
}

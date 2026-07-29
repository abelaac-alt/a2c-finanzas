
-- A2C Finanzas 4.0
-- Bandeja de pagos, reglas, categorías, presupuestos avanzados,
-- notificaciones configurables, colaboración, copias y última conexión.

alter table public.profiles
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_device text;

create table if not exists public.detected_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  source_app text,
  source_package text,
  merchant text not null,
  amount_cents bigint not null check (amount_cents > 0),
  raw_text text,
  payment_time timestamptz not null default now(),
  suggested_category text,
  status text not null default 'pending' check (status in ('pending','registered','discarded')),
  transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,fingerprint)
);

create table if not exists public.smart_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_type text not null default 'contains' check(match_type in ('contains','exact','starts_with','regex')),
  pattern text not null,
  category_key text not null,
  resource_id uuid,
  budget_id uuid,
  priority integer not null default 100,
  confidence numeric(5,2) not null default 100,
  apply_to_history boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,pattern,category_key)
);

create table if not exists public.custom_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_key text not null,
  name text not null,
  icon text not null default '🗂️',
  color text not null default '#7557ff',
  keywords text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id,category_key)
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payment_detected boolean not null default true,
  money_request boolean not null default true,
  shared_movement boolean not null default true,
  budget_50 boolean not null default false,
  budget_75 boolean not null default true,
  budget_90 boolean not null default true,
  budget_100 boolean not null default true,
  scheduled_movement boolean not null default true,
  subscription_charge boolean not null default true,
  goal_completed boolean not null default true,
  low_balance boolean not null default false,
  quiet_from time,
  quiet_to time,
  updated_at timestamptz not null default now()
);

alter table public.budgets_v67
  add column if not exists rollover_enabled boolean not null default false,
  add column if not exists weekly_limit_cents bigint,
  add column if not exists shared_resource_id uuid,
  add column if not exists notify_50 boolean not null default false,
  add column if not exists notify_75 boolean not null default true,
  add column if not exists notify_90 boolean not null default true,
  add column if not exists notify_100 boolean not null default true;

create table if not exists public.shared_movement_comments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 800),
  created_at timestamptz not null default now()
);

create table if not exists public.shared_movement_approvals (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  approver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique(transaction_id,approver_id)
);

create table if not exists public.backup_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check(operation in ('export','import')),
  format text not null,
  row_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.detected_payments enable row level security;
alter table public.smart_rules enable row level security;
alter table public.custom_categories enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.shared_movement_comments enable row level security;
alter table public.shared_movement_approvals enable row level security;
alter table public.backup_history enable row level security;

do $$ begin
  create policy "own detected payments" on public.detected_payments
  for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own smart rules" on public.smart_rules
  for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own custom categories" on public.custom_categories
  for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own notification preferences" on public.notification_preferences
  for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
exception when duplicate_object then null; end $$;
drop policy if exists "shared comments visible" on public.shared_movement_comments;
create policy "shared comments visible" on public.shared_movement_comments
for all
using (
  exists (
    select 1
    from public.finance_transactions t
    where t.id = shared_movement_comments.transaction_id
      and (
        t.creator_id = auth.uid()
        or exists (
          select 1
          from public.resource_members rm
          where rm.resource_id = t.resource_id
            and rm.user_id = auth.uid()
        )
      )
  )
)
with check (
  shared_movement_comments.user_id = auth.uid()
  and exists (
    select 1
    from public.finance_transactions t
    where t.id = shared_movement_comments.transaction_id
      and (
        t.creator_id = auth.uid()
        or exists (
          select 1
          from public.resource_members rm
          where rm.resource_id = t.resource_id
            and rm.user_id = auth.uid()
        )
      )
  )
);
do $$ begin
  create policy "approval participants" on public.shared_movement_approvals
  for all using (requested_by=auth.uid() or approver_id=auth.uid())
  with check (requested_by=auth.uid() or approver_id=auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own backup history" on public.backup_history
  for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
exception when duplicate_object then null; end $$;

create or replace function public.a2c_touch_last_seen(p_device text default null)
returns void language sql security definer set search_path=public as $$
  update public.profiles
  set last_seen_at=now(), last_device=coalesce(nullif(p_device,''),last_device)
  where id=auth.uid();
$$;

create or replace function public.a2c_apply_smart_rule_v40(
  p_transaction_id uuid,
  p_category_key text,
  p_pattern text,
  p_resource_id uuid default null,
  p_budget_id uuid default null,
  p_apply_history boolean default true
) returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();
begin
  insert into public.smart_rules(user_id,pattern,category_key,resource_id,budget_id,apply_to_history)
  values(v_user,lower(trim(p_pattern)),p_category_key,p_resource_id,p_budget_id,p_apply_history)
  on conflict(user_id,pattern,category_key) do update
  set resource_id=excluded.resource_id,budget_id=excluded.budget_id,active=true,updated_at=now();

  update public.finance_transactions
  set budget_category=p_category_key,
      resource_id=coalesce(p_resource_id,resource_id)
  where id=p_transaction_id and creator_id=v_user;

  if p_apply_history then
    update public.finance_transactions
    set budget_category=p_category_key,
        resource_id=coalesce(p_resource_id,resource_id)
    where creator_id=v_user and kind='expense'
      and lower(coalesce(merchant,concept,'')) like '%'||lower(trim(p_pattern))||'%';
  end if;
end $$;

create or replace function public.a2c_budget_rollover_v40(p_budget_id uuid)
returns bigint language plpgsql security definer set search_path=public as $$
declare b record; spent bigint; previous_remaining bigint:=0;
begin
  select * into b from public.budgets_v67 where id=p_budget_id and user_id=auth.uid();
  if not found then raise exception 'Presupuesto no encontrado'; end if;
  if not b.rollover_enabled then return b.amount_cents; end if;
  select greatest(0,coalesce(prev.amount_cents,0)-coalesce(sum(t.amount_cents),0))
  into previous_remaining
  from public.budgets_v67 prev
  left join public.finance_transactions t on t.creator_id=auth.uid()
    and t.kind='expense' and t.budget_category=prev.category_key
    and to_char(t.occurred_on::date,'YYYY-MM')=prev.period_month
  where prev.series_id=b.series_id and prev.period_month<b.period_month
  group by prev.amount_cents,prev.period_month
  order by prev.period_month desc limit 1;
  return b.amount_cents+coalesce(previous_remaining,0);
end $$;

grant execute on function public.a2c_touch_last_seen(text) to authenticated;
grant execute on function public.a2c_apply_smart_rule_v40(uuid,text,text,uuid,uuid,boolean) to authenticated;
grant execute on function public.a2c_budget_rollover_v40(uuid) to authenticated;

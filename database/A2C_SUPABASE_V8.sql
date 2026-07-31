-- A2C Finanzas 8.0
-- Migración limpia para estadísticas profesionales, traspasos entre huchas,
-- movimientos programados y widgets Android.
-- Ejecutar completa en Supabase SQL Editor.

begin;

create extension if not exists pgcrypto with schema extensions;

-- Datos de combustible y clasificación, por compatibilidad con instalaciones anteriores.
alter table public.finance_transactions
  add column if not exists budget_category text,
  add column if not exists fuel_liters numeric,
  add column if not exists fuel_price_per_liter_milli bigint,
  add column if not exists fuel_km numeric,
  add column if not exists fuel_consumption_l100km numeric,
  add column if not exists receipt_path text;

-- Los movimientos programados ahora pueden ser gastos o traspasos internos.
alter table public.scheduled_expenses_v66
  add column if not exists movement_type text not null default 'expense',
  add column if not exists target_resource_id uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.scheduled_expenses_v66
set movement_type='expense'
where movement_type is null or movement_type not in ('expense','transfer');

do $$
begin
  if not exists(select 1 from pg_constraint where conname='scheduled_expenses_v66_movement_type_check') then
    alter table public.scheduled_expenses_v66
      add constraint scheduled_expenses_v66_movement_type_check
      check(movement_type in ('expense','transfer'));
  end if;
  if not exists(select 1 from pg_constraint where conname='scheduled_expenses_v66_target_resource_id_fkey') then
    alter table public.scheduled_expenses_v66
      add constraint scheduled_expenses_v66_target_resource_id_fkey
      foreign key(target_resource_id) references public.resources(id) on delete set null;
  end if;
end $$;

-- Los traspasos internos no alteran el saldo total disponible.
create table if not exists public.a2c_resource_transfers_v8 (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_resource_id uuid not null references public.resources(id) on delete restrict,
  target_resource_id uuid not null references public.resources(id) on delete restrict,
  amount_cents bigint not null check(amount_cents>0),
  concept text not null default 'Traspaso entre huchas',
  occurred_on date not null default current_date,
  scheduled_id uuid references public.scheduled_expenses_v66(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint a2c_resource_transfers_v8_different_resources check(source_resource_id<>target_resource_id)
);

create index if not exists a2c_resource_transfers_v8_owner_date_idx
  on public.a2c_resource_transfers_v8(owner_id,occurred_on desc,created_at desc);

alter table public.a2c_resource_transfers_v8 enable row level security;
drop policy if exists "a2c v8 transfers owner read" on public.a2c_resource_transfers_v8;
drop policy if exists "a2c v8 transfers owner insert" on public.a2c_resource_transfers_v8;
drop policy if exists "a2c v8 transfers owner delete" on public.a2c_resource_transfers_v8;
create policy "a2c v8 transfers owner read" on public.a2c_resource_transfers_v8
  for select using(owner_id=auth.uid());
create policy "a2c v8 transfers owner insert" on public.a2c_resource_transfers_v8
  for insert with check(owner_id=auth.uid());
create policy "a2c v8 transfers owner delete" on public.a2c_resource_transfers_v8
  for delete using(owner_id=auth.uid());

grant select,insert,delete on public.a2c_resource_transfers_v8 to authenticated;

create or replace function public.a2c_v8_create_transfer(
  p_source_resource_id uuid,
  p_target_resource_id uuid,
  p_amount_cents bigint,
  p_concept text default 'Traspaso entre huchas',
  p_occurred_on date default current_date,
  p_scheduled_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_user uuid:=auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  if p_source_resource_id is null or p_target_resource_id is null or p_source_resource_id=p_target_resource_id then
    raise exception 'Selecciona dos huchas diferentes';
  end if;
  if coalesce(p_amount_cents,0)<=0 then raise exception 'Importe no válido'; end if;
  if not exists(select 1 from public.resources where id=p_source_resource_id and owner_id=v_user)
     or not exists(select 1 from public.resources where id=p_target_resource_id and owner_id=v_user) then
    raise exception 'No tienes acceso a una de las huchas';
  end if;

  insert into public.a2c_resource_transfers_v8(
    owner_id,source_resource_id,target_resource_id,amount_cents,concept,occurred_on,scheduled_id
  ) values(
    v_user,p_source_resource_id,p_target_resource_id,p_amount_cents,
    coalesce(nullif(btrim(p_concept),''),'Traspaso entre huchas'),coalesce(p_occurred_on,current_date),p_scheduled_id
  ) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.a2c_v8_create_transfer(uuid,uuid,bigint,text,date,uuid) to authenticated;

-- Clasificación compacta utilizada por los movimientos programados.
create or replace function public.a2c_v8_category_key(p_concept text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_concept,'')) similar to '%(gasolina|diesel|diésel|combustible|repsol|cepsa|galp|bp)%' then 'fuel'
    when lower(coalesce(p_concept,'')) similar to '%(mercadona|lidl|aldi|carrefour|supermercado|alimentación|comida)%' then 'food'
    when lower(coalesce(p_concept,'')) similar to '%(netflix|spotify|hbo|disney|suscripción|suscripcion)%' then 'subscriptions'
    when lower(coalesce(p_concept,'')) similar to '%(alquiler|hipoteca|luz|agua|internet)%' then 'housing'
    when lower(coalesce(p_concept,'')) similar to '%(uber|cabify|taxi|tren|parking)%' then 'transport'
    else 'other' end;
$$;

-- Recrear la función anterior después de definir la utilidad de categoría.
create or replace function public.a2c_v8_run_scheduled(p_scheduled_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_user uuid:=auth.uid();
  v_row public.scheduled_expenses_v66%rowtype;
  v_transaction uuid;
  v_transfer uuid;
  v_next date;
begin
  select * into v_row from public.scheduled_expenses_v66
  where id=p_scheduled_id and user_id=v_user and active=true for update;
  if not found then raise exception 'Movimiento programado no disponible'; end if;

  if coalesce(v_row.movement_type,'expense')='transfer' then
    v_transfer:=public.a2c_v8_create_transfer(v_row.source_resource_id,v_row.target_resource_id,v_row.amount_cents,v_row.concept,current_date,v_row.id);
  else
    insert into public.finance_transactions(
      creator_id,resource_id,kind,category_id,merchant,payment_method,amount_cents,concept,occurred_on,notes,budget_category
    ) values(
      v_user,v_row.source_resource_id,'expense',null,'',coalesce(v_row.payment_method,'bank'),v_row.amount_cents,
      v_row.concept,current_date,'[A2C-SCHEDULED:'||v_row.id||':'||current_date||']',public.a2c_v8_category_key(v_row.concept)
    ) returning id into v_transaction;
  end if;

  v_next:=coalesce(v_row.next_run,current_date);
  loop
    v_next:=case coalesce(v_row.frequency,'monthly')
      when 'daily' then v_next+1
      when 'weekly' then v_next+7
      else (v_next+interval '1 month')::date end;
    exit when v_next>current_date;
  end loop;
  update public.scheduled_expenses_v66 set next_run=v_next,updated_at=now() where id=v_row.id;
  return jsonb_build_object('ok',true,'movement_type',coalesce(v_row.movement_type,'expense'),'transaction_id',v_transaction,'transfer_id',v_transfer,'next_run',v_next);
end;
$$;

grant execute on function public.a2c_v8_run_scheduled(uuid) to authenticated;

create or replace function public.a2c_v8_statistics(p_from date,p_to date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_from date:=coalesce(p_from,date_trunc('month',current_date)::date);
  v_to date:=coalesce(p_to,current_date);
  v_days integer;
  v_prev_from date;
  v_prev_to date;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  if v_from>v_to then raise exception 'Intervalo de fechas no válido'; end if;
  if v_to-v_from>1460 then raise exception 'El intervalo máximo es de cuatro años'; end if;
  v_days:=greatest(1,v_to-v_from+1);
  v_prev_to:=v_from-1;
  v_prev_from:=v_prev_to-v_days+1;

  with current_tx as (
    select * from public.finance_transactions
    where creator_id=v_user and occurred_on between v_from and v_to
  ), previous_tx as (
    select * from public.finance_transactions
    where creator_id=v_user and occurred_on between v_prev_from and v_prev_to
  ), current_totals as (
    select
      coalesce(sum(amount_cents) filter(where kind='income'),0)::bigint income_cents,
      coalesce(sum(amount_cents) filter(where kind='expense'),0)::bigint expense_cents,
      coalesce(sum(amount_cents) filter(where kind='saving'),0)::bigint saving_cents,
      coalesce(sum(amount_cents) filter(where kind='investment'),0)::bigint investment_cents,
      count(*)::bigint transaction_count,
      coalesce(max(amount_cents) filter(where kind='expense'),0)::bigint largest_expense_cents
    from current_tx
  ), previous_totals as (
    select
      coalesce(sum(amount_cents) filter(where kind='income'),0)::numeric income_cents,
      coalesce(sum(amount_cents) filter(where kind='expense'),0)::numeric expense_cents,
      coalesce(sum(amount_cents) filter(where kind='saving'),0)::numeric saving_cents,
      coalesce(sum(amount_cents) filter(where kind='investment'),0)::numeric investment_cents
    from previous_tx
  )
  select jsonb_build_object(
    'range',jsonb_build_object('from',v_from,'to',v_to,'days',v_days),
    'totals',(
      select jsonb_build_object(
        'income_cents',c.income_cents,'expense_cents',c.expense_cents,
        'saving_cents',c.saving_cents,'investment_cents',c.investment_cents,
        'net_available_cents',c.income_cents-c.expense_cents-c.saving_cents-c.investment_cents,
        'transaction_count',c.transaction_count,
        'average_daily_expense_cents',round(c.expense_cents::numeric/v_days)::bigint,
        'largest_expense_cents',c.largest_expense_cents,
        'transfer_count',(select count(*) from public.a2c_resource_transfers_v8 where owner_id=v_user and occurred_on between v_from and v_to),
        'transfer_cents',coalesce((select sum(amount_cents) from public.a2c_resource_transfers_v8 where owner_id=v_user and occurred_on between v_from and v_to),0)
      ) from current_totals c
    ),
    'comparison',(
      select jsonb_build_object(
        'income_change_pct',case when p.income_cents=0 then case when c.income_cents=0 then 0 else 100 end else round((c.income_cents-p.income_cents)*100.0/p.income_cents,1) end,
        'expense_change_pct',case when p.expense_cents=0 then case when c.expense_cents=0 then 0 else 100 end else round((c.expense_cents-p.expense_cents)*100.0/p.expense_cents,1) end,
        'net_change_pct',case when (p.income_cents-p.expense_cents-p.saving_cents-p.investment_cents)=0 then 0 else round(((c.income_cents-c.expense_cents-c.saving_cents-c.investment_cents)-(p.income_cents-p.expense_cents-p.saving_cents-p.investment_cents))*100.0/abs(p.income_cents-p.expense_cents-p.saving_cents-p.investment_cents),1) end
      ) from current_totals c cross join previous_totals p
    ),
    'monthly',coalesce((
      select jsonb_agg(jsonb_build_object(
        'month',to_char(m.month_start,'YYYY-MM'),'label',to_char(m.month_start,'MM/YY'),
        'income_cents',coalesce(x.income_cents,0),'expense_cents',coalesce(x.expense_cents,0),
        'saving_cents',coalesce(x.saving_cents,0),'investment_cents',coalesce(x.investment_cents,0)
      ) order by m.month_start)
      from (select generate_series(date_trunc('month',v_from)::date,date_trunc('month',v_to)::date,interval '1 month')::date month_start) m
      left join (
        select date_trunc('month',occurred_on)::date month_start,
          sum(amount_cents) filter(where kind='income')::bigint income_cents,
          sum(amount_cents) filter(where kind='expense')::bigint expense_cents,
          sum(amount_cents) filter(where kind='saving')::bigint saving_cents,
          sum(amount_cents) filter(where kind='investment')::bigint investment_cents
        from current_tx group by 1
      ) x using(month_start)
    ),'[]'::jsonb),
    'categories',coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_key',category_key,'amount_cents',amount_cents,'count',movement_count,
        'percentage',case when total_expense=0 then 0 else round(amount_cents*100.0/total_expense,1) end
      ) order by amount_cents desc)
      from (
        select coalesce(nullif(budget_category,''),'other') category_key,sum(amount_cents)::bigint amount_cents,count(*)::bigint movement_count,
          sum(sum(amount_cents)) over()::numeric total_expense
        from current_tx where kind='expense' group by 1
      ) q
    ),'[]'::jsonb),
    'top_expenses',coalesce((
      select jsonb_agg(jsonb_build_object('id',id,'concept',coalesce(concept,merchant,'Gasto'),'amount_cents',amount_cents,'occurred_on',occurred_on) order by amount_cents desc)
      from (select id,concept,merchant,amount_cents,occurred_on from current_tx where kind='expense' order by amount_cents desc limit 8) q
    ),'[]'::jsonb),
    'fuel',jsonb_build_object(
      'refuels',(select count(*) from current_tx where kind='expense' and fuel_liters is not null),
      'total_cents',coalesce((select sum(amount_cents) from current_tx where kind='expense' and fuel_liters is not null),0),
      'liters',coalesce((select sum(fuel_liters) from current_tx where kind='expense' and fuel_liters is not null),0),
      'average_price_milli',coalesce((select round(sum(amount_cents)*10.0/nullif(sum(fuel_liters),0))::bigint from current_tx where kind='expense' and fuel_liters is not null),0),
      'average_consumption_l100km',coalesce((select round(avg(fuel_consumption_l100km),2) from current_tx where fuel_consumption_l100km is not null),0),
      'total_km',coalesce((select sum(fuel_km) from current_tx where fuel_km is not null),0),
      'min_price_milli',coalesce((select min(fuel_price_per_liter_milli) from current_tx where fuel_price_per_liter_milli is not null),0),
      'max_price_milli',coalesce((select max(fuel_price_per_liter_milli) from current_tx where fuel_price_per_liter_milli is not null),0)
    ),
    'fuel_series',coalesce((
      select jsonb_agg(jsonb_build_object(
        'month',to_char(month_start,'YYYY-MM'),'label',to_char(month_start,'MM/YY'),
        'refuels',refuels,'total_cents',total_cents,'liters',liters,'average_price_milli',average_price_milli
      ) order by month_start)
      from (
        select date_trunc('month',occurred_on)::date month_start,count(*)::bigint refuels,
          sum(amount_cents)::bigint total_cents,sum(fuel_liters) liters,
          round(sum(amount_cents)*10.0/nullif(sum(fuel_liters),0))::bigint average_price_milli
        from current_tx where kind='expense' and fuel_liters is not null group by 1
      ) q
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

grant execute on function public.a2c_v8_statistics(date,date) to authenticated;

create or replace function public.a2c_widget_snapshot_v8()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_month text:=to_char(current_date,'YYYY-MM');
  v_result jsonb;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  select jsonb_build_object(
    'available_cents',coalesce((select sum(case when kind='income' then amount_cents else -amount_cents end) from public.finance_transactions where creator_id=v_user),0),
    'month_income_cents',coalesce((select sum(amount_cents) from public.finance_transactions where creator_id=v_user and kind='income' and to_char(occurred_on,'YYYY-MM')=v_month),0),
    'month_expenses_cents',coalesce((select sum(amount_cents) from public.finance_transactions where creator_id=v_user and kind='expense' and to_char(occurred_on,'YYYY-MM')=v_month),0),
    'month_saving_cents',coalesce((select sum(amount_cents) from public.finance_transactions where creator_id=v_user and kind='saving' and to_char(occurred_on,'YYYY-MM')=v_month),0),
    'month_investment_cents',coalesce((select sum(amount_cents) from public.finance_transactions where creator_id=v_user and kind='investment' and to_char(occurred_on,'YYYY-MM')=v_month),0),
    'debts_owed_cents',coalesce((select sum(amount_cents) from public.a2c_shared_expenses_v7 where participant_user_id=v_user and status='pending'),0),
    'debts_receivable_cents',coalesce((select sum(amount_cents) from public.a2c_shared_expenses_v7 where owner_id=v_user and status='pending'),0),
    'latest_expense',(select coalesce(jsonb_build_object('concept',coalesce(concept,merchant,'Gasto'),'amount_cents',amount_cents,'date',occurred_on),'{}'::jsonb) from public.finance_transactions where creator_id=v_user and kind='expense' order by occurred_on desc,created_at desc limit 1),
    'scheduled',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'movement_type',coalesce(s.movement_type,'expense'),'concept',s.concept,
      'amount_cents',s.amount_cents,'next_run',s.next_run,
      'source_name',(select name from public.resources where id=s.source_resource_id),
      'target_name',(select name from public.resources where id=s.target_resource_id)
    ) order by s.next_run) from (select * from public.scheduled_expenses_v66 where user_id=v_user and active=true and next_run>=current_date order by next_run limit 5) s),'[]'::jsonb),
    'budgets',coalesce((select jsonb_agg(jsonb_build_object(
      'name',b.name,'amount_cents',b.amount_cents,
      'spent_cents',coalesce((select sum(t.amount_cents) from public.finance_transactions t where t.creator_id=v_user and t.kind='expense' and t.budget_category=b.category_key and to_char(t.occurred_on,'YYYY-MM')=b.period_month),0)
    )) from public.budgets_v67 b where b.user_id=v_user and b.active=true and b.period_month=v_month),'[]'::jsonb),
    'fuel_30d',jsonb_build_object(
      'liters',coalesce((select sum(fuel_liters) from public.finance_transactions where creator_id=v_user and kind='expense' and fuel_liters is not null and occurred_on>=current_date-29),0),
      'total_cents',coalesce((select sum(amount_cents) from public.finance_transactions where creator_id=v_user and kind='expense' and fuel_liters is not null and occurred_on>=current_date-29),0),
      'average_milli',coalesce((select round(sum(amount_cents)*10.0/nullif(sum(fuel_liters),0))::bigint from public.finance_transactions where creator_id=v_user and kind='expense' and fuel_liters is not null and occurred_on>=current_date-29),0)
    )
  ) into v_result;
  return v_result;
end;
$$;

grant execute on function public.a2c_widget_snapshot_v8() to authenticated;

commit;

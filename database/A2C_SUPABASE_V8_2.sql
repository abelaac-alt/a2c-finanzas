-- A2C Finanzas 8.2
-- Huchas compartidas, movimientos editables, ahorro y liquidez.
-- Ejecutar después de A2C_SUPABASE_V8.sql y A2C_SUPABASE_V8_1.sql.

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.resources
  add column if not exists piggy_mode text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

update public.resources set piggy_mode='saving' where type='piggy' and piggy_mode is null;
update public.resources set piggy_mode='liquidity' where type<>'piggy' and piggy_mode is null;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='resources_piggy_mode_v82_check') then
    alter table public.resources add constraint resources_piggy_mode_v82_check
      check((type='piggy' and piggy_mode in ('saving','liquidity')) or type<>'piggy');
  end if;
end $$;

create table if not exists public.a2c_resource_members_v82(
  resource_id uuid not null references public.resources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check(role in ('owner','member')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(resource_id,user_id)
);

insert into public.a2c_resource_members_v82(resource_id,user_id,role,invited_by)
select id,owner_id,'owner',owner_id from public.resources
on conflict(resource_id,user_id) do update set role='owner';

create or replace function public.a2c_v82_is_resource_owner(p_resource_id uuid,p_user_id uuid default auth.uid())
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.resources r where r.id=p_resource_id and r.owner_id=p_user_id and r.archived_at is null)
$$;

create or replace function public.a2c_v82_is_resource_member(p_resource_id uuid,p_user_id uuid default auth.uid())
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.a2c_resource_members_v82 m join public.resources r on r.id=m.resource_id where m.resource_id=p_resource_id and m.user_id=p_user_id and r.archived_at is null)
$$;

grant execute on function public.a2c_v82_is_resource_owner(uuid,uuid) to authenticated;
grant execute on function public.a2c_v82_is_resource_member(uuid,uuid) to authenticated;

alter table public.resources enable row level security;
alter table public.a2c_resource_members_v82 enable row level security;

drop policy if exists "a2c v82 resources members read" on public.resources;
create policy "a2c v82 resources members read" on public.resources for select
using(owner_id=auth.uid() or public.a2c_v82_is_resource_member(id,auth.uid()));

drop policy if exists "a2c v82 members read" on public.a2c_resource_members_v82;
create policy "a2c v82 members read" on public.a2c_resource_members_v82 for select
using(user_id=auth.uid() or public.a2c_v82_is_resource_owner(resource_id,auth.uid()));

grant select on public.a2c_resource_members_v82 to authenticated;

-- Los miembros pueden leer los movimientos de la hucha. Solo el creador puede editarlos o borrarlos.
alter table public.finance_transactions enable row level security;
drop policy if exists "a2c v82 shared resource transactions read" on public.finance_transactions;
create policy "a2c v82 shared resource transactions read" on public.finance_transactions for select
using(creator_id=auth.uid() or (resource_id is not null and public.a2c_v82_is_resource_member(resource_id,auth.uid())));
drop policy if exists "a2c v82 resource transaction insert" on public.finance_transactions;
create policy "a2c v82 resource transaction insert" on public.finance_transactions for insert
with check(creator_id=auth.uid() and (resource_id is null or public.a2c_v82_is_resource_member(resource_id,auth.uid())));
drop policy if exists "a2c v82 own transaction update" on public.finance_transactions;
create policy "a2c v82 own transaction update" on public.finance_transactions for update
using(creator_id=auth.uid()) with check(creator_id=auth.uid() and (resource_id is null or public.a2c_v82_is_resource_member(resource_id,auth.uid())));
drop policy if exists "a2c v82 own transaction delete" on public.finance_transactions;
create policy "a2c v82 own transaction delete" on public.finance_transactions for delete
using(creator_id=auth.uid());

grant select,insert,update,delete on public.finance_transactions to authenticated;

create table if not exists public.a2c_resource_transfers_v82(
  id uuid primary key default extensions.gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  source_resource_id uuid references public.resources(id) on delete restrict,
  target_resource_id uuid references public.resources(id) on delete restrict,
  amount_cents bigint not null check(amount_cents>0),
  concept text not null default 'Movimiento de hucha',
  occurred_on date not null default current_date,
  scheduled_id uuid references public.scheduled_expenses_v66(id) on delete set null,
  legacy_transfer_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint a2c_resource_transfers_v82_endpoint_check check(source_resource_id is not null or target_resource_id is not null),
  constraint a2c_resource_transfers_v82_different_check check(source_resource_id is distinct from target_resource_id)
);

create index if not exists a2c_resource_transfers_v82_creator_date_idx on public.a2c_resource_transfers_v82(created_by,occurred_on desc,created_at desc);
create index if not exists a2c_resource_transfers_v82_source_idx on public.a2c_resource_transfers_v82(source_resource_id,occurred_on desc);
create index if not exists a2c_resource_transfers_v82_target_idx on public.a2c_resource_transfers_v82(target_resource_id,occurred_on desc);

do $$
begin
  if to_regclass('public.a2c_resource_transfers_v8') is not null then
    insert into public.a2c_resource_transfers_v82(created_by,source_resource_id,target_resource_id,amount_cents,concept,occurred_on,scheduled_id,legacy_transfer_id,created_at,updated_at)
    select owner_id,source_resource_id,target_resource_id,amount_cents,concept,occurred_on,scheduled_id,id,created_at,created_at
    from public.a2c_resource_transfers_v8
    on conflict(legacy_transfer_id) do nothing;
  end if;
end $$;

alter table public.a2c_resource_transfers_v82 enable row level security;
drop policy if exists "a2c v82 transfers members read" on public.a2c_resource_transfers_v82;
create policy "a2c v82 transfers members read" on public.a2c_resource_transfers_v82 for select
using(created_by=auth.uid() or (source_resource_id is not null and public.a2c_v82_is_resource_member(source_resource_id,auth.uid())) or (target_resource_id is not null and public.a2c_v82_is_resource_member(target_resource_id,auth.uid())));

grant select on public.a2c_resource_transfers_v82 to authenticated;
revoke insert,update,delete on public.a2c_resource_transfers_v82 from authenticated;

create or replace function public.a2c_v82_resource_balance(p_resource_id uuid,p_exclude_transfer uuid default null)
returns bigint language sql security definer stable set search_path=public as $$
  select
    coalesce((select sum(case when t.kind in ('income','saving') then t.amount_cents else -t.amount_cents end) from public.finance_transactions t where t.resource_id=p_resource_id),0)::bigint
    +coalesce((select sum(case when x.target_resource_id=p_resource_id then x.amount_cents else -x.amount_cents end) from public.a2c_resource_transfers_v82 x where (x.source_resource_id=p_resource_id or x.target_resource_id=p_resource_id) and (p_exclude_transfer is null or x.id<>p_exclude_transfer)),0)::bigint
$$;

create or replace function public.a2c_v82_available_balance(p_user_id uuid default auth.uid(),p_exclude_transfer uuid default null)
returns bigint language sql security definer stable set search_path=public as $$
  select
    coalesce((select sum(case when t.resource_id is not null and t.kind='saving' then -t.amount_cents when t.kind='income' then t.amount_cents else -t.amount_cents end) from public.finance_transactions t where t.creator_id=p_user_id and (t.resource_id is null or t.kind='saving')),0)::bigint
    +coalesce((select sum(case when x.target_resource_id is null then x.amount_cents else -x.amount_cents end) from public.a2c_resource_transfers_v82 x where x.created_by=p_user_id and (x.source_resource_id is null or x.target_resource_id is null) and (p_exclude_transfer is null or x.id<>p_exclude_transfer)),0)::bigint
    -coalesce((select sum(case when e.entry_type='contribution' then e.amount_cents else -e.amount_cents end) from public.a2c_goal_entries_v81 e where e.user_id=p_user_id),0)::bigint
$$;

grant execute on function public.a2c_v82_resource_balance(uuid,uuid) to authenticated;
grant execute on function public.a2c_v82_available_balance(uuid,uuid) to authenticated;

create or replace function public.a2c_v82_save_resource(p_resource_id uuid,p_type text,p_name text,p_description text,p_piggy_mode text,p_member_ids uuid[] default array[]::uuid[])
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_id uuid;v_member uuid;v_mode text;v_type text;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  v_type:=case when p_type='folder' then 'folder' else 'piggy' end;
  v_mode:=case when p_piggy_mode='liquidity' then 'liquidity' else 'saving' end;
  if nullif(btrim(coalesce(p_name,'')),'') is null then raise exception 'Indica un nombre'; end if;
  if p_resource_id is null then
    insert into public.resources(owner_id,type,name,description,target_cents,target_date,is_shared,piggy_mode,updated_at)
    values(v_user,v_type,btrim(p_name),coalesce(btrim(p_description),''),null,null,coalesce(cardinality(p_member_ids),0)>0,case when v_type='piggy' then v_mode else 'liquidity' end,now()) returning id into v_id;
  else
    if not public.a2c_v82_is_resource_owner(p_resource_id,v_user) then raise exception 'Solo el propietario puede editar esta hucha'; end if;
    update public.resources set type=v_type,name=btrim(p_name),description=coalesce(btrim(p_description),''),piggy_mode=case when v_type='piggy' then v_mode else 'liquidity' end,is_shared=coalesce(cardinality(p_member_ids),0)>0,updated_at=now() where id=p_resource_id returning id into v_id;
  end if;
  insert into public.a2c_resource_members_v82(resource_id,user_id,role,invited_by) values(v_id,v_user,'owner',v_user) on conflict(resource_id,user_id) do update set role='owner';
  delete from public.a2c_resource_members_v82 where resource_id=v_id and role='member' and not(user_id=any(coalesce(p_member_ids,array[]::uuid[])));
  foreach v_member in array coalesce(p_member_ids,array[]::uuid[]) loop
    if v_member=v_user then continue; end if;
    if not exists(select 1 from public.friendships f where f.status='accepted' and ((f.requester_id=v_user and f.addressee_id=v_member) or (f.addressee_id=v_user and f.requester_id=v_member))) then raise exception 'Solo puedes compartir una hucha con amigos aceptados'; end if;
    insert into public.a2c_resource_members_v82(resource_id,user_id,role,invited_by) values(v_id,v_member,'member',v_user) on conflict(resource_id,user_id) do update set role='member',invited_by=v_user;
  end loop;
  return v_id;
end $$;

grant execute on function public.a2c_v82_save_resource(uuid,text,text,text,text,uuid[]) to authenticated;

create or replace function public.a2c_v82_list_resource_members()
returns table(resource_id uuid,user_id uuid,role text,username text,display_name text,avatar_path text)
language sql security definer stable set search_path=public as $$
  select m.resource_id,m.user_id,m.role,p.username,p.display_name,p.avatar_path
  from public.a2c_resource_members_v82 m join public.profiles p on p.id=m.user_id
  where public.a2c_v82_is_resource_member(m.resource_id,auth.uid())
  order by m.resource_id,case when m.role='owner' then 0 else 1 end,lower(coalesce(p.display_name,p.username))
$$;
grant execute on function public.a2c_v82_list_resource_members() to authenticated;

create or replace function public.a2c_v82_create_transfer(p_source_resource_id uuid,p_target_resource_id uuid,p_amount_cents bigint,p_concept text default 'Movimiento de hucha',p_occurred_on date default current_date)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_user uuid:=auth.uid();v_id uuid;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  if p_source_resource_id is null and p_target_resource_id is null then raise exception 'Selecciona una cuenta o hucha'; end if;
  if p_source_resource_id is not distinct from p_target_resource_id then raise exception 'El origen y destino deben ser diferentes'; end if;
  if coalesce(p_amount_cents,0)<=0 then raise exception 'Importe no válido'; end if;
  if p_source_resource_id is not null and not public.a2c_v82_is_resource_member(p_source_resource_id,v_user) then raise exception 'No tienes acceso a la hucha de origen'; end if;
  if p_target_resource_id is not null and not public.a2c_v82_is_resource_member(p_target_resource_id,v_user) then raise exception 'No tienes acceso a la hucha de destino'; end if;
  if p_source_resource_id is null and public.a2c_v82_available_balance(v_user,null)<p_amount_cents then raise exception 'Saldo disponible insuficiente'; end if;
  if p_source_resource_id is not null and public.a2c_v82_resource_balance(p_source_resource_id,null)<p_amount_cents then raise exception 'La hucha no tiene saldo suficiente'; end if;
  insert into public.a2c_resource_transfers_v82(created_by,source_resource_id,target_resource_id,amount_cents,concept,occurred_on)
  values(v_user,p_source_resource_id,p_target_resource_id,p_amount_cents,coalesce(nullif(btrim(p_concept),''),'Movimiento de hucha'),coalesce(p_occurred_on,current_date)) returning id into v_id;
  return v_id;
end $$;

grant execute on function public.a2c_v82_create_transfer(uuid,uuid,bigint,text,date) to authenticated;

create or replace function public.a2c_v82_update_transfer(p_transfer_id uuid,p_source_resource_id uuid,p_target_resource_id uuid,p_amount_cents bigint,p_concept text,p_occurred_on date)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_row public.a2c_resource_transfers_v82%rowtype;
begin
  select * into v_row from public.a2c_resource_transfers_v82 where id=p_transfer_id;
  if not found or v_row.created_by<>v_user then raise exception 'Solo puede editarlo quien lo registró'; end if;
  if p_source_resource_id is null and p_target_resource_id is null then raise exception 'Selecciona una cuenta o hucha'; end if;
  if p_source_resource_id is not distinct from p_target_resource_id then raise exception 'El origen y destino deben ser diferentes'; end if;
  if coalesce(p_amount_cents,0)<=0 then raise exception 'Importe no válido'; end if;
  if p_source_resource_id is not null and not public.a2c_v82_is_resource_member(p_source_resource_id,v_user) then raise exception 'No tienes acceso a la hucha de origen'; end if;
  if p_target_resource_id is not null and not public.a2c_v82_is_resource_member(p_target_resource_id,v_user) then raise exception 'No tienes acceso a la hucha de destino'; end if;
  if p_source_resource_id is null and public.a2c_v82_available_balance(v_user,p_transfer_id)<p_amount_cents then raise exception 'Saldo disponible insuficiente'; end if;
  if p_source_resource_id is not null and public.a2c_v82_resource_balance(p_source_resource_id,p_transfer_id)<p_amount_cents then raise exception 'La hucha no tiene saldo suficiente'; end if;
  update public.a2c_resource_transfers_v82 set source_resource_id=p_source_resource_id,target_resource_id=p_target_resource_id,amount_cents=p_amount_cents,concept=coalesce(nullif(btrim(p_concept),''),'Movimiento de hucha'),occurred_on=coalesce(p_occurred_on,current_date),updated_at=now() where id=p_transfer_id;
  return p_transfer_id;
end $$;
grant execute on function public.a2c_v82_update_transfer(uuid,uuid,uuid,bigint,text,date) to authenticated;

create or replace function public.a2c_v82_delete_transfer(p_transfer_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  delete from public.a2c_resource_transfers_v82 where id=p_transfer_id and created_by=auth.uid();
  if not found then raise exception 'Solo puede eliminarlo quien lo registró'; end if;
  return true;
end $$;
grant execute on function public.a2c_v82_delete_transfer(uuid) to authenticated;


create or replace function public.a2c_v82_pay_shared_expense(p_share_id uuid,p_resource_id uuid default null,p_payment_method text default 'bank')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_amount bigint;
begin
  select amount_cents into v_amount from public.a2c_shared_expenses_v7 where id=p_share_id and participant_user_id=v_user and status='pending';
  if not found then raise exception 'Pago no disponible'; end if;
  if p_resource_id is null then
    if public.a2c_v82_available_balance(v_user,null)<v_amount then raise exception 'Saldo disponible insuficiente'; end if;
  else
    if not public.a2c_v82_is_resource_member(p_resource_id,v_user) then raise exception 'No tienes acceso a esta hucha'; end if;
    if public.a2c_v82_resource_balance(p_resource_id,null)<v_amount then raise exception 'La hucha no tiene saldo suficiente'; end if;
  end if;
  return public.a2c_v7_pay_shared_expense(p_share_id,p_resource_id,p_payment_method);
end $$;
grant execute on function public.a2c_v82_pay_shared_expense(uuid,uuid,text) to authenticated;

create or replace function public.a2c_v82_delete_resource(p_resource_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public.a2c_v82_is_resource_owner(p_resource_id,auth.uid()) then raise exception 'Solo el propietario puede eliminar esta hucha'; end if;
  if public.a2c_v82_resource_balance(p_resource_id,null)<>0 then raise exception 'Vacía la hucha antes de eliminarla'; end if;
  update public.resources set archived_at=now(),is_shared=false,updated_at=now() where id=p_resource_id;
  delete from public.a2c_resource_members_v82 where resource_id=p_resource_id and user_id<>auth.uid();
  return true;
end $$;
grant execute on function public.a2c_v82_delete_resource(uuid) to authenticated;

-- Mantiene compatibles los movimientos programados entre huchas.
create or replace function public.a2c_v8_create_transfer(p_source_resource_id uuid,p_target_resource_id uuid,p_amount_cents bigint,p_concept text default 'Traspaso entre huchas',p_occurred_on date default current_date,p_scheduled_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  v_id:=public.a2c_v82_create_transfer(p_source_resource_id,p_target_resource_id,p_amount_cents,p_concept,p_occurred_on);
  update public.a2c_resource_transfers_v82 set scheduled_id=p_scheduled_id where id=v_id;
  return v_id;
end $$;
grant execute on function public.a2c_v8_create_transfer(uuid,uuid,bigint,text,date,uuid) to authenticated;

create or replace function public.a2c_v82_mode_balance(p_user uuid,p_mode text)
returns bigint language sql security definer stable set search_path=public as $$
  select coalesce(sum(public.a2c_v82_resource_balance(r.id,null)),0)::bigint
  from public.resources r
  where r.type='piggy' and r.piggy_mode=p_mode and r.archived_at is null and public.a2c_v82_is_resource_member(r.id,p_user)
$$;

create or replace function public.a2c_v82_saving_flow(p_user uuid,p_from date,p_to date)
returns bigint language sql security definer stable set search_path=public as $$
  select coalesce(sum(case
    when tr.piggy_mode='saving' and coalesce(sr.piggy_mode,'')<>'saving' then x.amount_cents
    when sr.piggy_mode='saving' and coalesce(tr.piggy_mode,'')<>'saving' then -x.amount_cents
    else 0 end),0)::bigint
  from public.a2c_resource_transfers_v82 x
  left join public.resources sr on sr.id=x.source_resource_id
  left join public.resources tr on tr.id=x.target_resource_id
  where x.created_by=p_user and x.occurred_on between p_from and p_to
$$;

create or replace function public.a2c_v82_available_flow(p_user uuid,p_from date,p_to date)
returns bigint language sql security definer stable set search_path=public as $$
  select
    coalesce((select sum(case when t.resource_id is not null and t.kind='saving' then -t.amount_cents when t.kind='income' then t.amount_cents else -t.amount_cents end) from public.finance_transactions t where t.creator_id=p_user and (t.resource_id is null or t.kind='saving') and t.occurred_on between p_from and p_to),0)::bigint
    +coalesce((select sum(case when x.target_resource_id is null then x.amount_cents else -x.amount_cents end) from public.a2c_resource_transfers_v82 x where x.created_by=p_user and (x.source_resource_id is null or x.target_resource_id is null) and x.occurred_on between p_from and p_to),0)::bigint
    -coalesce((select sum(case when e.entry_type='contribution' then e.amount_cents else -e.amount_cents end) from public.a2c_goal_entries_v81 e where e.user_id=p_user and e.created_at::date between p_from and p_to),0)::bigint
$$;

grant execute on function public.a2c_v82_mode_balance(uuid,text) to authenticated;
grant execute on function public.a2c_v82_saving_flow(uuid,date,date) to authenticated;
grant execute on function public.a2c_v82_available_flow(uuid,date,date) to authenticated;

create or replace function public.a2c_v82_statistics(p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_from date:=coalesce(p_from,date_trunc('month',current_date)::date);v_to date:=coalesce(p_to,current_date);v_base jsonb;v_totals jsonb;v_comparison jsonb;v_monthly jsonb;v_days int;v_prev_from date;v_prev_to date;v_current bigint;v_previous bigint;v_base_saving bigint;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  if v_from>v_to then raise exception 'Intervalo de fechas no válido'; end if;
  v_base:=public.a2c_v81_statistics(v_from,v_to);
  v_days:=greatest(1,v_to-v_from+1);v_prev_to:=v_from-1;v_prev_from:=v_prev_to-v_days+1;
  v_current:=public.a2c_v82_available_flow(v_user,v_from,v_to);v_previous:=public.a2c_v82_available_flow(v_user,v_prev_from,v_prev_to);
  v_base_saving:=coalesce((v_base->'totals'->>'saving_cents')::bigint,0);
  v_totals:=(v_base->'totals')||jsonb_build_object(
    'saving_cents',v_base_saving+public.a2c_v82_saving_flow(v_user,v_from,v_to)+coalesce((select sum(case when e.entry_type='contribution' then e.amount_cents else -e.amount_cents end) from public.a2c_goal_entries_v81 e where e.user_id=v_user and e.created_at::date between v_from and v_to),0),
    'net_available_cents',v_current,
    'saving_balance_cents',public.a2c_v82_mode_balance(v_user,'saving'),
    'liquidity_balance_cents',public.a2c_v82_mode_balance(v_user,'liquidity'),
    'transfer_count',(select count(*) from public.a2c_resource_transfers_v82 where created_by=v_user and occurred_on between v_from and v_to),
    'transfer_cents',coalesce((select sum(amount_cents) from public.a2c_resource_transfers_v82 where created_by=v_user and occurred_on between v_from and v_to),0)
  );
  v_comparison:=(v_base->'comparison')||jsonb_build_object('net_change_pct',case when v_previous=0 then case when v_current=0 then 0 else 100 end else round((v_current-v_previous)*100.0/abs(v_previous),1) end);
  select coalesce(jsonb_agg(jsonb_build_object(
    'month',to_char(m.month_start,'YYYY-MM'),'label',to_char(m.month_start,'MM/YY'),
    'income_cents',coalesce(t.income_cents,0),'expense_cents',coalesce(t.expense_cents,0),
    'saving_cents',coalesce(t.saving_cents,0)+public.a2c_v82_saving_flow(v_user,m.month_start,(m.month_start+interval '1 month-1 day')::date)+coalesce(g.goal_cents,0),
    'investment_cents',coalesce(t.investment_cents,0)
  ) order by m.month_start),'[]'::jsonb) into v_monthly
  from (select generate_series(date_trunc('month',v_from)::date,date_trunc('month',v_to)::date,interval '1 month')::date month_start) m
  left join (
    select date_trunc('month',occurred_on)::date month_start,
      sum(amount_cents) filter(where kind='income')::bigint income_cents,
      sum(amount_cents) filter(where kind='expense')::bigint expense_cents,
      sum(amount_cents) filter(where kind='saving')::bigint saving_cents,
      sum(amount_cents) filter(where kind='investment')::bigint investment_cents
    from public.finance_transactions where creator_id=v_user and occurred_on between v_from and v_to group by 1
  ) t using(month_start)
  left join (
    select date_trunc('month',created_at)::date month_start,sum(case when entry_type='contribution' then amount_cents else -amount_cents end)::bigint goal_cents
    from public.a2c_goal_entries_v81 where user_id=v_user and created_at::date between v_from and v_to group by 1
  ) g using(month_start);
  return jsonb_set(jsonb_set(jsonb_set(v_base,'{totals}',v_totals),'{comparison}',v_comparison),'{monthly}',v_monthly);
end $$;
grant execute on function public.a2c_v82_statistics(date,date) to authenticated;

create or replace function public.a2c_widget_snapshot_v82(p_goal_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_base jsonb;v_month_start date:=date_trunc('month',current_date)::date;v_month_end date:=(date_trunc('month',current_date)+interval '1 month-1 day')::date;v_saving bigint;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  v_base:=public.a2c_widget_snapshot_v81(p_goal_ids);
  v_saving:=coalesce((select sum(amount_cents) from public.finance_transactions where creator_id=v_user and kind='saving' and occurred_on between v_month_start and v_month_end),0)+public.a2c_v82_saving_flow(v_user,v_month_start,v_month_end)+coalesce((select sum(case when entry_type='contribution' then amount_cents else -amount_cents end) from public.a2c_goal_entries_v81 where user_id=v_user and created_at::date between v_month_start and v_month_end),0);
  return v_base||jsonb_build_object(
    'available_cents',public.a2c_v82_available_balance(v_user,null),
    'month_saving_cents',v_saving,
    'saving_piggies_cents',public.a2c_v82_mode_balance(v_user,'saving'),
    'liquidity_piggies_cents',public.a2c_v82_mode_balance(v_user,'liquidity')
  );
end $$;
grant execute on function public.a2c_widget_snapshot_v82(uuid[]) to authenticated;

commit;

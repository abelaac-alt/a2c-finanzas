-- A2C Finanzas 8.1
-- Presupuestos inteligentes, estadísticas por concepto, objetivos compartidos y widget configurable.
-- Ejecutar completa después de la migración 8.0. Es idempotente.

begin;

create extension if not exists pgcrypto with schema extensions;

-- 1) Reparación robusta del límite de categorías de presupuestos.
do $$
declare item record;
begin
  for item in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='budgets_v67' and c.contype='c'
      and pg_get_constraintdef(c.oid) ilike '%category_key%'
  loop
    execute format('alter table public.budgets_v67 drop constraint %I',item.conname);
  end loop;
end $$;

update public.budgets_v67
set category_key=case lower(coalesce(category_key,''))
  when 'alimentacion' then 'food' when 'alimentación' then 'food'
  when 'ocio' then 'leisure' when 'salud' then 'health'
  when 'combustible' then 'fuel' when 'gasolina' then 'fuel'
  when 'suscripciones' then 'subscriptions' when 'compras' then 'shopping'
  when 'vivienda' then 'housing' when 'transporte' then 'transport'
  when 'otros' then 'other'
  else lower(coalesce(category_key,'other')) end;

update public.budgets_v67
set category_key='other'
where category_key not in ('food','leisure','health','fuel','subscriptions','shopping','housing','transport','other');

update public.budgets_v67 set series_id=extensions.gen_random_uuid() where series_id is null;

alter table public.budgets_v67
  add constraint budgets_v67_category_key_check
  check(category_key in ('food','leisure','health','fuel','subscriptions','shopping','housing','transport','other'));

-- 2) Vinculación explícita de movimientos y aprendizaje por conceptos.
alter table public.finance_transactions
  add column if not exists budget_id uuid,
  add column if not exists budget_assignment text not null default 'none';

update public.finance_transactions
set budget_assignment='none'
where budget_assignment not in ('none','manual','automatic');

do $$ begin
  if not exists(select 1 from pg_constraint where conname='finance_transactions_budget_id_fkey') then
    alter table public.finance_transactions
      add constraint finance_transactions_budget_id_fkey
      foreign key(budget_id) references public.budgets_v67(id) on delete set null;
  end if;
  if not exists(select 1 from pg_constraint where conname='finance_transactions_budget_assignment_check') then
    alter table public.finance_transactions
      add constraint finance_transactions_budget_assignment_check
      check(budget_assignment in ('none','manual','automatic'));
  end if;
end $$;

create or replace function public.a2c_v81_normalize_concept(p_value text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(p_value,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),
    '[^a-z0-9]+',' ','g'
  ));
$$;

create table if not exists public.a2c_budget_rules_v81(
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_concept text not null,
  budget_series_id uuid not null,
  category_key text not null,
  hit_count integer not null default 1,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique(user_id,normalized_concept)
);

alter table public.a2c_budget_rules_v81 enable row level security;
drop policy if exists "a2c v81 budget rules own" on public.a2c_budget_rules_v81;
create policy "a2c v81 budget rules own" on public.a2c_budget_rules_v81
  for all using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update,delete on public.a2c_budget_rules_v81 to authenticated;

create or replace function public.a2c_v81_auto_budget()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_normalized text;
  v_category text;
  v_budget uuid;
begin
  if new.kind<>'expense' then
    new.budget_id:=null;
    new.budget_assignment:='none';
    return new;
  end if;

  if new.budget_id is not null then
    select b.category_key into v_category
    from public.budgets_v67 b
    where b.id=new.budget_id and b.user_id=new.creator_id;
    if not found then raise exception 'El presupuesto seleccionado no está disponible'; end if;
    new.budget_category:=v_category;
    if coalesce(new.budget_assignment,'none')='none' then new.budget_assignment:='manual'; end if;
    return new;
  end if;

  v_normalized:=public.a2c_v81_normalize_concept(coalesce(nullif(new.concept,''),new.merchant));
  if v_normalized<>'' then
    select b.id,b.category_key into v_budget,v_category
    from public.a2c_budget_rules_v81 r
    join public.budgets_v67 b
      on b.user_id=new.creator_id and b.series_id=r.budget_series_id
      and b.period_month=to_char(new.occurred_on,'YYYY-MM') and b.active=true
    where r.user_id=new.creator_id and r.normalized_concept=v_normalized
    order by r.hit_count desc,r.last_used_at desc limit 1;
  end if;

  if v_budget is null then
    v_category:=coalesce(nullif(new.budget_category,''),public.a2c_v8_category_key(coalesce(new.concept,new.merchant)));
    select min(b.id),min(b.category_key) into v_budget,v_category
    from public.budgets_v67 b
    where b.user_id=new.creator_id and b.active=true
      and b.period_month=to_char(new.occurred_on,'YYYY-MM')
      and b.category_key=v_category
    having count(*)=1;
  end if;

  if v_budget is not null then
    new.budget_id:=v_budget;
    new.budget_category:=v_category;
    new.budget_assignment:='automatic';
  else
    new.budget_assignment:='none';
  end if;
  return new;
end;
$$;

drop trigger if exists a2c_v81_auto_budget_trigger on public.finance_transactions;
create trigger a2c_v81_auto_budget_trigger
before insert or update of concept,merchant,occurred_on,kind,budget_id,budget_category
on public.finance_transactions
for each row execute function public.a2c_v81_auto_budget();

create or replace function public.a2c_v81_learn_budget(
  p_transaction_id uuid,
  p_budget_id uuid,
  p_concept text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_budget public.budgets_v67%rowtype;
  v_normalized text:=public.a2c_v81_normalize_concept(p_concept);
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  select * into v_budget from public.budgets_v67
  where id=p_budget_id and user_id=v_user;
  if not found then raise exception 'Presupuesto no disponible'; end if;
  if v_normalized='' then raise exception 'El concepto no permite crear una regla'; end if;

  update public.finance_transactions
  set budget_id=v_budget.id,budget_category=v_budget.category_key,budget_assignment='manual'
  where id=p_transaction_id and creator_id=v_user;
  if not found then raise exception 'Movimiento no disponible'; end if;

  insert into public.a2c_budget_rules_v81(user_id,normalized_concept,budget_series_id,category_key,hit_count,last_used_at)
  values(v_user,v_normalized,v_budget.series_id,v_budget.category_key,1,now())
  on conflict(user_id,normalized_concept) do update
  set budget_series_id=excluded.budget_series_id,
      category_key=excluded.category_key,
      hit_count=public.a2c_budget_rules_v81.hit_count+1,
      last_used_at=now();
  return v_budget.id;
end;
$$;
grant execute on function public.a2c_v81_learn_budget(uuid,uuid,text) to authenticated;

-- 3) Objetivos colaborativos con libro de aportaciones y retiradas.
create table if not exists public.a2c_goals_v81(
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(char_length(btrim(name)) between 1 and 90),
  description text not null default '',
  target_cents bigint not null check(target_cents>0),
  deadline date,
  status text not null default 'active' check(status in ('active','completed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.a2c_goal_members_v81(
  goal_id uuid not null references public.a2c_goals_v81(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check(role in ('owner','member')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(goal_id,user_id)
);

create table if not exists public.a2c_goal_entries_v81(
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.a2c_goals_v81(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_type text not null check(entry_type in ('contribution','withdrawal')),
  amount_cents bigint not null check(amount_cents>0),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists a2c_goal_entries_v81_goal_idx on public.a2c_goal_entries_v81(goal_id,created_at desc);
create index if not exists a2c_goal_members_v81_user_idx on public.a2c_goal_members_v81(user_id,goal_id);

alter table public.a2c_goals_v81 enable row level security;
alter table public.a2c_goal_members_v81 enable row level security;
alter table public.a2c_goal_entries_v81 enable row level security;

drop policy if exists "a2c v81 goals members read" on public.a2c_goals_v81;
create policy "a2c v81 goals members read" on public.a2c_goals_v81 for select
using(owner_id=auth.uid());
drop policy if exists "a2c v81 goals owner write" on public.a2c_goals_v81;
create policy "a2c v81 goals owner write" on public.a2c_goals_v81 for all
using(owner_id=auth.uid()) with check(owner_id=auth.uid());

drop policy if exists "a2c v81 goal members read" on public.a2c_goal_members_v81;
create policy "a2c v81 goal members read" on public.a2c_goal_members_v81 for select
using(user_id=auth.uid() or exists(select 1 from public.a2c_goals_v81 g where g.id=goal_id and g.owner_id=auth.uid()));
drop policy if exists "a2c v81 goal members owner write" on public.a2c_goal_members_v81;
create policy "a2c v81 goal members owner write" on public.a2c_goal_members_v81 for all
using(exists(select 1 from public.a2c_goals_v81 g where g.id=goal_id and g.owner_id=auth.uid()))
with check(exists(select 1 from public.a2c_goals_v81 g where g.id=goal_id and g.owner_id=auth.uid()));

drop policy if exists "a2c v81 goal entries members read" on public.a2c_goal_entries_v81;
create policy "a2c v81 goal entries members read" on public.a2c_goal_entries_v81 for select
using(user_id=auth.uid() or exists(select 1 from public.a2c_goals_v81 g where g.id=goal_id and g.owner_id=auth.uid()));
drop policy if exists "a2c v81 goal entries member insert" on public.a2c_goal_entries_v81;
create policy "a2c v81 goal entries member insert" on public.a2c_goal_entries_v81 for insert
with check(user_id=auth.uid() and exists(select 1 from public.a2c_goal_members_v81 m where m.goal_id=goal_id and m.user_id=auth.uid()));

grant select,insert,update,delete on public.a2c_goals_v81 to authenticated;
grant select,insert,update,delete on public.a2c_goal_members_v81 to authenticated;
grant select,insert on public.a2c_goal_entries_v81 to authenticated;

create or replace function public.a2c_v81_create_goal(
  p_name text,p_description text,p_target_cents bigint,p_deadline date
)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_user uuid:=auth.uid();v_id uuid;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  if coalesce(p_target_cents,0)<=0 then raise exception 'La meta debe ser mayor que cero'; end if;
  insert into public.a2c_goals_v81(owner_id,name,description,target_cents,deadline)
  values(v_user,btrim(p_name),coalesce(btrim(p_description),''),p_target_cents,p_deadline)
  returning id into v_id;
  insert into public.a2c_goal_members_v81(goal_id,user_id,role,invited_by)
  values(v_id,v_user,'owner',v_user);
  return v_id;
end $$;

create or replace function public.a2c_v81_update_goal(
  p_goal_id uuid,p_name text,p_description text,p_target_cents bigint,p_deadline date
)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.a2c_goals_v81 set name=btrim(p_name),description=coalesce(btrim(p_description),''),
    target_cents=p_target_cents,deadline=p_deadline,updated_at=now()
  where id=p_goal_id and owner_id=auth.uid();
  if not found then raise exception 'Solo el creador puede editar el objetivo'; end if;
end $$;

create or replace function public.a2c_v81_add_goal_member(p_goal_id uuid,p_username text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_member uuid;v_goal_name text;
begin
  if not exists(select 1 from public.a2c_goals_v81 where id=p_goal_id and owner_id=v_user) then
    raise exception 'Solo el creador puede añadir participantes';
  end if;
  select id into v_member from public.profiles
  where lower(username)=lower(trim(leading '@' from p_username)) and coalesce(active,true)=true limit 1;
  if v_member is null or v_member=v_user then raise exception 'Usuario no válido'; end if;
  if not exists(select 1 from public.friendships f where f.status='accepted' and
    ((f.requester_id=v_user and f.addressee_id=v_member) or (f.addressee_id=v_user and f.requester_id=v_member))) then
    raise exception 'Solo puedes añadir amigos aceptados';
  end if;
  insert into public.a2c_goal_members_v81(goal_id,user_id,role,invited_by)
  values(p_goal_id,v_member,'member',v_user) on conflict do nothing;
  select name into v_goal_name from public.a2c_goals_v81 where id=p_goal_id;
  insert into public.notifications(user_id,type,title,message,related_id)
  values(v_member,'goal_invite','Nuevo objetivo compartido','Te han añadido al objetivo '||coalesce(v_goal_name,'compartido')||'.',p_goal_id)
  on conflict do nothing;
  return v_member;
end $$;

create or replace function public.a2c_v81_remove_goal_member(p_goal_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_user_id=(select owner_id from public.a2c_goals_v81 where id=p_goal_id) then
    raise exception 'No se puede eliminar al creador';
  end if;
  if auth.uid()<>p_user_id and not exists(select 1 from public.a2c_goals_v81 where id=p_goal_id and owner_id=auth.uid()) then
    raise exception 'No tienes permisos';
  end if;
  delete from public.a2c_goal_members_v81 where goal_id=p_goal_id and user_id=p_user_id;
end $$;

create or replace function public.a2c_v81_goal_entry(
  p_goal_id uuid,p_entry_type text,p_amount_cents bigint,p_note text default ''
)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_user uuid:=auth.uid();v_balance bigint;v_id uuid;v_target bigint;
begin
  if p_entry_type not in ('contribution','withdrawal') then raise exception 'Operación no válida'; end if;
  if coalesce(p_amount_cents,0)<=0 then raise exception 'Importe no válido'; end if;
  if not exists(select 1 from public.a2c_goal_members_v81 where goal_id=p_goal_id and user_id=v_user) then
    raise exception 'No formas parte de este objetivo';
  end if;
  select coalesce(sum(case when entry_type='contribution' then amount_cents else -amount_cents end),0)
  into v_balance from public.a2c_goal_entries_v81 where goal_id=p_goal_id;
  if p_entry_type='withdrawal' and p_amount_cents>v_balance then raise exception 'No hay saldo suficiente en el objetivo'; end if;
  insert into public.a2c_goal_entries_v81(goal_id,user_id,entry_type,amount_cents,note)
  values(p_goal_id,v_user,p_entry_type,p_amount_cents,coalesce(btrim(p_note),'')) returning id into v_id;
  select target_cents into v_target from public.a2c_goals_v81 where id=p_goal_id;
  update public.a2c_goals_v81 set status=case when
    (v_balance+case when p_entry_type='contribution' then p_amount_cents else -p_amount_cents end)>=v_target
    then 'completed' else 'active' end,updated_at=now() where id=p_goal_id;
  return v_id;
end $$;

create or replace function public.a2c_v81_delete_goal(p_goal_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  delete from public.a2c_goals_v81 where id=p_goal_id and owner_id=auth.uid();
  if not found then raise exception 'Solo el creador puede eliminar el objetivo'; end if;
end $$;

create or replace function public.a2c_v81_list_goals()
returns table(
  id uuid,owner_id uuid,name text,description text,target_cents bigint,deadline date,status text,
  balance_cents bigint,own_balance_cents bigint,month_contributed_cents bigint,month_withdrawn_cents bigint,
  members jsonb,entries jsonb,created_at timestamptz,updated_at timestamptz
)
language sql security definer set search_path=public stable as $$
  select g.id,g.owner_id,g.name,g.description,g.target_cents,g.deadline,g.status,
    coalesce((select sum(case when e.entry_type='contribution' then e.amount_cents else -e.amount_cents end) from public.a2c_goal_entries_v81 e where e.goal_id=g.id),0)::bigint,
    coalesce((select sum(case when e.entry_type='contribution' then e.amount_cents else -e.amount_cents end) from public.a2c_goal_entries_v81 e where e.goal_id=g.id and e.user_id=auth.uid()),0)::bigint,
    coalesce((select sum(e.amount_cents) from public.a2c_goal_entries_v81 e where e.goal_id=g.id and e.user_id=auth.uid() and e.entry_type='contribution' and date_trunc('month',e.created_at)=date_trunc('month',now())),0)::bigint,
    coalesce((select sum(e.amount_cents) from public.a2c_goal_entries_v81 e where e.goal_id=g.id and e.user_id=auth.uid() and e.entry_type='withdrawal' and date_trunc('month',e.created_at)=date_trunc('month',now())),0)::bigint,
    coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'username',p.username,'display_name',p.display_name,'avatar_path',p.avatar_path) order by case when m.role='owner' then 0 else 1 end,lower(coalesce(p.display_name,p.username))) from public.a2c_goal_members_v81 m join public.profiles p on p.id=m.user_id where m.goal_id=g.id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'user_id',q.user_id,'entry_type',q.entry_type,'amount_cents',q.amount_cents,'note',q.note,'created_at',q.created_at,'username',q.username,'display_name',q.display_name) order by q.created_at desc) from (select e.*,p.username,p.display_name from public.a2c_goal_entries_v81 e join public.profiles p on p.id=e.user_id where e.goal_id=g.id order by e.created_at desc limit 30) q),'[]'::jsonb),
    g.created_at,g.updated_at
  from public.a2c_goals_v81 g
  where exists(select 1 from public.a2c_goal_members_v81 m where m.goal_id=g.id and m.user_id=auth.uid())
  order by case g.status when 'active' then 0 when 'completed' then 1 else 2 end,g.deadline nulls last,g.created_at desc;
$$;

grant execute on function public.a2c_v81_create_goal(text,text,bigint,date) to authenticated;
grant execute on function public.a2c_v81_update_goal(uuid,text,text,bigint,date) to authenticated;
grant execute on function public.a2c_v81_add_goal_member(uuid,text) to authenticated;
grant execute on function public.a2c_v81_remove_goal_member(uuid,uuid) to authenticated;
grant execute on function public.a2c_v81_goal_entry(uuid,text,bigint,text) to authenticated;
grant execute on function public.a2c_v81_delete_goal(uuid) to authenticated;
grant execute on function public.a2c_v81_list_goals() to authenticated;

-- Migrar nombres y metas de objetivos antiguos. Las aportaciones de ahorro se toman como saldo inicial.
insert into public.a2c_goals_v81(id,owner_id,name,description,target_cents,deadline,status,created_at,updated_at)
select r.id,r.owner_id,r.name,coalesce(r.description,''),greatest(1,coalesce(r.target_cents,1)),r.target_date,'active',r.created_at,now()
from public.resources r where r.type='goal'
on conflict(id) do nothing;
insert into public.a2c_goal_members_v81(goal_id,user_id,role,invited_by)
select g.id,g.owner_id,'owner',g.owner_id from public.a2c_goals_v81 g
on conflict do nothing;
insert into public.a2c_goal_entries_v81(goal_id,user_id,entry_type,amount_cents,note)
select g.id,g.owner_id,'contribution',x.total,'Saldo importado de la versión anterior'
from public.a2c_goals_v81 g
join lateral(select coalesce(sum(t.amount_cents),0)::bigint total from public.finance_transactions t where t.creator_id=g.owner_id and t.resource_id=g.id and t.kind='saving') x on x.total>0
where not exists(select 1 from public.a2c_goal_entries_v81 e where e.goal_id=g.id);

-- 4) Estadísticas por conceptos normalizados.
create or replace function public.a2c_v81_statistics(p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_from date:=coalesce(p_from,date_trunc('month',current_date)::date);v_to date:=coalesce(p_to,current_date);v_base jsonb;v_concepts jsonb;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  v_base:=public.a2c_v8_statistics(v_from,v_to);
  select coalesce(jsonb_agg(jsonb_build_object(
    'concept_key',q.concept_key,'label',q.label,'total_cents',q.total_cents,'count',q.movement_count,
    'average_cents',q.average_cents,'first_date',q.first_date,'last_date',q.last_date
  ) order by q.total_cents desc,q.movement_count desc),'[]'::jsonb)
  into v_concepts
  from (
    select public.a2c_v81_normalize_concept(coalesce(nullif(concept,''),merchant,'Gasto')) concept_key,
      max(coalesce(nullif(concept,''),merchant,'Gasto')) label,sum(amount_cents)::bigint total_cents,
      count(*)::bigint movement_count,round(avg(amount_cents))::bigint average_cents,
      min(occurred_on) first_date,max(occurred_on) last_date
    from public.finance_transactions
    where creator_id=v_user and kind='expense' and occurred_on between v_from and v_to
    group by 1 having public.a2c_v81_normalize_concept(coalesce(nullif(concept,''),merchant,'Gasto'))<>''
    order by total_cents desc limit 100
  ) q;
  return v_base||jsonb_build_object('concept_totals',v_concepts);
end $$;
grant execute on function public.a2c_v81_statistics(date,date) to authenticated;

-- 5) Snapshot para widgets, incluyendo presupuestos por vínculo y objetivos elegidos.
create or replace function public.a2c_widget_snapshot_v81(p_goal_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_month text:=to_char(current_date,'YYYY-MM');v_result jsonb;v_goals jsonb;v_own_goal_balance bigint;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  v_result:=public.a2c_widget_snapshot_v8();
  select coalesce(sum(case when e.entry_type='contribution' then e.amount_cents else -e.amount_cents end),0)::bigint
  into v_own_goal_balance from public.a2c_goal_entries_v81 e where e.user_id=v_user;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'name',q.name,'target_cents',q.target_cents,'deadline',q.deadline,
    'balance_cents',q.balance_cents,'progress',case when q.target_cents=0 then 0 else least(100,round(q.balance_cents*100.0/q.target_cents)) end
  ) order by q.deadline nulls last,q.name),'[]'::jsonb)
  into v_goals
  from (
    select g.id,g.name,g.target_cents,g.deadline,
      coalesce((select sum(case when e.entry_type='contribution' then e.amount_cents else -e.amount_cents end) from public.a2c_goal_entries_v81 e where e.goal_id=g.id),0)::bigint balance_cents
    from public.a2c_goals_v81 g
    where g.status in ('active','completed')
      and exists(select 1 from public.a2c_goal_members_v81 m where m.goal_id=g.id and m.user_id=v_user)
      and (coalesce(cardinality(p_goal_ids),0)=0 or g.id=any(p_goal_ids))
    order by g.deadline nulls last,g.created_at desc limit 3
  ) q;
  return v_result||jsonb_build_object(
    'available_cents',coalesce((v_result->>'available_cents')::bigint,0)-coalesce(v_own_goal_balance,0),
    'budgets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'name',b.name,'amount_cents',b.amount_cents,
      'spent_cents',coalesce((select sum(t.amount_cents) from public.finance_transactions t where t.creator_id=v_user and t.kind='expense' and to_char(t.occurred_on,'YYYY-MM')=b.period_month and (t.budget_id=b.id or (t.budget_id is null and t.budget_category=b.category_key))),0)
    ) order by b.name) from public.budgets_v67 b where b.user_id=v_user and b.active=true and b.period_month=v_month),'[]'::jsonb),
    'goals',v_goals
  );
end $$;
grant execute on function public.a2c_widget_snapshot_v81(uuid[]) to authenticated;

commit;

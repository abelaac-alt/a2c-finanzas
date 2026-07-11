-- A2C Finanzas · esquema completo para Supabase
-- Ejecuta todo este archivo una sola vez en SQL Editor.

create extension if not exists pgcrypto;

create type public.app_role as enum ('user','admin');
create type public.member_role as enum ('owner','editor','viewer');
create type public.money_kind as enum ('income','expense');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  role public.app_role not null default 'user',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_permissions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  can_create_piggy boolean not null default true,
  can_create_shared boolean not null default false,
  can_add_income boolean not null default true,
  can_add_expense boolean not null default true,
  can_manage_members boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  emoji text not null default '📁',
  created_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  target_cents bigint not null check (target_cents > 0),
  target_date date,
  emoji text not null default '🎯',
  created_at timestamptz not null default now()
);

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  amount_cents bigint not null check (amount_cents > 0),
  note text not null default 'Aporte',
  created_at timestamptz not null default now()
);

create table public.piggy_banks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  emoji text not null default '🏦',
  color text not null default '#4f8cff',
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.piggy_members (
  piggy_id uuid not null references public.piggy_banks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'editor',
  can_add_income boolean not null default true,
  can_add_expense boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (piggy_id,user_id)
);

create table public.piggy_transactions (
  id uuid primary key default gen_random_uuid(),
  piggy_id uuid not null references public.piggy_banks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  kind public.money_kind not null,
  amount_cents bigint not null check (amount_cents > 0),
  concept text not null check (char_length(trim(concept)) between 1 and 160),
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  piggy_id uuid references public.piggy_banks(id) on delete cascade,
  transaction_id uuid references public.piggy_transactions(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index piggy_members_user_idx on public.piggy_members(user_id);
create index piggy_transactions_piggy_idx on public.piggy_transactions(piggy_id,created_at desc);
create index notifications_user_idx on public.notifications(user_id,created_at desc);
create index goal_contributions_goal_idx on public.goal_contributions(goal_id,created_at desc);

create or replace function public.is_admin(uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=uid and role='admin' and active);
$$;

create or replace function public.has_permission(permission_name text, uid uuid default auth.uid()) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare result boolean;
begin
  if public.is_admin(uid) then return true; end if;
  execute format('select %I from public.user_permissions where user_id=$1',permission_name) into result using uid;
  return coalesce(result,false);
exception when undefined_column then return false;
end; $$;

create or replace function public.is_piggy_member(pid uuid, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.piggy_members where piggy_id=pid and user_id=uid)
      or exists(select 1 from public.piggy_banks where id=pid and owner_id=uid)
      or public.is_admin(uid);
$$;

create or replace function public.can_manage_piggy(pid uuid, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.piggy_banks where id=pid and owner_id=uid)
      or exists(select 1 from public.piggy_members where piggy_id=pid and user_id=uid and role='owner')
      or public.is_admin(uid);
$$;

create or replace function public.can_transact(pid uuid, requested_kind public.money_kind, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
  select public.is_admin(uid) or (
    public.is_piggy_member(pid,uid)
    and case when requested_kind='income' then public.has_permission('can_add_income',uid)
             else public.has_permission('can_add_expense',uid) end
    and coalesce((select role<>'viewer' and case when requested_kind='income' then can_add_income else can_add_expense end
                  from public.piggy_members where piggy_id=pid and user_id=uid),true)
  );
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,display_name)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'display_name',split_part(coalesce(new.email,''),'@',1)))
  on conflict(id) do nothing;
  insert into public.user_permissions(user_id) values(new.id) on conflict(user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.add_owner_as_member() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.piggy_members(piggy_id,user_id,role,can_add_income,can_add_expense)
  values(new.id,new.owner_id,'owner',true,true) on conflict do nothing;
  return new;
end; $$;
create trigger piggy_owner_member after insert on public.piggy_banks for each row execute function public.add_owner_as_member();

create or replace function public.add_piggy_member_by_email(p_piggy_id uuid,p_email text,p_role public.member_role default 'editor')
returns void language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  if not public.can_manage_piggy(p_piggy_id) or not (public.has_permission('can_manage_members') or public.is_admin()) then
    raise exception 'No tienes permiso para gestionar miembros';
  end if;
  select id into target from public.profiles where lower(email)=lower(trim(p_email)) and active;
  if target is null then raise exception 'No existe un usuario activo con ese email'; end if;
  insert into public.piggy_members(piggy_id,user_id,role) values(p_piggy_id,target,p_role)
  on conflict(piggy_id,user_id) do update set role=excluded.role;
  update public.piggy_banks set is_shared=true,updated_at=now() where id=p_piggy_id;
end; $$;

create or replace function public.admin_update_user(p_user_id uuid,p_role public.app_role,p_active boolean,
  p_can_create_piggy boolean,p_can_create_shared boolean,p_can_add_income boolean,
  p_can_add_expense boolean,p_can_manage_members boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede cambiar permisos'; end if;
  if p_user_id=auth.uid() and not p_active then raise exception 'No puedes desactivar tu propia cuenta'; end if;
  update public.profiles set role=p_role,active=p_active,updated_at=now() where id=p_user_id;
  update public.user_permissions set can_create_piggy=p_can_create_piggy,can_create_shared=p_can_create_shared,
    can_add_income=p_can_add_income,can_add_expense=p_can_add_expense,
    can_manage_members=p_can_manage_members,updated_at=now() where user_id=p_user_id;
end; $$;

create or replace function public.notify_piggy_transaction() returns trigger
language plpgsql security definer set search_path=public as $$
declare actor_name text; piggy_name text;
begin
  select coalesce(nullif(display_name,''),email) into actor_name from public.profiles where id=new.user_id;
  select name into piggy_name from public.piggy_banks where id=new.piggy_id;
  insert into public.notifications(user_id,actor_id,piggy_id,transaction_id,title,body)
  select m.user_id,new.user_id,new.piggy_id,new.id,
         case when new.kind='income' then 'Fondos añadidos' else 'Gasto realizado' end,
         actor_name||case when new.kind='income' then ' añadió ' else ' gastó ' end||
         to_char(new.amount_cents/100.0,'FM999G999G990D00')||' € en "'||piggy_name||'": '||new.concept
  from public.piggy_members m where m.piggy_id=new.piggy_id and m.user_id<>new.user_id;
  return new;
end; $$;
create trigger piggy_transaction_notification after insert on public.piggy_transactions
for each row execute function public.notify_piggy_transaction();

alter table public.profiles enable row level security;
alter table public.user_permissions enable row level security;
alter table public.folders enable row level security;
alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.piggy_banks enable row level security;
alter table public.piggy_members enable row level security;
alter table public.piggy_transactions enable row level security;
alter table public.notifications enable row level security;

create policy profiles_read on public.profiles for select to authenticated using(active or id=(select auth.uid()) or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated using(id=(select auth.uid()) or public.is_admin()) with check(id=(select auth.uid()) or public.is_admin());
create policy permissions_read on public.user_permissions for select to authenticated using(user_id=(select auth.uid()) or public.is_admin());
create policy permissions_admin_update on public.user_permissions for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy folders_owner_all on public.folders for all to authenticated using(owner_id=(select auth.uid()) or public.is_admin()) with check(owner_id=(select auth.uid()) or public.is_admin());
create policy goals_owner_all on public.goals for all to authenticated using(owner_id=(select auth.uid()) or public.is_admin()) with check(owner_id=(select auth.uid()) or public.is_admin());
create policy contributions_owner_select on public.goal_contributions for select to authenticated using(exists(select 1 from public.goals g where g.id=goal_id and (g.owner_id=(select auth.uid()) or public.is_admin())));
create policy contributions_owner_insert on public.goal_contributions for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.goals g where g.id=goal_id and g.owner_id=(select auth.uid())));
create policy piggies_member_read on public.piggy_banks for select to authenticated using(public.is_piggy_member(id));
create policy piggies_create on public.piggy_banks for insert to authenticated with check(owner_id=(select auth.uid()) and public.has_permission('can_create_piggy') and (not is_shared or public.has_permission('can_create_shared')));
create policy piggies_manage on public.piggy_banks for update to authenticated using(public.can_manage_piggy(id)) with check(public.can_manage_piggy(id));
create policy piggies_delete on public.piggy_banks for delete to authenticated using(public.can_manage_piggy(id));
create policy members_read on public.piggy_members for select to authenticated using(public.is_piggy_member(piggy_id));
create policy members_manage_insert on public.piggy_members for insert to authenticated with check(public.can_manage_piggy(piggy_id));
create policy members_manage_update on public.piggy_members for update to authenticated using(public.can_manage_piggy(piggy_id)) with check(public.can_manage_piggy(piggy_id));
create policy members_manage_delete on public.piggy_members for delete to authenticated using(public.can_manage_piggy(piggy_id) and user_id<>(select auth.uid()));
create policy transactions_read on public.piggy_transactions for select to authenticated using(public.is_piggy_member(piggy_id));
create policy transactions_insert on public.piggy_transactions for insert to authenticated with check(user_id=(select auth.uid()) and public.can_transact(piggy_id,kind));
create policy notifications_own_read on public.notifications for select to authenticated using(user_id=(select auth.uid()));
create policy notifications_own_update on public.notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select,update on public.user_permissions to authenticated;
grant select,insert,update,delete on public.folders,public.goals,public.goal_contributions,public.piggy_banks,public.piggy_members to authenticated;
grant select,insert on public.piggy_transactions to authenticated;
grant select,update on public.notifications to authenticated;
grant execute on function public.add_piggy_member_by_email(uuid,text,public.member_role) to authenticated;
grant execute on function public.admin_update_user(uuid,public.app_role,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.piggy_transactions;
exception when duplicate_object then null; end $$;

-- PASO MANUAL TRAS TU PRIMER ACCESO:
-- Sustituye el email y ejecuta estas dos líneas para convertirte en administrador.
-- update public.profiles set role='admin' where lower(email)=lower('tu-email@ejemplo.com');
-- update public.user_permissions set can_create_shared=true,can_manage_members=true where user_id=(select id from public.profiles where lower(email)=lower('tu-email@ejemplo.com'));

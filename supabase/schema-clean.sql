
begin;
create extension if not exists pgcrypto;

-- ADVERTENCIA: elimina datos antiguos de la aplicación, pero conserva auth.users.
drop table if exists public.notifications cascade;
drop table if exists public.resource_invitations cascade;
drop table if exists public.resource_members cascade;
drop table if exists public.finance_transactions cascade;
drop table if exists public.resources cascade;
drop table if exists public.profiles cascade;

drop function if exists public.invite_resource_by_email(uuid,text) cascade;
drop function if exists public.respond_resource_invitation(uuid,boolean) cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.is_admin(uuid) cascade;
drop function if exists public.can_access_resource(uuid,uuid) cascade;

create table public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  role text not null default 'user' check(role in('user','admin')),
  active boolean not null default true,
  permissions jsonb not null default '{"can_create_shared":true,"can_invite":true,"can_upload_receipts":true}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.resources(
  id uuid primary key default gen_random_uuid(),
  type text not null check(type in('piggy','folder','goal')),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null,
  description text not null default '',
  is_shared boolean not null default false,
  target_cents bigint,
  target_date date,
  created_at timestamptz not null default now(),
  check((type='goal' and target_cents>0) or type in('piggy','folder'))
);

create table public.resource_members(
  resource_id uuid not null references public.resources(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member' check(member_role in('owner','member')),
  created_at timestamptz not null default now(),
  primary key(resource_id,user_id)
);

create table public.resource_invitations(
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index resource_invitation_pending_unique on public.resource_invitations(resource_id,invitee_id) where status='pending';

create table public.finance_transactions(
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  resource_id uuid references public.resources(id) on delete cascade,
  kind text not null check(kind in('income','expense','investment','saving')),
  amount_cents bigint not null check(amount_cents>0),
  concept text not null,
  occurred_on date not null default current_date,
  notes text not null default '',
  receipt_path text,
  created_at timestamptz not null default now()
);

create table public.notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  body text not null default '',
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=p_user_id and role='admin' and active=true);
$$;

create or replace function public.can_access_resource(p_resource_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.resource_members where resource_id=p_resource_id and user_id=p_user_id);
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,display_name)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'display_name',split_part(coalesce(new.email,''),'@',1)))
  on conflict(id) do update set email=excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles(id,email,display_name)
select id,coalesce(email,''),coalesce(raw_user_meta_data->>'display_name',split_part(coalesce(email,''),'@',1))
from auth.users on conflict(id) do update set email=excluded.email;

create or replace function public.add_owner_member()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.resource_members(resource_id,user_id,member_role)
  values(new.id,new.owner_id,'owner') on conflict do nothing;
  return new;
end;
$$;
create trigger add_owner_member_trigger after insert on public.resources
for each row execute function public.add_owner_member();

create or replace function public.invite_resource_by_email(p_resource_id uuid,p_email text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_resource public.resources%rowtype; v_invitee public.profiles%rowtype; v_id uuid;
begin
  select * into v_resource from public.resources
  where id=p_resource_id and (owner_id=auth.uid() or public.is_admin(auth.uid()));
  if not found then raise exception 'No tienes permiso'; end if;

  select * into v_invitee from public.profiles
  where lower(email)=lower(trim(p_email)) and active=true;
  if not found then raise exception 'No existe un usuario activo con ese correo'; end if;
  if v_invitee.id=auth.uid() then raise exception 'No puedes invitarte a ti mismo'; end if;

  insert into public.resource_invitations(resource_id,inviter_id,invitee_id)
  values(p_resource_id,auth.uid(),v_invitee.id) returning id into v_id;

  insert into public.notifications(user_id,type,title,body,related_id)
  values(v_invitee.id,'invitation','Nueva invitación',
    (select display_name from public.profiles where id=auth.uid())||' quiere añadirte a '||v_resource.name,v_id);
  return v_id;
end;
$$;

create or replace function public.respond_resource_invitation(p_invitation_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_inv public.resource_invitations%rowtype; v_resource public.resources%rowtype;
begin
  select * into v_inv from public.resource_invitations
  where id=p_invitation_id and invitee_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Invitación no disponible'; end if;

  select * into v_resource from public.resources where id=v_inv.resource_id;
  update public.resource_invitations
  set status=case when p_accept then 'accepted' else 'rejected' end,responded_at=now()
  where id=p_invitation_id;

  if p_accept then
    update public.resources set is_shared=true where id=v_inv.resource_id;
    insert into public.resource_members(resource_id,user_id,member_role)
    values(v_inv.resource_id,auth.uid(),'member') on conflict do nothing;
  end if;

  insert into public.notifications(user_id,type,title,body,related_id)
  values(v_inv.inviter_id,'invitation_response',
    case when p_accept then 'Invitación aceptada' else 'Invitación rechazada' end,
    (select display_name from public.profiles where id=auth.uid())||
    case when p_accept then ' ha aceptado unirse a ' else ' ha rechazado unirse a ' end||v_resource.name,p_invitation_id);
end;
$$;

create or replace function public.notify_shared_transaction()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_tx public.finance_transactions%rowtype; v_resource public.resources%rowtype; v_actor text; v_action text;
begin
  v_tx:=coalesce(new,old);
  if v_tx.resource_id is null then return coalesce(new,old); end if;
  select * into v_resource from public.resources where id=v_tx.resource_id;
  if not v_resource.is_shared then return coalesce(new,old); end if;
  select display_name into v_actor from public.profiles where id=auth.uid();
  v_action:=case tg_op when 'INSERT' then 'ha añadido' when 'UPDATE' then 'ha editado' else 'ha eliminado' end;
  insert into public.notifications(user_id,type,title,body,related_id)
  select rm.user_id,'shared_activity','Movimiento compartido',
         coalesce(v_actor,'Un usuario')||' '||v_action||' un movimiento en '||v_resource.name,v_tx.id
  from public.resource_members rm
  where rm.resource_id=v_resource.id and rm.user_id is distinct from auth.uid();
  return coalesce(new,old);
end;
$$;
create trigger notify_shared_transaction_trigger after insert or update or delete on public.finance_transactions
for each row execute function public.notify_shared_transaction();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receipts','receipts',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.profiles enable row level security;
alter table public.resources enable row level security;
alter table public.resource_members enable row level security;
alter table public.resource_invitations enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.notifications enable row level security;

create policy profiles_select on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin(auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using(id=auth.uid() or public.is_admin(auth.uid())) with check(id=auth.uid() or public.is_admin(auth.uid()));

create policy resources_select on public.resources for select to authenticated using(public.can_access_resource(id,auth.uid()) or public.is_admin(auth.uid()));
create policy resources_insert on public.resources for insert to authenticated with check(owner_id=auth.uid());
create policy resources_update on public.resources for update to authenticated using(owner_id=auth.uid() or public.is_admin(auth.uid())) with check(owner_id=auth.uid() or public.is_admin(auth.uid()));
create policy resources_delete on public.resources for delete to authenticated using(owner_id=auth.uid() or public.is_admin(auth.uid()));

create policy members_select on public.resource_members for select to authenticated using(public.can_access_resource(resource_id,auth.uid()) or public.is_admin(auth.uid()));
create policy invitations_select on public.resource_invitations for select to authenticated using(inviter_id=auth.uid() or invitee_id=auth.uid() or public.is_admin(auth.uid()));

create policy tx_select on public.finance_transactions for select to authenticated using(
  (resource_id is null and creator_id=auth.uid()) or
  (resource_id is not null and public.can_access_resource(resource_id,auth.uid())) or public.is_admin(auth.uid())
);
create policy tx_insert on public.finance_transactions for insert to authenticated with check(
  creator_id=auth.uid() and (resource_id is null or public.can_access_resource(resource_id,auth.uid()))
);
create policy tx_update on public.finance_transactions for update to authenticated using(creator_id=auth.uid() or public.is_admin(auth.uid())) with check(creator_id=auth.uid() or public.is_admin(auth.uid()));
create policy tx_delete on public.finance_transactions for delete to authenticated using(creator_id=auth.uid() or public.is_admin(auth.uid()));

create policy notifications_all on public.notifications for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

drop policy if exists receipts_select_own on storage.objects;
create policy receipts_select_own on storage.objects for select to authenticated using(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists receipts_insert_own on storage.objects;
create policy receipts_insert_own on storage.objects for insert to authenticated with check(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists receipts_delete_own on storage.objects;
create policy receipts_delete_own on storage.objects for delete to authenticated using(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);

grant execute on function public.invite_resource_by_email(uuid,text) to authenticated;
grant execute on function public.respond_resource_invitation(uuid,boolean) to authenticated;

commit;
notify pgrst,'reload schema';

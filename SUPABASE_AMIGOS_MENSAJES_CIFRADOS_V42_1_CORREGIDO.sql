-- CORRECCIÓN 4.2.1:
-- Supabase aloja pgcrypto normalmente en el esquema extensions.
-- Todas las llamadas criptográficas están calificadas explícitamente.


-- A2C Finanzas 4.2
-- Amigos por @usuario, recursos compartidos y mensajes cifrados en servidor.
-- Cifrado: pgcrypto en reposo + HTTPS/TLS en tránsito.
-- El servidor conserva la capacidad de descifrado para entregar los mensajes a sus participantes.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists a2c_private;
revoke all on schema a2c_private from public, anon, authenticated;

create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  pair_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.direct_conversation_members (
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);

create table if not exists a2c_private.direct_conversation_keys (
  conversation_id uuid primary key references public.direct_conversations(id) on delete cascade,
  encryption_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  encrypted_body bytea not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists direct_messages_conversation_created_idx
  on public.direct_messages(conversation_id,created_at desc);

alter table public.direct_conversations enable row level security;
alter table public.direct_conversation_members enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "conversation members read conversations" on public.direct_conversations;
create policy "conversation members read conversations"
on public.direct_conversations for select
using (
  exists (
    select 1 from public.direct_conversation_members m
    where m.conversation_id=id and m.user_id=auth.uid()
  )
);

drop policy if exists "members read own memberships" on public.direct_conversation_members;
create policy "members read own memberships"
on public.direct_conversation_members for select
using (user_id=auth.uid());

-- No direct access to encrypted message rows. Access only through security-definer RPCs.
revoke all on public.direct_messages from anon, authenticated;
revoke all on a2c_private.direct_conversation_keys from anon, authenticated;

create or replace function public.a2c_search_users_by_username_v42(p_query text)
returns table(
  id uuid,
  username text,
  display_name text,
  avatar_path text,
  friendship_status text,
  friendship_id uuid,
  friendship_direction text
)
language sql
security definer
set search_path=public
as $$
  with query_value as (
    select lower(trim(leading '@' from coalesce(p_query,''))) q
  )
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_path,
    f.status,
    f.id,
    case
      when f.requester_id=auth.uid() then 'outgoing'
      when f.addressee_id=auth.uid() then 'incoming'
      else null
    end
  from public.profiles p
  cross join query_value qv
  left join public.friendships f
    on (
      (f.requester_id=auth.uid() and f.addressee_id=p.id)
      or
      (f.addressee_id=auth.uid() and f.requester_id=p.id)
    )
  where p.id<>auth.uid()
    and p.active=true
    and p.username is not null
    and qv.q<>''
    and lower(p.username) like qv.q||'%'
  order by
    case when lower(p.username)=qv.q then 0 else 1 end,
    lower(p.username)
  limit 30;
$$;

create or replace function public.a2c_send_friend_request_v42(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare existing public.friendships%rowtype;
begin
  if p_user_id is null or p_user_id=auth.uid() then
    raise exception 'Usuario no válido';
  end if;

  select * into existing
  from public.friendships
  where (requester_id=auth.uid() and addressee_id=p_user_id)
     or (requester_id=p_user_id and addressee_id=auth.uid())
  limit 1;

  if found then
    if existing.status='accepted' then return 'already_friends'; end if;
    if existing.status='pending' and existing.addressee_id=auth.uid() then
      update public.friendships
      set status='accepted',responded_at=now()
      where id=existing.id;
      return 'accepted';
    end if;
    update public.friendships
    set requester_id=auth.uid(),addressee_id=p_user_id,status='pending',responded_at=null
    where id=existing.id;
    return 'pending';
  end if;

  insert into public.friendships(requester_id,addressee_id,status)
  values(auth.uid(),p_user_id,'pending');

  insert into public.notifications(user_id,type,title,message,related_id)
  values(p_user_id,'friend_request','Nueva solicitud de amistad','Te han enviado una solicitud de amistad.',auth.uid());

  return 'sent';
end $$;

create or replace function public.a2c_respond_friend_request_v42(p_friendship_id uuid,p_accept boolean)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.friendships
  set status=case when p_accept then 'accepted' else 'rejected' end,
      responded_at=now()
  where id=p_friendship_id
    and addressee_id=auth.uid()
    and status='pending';
  if not found then raise exception 'Solicitud no disponible'; end if;
end $$;

create or replace function public.a2c_list_friends_v42()
returns table(id uuid,username text,display_name text,avatar_path text)
language sql
security definer
set search_path=public
as $$
  select p.id,p.username,p.display_name,p.avatar_path
  from public.friendships f
  join public.profiles p on p.id=case
    when f.requester_id=auth.uid() then f.addressee_id
    else f.requester_id
  end
  where f.status='accepted'
    and (f.requester_id=auth.uid() or f.addressee_id=auth.uid())
  order by lower(coalesce(p.display_name,p.username));
$$;

create or replace function public.a2c_invite_resource_friend_v42(p_resource_id uuid,p_friend_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare resource_owner uuid;
begin
  select owner_id into resource_owner from public.resources where id=p_resource_id;
  if resource_owner<>auth.uid() then raise exception 'Solo el propietario puede invitar'; end if;

  if not exists (
    select 1 from public.friendships f
    where f.status='accepted'
      and (
        (f.requester_id=auth.uid() and f.addressee_id=p_friend_id)
        or
        (f.addressee_id=auth.uid() and f.requester_id=p_friend_id)
      )
  ) then raise exception 'Solo puedes invitar a usuarios que sean tus amigos'; end if;

  if exists (
    select 1 from public.resource_members
    where resource_id=p_resource_id and user_id=p_friend_id
  ) then return 'already_member'; end if;

  if exists (
    select 1 from public.resource_invitations
    where resource_id=p_resource_id and invited_user_id=p_friend_id and status='pending'
  ) then return 'already_pending'; end if;

  insert into public.resource_invitations(resource_id,invited_user_id,invited_by,status)
  values(p_resource_id,p_friend_id,auth.uid(),'pending');

  insert into public.notifications(user_id,type,title,message,related_id)
  select p_friend_id,'resource_invite','Invitación a un elemento compartido',
         'Te han invitado a '||r.name,p_resource_id
  from public.resources r where r.id=p_resource_id;

  return 'sent';
end $$;

create or replace function public.a2c_get_or_create_conversation_v42(p_friend_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,a2c_private,extensions
as $$
declare
  pair text;
  conversation uuid;
begin
  if not exists (
    select 1 from public.friendships f
    where f.status='accepted'
      and (
        (f.requester_id=auth.uid() and f.addressee_id=p_friend_id)
        or
        (f.addressee_id=auth.uid() and f.requester_id=p_friend_id)
      )
  ) then raise exception 'Solo puedes escribir a tus amigos'; end if;

  pair=least(auth.uid()::text,p_friend_id::text)||':'||greatest(auth.uid()::text,p_friend_id::text);

  insert into public.direct_conversations(pair_key)
  values(pair)
  on conflict(pair_key) do update set updated_at=public.direct_conversations.updated_at
  returning id into conversation;

  insert into public.direct_conversation_members(conversation_id,user_id)
  values(conversation,auth.uid()),(conversation,p_friend_id)
  on conflict do nothing;

  insert into a2c_private.direct_conversation_keys(conversation_id,encryption_key)
  values(conversation,encode(extensions.gen_random_bytes(32),'hex'))
  on conflict do nothing;

  return conversation;
end $$;

create or replace function public.a2c_send_message_v42(p_friend_id uuid,p_body text)
returns uuid
language plpgsql
security definer
set search_path=public,a2c_private,extensions
as $$
declare
  conversation uuid;
  message_id uuid;
  message_key text;
  sender_name text;
begin
  if char_length(trim(coalesce(p_body,'')))<1 or char_length(p_body)>4000 then
    raise exception 'El mensaje debe tener entre 1 y 4000 caracteres';
  end if;

  conversation=public.a2c_get_or_create_conversation_v42(p_friend_id);
  select encryption_key into message_key
  from a2c_private.direct_conversation_keys
  where conversation_id=conversation;

  insert into public.direct_messages(conversation_id,sender_id,encrypted_body)
  values(conversation,auth.uid(),extensions.pgp_sym_encrypt(trim(p_body),message_key,'cipher-algo=aes256,compress-algo=1'))
  returning id into message_id;

  update public.direct_conversations set updated_at=now() where id=conversation;
  select coalesce(display_name,username,'Un amigo') into sender_name
  from public.profiles where id=auth.uid();

  -- El cuerpo no se copia en notificaciones para no dejar texto sin cifrar.
  insert into public.notifications(user_id,type,title,message,related_id)
  values(p_friend_id,'direct_message','Nuevo mensaje',sender_name||' te ha enviado un mensaje.',conversation);

  return message_id;
end $$;

create or replace function public.a2c_list_conversations_v42()
returns table(
  conversation_id uuid,
  friend_id uuid,
  username text,
  display_name text,
  avatar_path text,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
security definer
set search_path=public,a2c_private,extensions
as $$
  select
    c.id,
    fp.id,
    fp.username,
    fp.display_name,
    fp.avatar_path,
    coalesce(
      (
        select extensions.pgp_sym_decrypt(dm.encrypted_body,k.encryption_key)
        from public.direct_messages dm
        join a2c_private.direct_conversation_keys k on k.conversation_id=dm.conversation_id
        where dm.conversation_id=c.id and dm.deleted_at is null
        order by dm.created_at desc limit 1
      ),''
    ),
    (
      select max(dm.created_at)
      from public.direct_messages dm
      where dm.conversation_id=c.id and dm.deleted_at is null
    ),
    (
      select count(*)
      from public.direct_messages dm
      where dm.conversation_id=c.id
        and dm.sender_id<>auth.uid()
        and dm.deleted_at is null
        and dm.created_at>coalesce(me.last_read_at,'epoch'::timestamptz)
    )
  from public.direct_conversations c
  join public.direct_conversation_members me
    on me.conversation_id=c.id and me.user_id=auth.uid()
  join public.direct_conversation_members other
    on other.conversation_id=c.id and other.user_id<>auth.uid()
  join public.profiles fp on fp.id=other.user_id
  order by c.updated_at desc;
$$;

create or replace function public.a2c_list_messages_v42(p_conversation_id uuid,p_limit integer default 100)
returns table(
  id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  mine boolean
)
language plpgsql
security definer
set search_path=public,a2c_private,extensions
as $$
begin
  if not exists (
    select 1 from public.direct_conversation_members
    where conversation_id=p_conversation_id and user_id=auth.uid()
  ) then raise exception 'No tienes acceso a esta conversación'; end if;

  update public.direct_conversation_members
  set last_read_at=now()
  where conversation_id=p_conversation_id and user_id=auth.uid();

  return query
  select dm.id,dm.sender_id,
         extensions.pgp_sym_decrypt(dm.encrypted_body,k.encryption_key),
         dm.created_at,
         dm.sender_id=auth.uid()
  from public.direct_messages dm
  join a2c_private.direct_conversation_keys k on k.conversation_id=dm.conversation_id
  where dm.conversation_id=p_conversation_id and dm.deleted_at is null
  order by dm.created_at asc
  limit greatest(1,least(coalesce(p_limit,100),300));
end $$;

grant execute on function public.a2c_search_users_by_username_v42(text) to authenticated;
grant execute on function public.a2c_send_friend_request_v42(uuid) to authenticated;
grant execute on function public.a2c_respond_friend_request_v42(uuid,boolean) to authenticated;
grant execute on function public.a2c_list_friends_v42() to authenticated;
grant execute on function public.a2c_invite_resource_friend_v42(uuid,uuid) to authenticated;
grant execute on function public.a2c_get_or_create_conversation_v42(uuid) to authenticated;
grant execute on function public.a2c_send_message_v42(uuid,text) to authenticated;
grant execute on function public.a2c_list_conversations_v42() to authenticated;
grant execute on function public.a2c_list_messages_v42(uuid,integer) to authenticated;

-- A2C Finanzas 4.2.1 - Reparación de pgcrypto en Supabase
create extension if not exists pgcrypto with schema extensions;

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

grant execute on function public.a2c_get_or_create_conversation_v42(uuid) to authenticated;
grant execute on function public.a2c_send_message_v42(uuid,text) to authenticated;
grant execute on function public.a2c_list_conversations_v42() to authenticated;
grant execute on function public.a2c_list_messages_v42(uuid,integer) to authenticated;

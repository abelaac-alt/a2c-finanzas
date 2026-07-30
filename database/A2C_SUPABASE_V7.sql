-- A2C Finanzas 7.0
-- Arquitectura limpia para web, Android, chat, gastos compartidos y widgets.
-- Ejecutar completa en Supabase SQL Editor.

begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists a2c_private;
revoke all on schema a2c_private from public, anon, authenticated;

-- Compatibilidad mínima con las tablas principales existentes.
alter table public.profiles
  add column if not exists username text,
  add column if not exists active boolean not null default true,
  add column if not exists avatar_path text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_device text;

alter table public.finance_transactions
  add column if not exists budget_category text,
  add column if not exists fuel_liters numeric,
  add column if not exists fuel_price_per_liter_milli bigint,
  add column if not exists fuel_km numeric,
  add column if not exists fuel_consumption_l100km numeric,
  add column if not exists receipt_path text;

alter table public.notifications
  add column if not exists message text,
  add column if not exists read_at timestamptz;

alter table public.budgets_v67
  add column if not exists series_id uuid,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table public.scheduled_expenses_v66
  add column if not exists day_of_month integer,
  add column if not exists weekday integer,
  add column if not exists updated_at timestamptz not null default now();


-- Conversaciones nuevas, aisladas del código histórico.
create table if not exists public.a2c_conversations_v7 (
  id uuid primary key default extensions.gen_random_uuid(),
  pair_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.a2c_conversation_members_v7 (
  conversation_id uuid not null references public.a2c_conversations_v7(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);

create table if not exists a2c_private.conversation_keys_v7 (
  conversation_id uuid primary key references public.a2c_conversations_v7(id) on delete cascade,
  encryption_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.a2c_messages_v7 (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.a2c_conversations_v7(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  encrypted_body bytea not null,
  message_type text not null default 'text' check(message_type in ('text','shared_expense','system')),
  related_share_id uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists a2c_messages_v7_conversation_created_idx
  on public.a2c_messages_v7(conversation_id,created_at);

-- Nuevo modelo de gastos compartidos con versiones explícitas.
create table if not exists public.a2c_shared_expenses_v7 (
  id uuid primary key default extensions.gen_random_uuid(),
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  participant_user_id uuid references auth.users(id) on delete cascade,
  participant_name text,
  amount_cents bigint not null check(amount_cents > 0),
  status text not null default 'pending'
    check(status in ('pending','paid','settled','cancelled','superseded')),
  version integer not null default 1 check(version > 0),
  replaces_id uuid references public.a2c_shared_expenses_v7(id) on delete set null,
  payer_transaction_id uuid references public.finance_transactions(id) on delete set null,
  owner_transaction_id uuid references public.finance_transactions(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint a2c_shared_expense_participant_v7 check(
    (participant_user_id is not null and participant_name is null)
    or
    (participant_user_id is null and nullif(btrim(participant_name),'') is not null)
  )
);

create index if not exists a2c_shared_expenses_v7_transaction_idx
  on public.a2c_shared_expenses_v7(transaction_id,created_at);
create index if not exists a2c_shared_expenses_v7_participant_idx
  on public.a2c_shared_expenses_v7(participant_user_id,status);
create index if not exists a2c_shared_expenses_v7_owner_idx
  on public.a2c_shared_expenses_v7(owner_id,status);

-- RLS: lectura únicamente para participantes. Escrituras mediante RPC seguras.
alter table public.a2c_conversations_v7 enable row level security;
alter table public.a2c_conversation_members_v7 enable row level security;
alter table public.a2c_messages_v7 enable row level security;
alter table public.a2c_shared_expenses_v7 enable row level security;

revoke all on public.a2c_messages_v7 from anon, authenticated;
revoke all on a2c_private.conversation_keys_v7 from anon, authenticated;
revoke insert,update,delete on public.a2c_shared_expenses_v7 from anon, authenticated;

drop policy if exists "a2c v7 conversation members read" on public.a2c_conversations_v7;
create policy "a2c v7 conversation members read"
on public.a2c_conversations_v7 for select
using (
  exists(select 1 from public.a2c_conversation_members_v7 m
    where m.conversation_id=id and m.user_id=auth.uid())
);

drop policy if exists "a2c v7 own memberships read" on public.a2c_conversation_members_v7;
create policy "a2c v7 own memberships read"
on public.a2c_conversation_members_v7 for select
using(user_id=auth.uid());

drop policy if exists "a2c v7 shared participants read" on public.a2c_shared_expenses_v7;
create policy "a2c v7 shared participants read"
on public.a2c_shared_expenses_v7 for select
using(owner_id=auth.uid() or participant_user_id=auth.uid());

-- Utilidad interna: comprueba amistad aceptada.
create or replace function public.a2c_v7_are_friends(p_left uuid,p_right uuid)
returns boolean
language sql
security definer
set search_path=public
stable
as $$
  select exists(
    select 1 from public.friendships f
    where f.status='accepted'
      and ((f.requester_id=p_left and f.addressee_id=p_right)
        or (f.requester_id=p_right and f.addressee_id=p_left))
  );
$$;

create or replace function public.a2c_v7_get_conversation(p_friend_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,a2c_private,extensions
as $$
declare
  v_user uuid:=auth.uid();
  v_pair text;
  v_id uuid;
begin
  if v_user is null or p_friend_id is null or p_friend_id=v_user then
    raise exception 'Usuario no válido';
  end if;
  if not public.a2c_v7_are_friends(v_user,p_friend_id) then
    raise exception 'Solo puedes conversar con amigos aceptados';
  end if;

  v_pair:=least(v_user::text,p_friend_id::text)||':'||greatest(v_user::text,p_friend_id::text);
  insert into public.a2c_conversations_v7(pair_key)
  values(v_pair)
  on conflict(pair_key) do update set updated_at=public.a2c_conversations_v7.updated_at
  returning id into v_id;

  insert into public.a2c_conversation_members_v7(conversation_id,user_id)
  values(v_id,v_user),(v_id,p_friend_id)
  on conflict do nothing;

  insert into a2c_private.conversation_keys_v7(conversation_id,encryption_key)
  values(v_id,encode(extensions.gen_random_bytes(32),'hex'))
  on conflict do nothing;

  return v_id;
end;
$$;

create or replace function public.a2c_v7_insert_message(
  p_conversation_id uuid,
  p_sender_id uuid,
  p_body text,
  p_type text default 'text',
  p_share_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public,a2c_private,extensions
as $$
declare
  v_key text;
  v_id uuid;
begin
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 4000 then
    raise exception 'Mensaje no válido';
  end if;
  if not exists(select 1 from public.a2c_conversation_members_v7
    where conversation_id=p_conversation_id and user_id=p_sender_id) then
    raise exception 'El remitente no pertenece a la conversación';
  end if;

  select encryption_key into v_key
  from a2c_private.conversation_keys_v7
  where conversation_id=p_conversation_id;

  insert into public.a2c_messages_v7(
    conversation_id,sender_id,encrypted_body,message_type,related_share_id
  ) values(
    p_conversation_id,p_sender_id,
    extensions.pgp_sym_encrypt(btrim(p_body),v_key,'cipher-algo=aes256,compress-algo=1'),
    coalesce(p_type,'text'),p_share_id
  ) returning id into v_id;

  update public.a2c_conversations_v7
  set updated_at=now() where id=p_conversation_id;
  return v_id;
end;
$$;

revoke all on function public.a2c_v7_insert_message(uuid,uuid,text,text,uuid) from public,anon,authenticated;

-- Amigos.
create or replace function public.a2c_v7_search_people(p_query text)
returns table(
  id uuid,username text,display_name text,avatar_path text,
  friendship_id uuid,friendship_status text,direction text
)
language sql
security definer
set search_path=public
as $$
  with q as(select lower(trim(leading '@' from coalesce(p_query,''))) value)
  select p.id,p.username,p.display_name,p.avatar_path,f.id,f.status,
    case when f.requester_id=auth.uid() then 'outgoing'
         when f.addressee_id=auth.uid() then 'incoming' end
  from public.profiles p cross join q
  left join public.friendships f on
    (f.requester_id=auth.uid() and f.addressee_id=p.id)
    or (f.addressee_id=auth.uid() and f.requester_id=p.id)
  where p.id<>auth.uid() and coalesce(p.active,true)=true
    and q.value<>'' and lower(coalesce(p.username,'')) like q.value||'%'
  order by case when lower(p.username)=q.value then 0 else 1 end,lower(p.username)
  limit 30;
$$;

create or replace function public.a2c_v7_send_friend_request(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare v_existing public.friendships%rowtype;
begin
  if p_user_id is null or p_user_id=auth.uid() then raise exception 'Usuario no válido'; end if;
  select * into v_existing from public.friendships
  where (requester_id=auth.uid() and addressee_id=p_user_id)
     or (requester_id=p_user_id and addressee_id=auth.uid()) limit 1;

  if found then
    if v_existing.status='accepted' then return 'accepted'; end if;
    if v_existing.status='pending' and v_existing.addressee_id=auth.uid() then
      update public.friendships set status='accepted',responded_at=now() where id=v_existing.id;
      return 'accepted';
    end if;
    update public.friendships
    set requester_id=auth.uid(),addressee_id=p_user_id,status='pending',responded_at=null
    where id=v_existing.id;
  else
    insert into public.friendships(requester_id,addressee_id,status)
    values(auth.uid(),p_user_id,'pending');
  end if;

  delete from public.notifications
  where user_id=p_user_id and type='friend_request' and related_id=auth.uid();
  insert into public.notifications(user_id,type,title,message,related_id)
  values(p_user_id,'friend_request','Nueva solicitud de amistad',
    'Te han enviado una solicitud de amistad.',auth.uid());
  return 'sent';
end;
$$;

create or replace function public.a2c_v7_respond_friend_request(p_friendship_id uuid,p_accept boolean)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.friendships
  set status=case when p_accept then 'accepted' else 'rejected' end,responded_at=now()
  where id=p_friendship_id and addressee_id=auth.uid() and status='pending';
  if not found then raise exception 'Solicitud no disponible'; end if;
end;
$$;

create or replace function public.a2c_v7_list_friends()
returns table(id uuid,username text,display_name text,avatar_path text)
language sql
security definer
set search_path=public
as $$
  select p.id,p.username,p.display_name,p.avatar_path
  from public.friendships f
  join public.profiles p on p.id=case when f.requester_id=auth.uid()
    then f.addressee_id else f.requester_id end
  where f.status='accepted'
    and (f.requester_id=auth.uid() or f.addressee_id=auth.uid())
  order by lower(coalesce(p.display_name,p.username));
$$;

-- Mensajes cifrados.
create or replace function public.a2c_v7_send_message(p_friend_id uuid,p_body text)
returns uuid
language plpgsql
security definer
set search_path=public,a2c_private,extensions
as $$
declare v_conversation uuid;v_id uuid;v_name text;
begin
  v_conversation:=public.a2c_v7_get_conversation(p_friend_id);
  v_id:=public.a2c_v7_insert_message(v_conversation,auth.uid(),p_body,'text',null);
  select coalesce(display_name,username,'Un amigo') into v_name
  from public.profiles where id=auth.uid();
  insert into public.notifications(user_id,type,title,message,related_id)
  values(p_friend_id,'direct_message','Nuevo mensaje',
    v_name||' te ha enviado un mensaje.',v_conversation);
  return v_id;
end;
$$;

create or replace function public.a2c_v7_list_conversations()
returns table(
  conversation_id uuid,friend_id uuid,username text,display_name text,avatar_path text,
  last_message text,last_message_at timestamptz,unread_count bigint
)
language sql
security definer
set search_path=public,a2c_private,extensions
as $$
  select c.id,friend.user_id,p.username,p.display_name,p.avatar_path,
    case when lm.deleted_at is not null then 'Mensaje eliminado'
         when lm.id is null then ''
         else extensions.pgp_sym_decrypt(lm.encrypted_body,k.encryption_key) end,
    lm.created_at,
    (select count(*) from public.a2c_messages_v7 u
      where u.conversation_id=c.id and u.sender_id<>auth.uid()
        and u.created_at>coalesce(me.last_read_at,'epoch'::timestamptz))
  from public.a2c_conversation_members_v7 me
  join public.a2c_conversations_v7 c on c.id=me.conversation_id
  join public.a2c_conversation_members_v7 friend
    on friend.conversation_id=c.id and friend.user_id<>auth.uid()
  join public.profiles p on p.id=friend.user_id
  join a2c_private.conversation_keys_v7 k on k.conversation_id=c.id
  left join lateral(
    select m.* from public.a2c_messages_v7 m
    where m.conversation_id=c.id order by m.created_at desc limit 1
  ) lm on true
  where me.user_id=auth.uid()
  order by coalesce(lm.created_at,c.updated_at) desc;
$$;

create or replace function public.a2c_v7_list_messages(p_conversation_id uuid,p_limit integer default 200)
returns table(
  id uuid,sender_id uuid,body text,message_type text,related_share_id uuid,
  created_at timestamptz,mine boolean
)
language plpgsql
security definer
set search_path=public,a2c_private,extensions
as $$
begin
  if not exists(select 1 from public.a2c_conversation_members_v7
    where conversation_id=p_conversation_id and user_id=auth.uid()) then
    raise exception 'No tienes acceso a esta conversación';
  end if;
  update public.a2c_conversation_members_v7 set last_read_at=now()
  where conversation_id=p_conversation_id and user_id=auth.uid();

  return query
  select m.id,m.sender_id,
    case when m.deleted_at is not null then 'Mensaje eliminado'
         else extensions.pgp_sym_decrypt(m.encrypted_body,k.encryption_key) end,
    m.message_type,m.related_share_id,m.created_at,m.sender_id=auth.uid()
  from public.a2c_messages_v7 m
  join a2c_private.conversation_keys_v7 k on k.conversation_id=m.conversation_id
  where m.conversation_id=p_conversation_id
  order by m.created_at asc
  limit greatest(1,least(coalesce(p_limit,200),500));
end;
$$;

-- Gastos compartidos.
create or replace function public.a2c_v7_create_shared_expenses(
  p_transaction_id uuid,p_participants jsonb
)
returns setof public.a2c_shared_expenses_v7
language plpgsql
security definer
set search_path=public,a2c_private,extensions
as $$
declare
  v_tx public.finance_transactions%rowtype;
  v_item jsonb;v_user uuid;v_name text;v_amount bigint;v_sum bigint:=0;
  v_share public.a2c_shared_expenses_v7%rowtype;v_conversation uuid;v_owner_name text;
begin
  select * into v_tx from public.finance_transactions
  where id=p_transaction_id and creator_id=auth.uid() and kind='expense';
  if not found then raise exception 'Gasto no encontrado'; end if;
  if exists(select 1 from public.a2c_shared_expenses_v7
    where transaction_id=p_transaction_id and status in('pending','paid','settled')) then
    raise exception 'Este gasto ya está compartido';
  end if;
  if jsonb_typeof(coalesce(p_participants,'[]'::jsonb))<>'array' then
    raise exception 'Participantes no válidos';
  end if;

  select coalesce(display_name,username,'Un amigo') into v_owner_name
  from public.profiles where id=auth.uid();

  for v_item in select value from jsonb_array_elements(p_participants) loop
    v_user:=nullif(v_item->>'user_id','')::uuid;
    v_name:=nullif(btrim(coalesce(v_item->>'name','')),'');
    v_amount:=coalesce((v_item->>'amount_cents')::bigint,0);
    if v_amount<=0 then continue; end if;
    v_sum:=v_sum+v_amount;
    if v_sum>v_tx.amount_cents then raise exception 'La suma supera el total del gasto'; end if;

    if v_user is not null then
      if v_user=auth.uid() or not public.a2c_v7_are_friends(auth.uid(),v_user) then
        raise exception 'Participante no válido';
      end if;
      v_name:=null;
    elsif v_name is null then
      raise exception 'Indica el nombre de la persona externa';
    end if;

    insert into public.a2c_shared_expenses_v7(
      transaction_id,owner_id,participant_user_id,participant_name,amount_cents
    ) values(p_transaction_id,auth.uid(),v_user,v_name,v_amount)
    returning * into v_share;

    if v_user is not null then
      v_conversation:=public.a2c_v7_get_conversation(v_user);
      perform public.a2c_v7_insert_message(
        v_conversation,auth.uid(),
        v_owner_name||' ha compartido "'||coalesce(v_tx.concept,'Gasto')||'". Tu parte es '||
          to_char(v_amount/100.0,'FM999999990D00')||' €.',
        'shared_expense',v_share.id
      );
      insert into public.notifications(user_id,type,title,message,related_id)
      values(v_user,'shared_expense','Nuevo gasto compartido',
        v_owner_name||' te solicita '||to_char(v_amount/100.0,'FM999999990D00')||' €.',v_share.id);
    end if;
    return next v_share;
  end loop;
end;
$$;

create or replace function public.a2c_v7_update_shared_expense(p_share_id uuid,p_amount_cents bigint)
returns uuid
language plpgsql
security definer
set search_path=public,a2c_private,extensions
as $$
declare
  v_old public.a2c_shared_expenses_v7%rowtype;v_new public.a2c_shared_expenses_v7%rowtype;
  v_tx public.finance_transactions%rowtype;v_conversation uuid;v_name text;
begin
  select * into v_old from public.a2c_shared_expenses_v7
  where id=p_share_id and owner_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Reparto no editable'; end if;
  select * into v_tx from public.finance_transactions where id=v_old.transaction_id;
  if p_amount_cents<=0 or p_amount_cents>v_tx.amount_cents then raise exception 'Importe no válido'; end if;

  update public.a2c_shared_expenses_v7
  set status='superseded',updated_at=now() where id=v_old.id;
  insert into public.a2c_shared_expenses_v7(
    transaction_id,owner_id,participant_user_id,participant_name,amount_cents,version,replaces_id
  ) values(
    v_old.transaction_id,v_old.owner_id,v_old.participant_user_id,v_old.participant_name,
    p_amount_cents,v_old.version+1,v_old.id
  ) returning * into v_new;

  if v_new.participant_user_id is not null then
    v_conversation:=public.a2c_v7_get_conversation(v_new.participant_user_id);
    select coalesce(display_name,username,'Un amigo') into v_name
    from public.profiles where id=auth.uid();
    perform public.a2c_v7_insert_message(v_conversation,auth.uid(),
      v_name||' ha actualizado "'||coalesce(v_tx.concept,'Gasto')||'". El nuevo importe es '||
      to_char(p_amount_cents/100.0,'FM999999990D00')||' €. La versión anterior queda anulada.',
      'shared_expense',v_new.id);
    insert into public.notifications(user_id,type,title,message,related_id)
    values(v_new.participant_user_id,'shared_expense','Gasto compartido actualizado',
      'Tu nueva parte es '||to_char(p_amount_cents/100.0,'FM999999990D00')||' €.',v_new.id);
  end if;
  return v_new.id;
end;
$$;

create or replace function public.a2c_v7_pay_shared_expense(
  p_share_id uuid,p_resource_id uuid default null,p_payment_method text default 'bank'
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_share public.a2c_shared_expenses_v7%rowtype;v_tx public.finance_transactions%rowtype;
  v_payment uuid;v_income uuid;v_name text;
begin
  select * into v_share from public.a2c_shared_expenses_v7
  where id=p_share_id and participant_user_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Pago no disponible'; end if;
  select * into v_tx from public.finance_transactions where id=v_share.transaction_id;

  insert into public.finance_transactions(
    creator_id,resource_id,kind,payment_method,amount_cents,concept,occurred_on,notes
  ) values(
    auth.uid(),p_resource_id,'expense',coalesce(nullif(p_payment_method,''),'bank'),
    v_share.amount_cents,'Pago a amigo · '||coalesce(v_tx.concept,'Gasto compartido'),current_date,
    '[A2C-SHARE-PAY:'||v_share.id||']'
  ) returning id into v_payment;

  select coalesce(display_name,username,'Un amigo') into v_name
  from public.profiles where id=auth.uid();
  insert into public.finance_transactions(
    creator_id,kind,payment_method,amount_cents,concept,occurred_on,notes
  ) values(
    v_share.owner_id,'income',coalesce(nullif(p_payment_method,''),'bank'),
    v_share.amount_cents,'Cobro de '||v_name||' · '||coalesce(v_tx.concept,'Gasto compartido'),
    current_date,'[A2C-SHARE-INCOME:'||v_share.id||']'
  ) returning id into v_income;

  update public.a2c_shared_expenses_v7
  set status='paid',paid_at=now(),payer_transaction_id=v_payment,
      owner_transaction_id=v_income,updated_at=now() where id=v_share.id;
  insert into public.notifications(user_id,type,title,message,related_id)
  values(v_share.owner_id,'shared_expense_paid','Gasto compartido pagado',
    v_name||' ha pagado '||to_char(v_share.amount_cents/100.0,'FM999999990D00')||' €.',v_share.id);
  return v_payment;
end;
$$;

create or replace function public.a2c_v7_settle_shared_expense(p_share_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_share public.a2c_shared_expenses_v7%rowtype;v_tx public.finance_transactions%rowtype;
  v_income uuid;v_name text;
begin
  select * into v_share from public.a2c_shared_expenses_v7
  where id=p_share_id and owner_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Reparto no disponible'; end if;
  select * into v_tx from public.finance_transactions where id=v_share.transaction_id;
  v_name:=coalesce(v_share.participant_name,
    (select coalesce(display_name,username,'Amigo') from public.profiles where id=v_share.participant_user_id),
    'Persona');

  insert into public.finance_transactions(
    creator_id,kind,payment_method,amount_cents,concept,occurred_on,notes
  ) values(
    v_share.owner_id,'income','cash',v_share.amount_cents,
    'Cobro manual de '||v_name||' · '||coalesce(v_tx.concept,'Gasto compartido'),
    current_date,'[A2C-SHARE-SETTLE:'||v_share.id||']'
  ) returning id into v_income;

  update public.a2c_shared_expenses_v7
  set status='settled',paid_at=now(),owner_transaction_id=v_income,updated_at=now()
  where id=v_share.id;
  if v_share.participant_user_id is not null then
    insert into public.notifications(user_id,type,title,message,related_id)
    values(v_share.participant_user_id,'shared_expense_settled','Gasto liquidado manualmente',
      'El creador ha marcado tu parte como liquidada. No se ha descontado de tu saldo.',v_share.id);
  end if;
  return v_income;
end;
$$;

create or replace function public.a2c_v7_cancel_shared_expense(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_share public.a2c_shared_expenses_v7%rowtype;
begin
  select * into v_share from public.a2c_shared_expenses_v7
  where id=p_share_id and owner_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Reparto no cancelable'; end if;
  update public.a2c_shared_expenses_v7 set status='cancelled',updated_at=now() where id=p_share_id;
  if v_share.participant_user_id is not null then
    insert into public.notifications(user_id,type,title,message,related_id)
    values(v_share.participant_user_id,'shared_expense_cancelled','Gasto compartido cancelado',
      'El creador ha cancelado este reparto.',p_share_id);
  end if;
end;
$$;

create or replace function public.a2c_v7_conversation_shares(p_conversation_id uuid)
returns table(
  id uuid,transaction_id uuid,concept text,total_cents bigint,amount_cents bigint,
  status text,version integer,replaces_id uuid,owner_id uuid,participant_user_id uuid,
  created_at timestamptz,can_pay boolean,can_manage boolean
)
language sql
security definer
set search_path=public
as $$
  with people as(
    select array_agg(user_id) users from public.a2c_conversation_members_v7
    where conversation_id=p_conversation_id
      and exists(select 1 from public.a2c_conversation_members_v7
        where conversation_id=p_conversation_id and user_id=auth.uid())
  )
  select s.id,s.transaction_id,t.concept,t.amount_cents,s.amount_cents,s.status,s.version,
    s.replaces_id,s.owner_id,s.participant_user_id,s.created_at,
    s.participant_user_id=auth.uid() and s.status='pending',
    s.owner_id=auth.uid() and s.status='pending'
  from public.a2c_shared_expenses_v7 s
  join public.finance_transactions t on t.id=s.transaction_id
  cross join people p
  where s.owner_id=any(p.users) and s.participant_user_id=any(p.users)
  order by s.created_at asc;
$$;

-- Datos compactos para widgets Android.
create or replace function public.a2c_widget_snapshot_v7()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();v_month text:=to_char(current_date,'YYYY-MM');v_result jsonb;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  select jsonb_build_object(
    'available_cents',coalesce((select sum(case when kind='income' then amount_cents else -amount_cents end)
      from public.finance_transactions where creator_id=v_user),0),
    'month_income_cents',coalesce((select sum(amount_cents) from public.finance_transactions
      where creator_id=v_user and kind='income' and to_char(occurred_on,'YYYY-MM')=v_month),0),
    'month_expenses_cents',coalesce((select sum(amount_cents) from public.finance_transactions
      where creator_id=v_user and kind='expense' and to_char(occurred_on,'YYYY-MM')=v_month),0),
    'month_saving_cents',coalesce((select sum(amount_cents) from public.finance_transactions
      where creator_id=v_user and kind='saving' and to_char(occurred_on,'YYYY-MM')=v_month),0),
    'month_investment_cents',coalesce((select sum(amount_cents) from public.finance_transactions
      where creator_id=v_user and kind='investment' and to_char(occurred_on,'YYYY-MM')=v_month),0),
    'debts_owed_cents',coalesce((select sum(amount_cents) from public.a2c_shared_expenses_v7
      where participant_user_id=v_user and status='pending'),0),
    'debts_receivable_cents',coalesce((select sum(amount_cents) from public.a2c_shared_expenses_v7
      where owner_id=v_user and status='pending'),0),
    'latest_expense',(select coalesce(jsonb_build_object(
      'concept',coalesce(concept,merchant,'Gasto'),'amount_cents',amount_cents,'date',occurred_on
    ),'{}'::jsonb) from public.finance_transactions
      where creator_id=v_user and kind='expense' order by occurred_on desc,created_at desc limit 1),
    'scheduled',coalesce((select jsonb_agg(jsonb_build_object(
      'concept',concept,'amount_cents',amount_cents,'next_run',next_run
    ) order by next_run) from public.scheduled_expenses_v66
      where user_id=v_user and active=true and next_run>=current_date limit 3),'[]'::jsonb),
    'budgets',coalesce((select jsonb_agg(jsonb_build_object(
      'name',b.name,'amount_cents',b.amount_cents,
      'spent_cents',coalesce((select sum(t.amount_cents) from public.finance_transactions t
        where t.creator_id=v_user and t.kind='expense' and t.budget_category=b.category_key
          and to_char(t.occurred_on,'YYYY-MM')=b.period_month),0)
    )) from public.budgets_v67 b where b.user_id=v_user and b.active=true and b.period_month=v_month),'[]'::jsonb),
    'fuel_30d',jsonb_build_object(
      'liters',coalesce((select sum(fuel_liters) from public.finance_transactions
        where creator_id=v_user and kind='expense' and fuel_liters is not null
          and occurred_on>=current_date-29),0),
      'total_cents',coalesce((select sum(amount_cents) from public.finance_transactions
        where creator_id=v_user and kind='expense' and fuel_liters is not null
          and occurred_on>=current_date-29),0),
      'average_milli',coalesce((select round(sum(amount_cents)*10000.0/nullif(sum(fuel_liters),0))::bigint
        from public.finance_transactions where creator_id=v_user and kind='expense'
          and fuel_liters is not null and occurred_on>=current_date-29),0)
    )
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.a2c_v7_touch_last_seen(p_device text default null)
returns void language sql security definer set search_path=public as $$
  update public.profiles set last_seen_at=now(),last_device=coalesce(nullif(p_device,''),last_device)
  where id=auth.uid();
$$;

grant execute on function public.a2c_v7_are_friends(uuid,uuid) to authenticated;
grant execute on function public.a2c_v7_get_conversation(uuid) to authenticated;
grant execute on function public.a2c_v7_search_people(text) to authenticated;
grant execute on function public.a2c_v7_send_friend_request(uuid) to authenticated;
grant execute on function public.a2c_v7_respond_friend_request(uuid,boolean) to authenticated;
grant execute on function public.a2c_v7_list_friends() to authenticated;
grant execute on function public.a2c_v7_send_message(uuid,text) to authenticated;
grant execute on function public.a2c_v7_list_conversations() to authenticated;
grant execute on function public.a2c_v7_list_messages(uuid,integer) to authenticated;
grant execute on function public.a2c_v7_create_shared_expenses(uuid,jsonb) to authenticated;
grant execute on function public.a2c_v7_update_shared_expense(uuid,bigint) to authenticated;
grant execute on function public.a2c_v7_pay_shared_expense(uuid,uuid,text) to authenticated;
grant execute on function public.a2c_v7_settle_shared_expense(uuid) to authenticated;
grant execute on function public.a2c_v7_cancel_shared_expense(uuid) to authenticated;
grant execute on function public.a2c_v7_conversation_shares(uuid) to authenticated;
grant execute on function public.a2c_widget_snapshot_v7() to authenticated;
grant execute on function public.a2c_v7_touch_last_seen(text) to authenticated;

commit;

-- A2C Finanzas 5.2
-- Compartir gastos con amigos, pago desde chat y gestión manual por el creador.

begin;

-- Evita que triggers antiguos generen avisos duplicados.
drop trigger if exists a2c_notify_money_request_v70 on public.expense_splits;
drop trigger if exists a2c_notify_money_request_v512 on public.expense_splits;
drop trigger if exists a2c_notify_money_request on public.expense_splits;
drop trigger if exists notify_money_request on public.expense_splits;
drop trigger if exists expense_split_notification on public.expense_splits;

alter table public.notifications
  drop constraint if exists notifications_expense_split_unique;

drop index if exists public.notifications_expense_split_unique;

alter table public.expense_splits
  add column if not exists paid_at timestamptz,
  add column if not exists payment_transaction_id uuid,
  add column if not exists reimbursement_transaction_id uuid,
  add column if not exists paid_manually boolean not null default false;

create index if not exists notifications_expense_split_lookup
on public.notifications(user_id,type,related_id);

create or replace function public.a2c_share_expense_with_friend_v52(
  p_transaction_id uuid,
  p_friend_id uuid,
  p_shared_amount_cents bigint
)
returns uuid
language plpgsql
security definer
set search_path=public,a2c_private,extensions
as $$
declare
  tx public.finance_transactions%rowtype;
  conversation uuid;
  split_id uuid;
  share_id uuid;
  message_key text;
  sender_name text;
  body_text text;
begin
  select * into tx
  from public.finance_transactions
  where id=p_transaction_id
    and creator_id=auth.uid()
    and kind='expense';

  if not found then
    raise exception 'No se encontró el gasto';
  end if;

  if p_shared_amount_cents is null
     or p_shared_amount_cents<=0
     or p_shared_amount_cents>tx.amount_cents then
    raise exception 'El importe compartido no es válido';
  end if;

  if not exists (
    select 1 from public.friendships f
    where f.status='accepted'
      and (
        (f.requester_id=auth.uid() and f.addressee_id=p_friend_id)
        or
        (f.addressee_id=auth.uid() and f.requester_id=p_friend_id)
      )
  ) then
    raise exception 'Solo puedes compartir gastos con amigos';
  end if;

  conversation=public.a2c_get_or_create_conversation_v42(p_friend_id);

  select id into split_id
  from public.expense_splits
  where transaction_id=tx.id
    and owner_id=auth.uid()
    and debtor_user_id=p_friend_id
  limit 1;

  if split_id is null then
    insert into public.expense_splits(
      owner_id,
      transaction_id,
      debtor_user_id,
      person_name,
      amount_cents,
      status,
      paid_manually
    )
    select
      auth.uid(),
      tx.id,
      p_friend_id,
      coalesce(p.display_name,p.username,'Amigo'),
      p_shared_amount_cents,
      'pending',
      false
    from public.profiles p
    where p.id=p_friend_id
    returning id into split_id;
  else
    update public.expense_splits
    set amount_cents=p_shared_amount_cents,
        status='pending',
        paid_at=null,
        payment_transaction_id=null,
        reimbursement_transaction_id=null,
        paid_manually=false
    where id=split_id;
  end if;

  insert into public.transaction_shares(
    transaction_id,
    owner_id,
    friend_id,
    conversation_id,
    split_id
  )
  values(
    tx.id,
    auth.uid(),
    p_friend_id,
    conversation,
    split_id
  )
  on conflict(transaction_id,friend_id)
  do update set
    conversation_id=excluded.conversation_id,
    split_id=excluded.split_id,
    created_at=now()
  returning id into share_id;

  select encryption_key into message_key
  from a2c_private.direct_conversation_keys
  where conversation_id=conversation;

  select coalesce(display_name,username,'Un amigo')
  into sender_name
  from public.profiles
  where id=auth.uid();

  body_text=coalesce(sender_name,'Un amigo')||
    ' ha compartido el gasto "'||
    coalesce(tx.concept,'Gasto compartido')||
    '". Tu parte pendiente es '||
    to_char(p_shared_amount_cents/100.0,'FM999999990D00')||
    ' €.';

  insert into public.direct_messages(
    conversation_id,
    sender_id,
    encrypted_body
  )
  values(
    conversation,
    auth.uid(),
    extensions.pgp_sym_encrypt(
      body_text,
      message_key,
      'cipher-algo=aes256,compress-algo=1'
    )
  );

  update public.direct_conversations
  set updated_at=now()
  where id=conversation;

  delete from public.notifications
  where user_id=p_friend_id
    and type in ('money_request','shared_expense')
    and related_id=split_id;

  insert into public.notifications(
    user_id,
    type,
    title,
    message,
    related_id
  )
  values(
    p_friend_id,
    'shared_expense',
    'Gasto compartido pendiente',
    coalesce(sender_name,'Un amigo')||
      ' te solicita '||
      to_char(p_shared_amount_cents/100.0,'FM999999990D00')||
      ' €.',
    split_id
  );

  return split_id;
end;
$$;

create or replace function public.a2c_update_shared_expense_v52(
  p_split_id uuid,
  p_amount_cents bigint
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  split_row public.expense_splits%rowtype;
  tx_amount bigint;
  owner_name text;
begin
  select * into split_row
  from public.expense_splits
  where id=p_split_id
    and owner_id=auth.uid()
    and status='pending'
  for update;

  if not found then
    raise exception 'El gasto compartido ya no se puede editar';
  end if;

  select amount_cents into tx_amount
  from public.finance_transactions
  where id=split_row.transaction_id;

  if p_amount_cents<=0 or p_amount_cents>tx_amount then
    raise exception 'El importe no es válido';
  end if;

  update public.expense_splits
  set amount_cents=p_amount_cents
  where id=p_split_id;

  select coalesce(display_name,username,'Un amigo')
  into owner_name
  from public.profiles
  where id=auth.uid();

  delete from public.notifications
  where user_id=split_row.debtor_user_id
    and type='shared_expense'
    and related_id=p_split_id;

  insert into public.notifications(
    user_id,type,title,message,related_id
  )
  values(
    split_row.debtor_user_id,
    'shared_expense',
    'Gasto compartido actualizado',
    owner_name||
      ' ha actualizado tu parte a '||
      to_char(p_amount_cents/100.0,'FM999999990D00')||
      ' €.',
    p_split_id
  );
end;
$$;

create or replace function public.a2c_pay_shared_expense_v52(
  p_split_id uuid,
  p_resource_id uuid default null,
  p_payment_method text default 'bank'
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  split_row public.expense_splits%rowtype;
  original_tx public.finance_transactions%rowtype;
  payer_name text;
  payment_id uuid;
  reimbursement_id uuid;
begin
  select * into split_row
  from public.expense_splits
  where id=p_split_id
    and debtor_user_id=auth.uid()
    and status='pending'
  for update;

  if not found then
    raise exception 'El pago ya no está pendiente';
  end if;

  select * into original_tx
  from public.finance_transactions
  where id=split_row.transaction_id;

  if p_resource_id is not null and not exists (
    select 1
    from public.resources r
    where r.id=p_resource_id
      and (
        r.owner_id=auth.uid()
        or exists (
          select 1 from public.resource_members rm
          where rm.resource_id=r.id
            and rm.user_id=auth.uid()
        )
      )
  ) then
    raise exception 'No puedes utilizar esa cuenta';
  end if;

  insert into public.finance_transactions(
    creator_id,
    resource_id,
    kind,
    category_id,
    merchant,
    payment_method,
    amount_cents,
    concept,
    occurred_on,
    notes
  )
  values(
    auth.uid(),
    p_resource_id,
    'expense',
    null,
    '',
    coalesce(nullif(p_payment_method,''),'bank'),
    split_row.amount_cents,
    'Pago a amigo · '||coalesce(original_tx.concept,'Gasto compartido'),
    current_date,
    'Pago de gasto compartido'
  )
  returning id into payment_id;

  select coalesce(display_name,username,'Un amigo')
  into payer_name
  from public.profiles
  where id=auth.uid();

  insert into public.finance_transactions(
    creator_id,
    resource_id,
    kind,
    category_id,
    merchant,
    payment_method,
    amount_cents,
    concept,
    occurred_on,
    notes
  )
  values(
    split_row.owner_id,
    null,
    'income',
    null,
    '',
    coalesce(nullif(p_payment_method,''),'bank'),
    split_row.amount_cents,
    'Cobro de '||payer_name||' · '||coalesce(original_tx.concept,'Gasto compartido'),
    current_date,
    'Reembolso de gasto compartido'
  )
  returning id into reimbursement_id;

  update public.expense_splits
  set status='paid',
      paid_at=now(),
      paid_manually=false,
      payment_transaction_id=payment_id,
      reimbursement_transaction_id=reimbursement_id
  where id=p_split_id;

  insert into public.notifications(
    user_id,type,title,message,related_id
  )
  values(
    split_row.owner_id,
    'shared_expense_paid',
    'Gasto compartido pagado',
    payer_name||
      ' ha pagado '||
      to_char(split_row.amount_cents/100.0,'FM999999990D00')||
      ' €.',
    p_split_id
  );

  return payment_id;
end;
$$;

create or replace function public.a2c_mark_shared_expense_paid_v52(
  p_split_id uuid,
  p_payment_method text default 'cash'
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  split_row public.expense_splits%rowtype;
  original_tx public.finance_transactions%rowtype;
  debtor_name text;
  payment_id uuid;
  reimbursement_id uuid;
begin
  select * into split_row
  from public.expense_splits
  where id=p_split_id
    and owner_id=auth.uid()
    and status='pending'
  for update;

  if not found then
    raise exception 'El pago ya no está pendiente';
  end if;

  select * into original_tx
  from public.finance_transactions
  where id=split_row.transaction_id;

  select coalesce(display_name,username,'Amigo')
  into debtor_name
  from public.profiles
  where id=split_row.debtor_user_id;

  -- Pago manual: se registra contra la cuenta principal del deudor.
  insert into public.finance_transactions(
    creator_id,
    resource_id,
    kind,
    category_id,
    merchant,
    payment_method,
    amount_cents,
    concept,
    occurred_on,
    notes
  )
  values(
    split_row.debtor_user_id,
    null,
    'expense',
    null,
    '',
    coalesce(nullif(p_payment_method,''),'cash'),
    split_row.amount_cents,
    'Pago a amigo · '||coalesce(original_tx.concept,'Gasto compartido'),
    current_date,
    'Pago manual confirmado por el creador del gasto'
  )
  returning id into payment_id;

  insert into public.finance_transactions(
    creator_id,
    resource_id,
    kind,
    category_id,
    merchant,
    payment_method,
    amount_cents,
    concept,
    occurred_on,
    notes
  )
  values(
    split_row.owner_id,
    null,
    'income',
    null,
    '',
    coalesce(nullif(p_payment_method,''),'cash'),
    split_row.amount_cents,
    'Cobro de '||debtor_name||' · '||coalesce(original_tx.concept,'Gasto compartido'),
    current_date,
    'Cobro manual de gasto compartido'
  )
  returning id into reimbursement_id;

  update public.expense_splits
  set status='paid',
      paid_at=now(),
      paid_manually=true,
      payment_transaction_id=payment_id,
      reimbursement_transaction_id=reimbursement_id
  where id=p_split_id;

  insert into public.notifications(
    user_id,type,title,message,related_id
  )
  values(
    split_row.debtor_user_id,
    'shared_expense_paid',
    'Pago registrado',
    'Se ha registrado manualmente el pago de '||
      to_char(split_row.amount_cents/100.0,'FM999999990D00')||
      ' €.',
    p_split_id
  );

  return payment_id;
end;
$$;

create or replace function public.a2c_list_conversation_transaction_shares_v52(
  p_conversation_id uuid
)
returns table(
  share_id uuid,
  transaction_id uuid,
  owner_id uuid,
  friend_id uuid,
  concept text,
  transaction_amount_cents bigint,
  occurred_on date,
  split_id uuid,
  split_amount_cents bigint,
  split_status text,
  paid_at timestamptz,
  mine_to_pay boolean,
  mine_to_manage boolean
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if not exists (
    select 1
    from public.direct_conversation_members
    where conversation_id=p_conversation_id
      and user_id=auth.uid()
  ) then
    raise exception 'No tienes acceso a esta conversación';
  end if;

  return query
  select
    s.id,
    t.id,
    s.owner_id,
    s.friend_id,
    coalesce(t.concept,'Gasto compartido'),
    t.amount_cents,
    t.occurred_on,
    es.id,
    es.amount_cents,
    es.status,
    es.paid_at,
    (es.debtor_user_id=auth.uid() and es.status='pending'),
    (es.owner_id=auth.uid() and es.status='pending')
  from public.transaction_shares s
  join public.finance_transactions t
    on t.id=s.transaction_id
  join public.expense_splits es
    on es.id=s.split_id
  where s.conversation_id=p_conversation_id
  order by s.created_at asc;
end;
$$;

grant execute on function public.a2c_share_expense_with_friend_v52(uuid,uuid,bigint) to authenticated;
grant execute on function public.a2c_update_shared_expense_v52(uuid,bigint) to authenticated;
grant execute on function public.a2c_pay_shared_expense_v52(uuid,uuid,text) to authenticated;
grant execute on function public.a2c_mark_shared_expense_paid_v52(uuid,text) to authenticated;
grant execute on function public.a2c_list_conversation_transaction_shares_v52(uuid) to authenticated;

commit;

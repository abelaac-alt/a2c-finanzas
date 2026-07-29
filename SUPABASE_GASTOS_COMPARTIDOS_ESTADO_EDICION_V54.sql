-- A2C Finanzas 5.4
-- Estado visible del gasto compartido, liquidación manual sin cargo al amigo,
-- edición y eliminación desde el chat.

begin;

alter table public.expense_splits
  add column if not exists paid_at timestamptz,
  add column if not exists payment_transaction_id uuid,
  add column if not exists reimbursement_transaction_id uuid,
  add column if not exists paid_manually boolean not null default false;

create or replace function public.a2c_mark_expense_split_paid_v53(
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

  -- Liquidación manual:
  -- aumenta el balance del creador, pero NO registra gasto ni descuenta saldo al amigo.
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
    'Cobro manual de '||coalesce(debtor_name,'Amigo')||
      ' · '||coalesce(original_tx.concept,'Gasto compartido'),
    current_date,
    'Liquidación manual. No se ha descontado del saldo del otro usuario.'
  )
  returning id into reimbursement_id;

  update public.expense_splits
  set status='paid',
      paid_at=now(),
      paid_manually=true,
      payment_transaction_id=null,
      reimbursement_transaction_id=reimbursement_id
  where id=p_split_id;

  delete from public.notifications
  where user_id=split_row.debtor_user_id
    and related_id=p_split_id
    and type in ('expense_split','expense_reminder','shared_expense','money_request');

  insert into public.notifications(
    user_id,
    type,
    title,
    message,
    related_id
  )
  values(
    split_row.debtor_user_id,
    'shared_expense_paid',
    'Gasto liquidado manualmente',
    'El creador ha marcado como liquidada tu parte de '||
      to_char(split_row.amount_cents/100.0,'FM999999990D00')||
      ' €. No se ha descontado de tu saldo.',
    p_split_id
  );

  return reimbursement_id;
end;
$$;

create or replace function public.a2c_delete_expense_split_v54(
  p_split_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  split_row public.expense_splits%rowtype;
begin
  select * into split_row
  from public.expense_splits
  where id=p_split_id
    and owner_id=auth.uid();

  if not found then
    raise exception 'No puedes eliminar este reparto';
  end if;

  if split_row.status='paid' then
    raise exception 'No se puede eliminar un reparto ya pagado';
  end if;

  delete from public.notifications
  where related_id=p_split_id
    and user_id=split_row.debtor_user_id
    and type in ('expense_split','expense_reminder','shared_expense','money_request');

  delete from public.transaction_shares
  where split_id=p_split_id;

  delete from public.expense_splits
  where id=p_split_id;
end;
$$;

grant execute on function public.a2c_mark_expense_split_paid_v53(uuid,text) to authenticated;
grant execute on function public.a2c_delete_expense_split_v54(uuid) to authenticated;

commit;

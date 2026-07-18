
-- A2C Finanzas Profesional V4
-- Ejecutar después de schema-clean.sql y pro-migration.sql.
begin;

-- Solo cuatro categorías, exclusivamente para gastos.
delete from public.monthly_budgets;
update public.finance_transactions set category_id=null;
delete from public.finance_categories;

insert into public.finance_categories(user_id,name,icon,kind,sort_order) values
(null,'Combustible','⛽','expense',10),
(null,'Ocio','★','expense',20),
(null,'Comida','●','expense',30),
(null,'Otros','•••','expense',40);

-- Forma de pago, transferencias e información bursátil.
alter table public.finance_transactions
  add column if not exists payment_method text not null default 'bank',
  add column if not exists is_transfer boolean not null default false,
  add column if not exists transfer_group_id uuid,
  add column if not exists transfer_role text,
  add column if not exists investment_isin text,
  add column if not exists investment_quantity numeric(20,8),
  add column if not exists investment_unit_price_cents bigint;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='finance_transactions_payment_method_check'
      and conrelid='public.finance_transactions'::regclass
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_payment_method_check
      check(payment_method in('cash','bank'));
  end if;

  if not exists(
    select 1 from pg_constraint
    where conname='finance_transactions_transfer_role_check'
      and conrelid='public.finance_transactions'::regclass
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_transfer_role_check
      check(transfer_role is null or transfer_role in('source','destination'));
  end if;
end $$;

create index if not exists finance_transactions_transfer_group_idx
on public.finance_transactions(transfer_group_id);

create index if not exists finance_transactions_investment_isin_idx
on public.finance_transactions(investment_isin)
where investment_isin is not null;

-- Depositar en una hucha crea dos movimientos enlazados:
-- salida de la cuenta principal + entrada en la hucha.
create or replace function public.create_piggy_transfer_v4(
  p_piggy_id uuid,
  p_amount_cents bigint,
  p_concept text,
  p_occurred_on date,
  p_notes text default '',
  p_payment_method text default 'bank'
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_group uuid:=gen_random_uuid();
  v_source_id uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if p_amount_cents<=0 then raise exception 'El importe debe ser mayor que cero'; end if;
  if p_payment_method not in('cash','bank') then raise exception 'Forma de pago no válida'; end if;

  if not exists(
    select 1 from public.resources r
    where r.id=p_piggy_id and r.type='piggy'
      and public.can_access_resource(r.id,auth.uid())
  ) then
    raise exception 'No tienes acceso a esta hucha';
  end if;

  insert into public.finance_transactions(
    creator_id,resource_id,kind,amount_cents,concept,occurred_on,notes,payment_method,
    is_transfer,transfer_group_id,transfer_role
  ) values(
    auth.uid(),null,'saving',p_amount_cents,p_concept,p_occurred_on,p_notes,p_payment_method,
    true,v_group,'source'
  ) returning id into v_source_id;

  insert into public.finance_transactions(
    creator_id,resource_id,kind,amount_cents,concept,occurred_on,notes,payment_method,
    is_transfer,transfer_group_id,transfer_role
  ) values(
    auth.uid(),p_piggy_id,'income',p_amount_cents,p_concept,p_occurred_on,p_notes,p_payment_method,
    true,v_group,'destination'
  );

  return v_source_id;
end;
$$;

-- Edita un movimiento y, si es un traspaso, mantiene sincronizada su pareja.
create or replace function public.update_finance_transaction_v4(
  p_transaction_id uuid,
  p_kind text,
  p_category_id uuid,
  p_merchant text,
  p_payment_method text,
  p_amount_cents bigint,
  p_concept text,
  p_occurred_on date,
  p_notes text,
  p_investment_isin text,
  p_investment_quantity numeric,
  p_investment_unit_price_cents bigint
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_tx public.finance_transactions%rowtype;
begin
  select * into v_tx from public.finance_transactions
  where id=p_transaction_id for update;

  if not found then raise exception 'Movimiento no encontrado'; end if;
  if v_tx.creator_id<>auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Solo el creador puede editar el movimiento';
  end if;
  if p_amount_cents<=0 then raise exception 'El importe debe ser mayor que cero'; end if;

  if v_tx.is_transfer then
    update public.finance_transactions
    set amount_cents=p_amount_cents,
        concept=p_concept,
        occurred_on=p_occurred_on,
        notes=coalesce(p_notes,''),
        payment_method=p_payment_method
    where transfer_group_id=v_tx.transfer_group_id;
  else
    update public.finance_transactions
    set kind=p_kind,
        category_id=case when p_kind='expense' then p_category_id else null end,
        merchant=case when p_kind='expense' then coalesce(p_merchant,'') else '' end,
        payment_method=p_payment_method,
        amount_cents=p_amount_cents,
        concept=p_concept,
        occurred_on=p_occurred_on,
        notes=coalesce(p_notes,''),
        investment_isin=case when p_kind='investment' then upper(p_investment_isin) else null end,
        investment_quantity=case when p_kind='investment' then p_investment_quantity else null end,
        investment_unit_price_cents=case when p_kind='investment' then p_investment_unit_price_cents else null end
    where id=p_transaction_id;
  end if;
end;
$$;

create or replace function public.delete_finance_transaction_v4(
  p_transaction_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_tx public.finance_transactions%rowtype;
begin
  select * into v_tx from public.finance_transactions
  where id=p_transaction_id for update;

  if not found then raise exception 'Movimiento no encontrado'; end if;
  if v_tx.creator_id<>auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Solo el creador puede borrar el movimiento';
  end if;

  if v_tx.is_transfer and v_tx.transfer_group_id is not null then
    delete from public.finance_transactions where transfer_group_id=v_tx.transfer_group_id;
  else
    delete from public.finance_transactions where id=p_transaction_id;
  end if;
end;
$$;

grant execute on function public.create_piggy_transfer_v4(uuid,bigint,text,date,text,text) to authenticated;
grant execute on function public.update_finance_transaction_v4(uuid,text,uuid,text,text,bigint,text,date,text,text,numeric,bigint) to authenticated;
grant execute on function public.delete_finance_transaction_v4(uuid) to authenticated;

commit;
notify pgrst,'reload schema';

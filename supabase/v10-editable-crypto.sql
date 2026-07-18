-- A2C Finanzas v21 · edición segura de operaciones cripto
-- Ejecutar después de v8-crypto-wallet.sql.

create or replace function public.a2c_update_crypto_purchase(
  p_transaction_id uuid,
  p_symbol text,
  p_crypto_name text,
  p_quantity numeric,
  p_unit_price_cents bigint,
  p_fee_cents bigint default 0,
  p_fee_mode text default 'add',
  p_resource_id uuid default null
) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_old public.crypto_ledger%rowtype;
  v_old_holding public.crypto_holdings%rowtype;
  v_new_holding public.crypto_holdings%rowtype;
  v_total bigint;
  v_symbol text := upper(trim(p_symbol));
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if p_quantity <= 0 or p_unit_price_cents <= 0 or v_symbol = '' then raise exception 'Datos de compra no válidos'; end if;
  if p_fee_mode not in ('add','subtract') then raise exception 'Modo de comisión no válido'; end if;
  if p_resource_id is not null and not public.can_access_resource(p_resource_id,auth.uid()) then raise exception 'No tienes acceso al elemento'; end if;

  select * into v_old from public.crypto_ledger
  where transaction_id=p_transaction_id and user_id=auth.uid() and action='COMPRA' for update;
  if not found then raise exception 'Compra cripto no encontrada'; end if;

  select * into v_old_holding from public.crypto_holdings
  where user_id=auth.uid() and resource_id is not distinct from v_old.destination_resource_id and symbol=v_old.symbol for update;
  if not found or v_old_holding.quantity < v_old.quantity then
    raise exception 'No puedes editar esta compra porque parte de la cripto ya fue movida o gastada';
  end if;

  update public.crypto_holdings
  set quantity=quantity-v_old.quantity,
      total_cost_cents=greatest(0,total_cost_cents-v_old.cost_basis_cents),updated_at=now()
  where id=v_old_holding.id;

  v_total := round(p_quantity*p_unit_price_cents)::bigint + greatest(coalesce(p_fee_cents,0),0);

  select * into v_new_holding from public.crypto_holdings
  where user_id=auth.uid() and resource_id is not distinct from p_resource_id and symbol=v_symbol for update;
  if found then
    update public.crypto_holdings set quantity=quantity+p_quantity,total_cost_cents=total_cost_cents+v_total,
      crypto_name=trim(p_crypto_name),updated_at=now() where id=v_new_holding.id;
  else
    insert into public.crypto_holdings(user_id,resource_id,symbol,crypto_name,quantity,total_cost_cents)
    values(auth.uid(),p_resource_id,v_symbol,trim(p_crypto_name),p_quantity,v_total);
  end if;

  update public.finance_transactions set
    resource_id=p_resource_id, kind='investment', payment_method='bank', amount_cents=v_total,
    concept=trim(p_crypto_name), crypto_symbol=v_symbol, crypto_quantity=p_quantity,
    crypto_unit_price_cents=p_unit_price_cents, crypto_fee_cents=greatest(coalesce(p_fee_cents,0),0),
    crypto_fee_mode=p_fee_mode, investment_isin=null,investment_quantity=null,investment_unit_price_cents=null
  where id=p_transaction_id and creator_id=auth.uid();

  update public.crypto_ledger set symbol=v_symbol,crypto_name=trim(p_crypto_name),quantity=p_quantity,
    eur_amount_cents=v_total,unit_price_cents=p_unit_price_cents,fee_cents=greatest(coalesce(p_fee_cents,0),0),
    cost_basis_cents=v_total,destination_resource_id=p_resource_id
  where id=v_old.id;
end;$$;

create or replace function public.a2c_update_crypto_payment(
  p_transaction_id uuid,
  p_symbol text,
  p_quantity numeric,
  p_unit_price_cents bigint,
  p_resource_id uuid default null,
  p_concept text default 'Pago con criptomoneda',
  p_occurred_on date default current_date,
  p_notes text default ''
) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_old public.crypto_ledger%rowtype;
  v_restore public.crypto_holdings%rowtype;
  v_source public.crypto_holdings%rowtype;
  v_cost bigint;
  v_value bigint;
  v_symbol text := upper(trim(p_symbol));
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if p_quantity<=0 or p_unit_price_cents<=0 or v_symbol='' then raise exception 'Pago no válido'; end if;
  if p_resource_id is not null and not public.can_access_resource(p_resource_id,auth.uid()) then raise exception 'No tienes acceso al elemento'; end if;

  select * into v_old from public.crypto_ledger
  where transaction_id=p_transaction_id and user_id=auth.uid() and action='PAGO' for update;
  if not found then raise exception 'Pago cripto no encontrado'; end if;

  select * into v_restore from public.crypto_holdings
  where user_id=auth.uid() and resource_id is not distinct from v_old.source_resource_id and symbol=v_old.symbol for update;
  if found then
    update public.crypto_holdings set quantity=quantity+v_old.quantity,total_cost_cents=total_cost_cents+v_old.cost_basis_cents,updated_at=now() where id=v_restore.id;
  else
    insert into public.crypto_holdings(user_id,resource_id,symbol,crypto_name,quantity,total_cost_cents)
    values(auth.uid(),v_old.source_resource_id,v_old.symbol,v_old.crypto_name,v_old.quantity,v_old.cost_basis_cents);
  end if;

  select * into v_source from public.crypto_holdings
  where user_id=auth.uid() and resource_id is not distinct from p_resource_id and symbol=v_symbol for update;
  if not found or v_source.quantity<p_quantity then raise exception 'Saldo de criptomoneda insuficiente'; end if;
  v_cost:=round(v_source.total_cost_cents*(p_quantity/v_source.quantity))::bigint;
  v_value:=round(p_quantity*p_unit_price_cents)::bigint;
  update public.crypto_holdings set quantity=quantity-p_quantity,total_cost_cents=greatest(0,total_cost_cents-v_cost),updated_at=now() where id=v_source.id;

  update public.finance_transactions set resource_id=p_resource_id,kind='expense',amount_cents=v_value,
    concept=trim(p_concept),occurred_on=p_occurred_on,notes=coalesce(p_notes,''),payment_method='crypto',
    crypto_symbol=v_symbol,crypto_quantity=p_quantity,crypto_unit_price_cents=p_unit_price_cents,
    crypto_fee_cents=0,crypto_fee_mode=null
  where id=p_transaction_id and creator_id=auth.uid();

  update public.crypto_ledger set symbol=v_symbol,crypto_name=v_source.crypto_name,quantity=p_quantity,
    eur_amount_cents=v_value,unit_price_cents=p_unit_price_cents,cost_basis_cents=v_cost,
    source_resource_id=p_resource_id,occurred_on=p_occurred_on
  where id=v_old.id;
end;$$;

create or replace function public.a2c_update_crypto_transfer(
  p_ledger_id uuid,
  p_quantity numeric,
  p_source_resource_id uuid default null,
  p_destination_resource_id uuid default null,
  p_occurred_on date default current_date
) returns void
language plpgsql security definer set search_path=public as $$
declare
  v_old public.crypto_ledger%rowtype;
  v_old_dest public.crypto_holdings%rowtype;
  v_old_source public.crypto_holdings%rowtype;
  v_source public.crypto_holdings%rowtype;
  v_dest public.crypto_holdings%rowtype;
  v_cost bigint;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if p_quantity<=0 or p_source_resource_id is not distinct from p_destination_resource_id then raise exception 'Traspaso no válido'; end if;
  if p_source_resource_id is not null and not public.can_access_resource(p_source_resource_id,auth.uid()) then raise exception 'Sin acceso al origen'; end if;
  if p_destination_resource_id is not null and not public.can_access_resource(p_destination_resource_id,auth.uid()) then raise exception 'Sin acceso al destino'; end if;

  select * into v_old from public.crypto_ledger where id=p_ledger_id and user_id=auth.uid() and action='TRASPASO' for update;
  if not found then raise exception 'Traspaso no encontrado'; end if;

  select * into v_old_dest from public.crypto_holdings
  where user_id=auth.uid() and resource_id is not distinct from v_old.destination_resource_id and symbol=v_old.symbol for update;
  if not found or v_old_dest.quantity<v_old.quantity then raise exception 'No puedes editar este traspaso porque la cripto del destino ya fue movida o gastada'; end if;
  update public.crypto_holdings set quantity=quantity-v_old.quantity,total_cost_cents=greatest(0,total_cost_cents-v_old.cost_basis_cents),updated_at=now() where id=v_old_dest.id;

  select * into v_old_source from public.crypto_holdings
  where user_id=auth.uid() and resource_id is not distinct from v_old.source_resource_id and symbol=v_old.symbol for update;
  if found then update public.crypto_holdings set quantity=quantity+v_old.quantity,total_cost_cents=total_cost_cents+v_old.cost_basis_cents,updated_at=now() where id=v_old_source.id;
  else insert into public.crypto_holdings(user_id,resource_id,symbol,crypto_name,quantity,total_cost_cents) values(auth.uid(),v_old.source_resource_id,v_old.symbol,v_old.crypto_name,v_old.quantity,v_old.cost_basis_cents); end if;

  select * into v_source from public.crypto_holdings
  where user_id=auth.uid() and resource_id is not distinct from p_source_resource_id and symbol=v_old.symbol for update;
  if not found or v_source.quantity<p_quantity then raise exception 'Saldo de criptomoneda insuficiente en el origen'; end if;
  v_cost:=round(v_source.total_cost_cents*(p_quantity/v_source.quantity))::bigint;
  update public.crypto_holdings set quantity=quantity-p_quantity,total_cost_cents=greatest(0,total_cost_cents-v_cost),updated_at=now() where id=v_source.id;

  select * into v_dest from public.crypto_holdings
  where user_id=auth.uid() and resource_id is not distinct from p_destination_resource_id and symbol=v_old.symbol for update;
  if found then update public.crypto_holdings set quantity=quantity+p_quantity,total_cost_cents=total_cost_cents+v_cost,updated_at=now() where id=v_dest.id;
  else insert into public.crypto_holdings(user_id,resource_id,symbol,crypto_name,quantity,total_cost_cents) values(auth.uid(),p_destination_resource_id,v_old.symbol,v_old.crypto_name,p_quantity,v_cost); end if;

  update public.crypto_ledger set quantity=p_quantity,cost_basis_cents=v_cost,eur_amount_cents=v_cost,
    source_resource_id=p_source_resource_id,destination_resource_id=p_destination_resource_id,occurred_on=p_occurred_on
  where id=v_old.id;
end;$$;

create or replace function public.a2c_delete_crypto_transfer(p_ledger_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_old public.crypto_ledger%rowtype; v_dest public.crypto_holdings%rowtype; v_source public.crypto_holdings%rowtype;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  select * into v_old from public.crypto_ledger where id=p_ledger_id and user_id=auth.uid() and action='TRASPASO' for update;
  if not found then raise exception 'Traspaso no encontrado'; end if;
  select * into v_dest from public.crypto_holdings where user_id=auth.uid() and resource_id is not distinct from v_old.destination_resource_id and symbol=v_old.symbol for update;
  if not found or v_dest.quantity<v_old.quantity then raise exception 'No puedes borrar este traspaso porque la cripto del destino ya fue movida o gastada'; end if;
  update public.crypto_holdings set quantity=quantity-v_old.quantity,total_cost_cents=greatest(0,total_cost_cents-v_old.cost_basis_cents),updated_at=now() where id=v_dest.id;
  select * into v_source from public.crypto_holdings where user_id=auth.uid() and resource_id is not distinct from v_old.source_resource_id and symbol=v_old.symbol for update;
  if found then update public.crypto_holdings set quantity=quantity+v_old.quantity,total_cost_cents=total_cost_cents+v_old.cost_basis_cents,updated_at=now() where id=v_source.id;
  else insert into public.crypto_holdings(user_id,resource_id,symbol,crypto_name,quantity,total_cost_cents) values(auth.uid(),v_old.source_resource_id,v_old.symbol,v_old.crypto_name,v_old.quantity,v_old.cost_basis_cents); end if;
  delete from public.crypto_ledger where id=v_old.id;
end;$$;

grant execute on function public.a2c_update_crypto_purchase(uuid,text,text,numeric,bigint,bigint,text,uuid) to authenticated;
grant execute on function public.a2c_update_crypto_payment(uuid,text,numeric,bigint,uuid,text,date,text) to authenticated;
grant execute on function public.a2c_update_crypto_transfer(uuid,numeric,uuid,uuid,date) to authenticated;
grant execute on function public.a2c_delete_crypto_transfer(uuid) to authenticated;

notify pgrst, 'reload schema';

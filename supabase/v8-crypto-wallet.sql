-- A2C Finanzas v19 · cartera de criptomonedas
-- Ejecutar una sola vez después de v7-profile-avatars.sql.

alter table public.finance_transactions
  add column if not exists crypto_symbol text,
  add column if not exists crypto_quantity numeric(30,12),
  add column if not exists crypto_unit_price_cents bigint,
  add column if not exists crypto_fee_cents bigint not null default 0,
  add column if not exists crypto_fee_mode text;

alter table public.finance_transactions drop constraint if exists finance_transactions_crypto_fee_mode_check;
alter table public.finance_transactions add constraint finance_transactions_crypto_fee_mode_check
  check (crypto_fee_mode is null or crypto_fee_mode in ('add','subtract'));

create table if not exists public.crypto_holdings(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  resource_id uuid references public.resources(id) on delete cascade,
  symbol text not null,
  crypto_name text not null,
  quantity numeric(30,12) not null default 0 check(quantity >= 0),
  total_cost_cents bigint not null default 0 check(total_cost_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crypto_holdings_user_resource_symbol_uidx
on public.crypto_holdings(user_id,coalesce(resource_id,'00000000-0000-0000-0000-000000000000'::uuid),symbol);

create table if not exists public.crypto_ledger(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check(action in ('COMPRA','TRASPASO','PAGO')),
  symbol text not null,
  crypto_name text not null,
  quantity numeric(30,12) not null check(quantity > 0),
  eur_amount_cents bigint,
  unit_price_cents bigint,
  fee_cents bigint not null default 0,
  cost_basis_cents bigint not null default 0,
  source_resource_id uuid constraint crypto_ledger_source_resource_id_fkey references public.resources(id) on delete set null,
  destination_resource_id uuid constraint crypto_ledger_destination_resource_id_fkey references public.resources(id) on delete set null,
  transaction_id uuid references public.finance_transactions(id) on delete set null,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.crypto_holdings enable row level security;
alter table public.crypto_ledger enable row level security;

drop policy if exists crypto_holdings_own on public.crypto_holdings;
create policy crypto_holdings_own on public.crypto_holdings
for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

drop policy if exists crypto_ledger_own on public.crypto_ledger;
create policy crypto_ledger_own on public.crypto_ledger
for select to authenticated using(user_id=auth.uid());

create or replace function public.a2c_record_crypto_purchase(
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
  v_holding public.crypto_holdings%rowtype;
  v_amount bigint;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if p_quantity <= 0 or p_unit_price_cents <= 0 then raise exception 'Datos de compra no válidos'; end if;
  if not exists(select 1 from public.finance_transactions where id=p_transaction_id and creator_id=auth.uid()) then raise exception 'Movimiento no autorizado'; end if;
  if p_resource_id is not null and not public.can_access_resource(p_resource_id,auth.uid()) then raise exception 'No tienes acceso al elemento'; end if;
  v_amount := round(p_quantity*p_unit_price_cents)::bigint + case when p_fee_mode='add' then greatest(coalesce(p_fee_cents,0),0) else 0 end;
  update public.finance_transactions set
    crypto_symbol=upper(trim(p_symbol)), crypto_quantity=p_quantity,
    crypto_unit_price_cents=p_unit_price_cents, crypto_fee_cents=greatest(coalesce(p_fee_cents,0),0),
    crypto_fee_mode=p_fee_mode
  where id=p_transaction_id and creator_id=auth.uid();

  select * into v_holding from public.crypto_holdings
   where user_id=auth.uid() and resource_id is not distinct from p_resource_id and symbol=upper(trim(p_symbol)) for update;
  if found then
    update public.crypto_holdings set quantity=quantity+p_quantity,total_cost_cents=total_cost_cents+v_amount,crypto_name=p_crypto_name,updated_at=now() where id=v_holding.id;
  else
    insert into public.crypto_holdings(user_id,resource_id,symbol,crypto_name,quantity,total_cost_cents)
    values(auth.uid(),p_resource_id,upper(trim(p_symbol)),p_crypto_name,p_quantity,v_amount);
  end if;
  insert into public.crypto_ledger(user_id,action,symbol,crypto_name,quantity,eur_amount_cents,unit_price_cents,fee_cents,cost_basis_cents,destination_resource_id,transaction_id,occurred_on)
  select auth.uid(),'COMPRA',upper(trim(p_symbol)),p_crypto_name,p_quantity,v_amount,p_unit_price_cents,greatest(coalesce(p_fee_cents,0),0),v_amount,p_resource_id,p_transaction_id,occurred_on
  from public.finance_transactions where id=p_transaction_id;
end;$$;

create or replace function public.a2c_transfer_crypto(
 p_symbol text,p_quantity numeric,p_source_resource_id uuid default null,p_destination_resource_id uuid default null,p_occurred_on date default current_date
) returns void language plpgsql security definer set search_path=public as $$
declare v_source public.crypto_holdings%rowtype; v_dest public.crypto_holdings%rowtype; v_cost bigint;
begin
 if auth.uid() is null then raise exception 'Sesión no válida'; end if;
 if p_quantity<=0 or p_source_resource_id is not distinct from p_destination_resource_id then raise exception 'Traspaso no válido'; end if;
 if p_source_resource_id is not null and not public.can_access_resource(p_source_resource_id,auth.uid()) then raise exception 'Sin acceso al origen'; end if;
 if p_destination_resource_id is not null and not public.can_access_resource(p_destination_resource_id,auth.uid()) then raise exception 'Sin acceso al destino'; end if;
 select * into v_source from public.crypto_holdings where user_id=auth.uid() and resource_id is not distinct from p_source_resource_id and symbol=upper(trim(p_symbol)) for update;
 if not found or v_source.quantity<p_quantity then raise exception 'Saldo de criptomoneda insuficiente'; end if;
 v_cost:=round(v_source.total_cost_cents*(p_quantity/v_source.quantity))::bigint;
 update public.crypto_holdings set quantity=quantity-p_quantity,total_cost_cents=greatest(0,total_cost_cents-v_cost),updated_at=now() where id=v_source.id;
 select * into v_dest from public.crypto_holdings where user_id=auth.uid() and resource_id is not distinct from p_destination_resource_id and symbol=v_source.symbol for update;
 if found then update public.crypto_holdings set quantity=quantity+p_quantity,total_cost_cents=total_cost_cents+v_cost,updated_at=now() where id=v_dest.id;
 else insert into public.crypto_holdings(user_id,resource_id,symbol,crypto_name,quantity,total_cost_cents) values(auth.uid(),p_destination_resource_id,v_source.symbol,v_source.crypto_name,p_quantity,v_cost); end if;
 insert into public.crypto_ledger(user_id,action,symbol,crypto_name,quantity,eur_amount_cents,cost_basis_cents,source_resource_id,destination_resource_id,occurred_on)
 values(auth.uid(),'TRASPASO',v_source.symbol,v_source.crypto_name,p_quantity,v_cost,v_cost,p_source_resource_id,p_destination_resource_id,p_occurred_on);
end;$$;

create or replace function public.a2c_spend_crypto(
 p_symbol text,p_quantity numeric,p_unit_price_cents bigint,p_resource_id uuid default null,p_concept text default 'Pago con criptomoneda',p_occurred_on date default current_date,p_notes text default ''
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_holding public.crypto_holdings%rowtype; v_cost bigint; v_value bigint; v_tx uuid;
begin
 if auth.uid() is null then raise exception 'Sesión no válida'; end if;
 if p_quantity<=0 or p_unit_price_cents<=0 then raise exception 'Pago no válido'; end if;
 if p_resource_id is not null and not public.can_access_resource(p_resource_id,auth.uid()) then raise exception 'No tienes acceso al elemento'; end if;
 select * into v_holding from public.crypto_holdings where user_id=auth.uid() and resource_id is not distinct from p_resource_id and symbol=upper(trim(p_symbol)) for update;
 if not found or v_holding.quantity<p_quantity then raise exception 'Saldo de criptomoneda insuficiente'; end if;
 v_cost:=round(v_holding.total_cost_cents*(p_quantity/v_holding.quantity))::bigint;
 v_value:=round(p_quantity*p_unit_price_cents)::bigint;
 update public.crypto_holdings set quantity=quantity-p_quantity,total_cost_cents=greatest(0,total_cost_cents-v_cost),updated_at=now() where id=v_holding.id;
 insert into public.finance_transactions(creator_id,resource_id,kind,amount_cents,concept,occurred_on,notes,payment_method,crypto_symbol,crypto_quantity,crypto_unit_price_cents)
 values(auth.uid(),p_resource_id,'expense',v_value,p_concept,p_occurred_on,p_notes,'crypto',v_holding.symbol,p_quantity,p_unit_price_cents) returning id into v_tx;
 insert into public.crypto_ledger(user_id,action,symbol,crypto_name,quantity,eur_amount_cents,unit_price_cents,cost_basis_cents,source_resource_id,transaction_id,occurred_on)
 values(auth.uid(),'PAGO',v_holding.symbol,v_holding.crypto_name,p_quantity,v_value,p_unit_price_cents,v_cost,p_resource_id,v_tx,p_occurred_on);
 return v_tx;
end;$$;

create or replace function public.a2c_delete_crypto_transaction(p_transaction_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v_row public.crypto_ledger%rowtype; v_holding public.crypto_holdings%rowtype;
begin
 if auth.uid() is null then raise exception 'Sesión no válida'; end if;
 select * into v_row from public.crypto_ledger where transaction_id=p_transaction_id and user_id=auth.uid() for update;
 if not found then raise exception 'Operación cripto no encontrada'; end if;
 if v_row.action='COMPRA' then
   select * into v_holding from public.crypto_holdings where user_id=auth.uid() and resource_id is not distinct from v_row.destination_resource_id and symbol=v_row.symbol for update;
   if not found or v_holding.quantity<v_row.quantity then raise exception 'No puedes borrar esta compra porque parte de la cripto ya fue movida o gastada'; end if;
   update public.crypto_holdings set quantity=quantity-v_row.quantity,total_cost_cents=greatest(0,total_cost_cents-v_row.cost_basis_cents),updated_at=now() where id=v_holding.id;
 elsif v_row.action='PAGO' then
   select * into v_holding from public.crypto_holdings where user_id=auth.uid() and resource_id is not distinct from v_row.source_resource_id and symbol=v_row.symbol for update;
   if found then update public.crypto_holdings set quantity=quantity+v_row.quantity,total_cost_cents=total_cost_cents+v_row.cost_basis_cents,updated_at=now() where id=v_holding.id;
   else insert into public.crypto_holdings(user_id,resource_id,symbol,crypto_name,quantity,total_cost_cents) values(auth.uid(),v_row.source_resource_id,v_row.symbol,v_row.crypto_name,v_row.quantity,v_row.cost_basis_cents); end if;
 end if;
 delete from public.crypto_ledger where id=v_row.id;
 delete from public.finance_transactions where id=p_transaction_id and creator_id=auth.uid();
end;$$;

grant execute on function public.a2c_delete_crypto_transaction(uuid) to authenticated;

grant execute on function public.a2c_record_crypto_purchase(uuid,text,text,numeric,bigint,bigint,text,uuid) to authenticated;
grant execute on function public.a2c_transfer_crypto(text,numeric,uuid,uuid,date) to authenticated;
grant execute on function public.a2c_spend_crypto(text,numeric,bigint,uuid,text,date,text) to authenticated;

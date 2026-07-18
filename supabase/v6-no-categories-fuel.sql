-- A2C Finanzas v6
-- Elimina el uso funcional de categorías y comercio, y añade el detalle de combustible.
-- Es segura para instalaciones existentes: conserva las columnas antiguas para que las RPC v4 sigan funcionando.

update public.finance_transactions set category_id = null, merchant = '';
update public.recurring_transactions set category_id = null;
delete from public.monthly_budgets;
delete from public.finance_categories;

alter table public.finance_transactions
  add column if not exists fuel_liters numeric(12,3),
  add column if not exists fuel_price_per_liter_milli bigint,
  add column if not exists fuel_km numeric(12,3),
  add column if not exists fuel_consumption_l100km numeric(10,2);

alter table public.finance_transactions
  drop constraint if exists finance_transactions_fuel_liters_check,
  drop constraint if exists finance_transactions_fuel_price_check,
  drop constraint if exists finance_transactions_fuel_km_check,
  drop constraint if exists finance_transactions_fuel_consumption_check;

alter table public.finance_transactions
  add constraint finance_transactions_fuel_liters_check check (fuel_liters is null or fuel_liters > 0),
  add constraint finance_transactions_fuel_price_check check (fuel_price_per_liter_milli is null or fuel_price_per_liter_milli > 0),
  add constraint finance_transactions_fuel_km_check check (fuel_km is null or fuel_km > 0),
  add constraint finance_transactions_fuel_consumption_check check (fuel_consumption_l100km is null or fuel_consumption_l100km > 0);

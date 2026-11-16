-- =====================================================================
-- A2C Finanzas 9.0 · Registro de tickets por Telegram
-- Ejecutar UNA vez en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a ejecutar sin perder datos.
-- =====================================================================

-- 0. Corrección: el trigger de presupuestos automáticos (V8.1) usa min(uuid),
--    que PostgreSQL no trae de serie. Sin esto, registrar un gasto cuya categoría
--    coincide con un presupuesto falla con "function min(uuid) does not exist".
create or replace function public.a2c_uuid_smaller(a uuid, b uuid)
returns uuid language sql immutable parallel safe as $$
  select case when a is null then b when b is null then a when a < b then a else b end;
$$;
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_aggregate g on g.aggfnoid = p.oid
     where p.proname = 'min' and p.proargtypes::text = (select oid::text from pg_type where typname = 'uuid')
  ) then
    create aggregate public.min(uuid) (sfunc = public.a2c_uuid_smaller, stype = uuid, combinefunc = public.a2c_uuid_smaller, parallel = safe);
  end if;
end $$;

-- 1. Vinculación cuenta A2C ↔ chat de Telegram ------------------------
create table if not exists public.a2c_telegram_links(
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint unique,
  telegram_username text,
  telegram_name text,
  default_payment_method text not null default 'bank'
    check (default_payment_method in ('bank','cash','crypto')),
  link_code text unique,
  link_code_expires_at timestamptz,
  linked_at timestamptz,
  last_receipt_at timestamptz,
  receipts_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.a2c_telegram_links enable row level security;

drop policy if exists a2c_telegram_links_select_own on public.a2c_telegram_links;
create policy a2c_telegram_links_select_own on public.a2c_telegram_links
  for select to authenticated using (user_id = auth.uid());
-- Sin políticas de escritura: todo pasa por las funciones de abajo.

-- 2. Updates ya procesados (Telegram reintenta si no recibe 200) -------
create table if not exists public.a2c_telegram_updates(
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);
alter table public.a2c_telegram_updates enable row level security;

-- 3. Funciones para la app (usuario con sesión) -------------------------

-- Genera un código de vinculación válido 15 minutos.
create or replace function public.a2c_tg_create_link_code()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  if v_user is null then raise exception 'Inicia sesión para vincular Telegram'; end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text || v_user::text), 1, 10));
    exit when not exists(select 1 from public.a2c_telegram_links where link_code = v_code);
  end loop;
  insert into public.a2c_telegram_links(user_id, link_code, link_code_expires_at)
  values (v_user, v_code, v_expires)
  on conflict (user_id) do update
    set link_code = excluded.link_code,
        link_code_expires_at = excluded.link_code_expires_at,
        updated_at = now();
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end;
$$;

-- Estado de la vinculación del usuario actual.
create or replace function public.a2c_tg_status()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select jsonb_build_object(
      'linked', l.chat_id is not null,
      'telegram_username', l.telegram_username,
      'telegram_name', l.telegram_name,
      'linked_at', l.linked_at,
      'default_payment_method', l.default_payment_method,
      'receipts_count', l.receipts_count,
      'last_receipt_at', l.last_receipt_at)
    from public.a2c_telegram_links l where l.user_id = auth.uid()
  ), jsonb_build_object('linked', false));
$$;

create or replace function public.a2c_tg_unlink()
returns void
language sql
security definer
set search_path = public
as $$
  update public.a2c_telegram_links
     set chat_id = null, telegram_username = null, telegram_name = null,
         linked_at = null, link_code = null, link_code_expires_at = null, updated_at = now()
   where user_id = auth.uid();
$$;

create or replace function public.a2c_tg_set_payment_method(p_method text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_method not in ('bank','cash','crypto') then raise exception 'Método no válido'; end if;
  update public.a2c_telegram_links
     set default_payment_method = p_method, updated_at = now()
   where user_id = auth.uid();
end;
$$;

-- 4. Funciones para el bot (solo service_role, desde la Edge Function) --

-- Hace que auth.uid() devuelva el usuario dentro de la transacción actual,
-- para que los triggers existentes (presupuestos, etc.) funcionen igual que desde la app.
create or replace function public.a2c_tg_impersonate(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true),
    set_config('request.jwt.claim.sub', p_user::text, true);
$$;

create or replace function public.a2c_tg_link_chat(
  p_code text, p_chat_id bigint, p_username text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_display text;
begin
  select user_id into v_user from public.a2c_telegram_links
   where link_code = upper(trim(p_code)) and link_code_expires_at > now()
   for update;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'Código no válido o caducado');
  end if;
  -- Un chat solo puede estar vinculado a una cuenta.
  update public.a2c_telegram_links
     set chat_id = null, linked_at = null, updated_at = now()
   where chat_id = p_chat_id and user_id <> v_user;
  update public.a2c_telegram_links
     set chat_id = p_chat_id, telegram_username = nullif(p_username, ''),
         telegram_name = nullif(p_name, ''), linked_at = now(),
         link_code = null, link_code_expires_at = null, updated_at = now()
   where user_id = v_user;
  select coalesce(display_name, username, email, 'usuario') into v_display
    from public.profiles where id = v_user;
  return jsonb_build_object('ok', true, 'user_id', v_user, 'display_name', v_display);
end;
$$;

create or replace function public.a2c_tg_user_for_chat(p_chat_id bigint)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'user_id', l.user_id,
    'default_payment_method', l.default_payment_method,
    'display_name', coalesce(p.display_name, p.username, 'usuario'))
  from public.a2c_telegram_links l
  left join public.profiles p on p.id = l.user_id
  where l.chat_id = p_chat_id;
$$;

-- Marca un update como procesado. Devuelve false si ya lo estaba.
create or replace function public.a2c_tg_claim_update(p_update_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.a2c_telegram_updates(update_id) values (p_update_id);
  delete from public.a2c_telegram_updates where processed_at < now() - interval '7 days';
  return true;
exception when unique_violation then
  return false;
end;
$$;

-- Registra el gasto leído del ticket.
create or replace function public.a2c_tg_record_expense(p_chat_id bigint, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_link public.a2c_telegram_links%rowtype;
  v_id uuid;
  v_amount bigint := (p_data->>'amount_cents')::bigint;
  v_date date := coalesce(nullif(p_data->>'occurred_on','')::date, current_date);
  v_category text := coalesce(nullif(p_data->>'category',''), 'other');
  v_duplicate boolean;
  v_budget_name text;
  v_row public.finance_transactions%rowtype;
begin
  select * into v_link from public.a2c_telegram_links where chat_id = p_chat_id;
  if not found then raise exception 'Chat no vinculado'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Importe no válido'; end if;
  if v_category not in ('food','leisure','health','fuel','subscriptions','shopping','housing','transport','other') then
    v_category := 'other';
  end if;

  perform public.a2c_tg_impersonate(v_link.user_id);

  select exists(
    select 1 from public.finance_transactions
     where creator_id = v_link.user_id and kind = 'expense'
       and amount_cents = v_amount and occurred_on = v_date
  ) into v_duplicate;

  insert into public.finance_transactions(
    creator_id, kind, resource_id, category_id, merchant, payment_method,
    amount_cents, concept, occurred_on, notes, budget_id, budget_assignment, budget_category)
  values (
    v_link.user_id, 'expense', null, null,
    left(coalesce(p_data->>'merchant',''), 140),
    coalesce(nullif(p_data->>'payment_method',''), v_link.default_payment_method, 'bank'),
    v_amount,
    left(coalesce(nullif(p_data->>'concept',''), nullif(p_data->>'merchant',''), 'Ticket'), 140),
    v_date,
    left(coalesce(p_data->>'notes',''), 800),
    null, 'none', v_category)
  returning * into v_row;
  v_id := v_row.id;

  if v_row.budget_id is not null then
    select name into v_budget_name from public.budgets_v67 where id = v_row.budget_id;
  end if;

  update public.a2c_telegram_links
     set receipts_count = receipts_count + 1, last_receipt_at = now(), updated_at = now()
   where user_id = v_link.user_id;

  return jsonb_build_object(
    'id', v_id, 'user_id', v_link.user_id, 'duplicate', v_duplicate,
    'budget_name', v_budget_name, 'budget_category', v_row.budget_category,
    'payment_method', v_row.payment_method, 'occurred_on', v_row.occurred_on);
end;
$$;

create or replace function public.a2c_tg_attach_receipt(p_chat_id bigint, p_transaction_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  select user_id into v_user from public.a2c_telegram_links where chat_id = p_chat_id;
  if v_user is null then raise exception 'Chat no vinculado'; end if;
  perform public.a2c_tg_impersonate(v_user);
  update public.finance_transactions set receipt_path = p_path
   where id = p_transaction_id and creator_id = v_user;
end;
$$;

-- Cambia el método de pago de un gasto registrado por el bot.
create or replace function public.a2c_tg_update_payment(p_chat_id bigint, p_transaction_id uuid, p_method text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  if p_method not in ('bank','cash','crypto') then return false; end if;
  select user_id into v_user from public.a2c_telegram_links where chat_id = p_chat_id;
  if v_user is null then return false; end if;
  perform public.a2c_tg_impersonate(v_user);
  update public.finance_transactions set payment_method = p_method
   where id = p_transaction_id and creator_id = v_user;
  return found;
end;
$$;

-- Deshace (elimina) un gasto registrado por el bot. Devuelve la ruta del ticket para borrarlo.
create or replace function public.a2c_tg_undo(p_chat_id bigint, p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_row public.finance_transactions%rowtype;
begin
  select user_id into v_user from public.a2c_telegram_links where chat_id = p_chat_id;
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'Chat no vinculado'); end if;
  perform public.a2c_tg_impersonate(v_user);
  delete from public.finance_transactions
   where id = p_transaction_id and creator_id = v_user
     and notes like '%[A2C-TELEGRAM]%'
  returning * into v_row;
  if not found then return jsonb_build_object('ok', false, 'error', 'El movimiento ya no existe'); end if;
  update public.a2c_telegram_links
     set receipts_count = greatest(receipts_count - 1, 0), updated_at = now()
   where user_id = v_user;
  return jsonb_build_object('ok', true, 'receipt_path', v_row.receipt_path,
                            'concept', v_row.concept, 'amount_cents', v_row.amount_cents);
end;
$$;

-- Últimos gastos registrados (para /ultimos en el bot).
create or replace function public.a2c_tg_recent(p_chat_id bigint, p_limit int default 5)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select f.concept, f.amount_cents, f.occurred_on, f.kind
      from public.finance_transactions f
      join public.a2c_telegram_links l on l.user_id = f.creator_id
     where l.chat_id = p_chat_id
     order by f.occurred_on desc, f.created_at desc
     limit least(greatest(p_limit, 1), 20)
  ) t;
$$;

-- Gasto del mes en curso (para /mes en el bot).
create or replace function public.a2c_tg_month(p_chat_id bigint)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'expenses_cents', coalesce(sum(f.amount_cents) filter (where f.kind = 'expense'), 0),
    'income_cents', coalesce(sum(f.amount_cents) filter (where f.kind = 'income'), 0),
    'count', count(*) filter (where f.kind = 'expense'))
  from public.finance_transactions f
  join public.a2c_telegram_links l on l.user_id = f.creator_id
  where l.chat_id = p_chat_id
    and f.occurred_on >= date_trunc('month', current_date)::date;
$$;

-- 5. Permisos -------------------------------------------------------------
revoke all on function public.a2c_tg_create_link_code() from public, anon;
revoke all on function public.a2c_tg_status() from public, anon;
revoke all on function public.a2c_tg_unlink() from public, anon;
revoke all on function public.a2c_tg_set_payment_method(text) from public, anon;
grant execute on function public.a2c_tg_create_link_code() to authenticated;
grant execute on function public.a2c_tg_status() to authenticated;
grant execute on function public.a2c_tg_unlink() to authenticated;
grant execute on function public.a2c_tg_set_payment_method(text) to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.a2c_tg_impersonate(uuid)',
    'public.a2c_tg_link_chat(text,bigint,text,text)',
    'public.a2c_tg_user_for_chat(bigint)',
    'public.a2c_tg_claim_update(bigint)',
    'public.a2c_tg_record_expense(bigint,jsonb)',
    'public.a2c_tg_attach_receipt(bigint,uuid,text)',
    'public.a2c_tg_update_payment(bigint,uuid,text)',
    'public.a2c_tg_undo(bigint,uuid)',
    'public.a2c_tg_recent(bigint,int)',
    'public.a2c_tg_month(bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

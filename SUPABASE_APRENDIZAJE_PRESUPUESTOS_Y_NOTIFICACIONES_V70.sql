-- A2C Finanzas 3.1 · Presupuestos inteligentes, suscripciones y avisos compartidos
create extension if not exists pgcrypto;

-- Ampliar las categorías admitidas.
alter table public.budgets_v67 drop constraint if exists budgets_v67_category_key_check;
alter table public.budgets_v67 add constraint budgets_v67_category_key_check
  check (category_key in ('alimentacion','ocio','salud','combustible','suscripciones','otros'));

-- Reglas aprendidas por cada usuario a partir de asignaciones manuales.
create table if not exists public.budget_merchant_rules_v70 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_key text not null,
  category_key text not null check (category_key in ('alimentacion','ocio','salud','combustible','suscripciones','otros')),
  uses_count integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(user_id,merchant_key)
);
alter table public.budget_merchant_rules_v70 enable row level security;
drop policy if exists budget_rules_select_v70 on public.budget_merchant_rules_v70;
drop policy if exists budget_rules_insert_v70 on public.budget_merchant_rules_v70;
drop policy if exists budget_rules_update_v70 on public.budget_merchant_rules_v70;
drop policy if exists budget_rules_delete_v70 on public.budget_merchant_rules_v70;
create policy budget_rules_select_v70 on public.budget_merchant_rules_v70 for select using (auth.uid()=user_id);
create policy budget_rules_insert_v70 on public.budget_merchant_rules_v70 for insert with check (auth.uid()=user_id);
create policy budget_rules_update_v70 on public.budget_merchant_rules_v70 for update using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy budget_rules_delete_v70 on public.budget_merchant_rules_v70 for delete using (auth.uid()=user_id);
grant select,insert,update,delete on public.budget_merchant_rules_v70 to authenticated;

create or replace function public.a2c_normalize_merchant_v70(p_text text)
returns text language sql immutable as $$
  select trim(regexp_replace(lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun')),'[^a-z0-9]+',' ','g'));
$$;

create or replace function public.a2c_budget_category_v70(p_user uuid,p_text text)
returns text language plpgsql stable security definer set search_path=public as $$
declare
  value text := public.a2c_normalize_merchant_v70(p_text);
  learned text;
begin
  select category_key into learned from public.budget_merchant_rules_v70
  where user_id=p_user and (value=merchant_key or value like '%'||merchant_key||'%')
  order by length(merchant_key) desc limit 1;
  if learned is not null then return learned; end if;
  if value ~ '(netflix|google one|google storage|amazon prime|prime video|chatgpt|openai|claude|anthropic|hbo|disney|spotify|youtube premium|apple music|icloud|dropbox|microsoft 365|office 365)' then return 'suscripciones'; end if;
  if value ~ '(gasolina|diesel|gasoil|combustible|repostaje|gasolinera|cepsa|repsol|galp|shell|(^| )bp( |$))' then return 'combustible'; end if;
  if value ~ '(mercadona|lidl|aldi|carrefour|supermercado|alimentacion|comida|panaderia|carniceria|fruteria|hipercor|eroski|alcampo|(^| )dia( |$))' then return 'alimentacion'; end if;
  if value ~ '(medico|padel|futbol|farmacia|medicina|salud|clinica|dentista|fisioterapia|gimnasio|deporte)' then return 'salud'; end if;
  if value ~ '(cine|escapada|hotel|concierto|bar|restaurante|discoteca|teatro|viaje|vacaciones|pub|ocio)' then return 'ocio'; end if;
  return 'otros';
end;
$$;

grant execute on function public.a2c_budget_category_v70(uuid,text) to authenticated;

create or replace function public.a2c_set_budget_category_v70()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.kind='expense' then
    new.budget_category:=public.a2c_budget_category_v70(new.creator_id,concat_ws(' ',new.merchant,new.concept,new.notes));
  else new.budget_category:=null;
  end if;
  return new;
end;
$$;
drop trigger if exists a2c_set_budget_category_v67 on public.finance_transactions;
drop trigger if exists a2c_set_budget_category_v70 on public.finance_transactions;
create trigger a2c_set_budget_category_v70 before insert or update of kind,concept,merchant,notes
on public.finance_transactions for each row execute function public.a2c_set_budget_category_v70();

create or replace function public.a2c_assign_transactions_budget_v70(p_transaction_ids uuid[],p_category_key text)
returns integer language plpgsql security invoker set search_path=public as $$
declare
  tx record; v_key text; v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  if p_category_key not in ('alimentacion','ocio','salud','combustible','suscripciones','otros') then raise exception 'Categoría no válida.'; end if;
  for tx in select * from public.finance_transactions where id=any(p_transaction_ids) and creator_id=auth.uid() and kind='expense'
  loop
    update public.finance_transactions set budget_category=p_category_key where id=tx.id;
    v_key:=public.a2c_normalize_merchant_v70(coalesce(nullif(tx.merchant,''),tx.concept));
    if length(v_key)>=2 then
      insert into public.budget_merchant_rules_v70(user_id,merchant_key,category_key)
      values(auth.uid(),v_key,p_category_key)
      on conflict(user_id,merchant_key) do update set category_key=excluded.category_key,uses_count=public.budget_merchant_rules_v70.uses_count+1,updated_at=now();
      update public.finance_transactions set budget_category=p_category_key
      where creator_id=auth.uid() and kind='expense'
        and public.a2c_normalize_merchant_v70(coalesce(nullif(merchant,''),concept))=v_key;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
grant execute on function public.a2c_assign_transactions_budget_v70(uuid[],text) to authenticated;

-- Avisar a los demás integrantes cuando hay un movimiento en una hucha, objetivo o carpeta compartida.
create or replace function public.a2c_notify_shared_resource_movement_v70()
returns trigger language plpgsql security definer set search_path=public as $$
declare r record; resource_name text; actor_name text;
begin
  if new.resource_id is null then return new; end if;
  select name into resource_name from public.resources where id=new.resource_id and is_shared=true;
  if resource_name is null then return new; end if;
  select coalesce(display_name,email,'Un integrante') into actor_name from public.profiles where id=new.creator_id;
  for r in select user_id from public.resource_members where resource_id=new.resource_id and user_id<>new.creator_id
  loop
    insert into public.notifications(user_id,type,title,message,related_id,created_at)
    values(r.user_id,'resource_movement','Movimiento en '||resource_name,
      actor_name||' ha registrado '||case when new.kind='income' then 'un ingreso' else 'un movimiento' end||' de '||to_char(new.amount_cents/100.0,'FM999999990D00')||' €.',new.resource_id,now());
  end loop;
  return new;
end;
$$;
drop trigger if exists a2c_notify_shared_resource_movement_v70 on public.finance_transactions;
create trigger a2c_notify_shared_resource_movement_v70 after insert on public.finance_transactions
for each row execute function public.a2c_notify_shared_resource_movement_v70();

-- Aviso inmediato cuando otro usuario solicita dinero mediante un reparto de gasto.
create or replace function public.a2c_notify_money_request_v70()
returns trigger language plpgsql security definer set search_path=public as $$
declare actor_name text; concept_name text;
begin
  if new.debtor_user_id is null or new.debtor_user_id=new.owner_id then return new; end if;
  select coalesce(display_name,email,'Un usuario') into actor_name from public.profiles where id=new.owner_id;
  select coalesce(concept,'Gasto compartido') into concept_name from public.finance_transactions where id=new.transaction_id;
  insert into public.notifications(user_id,type,title,message,related_id,created_at)
  values(new.debtor_user_id,'money_request','Solicitud de dinero',actor_name||' te solicita '||to_char(new.amount_cents/100.0,'FM999999990D00')||' € por '||concept_name||'.',new.id,now());
  return new;
end;
$$;
drop trigger if exists a2c_notify_money_request_v70 on public.expense_splits;
create trigger a2c_notify_money_request_v70 after insert on public.expense_splits
for each row execute function public.a2c_notify_money_request_v70();

-- Reclasificar gastos existentes con las reglas base nuevas.
update public.finance_transactions
set budget_category=public.a2c_budget_category_v70(creator_id,concat_ws(' ',merchant,concept,notes))
where kind='expense';

-- Actualizar la función de guardado existente para admitir Suscripciones.
create or replace function public.a2c_save_budget_series_v68(
  p_series_id uuid,p_name text,p_category_key text,p_amount_cents bigint,
  p_start_month text,p_months integer,p_active boolean default true
) returns uuid language plpgsql security invoker set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_series uuid:=coalesce(p_series_id,gen_random_uuid());
  v_start date; v_end date; v_months integer:=greatest(1,least(coalesce(p_months,1),60)); v_month date;
begin
  if v_user is null then raise exception 'Debes iniciar sesión para guardar presupuestos.'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'El nombre es obligatorio.'; end if;
  if p_category_key not in ('alimentacion','ocio','salud','combustible','suscripciones','otros') then raise exception 'Categoría no válida.'; end if;
  if coalesce(p_amount_cents,0)<=0 then raise exception 'El importe debe ser mayor que cero.'; end if;
  if p_start_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'El mes inicial no es válido.'; end if;
  v_start:=to_date(p_start_month||'-01','YYYY-MM-DD');
  v_end:=(v_start+make_interval(months=>v_months-1))::date;
  delete from public.budgets_v67 where user_id=v_user and series_id=v_series;
  delete from public.budgets_v67 where user_id=v_user and category_key=p_category_key and period_month in
    (select to_char(gs::date,'YYYY-MM') from generate_series(v_start,v_end,interval '1 month') gs);
  for v_month in select gs::date from generate_series(v_start,v_end,interval '1 month') gs loop
    insert into public.budgets_v67(series_id,user_id,name,category_key,amount_cents,period_month,start_month,end_month,months_count,active,created_at,updated_at)
    values(v_series,v_user,trim(p_name),p_category_key,p_amount_cents,to_char(v_month,'YYYY-MM'),to_char(v_start,'YYYY-MM'),to_char(v_end,'YYYY-MM'),v_months,coalesce(p_active,true),now(),now());
  end loop;
  return v_series;
end;$$;
grant execute on function public.a2c_save_budget_series_v68(uuid,text,text,bigint,text,integer,boolean) to authenticated;

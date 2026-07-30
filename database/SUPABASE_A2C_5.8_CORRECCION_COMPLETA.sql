-- A2C Finanzas 5.8
-- Corrección definitiva del reparto de gastos.
-- Ejecutar en Supabase > SQL Editor antes de publicar web y APK.

begin;

update public.expense_splits
set person_name = null
where debtor_user_id is not null
  and person_name is not null;

update public.expense_splits
set person_name = 'Persona externa'
where debtor_user_id is null
  and nullif(btrim(coalesce(person_name,'')),'') is null;

alter table public.expense_splits
  drop constraint if exists expense_split_person;

alter table public.expense_splits
  add constraint expense_split_person check (
    (debtor_user_id is not null and person_name is null)
    or
    (debtor_user_id is null and nullif(btrim(person_name),'') is not null)
  );

create or replace function public.a2c_replace_expense_splits_v58(
  p_transaction_id uuid,
  p_participants jsonb
)
returns table(
  id uuid,
  debtor_user_id uuid,
  person_name text,
  amount_cents bigint,
  status text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_owner uuid := auth.uid();
  v_tx public.finance_transactions%rowtype;
  v_item jsonb;
  v_debtor uuid;
  v_name text;
  v_amount bigint;
  v_row public.expense_splits%rowtype;
begin
  if v_owner is null then raise exception 'Sesión no válida'; end if;

  select * into v_tx
  from public.finance_transactions
  where finance_transactions.id=p_transaction_id
    and finance_transactions.creator_id=v_owner
    and finance_transactions.kind='expense';

  if not found then
    raise exception 'No se encontró el gasto o no tienes permisos';
  end if;

  if jsonb_typeof(coalesce(p_participants,'[]'::jsonb)) <> 'array' then
    raise exception 'La lista de participantes no es válida';
  end if;

  delete from public.expense_splits
  where transaction_id=p_transaction_id
    and owner_id=v_owner
    and status='pending';

  for v_item in
    select value from jsonb_array_elements(coalesce(p_participants,'[]'::jsonb))
  loop
    v_debtor := nullif(v_item->>'debtor_user_id','')::uuid;
    v_name := nullif(btrim(coalesce(v_item->>'person_name','')),'');
    v_amount := coalesce((v_item->>'amount_cents')::bigint,0);

    if v_amount <= 0 then continue; end if;
    if v_amount > v_tx.amount_cents then
      raise exception 'Una parte no puede superar el importe total del gasto';
    end if;

    if v_debtor is not null then
      if v_debtor=v_owner then
        raise exception 'No puedes asignarte una deuda a ti mismo';
      end if;

      if not exists (
        select 1 from public.friendships f
        where f.status='accepted'
          and (
            (f.requester_id=v_owner and f.addressee_id=v_debtor)
            or
            (f.addressee_id=v_owner and f.requester_id=v_debtor)
          )
      ) then
        raise exception 'Uno de los usuarios ya no es tu amigo';
      end if;

      v_name := null;
    elsif v_name is null then
      raise exception 'Indica el nombre de la persona externa';
    end if;

    insert into public.expense_splits(
      owner_id,transaction_id,debtor_user_id,person_name,amount_cents,status
    )
    values(v_owner,p_transaction_id,v_debtor,v_name,v_amount,'pending')
    returning * into v_row;

    id := v_row.id;
    debtor_user_id := v_row.debtor_user_id;
    person_name := v_row.person_name;
    amount_cents := v_row.amount_cents;
    status := v_row.status;
    return next;
  end loop;
end;
$$;

grant execute on function
  public.a2c_replace_expense_splits_v58(uuid,jsonb)
to authenticated;

do $$
begin
  if to_regclass('public.expense_split_versions') is not null then
    insert into public.expense_split_versions(
      split_id,conversation_id,version_number,amount_cents,
      version_status,is_current,created_by,created_at
    )
    select
      es.id,
      ts.conversation_id,
      1,
      es.amount_cents,
      case when es.status='paid' then 'paid' else 'pending' end,
      es.status='pending',
      es.owner_id,
      coalesce(es.created_at,now())
    from public.expense_splits es
    left join public.transaction_shares ts on ts.split_id=es.id
    where not exists(
      select 1 from public.expense_split_versions v where v.split_id=es.id
    );
  end if;
end $$;

commit;

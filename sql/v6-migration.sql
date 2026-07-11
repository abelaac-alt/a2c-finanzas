-- A2C Finanzas V6
-- Ejecutar una sola vez en Supabase SQL Editor.

create extension if not exists pgcrypto;

-- Columnas de autoría y justificantes.
alter table public.ledger_transactions
  add column if not exists creator_id uuid references public.profiles(id),
  add column if not exists receipt_path text;

alter table public.piggy_transactions
  add column if not exists creator_id uuid references public.profiles(id),
  add column if not exists receipt_path text,
  add column if not exists folder_id uuid references public.folders(id);

update public.ledger_transactions
set creator_id = coalesce(creator_id, owner_id)
where creator_id is null;

update public.piggy_transactions
set creator_id = coalesce(creator_id, user_id)
where creator_id is null;

-- Miembros de objetivos conjuntos.
create table if not exists public.goal_members (
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (goal_id, user_id)
);

-- Invitaciones.
create table if not exists public.shared_invitations (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('piggy','goal')),
  resource_id uuid not null,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_email text not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create unique index if not exists shared_invitations_pending_unique
on public.shared_invitations(resource_type, resource_id, invited_user_id)
where status = 'pending';

-- Notificaciones.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  type text not null default 'info',
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists type text not null default 'info',
  add column if not exists related_id uuid,
  add column if not exists read_at timestamptz;

-- Gastos divididos.
create table if not exists public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('ledger','piggy')),
  transaction_id uuid not null,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  total_amount_cents bigint not null check (total_amount_cents > 0),
  total_people integer not null check (total_people >= 2),
  mode text not null check (mode in ('equal','custom')),
  created_at timestamptz not null default now()
);

create table if not exists public.expense_split_members (
  id uuid primary key default gen_random_uuid(),
  split_id uuid not null references public.expense_splits(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(split_id, user_id)
);

-- Bucket privado para justificantes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Políticas del bucket.
drop policy if exists "receipts_select_own" on storage.objects;
create policy "receipts_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "receipts_insert_own" on storage.objects;
create policy "receipts_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "receipts_delete_own" on storage.objects;
create policy "receipts_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Utilidad interna de administrador, con un nombre único para evitar ambigüedad.
create or replace function public.a2c_is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_user_id
      and role = 'admin'
      and coalesce(active, true) = true
  );
$$;

-- Editar una transacción solo si es del creador o si es administrador.
create or replace function public.update_transaction_secure(
  p_transaction_id uuid,
  p_source text,
  p_kind public.money_kind,
  p_amount_cents bigint,
  p_concept text,
  p_occurred_on date,
  p_folder_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'El importe debe ser mayor que cero';
  end if;

  if p_source = 'ledger' then
    select creator_id into v_creator
    from public.ledger_transactions
    where id = p_transaction_id
    for update;

    if not found then raise exception 'Movimiento no encontrado'; end if;

    if v_creator is distinct from auth.uid()
       and not public.a2c_is_admin(auth.uid()) then
      raise exception 'Solo el creador puede editar este movimiento';
    end if;

    update public.ledger_transactions
    set kind = p_kind,
        amount_cents = p_amount_cents,
        concept = p_concept,
        occurred_on = p_occurred_on,
        folder_id = p_folder_id
    where id = p_transaction_id;

  elsif p_source = 'piggy' then
    select creator_id into v_creator
    from public.piggy_transactions
    where id = p_transaction_id
    for update;

    if not found then raise exception 'Movimiento no encontrado'; end if;

    if v_creator is distinct from auth.uid()
       and not public.a2c_is_admin(auth.uid()) then
      raise exception 'Solo el creador puede editar este movimiento';
    end if;

    update public.piggy_transactions
    set kind = p_kind,
        amount_cents = p_amount_cents,
        concept = p_concept,
        occurred_on = p_occurred_on,
        folder_id = p_folder_id
    where id = p_transaction_id;
  else
    raise exception 'Origen no válido';
  end if;
end;
$$;

create or replace function public.delete_transaction_secure(
  p_transaction_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_receipt text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;

  if p_source = 'ledger' then
    select creator_id, receipt_path into v_creator, v_receipt
    from public.ledger_transactions
    where id = p_transaction_id
    for update;

    if not found then raise exception 'Movimiento no encontrado'; end if;

    if v_creator is distinct from auth.uid()
       and not public.a2c_is_admin(auth.uid()) then
      raise exception 'Solo el creador puede borrar este movimiento';
    end if;

    delete from public.expense_splits
    where source = 'ledger' and transaction_id = p_transaction_id;

    delete from public.ledger_transactions where id = p_transaction_id;

  elsif p_source = 'piggy' then
    select creator_id, receipt_path into v_creator, v_receipt
    from public.piggy_transactions
    where id = p_transaction_id
    for update;

    if not found then raise exception 'Movimiento no encontrado'; end if;

    if v_creator is distinct from auth.uid()
       and not public.a2c_is_admin(auth.uid()) then
      raise exception 'Solo el creador puede borrar este movimiento';
    end if;

    delete from public.expense_splits
    where source = 'piggy' and transaction_id = p_transaction_id;

    delete from public.piggy_transactions where id = p_transaction_id;
  else
    raise exception 'Origen no válido';
  end if;
end;
$$;

-- Invitación a hucha u objetivo.
create or replace function public.invite_shared_resource(
  p_email text,
  p_resource_type text,
  p_resource_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invited public.profiles%rowtype;
  v_invitation_id uuid;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;

  select * into v_invited
  from public.profiles
  where lower(email) = lower(trim(p_email))
    and coalesce(active, true) = true;

  if not found then raise exception 'No existe un usuario activo con ese correo'; end if;
  if v_invited.id = auth.uid() then raise exception 'No puedes invitarte a ti mismo'; end if;

  if p_resource_type = 'piggy' then
    select name into v_name
    from public.piggy_banks
    where id = p_resource_id and owner_id = auth.uid();

    if not found then raise exception 'No tienes permiso sobre esta hucha'; end if;

  elsif p_resource_type = 'goal' then
    select name into v_name
    from public.goals
    where id = p_resource_id and owner_id = auth.uid();

    if not found then raise exception 'No tienes permiso sobre este objetivo'; end if;
  else
    raise exception 'Tipo de recurso no válido';
  end if;

  insert into public.shared_invitations(
    resource_type, resource_id, inviter_id, invited_user_id, invited_email
  )
  values (
    p_resource_type, p_resource_id, auth.uid(), v_invited.id, v_invited.email
  )
  returning id into v_invitation_id;

  insert into public.notifications(user_id, title, body, type, related_id)
  values (
    v_invited.id,
    'Nueva invitación',
    'Te han invitado a ' || case when p_resource_type = 'piggy' then 'la hucha ' else 'el objetivo ' end || v_name,
    'invitation',
    v_invitation_id
  );

  return v_invitation_id;
end;
$$;

create or replace function public.respond_shared_invitation(
  p_invitation_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.shared_invitations%rowtype;
begin
  select * into v_inv
  from public.shared_invitations
  where id = p_invitation_id
    and invited_user_id = auth.uid()
    and status = 'pending'
  for update;

  if not found then raise exception 'Invitación no disponible'; end if;

  update public.shared_invitations
  set status = case when p_accept then 'accepted' else 'rejected' end,
      responded_at = now()
  where id = p_invitation_id;

  if p_accept then
    if v_inv.resource_type = 'piggy' then
      insert into public.piggy_members(piggy_id, user_id)
      values(v_inv.resource_id, auth.uid())
      on conflict do nothing;
    else
      insert into public.goal_members(goal_id, user_id)
      values(v_inv.resource_id, auth.uid())
      on conflict do nothing;
    end if;
  end if;

  insert into public.notifications(user_id, title, body, type, related_id)
  values(
    v_inv.inviter_id,
    case when p_accept then 'Invitación aceptada' else 'Invitación rechazada' end,
    'El usuario ' || case when p_accept then 'ha aceptado' else 'ha rechazado' end || ' tu invitación.',
    'invitation_response',
    p_invitation_id
  );
end;
$$;

-- Crear reparto de gasto.
create or replace function public.create_expense_split(
  p_source text,
  p_transaction_id uuid,
  p_total_people integer,
  p_mode text,
  p_members jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_creator uuid;
  v_split_id uuid;
  v_member jsonb;
  v_equal_amount bigint;
  v_custom_sum bigint := 0;
  v_selected_count integer := jsonb_array_length(coalesce(p_members, '[]'::jsonb));
  v_user_id uuid;
  v_amount bigint;
begin
  if p_total_people < 2 then raise exception 'El gasto debe dividirse entre al menos dos personas'; end if;
  if p_mode not in ('equal','custom') then raise exception 'Modo de reparto no válido'; end if;

  if p_source = 'ledger' then
    select amount_cents, creator_id into v_total, v_creator
    from public.ledger_transactions
    where id = p_transaction_id and kind = 'expense';
  elsif p_source = 'piggy' then
    select amount_cents, creator_id into v_total, v_creator
    from public.piggy_transactions
    where id = p_transaction_id and kind = 'expense';
  else
    raise exception 'Origen no válido';
  end if;

  if not found then raise exception 'Gasto no encontrado'; end if;
  if v_creator is distinct from auth.uid() then raise exception 'Solo el creador puede dividir el gasto'; end if;
  if v_selected_count > p_total_people - 1 then raise exception 'Hay más usuarios seleccionados que plazas disponibles'; end if;

  insert into public.expense_splits(
    source, transaction_id, creator_id, total_amount_cents, total_people, mode
  )
  values(
    p_source, p_transaction_id, auth.uid(), v_total, p_total_people, p_mode
  )
  returning id into v_split_id;

  v_equal_amount := floor(v_total::numeric / p_total_people)::bigint;

  for v_member in select * from jsonb_array_elements(coalesce(p_members, '[]'::jsonb))
  loop
    v_user_id := nullif(v_member->>'user_id','')::uuid;
    v_amount := case
      when p_mode = 'equal' then v_equal_amount
      else coalesce((v_member->>'amount_cents')::bigint, 0)
    end;

    if p_mode = 'custom' and v_amount <= 0 then
      raise exception 'Los importes personalizados deben ser mayores que cero';
    end if;

    v_custom_sum := v_custom_sum + v_amount;

    insert into public.expense_split_members(split_id, user_id, amount_cents)
    values(v_split_id, v_user_id, v_amount);

    if v_user_id is not null then
      insert into public.notifications(user_id, title, body, type, related_id)
      values(
        v_user_id,
        'Gasto pendiente',
        'Tienes una parte pendiente de ' || round(v_amount::numeric / 100, 2)::text || ' €.',
        'expense_split',
        v_split_id
      );
    end if;
  end loop;

  if p_mode = 'custom' and v_custom_sum > v_total then
    raise exception 'La suma de importes supera el total del gasto';
  end if;

  return v_split_id;
end;
$$;

create or replace function public.mark_split_member_paid(
  p_member_id uuid,
  p_paid boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.expense_split_members%rowtype;
  v_creator uuid;
begin
  select * into v_member
  from public.expense_split_members
  where id = p_member_id
  for update;

  if not found then raise exception 'Parte no encontrada'; end if;

  select creator_id into v_creator
  from public.expense_splits
  where id = v_member.split_id;

  if auth.uid() is distinct from v_member.user_id
     and auth.uid() is distinct from v_creator
     and not public.a2c_is_admin(auth.uid()) then
    raise exception 'No tienes permiso';
  end if;

  update public.expense_split_members
  set paid_at = case when p_paid then now() else null end
  where id = p_member_id;
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id
    and user_id = auth.uid();
$$;

create or replace function public.delete_notification_secure(p_notification_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notifications
  where id = p_notification_id
    and user_id = auth.uid();
$$;

grant execute on function public.update_transaction_secure(uuid,text,public.money_kind,bigint,text,date,uuid) to authenticated;
grant execute on function public.delete_transaction_secure(uuid,text) to authenticated;
grant execute on function public.invite_shared_resource(text,text,uuid) to authenticated;
grant execute on function public.respond_shared_invitation(uuid,boolean) to authenticated;
grant execute on function public.create_expense_split(text,uuid,integer,text,jsonb) to authenticated;
grant execute on function public.mark_split_member_paid(uuid,boolean) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.delete_notification_secure(uuid) to authenticated;

-- RLS para tablas nuevas.
alter table public.goal_members enable row level security;
alter table public.shared_invitations enable row level security;
alter table public.notifications enable row level security;
alter table public.expense_splits enable row level security;
alter table public.expense_split_members enable row level security;

drop policy if exists "goal_members_visible" on public.goal_members;
create policy "goal_members_visible"
on public.goal_members for select to authenticated
using (
  user_id = auth.uid()
  or exists(select 1 from public.goals g where g.id = goal_id and g.owner_id = auth.uid())
);

drop policy if exists "invitations_visible" on public.shared_invitations;
create policy "invitations_visible"
on public.shared_invitations for select to authenticated
using (invited_user_id = auth.uid() or inviter_id = auth.uid());

drop policy if exists "notifications_own" on public.notifications;
create policy "notifications_own"
on public.notifications for select to authenticated
using (user_id = auth.uid());

drop policy if exists "expense_splits_visible" on public.expense_splits;
create policy "expense_splits_visible"
on public.expense_splits for select to authenticated
using (
  creator_id = auth.uid()
  or exists(
    select 1 from public.expense_split_members m
    where m.split_id = id and m.user_id = auth.uid()
  )
);

drop policy if exists "split_members_visible" on public.expense_split_members;
create policy "split_members_visible"
on public.expense_split_members for select to authenticated
using (
  user_id = auth.uid()
  or exists(
    select 1 from public.expense_splits s
    where s.id = split_id and s.creator_id = auth.uid()
  )
);

notify pgrst, 'reload schema';

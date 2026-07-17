
-- A2C Finanzas Pro: categorías, presupuestos y movimientos recurrentes.
begin;

create table if not exists public.finance_categories(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  icon text not null default '•',
  kind text not null default 'both' check(kind in('income','expense','both')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique(user_id,name)
);

alter table public.finance_transactions
  add column if not exists category_id uuid references public.finance_categories(id) on delete set null,
  add column if not exists merchant text not null default '';

create table if not exists public.monthly_budgets(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  month text not null check(month ~ '^[0-9]{4}-[0-9]{2}$'),
  category_id uuid not null references public.finance_categories(id) on delete cascade,
  limit_cents bigint not null check(limit_cents>0),
  created_at timestamptz not null default now(),
  unique(user_id,month,category_id)
);

create table if not exists public.recurring_transactions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  resource_id uuid references public.resources(id) on delete cascade,
  category_id uuid references public.finance_categories(id) on delete set null,
  kind text not null check(kind in('income','expense','investment','saving')),
  concept text not null,
  amount_cents bigint not null check(amount_cents>0),
  frequency text not null check(frequency in('weekly','monthly','quarterly','yearly')),
  next_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.finance_categories enable row level security;
alter table public.monthly_budgets enable row level security;
alter table public.recurring_transactions enable row level security;

drop policy if exists categories_select on public.finance_categories;
create policy categories_select on public.finance_categories for select to authenticated
using(user_id is null or user_id=auth.uid() or public.is_admin(auth.uid()));

drop policy if exists categories_manage on public.finance_categories;
create policy categories_manage on public.finance_categories for all to authenticated
using(user_id=auth.uid() or public.is_admin(auth.uid()))
with check(user_id=auth.uid() or public.is_admin(auth.uid()));

drop policy if exists budgets_own on public.monthly_budgets;
create policy budgets_own on public.monthly_budgets for all to authenticated
using(user_id=auth.uid() or public.is_admin(auth.uid()))
with check(user_id=auth.uid() or public.is_admin(auth.uid()));

drop policy if exists recurring_own on public.recurring_transactions;
create policy recurring_own on public.recurring_transactions for all to authenticated
using(user_id=auth.uid() or public.is_admin(auth.uid()))
with check(user_id=auth.uid() or public.is_admin(auth.uid()));

insert into public.finance_categories(user_id,name,icon,kind,sort_order) values
(null,'Vivienda','⌂','expense',10),
(null,'Alimentación','◉','expense',20),
(null,'Transporte','◆','expense',30),
(null,'Salud','✚','expense',40),
(null,'Ocio','★','expense',50),
(null,'Educación','▣','expense',60),
(null,'Suscripciones','↻','expense',70),
(null,'Nómina','€','income',10),
(null,'Otros ingresos','＋','income',20),
(null,'Inversión','↗','both',80),
(null,'Ahorro','◎','both',90)
on conflict(user_id,name) do nothing;

commit;
notify pgrst,'reload schema';

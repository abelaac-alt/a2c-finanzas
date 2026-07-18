
-- A2C Finanzas Profesional V5
-- Limpia categorías duplicadas y deja únicamente las categorías solicitadas.
begin;

-- Las referencias se limpian de forma segura antes de sustituir el catálogo.
update public.finance_transactions
set category_id = null
where category_id is not null;

update public.recurring_transactions
set category_id = null
where category_id is not null;

delete from public.monthly_budgets;
delete from public.finance_categories;

-- Evita que las categorías globales vuelvan a duplicarse.
drop index if exists public.finance_categories_global_name_unique;
create unique index finance_categories_global_name_unique
on public.finance_categories(lower(name))
where user_id is null;

insert into public.finance_categories(user_id,name,icon,kind,sort_order) values
(null,'Transporte','◆','expense',10),
(null,'Ocio','★','expense',20),
(null,'Comida','●','expense',30),
(null,'Suscripciones','↻','expense',40),
(null,'Otros','•••','expense',50);

commit;
notify pgrst,'reload schema';

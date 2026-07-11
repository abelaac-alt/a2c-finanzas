select 'ledger creator_id' item,
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='ledger_transactions' and column_name='creator_id') ok
union all
select 'piggy receipt_path',
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='piggy_transactions' and column_name='receipt_path')
union all
select 'goal_members', to_regclass('public.goal_members') is not null
union all
select 'shared_invitations', to_regclass('public.shared_invitations') is not null
union all
select 'notifications', to_regclass('public.notifications') is not null
union all
select 'expense_splits', to_regclass('public.expense_splits') is not null
union all
select 'expense_split_members', to_regclass('public.expense_split_members') is not null
union all
select 'receipts bucket', exists(select 1 from storage.buckets where id='receipts');

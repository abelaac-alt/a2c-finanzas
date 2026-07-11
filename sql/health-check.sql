select 'profiles' as item, to_regclass('public.profiles') is not null as ok
union all select 'user_permissions', to_regclass('public.user_permissions') is not null
union all select 'ledger_transactions', to_regclass('public.ledger_transactions') is not null
union all select 'piggy_banks', to_regclass('public.piggy_banks') is not null
union all select 'piggy_transactions', to_regclass('public.piggy_transactions') is not null
union all select 'folders', to_regclass('public.folders') is not null
union all select 'goals', to_regclass('public.goals') is not null
union all select 'goal_contributions', to_regclass('public.goal_contributions') is not null;

begin;
create table if not exists public.expense_split_versions(
 id uuid primary key default gen_random_uuid(),
 split_id uuid not null references public.expense_splits(id) on delete cascade,
 conversation_id uuid references public.direct_conversations(id) on delete cascade,
 version_number integer not null,
 amount_cents bigint not null check(amount_cents>0),
 version_status text not null default 'pending' check(version_status in('pending','paid','cancelled','superseded')),
 is_current boolean not null default true,
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 replaced_at timestamptz,
 unique(split_id,version_number)
);
alter table public.expense_split_versions enable row level security;
drop policy if exists "split participants read versions" on public.expense_split_versions;
create policy "split participants read versions" on public.expense_split_versions for select using(
 exists(select 1 from public.expense_splits es where es.id=expense_split_versions.split_id and(es.owner_id=auth.uid() or es.debtor_user_id=auth.uid()))
);
revoke insert,update,delete on public.expense_split_versions from anon,authenticated;

create or replace function public.a2c_create_split_version_v55(p_split_id uuid,p_conversation_id uuid,p_amount_cents bigint,p_status text default 'pending')
returns uuid language plpgsql security definer set search_path=public as $$
declare n integer; vid uuid;
begin
 update public.expense_split_versions set is_current=false,version_status=case when version_status='pending' then 'superseded' else version_status end,replaced_at=now()
 where split_id=p_split_id and is_current=true;
 select coalesce(max(version_number),0)+1 into n from public.expense_split_versions where split_id=p_split_id;
 insert into public.expense_split_versions(split_id,conversation_id,version_number,amount_cents,version_status,is_current,created_by)
 values(p_split_id,p_conversation_id,n,p_amount_cents,p_status,true,auth.uid()) returning id into vid;
 return vid;
end $$;

create or replace function public.a2c_update_expense_split_v53(p_split_id uuid,p_amount_cents bigint)
returns void language plpgsql security definer set search_path=public,a2c_private,extensions as $$
declare s public.expense_splits%rowtype; t public.finance_transactions%rowtype; c uuid; k text; owner_name text;
begin
 select * into s from public.expense_splits where id=p_split_id and owner_id=auth.uid() and status='pending' for update;
 if not found then raise exception 'El reparto ya no se puede editar'; end if;
 select * into t from public.finance_transactions where id=s.transaction_id;
 if p_amount_cents<=0 or p_amount_cents>t.amount_cents then raise exception 'El importe no es válido'; end if;
 select conversation_id into c from public.transaction_shares where split_id=p_split_id limit 1;
 update public.expense_splits set amount_cents=p_amount_cents where id=p_split_id;
 perform public.a2c_create_split_version_v55(p_split_id,c,p_amount_cents,'pending');
 select coalesce(display_name,username,'Un amigo') into owner_name from public.profiles where id=auth.uid();
 if c is not null then
   select encryption_key into k from a2c_private.direct_conversation_keys where conversation_id=c;
   insert into public.direct_messages(conversation_id,sender_id,encrypted_body)
   values(c,auth.uid(),extensions.pgp_sym_encrypt(owner_name||' ha actualizado el reparto de "'||coalesce(t.concept,'Gasto compartido')||'". El nuevo importe es '||to_char(p_amount_cents/100.0,'FM999999990D00')||' €. La versión anterior queda anulada.',k,'cipher-algo=aes256,compress-algo=1'));
   update public.direct_conversations set updated_at=now() where id=c;
 end if;
 delete from public.notifications where user_id=s.debtor_user_id and related_id=p_split_id and type in('expense_split','expense_reminder','shared_expense','money_request');
 insert into public.notifications(user_id,type,title,message,related_id) values(s.debtor_user_id,'expense_split','Gasto compartido actualizado',owner_name||' ha actualizado tu parte a '||to_char(p_amount_cents/100.0,'FM999999990D00')||' €.',p_split_id);
end $$;

create or replace function public.a2c_list_conversation_splits_v55(p_conversation_id uuid)
returns table(version_id uuid,split_id uuid,transaction_id uuid,concept text,transaction_amount_cents bigint,occurred_on date,version_number integer,split_amount_cents bigint,version_status text,is_current boolean,mine_to_pay boolean,mine_to_manage boolean)
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.direct_conversation_members where conversation_id=p_conversation_id and user_id=auth.uid()) then raise exception 'No tienes acceso a esta conversación'; end if;
 return query
 select v.id,es.id,t.id,coalesce(t.concept,'Gasto compartido'),t.amount_cents,t.occurred_on,v.version_number,v.amount_cents,v.version_status,v.is_current,
 (es.debtor_user_id=auth.uid() and es.status='pending' and v.is_current and v.version_status='pending'),
 (es.owner_id=auth.uid() and es.status='pending' and v.is_current and v.version_status='pending')
 from public.transaction_shares ts join public.expense_splits es on es.id=ts.split_id join public.finance_transactions t on t.id=es.transaction_id join public.expense_split_versions v on v.split_id=es.id
 where ts.conversation_id=p_conversation_id order by v.created_at asc;
end $$;

create or replace function public.a2c_activate_expense_split_version_v55(p_split_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s public.expense_splits%rowtype; c uuid;
begin
 select * into s from public.expense_splits where id=p_split_id and owner_id=auth.uid();
 select conversation_id into c from public.transaction_shares where split_id=p_split_id limit 1;
 if not exists(select 1 from public.expense_split_versions where split_id=p_split_id) then
   perform public.a2c_create_split_version_v55(p_split_id,c,s.amount_cents,case when s.status='paid' then 'paid' else 'pending' end);
 end if;
end $$;

grant execute on function public.a2c_create_split_version_v55(uuid,uuid,bigint,text) to authenticated;
grant execute on function public.a2c_update_expense_split_v53(uuid,bigint) to authenticated;
grant execute on function public.a2c_list_conversation_splits_v55(uuid) to authenticated;
grant execute on function public.a2c_activate_expense_split_version_v55(uuid) to authenticated;
commit;
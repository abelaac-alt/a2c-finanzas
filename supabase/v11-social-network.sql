begin;

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists is_public boolean not null default true;

update public.profiles
set username = lower(regexp_replace(split_part(email,'@',1), '[^a-z0-9._]+', '_', 'g')) || '_' || substr(id::text,1,6)
where username is null or username = '';

alter table public.profiles alter column username set not null;
create unique index if not exists profiles_username_unique on public.profiles (lower(username));
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (username ~ '^[a-z0-9._]{3,30}$');

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair_unique on public.friendships (least(requester_id,addressee_id), greatest(requester_id,addressee_id));

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  transaction_id uuid references public.finance_transactions(id) on delete set null,
  image_path text not null,
  caption text not null default '' check (char_length(caption) <= 180),
  created_at timestamptz not null default now()
);

alter table public.friendships enable row level security;
alter table public.social_posts enable row level security;

drop policy if exists profiles_authenticated_read on public.profiles;
create policy profiles_authenticated_read on public.profiles for select to authenticated using (true);

drop policy if exists friendships_read_participants on public.friendships;
create policy friendships_read_participants on public.friendships for select to authenticated using (auth.uid() in (requester_id,addressee_id));
drop policy if exists friendships_insert_requester on public.friendships;
create policy friendships_insert_requester on public.friendships for insert to authenticated with check (requester_id=auth.uid() and addressee_id<>auth.uid() and status='pending');
drop policy if exists friendships_update_addressee on public.friendships;
create policy friendships_update_addressee on public.friendships for update to authenticated using (addressee_id=auth.uid()) with check (addressee_id=auth.uid());
drop policy if exists friendships_delete_participants on public.friendships;
create policy friendships_delete_participants on public.friendships for delete to authenticated using (auth.uid() in (requester_id,addressee_id));

drop policy if exists social_posts_read_visible on public.social_posts;
create policy social_posts_read_visible on public.social_posts for select to authenticated using (
 user_id=auth.uid()
 or exists(select 1 from public.profiles p where p.id=social_posts.user_id and p.is_public=true)
 or exists(select 1 from public.friendships f where f.status='accepted' and ((f.requester_id=auth.uid() and f.addressee_id=social_posts.user_id) or (f.addressee_id=auth.uid() and f.requester_id=social_posts.user_id)))
);
drop policy if exists social_posts_insert_own on public.social_posts;
create policy social_posts_insert_own on public.social_posts for insert to authenticated with check (user_id=auth.uid());
drop policy if exists social_posts_update_own on public.social_posts;
create policy social_posts_update_own on public.social_posts for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists social_posts_delete_own on public.social_posts;
create policy social_posts_delete_own on public.social_posts for delete to authenticated using (user_id=auth.uid());

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('social','social',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists social_storage_insert_own on storage.objects;
create policy social_storage_insert_own on storage.objects for insert to authenticated with check (bucket_id='social' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists social_storage_read_visible on storage.objects;
create policy social_storage_read_visible on storage.objects for select to authenticated using (
 bucket_id='social' and exists(
   select 1 from public.social_posts sp
   where sp.image_path=name and (
    sp.user_id=auth.uid()
    or exists(select 1 from public.profiles p where p.id=sp.user_id and p.is_public=true)
    or exists(select 1 from public.friendships f where f.status='accepted' and ((f.requester_id=auth.uid() and f.addressee_id=sp.user_id) or (f.addressee_id=auth.uid() and f.requester_id=sp.user_id)))
   )
 )
);
drop policy if exists social_storage_delete_own on storage.objects;
create policy social_storage_delete_own on storage.objects for delete to authenticated using (bucket_id='social' and (storage.foldername(name))[1]=auth.uid()::text);

notify pgrst, 'reload schema';
commit;

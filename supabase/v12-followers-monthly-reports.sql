begin;

create table if not exists public.profile_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (follower_id <> followed_id),
  unique (follower_id, followed_id)
);

alter table public.profile_follows enable row level security;

drop policy if exists profile_follows_read_participants on public.profile_follows;
create policy profile_follows_read_participants
on public.profile_follows for select to authenticated
using (auth.uid() in (follower_id, followed_id));

drop policy if exists profile_follows_insert_own on public.profile_follows;
create policy profile_follows_insert_own
on public.profile_follows for insert to authenticated
with check (
  follower_id = auth.uid()
  and followed_id <> auth.uid()
  and status in ('pending','accepted')
  and (
    status = 'pending'
    or exists (select 1 from public.profiles p where p.id = followed_id and p.is_public = true)
  )
);

drop policy if exists profile_follows_update_followed on public.profile_follows;
create policy profile_follows_update_followed
on public.profile_follows for update to authenticated
using (followed_id = auth.uid())
with check (followed_id = auth.uid() and status in ('accepted','rejected'));

drop policy if exists profile_follows_delete_participants on public.profile_follows;
create policy profile_follows_delete_participants
on public.profile_follows for delete to authenticated
using (auth.uid() in (follower_id, followed_id));

-- Las publicaciones privadas también son visibles para seguidores aceptados.
drop policy if exists social_posts_read_visible on public.social_posts;
create policy social_posts_read_visible
on public.social_posts for select to authenticated
using (
  user_id = auth.uid()
  or exists(select 1 from public.profiles p where p.id = social_posts.user_id and p.is_public = true)
  or exists(select 1 from public.profile_follows pf where pf.status='accepted' and pf.follower_id=auth.uid() and pf.followed_id=social_posts.user_id)
  or exists(select 1 from public.friendships f where f.status='accepted' and ((f.requester_id=auth.uid() and f.addressee_id=social_posts.user_id) or (f.addressee_id=auth.uid() and f.requester_id=social_posts.user_id)))
);

drop policy if exists social_storage_read_visible on storage.objects;
create policy social_storage_read_visible
on storage.objects for select to authenticated
using (
  bucket_id='social' and exists(
    select 1 from public.social_posts sp
    where sp.image_path=name and (
      sp.user_id=auth.uid()
      or exists(select 1 from public.profiles p where p.id=sp.user_id and p.is_public=true)
      or exists(select 1 from public.profile_follows pf where pf.status='accepted' and pf.follower_id=auth.uid() and pf.followed_id=sp.user_id)
      or exists(select 1 from public.friendships f where f.status='accepted' and ((f.requester_id=auth.uid() and f.addressee_id=sp.user_id) or (f.addressee_id=auth.uid() and f.requester_id=sp.user_id)))
    )
  )
);

notify pgrst, 'reload schema';
commit;

-- A2C Finanzas v20: protección adicional del inicio de sesión.
-- No almacena correos ni contraseñas. Solo guarda SHA-256(email normalizado), contador y bloqueo.

create table if not exists public.login_attempts (
  email_hash text primary key check (length(email_hash) = 64),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  last_failed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.login_attempts enable row level security;

-- La tabla no se expone a usuarios autenticados ni anónimos. Solo la service role
-- de la Edge Function puede administrarla, ya que la service role omite RLS.
revoke all on table public.login_attempts from anon, authenticated;

create index if not exists login_attempts_locked_until_idx
  on public.login_attempts (locked_until)
  where locked_until is not null;

-- Limpieza automática opcional: elimina registros antiguos cuando se ejecuta manualmente.
create or replace function public.cleanup_old_login_attempts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.login_attempts
  where updated_at < now() - interval '7 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_old_login_attempts() from public, anon, authenticated;

notify pgrst, 'reload schema';

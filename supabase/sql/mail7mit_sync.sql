create extension if not exists pg_net with schema extensions;
create table public.mail7mit_sync_secret(id boolean primary key default true check(id),secret text not null);
alter table public.mail7mit_sync_secret enable row level security;
revoke all on public.mail7mit_sync_secret from public,anon,authenticated;
grant select,insert,update,delete on public.mail7mit_sync_secret to service_role;
create table public.mail7mit_sync_state(
 account_id uuid primary key references public.mail7mit_accounts(id) on delete cascade,
 last_sync_at timestamptz not null default now(), encrypted_snapshot text,
 error text
);
alter table public.mail7mit_sync_state enable row level security;
revoke all on public.mail7mit_sync_state from public,anon,authenticated;
grant select,insert,update,delete on public.mail7mit_sync_state to service_role;

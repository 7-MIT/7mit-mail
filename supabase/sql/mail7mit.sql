create table public.mail7mit_accounts (
 id uuid primary key default gen_random_uuid(), owner_id text not null,
 email text not null, name text not null, encrypted_credentials text not null,
 created_at timestamptz not null default now(), unique(owner_id,email)
);
create index mail7mit_accounts_owner_idx on public.mail7mit_accounts(owner_id);
create table public.mail7mit_preferences (
 owner_id text primary key, signature text not null default '', contacts jsonb not null default '[]',
 updated_at timestamptz not null default now()
);
create table public.mail7mit_keys (
 id text primary key check(id='credentials_v1'), secret text not null,
 created_at timestamptz not null default now()
);
alter table public.mail7mit_accounts enable row level security;
alter table public.mail7mit_preferences enable row level security;
alter table public.mail7mit_keys enable row level security;
revoke all on public.mail7mit_accounts,public.mail7mit_preferences,public.mail7mit_keys from public,anon,authenticated;
grant select,insert,update,delete on public.mail7mit_accounts,public.mail7mit_preferences,public.mail7mit_keys to service_role;
-- No browser policies: all authorization is enforced by mail7mit-api.
-- Provision the key separately. Prefer MAIL_CREDENTIAL_KEY in Edge Function secrets.

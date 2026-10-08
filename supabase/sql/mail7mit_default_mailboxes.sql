-- Locked default mailbox passwords (one shared mailbox per lembaga). Encrypted with the same AES-256-GCM credential key as user mailboxes.
-- Service-role only, like mail7mit_keys. Seeded through the token-protected `seedDefaults` action of mail7mit-api.
create table public.mail7mit_default_mailboxes (
 mailbox_key text primary key check (mailbox_key in ('guru','eksekutif','legislatif','yudikatif','kemenjira','kemenkrep','kemenbanggul','kemenkesbug')),
 encrypted_password text not null,
 updated_at timestamptz not null default now()
);
alter table public.mail7mit_default_mailboxes enable row level security;
revoke all on public.mail7mit_default_mailboxes from public, anon, authenticated;
grant select, insert, update, delete on public.mail7mit_default_mailboxes to service_role;
-- No browser policies: all access goes through mail7mit-api.

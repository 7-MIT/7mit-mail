# mail.7mit

> **Repository layout.** The project in this folder (Next.js frontend + Supabase Edge Function on server.7mit, login through akun.7mit) is the main codebase. `node-backend/` holds an alternative standalone Node.js IMAP/SMTP backend with its own UI and tests (persistent IMAP IDLE, SMTP on port 587). It is not used by this app; see `node-backend/README.md`.

Responsive custom-provider webmail for the 7 MIT ecosystem. Incoming mail uses your IMAP server. Outgoing mail uses your SMTP server. All mail connections run in a Supabase Edge Function on server.7mit.

## Current delivery status

- Frontend builds successfully as a Cloudflare-compatible Worker.
- `mail7mit-api` is deployed at `https://lajzrempjyoqkubkumhb.supabase.co/functions/v1/mail7mit-api`.
- akun.7mit login is integrated with the existing `akun-auth` service.
- Database tables, encrypted credential storage, and a background-sync schedule are configured in server.7mit.
- Sites publication is blocked by the account's hosting usage limit.
- GitHub upload to `7-MIT/7mit-mail` was rejected because the connected GitHub integration lacks repository write access. This source package is the fallback delivery, not evidence of a GitHub commit.
- No real mailbox credentials were supplied. Reading and sending against a real mailbox have not been verified.

## Included features

Inbox, Sent, Drafts, Spam, Trash, custom folders, server-side search, 25-message pagination, unread counters, read/unread and starred flags, folder moves, reply, plain-text/HTML viewing and composition, attachment upload/download, contacts, signatures, multiple accounts and custom domains. Mail is held by your existing provider; connecting an account does not provision a new mailbox or domain.

The frontend refreshes the active mailbox every 60 seconds while visible. A Supabase Cron job runs every two minutes, processing up to two accounts due for background sync. Each account has a minimum four-minute background interval. Larger account populations take longer. Background sync stores an encrypted Inbox metadata snapshot (50 newest message summaries, flags, unread count, UID validity, folder list). Other folders are read on demand. Persistent IMAP IDLE is intentionally not used because hosted Edge Functions have bounded lifetimes.

## Source layout

- `app/mail.tsx`: webmail interface.
- `app/api/mail/route.ts`: same-origin server proxy and HttpOnly akun.7mit session cookie.
- `supabase/functions/mail7mit-api/index.ts`: IMAP/SMTP, mailbox operations, ownership checks, encryption, scheduled sync.
- `supabase/functions/mail7mit-api/security.mjs`: AES-256-GCM and public-address/DNS guards.
- `supabase/sql/`: exact schema and scheduling setup.
- `supabase/config.toml`: custom session authentication configuration.
- `pnpm-lock.yaml`: frontend dependency lock.

## Development and deployment

Requires Node.js 22.13 or newer and pnpm. Install with `pnpm install --frozen-lockfile`, then run `pnpm dev` or `pnpm build`. The generated Worker is `dist/server/index.js`. This is a fullstack Worker, not a static Cloudflare Pages export. Deploy the built Worker using the generated `dist/server/wrangler.json` with your Cloudflare account, or register and publish through Sites when quota is available. Do not add fake hosting project IDs to `.openai/hosting.json`.

The verified server.7mit function URL is in `app/api/mail/route.ts`. Change that URL when targeting another Supabase project. HTTPS is required for the secure session cookie. The interface does not require a Supabase service-role key in browser code or frontend runtime configuration.

The Supabase schema has already been applied to server.7mit. Do not rerun the CREATE TABLE scripts there. For a new project, review and apply them once, provision credential/sync keys, and deploy `mail7mit-api`. The existing `akun-auth`, `portal_login_accounts`, and `chat_user_sessions_v4` integration is a prerequisite; this project does not copy or replace those existing services.

Use the current Supabase CLI's help before running deployment commands. The function uses pinned npm imports. `verify_jwt=false` is deliberate: every private action verifies a live, unrevoked akun.7mit session and an active account server-side. Scheduled sync has a separate private token. The unauthenticated `status` action returns only service capabilities. No account data or passwords are returned by it.

## Connection settings

IMAP commonly uses TLS port 993. SMTP commonly uses TLS port 465. TLS certificates are verified; disabling certificate checks and plaintext authentication are not supported.

Supabase hosted functions block outgoing ports 25 and 587. These ports are rejected before a mailbox can be saved. A provider that only supports port 587 needs another supported submission port or a separately hosted relay. Provider support for another port must be confirmed with the provider.

Public mail hostnames are resolved server-side and the verified IP is pinned for each connection while preserving TLS server-name verification. Loopback, LAN, cloud-metadata, mapped, and known transition-tunnel addresses are rejected. This build supports publicly reachable mail servers; private intranet IMAP hosts are not supported.

## Credential storage and identity

Credentials are encrypted with AES-256-GCM using a fresh IV for every save. Browser access to mail tables and key tables is revoked; RLS is enabled with no browser policies. Only the Edge Function's service role accesses them. Passwords are transmitted during account setup over HTTPS, used to test both servers, then stored encrypted; passwords are never returned to the frontend, placed in localStorage, or committed.

The preferred credential key is a 32-byte base64 `MAIL_CREDENTIAL_KEY` Edge Function secret. Because the connected deployment tools cannot set Edge Function secrets, the current installation uses a service-role-only database key in `mail7mit_keys`. This separates browser access from credentials but does not protect credentials against a full database/service-role compromise. To move the key to an Edge Function secret, transfer the **same key** through the Supabase dashboard, verify existing accounts decrypt, then remove the database fallback row. Changing the key without re-encrypting existing accounts makes saved credentials unreadable. Never put it in GitHub, frontend environment variables, screenshots, or logs.

akun.7mit tokens are held in a Secure, HttpOnly, SameSite=Strict cookie in the frontend proxy. The proxy rejects cross-origin writes. Mail ownership is derived from the verified session's account key, never a client-supplied owner. Sessions expire after 30 days in this service and are checked for revocation on every operation. Different akun.7mit roles have separate mailbox ownership.

## HTML and attachments

HTML messages are rendered in a sandboxed iframe with no script permissions. The message document has a content-security policy that blocks external resources, including remote tracking images. The composer supports plain text or HTML source. Attachment names are sanitized; attachments are transmitted through the server proxy and included in MIME mail. There is a 10 MB total upload limit, ten attachments per message, and a 15 MB received-message viewer limit. SMTP success is reported separately from a failed attempt to append a copy to Sent so a user is not encouraged to resend an already delivered message.

## Validation

Frontend TypeScript check and Worker production build passed. Security tests cover credential encryption, tampering, wrong-key rejection, fresh-IV use, and private-host rejection. The deployed health and unauthenticated-access checks are recorded in `VALIDATION.md`. Real IMAP/SMTP, attachment round trips, and background mailbox contents remain untested until a real mailbox is connected. Browser/WebMCP execution validation was unavailable in this environment.

## Design update · 8 October 2026

Premium burgundy mail surfaces, rounded panels, focused input states, animated folder navigation, staggered message entrances, message-reader transitions, loading skeletons, button hover/press feedback, starred-message feedback, animated dialogs/tabs/attachments, and styled folder/disconnect dialogs. Responsive layout and prefers-reduced-motion support are preserved. Motion only loops during loading.


## Update: interaction layer and default servers

- **Default servers.** The "Connect a mailbox" form is pre-filled with `imap.foundermail.mx:993` (TLS/SSL) and `smtp.foundermail.mx:587` (STARTTLS). Username defaults to the email address and the outgoing password to the incoming one.
- **Port 587.** `mail7mit-api` accepts SMTP on 587 (STARTTLS); only port 25 is rejected. Verified against foundermail from the Supabase runtime.
- **Interface.** Initials avatars, hover quick actions (mark read/unread, trash), drag a message onto a folder to move it, keyboard shortcuts (`c`, `/`, `j`/`k`, `#`, `?`), button ripple, row exit animation, and debounced search (one IMAP search per pause instead of one per keystroke). Animations respect `prefers-reduced-motion`.


## Default mailboxes (locked) and staying signed in

Every akun.7mit user gets the shared mailbox of their lembaga as a **locked default**: it appears first in the mailbox list, cannot be edited or disconnected, and always uses `imap.foundermail.mx:993` (IMAP over SSL/TLS) and `smtp.foundermail.mx:587` (SMTP with STARTTLS). Other mailboxes can still be added unless `MAIL_ALLOW_EXTERNAL=0`. The default addresses themselves cannot be re-added as external mailboxes.

| Mailbox | Who gets it |
|---|---|
| `guru@7mit.org` | accounts of type `guru` |
| `eksekutif@7mit.org` | Presiden, Wakil Presiden, Bendahara, Sekretariat accounts, and students listed under Pengurus Inti |
| `legislatif@7mit.org` | members of Class Quality & Culture Board (CQCB) |
| `yudikatif@7mit.org` | members of Class Safety & Wellbeing |
| `kemenjira@`, `kemenkrep@`, `kemenbanggul@`, `kemenkesbug@7mit.org` | members of Soul & Space, Creativity & Experience, Excellence & Development, Health & Wellness |

Membership comes from `organization_members` / `organization_roles` (the same data as the organisation chart), matched to the login account by name (initials such as "Alamgir D. S." match full names). A name that matches two different lembaga gives **no** access; set it explicitly with `MAIL_DEPARTMENT_OVERRIDES='{"<account_key>":["legislatif","kemenkesbug"]}'`. An ordinary student with no lembaga has no default mailbox and can add their own.

**Passwords are not in this repository.** They live encrypted (AES-256-GCM, the same credential key as user mailboxes) in `public.mail7mit_default_mailboxes`, a service-role-only table (`supabase/sql/mail7mit_default_mailboxes.sql`). To (re)set them, call the token-protected `seedDefaults` action of `mail7mit-api` with the private sync token (the same one the background-sync cron uses), for example from SQL so the token never leaves the database:
```sql
select net.http_post(url:='https://<project>.supabase.co/functions/v1/mail7mit-api', headers:='{"Content-Type":"application/json"}'::jsonb,
  body:=jsonb_build_object('action','seedDefaults','syncToken',(select secret from public.mail7mit_sync_secret where id=true),
  'passwords',jsonb_build_object('guru','…','eksekutif','…','legislatif','…','yudikatif','…','kemenjira','…','kemenkrep','…','kemenbanggul','…','kemenkesbug','…')));
```
An optional `MAIL_DEFAULT_MAILBOXES` secret (JSON, see `supabase/default-mailboxes.example.json`) is still read and the table overrides it. Two more token-protected actions help operations: `testDefaults` signs in to IMAP and SMTP for each default mailbox and reports ok/error per mailbox, and `defaultsReport` counts how many accounts get each mailbox (no names, no secrets).

**SMTP on 587.** Verified from Supabase: signing in to `smtp.foundermail.mx` over STARTTLS on 587 works, so the earlier assumption that Supabase blocks 587 does not hold for this project. Only port 25 is rejected. For default mailboxes the function still retries on TLS 465 if 587 fails to connect at all.

**Staying signed in.** The login cookie now lasts 400 days (the browser maximum) and is renewed on every use; the 30-day limit in `mail7mit-api` is gone. A user is signed out only if the akun.7mit session is revoked on purpose (changing the password there, or "sign out other devices"), or they press Sign out.

Tests: `pnpm test:function` runs the real function handler against an in-memory database (default mailboxes per role, locked, no password in responses, 400-day sessions, 587 to 465 fallback, seeding and testing defaults).

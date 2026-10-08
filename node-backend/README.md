# 7 MIT Mail

Self-hosted webmail that talks to **any IMAP/SMTP server** (your own domain, Dovecot/Postfix, mailcow, cPanel, Gmail with app passwords, …).
Intended home: `mail.7mit.org`, signing in with the akun.7mit account, with an "Add external mailbox" page for arbitrary accounts.

```
Browser (SPA)  ──HTTPS/JSON+SSE──▶  Node backend  ──IMAP (IDLE) / SMTP──▶  your mail servers
                                       │
                                  SQLite: users, sessions, encrypted creds, header cache, contacts
```

The browser never sees IMAP/SMTP credentials and never opens mail sockets; only the backend does.

## Features
- Folders (Inbox/Drafts/Sent/Spam/Trash/Archive detected via SPECIAL-USE, plus custom folders: create/delete), unread counters, pagination, server-side search (subject/from/to/body), unread/starred filters
- Star / read / unread / move / delete (to Trash, permanent from Trash), bulk select, keyboard shortcuts (`c` compose, `/` search, `j`/`k` next/prev, `#` delete)
- HTML + plain-text viewer (sanitized, sandboxed iframe, remote images blocked until you allow them), inline `cid:` images
- Composer: To/Cc/Bcc, contact autocomplete, rich text, reply / reply-all / forward with quoting and threading headers, signatures, attachments (≤25 MB each), drafts saved to the server's Drafts folder, copy saved to Sent
- Download attachments (forced download, `nosniff`, sandbox CSP; only png/jpg/gif/webp ever render inline)
- Multiple accounts per user (max 10), separate IMAP and SMTP host/port/TLS/auth, connection test before saving
- Background sync with **IMAP IDLE** (falls back to polling where unsupported) pushing near-real-time updates to the UI over Server-Sent Events; optional browser notifications
- Contacts (auto-collected from sent mail), settings (theme, page size, remote images), responsive UI with dark mode

## Run
```bash
npm ci
export MASTER_KEY=$(openssl rand -base64 32)   # keep it safe & stable
export AKUN_AUTH_URL=https://lajzrempjyoqkubkumhb.supabase.co/functions/v1/akun-auth   # or ALLOW_REGISTRATION=1 for local accounts
npm start                                      # http://127.0.0.1:3000
```
Requires Node ≥ 22.13 (uses built-in `node:sqlite`). See `.env.example` for every setting. Docker: `docker build -t 7mit-mail . && docker run -p 3000:3000 -v mail7:/data -e MASTER_KEY=… 7mit-mail`.
Put it behind a TLS-terminating reverse proxy (nginx/Caddy) and set `TRUST_PROXY=1`; disable proxy buffering for `/api/events`.

## Default mail server
New mailboxes are pre-filled with `imap.foundermail.mx:993` (SSL/TLS) and `smtp.foundermail.mx:587` (STARTTLS); the username defaults to the full address. Override with `DEFAULT_IMAP_*` / `DEFAULT_SMTP_*` (see `.env.example`). Users can still change the hosts for any other provider.

## Sign-in with akun.7mit
akun.7mit authenticates through the `akun-auth` edge function on server.7mit: it looks the username up in `portal_login_accounts` (bcrypt `password_hash`, `active = true`) and creates a session token in `chat_user_sessions_v4`. This app reuses that function instead of reading the table itself, so it needs **no database or service-role credentials**.

- Set `AKUN_AUTH_URL`. The login form then asks for the akun.7mit username (`name` or `name@7mit`) and password. If one username has several account types (Siswa/Guru/Pengurus) the user picks one, exactly like akun.7mit.
- On success the backend creates its own session and keeps the akun.7mit token (encrypted). Every 5 minutes it re-validates that token, so **revoking the device in akun.7mit, changing the password there, or deactivating the account signs the user out of mail too**. Logging out here revokes only the token this login created.
- A user is identified by `account_key` (a Siswa and a Guru account with the same username get separate mailbox lists). The browser's IP and user agent are forwarded so the entry in akun.7mit's device list is meaningful.
- `Authorization: Bearer <akun.7mit session token>` is also accepted, for a future hand-off from akun.7mit to `mail.7mit.org` without retyping the password.
- Failed logins are rate limited here (10 / 15 min per IP+username) on top of akun.7mit's own delays.
- This project does not touch the existing `mail7mit_*` tables.
- Not verified against the live function: the build sandbox could not reach server.7mit, so the integration is tested against a mock that follows the `akun-auth` source. Run one real login after deploying.

## Security model
| Concern | Handling |
|---|---|
| Mail credentials | AES-256-GCM at rest (`MASTER_KEY`), decrypted only in server memory, never returned by the API |
| Arbitrary hosts (SSRF) | Hosts are DNS-resolved and rejected if loopback/private/link-local unless `ALLOW_PRIVATE_HOSTS=1` |
| Transport | TLS certificate verification on; unencrypted IMAP/SMTP refused unless `ALLOW_INSECURE=1` |
| Sessions / CSRF | Random tokens, only the SHA-256 stored; HttpOnly + SameSite=Lax cookie; mutating requests need `X-Requested-With` |
| Login abuse | scrypt hashing, 10 failures / 15 min per IP+email |
| Hostile email | `sanitize-html` allow-list, no scripts/forms/iframes/`javascript:`; rendered in a sandboxed iframe (no scripts); strict CSP; remote images blocked by default |
| Tenant isolation | Every account/message/contact query is scoped to the signed-in user (verified in tests: other users get 404) |

## Limits / not done yet
- Headers are cached; bodies are fetched on demand. Deep-history search relies on the server's SEARCH (so body search speed depends on your IMAP server).
- Sync window is the newest 100 messages per folder (older pages are back-filled when you scroll); flag changes made elsewhere on older mail show up on the next backfill/refresh.
- Only INBOX is IDLE-watched; other folders refresh on the periodic sync (default 2 min), on open via ⟳, and on your own actions.
- No OAuth2 (XOAUTH2) for Gmail/Outlook — use app passwords. No conversation threading view, no message-source/PGP, no import/export of contacts, no per-folder rename UI, single-process (no clustering of IDLE watchers).
- UI is Indonesian-only.

## Tests
`npm test` — unit tests plus an end-to-end test against a real Dovecot (see `test/README.md`).

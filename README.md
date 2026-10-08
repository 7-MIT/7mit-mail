# 7 MIT Mail

Self-hosted webmail that talks to **any IMAP/SMTP server** (your own domain, Dovecot/Postfix, mailcow, cPanel, Gmail with app passwords, …).
Intended home: `mail.7mit.org`, signing in through `akun.7mit`, with an "Add external mailbox" page for arbitrary accounts.

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
export ALLOW_REGISTRATION=1                    # or configure SSO, see below
npm start                                      # http://127.0.0.1:3000
```
Requires Node ≥ 22.13 (uses built-in `node:sqlite`). See `.env.example` for every setting. Docker: `docker build -t 7mit-mail . && docker run -p 3000:3000 -v mail7:/data -e MASTER_KEY=… 7mit-mail`.
Put it behind a TLS-terminating reverse proxy (nginx/Caddy) and set `TRUST_PROXY=1`; disable proxy buffering for `/api/events`.

## Sign-in with akun.7mit
Set `SSO_JWKS_URL` (or `SSO_JWT_SECRET` for HS256), plus `SSO_ISSUER` / `SSO_AUDIENCE` if you want them enforced. Any request carrying `Authorization: Bearer <jwt>` is accepted; the user is created on first sight from the `sub` and `email` claims.
**Assumption:** I don't know akun.7mit's token format, so this is a generic JWT verifier. A redirect-based login handoff (cookie/token exchange from akun.7mit to this app) still needs to be wired to however akun.7mit issues sessions. Local email+password accounts (`ALLOW_REGISTRATION=1`) work independently.
This project does not touch the existing `mail7mit_*` tables in the 7 MIT Supabase project.

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

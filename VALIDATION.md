# Validation

Verified on 8 October 2026:

- Frontend TypeScript compilation: passed.
- Production Cloudflare-compatible Worker build: passed.
- Security tests: 3 passed, 0 failed. Covers AES-GCM round trip, tamper rejection, wrong keys, fresh IVs, public IP filtering, and invalid hostname rejection.
- Deployed `mail7mit-api` status action: HTTP 200; reports Supabase Edge Functions and blocked SMTP ports 25/587.
- Deployed private accounts action without a session: HTTP 401, `Sign in with akun.7mit`.
- Scheduled and manually triggered authenticated background sync: HTTP 200, `synced: 0`. No mailbox accounts have been added.
- New mail table RLS: enabled. Anonymous/authenticated browser table grants: absent. The advisory about RLS without policies is expected for service-role-only tables.
- Production IMAP/SMTP authentication, actual send/read, folder mutations and attachments: not tested because no real mailbox credentials were supplied.
- Browser visual and WebMCP execution validation: unavailable.
- Local Deno dependency/type check: unavailable because the sandbox could not connect to the npm registry through Deno. The Supabase deployment bundled its imports successfully and the live function responded.
- GitHub upload: blocked with HTTP 403, `Resource not accessible by integration`.
- Sites registration/publication: blocked by Site Hosting usage limit.

Design update: frontend TypeScript check and Worker build passed. The updated CSS includes a reduced-motion override for animations, transitions, pseudo-elements, and hover transforms. No backend change or new mailbox operation was introduced. Visual browser validation remains unavailable.

## Update: interaction layer and default servers

- `tsc --noEmit`: passed. `pnpm build`: passed. `security.test.mjs`: 3 passed. ESLint: same 23 pre-existing `no-explicit-any` errors as before the change, none added.
- Browser run of the real Next.js app with `/api/mail` stubbed (the live server.7mit function is unreachable from the build sandbox): avatars render, hover actions appear, `j` opens the next message, `?` opens the shortcuts dialog, dragging a message onto Trash sends one `move` call, typing "budi" sends a single `messages` call, the form shows the foundermail defaults, and submitting with blank username/SMTP password fills them from the email and incoming password.
- Not verified: the edge-function change (587 to 465) was not run or deployed; any connection to `imap.foundermail.mx` / `smtp.foundermail.mx`; whether foundermail accepts SMTP on port 465.

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

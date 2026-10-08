// Runs the real index.ts handler (Deno API shimmed) against an in-memory database to check default-mailbox behaviour.
// node --import ./test-support/register.mjs --test handler.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const PASS = { guru: 'g'.repeat(32), legislatif: 'l'.repeat(32), eksekutif: 'e'.repeat(32) };
let handler; globalThis.__smtp = { calls: [] };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', MAIL_CREDENTIAL_KEY: crypto.randomBytes(32).toString('base64'), MAIL_DEFAULT_MAILBOXES: JSON.stringify(PASS) })[k] }, serve: (h) => { handler = h; } };
const { DB } = await import('./test-support/fake-supabase.mjs');
await import('./index.ts');

const old = new Date(Date.now() - 400 * 86400000).toISOString();
DB.portal_login_accounts = [
  { account_key: 'guru-1', display_name: 'Syariful Amri, Lc.', account_type: 'guru', role: 'Guru Kelas', active: true },
  { account_key: 'stu-izyan', display_name: 'Izyan Waiz Utomo', account_type: 'student', role: 'Siswa', active: true },
  { account_key: 'stu-biasa', display_name: 'Budi Biasa', account_type: 'student', role: 'Siswa', active: true },
  { account_key: 'pres-1', display_name: 'Adelio Baradeva Raditya P.', account_type: 'pengurus', role: 'Presiden', active: true },
];
DB.organization_roles = [{ id: 'r1', role_key: 'cqcb' }];
DB.organization_members = [{ role_id: 'r1', role_key: null, member_name: 'Izyan Waiz Utomo', student_name: null }];
DB.chat_user_sessions_v4 = [
  { token: '11111111-1111-1111-1111-111111111111', account_key: 'guru-1', revoked: false, created_at: old },
  { token: '22222222-2222-2222-2222-222222222222', account_key: 'stu-izyan', revoked: false, created_at: old },
  { token: '33333333-3333-3333-3333-333333333333', account_key: 'stu-biasa', revoked: false, created_at: new Date().toISOString() },
  { token: '44444444-4444-4444-4444-444444444444', account_key: 'pres-1', revoked: false, created_at: new Date().toISOString() },
  { token: '55555555-5555-5555-5555-555555555555', account_key: 'stu-izyan', revoked: true, created_at: new Date().toISOString() },
];
const call = async (token, body) => { const r = await handler(new Request('http://f', { method: 'POST', body: JSON.stringify({ token, ...body }) })); return { status: r.status, body: await r.json() }; };
const T = { guru: '11111111-1111-1111-1111-111111111111', izyan: '22222222-2222-2222-2222-222222222222', biasa: '33333333-3333-3333-3333-333333333333', pres: '44444444-4444-4444-4444-444444444444', revoked: '55555555-5555-5555-5555-555555555555' };

test('each role lists its own default mailbox, locked, with no secrets', async () => {
  const g = await call(T.guru, { action: 'accounts' });
  assert.equal(g.status, 200); assert.deepEqual(g.body.accounts.map((a) => [a.id, a.email, a.locked]), [['default:guru', 'guru@7mit.org', true]]);
  assert.deepEqual((await call(T.izyan, { action: 'accounts' })).body.accounts.map((a) => a.email), ['legislatif@7mit.org']);
  assert.deepEqual((await call(T.pres, { action: 'accounts' })).body.accounts.map((a) => a.email), ['eksekutif@7mit.org']);
  assert.deepEqual((await call(T.biasa, { action: 'accounts' })).body.accounts, []);
  assert.ok(!JSON.stringify(g.body).includes(PASS.guru), 'password never returned');
});

test('sessions older than 30 days stay signed in; revoked ones do not', async () => {
  assert.equal((await call(T.guru, { action: 'accounts' })).status, 200, '400-day-old session still valid');
  assert.equal((await call(T.revoked, { action: 'accounts' })).status, 401);
  assert.equal((await call('not-a-token', { action: 'accounts' })).status, 401);
});

test('default mailboxes cannot be removed, and other departments are off limits', async () => {
  const del = await call(T.guru, { action: 'deleteAccount', account: 'default:guru' });
  assert.equal(del.status, 403); assert.match(del.body.error, /cannot be removed/);
  assert.equal((await call(T.biasa, { action: 'folders', account: 'default:guru' })).status, 404, 'not theirs');
  assert.equal((await call(T.izyan, { action: 'folders', account: 'default:eksekutif' })).status, 404, 'other lembaga');
  assert.equal((await call(T.izyan, { action: 'folders', account: 'default:bogus' })).status, 404);
});

test('a default address cannot be added as an external mailbox', async () => {
  const values = (o) => ({ email: 'x@y.zz', name: 'X', imapHost: 'imap.example.com', imapPort: 993, imapTls: 'ssl', imapUser: 'x@y.zz', imapPassword: 'pw', smtpHost: 'smtp.example.com', smtpPort: 465, smtpTls: 'ssl', smtpUser: 'x@y.zz', smtpPassword: 'pw', ...o });
  for (const o of [{ email: 'guru@7mit.org' }, { imapUser: 'eksekutif@7mit.org' }, { smtpUser: 'GURU@7mit.org' }]) {
    const r = await call(T.biasa, { action: 'addAccount', values: values(o) });
    assert.equal(r.status, 403, JSON.stringify(o)); assert.match(r.body.error, /default organization mailbox/);
  }
});

test('default mailbox connects with IMAP over TLS and sends with STARTTLS on 587, falling back to TLS 465 if 587 is blocked', async () => {
  const send = { action: 'send', account: 'default:guru', to: 'a@b.cc', subject: 's', body: 'b', format: 'text', attachments: [] };
  globalThis.__smtp.calls = [];
  assert.equal((await call(T.guru, send)).status, 200);
  assert.deepEqual(globalThis.__smtp.calls.map((c) => [c.host, c.port, c.secure, c.requireTLS, c.user]), [['203.0.113.5', 587, false, true, 'guru@7mit.org']]);
  assert.equal(globalThis.__imapOpts.secure, true); assert.equal(globalThis.__imapOpts.port, 993);

  globalThis.__smtp.calls = []; globalThis.__smtp.fail = (o) => (o.port === 587 ? Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }) : undefined);
  const r = await call(T.guru, send);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(globalThis.__smtp.calls.map((c) => [c.port, c.secure]), [[587, false], [465, true]]);

  globalThis.__smtp.calls = []; globalThis.__smtp.fail = () => Object.assign(new Error('535 Authentication failed'), { code: 'EAUTH' });
  assert.notEqual((await call(T.guru, send)).status, 200, 'auth failures are not retried on another port');
  assert.equal(globalThis.__smtp.calls.length, 1); globalThis.__smtp.fail = null;
});

// akun.7mit login, tested against a mock that follows the contract of the `akun-auth` edge function.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const { createApp } = await import('../server/app.js');
const { openDb } = await import('../server/db.js');

function mockAkun() {
  const sessions = new Map(); const seen = []; let down = false;
  const accts = { budi: [{ account_key: 'siswa-budi', username: 'budi', display_name: 'Budi S', role: 'siswa', account_type: 'student' }],
    ani: [{ account_key: 'siswa-ani', username: 'ani', display_name: 'Ani', role: 'siswa', account_type: 'student' }, { account_key: 'guru-ani', username: 'ani', display_name: 'Ani (Guru)', role: 'guru', account_type: 'guru' }] };
  const pub = (a) => ({ account_key: a.account_key, account_type: a.account_type, role: a.role, label: a.account_type === 'student' ? 'Akun Siswa' : 'Akun Guru' });
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
      const b = JSON.parse(raw || '{}'); seen.push({ body: b, headers: req.headers });
      const send = (st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (down) return send(503, { error: 'down' });
      if (b.action === 'login') {
        const list = accts[b.username] || []; if (!list.length || b.password !== 'rahasia123') return send(401, { error: 'Username atau password tidak sesuai.' });
        if (list.length > 1 && !b.account_key) return send(409, { selection_required: true, accounts: list.map(pub) });
        const a = list.find((x) => x.account_key === (b.account_key || list[0].account_key)); if (!a) return send(401, { error: 'x' });
        const token = crypto.randomUUID(); sessions.set(token, { a, revoked: false });
        return send(200, { token, profile: a });
      }
      const s = sessions.get(b.token);
      if (b.action === 'logout') { if (s) s.revoked = true; return send(200, { ok: true }); }
      if (b.action === 'session') return s && !s.revoked ? send(200, { profile: s.a }) : send(401, { error: 'Sesi telah berakhir.' });
      send(400, { error: 'Aksi tidak dikenal.' });
    });
  });
  return { server, sessions, seen, setDown: (v) => (down = v) };
}

test('akun.7mit login mode', async (t) => {
  const m = mockAkun(); await new Promise((r) => m.server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, AKUN_AUTH_URL: `http://127.0.0.1:${m.server.address().port}/akun-auth`, ALLOW_REGISTRATION: '1' };
  const { app, sync, db } = createApp({ db: openDb(':memory:'), key: crypto.randomBytes(32), env });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { sync.stopAll(); server.close(); m.server.close(); });

  const mk = () => { const jar = {}; return async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(method !== 'GET' ? { 'x-requested-with': '7mit-mail' } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return { status: r.status, body: await r.json().catch(() => null) };
  }; };
  const call = mk();

  assert.deepEqual((await call('GET', '/api/auth/config')).body, { akun: true, registration: false, akunUrl: null });
  assert.equal((await call('POST', '/api/auth/register', { email: 'x@y.zz', password: 'long-enough-pass' })).status, 403, 'local sign-up disabled');

  // wrong password / unknown user -> same generic 401
  assert.equal((await call('POST', '/api/auth/login', { username: 'budi', password: 'salah' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { username: 'nobody', password: 'rahasia123' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { username: '../etc', password: 'x' })).status, 400);

  // username normalisation (@7mit suffix, case) + browser IP/UA forwarded upstream
  const ok = await call('POST', '/api/auth/login', { username: ' Budi@7MIT ', password: 'rahasia123' }, { 'user-agent': 'TestBrowser/1.0' });
  assert.equal(ok.status, 200);
  const sent = m.seen.at(-1); assert.equal(sent.body.username, 'budi'); assert.equal(sent.headers['user-agent'], 'TestBrowser/1.0'); assert.ok(sent.headers['x-forwarded-for']);
  const me = (await call('GET', '/api/me')).body; assert.equal(me.email, 'budi@7mit'); assert.equal(me.name, 'Budi S');
  const stored = db.prepare('SELECT akun_token_enc FROM sessions').get().akun_token_enc;
  assert.ok(stored.startsWith('v1.') && ![...m.sessions.keys()].some((k) => stored.includes(k)), 'upstream token encrypted at rest');

  // several account types -> selection flow
  const c2 = mk();
  const sel = await c2('POST', '/api/auth/login', { username: 'ani', password: 'rahasia123' });
  assert.equal(sel.status, 409); assert.equal(sel.body.accounts.length, 2);
  assert.equal((await c2('POST', '/api/auth/login', { username: 'ani', password: 'rahasia123', account_key: 'guru-ani' })).status, 200);
  assert.equal((await c2('GET', '/api/me')).body.name, 'Ani (Guru)');
  assert.notEqual((await c2('GET', '/api/me')).body.id, me.id, 'accounts are separate users');

  // upstream revocation (device removed in akun.7mit) ends the mail session at the next re-check
  const token = [...m.sessions.entries()].find(([, v]) => v.a.account_key === 'siswa-budi')[0];
  m.sessions.get(token).revoked = true;
  assert.equal((await call('GET', '/api/me')).status, 200, 'still valid until the re-check interval elapses');
  db.prepare('UPDATE sessions SET checked_at=0').run();
  assert.equal((await call('GET', '/api/me')).status, 401, 'revoked upstream -> signed out');

  // akun.7mit outage must not log everyone out
  db.prepare('UPDATE sessions SET checked_at=0').run(); m.setDown(true);
  assert.equal((await c2('GET', '/api/me')).status, 200);
  m.setDown(false);

  // bearer hand-off
  const tk = crypto.randomUUID(); m.sessions.set(tk, { a: { account_key: 'siswa-budi', username: 'budi', display_name: 'Budi S', role: 'siswa', account_type: 'student' }, revoked: false });
  const viaBearer = await mk()('GET', '/api/me', null, { authorization: `Bearer ${tk}` });
  assert.equal(viaBearer.status, 200); assert.equal(viaBearer.body.email, 'budi@7mit');
  assert.equal((await mk()('GET', '/api/me', null, { authorization: `Bearer ${crypto.randomUUID()}` })).status, 401);
  assert.equal((await mk()('GET', '/api/me', null, { authorization: 'Bearer not-a-uuid' })).status, 401);

  // logout revokes only the token this login created
  const c3 = mk(); await c3('POST', '/api/auth/login', { username: 'budi', password: 'rahasia123' });
  const mine = [...m.sessions.entries()].filter(([, v]) => v.a.account_key === 'siswa-budi' && !v.revoked).map(([k]) => k);
  await c3('POST', '/api/auth/logout');
  assert.equal((await c3('GET', '/api/me')).status, 401);
  const after = [...m.sessions.entries()].filter(([, v]) => v.a.account_key === 'siswa-budi' && !v.revoked).map(([k]) => k);
  assert.equal(mine.length - after.length, 1);
  assert.ok(after.includes(tk), 'other devices keep their sessions');

  // brute force limit
  const c4 = mk(); for (let i = 0; i < 10; i++) await c4('POST', '/api/auth/login', { username: 'budi', password: 'bad' + i });
  assert.equal((await c4('POST', '/api/auth/login', { username: 'budi', password: 'rahasia123' })).status, 429);
});

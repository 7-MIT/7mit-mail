// akun.7mit sign-in (mock of akun-auth) -> mailbox on a REAL Dovecot server. Skipped when Dovecot is not on :1143.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { SMTPServer } from 'smtp-server';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { mockAkun } from './helpers/mock-akun.js';

const { createApp } = await import('../server/app.js');
const { openDb } = await import('../server/db.js');
const IMAP = { host: '127.0.0.1', port: Number(process.env.TEST_IMAP_PORT) || 1143 };
const USER = process.env.TEST_IMAP_USER || 'tester@7mit.test', PASS = process.env.TEST_IMAP_PASS || 'secret123';
const up = await new Promise((r) => { const s = net.connect(IMAP.port, IMAP.host); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
const wait = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 150)); } throw new Error('timed out'); };

test('akun.7mit login, then a Dovecot mailbox end to end', { skip: !up && 'no Dovecot on :1143' }, async (t) => {
  const akun = mockAkun(); await new Promise((r) => akun.server.listen(0, '127.0.0.1', r));
  const sent = [];
  const smtp = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onAuth: (a, s, cb) => cb(null, { user: a.username }), onData(st, s, cb) { simpleParser(st).then((m) => { sent.push(m); cb(); }, cb); } });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const env = { ...process.env, AKUN_AUTH_URL: `http://127.0.0.1:${akun.server.address().port}/akun-auth`, ALLOW_PRIVATE_HOSTS: '1', ALLOW_INSECURE: '1' };
  process.env.ALLOW_PRIVATE_HOSTS = '1'; // netguard reads process.env
  const { app, sync } = createApp({ db: openDb(':memory:'), key: crypto.randomBytes(32), env });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const seed = new ImapFlow({ ...IMAP, secure: false, doSTARTTLS: false, auth: { user: USER, pass: PASS }, logger: false });
  t.after(() => { sync.stopAll(); server.close(); akun.server.close(); smtp.close(); seed.close(); });

  const jar = {};
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(method !== 'GET' ? { 'x-requested-with': '7mit-mail' } : {}), ...(body ? { 'content-type': 'application/json' } : {}), accept: path.startsWith('/api') ? 'application/json' : 'text/html' }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const type = r.headers.get('content-type') || '';
    return { status: r.status, type, body: type.includes('json') ? await r.json() : await r.text() };
  };

  // 404 handling: app routes open the app, API misses stay JSON 404s
  for (const p of ['/', '/mail', '/login', '/demo.html']) { const r = await call('GET', p); assert.equal(r.status, 200, p); assert.match(r.body, /7 MIT Mail/); }

  // akun.7mit is the sign-in; local sign-up is off
  const cfg = (await call('GET', '/api/auth/config')).body;
  assert.equal(cfg.akun, true); assert.equal(cfg.registration, false); assert.equal(cfg.akunUrl, 'https://akun.7mit.org');
  assert.equal((await call('GET', '/api/accounts')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { username: 'budi', password: 'salah' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { username: 'budi@7mit', password: 'rahasia123' })).status, 200);
  assert.equal((await call('GET', '/api/me')).body.email, 'budi@7mit');
  const miss = await call('GET', '/api/nope'); assert.equal(miss.status, 404); assert.match(miss.type, /json/);

  // Dovecot: seed mail directly over IMAP
  await seed.connect();
  for (const p of ['INBOX', 'Sent', 'Drafts', 'Trash']) { const l = await seed.getMailboxLock(p); try { await seed.messageDelete('1:*').catch(() => {}); } finally { l.release(); } }
  const raw = (s, b) => `From: Ayu <ayu@7mit.org>\r\nTo: ${USER}\r\nSubject: ${s}\r\nMessage-ID: <${crypto.randomUUID()}@7mit.org>\r\nDate: Thu, 08 Oct 2026 08:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${b}\r\n`;
  await seed.append('INBOX', raw('Rapat OSIS', 'Jumat jam 10.'));
  await seed.append('INBOX', raw('Tugas Fisika', 'Kumpulkan Senin.'));

  // connect the Dovecot mailbox through the app (username/password forms exactly as a user would fill them)
  const add = await call('POST', '/api/accounts', { label: 'Dovecot', email: USER, displayName: 'Budi',
    imap: { host: IMAP.host, port: IMAP.port, secure: 'none', user: USER, password: PASS }, smtp: { host: '127.0.0.1', port: smtp.server.address().port, secure: 'none', user: USER, password: PASS } });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const id = add.body.id;
  await wait(async () => (await call('GET', `/api/accounts/${id}/folders`)).body.find?.((f) => f.special === 'inbox')?.total === 2);
  const folders = (await call('GET', `/api/accounts/${id}/folders`)).body;
  assert.deepEqual(folders.map((f) => f.special).filter(Boolean), ['inbox', 'drafts', 'sent', 'junk', 'trash'], 'Dovecot SPECIAL-USE folders recognised');
  const list = (await call('GET', `/api/accounts/${id}/messages?folder=INBOX`)).body.messages;
  assert.deepEqual(list.map((m) => m.subject).sort(), ['Rapat OSIS', 'Tugas Fisika']);
  const msg = (await call('GET', `/api/accounts/${id}/messages/${list[0].uid}?folder=INBOX`)).body;
  assert.ok(msg.text.length > 0);

  // send through SMTP; Sent copy lands in Dovecot's Sent
  const fd = new FormData(); fd.append('payload', JSON.stringify({ to: 'ayu@7mit.org', subject: 'Re: Rapat OSIS', text: 'Hadir.' }));
  const r = await fetch(base + `/api/accounts/${id}/send`, { method: 'POST', headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), 'x-requested-with': '7mit-mail' }, body: fd });
  assert.equal(r.status, 200); assert.equal((await r.json()).savedToSent, true);
  assert.equal(sent[0].subject, 'Re: Rapat OSIS');
  assert.equal((await call('GET', `/api/accounts/${id}/messages?folder=Sent`)).body.messages[0].subject, 'Re: Rapat OSIS');

  // IDLE: a new message arriving on Dovecot shows up without any request-triggered sync
  await seed.append('INBOX', raw('Masuk lewat IDLE', 'baru'));
  await wait(async () => (await call('GET', `/api/accounts/${id}/messages?folder=INBOX&limit=1`)).body.messages[0]?.subject === 'Masuk lewat IDLE', 12000);

});

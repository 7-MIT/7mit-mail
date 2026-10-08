// Integration test against a real IMAP server. Requires Dovecot on 127.0.0.1:1143
// (tester@7mit.test / secret123, see test/README.md). Skipped when unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { SMTPServer } from 'smtp-server';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

process.env.ALLOW_PRIVATE_HOSTS = '1';
process.env.ALLOW_INSECURE = '1';
process.env.ALLOW_REGISTRATION = '1';
const { createApp } = await import('../server/app.js');
const { openDb } = await import('../server/db.js');

const IMAP = { host: '127.0.0.1', port: Number(process.env.TEST_IMAP_PORT) || 1143 };
const USER = process.env.TEST_IMAP_USER || 'tester@7mit.test', PASS = process.env.TEST_IMAP_PASS || 'secret123';
const up = await new Promise((r) => { const s = net.connect(IMAP.port, IMAP.host); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });

const mime = (subject, extra = '', body = 'hello world') => `From: Alice <alice@example.com>\r\nTo: ${USER}\r\nSubject: ${subject}\r\nMessage-ID: <${crypto.randomUUID()}@example.com>\r\nDate: Wed, 07 Oct 2026 10:00:00 +0000\r\n${extra || 'Content-Type: text/plain; charset=utf-8\r\n'}\r\n${body}\r\n`;
const MULTI = (subject) => mime(subject, 'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="B"\r\n', [
  '--B', 'Content-Type: text/html; charset=utf-8', '', '<p>Hi <b>there</b></p><script>alert(1)</script><img src="https://track.example/x.gif">', '--B',
  'Content-Type: application/pdf; name="doc.pdf"', 'Content-Disposition: attachment; filename="doc.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-fake').toString('base64'), '--B--'].join('\r\n'));

test('webmail end-to-end', { skip: !up && 'no IMAP server on :1143' }, async (t) => {
  const sent = [];
  const smtp = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onAuth: (a, s, cb) => cb(null, { user: a.username }),
    onData(stream, session, cb) { simpleParser(stream).then((m) => { sent.push({ m, rcpt: session.envelope.rcptTo.map((r) => r.address) }); cb(); }, cb); } });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const smtpPort = smtp.server.address().port;

  const { app, sync, db } = createApp({ db: openDb(':memory:'), key: crypto.randomBytes(32) });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { sync.stopAll(); server.close(); smtp.close(); });

  const jar = {};
  const call = async (method, path, body, { raw } = {}) => {
    const isForm = body instanceof FormData;
    const r = await fetch(base + path, { method, redirect: 'manual',
      headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(method !== 'GET' ? { 'x-requested-with': '7mit-mail' } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return raw ? r : { status: r.status, body: await r.json().catch(() => null) };
  };

  // auth + CSRF
  assert.equal((await call('GET', '/api/accounts')).status, 401);
  const noCsrf = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 403);
  assert.equal((await call('POST', '/api/auth/register', { email: 'me@7mit.test', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { email: 'me@7mit.test', password: 'a-long-password-1' })).status, 200);
  assert.equal((await call('GET', '/api/me')).body.email, 'me@7mit.test');

  // seed mailbox directly over IMAP
  const seed = new ImapFlow({ ...IMAP, secure: false, doSTARTTLS: false, auth: { user: USER, pass: PASS }, logger: false });
  await seed.connect();
  t.after(() => seed.close());
  for (const p of ['INBOX', 'Sent', 'Drafts', 'Trash']) { const l = await seed.getMailboxLock(p); try { await seed.messageDelete('1:*').catch(() => {}); } finally { l.release(); } }
  await seed.append('INBOX', mime('First message'));
  await seed.append('INBOX', MULTI('With attachment'));
  await seed.append('INBOX', mime('Third needle message', undefined, 'the haystack contains zebra'));

  // account validation
  const acct = { label: 'Test', email: USER, displayName: 'Tester', imap: { host: IMAP.host, port: IMAP.port, secure: 'none', user: USER, password: PASS }, smtp: { host: '127.0.0.1', port: smtpPort, secure: 'none', user: USER, password: PASS } };
  const bad = await call('POST', '/api/accounts', { ...acct, imap: { ...acct.imap, password: 'nope' } });
  assert.equal(bad.status, 400); assert.notEqual(bad.body.details.imap, 'ok');
  const created = await call('POST', '/api/accounts', acct);
  assert.equal(created.status, 201);
  assert.ok(!JSON.stringify(created.body).includes(PASS), 'password must not be returned');
  const id = created.body.id;
  const stored = db.prepare('SELECT imap_pass_enc,smtp_pass_enc FROM accounts WHERE id=?').get(id);
  assert.ok(stored.imap_pass_enc.startsWith('v1.') && !stored.imap_pass_enc.includes(PASS), 'credentials encrypted at rest');

  // initial sync (background watcher)
  await waitFor(async () => (await call('GET', `/api/accounts/${id}/folders`)).body.find((f) => f.special === 'inbox')?.total === 3);
  const folders = (await call('GET', `/api/accounts/${id}/folders`)).body;
  assert.deepEqual(folders.map((f) => f.special).filter(Boolean), ['inbox', 'drafts', 'sent', 'junk', 'trash']);
  assert.equal(folders.find((f) => f.special === 'inbox').unseen, 3);
  assert.equal((await call('GET', '/api/unread')).body.total, 3);

  // list + pagination
  let list = (await call('GET', `/api/accounts/${id}/messages?folder=INBOX&limit=2`)).body;
  assert.equal(list.messages.length, 2); assert.equal(list.hasMore, true);
  assert.equal(list.messages[0].subject, 'Third needle message');
  const page2 = (await call('GET', `/api/accounts/${id}/messages?folder=INBOX&limit=2&before=${list.messages[1].uid}`)).body;
  assert.equal(page2.messages.length, 1); assert.equal(page2.hasMore, false);
  const attUid = list.messages[1].uid;
  assert.equal(list.messages[1].hasAttachments, true);

  // search hits body server-side
  const found = (await call('GET', `/api/accounts/${id}/messages?folder=INBOX&q=zebra`)).body;
  assert.deepEqual(found.messages.map((m) => m.subject), ['Third needle message']);

  // read message: sanitized, marks read, counters drop
  const msg = (await call('GET', `/api/accounts/${id}/messages/${attUid}?folder=INBOX`)).body;
  assert.ok(msg.html.includes('<b>there</b>') && !/<script|\ssrc="https/i.test(msg.html));
  assert.equal(msg.blockedImages, 1);
  assert.equal(msg.attachments[0].filename, 'doc.pdf');
  assert.equal((await call('GET', '/api/unread')).body.total, 2);
  const withImg = (await call('GET', `/api/accounts/${id}/messages/${attUid}?folder=INBOX&images=1`)).body;
  assert.ok(withImg.html.includes('https://track.example/x.gif'));

  // attachment download is forced-download with safe headers
  const att = await call('GET', `/api/accounts/${id}/messages/${attUid}/attachments/0?folder=INBOX`, null, { raw: true });
  assert.equal(att.status, 200);
  assert.match(att.headers.get('content-disposition'), /^attachment/);
  assert.equal(att.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await att.arrayBuffer()).toString(), '%PDF-fake');

  // flags: star + unread
  const uid1 = page2.messages[0].uid;
  await call('POST', `/api/accounts/${id}/messages/flags`, { folder: 'INBOX', uids: [uid1], add: ['flagged'], remove: ['seen'] });
  assert.equal((await call('GET', `/api/accounts/${id}/messages?folder=INBOX&starred=1`)).body.messages[0].uid, uid1);
  const lk = await seed.getMailboxLock('INBOX');
  const chk = await seed.fetchOne(String(uid1), { flags: true }, { uid: true }).finally(() => lk.release());
  assert.ok(chk.flags.has('\\Flagged') && !chk.flags.has('\\Seen'), 'flag change reached the IMAP server');

  // delete -> Trash, delete from Trash -> purged
  await call('POST', `/api/accounts/${id}/messages/delete`, { folder: 'INBOX', uids: [uid1] });
  assert.equal((await call('GET', `/api/accounts/${id}/messages?folder=INBOX`)).body.messages.some((m) => m.uid === uid1), false);
  const trash = (await call('GET', `/api/accounts/${id}/messages?folder=Trash`)).body.messages;
  assert.equal(trash.length, 1);
  await call('POST', `/api/accounts/${id}/messages/delete`, { folder: 'Trash', uids: [trash[0].uid] });
  assert.equal((await call('GET', `/api/accounts/${id}/messages?folder=Trash`)).body.messages.length, 0);

  // send with attachment through SMTP; copy lands in Sent
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ to: 'bob@example.org, Carol <carol@example.org>', bcc: 'hidden@example.org', subject: 'Hello ✓', text: 'plain body', html: '<p>html body</p>' }));
  fd.append('files', new Blob(['file-bytes'], { type: 'text/plain' }), 'note.txt');
  const sendRes = await call('POST', `/api/accounts/${id}/send`, fd);
  assert.equal(sendRes.status, 200, JSON.stringify(sendRes.body));
  assert.equal(sendRes.body.savedToSent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].m.subject, 'Hello ✓'); assert.equal(sent[0].m.attachments[0].filename, 'note.txt');
  assert.ok(sent[0].rcpt.includes('hidden@example.org') && !sent[0].m.headers.has('bcc'), 'BCC delivered but not exposed');
  const sentList = (await call('GET', `/api/accounts/${id}/messages?folder=Sent`)).body.messages;
  assert.equal(sentList.length, 1); assert.equal(sentList[0].subject, 'Hello ✓');
  assert.equal((await call('POST', `/api/accounts/${id}/send`, { to: 'not-an-address', subject: 'x' })).status, 400);
  assert.equal((await call('GET', '/api/contacts?q=carol')).body[0].email, 'carol@example.org');

  // drafts
  const draft = await call('POST', `/api/accounts/${id}/drafts`, { to: 'bob@example.org', subject: 'WIP', text: 'later' });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal((await call('GET', `/api/accounts/${id}/messages?folder=Drafts`)).body.messages[0].draft, true);

  // IDLE push: new mail arrives out-of-band -> SSE event + list updated without any request-triggered sync
  const ctl = new AbortController();
  const sse = await fetch(base + '/api/events', { headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, signal: ctl.signal });
  const reader = sse.body.getReader(); const events = [];
  (async () => { const dec = new TextDecoder(); try { for (;;) { const { value, done } = await reader.read(); if (done) break; for (const m of dec.decode(value).matchAll(/data: (.+)/g)) events.push(JSON.parse(m[1])); } } catch { /* aborted */ } })();
  await new Promise((r) => setTimeout(r, 300));
  await seed.append('INBOX', mime('Pushed in real time'));
  await waitFor(() => events.some((e) => e.type === 'sync' && e.folder === 'INBOX'), 10000);
  // earlier actions in this test also emit sync events, so wait for the pushed message itself to show up
  await waitFor(async () => (await call('GET', `/api/accounts/${id}/messages?folder=INBOX&limit=1`)).body.messages[0]?.subject === 'Pushed in real time', 10000);
  ctl.abort();

  // isolation: another user cannot touch this account
  const other = {}; Object.keys(jar).forEach((k) => delete jar[k]);
  await call('POST', '/api/auth/register', { email: 'eve@7mit.test', password: 'another-long-password' });
  assert.equal((await call('GET', `/api/accounts/${id}/folders`)).status, 404);
  assert.equal((await call('GET', `/api/accounts/${id}/messages?folder=INBOX`)).status, 404);
  assert.equal((await call('DELETE', `/api/accounts/${id}`)).status, 404);
  void other;

});

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('waitFor timed out');
}

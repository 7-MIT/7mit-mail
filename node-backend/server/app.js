import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decrypt, encrypt, loadMasterKey } from './crypto.js';
import { createAuth } from './auth.js';
import { openDb } from './db.js';
import { SyncManager, hub } from './sync.js';
import * as M from './mail.js';
import { assertPublicHost } from './netguard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 15 } });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const SECURE = ['ssl', 'starttls', 'none'];
const INLINE_OK = /^image\/(png|jpe?g|gif|webp)$/i;

export function createApp({ db = openDb(), key = loadMasterKey(), env = process.env } = {}) {
  const cfg = {
    secureCookies: env.COOKIE_SECURE !== '0' && env.NODE_ENV === 'production',
    allowRegistration: env.ALLOW_REGISTRATION === '1',
    // akun.7mit is the default sign-in; AUTH_MODE=local switches to local email+password accounts (dev/self-hosted)
    akunAuthUrl: env.AKUN_AUTH_URL || (env.AUTH_MODE === 'local' ? '' : 'https://lajzrempjyoqkubkumhb.supabase.co/functions/v1/akun-auth'), akunAuthApikey: env.AKUN_AUTH_APIKEY, akunPortalUrl: env.AKUN_PORTAL_URL || 'https://akun.7mit.org',
  };
  // Provider pre-filled for new mailboxes (users can still point an account at any other IMAP/SMTP server).
  const defaults = {
    imap: { host: env.DEFAULT_IMAP_HOST || 'imap.foundermail.mx', port: Number(env.DEFAULT_IMAP_PORT) || 993, secure: env.DEFAULT_IMAP_SECURE || 'ssl' },
    smtp: { host: env.DEFAULT_SMTP_HOST || 'smtp.foundermail.mx', port: Number(env.DEFAULT_SMTP_PORT) || 587, secure: env.DEFAULT_SMTP_SECURE || 'starttls' },
  };
  cfg.defaults = defaults;
  const sync = new SyncManager(db, key);
  const auth = createAuth(db, cfg, key);
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', Number(env.TRUST_PROXY) || env.TRUST_PROXY);
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:'], styleSrc: ["'self'", "'unsafe-inline'"], frameSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"] } },
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  // CSRF: cookie auth + SameSite=Lax, plus every mutating request must carry a custom header.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['x-requested-with'] !== '7mit-mail') return res.status(403).json({ error: 'Missing CSRF header' });
    next();
  });
  auth.routes(app);
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/api', auth.middleware);

  // ---- helpers
  const publicAccount = (a) => ({ id: a.id, label: a.label, email: a.email, displayName: a.display_name, signature: a.signature,
    imap: { host: a.imap_host, port: a.imap_port, secure: a.imap_secure, user: a.imap_user },
    smtp: { host: a.smtp_host, port: a.smtp_port, secure: a.smtp_secure, user: a.smtp_user },
    lastSync: a.last_sync, lastError: a.last_error });

  function getAccount(req) {
    const a = db.prepare('SELECT * FROM accounts WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
    if (!a) throw Object.assign(new Error('Account not found'), { status: 404 });
    return a;
  }
  const folderOf = (req) => {
    const f = String(req.query.folder ?? req.body?.folder ?? '');
    if (!f) throw Object.assign(new Error('folder is required'), { status: 400 });
    return f;
  };
  const uidOf = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw Object.assign(new Error('Bad uid'), { status: 400 }); return n; };
  const uidList = (v) => { if (!Array.isArray(v) || !v.length || v.length > 500) throw Object.assign(new Error('uids required'), { status: 400 }); return v.map(uidOf); };

  function parseAccountBody(b, existing) {
    const num = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536 ? Number(v) : d);
    const sec = (v, d) => (SECURE.includes(v) ? v : d);
    const imapSecure = sec(b.imap?.secure, existing?.imap_secure || defaults.imap.secure);
    const smtpSecure = sec(b.smtp?.secure, existing?.smtp_secure || defaults.smtp.secure);
    if ((imapSecure === 'none' || smtpSecure === 'none') && env.ALLOW_INSECURE !== '1') throw Object.assign(new Error('Unencrypted connections are disabled on this server'), { status: 400 });
    const email = String(b.email ?? existing?.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('Valid email address required'), { status: 400 });
    const imapUser = String(b.imap?.user ?? existing?.imap_user ?? email);
    const imapHost = String(b.imap?.host || existing?.imap_host || defaults.imap.host).trim();
    const smtpHost = String(b.smtp?.host || existing?.smtp_host || defaults.smtp.host).trim();
    if (!imapHost || !smtpHost) throw Object.assign(new Error('IMAP and SMTP hosts are required'), { status: 400 });
    return {
      label: String(b.label || existing?.label || email).slice(0, 80), email, display_name: String(b.displayName ?? existing?.display_name ?? '').slice(0, 120),
      imap_host: imapHost, imap_port: num(b.imap?.port, existing?.imap_port || (imapHost === defaults.imap.host ? defaults.imap.port : imapSecure === 'ssl' ? 993 : 143)), imap_secure: imapSecure, imap_user: imapUser,
      smtp_host: smtpHost, smtp_port: num(b.smtp?.port, existing?.smtp_port || (smtpHost === defaults.smtp.host ? defaults.smtp.port : smtpSecure === 'ssl' ? 465 : 587)), smtp_secure: smtpSecure,
      smtp_user: String(b.smtp?.user ?? existing?.smtp_user ?? imapUser),
    };
  }

  // ---- session info
  app.get('/api/me', (req, res) => res.json({ id: req.user.id, email: req.user.email, name: req.user.display_name }));

  // ---- accounts
  app.get('/api/accounts', (req, res) => res.json(db.prepare('SELECT * FROM accounts WHERE user_id=? ORDER BY id').all(req.user.id).map(publicAccount)));

  app.post('/api/accounts/test', wrap(async (req, res) => {
    const f = parseAccountBody(req.body);
    const imapPass = String(req.body.imap?.password || ''); const smtpPass = String(req.body.smtp?.password || imapPass);
    res.json(await M.testAccount(f, imapPass, smtpPass));
  }));

  app.post('/api/accounts', wrap(async (req, res) => {
    if (db.prepare('SELECT COUNT(*) c FROM accounts WHERE user_id=?').get(req.user.id).c >= 10) return res.status(400).json({ error: 'Account limit reached' });
    const f = parseAccountBody(req.body);
    const imapPass = String(req.body.imap?.password || ''); const smtpPass = String(req.body.smtp?.password || imapPass);
    if (!imapPass) return res.status(400).json({ error: 'Password required' });
    const t = await M.testAccount(f, imapPass, smtpPass);
    if (t.imap !== 'ok' || t.smtp !== 'ok') return res.status(400).json({ error: 'Connection test failed', details: t });
    const r = db.prepare(`INSERT INTO accounts(user_id,label,email,display_name,imap_host,imap_port,imap_secure,imap_user,imap_pass_enc,smtp_host,smtp_port,smtp_secure,smtp_user,smtp_pass_enc,signature)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, f.label, f.email, f.display_name, f.imap_host, f.imap_port, f.imap_secure, f.imap_user, encrypt(imapPass, key),
      f.smtp_host, f.smtp_port, f.smtp_secure, f.smtp_user, encrypt(smtpPass, key), String(req.body.signature || '').slice(0, 5000));
    const a = db.prepare('SELECT * FROM accounts WHERE id=?').get(Number(r.lastInsertRowid));
    sync.start(a.id);
    res.status(201).json(publicAccount(a));
  }));

  app.patch('/api/accounts/:id', wrap(async (req, res) => {
    const a = getAccount(req);
    const f = parseAccountBody(req.body, a);
    const imapPass = req.body.imap?.password ? String(req.body.imap.password) : null;
    const smtpPass = req.body.smtp?.password ? String(req.body.smtp.password) : null;
    const merged = { ...a, ...f };
    const t = await M.testAccount(merged, imapPass ?? decrypt(a.imap_pass_enc, key), smtpPass ?? decrypt(a.smtp_pass_enc, key));
    if (t.imap !== 'ok' || t.smtp !== 'ok') return res.status(400).json({ error: 'Connection test failed', details: t });
    db.prepare(`UPDATE accounts SET label=?,email=?,display_name=?,imap_host=?,imap_port=?,imap_secure=?,imap_user=?,smtp_host=?,smtp_port=?,smtp_secure=?,smtp_user=?,signature=? WHERE id=?`)
      .run(f.label, f.email, f.display_name, f.imap_host, f.imap_port, f.imap_secure, f.imap_user, f.smtp_host, f.smtp_port, f.smtp_secure, f.smtp_user,
        req.body.signature !== undefined ? String(req.body.signature).slice(0, 5000) : a.signature, a.id);
    if (imapPass) db.prepare('UPDATE accounts SET imap_pass_enc=? WHERE id=?').run(encrypt(imapPass, key), a.id);
    if (smtpPass) db.prepare('UPDATE accounts SET smtp_pass_enc=? WHERE id=?').run(encrypt(smtpPass, key), a.id);
    sync.stop(a.id); sync.start(a.id);
    res.json(publicAccount(db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id)));
  }));

  app.put('/api/accounts/:id/signature', (req, res) => {
    const a = getAccount(req);
    db.prepare('UPDATE accounts SET signature=? WHERE id=?').run(String(req.body.signature || '').slice(0, 5000), a.id);
    res.json({ ok: true });
  });

  app.delete('/api/accounts/:id', (req, res) => {
    const a = getAccount(req);
    sync.stop(a.id);
    db.prepare('DELETE FROM messages WHERE account_id=?').run(a.id);
    db.prepare('DELETE FROM accounts WHERE id=?').run(a.id);
    res.json({ ok: true });
  });

  // ---- folders
  app.get('/api/accounts/:id/folders', (req, res) => {
    const a = getAccount(req);
    const order = { inbox: 0, drafts: 1, sent: 2, archive: 3, junk: 4, trash: 5 };
    const rows = db.prepare('SELECT path,name,special,delimiter,total,unseen FROM folders WHERE account_id=?').all(a.id)
      .sort((x, y) => (order[x.special] ?? 9) - (order[y.special] ?? 9) || x.path.localeCompare(y.path));
    res.json(rows);
  });

  app.post('/api/accounts/:id/folders', wrap(async (req, res) => {
    const a = getAccount(req); const name = String(req.body.name || '').trim();
    if (!name || name.length > 200) return res.status(400).json({ error: 'Folder name required' });
    await M.withImap(a, key, async (c) => { await c.mailboxCreate(name); await M.syncFolders(db, a, c); });
    res.status(201).json({ ok: true });
  }));

  app.delete('/api/accounts/:id/folders', wrap(async (req, res) => {
    const a = getAccount(req); const p = folderOf(req);
    if (p.toUpperCase() === 'INBOX' || db.prepare('SELECT special FROM folders WHERE account_id=? AND path=?').get(a.id, p)?.special) return res.status(400).json({ error: 'System folders cannot be deleted' });
    await M.withImap(a, key, async (c) => { await c.mailboxDelete(p); await M.syncFolders(db, a, c); });
    res.json({ ok: true });
  }));

  // ---- message lists (served from the sync cache; search goes to the server)
  const listRow = (m) => ({ uid: m.uid, subject: m.subject, from: { name: m.from_name, address: m.from_addr }, to: m.to_addrs, date: m.date, seen: !!m.seen,
    flagged: !!m.flagged, answered: !!m.answered, draft: !!m.draft, hasAttachments: !!m.has_att, size: m.size });

  app.get('/api/accounts/:id/messages', wrap(async (req, res) => {
    const a = getAccount(req); const folder = folderOf(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const before = req.query.before ? uidOf(req.query.before) : null;
    const q = String(req.query.q || '').trim();
    let uidFilter = null;
    if (q) {
      const uids = await M.withImap(a, key, (c) => M.searchRemote(db, a, c, folder, q));
      uidFilter = uids;
      if (!uids.length) return res.json({ messages: [], hasMore: false });
    }
    const where = ['account_id=?', 'folder=?']; const args = [a.id, folder];
    if (uidFilter) { where.push(`uid IN (${uidFilter.map(() => '?').join(',')})`); args.push(...uidFilter); }
    if (before) { where.push('uid<?'); args.push(before); }
    if (req.query.unread === '1') where.push('seen=0');
    if (req.query.starred === '1') where.push('flagged=1');
    const rows = db.prepare(`SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY uid DESC LIMIT ?`).all(...args, limit + 1);
    let hasMore = rows.length > limit; const page = rows.slice(0, limit);
    // Cache exhausted but server has older mail: backfill one page.
    const f = db.prepare('SELECT total FROM folders WHERE account_id=? AND path=?').get(a.id, folder);
    if (!q && !hasMore && page.length && !req.query.unread && !req.query.starred) {
      const cached = db.prepare('SELECT COUNT(*) c FROM messages WHERE account_id=? AND folder=?').get(a.id, folder).c;
      if (f && cached < f.total) {
        const added = await M.withImap(a, key, (c) => M.backfill(db, a, c, folder, page[page.length - 1].uid, limit));
        if (added) {
          const more = db.prepare(`SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY uid DESC LIMIT ?`).all(...args, limit + 1);
          hasMore = more.length > limit; return res.json({ messages: more.slice(0, limit).map(listRow), hasMore });
        }
      }
    }
    res.json({ messages: page.map(listRow), hasMore });
  }));

  app.post('/api/accounts/:id/sync', wrap(async (req, res) => {
    const a = getAccount(req); const folder = req.query.folder || 'INBOX';
    await M.withImap(a, key, async (c) => { await M.syncFolders(db, a, c); await M.syncFolder(db, a, c, String(folder)); });
    res.json({ ok: true });
  }));

  // ---- single message
  app.get('/api/accounts/:id/messages/:uid', wrap(async (req, res) => {
    const a = getAccount(req); const folder = folderOf(req); const uid = uidOf(req.params.uid);
    const base = `/api/accounts/${a.id}/messages/${uid}`;
    const out = await M.withImap(a, key, async (c) => {
      const m = await M.loadMessage(c, folder, uid);
      if (!m) return null;
      if (!m.flags.has('\\Seen') && req.query.markRead !== '0') {
        const lock = await c.getMailboxLock(folder);
        try { await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }); } finally { lock.release(); }
        db.prepare('UPDATE messages SET seen=1 WHERE account_id=? AND folder=? AND uid=?').run(a.id, folder, uid);
        const unseen = db.prepare('SELECT COUNT(*) c FROM messages WHERE account_id=? AND folder=? AND seen=0').get(a.id, folder).c;
        db.prepare('UPDATE folders SET unseen=? WHERE account_id=? AND path=?').run(unseen, a.id, folder);
        m.flags.add('\\Seen');
      }
      return { ...M.presentMessage(m.parsed, { base: `${base}`, remoteImages: req.query.images === '1' }), flags: [...m.flags] };
    });
    if (!out) return res.status(404).json({ error: 'Message not found' });
    res.json({ uid, folder, ...out });
  }));

  app.get('/api/accounts/:id/messages/:uid/attachments/:idx', wrap(async (req, res) => {
    const a = getAccount(req); const folder = folderOf(req); const uid = uidOf(req.params.uid); const idx = Number(req.params.idx);
    const m = await M.withImap(a, key, (c) => M.loadMessage(c, folder, uid));
    const att = m?.parsed.attachments?.[idx];
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    const inline = req.query.inline === '1' && INLINE_OK.test(att.contentType);
    const name = (att.filename || `attachment-${idx + 1}`).replace(/[\r\n"\\]/g, '_');
    res.set({
      'Content-Type': inline ? att.contentType : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'private, max-age=300',
    });
    res.send(att.content);
  }));

  // ---- flag / move / delete
  app.post('/api/accounts/:id/messages/flags', wrap(async (req, res) => {
    const a = getAccount(req); const folder = folderOf(req); const uids = uidList(req.body.uids);
    const map = { seen: '\\Seen', flagged: '\\Flagged', answered: '\\Answered' };
    const add = (req.body.add || []).map((x) => map[x]).filter(Boolean); const rem = (req.body.remove || []).map((x) => map[x]).filter(Boolean);
    await M.withImap(a, key, async (c) => {
      const lock = await c.getMailboxLock(folder);
      try {
        if (add.length) await c.messageFlagsAdd(uids.join(','), add, { uid: true });
        if (rem.length) await c.messageFlagsRemove(uids.join(','), rem, { uid: true });
      } finally { lock.release(); }
    });
    const col = { '\\Seen': 'seen', '\\Flagged': 'flagged', '\\Answered': 'answered' };
    for (const [list, v] of [[add, 1], [rem, 0]]) for (const f of list)
      db.prepare(`UPDATE messages SET ${col[f]}=? WHERE account_id=? AND folder=? AND uid IN (${uids.map(() => '?').join(',')})`).run(v, a.id, folder, ...uids);
    const unseen = db.prepare('SELECT COUNT(*) c FROM messages WHERE account_id=? AND folder=? AND seen=0').get(a.id, folder).c;
    db.prepare('UPDATE folders SET unseen=? WHERE account_id=? AND path=?').run(unseen, a.id, folder);
    res.json({ ok: true });
  }));

  async function moveOrDelete(a, folder, uids, target /* path | 'trash' | 'purge' */) {
    return M.withImap(a, key, async (c) => {
      let dest = target;
      if (target === 'trash') {
        const here = db.prepare('SELECT special FROM folders WHERE account_id=? AND path=?').get(a.id, folder)?.special;
        dest = here === 'trash' ? 'purge' : await M.findSpecial(db, a, c, 'trash') || 'purge';
      }
      const lock = await c.getMailboxLock(folder);
      try {
        if (dest === 'purge') await c.messageDelete(uids.join(','), { uid: true });
        else await c.messageMove(uids.join(','), dest, { uid: true });
      } finally { lock.release(); }
      db.prepare(`DELETE FROM messages WHERE account_id=? AND folder=? AND uid IN (${uids.map(() => '?').join(',')})`).run(a.id, folder, ...uids);
      await M.syncFolders(db, a, c);
      if (dest !== 'purge') await M.syncFolder(db, a, c, dest, 50);
      return dest;
    });
  }
  app.post('/api/accounts/:id/messages/move', wrap(async (req, res) => {
    const a = getAccount(req); const to = String(req.body.to || '');
    if (!to) return res.status(400).json({ error: 'to required' });
    if (!db.prepare('SELECT 1 FROM folders WHERE account_id=? AND path=?').get(a.id, to)) return res.status(400).json({ error: 'Unknown destination folder' });
    res.json({ ok: true, to: await moveOrDelete(a, folderOf(req), uidList(req.body.uids), to) });
  }));
  app.post('/api/accounts/:id/messages/delete', wrap(async (req, res) => {
    const a = getAccount(req);
    res.json({ ok: true, to: await moveOrDelete(a, folderOf(req), uidList(req.body.uids), req.body.permanent ? 'purge' : 'trash') });
  }));

  // ---- send / drafts
  const fieldToList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[;,]/)).map((s) => String(s).trim()).filter(Boolean);
  function composePayload(req) {
    const p = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body;
    const check = (l) => l.forEach((x) => { if (!/^([^<>]*<)?[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>?$/.test(x)) throw Object.assign(new Error(`Invalid address: ${x}`), { status: 400 }); });
    const to = fieldToList(p.to), cc = fieldToList(p.cc), bcc = fieldToList(p.bcc);
    check([...to, ...cc, ...bcc]);
    return { to, cc, bcc, subject: String(p.subject || '').slice(0, 998), text: String(p.text || ''), html: p.html ? String(p.html) : '',
      inReplyTo: p.inReplyTo, references: p.references, replyToRef: p.replyToUid ? { uid: uidOf(p.replyToUid) } : null, draftUid: p.draftUid ? uidOf(p.draftUid) : null,
      attachments: (req.files || []).map((f) => ({ filename: f.originalname, buffer: f.buffer, contentType: f.mimetype })) };
  }

  app.post('/api/accounts/:id/send', upload.array('files', 15), wrap(async (req, res) => {
    const a = getAccount(req); const p = composePayload(req);
    if (!p.to.length && !p.cc.length && !p.bcc.length) return res.status(400).json({ error: 'At least one recipient required' });
    const r = await M.sendMail(db, a, key, p);
    for (const addr of [...p.to, ...p.cc]) {
      const m = /<([^>]+)>/.exec(addr)?.[1] || addr; const name = /^([^<]*)</.exec(addr)?.[1]?.trim().replace(/^"|"$/g, '') || '';
      db.prepare('INSERT INTO contacts(user_id,email,name) VALUES(?,?,?) ON CONFLICT(user_id,email) DO NOTHING').run(req.user.id, m.toLowerCase(), name);
    }
    if (p.draftUid) {
      try { await M.withImap(a, key, async (c) => { const d = await M.findSpecial(db, a, c, 'drafts'); if (d) { const l = await c.getMailboxLock(d); try { await c.messageDelete(String(p.draftUid), { uid: true }); } finally { l.release(); } } }); } catch { /* ignore */ }
    }
    res.json({ ok: true, ...r });
  }));

  app.post('/api/accounts/:id/drafts', upload.array('files', 15), wrap(async (req, res) => {
    const a = getAccount(req); const p = composePayload(req);
    res.json({ ok: true, ...(await M.saveDraft(db, a, key, p, p.draftUid)) });
  }));

  // ---- counters
  app.get('/api/unread', (req, res) => {
    const rows = db.prepare(`SELECT f.account_id id, SUM(f.unseen) unseen FROM folders f JOIN accounts a ON a.id=f.account_id
      WHERE a.user_id=? AND f.special='inbox' GROUP BY f.account_id`).all(req.user.id);
    res.json({ total: rows.reduce((s, r) => s + r.unseen, 0), accounts: rows });
  });

  // ---- contacts + settings
  app.get('/api/contacts', (req, res) => {
    const q = `%${String(req.query.q || '').replace(/[%_]/g, '')}%`;
    res.json(db.prepare('SELECT id,name,email,notes FROM contacts WHERE user_id=? AND (name LIKE ? OR email LIKE ?) ORDER BY name,email LIMIT 500').all(req.user.id, q, q));
  });
  app.post('/api/contacts', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
    db.prepare('INSERT INTO contacts(user_id,email,name,notes) VALUES(?,?,?,?) ON CONFLICT(user_id,email) DO UPDATE SET name=excluded.name,notes=excluded.notes')
      .run(req.user.id, email, String(req.body.name || '').slice(0, 120), String(req.body.notes || '').slice(0, 1000));
    res.status(201).json({ ok: true });
  });
  app.delete('/api/contacts/:cid', (req, res) => { db.prepare('DELETE FROM contacts WHERE id=? AND user_id=?').run(Number(req.params.cid), req.user.id); res.json({ ok: true }); });

  app.get('/api/settings', (req, res) => res.json(JSON.parse(db.prepare('SELECT json FROM settings WHERE user_id=?').get(req.user.id)?.json || '{}')));
  app.put('/api/settings', (req, res) => {
    const allow = ['theme', 'density', 'pageSize', 'loadRemoteImages', 'notifications'];
    const clean = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allow.includes(k)));
    db.prepare('INSERT INTO settings(user_id,json) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET json=excluded.json').run(req.user.id, JSON.stringify(clean));
    res.json(clean);
  });

  // ---- near-real-time updates (SSE), fed by the IDLE watchers
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const ch = String(req.user.id);
    hub.on(ch, send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { hub.off(ch, send); clearInterval(ping); });
  });

  // ---- static UI + errors
  app.use(express.static(path.join(here, '..', 'public'), { extensions: ['html'], maxAge: '5m' }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  // Any other page address (/mail, /login, a refreshed deep link) opens the app instead of a bare 404.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || path.extname(req.path) || !req.accepts('html')) return next();
    res.sendFile(path.join(here, '..', 'public', 'index.html'));
  });
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    if (status >= 500) console.error(err.stack || err);
    const msg = status >= 500 ? (err.responseText || err.message || 'Server error') : err.message;
    res.status(status).json({ error: String(msg).slice(0, 300) });
  });

  return { app, db, sync, key };
}

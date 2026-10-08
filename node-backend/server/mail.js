import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import sanitizeHtml from 'sanitize-html';
import { decrypt } from './crypto.js';
import { assertPublicHost } from './netguard.js';

const rejectUnauthorized = process.env.TLS_REJECT_UNAUTHORIZED !== '0';
const MAX_SOURCE = 40 * 1024 * 1024;

export const SPECIAL_BY_NAME = {
  inbox: 'inbox', sent: 'sent', 'sent items': 'sent', 'sent mail': 'sent', drafts: 'drafts', draft: 'drafts',
  trash: 'trash', 'deleted items': 'trash', 'deleted messages': 'trash', junk: 'junk', spam: 'junk', 'junk e-mail': 'junk', archive: 'archive',
};

export function creds(a, key) {
  return {
    imapPass: decrypt(a.imap_pass_enc, key),
    smtpPass: decrypt(a.smtp_pass_enc, key),
  };
}

export async function openImap(a, pass, { watcher = false } = {}) {
  await assertPublicHost(a.imap_host);
  const client = new ImapFlow({
    host: a.imap_host, port: a.imap_port,
    secure: a.imap_secure === 'ssl',
    doSTARTTLS: a.imap_secure === 'starttls' ? true : a.imap_secure === 'none' ? false : undefined,
    auth: { user: a.imap_user, pass },
    logger: false, tls: { rejectUnauthorized }, emitLogs: false,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 5 * 60 * 1000,
    ...(watcher ? { autoIdleDelay: 1000 } : {}), // enter IDLE quickly on the long-lived push connection
  });
  client.on('error', () => {}); // surfaced through operation rejections
  await client.connect();
  return client;
}

export async function withImap(a, key, fn) {
  const client = await openImap(a, creds(a, key).imapPass);
  try { return await fn(client); } finally { try { await client.logout(); } catch { client.close(); } }
}

export function smtpTransport(a, pass) {
  return nodemailer.createTransport({
    host: a.smtp_host, port: a.smtp_port, secure: a.smtp_secure === 'ssl',
    requireTLS: a.smtp_secure === 'starttls', ignoreTLS: a.smtp_secure === 'none',
    auth: a.smtp_user ? { user: a.smtp_user, pass } : undefined,
    tls: { rejectUnauthorized }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000,
  });
}

export async function testAccount(a, imapPass, smtpPass) {
  const out = { imap: null, smtp: null };
  try { const c = await openImap(a, imapPass); await c.logout(); out.imap = 'ok'; } catch (e) { out.imap = e.responseText || e.message; }
  try { await assertPublicHost(a.smtp_host); await smtpTransport(a, smtpPass).verify(); out.smtp = 'ok'; } catch (e) { out.smtp = e.message; }
  return out;
}

const specialOf = (f) => {
  if (f.path.toUpperCase() === 'INBOX') return 'inbox';
  const su = (f.specialUse || '').replace('\\', '').toLowerCase();
  if (su) return su === 'junk' ? 'junk' : su === 'all' ? 'archive' : su;
  return SPECIAL_BY_NAME[f.name.toLowerCase()] || null;
};

// ---- folder + message sync -------------------------------------------------

export async function syncFolders(db, a, client) {
  const list = (await client.list()).filter((f) => !f.flags?.has('\\Noselect') && !f.flags?.has('\\NonExistent'));
  const seen = new Set();
  for (const f of list) {
    seen.add(f.path);
    let st = { messages: 0, unseen: 0, uidValidity: '' };
    try { st = await client.status(f.path, { messages: true, unseen: true, uidValidity: true }); } catch { /* ignore */ }
    db.prepare(`INSERT INTO folders(account_id,path,name,special,delimiter,uidvalidity,total,unseen) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(account_id,path) DO UPDATE SET name=excluded.name,special=excluded.special,delimiter=excluded.delimiter,
      total=excluded.total,unseen=excluded.unseen,uidvalidity=excluded.uidvalidity`)
      .run(a.id, f.path, f.name, specialOf(f), f.delimiter || '/', String(st.uidValidity ?? ''), st.messages, st.unseen);
  }
  for (const r of db.prepare('SELECT path FROM folders WHERE account_id=?').all(a.id)) {
    if (!seen.has(r.path)) {
      db.prepare('DELETE FROM folders WHERE account_id=? AND path=?').run(a.id, r.path);
      db.prepare('DELETE FROM messages WHERE account_id=? AND folder=?').run(a.id, r.path);
    }
  }
}

const addrText = (l) => (l || []).map((x) => (x.name ? `${x.name} <${x.address}>` : x.address)).join(', ');
const hasAttachment = (bs) => {
  if (!bs) return false;
  if (bs.disposition === 'attachment') return true;
  return (bs.childNodes || []).some(hasAttachment);
};

function upsertMessage(db, a, folder, m) {
  const from = m.envelope?.from?.[0] || {};
  const f = m.flags || new Set();
  db.prepare(`INSERT INTO messages(account_id,folder,uid,message_id,subject,from_name,from_addr,to_addrs,date,seen,flagged,answered,draft,has_att,size)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(account_id,folder,uid) DO UPDATE SET seen=excluded.seen,flagged=excluded.flagged,answered=excluded.answered,draft=excluded.draft`)
    .run(a.id, folder, m.uid, m.envelope?.messageId || null, m.envelope?.subject || '', from.name || '', from.address || '',
      addrText(m.envelope?.to), m.envelope?.date ? Math.floor(new Date(m.envelope.date).getTime() / 1000) : 0,
      +f.has('\\Seen'), +f.has('\\Flagged'), +f.has('\\Answered'), +f.has('\\Draft'), +hasAttachment(m.bodyStructure), m.size || 0);
}

const FETCH = { uid: true, flags: true, envelope: true, size: true, bodyStructure: true };

/** Refresh the newest `depth` messages of a folder: new mail, flag changes, deletions. */
export async function syncFolder(db, a, client, path, depth = 100) {
  const lock = await client.getMailboxLock(path);
  try {
    const mb = client.mailbox;
    const prev = db.prepare('SELECT uidvalidity FROM folders WHERE account_id=? AND path=?').get(a.id, path);
    if (prev?.uidvalidity && prev.uidvalidity !== String(mb.uidValidity)) {
      db.prepare('DELETE FROM messages WHERE account_id=? AND folder=?').run(a.id, path);
    }
    let minUid = Infinity; const live = new Set();
    if (mb.exists > 0) {
      const from = Math.max(1, mb.exists - depth + 1);
      for await (const m of client.fetch(`${from}:*`, FETCH)) {
        upsertMessage(db, a, path, m); live.add(m.uid); minUid = Math.min(minUid, m.uid);
      }
    }
    // drop cached rows inside the refreshed window that vanished on the server
    const ins = Number.isFinite(minUid) ? db.prepare('SELECT uid FROM messages WHERE account_id=? AND folder=? AND uid>=?').all(a.id, path, minUid)
      : db.prepare('SELECT uid FROM messages WHERE account_id=? AND folder=?').all(a.id, path);
    for (const r of ins) if (!live.has(r.uid)) db.prepare('DELETE FROM messages WHERE account_id=? AND folder=? AND uid=?').run(a.id, path, r.uid);
    const unseen = db.prepare('SELECT COUNT(*) c FROM messages WHERE account_id=? AND folder=? AND seen=0').get(a.id, path).c;
    db.prepare('UPDATE folders SET total=?, unseen=MAX(?,0), uidvalidity=? WHERE account_id=? AND path=?')
      .run(mb.exists, mb.exists > depth ? (await client.status(path, { unseen: true })).unseen : unseen, String(mb.uidValidity), a.id, path);
  } finally { lock.release(); }
}

/** Fetch an older page that isn't cached yet (scrolling past the sync window). */
export async function backfill(db, a, client, path, beforeUid, limit) {
  const lock = await client.getMailboxLock(path);
  try {
    const uids = (await client.search({ uid: `1:${beforeUid - 1}` }, { uid: true })) || [];
    const slice = uids.slice(-limit);
    if (!slice.length) return 0;
    for await (const m of client.fetch(slice.join(','), FETCH, { uid: true })) upsertMessage(db, a, path, m);
    return slice.length;
  } finally { lock.release(); }
}

export async function searchRemote(db, a, client, path, q, limit = 100) {
  const lock = await client.getMailboxLock(path);
  try {
    const uids = (await client.search({ or: [{ subject: q }, { from: q }, { to: q }, { body: q }] }, { uid: true })) || [];
    const slice = uids.slice(-limit);
    if (!slice.length) return [];
    for await (const m of client.fetch(slice.join(','), FETCH, { uid: true })) upsertMessage(db, a, path, m);
    return slice;
  } finally { lock.release(); }
}

// ---- reading ---------------------------------------------------------------

const SAFE_TAGS = sanitizeHtml.defaults.allowedTags.concat(['img', 'style', 'center', 'font', 'u', 's', 'small', 'span', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'hr', 'h1', 'h2']);

export function cleanHtml(html, { cidMap = {}, remoteImages = false } = {}) {
  let blocked = 0;
  const out = sanitizeHtml(html, {
    allowedTags: SAFE_TAGS.filter((t) => t !== 'style'),
    allowedAttributes: {
      '*': ['style', 'class', 'align', 'valign', 'bgcolor', 'width', 'height', 'colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing', 'dir', 'color', 'face', 'size'],
      a: ['href', 'name', 'target', 'rel', 'title'], img: ['src', 'alt', 'width', 'height', 'title', 'data-blocked-src'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
    allowedStyles: {
      '*': {
        color: [/^[#\w(),.% -]+$/], 'background-color': [/^[#\w(),.% -]+$/], 'text-align': [/^(left|right|center|justify)$/],
        'font-size': [/^[\d.]+(px|pt|em|rem|%)$/], 'font-weight': [/^(\w+|\d+)$/], 'font-style': [/^\w+$/], 'text-decoration': [/^[\w -]+$/],
        'font-family': [/^[\w ,'"-]+$/], padding: [/^[\d.\spxemt%-]+$/], margin: [/^[\d.\spxemt%-]+$/], border: [/^[\w#(),.%\s-]+$/],
        width: [/^[\d.]+(px|%|em)$/], height: [/^[\d.]+(px|%|em)$/], 'max-width': [/^[\d.]+(px|%|em)$/],
      },
    },
    transformTags: {
      a: (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' } }),
      img: (tag, attribs) => {
        const src = attribs.src || '';
        if (src.startsWith('cid:')) {
          const url = cidMap[src.slice(4).replace(/^<|>$/g, '')];
          return { tagName: 'img', attribs: { ...attribs, src: url || '' } };
        }
        if (/^https?:/i.test(src) && !remoteImages) { blocked++; const { src: s, ...rest } = attribs; return { tagName: 'img', attribs: { ...rest, 'data-blocked-src': s } }; }
        return { tagName: 'img', attribs };
      },
    },
  });
  return { html: out, blockedImages: blocked };
}

export async function loadMessage(client, path, uid) {
  const lock = await client.getMailboxLock(path);
  try {
    const m = await client.fetchOne(String(uid), { uid: true, source: true, flags: true, size: true }, { uid: true });
    if (!m?.source) return null;
    if (m.source.length > MAX_SOURCE) throw Object.assign(new Error('Message too large'), { status: 413 });
    return { parsed: await simpleParser(m.source), flags: m.flags };
  } finally { lock.release(); }
}

export const addrList = (v) => (v?.value || []).map((x) => ({ name: x.name || '', address: x.address || '' }));

export function presentMessage(parsed, { base, remoteImages }) {
  const cidMap = {};
  const attachments = (parsed.attachments || []).map((att, i) => {
    const url = `${base}/attachments/${i}`;
    if (att.cid) cidMap[att.cid.replace(/^<|>$/g, '')] = `${url}?inline=1`;
    return { index: i, filename: att.filename || `attachment-${i + 1}`, contentType: att.contentType, size: att.size, inline: !!att.related };
  });
  let html = null; let blockedImages = 0;
  if (parsed.html) ({ html, blockedImages } = cleanHtml(parsed.html, { cidMap, remoteImages }));
  return {
    messageId: parsed.messageId || null, inReplyTo: parsed.inReplyTo || null, references: [].concat(parsed.references || []),
    subject: parsed.subject || '', date: parsed.date ? parsed.date.toISOString() : null,
    from: addrList(parsed.from), to: addrList(parsed.to), cc: addrList(parsed.cc), replyTo: addrList(parsed.replyTo),
    html, text: parsed.text || '', blockedImages, attachments,
  };
}

// ---- writing ---------------------------------------------------------------

export async function findSpecial(db, a, client, special) {
  const row = db.prepare('SELECT path FROM folders WHERE account_id=? AND special=?').get(a.id, special);
  if (row) return row.path;
  await syncFolders(db, a, client);
  return db.prepare('SELECT path FROM folders WHERE account_id=? AND special=?').get(a.id, special)?.path || null;
}

export function buildMime(a, p) {
  const mail = {
    from: { name: a.display_name || '', address: a.email },
    to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject || '',
    text: p.text || '', html: p.html || undefined,
    inReplyTo: p.inReplyTo || undefined, references: p.references?.length ? p.references : undefined,
    attachments: (p.attachments || []).map((f) => ({ filename: f.filename, content: f.buffer, contentType: f.contentType })),
  };
  return mail;
}

export async function composeRaw(mail) {
  return new MailComposer(mail).compile().build();
}

export async function sendMail(db, a, key, p) {
  const { smtpPass } = creds(a, key);
  await assertPublicHost(a.smtp_host);
  const mail = buildMime(a, p);
  const raw = await composeRaw(mail);
  const info = await smtpTransport(a, smtpPass).sendMail({ envelope: { from: a.email, to: [...(p.to || []), ...(p.cc || []), ...(p.bcc || [])].map((x) => x.address || x) }, raw });
  // Store a copy in Sent (many servers don't do this for SMTP submissions)
  let saved = false;
  try {
    await withImap(a, key, async (c) => {
      const sent = await findSpecial(db, a, c, 'sent');
      if (sent) { await c.append(sent, raw, ['\\Seen']); saved = true; await syncFolder(db, a, c, sent, 50); }
      if (p.replyToRef) await c.messageFlagsAdd({ uid: String(p.replyToRef.uid) }, ['\\Answered'], { uid: true }).catch(() => {});
    });
  } catch { /* delivery succeeded; copy is best effort */ }
  return { accepted: info.accepted, rejected: info.rejected, savedToSent: saved };
}

export async function saveDraft(db, a, key, p, replaceUid) {
  const raw = await composeRaw(buildMime(a, p));
  return withImap(a, key, async (c) => {
    const drafts = await findSpecial(db, a, c, 'drafts');
    if (!drafts) throw Object.assign(new Error('No Drafts folder on this server'), { status: 400 });
    const res = await c.append(drafts, raw, ['\\Draft', '\\Seen']);
    if (replaceUid) {
      const lock = await c.getMailboxLock(drafts);
      try { await c.messageDelete(String(replaceUid), { uid: true }); } finally { lock.release(); }
    }
    await syncFolder(db, a, c, drafts, 50);
    return { uid: res?.uid || null, folder: drafts };
  });
}

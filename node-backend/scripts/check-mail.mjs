#!/usr/bin/env node
// Connection doctor: checks an IMAP + SMTP account the same way the app connects (Dovecot, Postfix, anything).
//   MAIL_PASS='…' node scripts/check-mail.mjs --user you@example.com [--imap imap.foundermail.mx:993] [--smtp smtp.foundermail.mx:587]
//        [--imap-tls ssl|starttls|none] [--smtp-tls starttls|ssl|none]
// The password is read from MAIL_PASS so it never lands in shell history or process lists.
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const hp = (v, port) => { const [h, p] = String(v).split(':'); return { host: h, port: Number(p) || port }; };
const user = arg('user'); const pass = process.env.MAIL_PASS;
if (!user || !pass) { console.error('Usage: MAIL_PASS=… node scripts/check-mail.mjs --user you@example.com [--imap host:port] [--smtp host:port]'); process.exit(2); }
const imap = hp(arg('imap', 'imap.foundermail.mx:993'), 993); const smtp = hp(arg('smtp', 'smtp.foundermail.mx:587'), 587);
const imapTls = arg('imap-tls', imap.port === 993 ? 'ssl' : 'starttls'); const smtpTls = arg('smtp-tls', smtp.port === 465 ? 'ssl' : 'starttls');
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => { console.log('  ✗ ' + m); failed = true; }, info = (m) => console.log('    ' + m);
let failed = false;

console.log(`IMAP ${imap.host}:${imap.port} (${imapTls})`);
const c = new ImapFlow({ host: imap.host, port: imap.port, secure: imapTls === 'ssl', doSTARTTLS: imapTls === 'starttls' ? true : imapTls === 'none' ? false : undefined,
  auth: { user, pass }, logger: false, connectionTimeout: 15000, greetingTimeout: 15000 });
c.on('error', () => {});
try {
  await c.connect(); ok('connected and signed in');
  const caps = [...c.capabilities.keys()];
  info('server: ' + (c.serverInfo?.name ? `${c.serverInfo.name} ${c.serverInfo.version || ''}`.trim() : 'unknown') + (/dovecot/i.test(JSON.stringify(c.serverInfo || {}) + (c.greeting || '')) ? '  (Dovecot)' : ''));
  for (const k of ['IDLE', 'MOVE', 'UIDPLUS', 'SPECIAL-USE', 'CONDSTORE']) (caps.includes(k) ? ok : (m) => console.log('  - ' + m))(`${k} ${caps.includes(k) ? 'supported' : 'not advertised'}${k === 'IDLE' && !caps.includes(k) ? ' (app falls back to polling)' : ''}`);
  const list = await c.list(); const special = Object.fromEntries(list.filter((f) => f.specialUse).map((f) => [f.specialUse, f.path]));
  info('folders: ' + list.map((f) => f.path).join(', '));
  for (const [label, key] of [['Sent', '\\Sent'], ['Drafts', '\\Drafts'], ['Trash', '\\Trash'], ['Junk', '\\Junk']]) (special[key] ? ok : (m) => console.log('  - ' + m))(`${label}: ${special[key] || 'no SPECIAL-USE flag (app guesses by name)'}`);
  const st = await c.status('INBOX', { messages: true, unseen: true }); ok(`INBOX: ${st.messages} messages, ${st.unseen} unread`);
  await c.logout();
} catch (e) { bad((e.responseText || e.message) + (e.authenticationFailed ? '  (wrong username/password? Dovecot usually wants the full address)' : '')); }

const tryTls = async (port, tls) => {
  const t = nodemailer.createTransport({ host: smtp.host, port, secure: tls === 'ssl', requireTLS: tls === 'starttls', ignoreTLS: tls === 'none', auth: { user: arg('smtp-user', user), pass }, connectionTimeout: 12000, greetingTimeout: 12000 });
  try { await t.verify(); return null; } catch (e) { return e.message; } finally { t.close(); }
};
console.log(`SMTP ${smtp.host}:${smtp.port} (${smtpTls})`);
const first = await tryTls(smtp.port, smtpTls);
if (!first) ok('signed in over ' + smtpTls.toUpperCase());
else {
  bad(first);
  for (const [p, t] of [[587, 'starttls'], [465, 'ssl']].filter(([p]) => p !== smtp.port)) { const e = await tryTls(p, t); (e ? (m) => console.log('  - ' + m) : ok)(`${p}/${t}: ${e || 'works, use this one'}`); }
}
console.log(failed ? '\nResult: problems found (see ✗ above)' : '\nResult: all good');
process.exit(failed ? 1 : 0);

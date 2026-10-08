// Default (locked) mailboxes: one shared mailbox per lembaga/departemen. Emails are fixed here; passwords come from the
// MAIL_DEFAULT_MAILBOXES secret (JSON {"guru":"…","eksekutif":"…"}) and never live in the repository or the database.
export const MAILBOXES = {
  guru: { email: 'guru@7mit.org', label: 'Guru' },
  eksekutif: { email: 'eksekutif@7mit.org', label: 'Lembaga Eksekutif' },
  legislatif: { email: 'legislatif@7mit.org', label: 'Lembaga Legislatif (Class Quality)' },
  yudikatif: { email: 'yudikatif@7mit.org', label: 'Lembaga Yudikatif (Class Safety)' },
  kemenjira: { email: 'kemenjira@7mit.org', label: 'Soul & Space (Kementerian)' },
  kemenkrep: { email: 'kemenkrep@7mit.org', label: 'Creativity & Experience (Kementerian)' },
  kemenbanggul: { email: 'kemenbanggul@7mit.org', label: 'Excellence & Development (Kementerian)' },
  kemenkesbug: { email: 'kemenkesbug@7mit.org', label: 'Health & Wellness (Kementerian)' },
};
export const DEFAULT_SERVERS = { imapHost: 'imap.foundermail.mx', imapPort: 993, imapTls: 'ssl', smtpHost: 'smtp.foundermail.mx', smtpPort: 587, smtpTls: 'starttls' };

// organization_roles.role_key -> mailbox key
export const ROLE_DEPARTMENT = {
  president: 'eksekutif', vice: 'eksekutif', vice_president: 'eksekutif', secretariat: 'eksekutif', secretary: 'eksekutif', treasury: 'eksekutif', treasurer: 'eksekutif',
  cqcb: 'legislatif', safety_wellbeing: 'yudikatif',
  soul_space: 'kemenjira', creativity_experience: 'kemenkrep', excellence_development: 'kemenbanggul', health_wellness: 'kemenkesbug',
  teacher: 'guru', assistant: 'guru',
};

const tokens = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
const compatible = (a, b) => a === b || (a.length === 1 && b[0] === a) || (b.length === 1 && a[0] === b);

/** 0 = different person. Higher = more tokens agree. Initials ("Alamgir D. S.") match full names. */
export function nameScore(a, b) {
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length || x[0] !== y[0]) return 0;
  const n = Math.min(x.length, y.length); let score = 1;
  for (let i = 1; i < n; i++) { if (!compatible(x[i], y[i])) return 0; score++; }
  return score + (x.length === y.length ? 0.5 : 0);
}

/**
 * Which default mailboxes an akun.7mit account may use.
 * account: {account_key, account_type, role, display_name}; members: [{role_key, name}]; overrides: {account_key: [mailboxKey]}
 * A name match that is ambiguous between two lembaga grants nothing (use an override instead): access to a shared mailbox must never be a guess.
 */
export function departmentsFor(account, members = [], overrides = {}) {
  const out = new Set((overrides[account.account_key] || []).filter((k) => MAILBOXES[k]));
  if (account.account_type === 'guru') out.add('guru');
  if (account.account_type === 'pengurus' && /presiden|wakil|bendahara|sekretariat|sekretaris/i.test(account.role || '')) out.add('eksekutif');
  if (account.account_type !== 'guru') {
    let best = 0; let found = new Set();
    for (const m of members) {
      const dep = ROLE_DEPARTMENT[m.role_key]; if (!dep || dep === 'guru') continue;
      const s = nameScore(account.display_name, m.name);
      if (s > best) { best = s; found = new Set([dep]); } else if (s === best && s > 0) found.add(dep);
    }
    if (best > 0 && found.size === 1) out.add([...found][0]);
  }
  return [...out].sort((a, b) => Object.keys(MAILBOXES).indexOf(a) - Object.keys(MAILBOXES).indexOf(b));
}

export function parsePasswords(raw) {
  if (!raw) return {};
  const o = JSON.parse(raw); const out = {};
  for (const [k, v] of Object.entries(o)) if (MAILBOXES[k] && typeof v === 'string' && v.length >= 8 && v.length <= 200) out[k] = v;
  return out;
}

export function defaultCredentials(key, passwords) {
  const mb = MAILBOXES[key]; const pass = passwords[key];
  if (!mb || !pass) throw Object.assign(new Error('This default mailbox is not configured yet. Ask an admin to set MAIL_DEFAULT_MAILBOXES.'), { status: 503 });
  return { ...DEFAULT_SERVERS, email: mb.email, imapUser: mb.email, imapPassword: pass, smtpUser: mb.email, smtpPassword: pass };
}

export const isDefaultEmail = (email) => Object.values(MAILBOXES).some((m) => m.email === String(email || '').trim().toLowerCase());

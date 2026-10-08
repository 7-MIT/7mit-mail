// Default (locked) mailboxes: one shared mailbox per lembaga/departemen. Emails are fixed here; passwords come from the
// MAIL_DEFAULT_MAILBOXES secret (JSON {"guru":"…","eksekutif":"…"}) or from the encrypted, service-role-only table
// mail7mit_default_mailboxes. They never live in the repository.
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

const tokens = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
const edits = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
// Same word, an initial, or a one-letter typo in a long word (Anindityo/Aninditya). Short words must match exactly: "Ali" is not "Ala".
const compatible = (a, b) => a === b || (a.length === 1 && b[0] === a) || (b.length === 1 && a[0] === b) || (Math.min(a.length, b.length) >= 5 && Math.abs(a.length - b.length) <= 1 && edits(a, b) <= (Math.min(a.length, b.length) >= 9 ? 2 : 1));

/** 0 = different person. Higher = more tokens agree. Initials ("Alamgir D. S.") match full names. */
export function nameScore(a, b) {
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length || !compatible(x[0], y[0])) return 0;
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
  if (!mb || !pass) throw Object.assign(new Error('This default mailbox is not configured yet. Ask an admin to set it up.'), { status: 503 });
  return { ...DEFAULT_SERVERS, email: mb.email, imapUser: mb.email, imapPassword: pass, smtpUser: mb.email, smtpPassword: pass };
}

export const isDefaultEmail = (email) => Object.values(MAILBOXES).some((m) => m.email === String(email || '').trim().toLowerCase());

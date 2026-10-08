import test from 'node:test';
import assert from 'node:assert/strict';
import { nameScore, departmentsFor, parsePasswords, defaultCredentials, isDefaultEmail, MAILBOXES } from './departments.mjs';

// membership from the Kelas 7 MIT organisation chart
const members = [
  ['cqcb', 'Adam Mikail Hizkia Zilfa'], ['cqcb', 'Izyan Waiz Utomo'], ['cqcb', 'Elferiz Alaqsha Aslam'],
  ['safety_wellbeing', 'Dawud Hanif Darwin'], ['safety_wellbeing', 'Muhammad Baihaqi Al Ghazali'], ['safety_wellbeing', 'Muhammad Ali Ibrahim Alfatih'], ['safety_wellbeing', 'Bona Gabe Tampubolon'],
  ['president', 'Adelio Baradeva Raditya P.'], ['vice_president', 'Salim Fathan Alfarizqi'], ['secretariat', 'Arsa Alifiandra Rahmanto'], ['secretariat', 'Mikhail Raffandra Alfadli'], ['treasury', 'Ahmad Tahir Abid'],
  ['soul_space', 'Alamgir D. S.'], ['soul_space', 'Habibie Aginara'], ['soul_space', 'Kafyal Rusydi'],
  ['creativity_experience', 'Akhtara P.'], ['health_wellness', 'Narendra'],
].map(([role_key, name]) => ({ role_key, name }));
const acc = (display_name, account_type = 'student', role = 'Siswa') => ({ account_key: 'k-' + display_name, display_name, account_type, role });

test('initials match full names, different people never match', () => {
  assert.ok(nameScore('Alamgir D. S.', 'Alamgir Daffa Saputra') > 0);
  assert.ok(nameScore('Alamgir Daffa Saputra', 'Alamgir D. S.') > 0);
  assert.equal(nameScore('Muhammad Ali Ibrahim Alfatih', 'Muhammad Baihaqi Al Ghazali'), 0, 'same first name, different person');
  assert.equal(nameScore('Narendra', 'Narendra Putra') > 0, true);
  assert.equal(nameScore('', 'Narendra'), 0);
});

test('students get the mailbox of their lembaga', () => {
  assert.deepEqual(departmentsFor(acc('Izyan Waiz Utomo'), members), ['legislatif']);
  assert.deepEqual(departmentsFor(acc('Muhammad Ali Ibrahim Alfatih'), members), ['yudikatif']);
  assert.deepEqual(departmentsFor(acc('Muhammad Baihaqi Al Ghazali'), members), ['yudikatif']);
  assert.deepEqual(departmentsFor(acc('Alamgir Daffa Saputra'), members), ['kemenjira']);
  assert.deepEqual(departmentsFor(acc('Narendra Putra Wijaya'), members), ['kemenkesbug']);
  assert.deepEqual(departmentsFor(acc('Arsa Alifiandra Rahmanto'), members), ['eksekutif']);
  assert.deepEqual(departmentsFor(acc('Budi Biasa'), members), [], 'ordinary student has no department mailbox');
});

test('guru and executive officer accounts', () => {
  assert.deepEqual(departmentsFor(acc('Syariful Amri, Lc.', 'guru', 'Guru Kelas'), members), ['guru']);
  assert.deepEqual(departmentsFor(acc('Kelas 7 MIT', 'guru', 'Akun Resmi'), members), ['guru']);
  for (const role of ['Presiden', 'Wakil Presiden', 'Bendahara 1', 'Sekretariat 2']) assert.deepEqual(departmentsFor(acc('X Y', 'pengurus', role), []), ['eksekutif'], role);
  assert.deepEqual(departmentsFor(acc('Service account', 'pengurus', 'Service Account'), members), []);
});

test('an ambiguous name match grants nothing; overrides fix it', () => {
  const dup = [...members, { role_key: 'health_wellness', name: 'Izyan Waiz Utomo' }];
  assert.deepEqual(departmentsFor(acc('Izyan Waiz Utomo'), dup), []);
  assert.deepEqual(departmentsFor(acc('Izyan Waiz Utomo'), dup, { 'k-Izyan Waiz Utomo': ['legislatif', 'kemenkesbug', 'bogus'] }), ['legislatif', 'kemenkesbug']);
});

test('passwords: only known mailboxes, no leakage of format errors', () => {
  const p = parsePasswords(JSON.stringify({ guru: 'a'.repeat(32), bogus: 'x'.repeat(32), eksekutif: 'short' }));
  assert.deepEqual(Object.keys(p), ['guru']);
  const c = defaultCredentials('guru', p);
  assert.equal(c.imapHost, 'imap.foundermail.mx'); assert.equal(c.imapPort, 993); assert.equal(c.imapTls, 'ssl');
  assert.equal(c.smtpHost, 'smtp.foundermail.mx'); assert.equal(c.smtpPort, 587); assert.equal(c.smtpTls, 'starttls');
  assert.equal(c.imapUser, 'guru@7mit.org');
  assert.throws(() => defaultCredentials('eksekutif', p), /not configured/);
  assert.deepEqual(parsePasswords(''), {});
});

test('default addresses are recognised so they cannot be re-added as external mailboxes', () => {
  for (const m of Object.values(MAILBOXES)) assert.ok(isDefaultEmail(m.email.toUpperCase()));
  assert.equal(isDefaultEmail('someone@gmail.com'), false);
  assert.equal(Object.keys(MAILBOXES).length, 8);
});

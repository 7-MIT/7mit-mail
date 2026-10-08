import { DatabaseSync } from 'node:sqlite';

export function openDb(file = process.env.DB_FILE || './data/mail.db') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', pw_hash TEXT, external_id TEXT UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_local_email ON users(email) WHERE external_id IS NULL;
    CREATE TABLE IF NOT EXISTS sessions(
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, akun_token_enc TEXT, checked_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS accounts(
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '',
      imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_secure TEXT NOT NULL, imap_user TEXT NOT NULL, imap_pass_enc TEXT NOT NULL,
      smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL, smtp_secure TEXT NOT NULL, smtp_user TEXT NOT NULL, smtp_pass_enc TEXT NOT NULL,
      signature TEXT NOT NULL DEFAULT '', last_error TEXT, last_sync INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS folders(
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      path TEXT NOT NULL, name TEXT NOT NULL, special TEXT, delimiter TEXT,
      uidvalidity TEXT, total INTEGER NOT NULL DEFAULT 0, unseen INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(account_id, path));
    CREATE TABLE IF NOT EXISTS messages(
      account_id INTEGER NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL,
      message_id TEXT, subject TEXT, from_name TEXT, from_addr TEXT, to_addrs TEXT,
      date INTEGER, snippet TEXT, seen INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0,
      answered INTEGER NOT NULL DEFAULT 0, draft INTEGER NOT NULL DEFAULT 0, has_att INTEGER NOT NULL DEFAULT 0, size INTEGER,
      PRIMARY KEY(account_id, folder, uid));
    CREATE INDEX IF NOT EXISTS idx_msg_list ON messages(account_id, folder, date DESC);
    CREATE TABLE IF NOT EXISTS contacts(
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', UNIQUE(user_id, email));
    CREATE TABLE IF NOT EXISTS settings(
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS login_attempts(key TEXT NOT NULL, at INTEGER NOT NULL);
  `);
  return db;
}

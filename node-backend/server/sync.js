import { EventEmitter } from 'node:events';
import { openImap, creds, syncFolders, syncFolder } from './mail.js';

/** Fan-out of mailbox events to browser SSE streams, keyed by user id. */
export const hub = new EventEmitter();
hub.setMaxListeners(0);

const FULL_SYNC_MS = Number(process.env.FULL_SYNC_MS) || 2 * 60 * 1000;
const MAX_WATCHERS = Number(process.env.MAX_WATCHERS) || 200;

export class SyncManager {
  constructor(db, key) { this.db = db; this.key = key; this.watchers = new Map(); }

  startAll() {
    for (const a of this.db.prepare('SELECT * FROM accounts').all()) this.start(a.id);
  }

  start(accountId) {
    if (this.watchers.has(accountId) || this.watchers.size >= MAX_WATCHERS) return;
    const w = { stopped: false, client: null, timer: null };
    this.watchers.set(accountId, w);
    this.#run(accountId, w).catch(() => {});
  }

  stop(accountId) {
    const w = this.watchers.get(accountId);
    if (!w) return;
    w.stopped = true; clearTimeout(w.timer); clearInterval(w.full);
    try { w.client?.close(); } catch { /* ignore */ }
    this.watchers.delete(accountId);
  }

  stopAll() { for (const id of [...this.watchers.keys()]) this.stop(id); }

  /** One-shot sync on a short-lived connection (initial sync after adding an account). */
  async syncNow(a, folders = ['INBOX']) {
    const c = await openImap(a, creds(a, this.key).imapPass);
    try {
      await syncFolders(this.db, a, c);
      for (const f of folders) await syncFolder(this.db, a, c, f);
      this.db.prepare('UPDATE accounts SET last_sync=unixepoch(), last_error=NULL WHERE id=?').run(a.id);
    } finally { try { await c.logout(); } catch { c.close(); } }
  }

  notify(a, folder, type = 'sync') { hub.emit(String(a.user_id), { type, accountId: a.id, folder }); }

  async #run(id, w) {
    let backoff = 2000;
    while (!w.stopped) {
      const a = this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
      if (!a) return this.stop(id);
      let client;
      try {
        client = await openImap(a, creds(a, this.key).imapPass, { watcher: true });
        w.client = client; backoff = 2000;
        await syncFolders(this.db, a, client);
        await syncFolder(this.db, a, client, 'INBOX');
        this.db.prepare('UPDATE accounts SET last_sync=unixepoch(), last_error=NULL WHERE id=?').run(id);
        this.notify(a, 'INBOX');

        let pending = null;
        const touch = (path) => {
          clearTimeout(pending);
          pending = setTimeout(async () => {
            try {
              await syncFolder(this.db, a, client, path || 'INBOX');
              await syncFolders(this.db, a, client);
              this.notify(a, path || 'INBOX');
            } catch { /* connection errors end the session below */ }
          }, 400);
        };
        client.on('exists', (e) => touch(e.path));
        client.on('expunge', (e) => touch(e.path));
        client.on('flags', (e) => touch(e.path));
        // Keep INBOX selected (no lock held, so syncs can run): ImapFlow issues IDLE whenever the
        // connection is quiet and falls back to NOOP polling on servers without IDLE.
        await client.mailboxOpen('INBOX');
        w.full = setInterval(async () => {
          try { await syncFolders(this.db, a, client); await syncFolder(this.db, a, client, 'INBOX'); this.notify(a, null); } catch { /* handled by close */ }
        }, FULL_SYNC_MS);
        await new Promise((resolve) => client.once('close', resolve));
        clearInterval(w.full); clearTimeout(pending);
      } catch (err) {
        this.db.prepare('UPDATE accounts SET last_error=? WHERE id=?').run(String(err.responseText || err.message).slice(0, 300), id);
        this.notify(a, null, 'error');
      } finally {
        clearInterval(w.full);
        try { client?.close(); } catch { /* ignore */ }
      }
      if (w.stopped) return;
      await new Promise((r) => { w.timer = setTimeout(r, backoff); });
      backoff = Math.min(backoff * 2, 5 * 60 * 1000);
    }
  }
}

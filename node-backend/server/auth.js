import { hashPassword, verifyPassword, randomToken, sha256, encrypt, decrypt } from './crypto.js';

const SESSION_DAYS = 14;
const RECHECK_SEC = 300; // how often an akun.7mit-backed session is re-validated upstream
export const COOKIE = 'mail7_sid';
// akun.7mit usernames: "<name>" or "<name>@7mit" (same normalisation as the akun-auth edge function)
export const cleanUsername = (v) => String(v || '').trim().toLowerCase().replace(/@7mit$/i, '');
const validUsername = (v) => /^[a-z0-9._-]{2,80}$/.test(v);

export function createAuth(db, cfg, key) {
  const akunMode = !!cfg.akunAuthUrl;
  const cookieOpts = () => ({ httpOnly: true, sameSite: 'lax', secure: cfg.secureCookies, path: '/', maxAge: SESSION_DAYS * 86400e3 });

  /** Calls the akun.7mit `akun-auth` edge function, forwarding the browser's IP/UA so akun.7mit's device list stays meaningful. */
  async function akun(body, req) {
    const headers = { 'content-type': 'application/json' };
    if (cfg.akunAuthApikey) { headers.apikey = cfg.akunAuthApikey; }
    if (req?.ip) headers['x-forwarded-for'] = req.ip;
    if (req?.headers?.['user-agent']) headers['user-agent'] = req.headers['user-agent'];
    const r = await fetch(cfg.akunAuthUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  }

  function upsertAkunUser(profile) {
    const ext = `akun:${profile.account_key}`;
    const email = `${cleanUsername(profile.username)}@7mit`;
    const name = String(profile.display_name || '').slice(0, 120);
    db.prepare(`INSERT INTO users(email,display_name,external_id) VALUES(?,?,?)
      ON CONFLICT(external_id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name`).run(email, name, ext);
    return db.prepare('SELECT * FROM users WHERE external_id=?').get(ext);
  }

  function startSession(res, userId, akunToken) {
    const token = randomToken();
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,akun_token_enc,checked_at) VALUES(?,?,?,?,unixepoch())')
      .run(sha256(token), userId, Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400, akunToken ? encrypt(akunToken, key) : null);
    res.cookie(COOKIE, token, cookieOpts());
  }

  function tooMany(k) {
    db.prepare('DELETE FROM login_attempts WHERE at < unixepoch() - 900').run();
    return db.prepare('SELECT COUNT(*) c FROM login_attempts WHERE key=?').get(k).c >= 10;
  }
  const fail = (k) => db.prepare('INSERT INTO login_attempts(key,at) VALUES(?,unixepoch())').run(k);

  // Short cache for bearer tokens handed over by akun.7mit (avoids an upstream call per request).
  const bearerCache = new Map();

  async function middleware(req, res, next) {
    try {
      const sid = req.cookies?.[COOKIE];
      if (sid) {
        const hash = sha256(sid);
        const row = db.prepare(`SELECT u.*, s.akun_token_enc, s.checked_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>unixepoch()`).get(hash);
        if (row) {
          let alive = true;
          if (akunMode && row.akun_token_enc && Date.now() / 1000 - row.checked_at > RECHECK_SEC) {
            try {
              const r = await akun({ action: 'session', token: decrypt(row.akun_token_enc, key) }, req);
              if (r.status === 401) alive = false; // revoked from akun.7mit, or account deactivated
              else if (r.status === 200) db.prepare('UPDATE sessions SET checked_at=unixepoch() WHERE token_hash=?').run(hash);
            } catch { /* upstream unreachable: keep the session, retry on next request */ }
          }
          if (alive) { req.user = row; return next(); }
          db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);
          res.clearCookie(COOKIE, { path: '/' });
        }
      }
      const bearer = /^Bearer ([0-9a-f-]{36})$/i.exec(req.headers.authorization || '')?.[1];
      if (akunMode && bearer) {
        const hit = bearerCache.get(bearer);
        if (hit && hit.until > Date.now()) { req.user = db.prepare('SELECT * FROM users WHERE id=?').get(hit.userId); if (req.user) return next(); }
        const r = await akun({ action: 'session', token: bearer }, req);
        if (r.status === 200 && r.data.profile?.account_key) {
          const u = upsertAkunUser(r.data.profile);
          bearerCache.set(bearer, { userId: u.id, until: Date.now() + 60000 });
          req.user = u; return next();
        }
        bearerCache.delete(bearer);
      }
    } catch { /* fall through to 401 */ }
    res.status(401).json({ error: 'Not signed in' });
  }

  const routes = (app) => {
    app.get('/api/auth/config', (req, res) => res.json({ akun: akunMode, registration: !akunMode && cfg.allowRegistration, akunUrl: cfg.akunPortalUrl || null, defaults: cfg.defaults }));

    app.post('/api/auth/register', (req, res) => {
      if (akunMode || !cfg.allowRegistration) return res.status(403).json({ error: 'Registration is disabled' });
      const email = String(req.body.email || '').trim().toLowerCase(); const pw = String(req.body.password || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
      if (pw.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
      if (db.prepare('SELECT 1 FROM users WHERE email=? AND external_id IS NULL').get(email)) return res.status(409).json({ error: 'Email already registered' });
      const { lastInsertRowid } = db.prepare('INSERT INTO users(email,pw_hash) VALUES(?,?)').run(email, hashPassword(pw));
      startSession(res, Number(lastInsertRowid));
      res.json({ ok: true });
    });

    app.post('/api/auth/login', async (req, res) => {
      if (akunMode) {
        const username = cleanUsername(req.body.username); const password = String(req.body.password || '');
        if (!validUsername(username) || !password || password.length > 200) return res.status(400).json({ error: 'Masukkan username akun.7mit dan password.' });
        const k = `${req.ip}|${username}`;
        if (tooMany(k)) return res.status(429).json({ error: 'Too many attempts, try again later' });
        let r;
        try { r = await akun({ action: 'login', username, password, account_key: req.body.account_key ? String(req.body.account_key) : undefined }, req); }
        catch { return res.status(502).json({ error: 'akun.7mit tidak dapat dihubungi. Coba lagi.' }); }
        if (r.status === 409 && r.data.selection_required) return res.status(409).json({ selection_required: true, accounts: r.data.accounts });
        if (r.status === 401) { fail(k); return res.status(401).json({ error: 'Username atau password tidak sesuai.' }); }
        if (r.status === 404) return res.status(502).json({ error: 'Alamat layanan akun.7mit salah (404). Periksa AKUN_AUTH_URL; harus berakhir dengan /functions/v1/akun-auth.' });
        if (r.status !== 200 || !r.data.token || !r.data.profile?.account_key) return res.status(502).json({ error: r.data.error || 'Login akun.7mit gagal.' });
        startSession(res, upsertAkunUser(r.data.profile).id, r.data.token);
        return res.json({ ok: true });
      }
      const email = String(req.body.email || '').trim().toLowerCase(); const k = `${req.ip}|${email}`;
      if (tooMany(k)) return res.status(429).json({ error: 'Too many attempts, try again later' });
      const u = db.prepare('SELECT * FROM users WHERE email=? AND external_id IS NULL').get(email);
      // always run a verification to keep timing similar for unknown users
      const ok = verifyPassword(String(req.body.password || ''), u?.pw_hash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA') && !!u?.pw_hash;
      if (!ok) { fail(k); return res.status(401).json({ error: 'Invalid email or password' }); }
      startSession(res, u.id);
      res.json({ ok: true });
    });

    app.post('/api/auth/logout', async (req, res) => {
      const sid = req.cookies?.[COOKIE];
      if (sid) {
        const row = db.prepare('SELECT akun_token_enc FROM sessions WHERE token_hash=?').get(sha256(sid));
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(sid));
        // revoke the akun.7mit session this login created (it is ours alone; the user's other devices are unaffected)
        if (akunMode && row?.akun_token_enc) { try { await akun({ action: 'logout', token: decrypt(row.akun_token_enc, key) }, req); } catch { /* best effort */ } }
      }
      res.clearCookie(COOKIE, { path: '/' });
      res.json({ ok: true });
    });
  };

  return { middleware, routes, akunMode };
}

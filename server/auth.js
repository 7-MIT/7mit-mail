import { jwtVerify, createRemoteJWKSet } from 'jose';
import { hashPassword, verifyPassword, randomToken, sha256 } from './crypto.js';

const SESSION_DAYS = 14;
export const COOKIE = 'mail7_sid';

export function createAuth(db, cfg) {
  const jwks = cfg.ssoJwksUrl ? createRemoteJWKSet(new URL(cfg.ssoJwksUrl)) : null;
  const secret = cfg.ssoJwtSecret ? new TextEncoder().encode(cfg.ssoJwtSecret) : null;
  const ssoEnabled = !!(jwks || secret);

  const cookieOpts = () => ({ httpOnly: true, sameSite: 'lax', secure: cfg.secureCookies, path: '/', maxAge: SESSION_DAYS * 86400e3 });

  function startSession(res, userId) {
    const token = randomToken();
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha256(token), userId, Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400);
    res.cookie(COOKIE, token, cookieOpts());
  }

  function tooMany(key) {
    db.prepare('DELETE FROM login_attempts WHERE at < unixepoch() - 900').run();
    return db.prepare('SELECT COUNT(*) c FROM login_attempts WHERE key=?').get(key).c >= 10;
  }

  async function ssoUser(token) {
    const { payload } = await jwtVerify(token, jwks || secret, { issuer: cfg.ssoIssuer || undefined, audience: cfg.ssoAudience || undefined });
    const email = String(payload.email || '').toLowerCase();
    if (!payload.sub || !email) throw new Error('Token needs sub and email claims');
    const ext = `sso:${payload.sub}`;
    let u = db.prepare('SELECT * FROM users WHERE external_id=?').get(ext);
    if (!u) {
      db.prepare('INSERT INTO users(email,external_id) VALUES(?,?) ON CONFLICT(email) DO UPDATE SET external_id=excluded.external_id').run(email, ext);
      u = db.prepare('SELECT * FROM users WHERE external_id=?').get(ext);
    }
    return u;
  }

  /** Resolves req.user from session cookie, or from an SSO bearer token (akun.7mit) when configured. */
  async function middleware(req, res, next) {
    try {
      const sid = req.cookies?.[COOKIE];
      if (sid) {
        const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>unixepoch()`).get(sha256(sid));
        if (row) { req.user = row; return next(); }
      }
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      if (ssoEnabled && bearer) { req.user = await ssoUser(bearer); return next(); }
    } catch { /* fall through to 401 */ }
    res.status(401).json({ error: 'Not signed in', sso: ssoEnabled ? cfg.ssoLoginUrl || true : false });
  }

  const routes = (app) => {
    app.get('/api/auth/config', (req, res) => res.json({ registration: cfg.allowRegistration, sso: ssoEnabled ? (cfg.ssoLoginUrl || true) : false }));

    app.post('/api/auth/register', (req, res) => {
      if (!cfg.allowRegistration) return res.status(403).json({ error: 'Registration is disabled' });
      const email = String(req.body.email || '').trim().toLowerCase(); const pw = String(req.body.password || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
      if (pw.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
      if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Email already registered' });
      const { lastInsertRowid } = db.prepare('INSERT INTO users(email,pw_hash) VALUES(?,?)').run(email, hashPassword(pw));
      startSession(res, Number(lastInsertRowid));
      res.json({ ok: true });
    });

    app.post('/api/auth/login', (req, res) => {
      const email = String(req.body.email || '').trim().toLowerCase(); const key = `${req.ip}|${email}`;
      if (tooMany(key)) return res.status(429).json({ error: 'Too many attempts, try again later' });
      const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      // always run a verification to keep timing similar for unknown users
      const ok = verifyPassword(String(req.body.password || ''), u?.pw_hash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA') && !!u?.pw_hash;
      if (!ok) { db.prepare('INSERT INTO login_attempts(key,at) VALUES(?,unixepoch())').run(key); return res.status(401).json({ error: 'Invalid email or password' }); }
      startSession(res, u.id);
      res.json({ ok: true });
    });

    app.post('/api/auth/logout', (req, res) => {
      const sid = req.cookies?.[COOKIE];
      if (sid) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(sid));
      res.clearCookie(COOKIE, { path: '/' });
      res.json({ ok: true });
    });
  };

  return { middleware, routes, ssoEnabled };
}

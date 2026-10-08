// Mock of the akun.7mit `akun-auth` edge function (same request/response contract as the real one).
import http from 'node:http';
import crypto from 'node:crypto';

export function mockAkun() {
  const sessions = new Map(); const seen = []; let down = false;
  const accts = { budi: [{ account_key: 'siswa-budi', username: 'budi', display_name: 'Budi S', role: 'siswa', account_type: 'student' }],
    ani: [{ account_key: 'siswa-ani', username: 'ani', display_name: 'Ani', role: 'siswa', account_type: 'student' }, { account_key: 'guru-ani', username: 'ani', display_name: 'Ani (Guru)', role: 'guru', account_type: 'guru' }] };
  const pub = (a) => ({ account_key: a.account_key, account_type: a.account_type, role: a.role, label: a.account_type === 'student' ? 'Akun Siswa' : 'Akun Guru' });
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
      const b = JSON.parse(raw || '{}'); seen.push({ body: b, headers: req.headers });
      const send = (st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (down) return send(503, { error: 'down' });
      if (b.action === 'login') {
        const list = accts[b.username] || []; if (!list.length || b.password !== 'rahasia123') return send(401, { error: 'Username atau password tidak sesuai.' });
        if (list.length > 1 && !b.account_key) return send(409, { selection_required: true, accounts: list.map(pub) });
        const a = list.find((x) => x.account_key === (b.account_key || list[0].account_key)); if (!a) return send(401, { error: 'x' });
        const token = crypto.randomUUID(); sessions.set(token, { a, revoked: false });
        return send(200, { token, profile: a });
      }
      const s = sessions.get(b.token);
      if (b.action === 'logout') { if (s) s.revoked = true; return send(200, { ok: true }); }
      if (b.action === 'session') return s && !s.revoked ? send(200, { profile: s.a }) : send(401, { error: 'Sesi telah berakhir.' });
      send(400, { error: 'Aksi tidak dikenal.' });
    });
  });
  return { server, sessions, seen, setDown: (v) => (down = v) };
}

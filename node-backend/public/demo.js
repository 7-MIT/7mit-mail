// Demo mode: replaces /api with an in-browser fake mailbox so the UI can be previewed without a server.
// Loaded only by demo.html. Any username/password works.
(() => {
  const now = Math.floor(Date.now() / 1000), H = 3600, D = 86400;
  let loggedIn = false, nextUid = 100;
  const A = (name, address) => ({ name, address });
  const me = A('Siswa 7 MIT', 'siswa@7mit.org');
  const base = (uid, folder, from, subject, ago, o = {}) => ({ uid, folder, from, to: [me], cc: [], subject, date: now - ago, seen: o.seen ?? true, flagged: !!o.flagged, answered: false, draft: folder === 'Drafts', attachments: o.att || [], html: o.html || null, text: o.text || '' });
  const M = [
    base(1, 'INBOX', A('Ayu Lestari', 'ayu@7mit.org'), 'Rapat OSIS Jumat jam 10.00', 12 * 60, { seen: false, text: 'Halo!\n\nRapat OSIS dilaksanakan hari Jumat pukul 10.00 di aula. Mohon konfirmasi kehadiran sebelum Kamis.\n\nTerima kasih,\nAyu' }),
    base(2, 'INBOX', A('GitHub', 'noreply@github.com'), '[7-MIT/home] Pull request merged', 2 * H, { seen: false, html: '<div style="font-family:system-ui;max-width:520px"><h2 style="color:#0369a1;margin:0 0 8px">Pull request merged 🎉</h2><p>Perubahan Anda pada <b>7-MIT/home</b> telah digabungkan ke <code>main</code>.</p><p><a href="https://github.com/7-MIT">Lihat di GitHub</a></p><img src="https://example.com/tracker.gif" width="1" height="1"></div>' }),
    base(3, 'INBOX', A('Pak Budi (Guru)', 'budi@7mit.org'), 'Tugas Kelompok Fisika — Lampiran', 5 * H, { seen: false, flagged: true, att: [{ index: 0, filename: 'Tugas-Fisika.pdf', contentType: 'application/pdf', size: 482000, inline: false }, { index: 1, filename: 'Rubrik.xlsx', contentType: 'application/vnd.ms-excel', size: 31000, inline: false }], text: 'Selamat pagi anak-anak,\n\nBerikut lampiran tugas kelompok Fisika beserta rubrik penilaian. Dikumpulkan paling lambat Senin.\n\nSalam,\nPak Budi' }),
    base(4, 'INBOX', A('akun.7mit', 'no-reply@akun.7mit.org'), 'Perangkat baru masuk ke akun Anda', 9 * H, { html: '<div style="font-family:system-ui"><p>Ada login baru dari <b>Chrome · Windows</b>.</p><p>Jika ini bukan Anda, buka <a href="https://akun.7mit.org">akun.7mit</a> dan keluarkan perangkat tersebut.</p></div>' }),
    base(5, 'INBOX', A('Dewi Kartika', 'dewi@example.org'), 'Re: Catatan Biologi bab 4', 1 * D + 3 * H, { text: 'Sudah aku kirim ya catatannya. Kalau ada yang kurang kabari saja 🙂' }),
    base(6, 'INBOX', A('Perpustakaan 7 MIT', 'pustaka@7mit.org'), 'Pengingat: buku jatuh tempo besok', 1 * D + 8 * H, { seen: false, text: 'Buku "Fisika Dasar" jatuh tempo besok. Perpanjang lewat portal perpustakaan.' }),
    base(7, 'INBOX', A('Rizky', 'rizky@example.org'), 'Foto kegiatan pramuka', 2 * D, { flagged: true, att: [{ index: 0, filename: 'pramuka.jpg', contentType: 'image/jpeg', size: 2300000, inline: false }], text: 'Ini fotonya, keren-keren semua!' }),
    base(8, 'INBOX', A('Tim Quiz 7 MIT', 'quiz@7mit.org'), 'Hasil kuis minggu ini sudah keluar', 3 * D, { text: 'Nilai kuis Anda sudah tersedia di portal quiz.7mit.' }),
    base(9, 'INBOX', A('Nadia', 'nadia@example.org'), 'Latihan paduan suara', 4 * D, { text: 'Latihan dimulai pukul 15.30 di ruang musik.' }),
    base(10, 'INBOX', A('Kelas 7 MIT', 'kelas@7mit.org'), 'Jadwal piket pekan depan', 5 * D, { text: 'Senin: Ani, Budi, Citra\nSelasa: Dewi, Eko, Fajar' }),
    base(11, 'INBOX', A('Toko Buku Online', 'promo@tokobuku.example'), 'Diskon 50% buku pelajaran', 6 * D, { html: '<h3 style="color:#b91c1c">Diskon 50%!</h3><p>Hanya minggu ini.</p>' }),
    base(12, 'INBOX', A('Mas Anto', 'anto@example.org'), 'Undangan reuni SD', 8 * D, { text: 'Reuni SD angkatan 2019 hari Minggu di taman kota.' }),
    base(20, 'Sent', me, 'Konfirmasi hadir rapat OSIS', 30 * 60, { text: 'Saya hadir ya.' }),
    base(21, 'Sent', me, 'Catatan Biologi bab 4', 1 * D + 5 * H, { text: 'Terlampir catatan Biologi.' }),
    base(30, 'Drafts', me, 'Proposal kegiatan bulan depan', 20 * H, { text: 'Draf proposal…' }),
    base(40, 'Junk', A('Hadiah Gratis', 'win@spam.example'), 'Selamat! Anda menang undian', 2 * D, { text: 'Klik di sini…' }),
    base(50, 'Trash', A('Newsletter', 'news@example.org'), 'Edisi lama', 9 * D, { text: 'Arsip newsletter.' }),
  ];
  M.find((m) => m.uid === 20).to = [A('Ayu Lestari', 'ayu@7mit.org')];
  M.find((m) => m.uid === 20).from = me;
  M.find((m) => m.uid === 30).to = [A('Pak Budi', 'budi@7mit.org')];
  const FOLDERS = [['INBOX', 'INBOX', 'inbox'], ['Drafts', 'Drafts', 'drafts'], ['Sent', 'Sent', 'sent'], ['Junk', 'Junk', 'junk'], ['Trash', 'Trash', 'trash'], ['Proyek OSIS', 'Proyek OSIS', null]];
  const account = { id: 1, label: 'Surel 7 MIT', email: me.address, displayName: me.name, signature: 'Salam,\nSiswa 7 MIT', imap: { host: 'imap.foundermail.mx', port: 993, secure: 'ssl', user: me.address }, smtp: { host: 'smtp.foundermail.mx', port: 587, secure: 'starttls', user: me.address }, lastSync: now, lastError: null };
  const contacts = [['Ayu Lestari', 'ayu@7mit.org'], ['Pak Budi', 'budi@7mit.org'], ['Dewi Kartika', 'dewi@example.org'], ['Rizky', 'rizky@example.org']].map(([name, email], i) => ({ id: i + 1, name, email, notes: '' }));
  let settings = {};

  const row = (m) => ({ uid: m.uid, subject: m.subject, from: m.from, to: m.to.map((t) => t.address).join(', '), date: m.date, seen: m.seen, flagged: m.flagged, answered: m.answered, draft: m.draft, hasAttachments: m.attachments.length > 0, size: 4096 });
  const folders = () => FOLDERS.map(([path, name, special]) => { const l = M.filter((m) => m.folder === path); return { path, name, special, delimiter: '/', total: l.length, unseen: l.filter((m) => !m.seen).length }; });
  const byQ = (u) => Object.fromEntries(new URL(u, location.href).searchParams);

  const route = (method, url, body) => {
    const path = url.replace(/^\/api/, '').split('?')[0]; const q = byQ(url); let m;
    if (path === '/auth/config') return [200, { akun: true, registration: false, akunUrl: 'https://akun.7mit.org', defaults: { imap: { host: 'imap.foundermail.mx', port: 993, secure: 'ssl' }, smtp: { host: 'smtp.foundermail.mx', port: 587, secure: 'starttls' } } }];
    if (path === '/auth/login') { if (!body.username || !body.password) return [400, { error: 'Masukkan username akun.7mit dan password.' }]; if (body.password === 'salah') return [401, { error: 'Username atau password tidak sesuai.' }]; loggedIn = true; return [200, { ok: true }]; }
    if (path === '/auth/logout') { loggedIn = false; return [200, { ok: true }]; }
    if (!loggedIn) return [401, { error: 'Not signed in' }];
    if (path === '/me') return [200, { id: 1, email: 'siswa@7mit', name: me.name }];
    if (path === '/accounts' && method === 'GET') return [200, [account]];
    if (path === '/accounts/test') return [200, { imap: 'ok', smtp: 'ok' }];
    if (path === '/accounts') return [201, account];
    if (path === '/settings') { if (method === 'PUT') settings = body; return [200, settings]; }
    if (path === '/contacts' && method === 'GET') { const t = (q.q || '').toLowerCase(); return [200, contacts.filter((c) => (c.name + c.email).toLowerCase().includes(t))]; }
    if (path === '/contacts' && method === 'POST') { contacts.push({ id: Date.now(), name: body.name || '', email: body.email, notes: '' }); return [201, { ok: true }]; }
    if ((m = /^\/contacts\/(\d+)$/.exec(path))) { const i = contacts.findIndex((c) => c.id === +m[1]); if (i >= 0) contacts.splice(i, 1); return [200, { ok: true }]; }
    if (/\/folders$/.test(path)) { if (method === 'POST') { FOLDERS.push([body.name, body.name, null]); return [201, { ok: true }]; } return [200, folders()]; }
    if (/\/sync$/.test(path)) return [200, { ok: true }];
    if (/\/messages$/.test(path)) {
      let l = M.filter((x) => x.folder === q.folder).sort((a, b) => b.date - a.date || b.uid - a.uid);
      if (q.q) l = l.filter((x) => (x.subject + x.from.name + x.text).toLowerCase().includes(q.q.toLowerCase()));
      if (q.unread === '1') l = l.filter((x) => !x.seen); if (q.starred === '1') l = l.filter((x) => x.flagged);
      if (q.before) { const cut = M.find((x) => x.uid === +q.before && x.folder === q.folder); if (cut) l = l.filter((x) => x.date < cut.date || (x.date === cut.date && x.uid < cut.uid)); }
      const lim = +q.limit || 50; return [200, { messages: l.slice(0, lim).map(row), hasMore: l.length > lim }];
    }
    if (/\/messages\/flags$/.test(path)) { for (const u of body.uids) { const x = M.find((y) => y.uid === u && y.folder === body.folder); if (!x) continue; if (body.add?.includes('seen')) x.seen = true; if (body.remove?.includes('seen')) x.seen = false; if (body.add?.includes('flagged')) x.flagged = true; if (body.remove?.includes('flagged')) x.flagged = false; } return [200, { ok: true }]; }
    if (/\/messages\/(move|delete)$/.test(path)) { const to = /delete/.test(path) ? (body.folder === 'Trash' ? null : 'Trash') : body.to; for (const u of body.uids) { const i = M.findIndex((y) => y.uid === u && y.folder === body.folder); if (i < 0) continue; if (to) M[i].folder = to; else M.splice(i, 1); } return [200, { ok: true, to }]; }
    if ((m = /\/messages\/(\d+)$/.exec(path))) { const x = M.find((y) => y.uid === +m[1] && y.folder === q.folder); if (!x) return [404, { error: 'Message not found' }]; if (q.markRead !== '0') x.seen = true; const html = x.html ? (q.images === '1' ? x.html : x.html.replace(/<img[^>]*>/g, '')) : null;
      return [200, { uid: x.uid, folder: x.folder, messageId: `<${x.uid}@demo>`, inReplyTo: null, references: [], subject: x.subject, date: new Date(x.date * 1000).toISOString(), from: [x.from], to: x.to, cc: [], replyTo: [], html, text: x.text, blockedImages: x.html && q.images !== '1' && /<img/.test(x.html) ? 1 : 0, attachments: x.attachments, flags: x.seen ? ['\\Seen'] : [] }]; }
    if (/\/send$/.test(path)) { const p = body instanceof FormData ? JSON.parse(body.get('payload')) : body; M.push({ ...base(nextUid++, 'Sent', me, p.subject || '(tanpa subjek)', 0, { text: p.text }), to: String(p.to || '').split(/[,;]/).filter(Boolean).map((a) => A('', a.trim())) }); return [200, { ok: true, savedToSent: true }]; }
    if (/\/drafts$/.test(path)) { const p = body instanceof FormData ? JSON.parse(body.get('payload')) : body; M.push({ ...base(nextUid++, 'Drafts', me, p.subject || '(tanpa subjek)', 0, { text: p.text }) }); return [200, { ok: true, uid: nextUid - 1 }]; }
    if (path === '/unread') return [200, { total: M.filter((x) => x.folder === 'INBOX' && !x.seen).length, accounts: [] }];
    return [404, { error: 'Not found' }];
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api')) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 140 + Math.random() * 220)); // feel like a network
    let body = init.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep */ } }
    const [status, data] = route((init.method || 'GET').toUpperCase(), url, body);
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  };

  // Live push: a new mail "arrives" ~12 s after sign-in, like an IMAP IDLE event.
  window.EventSource = class { constructor() { this.t = setTimeout(() => { const uid = nextUid++; M.push(base(uid, 'INBOX', A('Ibu Sari (Wali Kelas)', 'sari@7mit.org'), 'Pengumuman: libur sekolah Senin', 0, { seen: false, text: 'Diumumkan bahwa hari Senin sekolah libur karena kegiatan kampus.' })); this.onmessage?.({ data: JSON.stringify({ type: 'sync', accountId: 1, folder: 'INBOX' }) }); }, 12000); } close() { clearTimeout(this.t); } };

  document.addEventListener('click', (e) => { const a = e.target.closest('a.att'); if (a) { e.preventDefault(); const t = document.createElement('div'); t.className = 'toast'; t.textContent = 'Demo: unduhan tidak tersedia tanpa server'; document.body.append(t); setTimeout(() => t.remove(), 2500); } }, true);
  const hint = document.createElement('div'); hint.textContent = 'MODE DEMO · data contoh · login bebas (password "salah" untuk coba animasi gagal)'; hint.style.cssText = 'position:fixed;left:10px;bottom:8px;z-index:200;font:12px system-ui;background:#0b1f3a;color:#67e8f9;border:1px solid #22d3ee55;padding:3px 12px;border-radius:99px;pointer-events:none;opacity:.9'; document.addEventListener('DOMContentLoaded', () => document.body.append(hint));
})();

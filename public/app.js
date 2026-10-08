// 7 MIT Mail — dependency-free SPA. All mail traffic goes through the server's /api; no mail credentials ever live in the browser.
const $app = document.getElementById('app');
const S = { me: null, accounts: [], folders: {}, acc: null, folder: 'INBOX', msgs: [], hasMore: false, sel: null, open: null, q: '', filter: '', settings: {}, unread: 0, loading: false };

// ---- tiny helpers ---------------------------------------------------------
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v; else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
    else if (k === 'dataset') Object.assign(el.dataset, v); else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const api = async (method, path, body) => {
  const isForm = body instanceof FormData;
  const r = await fetch('/api' + path, { method, credentials: 'same-origin',
    headers: { ...(method !== 'GET' ? { 'X-Requested-With': '7mit-mail' } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/auth/login') { S.me = null; render(); throw new Error('Sesi berakhir'); }
  if (!r.ok) throw Object.assign(new Error(data.error || `Error ${r.status}`), { data });
  return data;
};
const toast = (msg, err) => { const t = h('div', { class: 'toast' + (err ? ' err' : ''), role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 3500); };
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const fmtDate = (ts) => { if (!ts) return ''; const d = new Date(ts * 1000), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.getFullYear() === n.getFullYear() ? d.toLocaleDateString([], { day: 'numeric', month: 'short' }) : d.toLocaleDateString(); };
const who = (a) => a?.name || a?.address || '(tanpa pengirim)';
const addr = (a) => (a.name ? `${a.name} <${a.address}>` : a.address);
const bytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const FOLDER_ICON = { inbox: '📥', drafts: '📝', sent: '📤', junk: '🚫', trash: '🗑️', archive: '🗄️' };
const FOLDER_LABEL = { inbox: 'Kotak Masuk', drafts: 'Draf', sent: 'Terkirim', junk: 'Spam', trash: 'Sampah', archive: 'Arsip' };
const applyTheme = () => { const t = S.settings.theme; if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
const curFolders = () => S.folders[S.acc] || [];
const folderInfo = () => curFolders().find((f) => f.path === S.folder);

// ---- boot -----------------------------------------------------------------
async function boot() {
  try { S.me = await api('GET', '/me'); } catch { S.me = null; }
  if (S.me) await loadAll();
  render();
  if (S.me) connectEvents();
}
async function loadAll() {
  [S.accounts, S.settings] = await Promise.all([api('GET', '/accounts'), api('GET', '/settings').catch(() => ({}))]);
  applyTheme();
  await Promise.all(S.accounts.map(refreshFolders));
  if (!S.acc || !S.accounts.find((a) => a.id === S.acc)) { S.acc = S.accounts[0]?.id ?? null; S.folder = 'INBOX'; }
  if (S.acc) await loadMessages(true);
}
async function refreshFolders(a) { try { S.folders[a.id] = await api('GET', `/accounts/${a.id}/folders`); } catch { S.folders[a.id] = S.folders[a.id] || []; } }

let es;
function connectEvents() {
  es?.close(); es = new EventSource('/api/events');
  es.onmessage = guard(async (ev) => {
    const e = JSON.parse(ev.data); const a = S.accounts.find((x) => x.id === e.accountId); if (!a) return;
    await refreshFolders(a);
    if (e.type === 'sync' && e.accountId === S.acc && (!e.folder || e.folder === S.folder) && !S.q) {
      const before = new Set(S.msgs.map((m) => m.uid)); await loadMessages(true, true);
      const fresh = S.msgs.filter((m) => !before.has(m.uid) && !m.seen);
      if (fresh.length && before.size && S.settings.notifications && 'Notification' in window && Notification.permission === 'granted')
        new Notification(who(fresh[0].from), { body: fresh[0].subject, tag: 'mail7' });
    }
    updateTitle(); renderSide(); renderList();
  });
}
const updateTitle = () => { const n = S.accounts.reduce((s, a) => s + (curFoldersOf(a.id).find((f) => f.special === 'inbox')?.unseen || 0), 0); document.title = (n ? `(${n}) ` : '') + '7 MIT Mail'; };
const curFoldersOf = (id) => S.folders[id] || [];

// ---- data actions -----------------------------------------------------------
async function loadMessages(reset, quiet) {
  if (!S.acc) return;
  const first = reset ? '' : S.msgs[S.msgs.length - 1]?.uid;
  if (!quiet) { S.loading = true; renderList(); }
  try {
    const r = await api('GET', `/accounts/${S.acc}/messages?` + qs({ folder: S.folder, limit: S.settings.pageSize || 50, before: first, q: S.q, unread: S.filter === 'unread' ? 1 : '', starred: S.filter === 'starred' ? 1 : '' }));
    S.msgs = reset ? r.messages : S.msgs.concat(r.messages); S.hasMore = r.hasMore;
  } finally { S.loading = false; renderList(); }
}
const selectFolder = guard(async (accId, path) => { S.acc = accId; S.folder = path; S.q = ''; S.open = null; S.sel = null; S.filter = ''; document.querySelector('.shell')?.classList.remove('menu', 'reading'); await loadMessages(true); render(); });
const openMsg = guard(async (m, images) => {
  S.sel = m.uid; document.querySelector('.shell')?.classList.add('reading');
  S.open = { loading: true, uid: m.uid }; renderRead(); renderList();
  const d = await api('GET', `/accounts/${S.acc}/messages/${m.uid}?` + qs({ folder: S.folder, images: images ? 1 : '' }));
  S.open = d; m.seen = true; await refreshFolders(S.accounts.find((a) => a.id === S.acc));
  const imgOk = images || S.settings.loadRemoteImages;
  if (imgOk && !images && d.blockedImages) return openMsg(m, true);
  renderRead(); renderSide(); renderList(); updateTitle();
});
const setFlags = guard(async (uids, add, remove) => {
  await api('POST', `/accounts/${S.acc}/messages/flags`, { folder: S.folder, uids, add, remove });
  for (const m of S.msgs) if (uids.includes(m.uid)) { if (add.includes('seen')) m.seen = true; if (remove.includes('seen')) m.seen = false; if (add.includes('flagged')) m.flagged = true; if (remove.includes('flagged')) m.flagged = false; }
  await refreshFolders(S.accounts.find((a) => a.id === S.acc)); render();
});
const removeMsgs = guard(async (uids, to) => {
  await api('POST', `/accounts/${S.acc}/messages/${to ? 'move' : 'delete'}`, { folder: S.folder, uids, to });
  S.msgs = S.msgs.filter((m) => !uids.includes(m.uid)); if (uids.includes(S.sel)) { S.sel = null; S.open = null; document.querySelector('.shell')?.classList.remove('reading'); }
  await refreshFolders(S.accounts.find((a) => a.id === S.acc)); render(); toast(to ? 'Dipindahkan' : 'Dihapus');
});

// ---- render ----------------------------------------------------------------
function render() {
  $app.replaceChildren();
  if (!S.me) return $app.append(authView());
  if (!S.accounts.length) { $app.append(h('div', { class: 'auth' }, h('div', { class: 'card' }, h('div', { class: 'logo' }, h('i', {}, '✉'), '7 MIT Mail'), h('p', { class: 'muted' }, 'Hubungkan kotak surel pertama Anda lewat server IMAP/SMTP mana pun.'), h('button', { class: 'btn primary', on: { click: () => accountDialog() } }, 'Tambah kotak surel'), ' ', h('button', { class: 'btn', on: { click: logout } }, 'Keluar')))); return; }
  const shell = h('div', { class: 'shell' },
    h('header', { class: 'top' },
      h('button', { class: 'btn ghost icon mobnav', 'aria-label': 'Menu', on: { click: () => shell.classList.toggle('menu') } }, '☰'),
      h('div', { class: 'logo name' }, '✉ 7 MIT Mail'),
      h('form', { class: 'search', role: 'search', on: { submit: guard(async (e) => { e.preventDefault(); S.q = e.target.q.value.trim(); await loadMessages(true); }) } },
        h('input', { type: 'search', name: 'q', placeholder: 'Cari surel…', value: S.q, 'aria-label': 'Cari' })),
      h('button', { class: 'btn ghost icon', title: 'Kontak', on: { click: contactsDialog } }, '👥'),
      h('button', { class: 'btn ghost icon', title: 'Pengaturan', on: { click: settingsDialog } }, '⚙️')),
    h('nav', { class: 'side', id: 'side' }), h('section', { class: 'list', id: 'list' }), h('article', { class: 'read', id: 'read' }));
  $app.append(shell); renderSide(); renderList(); renderRead(); updateTitle();
}
function renderSide() {
  const side = document.getElementById('side'); if (!side) return;
  side.replaceChildren(h('button', { class: 'btn primary compose', on: { click: () => composeWindow() } }, '✏️ Tulis'));
  for (const a of S.accounts) {
    const fl = curFoldersOf(a.id);
    side.append(h('div', { class: 'acct' },
      h('div', { class: 'acct-h', title: a.lastError || a.email }, h('span', {}, a.label), a.lastError ? h('span', { class: 'err' }, '⚠') : null),
      fl.map((f) => h('div', { class: 'fld' + (S.acc === a.id && S.folder === f.path ? ' on' : ''), role: 'button', tabindex: 0, on: { click: () => selectFolder(a.id, f.path), keydown: (e) => e.key === 'Enter' && selectFolder(a.id, f.path) } },
        h('span', {}, FOLDER_ICON[f.special] || '📁'), h('span', {}, FOLDER_LABEL[f.special] || f.name),
        f.unseen && f.special !== 'trash' ? h('span', { class: 'n' }, f.unseen) : null)),
      h('div', { class: 'fld muted', role: 'button', tabindex: 0, on: { click: guard(async () => { const n = prompt('Nama folder baru'); if (!n) return; await api('POST', `/accounts/${a.id}/folders`, { name: n }); await refreshFolders(a); renderSide(); }) } }, '＋ Folder baru')));
  }
}
function renderList() {
  const el = document.getElementById('list'); if (!el) return;
  const f = folderInfo(); const sel = S.msgs.filter((m) => m._sel).map((m) => m.uid);
  el.replaceChildren(h('div', { class: 'list-h' },
    h('button', { class: 'btn ghost icon mobnav', 'aria-label': 'Folder', on: { click: () => document.querySelector('.shell').classList.add('menu') } }, '📂'),
    h('h2', {}, S.q ? `Hasil: ${S.q}` : FOLDER_LABEL[f?.special] || f?.name || S.folder),
    sel.length ? [h('button', { class: 'btn ghost', on: { click: () => setFlags(sel, ['seen'], []) } }, 'Dibaca'), h('button', { class: 'btn ghost danger', on: { click: () => removeMsgs(sel) } }, 'Hapus')]
      : [h('select', { 'aria-label': 'Filter', style: 'width:auto', on: { change: guard(async (e) => { S.filter = e.target.value; await loadMessages(true); }) } },
        [['', 'Semua'], ['unread', 'Belum dibaca'], ['starred', 'Berbintang']].map(([v, t]) => h('option', { value: v, selected: S.filter === v }, t))),
      h('button', { class: 'btn ghost icon', title: 'Segarkan', on: { click: guard(async () => { await api('POST', `/accounts/${S.acc}/sync?` + qs({ folder: S.folder })); await refreshFolders(S.accounts.find((a) => a.id === S.acc)); await loadMessages(true); renderSide(); }) } }, '⟳')]));
  const rows = h('div', { class: 'rows' });
  if (S.loading && !S.msgs.length) rows.append(h('div', { class: 'empty' }, 'Memuat…'));
  else if (!S.msgs.length) rows.append(h('div', { class: 'empty' }, S.q ? 'Tidak ada hasil.' : 'Folder ini kosong.'));
  for (const m of S.msgs) {
    const isSent = f?.special === 'sent' || f?.special === 'drafts';
    const open = () => draft(m) || openMsg(m);
    rows.append(h('div', { class: `row${m.seen ? '' : ' unread'}${S.sel === m.uid ? ' on' : ''}`, role: 'button', tabindex: 0, on: { click: (e) => { if (!e.target.closest('input,.star')) open(); }, keydown: (e) => e.key === 'Enter' && open() } },
      h('input', { type: 'checkbox', 'aria-label': 'Pilih', checked: !!m._sel, on: { change: (e) => { m._sel = e.target.checked; renderList(); } } }),
      h('div', { class: 'from' }, isSent ? `Kepada: ${m.to || '—'}` : who(m.from)),
      h('div', { class: 'date' }, (m.hasAttachments ? '📎 ' : '') + fmtDate(m.date)),
      h('button', { class: 'star' + (m.flagged ? ' on' : ''), 'aria-label': 'Bintang', on: { click: () => setFlags([m.uid], m.flagged ? [] : ['flagged'], m.flagged ? ['flagged'] : []) } }, m.flagged ? '★' : '☆'),
      h('div', { class: 'subj' }, m.subject || '(tanpa subjek)')));
  }
  if (S.hasMore) rows.append(h('div', { class: 'more' }, h('button', { class: 'btn', on: { click: guard(() => loadMessages(false)) } }, 'Muat lebih banyak')));
  el.append(rows);
}
const draft = (m) => { if (folderInfo()?.special !== 'drafts') return false; openDraft(m); return true; };

function renderRead() {
  const el = document.getElementById('read'); if (!el) return;
  const d = S.open;
  if (!d) return el.replaceChildren(h('div', { class: 'noread' }, 'Pilih surel untuk dibaca'));
  if (d.loading) return el.replaceChildren(h('div', { class: 'noread' }, 'Memuat…'));
  const m = S.msgs.find((x) => x.uid === d.uid) || { flagged: false };
  const other = curFolders().filter((f) => f.path !== S.folder);
  const iframe = d.html ? h('iframe', { sandbox: 'allow-same-origin allow-popups allow-popups-to-escape-sandbox', title: 'Isi surel', referrerpolicy: 'no-referrer' }) : null;
  el.replaceChildren(...[
    h('div', { class: 'actions' },
      h('button', { class: 'btn ghost mobnav', on: { click: () => document.querySelector('.shell').classList.remove('reading') } }, '← Kembali'),
      h('button', { class: 'btn', on: { click: () => composeWindow({ mode: 'reply', d }) } }, '↩ Balas'),
      h('button', { class: 'btn', on: { click: () => composeWindow({ mode: 'all', d }) } }, '↩↩ Balas semua'),
      h('button', { class: 'btn', on: { click: () => composeWindow({ mode: 'fwd', d }) } }, '↪ Teruskan'),
      h('button', { class: 'btn', on: { click: () => setFlags([d.uid], m.flagged ? [] : ['flagged'], m.flagged ? ['flagged'] : []) } }, m.flagged ? '★ Bintang' : '☆ Bintang'),
      h('button', { class: 'btn', on: { click: () => setFlags([d.uid], [], ['seen']) } }, 'Tandai belum dibaca'),
      h('select', { style: 'width:auto', 'aria-label': 'Pindahkan ke', on: { change: (e) => e.target.value && removeMsgs([d.uid], e.target.value) } }, h('option', { value: '' }, 'Pindahkan ke…'), other.map((f) => h('option', { value: f.path }, FOLDER_LABEL[f.special] || f.name))),
      h('button', { class: 'btn danger', on: { click: () => removeMsgs([d.uid]) } }, '🗑 Hapus')),
    h('div', { class: 'read-h' }, h('h1', {}, d.subject || '(tanpa subjek)'),
      h('div', { class: 'meta' }, h('b', {}, d.from.map(addr).join(', ')), ' · ', d.date ? new Date(d.date).toLocaleString() : ''),
      h('div', { class: 'meta' }, 'Kepada: ', d.to.map(addr).join(', ')), d.cc.length ? h('div', { class: 'meta' }, 'Cc: ', d.cc.map(addr).join(', ')) : null),
    d.blockedImages ? h('div', { class: 'banner' }, `${d.blockedImages} gambar eksternal diblokir untuk melindungi privasi.`, h('button', { class: 'btn', on: { click: () => openMsg(S.msgs.find((x) => x.uid === d.uid), true) } }, 'Tampilkan gambar')) : null,
    d.attachments.filter((a) => !a.inline).length ? h('div', { class: 'atts' }, d.attachments.filter((a) => !a.inline).map((a) => h('a', { class: 'att', href: `/api/accounts/${S.acc}/messages/${d.uid}/attachments/${a.index}?` + qs({ folder: S.folder }), download: a.filename }, '📎 ', a.filename, h('span', { class: 'muted' }, bytes(a.size))))) : null,
    h('div', { class: 'body' }, iframe || h('pre', {}, d.text || '(kosong)'))].filter(Boolean));
  if (iframe) {
    const fix = () => { try { const dd = iframe.contentDocument; iframe.style.height = dd.documentElement.scrollHeight + 8 + 'px'; } catch { /* ignore */ } };
    iframe.addEventListener('load', () => { fix(); iframe.contentDocument.querySelectorAll('img').forEach((i) => i.addEventListener('load', fix)); });
    iframe.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:0;font:14px/1.5 system-ui,sans-serif;color:#111;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 .5em;padding-left:1em;border-left:3px solid #ccd}</style>${d.html}`;
  }
}

// ---- auth -------------------------------------------------------------------
function authView() {
  let mode = 'login'; let choices = null; const box = h('div', { class: 'card' });
  const draw = (cfg) => {
    const akun = !!cfg.akun;
    const err = h('div', { class: 'muted', style: 'color:var(--danger);min-height:1.4em', role: 'alert' });
    const submit = async (e) => {
      e.preventDefault(); const f = e.target; err.textContent = '';
      const body = akun ? { username: f.username.value, password: f.password.value, account_key: f.account_key?.value } : { email: f.email.value, password: f.password.value };
      try { await api('POST', '/auth/' + mode, body); S.me = await api('GET', '/me'); await loadAll(); render(); connectEvents(); }
      catch (x) { if (x.data?.selection_required) { choices = x.data.accounts; draw(cfg); } else err.textContent = x.message; }
    };
    const idField = akun
      ? [h('label', { for: 'em' }, 'Username akun.7mit'), h('input', { id: 'em', type: 'text', name: 'username', required: true, autocomplete: 'username', placeholder: 'nama atau nama@7mit', autocapitalize: 'none', spellcheck: 'false' })]
      : [h('label', { for: 'em' }, 'Email'), h('input', { id: 'em', type: 'email', name: 'email', required: true, autocomplete: 'username' })];
    box.replaceChildren(...[h('div', { class: 'logo' }, h('i', {}, '✉'), '7 MIT Mail'),
      h('p', { class: 'muted' }, akun ? 'Masuk dengan akun.7mit Anda.' : mode === 'login' ? 'Masuk untuk membuka surel Anda.' : 'Buat akun baru.'),
      h('form', { on: { submit } }, ...idField,
        h('label', { for: 'pw' }, 'Kata sandi'), h('input', { id: 'pw', type: 'password', name: 'password', required: true, minlength: mode === 'register' ? 10 : 1, autocomplete: mode === 'login' ? 'current-password' : 'new-password' }),
        choices ? h('fieldset', { style: 'border:1px solid var(--line);border-radius:8px;margin:10px 0' }, h('legend', { class: 'muted' }, 'Pilih jenis akun'),
          choices.map((c, i) => h('label', { style: 'display:flex;gap:8px;align-items:center;color:var(--ink);font-size:inherit' }, h('input', { type: 'radio', name: 'account_key', value: c.account_key, required: true, checked: i === 0, style: 'width:auto' }), c.label || c.account_type))) : null,
        err, h('button', { class: 'btn primary', style: 'width:100%;justify-content:center;margin-top:8px' }, mode === 'login' ? 'Masuk' : 'Daftar')),
      cfg.akunUrl ? h('p', { class: 'muted' }, 'Lupa sandi atau belum punya akun? ', h('a', { href: cfg.akunUrl, rel: 'noopener' }, 'Buka akun.7mit')) : null,
      cfg.registration ? h('p', { class: 'muted' }, mode === 'login' ? 'Belum punya akun? ' : 'Sudah punya akun? ', h('a', { href: '#', on: { click: (e) => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(cfg); } } }, mode === 'login' ? 'Daftar' : 'Masuk')) : null].filter(Boolean));
  };
  fetch('/api/auth/config').then((r) => r.json()).then(draw).catch(() => draw({}));
  return h('div', { class: 'auth' }, box);
}
const logout = guard(async () => { await api('POST', '/auth/logout'); es?.close(); Object.assign(S, { me: null, accounts: [], folders: {}, acc: null, msgs: [], open: null }); render(); });

// ---- dialogs ------------------------------------------------------------------
function modal(title, body, footer, cls = '') {
  const close = () => scrim.remove();
  const scrim = h('div', { class: 'scrim', on: { mousedown: (e) => e.target === scrim && close() } },
    h('div', { class: 'modal ' + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'modal-h' }, h('span', {}, title), h('button', { class: 'btn ghost icon', 'aria-label': 'Tutup', on: { click: close } }, '✕')), h('div', { class: 'modal-b' }, body), footer ? h('div', { class: 'modal-f' }, footer) : null));
  document.body.append(scrim); scrim.querySelector('input,textarea,button.btn:not(.icon)')?.focus(); return { close, scrim };
}
const field = (label, input) => h('div', {}, h('label', {}, label), input);

function accountDialog(existing) {
  const v = existing || { imap: { port: 993, secure: 'ssl' }, smtp: { port: 587, secure: 'starttls' } };
  const f = {}; const mk = (name, props = {}) => (f[name] = h('input', { type: 'text', ...props }));
  const sel = (name, val) => (f[name] = h('select', {}, [['ssl', 'SSL/TLS'], ['starttls', 'STARTTLS'], ['none', 'Tanpa enkripsi (tidak disarankan)']].map(([k, t]) => h('option', { value: k, selected: val === k }, t))));
  const status = h('div', { class: 'muted', style: 'min-height:1.4em', role: 'status' });
  mk('label', { value: v.label || '' }); mk('email', { type: 'email', value: v.email || '' }); mk('displayName', { value: v.displayName ?? S.me?.name ?? '' });
  mk('ihost', { value: v.imap.host || '', placeholder: 'imap.contoh.org' }); mk('iport', { type: 'number', value: v.imap.port }); sel('isec', v.imap.secure); mk('iuser', { value: v.imap.user || '', placeholder: 'default: alamat email' }); mk('ipass', { type: 'password', autocomplete: 'new-password', placeholder: existing ? '(tidak diubah)' : '' });
  mk('shost', { value: v.smtp.host || '', placeholder: 'smtp.contoh.org' }); mk('sport', { type: 'number', value: v.smtp.port }); sel('ssec', v.smtp.secure); mk('suser', { value: v.smtp.user || '', placeholder: 'default: sama dengan IMAP' }); mk('spass', { type: 'password', autocomplete: 'new-password', placeholder: 'default: sama dengan IMAP' });
  f.isec.addEventListener('change', () => { if (!existing) f.iport.value = { ssl: 993, starttls: 143, none: 143 }[f.isec.value]; });
  f.ssec.addEventListener('change', () => { if (!existing) f.sport.value = { ssl: 465, starttls: 587, none: 25 }[f.ssec.value]; });
  f.email.addEventListener('blur', () => { const dom = f.email.value.split('@')[1]; if (dom && !f.ihost.value && !existing) { f.ihost.value = 'mail.' + dom; f.shost.value = 'mail.' + dom; } });
  const payload = () => ({ label: f.label.value || f.email.value, email: f.email.value, displayName: f.displayName.value,
    imap: { host: f.ihost.value.trim(), port: +f.iport.value, secure: f.isec.value, user: f.iuser.value.trim() || f.email.value, password: f.ipass.value },
    smtp: { host: f.shost.value.trim(), port: +f.sport.value, secure: f.ssec.value, user: f.suser.value.trim() || f.iuser.value.trim() || f.email.value, password: f.spass.value || f.ipass.value } });
  const run = (fn) => async () => { status.textContent = 'Menghubungi server…'; try { await fn(); } catch (e) { status.textContent = e.message + (e.data?.details ? ` — IMAP: ${e.data.details.imap}; SMTP: ${e.data.details.smtp}` : ''); status.style.color = 'var(--danger)'; } };
  const m = modal(existing ? 'Ubah kotak surel' : 'Tambah kotak surel eksternal', h('div', {},
    h('p', { class: 'muted' }, 'Sandi disimpan terenkripsi di server dan tidak pernah dikirim ke browser. Gunakan sandi aplikasi bila penyedia Anda mendukungnya.'),
    h('div', { class: 'grid2' }, field('Nama (label)', f.label), field('Alamat email', f.email)), field('Nama pengirim', f.displayName),
    h('h4', {}, 'Server masuk (IMAP)'), h('div', { class: 'grid2' }, field('Host', f.ihost), field('Port', f.iport), field('Enkripsi', f.isec), field('Username', f.iuser)), field('Sandi', f.ipass),
    h('h4', {}, 'Server keluar (SMTP)'), h('div', { class: 'grid2' }, field('Host', f.shost), field('Port', f.sport), field('Enkripsi', f.ssec), field('Username', f.suser)), field('Sandi', f.spass), status),
    [h('button', { class: 'btn', on: { click: run(async () => { const r = await api('POST', '/accounts/test', payload()); status.style.color = r.imap === 'ok' && r.smtp === 'ok' ? 'inherit' : 'var(--danger)'; status.textContent = `IMAP: ${r.imap} · SMTP: ${r.smtp}`; }) } }, 'Uji koneksi'),
      h('button', { class: 'btn primary', on: { click: run(async () => { const a = await api(existing ? 'PATCH' : 'POST', existing ? `/accounts/${existing.id}` : '/accounts', payload()); m.close(); S.acc = a.id; S.folder = 'INBOX'; await loadAll(); render(); toast('Tersimpan. Sinkronisasi dimulai…'); setTimeout(guard(async () => { await refreshFolders(a); await loadMessages(true); render(); }), 2500); }) } }, 'Simpan')], 'wide');
}

function settingsDialog() {
  const body = h('div'); let m;
  const tab = (name) => { body.replaceChildren(h('div', { class: 'tabs' }, [['accounts', 'Kotak surel'], ['sig', 'Tanda tangan'], ['prefs', 'Tampilan']].map(([k, t]) => h('button', { class: k === name ? 'on' : '', on: { click: () => tab(k) } }, t))), panes[name]()); };
  const panes = {
    accounts: () => h('div', { style: 'padding:8px 4px' }, S.accounts.map((a) => h('div', { class: 'item' }, h('div', {}, h('b', {}, a.label), h('div', { class: 'muted' }, `${a.email} · ${a.imap.host}`), a.lastError ? h('div', { style: 'color:var(--danger);font-size:13px' }, a.lastError) : null),
      h('button', { class: 'btn', on: { click: () => { m.close(); accountDialog(a); } } }, 'Ubah'),
      h('button', { class: 'btn danger', on: { click: guard(async () => { if (!confirm(`Hapus ${a.email} dari 7 MIT Mail? Surel di server asal tidak terhapus.`)) return; await api('DELETE', `/accounts/${a.id}`); m.close(); await loadAll(); render(); }) } }, 'Hapus'))),
      h('p', {}, h('button', { class: 'btn primary', on: { click: () => { m.close(); accountDialog(); } } }, '＋ Tambah kotak surel eksternal')), h('p', {}, h('button', { class: 'btn', on: { click: () => { m.close(); logout(); } } }, 'Keluar'))),
    sig: () => { const a = S.accounts.find((x) => x.id === S.acc) || S.accounts[0]; const sel = h('select', {}, S.accounts.map((x) => h('option', { value: x.id, selected: x.id === a.id }, x.email))); const ta = h('textarea', { rows: 6, placeholder: 'Salam hangat,\nNama' }, a.signature);
      sel.addEventListener('change', () => { ta.value = S.accounts.find((x) => x.id === +sel.value).signature; });
      return h('div', { style: 'padding:8px 4px' }, field('Untuk akun', sel), field('Tanda tangan (teks)', ta), h('p', {}, h('button', { class: 'btn primary', on: { click: guard(async () => { await api('PUT', `/accounts/${sel.value}/signature`, { signature: ta.value }); S.accounts.find((x) => x.id === +sel.value).signature = ta.value; toast('Tersimpan'); }) } }, 'Simpan'))); },
    prefs: () => { const s = S.settings; const save = guard(async () => { S.settings = await api('PUT', '/settings', s); applyTheme(); }); const chk = (k, t) => h('p', {}, h('label', { style: 'display:flex;gap:8px;align-items:center;color:var(--ink);font-size:inherit' }, h('input', { type: 'checkbox', style: 'width:auto', checked: !!s[k], on: { change: (e) => { s[k] = e.target.checked; if (k === 'notifications' && e.target.checked && 'Notification' in window) Notification.requestPermission(); save(); } } }), t));
      return h('div', { style: 'padding:8px 4px' }, field('Tema', h('select', { on: { change: (e) => { s.theme = e.target.value; save(); } } }, [['', 'Ikuti sistem'], ['light', 'Terang'], ['dark', 'Gelap']].map(([v, t]) => h('option', { value: v, selected: (s.theme || '') === v }, t)))),
        field('Surel per halaman', h('select', { on: { change: (e) => { s.pageSize = +e.target.value; save(); } } }, [25, 50, 100].map((n) => h('option', { value: n, selected: (s.pageSize || 50) === n }, n)))),
        chk('loadRemoteImages', 'Selalu muat gambar eksternal (kurang privat)'), chk('notifications', 'Notifikasi browser untuk surel baru')); },
  };
  m = modal('Pengaturan', body, null, 'wide'); tab('accounts');
}

function contactsDialog() {
  const body = h('div'); const draw = guard(async (q = '') => {
    const list = await api('GET', '/contacts?' + qs({ q }));
    const name = h('input', { type: 'text', placeholder: 'Nama' }), email = h('input', { type: 'email', placeholder: 'email@contoh.org' });
    body.replaceChildren(h('div', { style: 'display:flex;gap:6px;margin:10px 0' }, name, email, h('button', { class: 'btn primary', on: { click: guard(async () => { await api('POST', '/contacts', { name: name.value, email: email.value }); draw(q); }) } }, 'Tambah')),
      h('input', { type: 'search', placeholder: 'Cari kontak…', value: q, on: { input: (e) => draw(e.target.value) } }),
      list.length ? list.map((c) => h('div', { class: 'item' }, h('div', {}, h('b', {}, c.name || c.email), h('div', { class: 'muted' }, c.email)), h('button', { class: 'btn', on: { click: () => composeWindow({ to: c.email }) } }, 'Tulis'), h('button', { class: 'btn danger', on: { click: guard(async () => { await api('DELETE', `/contacts/${c.id}`); draw(q); }) } }, 'Hapus'))) : h('div', { class: 'empty' }, 'Belum ada kontak. Penerima surel yang Anda kirim ditambahkan otomatis.'));
  }); modal('Kontak', body); draw();
}

// ---- compose ------------------------------------------------------------------
let contactCache = [];
function composeWindow(o = {}) {
  let acc = S.accounts.find((a) => a.id === S.acc) || S.accounts[0]; const d = o.d; const files = [];
  let to = o.to || '', cc = '', subject = o.subject || '', inReplyTo, references, draftUid = o.draftUid, quote = '', replyToUid;
  const reNeeded = (p, s) => (new RegExp(`^${p}:`, 'i').test(s) ? s : `${p}: ${s}`);
  if (d) {
    const dateStr = d.date ? new Date(d.date).toLocaleString() : '';
    const orig = `<br><br><blockquote style="margin:0 0 0 .5em;padding-left:1em;border-left:3px solid #ccd">${d.html ? d.html : esc(d.text).replace(/\n/g, '<br>')}</blockquote>`;
    if (o.mode === 'fwd') { subject = reNeeded('Fwd', d.subject); quote = `<br><br>---------- Surel terusan ----------<br>Dari: ${esc(d.from.map(addr).join(', '))}<br>Tanggal: ${esc(dateStr)}<br>Subjek: ${esc(d.subject)}<br>${d.html || esc(d.text).replace(/\n/g, '<br>')}`; }
    else {
      subject = reNeeded('Re', d.subject); to = (d.replyTo[0] ? d.replyTo : d.from).map(addr).join(', ');
      if (o.mode === 'all') cc = [...d.to, ...d.cc].filter((x) => x.address.toLowerCase() !== acc.email.toLowerCase()).map(addr).join(', ');
      inReplyTo = d.messageId; references = [...d.references, d.messageId].filter(Boolean); replyToUid = d.uid;
      quote = `<br><br>Pada ${esc(dateStr)}, ${esc(d.from.map(addr).join(', '))} menulis:${orig}`;
    }
  }
  if (o.html != null) quote = o.html;
  const sig = acc.signature ? `<br><br>-- <br>${esc(acc.signature).replace(/\n/g, '<br>')}` : '';
  const inp = (v, ph, list) => h('input', { type: 'text', value: v, placeholder: ph, autocomplete: 'off', list });
  const iTo = inp(to, 'email@contoh.org, …', 'dl-contacts'), iCc = inp(cc, '', 'dl-contacts'), iBcc = inp('', '', 'dl-contacts'), iSub = inp(subject, '');
  const dl = h('datalist', { id: 'dl-contacts' });
  iTo.addEventListener('input', guard(async () => { const last = iTo.value.split(/[,;]/).pop().trim(); if (last.length < 2) return; contactCache = await api('GET', '/contacts?' + qs({ q: last })); dl.replaceChildren(...contactCache.map((c) => h('option', { value: iTo.value.replace(/[^,;]*$/, '').trimEnd() + (iTo.value.includes(',') || iTo.value.includes(';') ? ' ' : '') + (c.name ? `${c.name} <${c.email}>` : c.email) }))); }));
  const ed = h('div', { class: 'ed', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Isi surel' }); ed.innerHTML = '<br>' + sig + quote;
  // quoted original is already sanitized server-side; re-sanitize the composed HTML defensively on the client
  const clean = (html) => { const t = document.createElement('template'); t.innerHTML = html; t.content.querySelectorAll('script,iframe,object,embed,form,style,link,meta').forEach((n) => n.remove()); t.content.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => { if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name); })); return t.innerHTML; };
  ed.innerHTML = clean(ed.innerHTML);
  const attBox = h('div'); const drawAtt = () => attBox.replaceChildren(...files.map((f, i) => h('span', { class: 'chip' }, f.name, ' ', h('span', { class: 'muted' }, bytes(f.size)), h('button', { 'aria-label': 'Hapus lampiran', on: { click: () => { files.splice(i, 1); drawAtt(); } } }, '✕'))));
  const picker = h('input', { type: 'file', multiple: true, class: 'hidden', on: { change: () => { for (const f of picker.files) { if (f.size > 25 * 1048576) toast(`${f.name} melebihi 25 MB`, true); else files.push(f); } picker.value = ''; drawAtt(); } } });
  const cmd = (c, v) => { ed.focus(); document.execCommand(c, false, v); };
  const status = h('span', { class: 'muted' });
  const build = () => { const html = clean(ed.innerHTML); const fd = new FormData(); fd.append('payload', JSON.stringify({ to: iTo.value, cc: iCc.value, bcc: iBcc.value, subject: iSub.value, html, text: ed.innerText, inReplyTo, references, replyToUid, draftUid })); files.forEach((f) => fd.append('files', f, f.name)); return fd; };
  const win = h('div', { class: 'cwin' });
  const close = () => { win.remove(); };
  const send = h('button', { class: 'btn primary', on: { click: async () => { send.disabled = true; status.textContent = 'Mengirim…'; try { const r = await api('POST', `/accounts/${acc.id}/send`, build()); close(); toast(r.savedToSent ? 'Terkirim' : 'Terkirim (salinan tidak tersimpan di Terkirim)'); if (S.acc === acc.id) { await refreshFolders(acc); if (folderInfo()?.special === 'sent') await loadMessages(true); render(); } } catch (e) { send.disabled = false; status.textContent = ''; toast(e.message, true); } } } }, 'Kirim');
  const saveDraft = h('button', { class: 'btn', on: { click: guard(async () => { const r = await api('POST', `/accounts/${acc.id}/drafts`, build()); draftUid = r.uid || undefined; status.textContent = 'Draf tersimpan'; await refreshFolders(acc); renderSide(); }) } }, 'Simpan draf');
  const fromSel = h('select', { 'aria-label': 'Dari', style: 'border:0', on: { change: () => { acc = S.accounts.find((a) => a.id === +fromSel.value); } } }, S.accounts.map((a) => h('option', { value: a.id, selected: a.id === acc.id }, `${a.displayName ? a.displayName + ' ' : ''}<${a.email}>`)));
  win.append(h('div', { class: 'modal' }, h('div', { class: 'modal-h' }, h('span', {}, 'Surel baru'), h('button', { class: 'btn ghost icon', 'aria-label': 'Tutup', on: { click: () => { if (!ed.innerText.trim() && !iTo.value || confirm('Tutup tanpa mengirim? Perubahan yang belum disimpan akan hilang.')) close(); } } }, '✕')),
    h('div', { class: 'modal-b' }, dl, h('div', { class: 'cf' }, h('span', {}, 'Dari'), fromSel), h('div', { class: 'cf' }, h('span', {}, 'Kepada'), iTo), h('div', { class: 'cf' }, h('span', {}, 'Cc'), iCc), h('div', { class: 'cf' }, h('span', {}, 'Bcc'), iBcc), h('div', { class: 'cf' }, h('span', {}, 'Subjek'), iSub),
      h('div', { class: 'tb' }, [['B', 'bold'], ['I', 'italic'], ['U', 'underline'], ['•', 'insertUnorderedList'], ['1.', 'insertOrderedList']].map(([t, c]) => h('button', { type: 'button', 'aria-label': c, on: { mousedown: (e) => e.preventDefault(), click: () => cmd(c) } }, t)),
        h('button', { type: 'button', on: { mousedown: (e) => e.preventDefault(), click: () => { const u = prompt('Alamat tautan (https://…)'); if (u && /^(https?:|mailto:)/i.test(u)) cmd('createLink', u); } } }, '🔗')), ed, attBox),
    h('div', { class: 'modal-f' }, send, h('button', { class: 'btn', on: { click: () => picker.click() } }, '📎 Lampirkan'), picker, saveDraft, status)));
  document.body.append(win); (to ? ed : iTo).focus();
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const openDraft = guard(async (m) => {
  const d = await api('GET', `/accounts/${S.acc}/messages/${m.uid}?` + qs({ folder: S.folder, markRead: 0, images: 1 }));
  composeWindow({ to: d.to.map(addr).join(', '), subject: d.subject, html: d.html || esc(d.text).replace(/\n/g, '<br>'), draftUid: m.uid });
});

document.addEventListener('keydown', (e) => {
  if (!S.me || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || e.metaKey || e.ctrlKey) return;
  if (e.key === 'c') { e.preventDefault(); composeWindow(); }
  if (e.key === '/') { e.preventDefault(); document.querySelector('.search input')?.focus(); }
  if ((e.key === 'j' || e.key === 'k') && S.msgs.length) { const i = S.msgs.findIndex((m) => m.uid === S.sel); const n = S.msgs[Math.max(0, Math.min(S.msgs.length - 1, i + (e.key === 'j' ? 1 : -1)))]; openMsg(n); }
  if (e.key === '#' && S.sel) removeMsgs([S.sel]);
});
boot();

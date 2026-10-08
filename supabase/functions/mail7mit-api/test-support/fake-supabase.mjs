// Minimal in-memory stand-in for the supabase-js query builder (eq / maybeSingle / single / insert / upsert / delete / update).
export const DB = {};
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.payload = null; }
  select() { return this; } order() { return this; } limit() { return this; }
  eq(k, v) { this.f.push((r) => r[k] === v); return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; } upsert(p) { this.op = 'upsert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; } delete() { this.op = 'delete'; return this; }
  rows() { return (DB[this.t] ||= []).filter((r) => this.f.every((f) => f(r))); }
  run() {
    const T = (DB[this.t] ||= []);
    if (this.op === 'select') return { data: this.rows(), error: null };
    if (this.op === 'insert') { const row = { id: crypto.randomUUID(), ...this.payload }; T.push(row); return { data: [row], error: null }; }
    if (this.op === 'upsert') { T.push({ ...this.payload }); return { data: [], error: null }; }
    if (this.op === 'update') { this.rows().forEach((r) => Object.assign(r, this.payload)); return { data: [], error: null }; }
    if (this.op === 'delete') { for (const r of this.rows()) T.splice(T.indexOf(r), 1); return { data: [], error: null }; }
  }
  maybeSingle() { const r = this.run(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); }
  single() { const r = this.run(); return Promise.resolve(r.data[0] ? { data: r.data[0], error: null } : { data: null, error: { message: 'none' } }); }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
}
export const createClient = () => ({ from: (t) => new Q(t) });

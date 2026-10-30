// Storage for ReleaseReady.
// With SUPABASE_URL and SUPABASE_KEY set, data lives in Supabase (Postgres) through its REST API.
// Without them, data lives in data/local-db.json, so the app also runs with no database account.
// Every row belongs to one test cycle (the "cycle" column). The "cycles" table lists the test cycles.
const fs = require('fs');
const path = require('path');

// table name -> primary key column (the real key is cycle + this column)
const TABLES = {
  testers: 'id', steps: 'id', results: 'id', feedback: 'id', messages: 'id',
  notifications: 'id', decisions: 'feedback_id', group_decisions: 'anchor_id',
  tickets: 'key', drafts: 'problem_id', settings: 'key', chat_messages: 'id'
};
const CYCLE_FIELDS = ['id', 'name', 'app', 'status', 'created', 'ended', 'stats', 'position', 'people'];
const okCycle = c => typeof c === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(c);

function supabaseStore(url, key) {
  const base = url.replace(/\/$/, '') + '/rest/v1/';
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key; // legacy anon key is a JWT
  const call = async (method, pathAndQuery, body, extra = {}) => {
    const res = await fetch(base + pathAndQuery, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`Supabase ${method} ${pathAndQuery.split('?')[0]} failed: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json().catch(() => null);
  };
  // PostgREST "in" list: values in double quotes, with " and \ escaped
  const inList = ids => '(' + ids.map(v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')';
  const strip = rows => (rows || []).map(r => { const { cycle, created_at, updated_at, ...rest } = r; void cycle; void created_at; void updated_at; return rest; });
  return {
    kind: 'supabase',
    async listCycles() {
      const [cs, ts] = await Promise.all([call('GET', 'cycles?select=*&order=position.asc'), call('GET', 'testers?select=name,cycle,position&order=position.asc')]);
      return (cs || []).map(c => ({ ...c, people: (ts || []).filter(t => t.cycle === c.id).map(t => t.name) }));   // who is testing each cycle
    },
    // Notifications for one person (the UAT manager or a tester) across every test cycle
    async notes(to) { return (await call('GET', `notifications?select=*&recipient=eq.${encodeURIComponent(to)}&order=position.desc`)) || []; },
    async markRead(items) {
      const by = {}; items.forEach(i => (by[i.cycle] = by[i.cycle] || []).push(i.id));
      for (const [c, ids] of Object.entries(by)) await call('PATCH', `notifications?cycle=eq.${encodeURIComponent(c)}&id=in.${encodeURIComponent(inList(ids))}`, { is_read: true }, { Prefer: 'return=minimal' });
    },
    async saveCycle(c) { await call('POST', 'cycles?on_conflict=id', [c], { Prefer: 'resolution=merge-duplicates,return=minimal' }); },
    async loadAll(cycle) {
      const out = {};
      await Promise.all(Object.keys(TABLES).map(async t => { out[t] = strip(await call('GET', `${t}?select=*&cycle=eq.${encodeURIComponent(cycle)}`)); }));   // all tables at once
      return out;
    },
    async sync(cycle, { upsert = {}, del = {} }) {
      for (const [t, rows] of Object.entries(upsert)) {
        if (!TABLES[t] || !rows.length) continue;
        await call('POST', `${t}?on_conflict=cycle,${TABLES[t]}`, rows.map(r => ({ ...r, cycle })), { Prefer: 'resolution=merge-duplicates,return=minimal' });
      }
      for (const [t, ids] of Object.entries(del)) {
        if (!TABLES[t] || !ids.length) continue;
        for (let i = 0; i < ids.length; i += 100) {
          await call('DELETE', `${t}?cycle=eq.${encodeURIComponent(cycle)}&${TABLES[t]}=in.${encodeURIComponent(inList(ids.slice(i, i + 100)))}`, null, { Prefer: 'return=minimal' });
        }
      }
    },
    async reset() {
      for (const [t, pk] of Object.entries(TABLES)) await call('DELETE', `${t}?${pk}=not.is.null`, null, { Prefer: 'return=minimal' });
      await call('DELETE', 'cycles?id=not.is.null', null, { Prefer: 'return=minimal' });
    }
  };
}

function localStore(file) {
  const read = () => {
    let d; try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { d = {}; }
    if (!d.cycles) {   // a file from before test cycles: its data becomes the first test cycle
      const old = {}; let any = false;
      for (const t of Object.keys(TABLES)) { old[t] = d[t] || {}; if (Object.keys(old[t]).length) any = true; }
      d = { cycles: {}, data: {} };
      if (any) { const app = ((old.settings || {}).appName || {}).value || ''; d.cycles.c1 = { id: 'c1', name: 'Test cycle 1', app, status: ((old.settings || {}).ended || {}).value ? 'completed' : 'active', created: '', ended: null, stats: null, position: 1 }; d.data.c1 = old; }
    }
    return d;
  };
  const write = data => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };
  return {
    kind: 'local',
    async listCycles() { const d = read(); return Object.values(d.cycles).sort((a, b) => (a.position || 0) - (b.position || 0)).map(c => ({ ...c, people: Object.values(((d.data[c.id] || {}).testers) || {}).sort((a, b) => a.position - b.position).map(t => t.name) })); },
    async notes(to) { const d = read(), out = []; Object.entries(d.data).forEach(([cy, cd]) => Object.values(cd.notifications || {}).forEach(n => { if (n.recipient === to) out.push({ ...n, cycle: cy }); })); return out.sort((a, b) => (b.position || 0) - (a.position || 0)); },
    async markRead(items) { const d = read(); items.forEach(i => { const n = ((d.data[i.cycle] || {}).notifications || {})[i.id]; if (n) n.is_read = true; }); write(d); },
    async saveCycle(c) { const d = read(); d.cycles[c.id] = { ...(d.cycles[c.id] || {}), ...c }; write(d); },
    async loadAll(cycle) {
      const d = read(), cd = d.data[cycle] || {}, out = {};
      for (const t of Object.keys(TABLES)) out[t] = Object.values(cd[t] || {});
      return out;
    },
    async sync(cycle, { upsert = {}, del = {} }) {
      const d = read(), cd = d.data[cycle] = d.data[cycle] || {};
      for (const [t, rows] of Object.entries(upsert)) {
        if (!TABLES[t]) continue;
        cd[t] = cd[t] || {};
        for (const r of rows) cd[t][r[TABLES[t]]] = { ...(cd[t][r[TABLES[t]]] || {}), ...r };
      }
      for (const [t, ids] of Object.entries(del)) {
        if (!TABLES[t] || !cd[t]) continue;
        for (const id of ids) delete cd[t][id];
      }
      write(d);
    },
    async reset() { write({ cycles: {}, data: {} }); }
  };
}

function createStore() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
  if (url && key) return supabaseStore(url, key);
  return localStore(path.join(__dirname, '..', 'data', 'local-db.json'));
}

module.exports = { createStore, TABLES, CYCLE_FIELDS, okCycle };

// Storage for ReleaseReady.
// With SUPABASE_URL and SUPABASE_KEY set, data lives in Supabase (Postgres) through its REST API.
// Without them, data lives in data/local-db.json, so the app also runs with no database account.
const fs = require('fs');
const path = require('path');

// table name -> primary key column
const TABLES = {
  testers: 'id', steps: 'id', results: 'id', feedback: 'id', messages: 'id',
  notifications: 'id', decisions: 'feedback_id', group_decisions: 'anchor_id',
  tickets: 'key', drafts: 'problem_id', settings: 'key'
};

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
  return {
    kind: 'supabase',
    async loadAll() {
      const out = {};
      for (const t of Object.keys(TABLES)) out[t] = await call('GET', `${t}?select=*`);
      return out;
    },
    async sync({ upsert = {}, del = {} }) {
      for (const [t, rows] of Object.entries(upsert)) {
        if (!TABLES[t] || !rows.length) continue;
        await call('POST', `${t}?on_conflict=${TABLES[t]}`, rows, { Prefer: 'resolution=merge-duplicates,return=minimal' });
      }
      for (const [t, ids] of Object.entries(del)) {
        if (!TABLES[t] || !ids.length) continue;
        for (let i = 0; i < ids.length; i += 100) {
          await call('DELETE', `${t}?${TABLES[t]}=in.${encodeURIComponent(inList(ids.slice(i, i + 100)))}`, null, { Prefer: 'return=minimal' });
        }
      }
    },
    async reset() {
      for (const [t, pk] of Object.entries(TABLES)) await call('DELETE', `${t}?${pk}=not.is.null`, null, { Prefer: 'return=minimal' });
    }
  };
}

function localStore(file) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const write = data => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };
  return {
    kind: 'local',
    async loadAll() {
      const d = read(), out = {};
      for (const t of Object.keys(TABLES)) out[t] = Object.values(d[t] || {});
      return out;
    },
    async sync({ upsert = {}, del = {} }) {
      const d = read();
      for (const [t, rows] of Object.entries(upsert)) {
        if (!TABLES[t]) continue;
        d[t] = d[t] || {};
        for (const r of rows) d[t][r[TABLES[t]]] = { ...(d[t][r[TABLES[t]]] || {}), ...r };
      }
      for (const [t, ids] of Object.entries(del)) {
        if (!TABLES[t] || !d[t]) continue;
        for (const id of ids) delete d[t][id];
      }
      write(d);
    },
    async reset() { write({}); }
  };
}

function createStore() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
  if (url && key) return supabaseStore(url, key);
  return localStore(path.join(__dirname, '..', 'data', 'local-db.json'));
}

module.exports = { createStore, TABLES };

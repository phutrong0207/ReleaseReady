// ReleaseReady server: serves the app, keeps the AI key secret, and stores data.
// No npm packages needed: Node.js 18 or newer.
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env (KEY=value lines) before anything reads process.env
(function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const { createStore, CYCLE_FIELDS, okCycle } = require('./server/db');
const ai = require('./server/ai');
const { checkPrompt, draftPrompt } = require('./server/prompts');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const store = createStore();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const aiStatus = e => ({ ai_off: 503, ai_auth: 503, rate_limited: 429, invalid_json: 502, refused: 422, empty_completion: 502 }[e.code] || 502);

async function api(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, { ai: ai.hasKey() ? 'gemini' : 'none', db: store.kind });
    }
    if (req.method === 'GET' && url.pathname === '/api/cycles') {
      return send(res, 200, { cycles: await store.listCycles() });
    }
    if (req.method === 'POST' && url.pathname === '/api/cycles/save') {
      const b = await readBody(req, 100 * 1024), c = {};
      if (!b.cycle || !okCycle(b.cycle.id)) return send(res, 400, { code: 'bad_cycle', message: 'A test cycle needs a valid id.' });
      CYCLE_FIELDS.forEach(k => { if (k in b.cycle) c[k] = b.cycle[k]; });
      await store.saveCycle(c);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/notes') {
      const to = url.searchParams.get('to'); if (!to) return send(res, 400, { code: 'bad_request', message: 'Whose notifications?' });
      return send(res, 200, { notes: await store.notes(to) });
    }
    if (req.method === 'POST' && url.pathname === '/api/notes/read') {
      const b = await readBody(req, 200 * 1024), items = (b.items || []).filter(i => i && okCycle(i.cycle) && typeof i.id === 'string');
      if (items.length) await store.markRead(items);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/data') {
      const cycle = url.searchParams.get('cycle');
      if (!okCycle(cycle)) return send(res, 400, { code: 'bad_cycle', message: 'Which test cycle?' });
      return send(res, 200, { tables: await store.loadAll(cycle) });
    }
    if (req.method === 'POST' && url.pathname === '/api/data/sync') {
      const b = await readBody(req);
      if (!okCycle(b.cycle)) return send(res, 400, { code: 'bad_cycle', message: 'Which test cycle?' });
      await store.sync(b.cycle, { upsert: b.upsert || {}, del: b.delete || {} });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/data/reset') {
      await store.reset();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/check-comment') {
      const b = await readBody(req, 200 * 1024);
      try { return send(res, 200, await ai.askJSON(checkPrompt(b), 'check')); }
      catch (e) { return send(res, aiStatus(e), { code: e.code || 'upstream_error', message: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/draft-ticket') {
      const b = await readBody(req, 500 * 1024);
      const ctl = new AbortController();
      req.on('close', () => { if (!res.writableEnded) ctl.abort(); });
      try { return send(res, 200, await ai.askJSON(draftPrompt(b), 'draft', ctl.signal)); }
      catch (e) { return send(res, aiStatus(e), { code: e.name === 'AbortError' ? 'cancelled' : (e.code || 'upstream_error'), message: e.message }); }
    }
    send(res, 404, { code: 'not_found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { code: 'server_error', message: e.message });
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, async () => {
  console.log(`ReleaseReady is running at http://localhost:${PORT}`);
  console.log(`Database: ${store.kind === 'supabase' ? 'Supabase' : 'local file (data/local-db.json)'}`);
  if (ai.hasKey()) {
    const m = await ai.models();
    console.log(`AI: Gemini (comment check: ${m.check}, ticket drafts: ${m.draft})`);
  } else console.log('AI: off (no GEMINI_API_KEY). The basic rule check is used instead.');
});

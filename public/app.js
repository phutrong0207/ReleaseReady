/* ReleaseReady: UAT feedback app.
   The page keeps the working state in memory (S), saves every change to the server (which stores it in Supabase),
   and asks the server for the two AI functions (comment check, ticket drafter). */
(function () {
'use strict';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wc = t => (t || '').trim().split(/\s+/).filter(Boolean).length;
const nowTime = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const stamp = () => new Date().toISOString();
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ENV = (() => {
  const ua = navigator.userAgent; let b = 'Browser', m;
  if ((m = ua.match(/Edg\/(\d+)/))) b = 'Edge ' + m[1];
  else if ((m = ua.match(/OPR\/(\d+)/))) b = 'Opera ' + m[1];
  else if ((m = ua.match(/Firefox\/(\d+)/))) b = 'Firefox ' + m[1];
  else if ((m = ua.match(/Chrome\/(\d+)/))) b = 'Chrome ' + m[1];
  else if ((m = ua.match(/Version\/(\d+).*Safari/))) b = 'Safari ' + m[1];
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return b + ' · ' + os;
})();

/* ===================== STATE ===================== */
let CFG = { ai: 'none', db: 'local' };
let CY = { list: [], cur: null, me: null, notes: [], openG: {} };   // every test cycle, the open one, the tester who is logged in, and their notifications
const curCycle = () => CY.list.find(c => c.id === CY.cur) || null;
const cycleDone = () => S.boot === 'ready' && (curCycle() || {}).status === 'completed';
let S;
function freshState() {
  return {
    boot: 'loading', setup: { n: 3, names: ['', '', ''], app: '', cname: '', err: '' },
    // saved
    appName: '', testers: [], script: [], res: {}, notes: [], completed: {}, groups: {},
    sel: {}, mem: {}, known: {}, knownT: {}, idea: {}, checked: {}, sent: {}, fix: {},
    drafts: {}, ptk: {}, tickets: [], nextKey: 1, seq: 0, npos: 0, sumSent: {}, appr: {}, chats: {}, ended: null,
    // view only
    role: 'manager', me: null, ttab: 'script', sec: 1, mtester: null, focus: null, openTh: {}, ui: {}, ux: {},
    ai: {}, aiOff: false, drafting: {}, pending: {}, open: null, openTicket: null, hideGuide: {}, openStep: null,
    confirmReset: false, saveState: 'saved', renderLater: false, confirm: null, openChat: {}, focusInput: null, panel: null, panelDraft: {}, panelImg: {}, zoom: null, ue: {}, confirmEnd: false, f3: 'all', hide3: {}, htab: null, inboxOpen: false
  };
}
S = freshState();
const testers = () => S.testers.map(t => t.name);
const step = s => S.script.find(x => x.step === s) || { step: s, scen: 'Removed step', screen: '', act: 'Removed step', exp: '', who: [] };
const assigned = t => S.script.filter(s => s.who.includes(t));
const isDone = (t, s) => !!(S.res[t + '|' + s] && S.res[t + '|' + s].saved);
const appName = () => S.appName || 'the app being tested';
const epics = () => [...new Set(S.script.map(s => s.scen)), 'UX improvements'];

/* ===================== SAVING (diff sync to the server) ===================== */
const TABLES = ['testers', 'steps', 'results', 'feedback', 'messages', 'notifications', 'decisions', 'group_decisions', 'tickets', 'drafts', 'settings', 'chat_messages'];
let LAST = {}, syncTimer = null, syncing = false;
function snapshot() {
  const o = {}; TABLES.forEach(t => o[t] = {});
  S.testers.forEach((t, i) => o.testers[t.name] = { id: t.name, name: t.name, position: i });
  S.script.forEach((s, i) => o.steps[s.step] = { id: s.step, scenario: s.scen, screen: s.screen || '', action: s.act, expected: s.exp, position: i, assigned: s.who.slice() });
  Object.entries(S.res).forEach(([k, r]) => {
    if (!r.saved) return;
    const [tester, st] = k.split('|');
    o.results[k] = { id: k, tester, step: st, result: r.r, screenshot: !!r.shot, env: r.env || '', screenshot_data: r.shot || null };
    r.items.forEach(i => {
      o.feedback[i.id] = { id: i.id, result_id: k, tester, step: st, category: i.cat, body: i.text, is_primary: !!i.primary, seq: i.seq || 0, needs_detail: !!i.thin, edited_at: i.edited || null };
      i.thread.forEach((m, n) => o.messages[m.id] = { id: m.id, feedback_id: i.id, sender: m.from, body: m.text, sent_at: m.at, position: n, image: m.img || null });
    });
  });
  S.notes.forEach(n => o.notifications[n.id] = { id: n.id, recipient: n.to, kind: n.kind, body: n.text, ref: n.ref || {}, sent_at: n.at, is_read: !!n.read, position: n.pos || 0 });
  const ids = new Set([...Object.keys(S.sel), ...Object.keys(S.mem), ...Object.keys(S.known), ...Object.keys(S.idea), ...Object.keys(S.checked), ...Object.keys(S.sent), ...Object.keys(S.fix), ...Object.keys(S.appr)]);
  ids.forEach(id => o.decisions[id] = { feedback_id: id, member: S.mem[id] || null, known: S.known[id] || null, known_ticket: S.knownT[id] || null, idea: S.idea[id] || null, selected: S.sel[id] === undefined ? null : !!S.sel[id], checked: !!S.checked[id], sent_text: S.sent[id] || null, needs_correction: !!S.fix[id], approved: S.appr[id] || null });
  Object.entries(S.chats).forEach(([pid, list]) => list.forEach((m, n) => o.chat_messages[m.id] = { id: m.id, problem_id: pid, sender: m.from, body: m.text, sent_at: m.at, position: n, image: m.img || null }));
  Object.entries(S.groups).forEach(([a, m]) => { if (m === true || m === false) o.group_decisions[a] = { anchor_id: a, merged: m }; });
  const pidOf = {}; Object.entries(S.ptk).forEach(([pid, key]) => pidOf[key] = pid);
  S.tickets.forEach(t => o.tickets[t.key] = { key: t.key, summary: t.summary, type: t.type, priority: t.priority, epic: t.epic, status: t.status, source: t.src, links: t.links || 0, reopened: !!t.reopened, problem_id: pidOf[t.key] || null, details: t.d || null, evidence: t.ev || null, position: t.seq || 0 });
  Object.entries(S.drafts).forEach(([pid, f]) => o.drafts[pid] = { problem_id: pid, fields: f });
  const set = { appName: S.appName, completed: S.completed, nextKey: S.nextKey, seq: S.seq, npos: S.npos, sumSent: S.sumSent, ended: S.ended };
  Object.entries(set).forEach(([k, v]) => o.settings[k] = { key: k, value: v });
  return o;
}
function hydrate(tb) {
  const by = (rows, f) => (rows || []).slice().sort((a, b) => (a[f] || 0) - (b[f] || 0));
  const st = {}; (tb.settings || []).forEach(r => st[r.key] = r.value);
  S.appName = st.appName || ''; S.completed = st.completed || {}; S.nextKey = st.nextKey || 1; S.seq = st.seq || 0; S.npos = st.npos || 0; S.sumSent = st.sumSent || {}; S.ended = st.ended || null;
  S.testers = by(tb.testers, 'position').map(r => ({ name: r.name }));
  S.script = by(tb.steps, 'position').map(r => ({ step: r.id, scen: r.scenario, screen: r.screen || '', act: r.action, exp: r.expected, who: r.assigned || [] }));
  const msgs = {}; by(tb.messages, 'position').forEach(m => (msgs[m.feedback_id] = msgs[m.feedback_id] || []).push({ id: m.id, from: m.sender, text: m.body, at: m.sent_at, img: m.image || '' }));
  const items = {}; by(tb.feedback, 'seq').forEach(f => (items[f.result_id] = items[f.result_id] || []).push({ id: f.id, cat: f.category, text: f.body, primary: f.is_primary, seq: f.seq, thin: !!f.needs_detail, edited: f.edited_at || null, thread: msgs[f.id] || [] }));
  S.res = {}; (tb.results || []).forEach(r => S.res[r.id] = { r: r.result, shot: r.screenshot_data || '', env: r.env || '', saved: true, items: (items[r.id] || []).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || a.seq - b.seq) });
  S.notes = (tb.notifications || []).map(n => ({ id: n.id, to: n.recipient, kind: n.kind, text: n.body, ref: n.ref || {}, at: n.sent_at, read: n.is_read, pos: n.position })).sort((a, b) => b.pos - a.pos);
  S.sel = {}; S.mem = {}; S.known = {}; S.knownT = {}; S.idea = {}; S.checked = {}; S.sent = {}; S.fix = {}; S.appr = {};
  (tb.decisions || []).forEach(d => {
    const id = d.feedback_id;
    if (d.selected !== null && d.selected !== undefined) S.sel[id] = d.selected;
    if (d.member) S.mem[id] = d.member; if (d.known) S.known[id] = d.known; if (d.known_ticket) S.knownT[id] = d.known_ticket;
    if (d.idea) S.idea[id] = d.idea; if (d.checked) S.checked[id] = true; if (d.sent_text) S.sent[id] = d.sent_text; if (d.needs_correction) S.fix[id] = true; if (d.approved) S.appr[id] = d.approved;
  });
  S.groups = {}; (tb.group_decisions || []).forEach(g => { if (g.merged === true || g.merged === false) S.groups[g.anchor_id] = g.merged; });
  S.ptk = {}; S.tickets = by(tb.tickets, 'position').reverse().map(t => { if (t.problem_id) S.ptk[t.problem_id] = t.key; return { key: t.key, summary: t.summary, type: t.type, priority: t.priority, epic: t.epic, status: t.status, src: t.source, links: t.links, reopened: t.reopened, d: t.details || null, ev: t.evidence || null, seq: t.position || 0 }; });
  S.drafts = {}; (tb.drafts || []).forEach(d => S.drafts[d.problem_id] = d.fields);
  S.chats = {}; by(tb.chat_messages, 'position').forEach(m => (S.chats[m.problem_id] = S.chats[m.problem_id] || []).push({ id: m.id, from: m.sender, text: m.body, at: m.sent_at, img: m.image || '' }));
  Object.keys(S.chats).forEach(pid => { if (!/^[ci]:/.test(pid)) return; const it = itemById(pid.slice(2)); if (!it) return;
    S.chats[pid].forEach(m => it.thread.push({ id: m.id, from: m.from === 'manager' ? 'manager' : 'tester', text: m.text, at: m.at, img: m.img })); delete S.chats[pid]; });
}
async function api(path, body, opts = {}) {
  const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: opts.signal });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.message || 'Request failed'); e.code = j.code || 'upstream_error'; throw e; }
  return j;
}
let EDITS = 0;   // counts local changes, so a slow background load never overwrites something done meanwhile
function schedulePersist() { if (S.boot !== 'ready') return; EDITS++; clearTimeout(syncTimer); syncTimer = setTimeout(persist, 250); }
function diff() {
  const snap = snapshot(), up = {}, del = {}; let any = false;
  TABLES.forEach(t => {
    const cur = snap[t], prev = LAST[t] || {};
    Object.keys(cur).forEach(id => { if (JSON.stringify(cur[id]) !== prev[id]) { (up[t] = up[t] || []).push(cur[id]); any = true; } });
    Object.keys(prev).forEach(id => { if (!(id in cur)) { (del[t] = del[t] || []).push(id); any = true; } });
  });
  return { snap, up, del, any };
}
const stringified = snap => { const o = {}; TABLES.forEach(t => { o[t] = {}; Object.entries(snap[t]).forEach(([id, r]) => o[t][id] = JSON.stringify(r)); }); return o; };
async function persist() {
  if (S.boot !== 'ready' || !CY.cur) return;   // nothing open: nothing to save (and never leave "saving" stuck on)
  if (syncing) { syncTimer = setTimeout(persist, 300); return; }
  const { snap, up, del, any } = diff();
  if (!any) return setSave('saved');
  syncing = true; setSave('saving');
  try { await api('/api/data/sync', { cycle: CY.cur, upsert: up, delete: del }); LAST = stringified(snap); setSave('saved'); saveStats(); }
  catch (e) { console.error(e); setSave('error'); syncTimer = setTimeout(persist, 3000); }
  finally { syncing = false; }
}
async function loadCycles() { CY.list = ((await api('/api/cycles')).cycles || []); }
function saveCycle(c) { const i = CY.list.findIndex(x => x.id === c.id); if (i >= 0) CY.list[i] = { ...CY.list[i], ...c }; else CY.list.push(c); return api('/api/cycles/save', { cycle: CY.list.find(x => x.id === c.id) }).catch(e => { console.error(e); toast('Could not save the test cycle. Check the connection.'); }); }
function cycleStats() {
  const steps = S.script.reduce((a, x) => a + x.who.length, 0), done = S.script.reduce((a, x) => a + x.who.filter(t => isDone(t, x.step)).length, 0);
  return { testers: S.testers.length, steps, done, comments: comments().length, tickets: S.tickets.length, waiting: pendingTriage() };
}
function saveStats() { const c = curCycle(); if (!c) return; const st = cycleStats(), app = S.appName || '', people = testers(); if (JSON.stringify(c.stats) !== JSON.stringify(st) || c.app !== app || JSON.stringify(c.people || []) !== JSON.stringify(people)) saveCycle({ id: c.id, stats: st, app, people }); }
// Notifications for the person on the home screen, from every test cycle.
const homeWho = () => S.role === 'manager' ? 'manager' : CY.me;
async function loadNotes() { const to = homeWho(); CY.notes = to ? ((await api('/api/notes?to=' + encodeURIComponent(to))).notes || []) : []; }
const allTesters = () => [...new Set(CY.list.flatMap(c => c.people || []))];
const myCycles = () => CY.list.filter(c => (c.people || []).includes(CY.me));
async function openCycle(id) {
  if (!(await flushCycle())) { toast('Could not save your last changes. Check the connection, then try again.'); return; }
  const role = S.role, c = CY.list.find(x => x.id === id); if (!c) return;
  S = freshState(); S.role = role; S.boot = 'loading'; CY.cur = id; LAST = {}; render();
  try {
    const { tables } = await api('/api/data?cycle=' + encodeURIComponent(id));
    hydrate(tables); LAST = stringified(snapshot());
    S.ended = c.status === 'completed' ? (S.ended || c.ended || stamp()) : null;   // the cycle list decides whether it is completed
    S.boot = 'ready'; S.sec = !S.script.length ? 1 : 2; if (S.role === 'tester') S.me = CY.me;
  } catch (e) { S.boot = 'error'; S.bootErr = e.message; }
  render();
}
const stripCycle = n => { const { cycle, ...r } = n; void cycle; return r; };
// Open a notification from the first screen: mark it read, open its test cycle, go to the comment or chat it is about.
async function openHomeNote(cy, id) {
  const n = CY.notes.find(x => x.cycle === cy && x.id === id); if (!n) return;
  if (!n.is_read) { n.is_read = true; try { await api('/api/notes/read', { items: [{ cycle: cy, id, row: stripCycle(n) }] }); } catch (e) { /* still open it */ } }
  await openCycle(cy); if (S.boot !== 'ready') return;
  const sn = S.notes.find(x => x.id === id); if (sn) { sn.read = true; LAST = stringified(snapshot()); A.openNote({ dataset: { v: id } }); }
  render();
}
// Save everything before leaving a test cycle: messages still waiting to send go now, and the last changes are written.
async function flushCycle() {
  if (S.boot !== 'ready' || !CY.cur) return true;
  clearTimeout(syncTimer);
  Object.keys(S.pending).forEach(cid => deliver(cid));
  for (let i = 0; i < 100 && syncing; i++) await new Promise(r => setTimeout(r, 100));   // let a save that is running finish
  for (let i = 0; i < 3; i++) { await persist(); if (!diff().any) return true; await new Promise(r => setTimeout(r, 500)); }
  return !diff().any;
}
async function goHome() {
  if (!(await flushCycle())) { toast('Could not save your last changes. Check the connection, then try again.'); render(); return; }
  Object.values(S.pending).forEach(p => clearTimeout(p.timer));
  const role = S.role; S = freshState(); S.role = role; S.boot = 'home'; CY.cur = null; LAST = {};
  try { await loadCycles(); await loadNotes(); } catch (e) { /* keep the list we have */ }
  render();
}
function setSave(s) { S.saveState = s; const el = document.getElementById('savestate'); if (el) { el.textContent = { saved: 'All changes saved', saving: 'Saving…', error: 'Could not save. Retrying…' }[s]; el.className = 'savestate ' + s; } }
const typing = () => { const a = document.activeElement; return !!(a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')); };
// Pick up changes made in other browsers (e.g. a tester on another computer)
setInterval(async () => {
  if (S.boot === 'home' && !document.hidden && !typing()) { const before = JSON.stringify([CY.list, CY.notes]); try { await loadCycles(); await loadNotes(); } catch (e) { return; } if (S.boot === 'home' && JSON.stringify([CY.list, CY.notes]) !== before) render(); return; }
  if (S.boot !== 'ready' || document.hidden || syncing || typing() || Object.keys(S.pending).length) return;
  if (diff().any) return;
  const edits = EDITS;
  try {
    const cy = CY.cur, { tables } = await api('/api/data?cycle=' + encodeURIComponent(cy));
    try { await loadCycles(); } catch (e) { /* keep the list we have */ }
    if (cy !== CY.cur || S.boot !== 'ready' || EDITS !== edits || syncing || diff().any || Object.keys(S.pending).length) return;   // something changed while loading: keep it
    const keep = S; const before = JSON.stringify(LAST);
    hydrate(tables); { const c = curCycle(); if (c) S.ended = c.status === 'completed' ? (S.ended || c.ended || stamp()) : null; } const snap = snapshot(); const after = stringified(snap);
    if (!curCycle()) { goHome(); return; }   // the test cycle was deleted elsewhere
    const c = curCycle(); S.ended = c.status === 'completed' ? (S.ended || c.ended || stamp()) : null;
    if (JSON.stringify(after) !== before) { LAST = after; render(); }
    void keep;
  } catch (e) { /* offline: try again next time */ }
}, 8000);

/* ===================== NOTIFICATIONS ===================== */
function notify(to, kind, text, ref) { S.notes.unshift({ id: uid('n'), to, kind, text, ref: ref || {}, at: nowTime(), read: false, pos: ++S.npos }); }
const unread = to => S.notes.filter(n => n.to === to && !n.read).length;

/* ===================== TESTER ACTIONS ===================== */
function saveStep(t, s, r, text, shot, thin) {
  const k = t + '|' + s, tx = (text || '').trim();
  // A Pass needs no comment. A Fail always has its reason as the first ("primary") comment.
  S.res[k] = { r, shot: shot || '', env: ENV, saved: true, items: r === 'fail' && tx ? [{ id: k + '|0', cat: 'bug', text: tx, primary: true, thread: [], seq: ++S.seq, thin: !!thin }] : [] };
  if (r === 'fail') notify('manager', 'feedback', `New bug feedback from ${t} on step ${s} (Fail)${thin ? ', needs more detail' : ''}: "${tx}"`, { cid: k + '|0', tester: t });
  checkComplete(t);
}
function addItem(t, s, cat, text, thin, asPrimary) {
  const k = t + '|' + s, res = S.res[k], tx = text.trim();
  const id = asPrimary && !res.items.some(i => i.id === k + '|0') ? k + '|0' : k + '|x' + uid('');
  const it = { id, cat, text: tx, primary: !!asPrimary, thread: [], seq: ++S.seq, thin: !!thin };
  if (asPrimary) res.items.unshift(it); else res.items.push(it);
  notify('manager', 'feedback', asPrimary ? `${t} changed step ${s} to Fail: "${tx}"` : `New ${cat === 'bug' ? 'bug' : 'non-bug'} feedback from ${t} on step ${s}${thin ? ' (needs more detail)' : ''}: "${tx}"`, { cid: id, tester: t });
}
// A tester changes their own words. The manager is told, and sees an "Edited" tag.
function editItem(cid, text, thin) {
  const it = itemById(cid); text = (text || '').trim(); if (!it || !text || text === it.text) return false;
  const [t, s] = cid.split('|'), was = it.thin, tk = ticketOfComment(cid);
  it.text = text; it.thin = !!thin; it.edited = stamp();
  notify('manager', 'feedback', `${t} edited their comment on step ${s}${was && !thin ? ' and added the detail you needed' : thin ? ' (still needs more detail)' : ''}: "${text}"${tk && tk.key ? ` It is part of ticket ${tk.key}, so you may want to update the ticket.` : ''}`, { cid, tester: t });
  return true;
}
function checkComplete(t) {
  const a = assigned(t);
  if (a.length && a.every(s => isDone(t, s.step)) && !S.completed[t]) {
    S.completed[t] = true;
    notify('manager', 'complete', `${t} has completed their test: ${a.length} of ${a.length} steps done.`, { tester: t });
    const fb = a.reduce((n, s) => n + S.res[t + '|' + s.step].items.length, 0);
    notify(t, 'update', `Thank you, ${t}! You have finished ${a.length === 1 ? 'your step' : `all ${a.length} of your steps`} and sent ${fb} piece${fb !== 1 ? 's' : ''} of feedback. We will tell you what happens to each one.`, {});
  }
}
function itemById(cid) { const [t, s] = cid.split('|'); const r = S.res[t + '|' + s]; return r && r.items.find(i => i.id === cid); }
function post(cid, from, text, img) {
  text = (text || '').trim(); if (!text && !img) return;
  const g = chatGroup(cid), me = cid.split('|')[0];
  const target = from === 'manager' ? g.ids[0] : (g.ids.find(id => id.split('|')[0] === me) || cid), it = itemById(target); if (!it) return;
  it.thread.push({ id: target + '|m' + uid(''), from, text, at: stamp(), img: img || '' });
  const q = /\?\s*$/.test(text), said = text ? `"${text}"${img ? ' (with a photo)' : ''}` : 'a photo', people = chatPeople(g);
  const about = id => g.p ? `the problem you reported ("${g.p.title}")` : `your step ${id.split('|')[1]} feedback`;
  if (from === 'manager') people.forEach(t => { const id = g.ids.find(x => x.split('|')[0] === t); notify(t, q ? 'question' : 'reply', `The UAT manager ${q ? 'asked a question' : 'wrote'} about ${about(id)}: ${said}`, { cid: id }); });
  else {
    notify('manager', 'reply', `${me} ${g.p ? `wrote in the chat about "${g.p.title}"` : `answered on step ${target.split('|')[1]}`}: ${said}`, { cid: target, tester: me });
    people.filter(t => t !== me).forEach(t => notify(t, 'reply', `${me} wrote in the chat about ${about(g.ids.find(x => x.split('|')[0] === t))}: ${said}`, { cid: g.ids.find(x => x.split('|')[0] === t) }));
  }
}

/* ===================== AI (through the server) ===================== */
const aiReady = () => CFG.ai !== 'none' && !S.aiOff;
function aiErrorText(e) {
  const c = e && e.code;
  if (c === 'ai_off') { S.aiOff = true; return 'AI is not set up on this server, so the basic check is used instead.'; }
  if (c === 'ai_auth') { S.aiOff = true; return 'The AI key was rejected (check GEMINI_API_KEY), so the basic check is used instead.'; }
  if (c === 'rate_limited') return 'The free AI limit is used up for now. Try again in a minute, or use the basic check.';
  if (c === 'cancelled') return 'Stopped.';
  if (c === 'invalid_json') return 'The AI answer could not be read. Try again.';
  return 'The AI could not answer just now. Try again, or use the basic check.';
}
const VAGUE = /\b(didn'?t work|doesn'?t work|not working|broken|weird|issue|problem)\b/i;
const HAPPENED = /(froze|freez|stuck|grey|gray|nothing|crash|message|blank|spin|slow|second|misalign|lower|higher|missing|not saved|reload|stops? respond|could not|couldn't|can't|cannot|disappear|empty|shows?|opens?|took|looked wrong|cut off|twice|error|wrong)/i;
const IDEA = /(would be (great|nice|good)|would help|it'?d be nice|could you add|please add|wish|suggest|option to|bigger|dark mode|remember|would like)/i;
function quality(kind, r, cat, text) {
  const t = (text || '').trim(), w = wc(t);
  if (cat === 'nonbug') { const ok = w >= 4; return { ok, checks: [['Explains the idea or suggestion', ok]] }; }
  if (kind === 'p' && r === 'pass') { const ok = w >= 3; return { ok, checks: [['Says what you saw', ok]], ideaHint: IDEA.test(t) }; }
  const happened = HAPPENED.test(t) && w >= 3, specific = w >= 5 && !/^(it )?(didn'?t|doesn'?t) work\.?$/i.test(t);
  return { ok: happened && specific, checks: [['Says what you did (filled in from the step)', true], ['Says what happened on screen', happened], ['Specific enough to repeat', specific]], ideaHint: IDEA.test(t) };
}
const SAYS_OK = /(work(ed|s)? (fine|ok|okay|well|correctly|as expected)|as expected|no problems?|all good|it worked|everything worked|looked fine)/i;
const SAYS_BAD = /(not|n't|fail|error|wrong|froze|freez|stuck|crash|missing|blank|broken|slow|nothing happen|disappear|cannot|cant)/i;
// The result and the comment disagree: a Fail that says it worked, or a bug comment on a passed step.
function basicMismatch(kind, r, cat, text) {
  if (cat === 'nonbug') return false;
  if (kind === 'p' && r === 'fail') return SAYS_OK.test(text) && !SAYS_BAD.test(text);
  if (kind === 'x' && r === 'pass') return SAYS_BAD.test(text);
  return false;
}
function basicResult(kind, r, cat, text, note) {
  const q = quality(kind, r, cat, text), mm = basicMismatch(kind, r, cat, text);
  return { helpful: q.ok, checks: q.checks.map(c => ({ label: c[0], ok: c[1] })), question: q.ok ? '' : (cat === 'nonbug' ? 'Could you explain the idea in a bit more detail?' : kind === 'p' && r === 'pass' ? 'What did you see on screen?' : 'What exactly happened on screen after you did the step?'), looksLikeSuggestion: !!q.ideaHint, explain: q.ok ? 'The comment has enough detail.' : 'The comment needs a little more detail.', mismatch: mm, source: 'basic', note };
}
// kind: 'p' = a step's result, 'x' = an extra comment, 'e' = editing a saved comment (k is then the comment id)
function ctxOf(kind, k) {
  if (kind === 'e') { const u = S.ue[k], [t, s] = k.split('|'); return { u, r: (S.res[t + '|' + s] || {}).r, cat: u.cat, st: step(s), key: 'e:' + k }; }
  const u = kind === 'p' ? S.ui[k] : S.ux[k], r = kind === 'p' ? u.r : S.res[k].r, cat = kind === 'p' ? 'bug' : u.cat;
  return { u, r, cat, st: step(k.split('|')[1]), key: kind + ':' + k };
}
const ck = (kind, k) => kind === 'e' ? (S.ue[k].primary ? 'p' : 'x') : kind;   // an edit is checked like the comment it changes
async function runCheck(kind0, k) {
  const { u, r, cat, st, key } = ctxOf(kind0, k), text = (u.text || '').trim(), kind = ck(kind0, k);
  if (!text) return;
  if (!aiReady()) { S.ai[key] = { status: 'done', text, r, cat, result: basicResult(kind, r, cat, text) }; render(); return; }
  S.ai[key] = { status: 'checking', text, r, cat }; render();
  try {
    const j = await api('/api/check-comment', { app: appName(), kind, r, cat, step: { scen: st.scen, step: st.step, screen: st.screen, act: st.act, exp: st.exp }, text });
    const res = { helpful: !!j.helpful, checks: Array.isArray(j.checks) ? j.checks.slice(0, 4).map(c => ({ label: String(c.label || ''), ok: !!c.ok })) : [], question: String(j.question || ''), looksLikeSuggestion: !!j.looksLikeSuggestion, mismatch: !!j.resultMismatch || basicMismatch(kind, r, cat, text), explain: String(j.explain || ''), source: 'ai' };
    S.ai[key] = { status: 'done', text, r, cat, result: res };
  } catch (e) {
    const msg = aiErrorText(e);
    S.ai[key] = S.aiOff ? { status: 'done', text, r, cat, result: basicResult(kind, r, cat, text, msg) } : { status: 'error', text, r, cat, err: msg };
  }
  render();
}
function useBasic(kind, k) { const { u, r, cat, key } = ctxOf(kind, k), text = (u.text || '').trim(); S.ai[key] = { status: 'done', text, r, cat, result: basicResult(ck(kind, k), r, cat, text, 'Basic check used because the AI was not available.') }; }
// The Save button can be clicked when there is something to save; the comment check runs on Save.
function canSave(kind, k) {
  const { u, r, key } = ctxOf(kind, k), text = (u.text || '').trim();
  if (kind === 'p' && !u.r) return false;
  if (kind === 'p' && r === 'pass') return true;
  return !!text && (S.ai[key] || {}).status !== 'checking';
}
function freshCheck(kind, k) { const { u, r, cat, key } = ctxOf(kind, k), a = S.ai[key], text = (u.text || '').trim(); return a && a.status === 'done' && a.text === text && a.r === r && a.cat === cat ? a : null; }
// One button: Save runs the check. Helpful and consistent -> saved at once. Otherwise the question shows, with Save anyway.
async function trySave(kind, k) {
  const { u, r } = ctxOf(kind, k);
  if (kind === 'p' && r === 'pass') { commit(kind, k, false); render(); return; }
  if (!(u.text || '').trim()) return;
  let a = freshCheck(kind, k);
  if (!a) { await runCheck(kind, k); a = freshCheck(kind, k); }
  if (a && a.result.helpful && (kind === 'e' || !a.result.mismatch)) commit(kind, k, false);
  render();
}
// "Needs more detail" only when the check (or, if the AI could not answer, the basic check) says the comment is not helpful yet.
function thinFor(kind, k) { const a = freshCheck(kind, k); if (a) return !a.result.helpful; const { u, r, cat } = ctxOf(kind, k); return !basicResult(ck(kind, k), r, cat, (u.text || '').trim()).helpful; }
function commit(kind, k, thin) {
  const [t, s] = k.split('|');
  if (kind === 'e') { const u = S.ue[k]; if (!u) return; const changed = editItem(k, u.text, thin); delete S.ue[k]; delete S.ai['e:' + k]; toast(!changed ? 'No changes to save.' : thin ? 'Comment updated. The UAT manager may still ask you for a little more detail.' : 'Comment updated. The UAT manager has been told.'); return; }
  if (kind === 'p' ? !S.ui[k] || (S.res[k] && S.res[k].saved) : !(S.ux[k] && S.res[k])) return;   // already saved
  if (kind === 'p') { const u = S.ui[k]; saveStep(t, s, u.r, u.text, u.shot, thin); delete S.ui[k]; delete S.ai['p:' + k]; S.openStep = null; toast(thin ? 'Saved. The UAT manager may ask you for a little more detail.' : assigned(t).every(x => isDone(t, x.step)) ? 'Saved. That was your last step!' : 'Saved. On to your next step.'); }
  else { const x = S.ux[k]; addItem(t, s, x.cat, x.text, thin, x.primary); delete S.ux[k]; delete S.ai['x:' + k]; toast(thin ? 'Comment added. The UAT manager may ask you for a little more detail.' : 'Comment added. The UAT manager has been told.'); }
}
const mark = b => b === true ? '<span class="m y">✓</span>' : b === false ? '<span class="m x">✗</span>' : '<span class="m q">?</span>';
function saveBtn(kind, k) {
  const a = freshCheck(kind, k), st = (S.ai[kind + ':' + k] || {}).status, label = kind === 'p' ? 'Save result' : kind === 'e' ? 'Save changes' : 'Add comment';
  const ask = a && !a.result.helpful && (kind === 'e' || !a.result.mismatch);
  return `<button class="btn sm primary" id="sv-${kind}-${esc(k)}" data-a="${ask ? 'saveAnyway' : kind === 'p' ? 'saveStep' : kind === 'e' ? 'saveE' : 'saveX'}" data-f="${kind}" data-k="${esc(k)}" ${canSave(kind, k) ? '' : 'disabled'}>${st === 'checking' ? 'Checking…' : ask ? (kind === 'x' ? 'Add it anyway' : 'Save anyway') : label}</button>`;
}
function helperHTML(kind, k) {
  const { u, r, cat, key } = ctxOf(kind, k), text = (u.text || '').trim();
  if (kind === 'p' && !u.r) return '';
  if (kind === 'p' && r === 'pass') return '<span class="muted">No comment needed for a Pass. After saving, you can still add an idea or suggestion to this step.</span>';
  const a = S.ai[key], ek = esc(k), sv = kind === 'p' ? 'Save result' : kind === 'e' ? 'Save changes' : 'Add comment';
  const hint = aiReady() ? `When you click <b>${sv}</b>, the AI checks that a developer can act on your comment, and may ask one question. It never changes your words.` : `When you click <b>${sv}</b>, a basic check makes sure a developer can act on your comment.`;
  if (!a) return `<span class="muted">${text ? hint : 'Write what you saw, in your own words.'}</span>`;
  if (a.status === 'checking') return `<div class="row"><span class="chip c-new">AI is reading your comment…</span><span class="muted">This takes a few seconds.</span></div>`;
  if (a.status === 'error') return `<div class="stack" style="gap:6px"><span class="q">${esc(a.err)}</span><div class="row"><button class="btn sm" data-a="basicCheck" data-f="${kind}" data-k="${ek}">Use basic check</button><button class="btn sm" data-a="saveAnyway" data-f="${kind}" data-k="${ek}">Save anyway</button><span class="small muted">or click ${sv} again to retry.</span></div></div>`;
  if (a.text !== text || a.r !== r || a.cat !== cat) return `<span class="muted">${hint}</span>`;
  return resultHTML(a.result, kind, k, a.result.source === 'ai' ? 'Checked by AI' : aiReady() ? 'Basic check' : 'Basic check (AI is off on this server)', a.result.note);
}
function resultHTML(res, kind, k, label, note) {
  const score = res.helpful ? 3 : res.checks.some(c => c.ok) ? 2 : 1;
  let h = `<div class="row between"><span style="font-weight:600">${esc(label)}</span><span class="row small"><span class="meter s${score}"><i></i><i></i><i></i></span>${res.mismatch ? '<span class="q">Check your result</span>' : res.helpful ? '<span class="y">Helpful</span>' : '<span class="q">Needs a little more</span>'}</span></div>`;
  if (note) h += `<span class="small muted">${esc(note)}</span>`;
  h += res.checks.map(c => `<div class="sig">${mark(c.ok)}<span>${esc(c.label)}</span></div>`).join('');
  if (res.explain) h += `<span class="muted">${esc(res.explain)}</span>`;
  const sv = kind === 'p' ? 'Save result' : kind === 'e' ? 'Save changes' : 'Add comment';
  if (res.mismatch && kind !== 'e') {
    if (kind === 'p') h += `<div class="ask"><b>You chose Fail, but your comment sounds like it worked.</b><span class="small">Did you mean Pass? A Pass needs no comment.</span><div class="row"><button class="btn sm primary" data-a="toPass" data-k="${esc(k)}">Yes, switch to Pass</button><button class="btn sm" data-a="keepSave" data-f="${kind}" data-k="${esc(k)}">No, keep Fail and save</button></div></div>`;
    else h += `<div class="ask"><b>This sounds like the step did not work, but it is marked Pass.</b><span class="small">Do you want to change the step to Fail? Your comment becomes the reason.</span><div class="row"><button class="btn sm primary" data-a="toFail" data-k="${esc(k)}">Yes, change to Fail</button><button class="btn sm" data-a="keepSave" data-f="${kind}" data-k="${esc(k)}">No, keep Pass and add it</button></div></div>`;
  } else if (!res.helpful) {
    if (res.question) h += `<div class="stack" style="gap:4px"><span><b>A question for you:</b> ${esc(res.question)}</span><span class="muted">Add the answer to your comment in your own words, then click ${sv} again.</span></div>`;
    h += `<span class="small muted">Not sure what to add? Click <b>${kind === 'x' ? 'Add it anyway' : 'Save anyway'}</b> to save it as it is. It will be marked "needs more detail" so the UAT manager can ask you.</span>`;
  }
  const cat = kind === 'p' ? 'bug' : kind === 'e' ? S.ue[k].cat : S.ux[k].cat;
  if (res.looksLikeSuggestion && cat === 'bug') h += `<div class="row"><span class="chip c-idea">Sounds like a suggestion</span>${kind === 'x' ? `<button class="btn sm" data-a="xcat" data-k="${esc(k)}" data-v="nonbug">Mark as non-bug feedback</button>` : '<span class="muted">After saving, add it as a separate comment marked non-bug feedback.</span>'}</div>`;
  return h;
}

/* ===================== DUPLICATE FINDER + KNOWN CHECK (rules) ===================== */
const STOP = new Set('i me my we our you your it its is was were be been am are a an the and or but so to of in on at for with from by as after before when then than that this these those there here just very really also again still not no did didnt does doesnt do work worked works working get got went go goes could would should can cant will wont have has had what which who how why while into out up down off over only some any all one two'.split(' '));
const SYN = { froze: 'freeze', frozen: 'freeze', freezes: 'freeze', freezing: 'freeze', stuck: 'freeze', hang: 'freeze', hangs: 'freeze', hung: 'freeze', unresponsive: 'freeze', respond: 'freeze', responding: 'freeze', responds: 'freeze', submit: 'save', submitting: 'save', saved: 'save', saving: 'save', grey: 'disabled', gray: 'disabled', greyed: 'disabled', grayed: 'disabled', disabled: 'disabled', slow: 'slow', slowly: 'slow', lag: 'slow', laggy: 'slow', seconds: 'slow', error: 'error', errors: 'error', fail: 'error', failed: 'error', fails: 'error', crash: 'crash', crashed: 'crash', crashes: 'crash', misaligned: 'layout', misalign: 'layout', alignment: 'layout', layout: 'layout', lower: 'layout', overlap: 'layout', overlapping: 'layout', missing: 'missing', gone: 'missing', disappeared: 'missing', disappears: 'missing', blank: 'empty', empty: 'empty', nothing: 'nothing', happens: 'happen', happened: 'happen' };
const stem = w => { if (SYN[w]) return SYN[w]; let s = w; if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3); else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2); else if (s.length > 4 && s.endsWith('es')) s = s.slice(0, -2); else if (s.length > 3 && s.endsWith('s')) s = s.slice(0, -1); return SYN[s] || s; };
const tokens = t => new Set((t || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w)).map(stem).filter(w => w.length > 1 && !STOP.has(w)));
function wordSim(a, b) { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach(x => { if (B.has(x)) n++; }); return n / Math.min(A.size, B.size); }
const shared = (a, b) => { const B = tokens(b); return [...tokens(a)].filter(x => B.has(x)).slice(0, 4); };
const errSeen = c => !!c.shot || /error|not saved|nothing was saved|could not save|failed|crash/i.test(c.text);
function pair(a, b) {
  const sa = step(a.step), sb = step(b.step);
  const sameStep = a.step === b.step, sameScreen = !!(sa.screen && sa.screen.toLowerCase() === (sb.screen || '').toLowerCase()), sim = wordSim(a.text, b.text), err = errSeen(a) && errSeen(b);
  return { score: Math.round(35 * sameStep + 20 * sameScreen + 30 * sim + 15 * err), sameStep, sameScreen, sim, err };
}
const strong = p => (p.score >= 60 && p.sim >= 0.3) || p.sim >= 0.6;
function allItems() {
  const out = [];
  Object.entries(S.res).forEach(([k, v]) => { if (!v.saved) return; const [tester, st] = k.split('|'); v.items.forEach(i => out.push({ id: i.id, tester, step: st, r: v.r, shot: v.shot, cat: i.cat, text: i.text, primary: i.primary, thread: i.thread, seq: i.seq, thin: !!i.thin, edited: i.edited || null })); });
  return out;
}
function comments() { return allItems().filter(c => c.cat === 'nonbug' || !c.primary || c.r === 'fail'); }
function knownMatch(c) {
  let best = null;
  S.tickets.forEach(t => {
    if ((t.seq || 0) >= (c.seq || 0)) return;                            // only tickets that existed before this comment
    if ((t.ev || []).some(e => e.id === c.id)) return;
    const text = t.summary + ' ' + ((t.d && t.d.actual) || '');
    const sim = wordSim(c.text, text), sameArea = !!t.epic && t.epic.toLowerCase() === step(c.step).scen.toLowerCase();
    const screen = step(c.step).screen, screenHit = !!screen && text.toLowerCase().includes(screen.toLowerCase());
    const score = Math.round(60 * sim + 20 * sameArea + 20 * screenHit);
    if (sim >= 0.34 && score >= 50 && (!best || score > best.score)) best = { t, sim, sameArea, screenHit, score };
  });
  return best;
}
function knownInfo(c, key, m) {
  const t = S.tickets.find(x => x.key === key); if (!t) return null;
  m = m || { sim: wordSim(c.text, t.summary), sameArea: t.epic === step(c.step).scen, screenHit: false, score: 60 };
  const open = t.status !== 'Done' || t.reopened, words = shared(c.text, t.summary + ' ' + ((t.d && t.d.actual) || ''));
  return { type: 'known', jira: t.key, conf: Math.min(95, m.score), closed: t.status === 'Done' && !t.reopened, why: [[words.length ? `Similar words: ${words.map(w => '"' + w + '"').join(', ')}` : 'Similar words', m.sim >= 0.34], [`Same area (${t.epic || 'not set'})`, m.sameArea], [open ? `${t.key} is still open (${t.reopened ? 'reopened' : t.status})` : `${t.key} is Done, so this may be the same problem coming back (a regression)`, open ? true : null]] };
}
let TRI = null;
function triage() {
  if (TRI) return TRI;
  const cs = comments().sort((a, b) => a.seq - b.seq);
  const ideas = [], known = [], rest = [];
  cs.forEach(c => {
    if (c.cat === 'nonbug') { c.cl = { type: 'idea' }; ideas.push(c); return; }
    if (S.known[c.id] && S.knownT[c.id]) { c.cl = knownInfo(c, S.knownT[c.id]) || { type: 'bug' }; if (c.cl.type === 'known') { known.push(c); return; } }
    rest.push(c);
  });
  // group comments that describe the same bug
  const n = rest.length, parent = rest.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (strong(pair(rest[i], rest[j]))) parent[find(i)] = find(j);
  const comps = {}; rest.forEach((c, i) => (comps[find(i)] = comps[find(i)] || []).push(c));
  const groups = [], singles = [];
  Object.values(comps).forEach(list => { if (list.length > 1) groups.push({ anchor: list[0].id, members: list.slice() }); else singles.push(list[0]); });
  // a weak match is shown in the group but starts unticked
  const leftovers = [];
  singles.forEach(c => {
    let best = null;
    groups.forEach(g => g.members.forEach(m => { const p = pair(c, m); if (p.score >= 40 && p.sim >= 0.2 && (!best || p.score > best.p.score)) best = { g, p }; }));
    if (best && S.groups[best.g.anchor] !== false) best.g.members.push(c); else leftovers.push(c);
  });
  groups.forEach(g => { g.members.sort((a, b) => a.seq - b.seq); g.members.forEach(c => c.cl = { type: 'dup', g: g.anchor }); });
  const bugs = [];
  leftovers.forEach(c => { const m = knownMatch(c); if (m) { c.cl = knownInfo(c, m.t.key, m); known.push(c); } else { c.cl = { type: 'bug' }; bugs.push(c); } });
  TRI = { cs, groups, known, ideas, bugs, dups: groups.flatMap(g => g.members) };
  return TRI;
}
function memberScore(c, g) { let best = null; g.members.forEach(o => { if (o === c) return; const p = pair(c, o); if (!best || p.score > best.score) best = p; }); return best || { score: 0, sameStep: false, sameScreen: false, sim: 0, err: false }; }
function lvl(v) { return v >= 85 ? ['h', 'High'] : v >= 60 ? ['m', 'Medium'] : ['l', 'Low']; }
const conf = (v, label) => { const [k, n] = lvl(v); return `<div class="conf"><span class="small" style="font-weight:600">${esc(label)}</span><div class="bar lvl-${k}"><i style="width:${v}%"></i></div><span class="mono" style="font-weight:600">${v}%</span><span class="small muted">${n} confidence</span></div>`; };
// Comments that would become a problem on their own wait in Bugs and comments until the manager approves them.
function needsApproval(c) { const T = triage(); if (T.bugs.includes(c)) return true; const g = T.groups.find(x => x.members.includes(c)); if (!g) return false; const m = S.groups[g.anchor]; return m === false || (m === true && S.mem[c.id] === 'out'); }
function pendingTriage() {
  const T = triage(); let n = 0;
  T.groups.forEach(g => { const m = S.groups[g.anchor]; if (m === undefined) n++; else if (m === true) { n += g.members.filter(c => !S.mem[c.id]).length; if (g.members.some(c => S.mem[c.id] === 'in') && !S.appr['g:' + g.anchor]) n++; } });
  n += T.cs.filter(c => needsApproval(c) && !S.appr[c.id]).length;
  return n + T.known.filter(c => !S.known[c.id]).length + T.ideas.filter(c => !S.idea[c.id]).length;
}
const short = (t, n = 70) => { t = (t || '').trim(); t = t.charAt(0).toUpperCase() + t.slice(1); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
function problems() {
  const T = triage(), bugs = [], ideas = [];
  T.groups.forEach(g => {
    const m = S.groups[g.anchor];
    if (m === true) {
      const ins = g.members.filter(c => S.mem[c.id] === 'in');
      if (ins.length && S.appr['g:' + g.anchor] === 'yes') bugs.push({ pid: 'g:' + g.anchor, kind: 'bug', members: ins, merged: ins.length > 1 });   // a merged comment moves on only once approved
      g.members.filter(c => S.mem[c.id] === 'out' && S.appr[c.id] === 'yes').forEach(c => bugs.push({ pid: 'c:' + c.id, kind: 'bug', members: [c] }));
    } else if (m === false) g.members.filter(c => S.appr[c.id] === 'yes').forEach(c => bugs.push({ pid: 'c:' + c.id, kind: 'bug', members: [c] }));
  });
  T.bugs.filter(c => S.appr[c.id] === 'yes').forEach(c => bugs.push({ pid: 'c:' + c.id, kind: 'bug', members: [c] }));
  T.known.filter(c => S.known[c.id] === 'new').forEach(c => bugs.push({ pid: 'c:' + c.id, kind: 'bug', members: [c] }));
  T.ideas.filter(c => S.idea[c.id] === 'bug').forEach(c => bugs.push({ pid: 'c:' + c.id, kind: 'bug', members: [c] }));
  T.ideas.filter(c => S.idea[c.id] === 'add').forEach(c => ideas.push({ pid: 'i:' + c.id, kind: 'idea', members: [c] }));
  [...bugs, ...ideas].forEach(p => { const c = p.members[0], st = step(c.step); p.title = S.ptk[p.pid] ? (S.tickets.find(t => t.key === S.ptk[p.pid]) || {}).summary : p.kind === 'idea' ? short(c.text) : `${st.screen || st.scen}: ${short(c.text, 60)}`; });
  return { bugs, ideas };
}

/* ===================== TICKET DRAFTER ===================== */
function draft(p) {
  const c = p.members[0], st = step(c.step);
  const answers = p.members.flatMap(m => m.thread.filter(x => x.from === 'tester').map(x => `${m.tester}: ${x.text}`)).concat((S.chats[p.pid] || []).filter(x => x.from !== 'manager').map(x => `${x.from}: ${x.text}`));
  const envs = [...new Set(p.members.map(m => (S.res[m.tester + '|' + m.step] || {}).env).filter(Boolean))];
  return {
    summary: `${st.screen || st.scen}: ${short(c.text, 80)}`, type: p.kind === 'idea' ? 'Improvement' : 'Bug',
    description: `Found during UAT of ${appName()}. Reported by ${[...new Set(p.members.map(m => m.tester))].join(', ')} on step ${[...new Set(p.members.map(m => m.step))].join(' and ')}.${answers.length ? ' Follow-up answers: ' + answers.join('; ') + '.' : ''}`,
    steps: `1. Go to ${st.screen || st.scen}\n2. ${st.act}`, expected: expectedOf(p) || st.exp, actual: p.members.map(m => `${m.tester}: "${m.text}"`).join(' / '),
    env: 'UAT · ' + (envs.join('; ') || 'Not reported'), priority: p.kind === 'idea' ? 'Low' : 'Medium', why: '', epic: p.kind === 'idea' ? 'UX improvements' : st.scen, labels: p.kind === 'idea' ? 'uat, idea' : 'uat'
  };
}
async function aiDraft(p, fresh) {
  const pid = p.pid;
  if (!aiReady()) { S.drafts[pid] = Object.assign(draft(p), { _src: 'basic' }); S.open = pid; render(); return; }
  const ctl = new AbortController(); S.drafting[pid] = { status: 'drafting', ctl }; S.open = null; render();
  try {
    const envs = [...new Set(p.members.map(m => (S.res[m.tester + '|' + m.step] || {}).env).filter(Boolean))];
    const j = await api('/api/draft-ticket', { app: appName(), kind: p.kind, epics: epics(), envs, members: p.members.map(m => { const st = step(m.step); return { tester: m.tester, step: { scen: st.scen, step: st.step, screen: st.screen, act: st.act, exp: st.exp }, r: m.r, cat: m.cat, shot: !!(m.shot && m.primary), text: m.text, thread: m.thread.map(x => ({ from: x.from, text: x.text })) }; }), chat: (S.chats[p.pid] || []).map(x => ({ from: x.from === 'manager' ? 'UAT manager' : x.from, text: x.text })), fresh: !!fresh }, { signal: ctl.signal });
    const base = draft(p), str = v => typeof v === 'string' ? v.trim() : '';
    S.drafts[pid] = { summary: str(j.summary) || base.summary, type: ['Bug', 'Improvement'].includes(j.type) ? j.type : base.type, description: str(j.description) || base.description,
      steps: str(j.steps).replace(/\\n/g, '\n') || base.steps, expected: base.expected, actual: saysSomething(str(j.actual)) ? str(j.actual) : base.actual, env: str(j.env) || base.env,
      priority: ['High', 'Medium', 'Low'].includes(j.priority) ? j.priority : base.priority, why: str(j.why), epic: epics().includes(j.epic) ? j.epic : base.epic, labels: str(j.labels) || 'uat', _src: 'ai' };
    delete S.drafting[pid]; S.open = pid;
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Stopped.' : aiErrorText(e);
    if (S.aiOff) { S.drafts[pid] = Object.assign(draft(p), { _src: 'basic', _note: msg }); delete S.drafting[pid]; S.open = pid; }
    else S.drafting[pid] = { status: 'error', err: msg };
  }
  TRI = null; render();
}
// The clarity check reads what each field says, not how many words it has. Every cross says why, and what would fix it.
const PLACEHOLDER = /^\s*(not reported|n\/?a|none|unknown|tbd|todo|-+|\?+|\.+)\s*\.?\s*$/i;
const vagueOnly = t => { const rest = (t || '').replace(new RegExp(VAGUE.source, 'gi'), ' '); return !tokens(rest).size; };   // nothing left once vague words are taken out
const saysSomething = t => !!(t || '').trim() && !PLACEHOLDER.test(t) && !vagueOnly(t);
const testersWords = p => p ? p.members.map(m => m.text).concat(p.members.flatMap(m => m.thread.filter(x => x.from === 'tester').map(x => x.text))).join(' ') : '';
const expectedOf = p => p ? [...new Set(p.members.map(m => step(m.step).exp).filter(Boolean))].join(' / ') : '';
function vagueCheck(d, p) {
  const words = testersWords(p), st = p ? step(p.members[0].step) : null, where = st ? tokens([st.screen, st.scen, st.act].join(' ')) : new Set();
  const stepLines = (d.steps || '').split('\n').filter(l => /^\s*\d+[.)]/.test(l) && saysSomething(l.replace(/^\s*\d+[.)]/, '')));
  const sum = d.summary || '', sumTok = tokens(sum), sumWhere = [...sumTok].some(w => where.has(w)), sumWhat = [...sumTok].some(w => !where.has(w)) || HAPPENED.test(sum);
  const act = d.actual || '', tw = tokens(words), actSeen = tw.size ? [...tokens(act)].some(w => tw.has(w)) : HAPPENED.test(act) || tokens(act).size > 0;   // it must match what the testers reported
  const quote = words ? ` What the testers wrote: "${short(words, 110)}"` : '';
  return [
    ['Summary says what breaks and where', saysSomething(sum) && sumWhat && sumWhere,
      !saysSomething(sum) ? 'It does not say what goes wrong yet.' : !sumWhere ? `Say where it happens${st ? `, for example the ${st.screen || st.scen} screen` : ''}.` : 'Say what goes wrong there.'],
    ['Steps to reproduce are numbered', stepLines.length >= 1, 'Write the steps as numbered lines: "1. ...".'],
    ['Expected result is stated', saysSomething(d.expected), `Use the expected result from the test script${st ? `: "${expectedOf(p)}"` : ''}.`],
    ['Actual result describes what the testers saw', saysSomething(act) && actSeen,
      !saysSomething(act) ? 'It does not say what the testers saw yet.' + quote : 'It does not match what the testers reported.' + quote],
    ['Environment named', saysSomething(d.env), 'Name the browser and system, for example "UAT · Chrome on Windows".'],
    ['Priority has a reason', saysSomething(d.why), 'Say why this priority, for example "It blocks signing in, reported by 2 testers".'],
    ['Linked to an epic', !!d.epic, 'Choose an epic.']
  ];
}

/* ===================== MESSAGES TO TESTERS ===================== */
function ticketOfComment(id) { const P = problems(); for (const p of [...P.bugs, ...P.ideas]) if (p.members.some(m => m.id === id)) return { p, key: S.ptk[p.pid] }; return null; }
const UNDO_MS = 10000;
function deliver(cid) { const p = S.pending[cid]; if (!p) return; clearTimeout(p.timer); delete S.pending[cid]; S.checked[cid] = true; S.sent[cid] = p.text; notify(cid.split('|')[0], 'update', p.text, { cid }); }
function cancelMsg(cid) { const p = S.pending[cid]; if (!p) return false; clearTimeout(p.timer); delete S.pending[cid]; return true; }
const stepTxt = c => `step ${c.step} (${step(c.step).act})`;
function correction(c, text) { return `Update: we took another look at your feedback on ${stepTxt(c)}. ` + text.replace(/^Your (feedback|idea|comment)\b.*? has been checked\. /, '') + ' Sorry for the mix-up.'; }
function tell(cid, text, now) {
  const c = comments().find(x => x.id === cid);
  if (S.fix[cid] && c) { text = correction(c, text); delete S.fix[cid]; }
  cancelMsg(cid);
  if (now) { S.pending[cid] = { text }; deliver(cid); return; }
  const p = { text, due: Date.now() + UNDO_MS }; p.timer = setTimeout(() => { deliver(cid); schedulePersist(); safeRender(); }, UNDO_MS); S.pending[cid] = p;
}
function revoke(cid) { if (cancelMsg(cid)) return true; if (S.sent[cid]) S.fix[cid] = true; return !S.sent[cid]; }
function safeRender() { if (typing()) { S.renderLater = true; return; } render(); }
const undoLabel = ids => ids.some(id => S.pending[id]) ? 'Undo' : 'Change decision';
setInterval(() => { document.querySelectorAll('.cd').forEach(e => { e.textContent = Math.max(0, Math.ceil((+e.dataset.due - Date.now()) / 1000)); }); }, 400);
function credit(c, group) {
  if (c.thread && c.thread.some(m => m.from === 'tester')) return 'Thank you for answering our question. Your answer is now part of the record for the developer.';
  if (group && group.length > 1 && Math.min(...group.map(g => g.seq || 0)) === (c.seq || 0)) return 'You were the first to report this. Thank you for spotting it.';
  if (c.primary && c.shot) return 'Your screenshot shows exactly what went wrong, which helps the developer a lot.';
  return '';
}
const withCredit = (text, c, group) => { const cr = credit(c, group); return cr ? text + ' ' + cr : text; };
const MSG = {
  link: (c, t, re) => `Your feedback on ${stepTxt(c)} has been checked. It is the same problem as ${t.key}, "${t.summary}", so we linked your report to that ticket.${re ? ' We have reopened the ticket because the problem is back.' : ''} Your report shows the problem still happens, so the developers know it is not fixed yet.`,
  newProb: c => `Your feedback on ${stepTxt(c)} has been checked and approved. It is a new problem, not one we already knew about, so it will get its own ticket. Thank you for finding it.`,
  merged: (c, n) => `Your feedback on ${stepTxt(c)} has been checked. ${n > 1 ? `${n - 1} other tester${n > 2 ? 's' : ''} reported the same problem, so we merged the reports into one.` : 'It is now grouped as one problem.'} Your words are kept as evidence for the developer.${n >= 3 ? ' Because several testers reported it, it will be treated as a high priority.' : ''}`,
  separate: c => `Your feedback on ${stepTxt(c)} has been checked. It is a different problem from the similar reports, so the UAT manager is looking at it on its own.`,
  mergedApproved: (c, n) => `Your feedback on ${stepTxt(c)} has been checked and approved. ${n - 1} other tester${n > 2 ? 's' : ''} reported the same problem, so we merged the reports into one, and it will get its own ticket. Thank you for reporting it.`,
  approved: (c, thin) => `Your feedback on ${stepTxt(c)} has been checked and approved. It is a real problem, so it will get its own ticket.${thin ? ' We may still ask you for a little more detail, so a developer can repeat it.' : ''} Thank you for reporting it.`,
  notApproved: c => `Thank you for your feedback on ${stepTxt(c)}. The UAT manager read it carefully and decided not to raise it as a problem this time. Your comment stays in the test record, and it still helps us understand how the app feels to use. If you think something was missed, you can add another comment to the step.`,
  ideaAdd: c => `Your idea "${c.text}" has been checked and added to the Good ideas list. Ideas like yours help make the next version better. Thank you!`,
  ideaNo: c => `Thank you for your idea "${c.text}". The team read it and was glad to hear it. We are not adding it to the Good ideas list this time, but it stays in the test record. Please keep the ideas coming!`,
  ideaBug: c => `Your comment on ${stepTxt(c)} has been checked. It describes a problem, so we are treating it as bug feedback, and it will get its own ticket. Thank you for spotting it.`,
  ticket: (c, key, sum, pri) => `Your feedback on ${stepTxt(c)} is now ticket ${key}: "${sum}". A developer will look at it.${pri === 'High' ? ' It is marked High priority, so your report made a real difference.' : ''}`,
  ideaTicket: (c, key) => `Good news: your idea "${c.text}" is now planned as improvement ${key}.`,
  progress: (c, key) => `Update on ${key}: a developer has started fixing the problem you reported on step ${c.step}.`,
  fixed: (c, key) => `Good news: ${key} is fixed. Thank you for helping get it fixed. Please re-test step ${c.step} (${step(c.step).act}) when you can.`
};
function told(c) {
  const t = c.tester, p = S.pending[c.id];
  if (p && p.due) return `<div class="inbox small"><b>Message to ${esc(t)} sends in <span class="cd" data-due="${p.due}">${Math.ceil((p.due - Date.now()) / 1000)}</span> s</b> (click Undo to stop it): ${esc(p.text)}</div>`;
  if (S.fix[c.id]) return `<span class="small q">You reopened this decision. When you decide again, ${esc(t)} gets a short correction message.</span>`;
  return S.sent[c.id] ? `<div class="inbox small"><b>${esc(t)} was told:</b> ${esc(S.sent[c.id])}</div>` : `<span class="small muted">${esc(t)} will get a message automatically when you decide.</span>`;
}
function stageOf(c) {
  const T = triage(), cl = (T.cs.find(x => x.id === c.id) || {}).cl || {}, tk = k => S.tickets.find(x => x.key === k) || {};
  if (cl.type === 'known' && S.known[c.id] === 'link') return tk(cl.jira).status === 'Done' ? 4 : 3;
  const r = ticketOfComment(c.id);
  if (r && r.key) return tk(r.key).status === 'Done' ? 4 : 3;
  if (cl.type === 'idea' && S.idea[c.id] === 'add') return 3;
  return S.checked[c.id] ? 2 : 1;
}
const STAGES = ['Received', 'Checked', 'Ticket or idea', 'Fixed'];
const stageChips = st => `<div class="row small" style="gap:4px">${STAGES.map((n, i) => `<span class="chip ${i < st ? 'c-ok' : 'c-grey'}">${n}</span>`).join('')}</div>`;
// Sent to every tester once, when the manager ends the test cycle.
function endCycleHTML() {
  const who = testers().filter(t => assigned(t).length), done = who.filter(t => S.completed[t]).length;
  if (S.ended) return `<div class="box sunk"><div class="row between"><div class="stack" style="gap:2px"><b>Test cycle ended</b><span class="small muted">Ended on ${esc(fmtDay(S.ended))} at ${esc(fmtTime(S.ended))}. Every tester got a thank-you summary of what their feedback achieved, in My updates.</span></div><button class="btn sm" data-a="reopenCycle">Reopen test cycle</button></div></div>`;
  if (S.confirmEnd) return `<div class="ask"><b>End the test cycle?</b><span class="small">Each of the ${who.length} tester${who.length !== 1 ? 's' : ''} (${esc(who.join(', '))}) gets one thank-you summary now: what they tested, the tickets and ideas their feedback led to, and what is already fixed.${done < who.length ? ` ${who.length - done} ${who.length - done > 1 ? 'have' : 'has'} not finished all their steps yet.` : ''} You can reopen it later.</span><div class="row"><button class="btn sm go" data-a="endCycle">Yes, end it and thank everyone</button><button class="btn sm" data-a="cancelEnd">Cancel</button></div></div>`;
  return `<div class="box sunk"><div class="row between"><div class="stack" style="gap:2px"><b>When testing is over</b><span class="small muted">End the test cycle to send every tester one thank-you summary of what their feedback achieved. ${done} of ${who.length} tester${who.length !== 1 ? 's have' : ' has'} finished.</span></div><button class="btn sm primary" data-a="askEnd" ${who.length ? '' : 'disabled'}>End test cycle</button></div></div>`;
}
function summaryFor(t) {
  const mine = comments().filter(c => c.tester === t), steps = assigned(t).filter(x => isDone(t, x.step)).length;
  const probs = mine.filter(c => c.cat !== 'nonbug' || S.idea[c.id] === 'bug').length;
  const tickets = new Set(), fixed = new Set(); let linked = 0, ideas = 0, blocker = false;
  mine.forEach(c => {
    const r = ticketOfComment(c.id);
    if (r && r.key) { const tk = S.tickets.find(x => x.key === r.key) || {}; if (r.p.kind !== 'idea') tickets.add(r.key); if (tk.status === 'Done') fixed.add(r.key); if (tk.priority === 'High' && r.p.kind !== 'idea') blocker = true; }
    if (S.known[c.id] === 'link') { linked++; const tk = S.tickets.find(x => x.key === S.knownT[c.id]); if (tk && tk.status === 'Done') fixed.add(tk.key); }
    if (S.idea[c.id] === 'add') ideas++;
  });
  if (!steps) return `Thank you for being part of this test cycle, ${t}. The test cycle has now ended.`;
  let s = `The test cycle has ended. Thank you, ${t}! You checked ${steps} step${steps !== 1 ? 's' : ''} and ${probs ? `reported ${probs} problem${probs !== 1 ? 's' : ''}` : 'found no problems, which is useful to know too'}`;
  const led = []; if (tickets.size) led.push(`${tickets.size} new ticket${tickets.size > 1 ? 's' : ''}`); if (linked) led.push(`${linked} link${linked > 1 ? 's' : ''} to known problems`);
  if (led.length) s += `, which led to ${led.join(' and ')}`;
  s += '.';
  if (fixed.size) s += ` ${fixed.size} of the problems you reported ${fixed.size > 1 ? 'are' : 'is'} already fixed.`;
  if (ideas) s += ` You also gave ${ideas} idea${ideas > 1 ? 's' : ''} for the Good ideas list.`;
  if (blocker) s += ' You helped confirm a high-priority problem.';
  return s + ' Your feedback made this release better.';
}

/* ===================== SHARED UI ===================== */
const I = {
  bug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l1.5 1.5M16 2l-1.5 1.5"/><rect x="7" y="5" width="10" height="14" rx="5"/><path d="M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2M12 9v10"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 6v12" stroke-dasharray="2 2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3M9 11h6M9 15h4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>'
};
const AV = ['#4f6fae', '#b0673d', '#3d8a80', '#7a65b0', '#a8577a', '#5b7d3a', '#9a6417', '#2e6d96'];
const av = (n, cls = 'avatar') => { if (n === 'M') return `<span class="${cls} av-M">UM</span>`; const i = Math.max(0, testers().indexOf(n)); return `<span class="${cls}" style="background:${AV[i % AV.length]}">${esc((n || '?')[0].toUpperCase())}</span>`; };
function toast(msg) { try { document.querySelectorAll('.toastpop').forEach(e => e.remove()); const d = document.createElement('div'); d.className = 'toastpop'; d.setAttribute('role', 'status'); d.innerHTML = I.check + '<span></span>'; d.lastChild.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); } catch (e) { /* ignore */ } }
const GUIDE = {
  tester: ['Choose <b>Pass</b> or <b>Fail</b> for your step.', '<b>Pass:</b> just click <b>Save result</b>. No comment needed.', '<b>Fail:</b> say what you saw in your own words, then click <b>Save result</b>. The AI checks it and may ask one question.', 'Add ideas or more comments to any step at any time, and click <b>Edit</b> to change or add detail to your own comments.'],
  0: ['New feedback, replies and finished tests appear here.', 'Click a message to open the comment it is about.'],
  1: ['Add the steps testers will follow: scenario, screen, action and expected result.', 'Click names to assign testers to each step.', 'Testers then log in through the <b>Tester</b> interface.'],
  2: ['Pick a tester to see their results and comments.', 'Ask a question under any comment. The tester gets a notification.', 'When testing is over, click <b>End test cycle</b>. Every tester gets one thank-you summary of what their feedback achieved.'],
  3: ['Go through every comment: duplicates, already known, good ideas and unique problems.', 'Read the % and the reasons, then decide. <b>Approve</b> sends a comment on to Unique problems.', 'Nothing moves on until you click. A comment marked "Needs more detail" asks you to confirm first.', 'The tester gets a kind message whether you approve it or not.'],
  4: ['Open the <b>chat</b> to ask the testers who reported a problem for more detail.', 'Click <b>Make a ticket</b>. The AI writes a draft from the comments and the chat.', 'Check every field and fix anything that is wrong.', 'When the clarity check is all ✓, click <b>Create ticket</b>.'],
  5: ['Tickets made in Unique problems appear here.', 'Change a status when a developer starts or fixes something. The testers who reported it are told automatically.']
};
function guide(id) {
  if (S.hideGuide[id]) return `<button class="btn link small guide-show" data-a="showGuide" data-v="${id}">Show help for this page</button>`;
  return `<div class="guide"><span class="gi">${I.bulb}</span><div><b>What to do here</b><ol>${GUIDE[id].map(x => `<li>${x}</li>`).join('')}</ol></div><button class="btn sm" data-a="hideGuide" data-v="${id}">Got it</button></div>`;
}
// Each comment has its own chat (UAT manager and the tester), opened in the side panel.
// Which comments share a chat: every comment of a merged problem, otherwise just this one.
function chatGroup(cid) {
  const g = triage().groups.find(x => S.groups[x.anchor] === true && x.members.some(m => m.id === cid && S.mem[m.id] === 'in'));
  if (!g) return { ids: [cid], p: null };
  const ins = g.members.filter(m => S.mem[m.id] === 'in'); if (ins.length < 2) return { ids: [cid], p: null };
  const P = problems(), pid = 'g:' + g.anchor, st = step(ins[0].step);
  const p = [...P.bugs, ...P.ideas].find(x => x.pid === pid) || { pid, kind: 'bug', members: ins, merged: true, title: `${st.screen || st.scen}: ${short(ins[0].text, 60)}` };
  return { ids: ins.map(m => m.id), p };
}
function chatMsgs(g) {
  const out = [];
  g.ids.forEach(id => { const it = itemById(id); if (it) it.thread.forEach(m => out.push({ id: m.id, from: m.from === 'manager' ? 'manager' : id.split('|')[0], text: m.text, at: m.at, img: m.img })); });
  if (g.p) (S.chats[g.p.pid] || []).forEach(m => out.push(m));   // older group-chat messages
  const t = m => /T/.test(m.at || '') ? m.at : '';
  return out.sort((a, b) => t(a) < t(b) ? -1 : t(a) > t(b) ? 1 : 0);
}
const chatPeople = g => [...new Set(g.ids.map(id => id.split('|')[0]))];
function threadHTML(cid, role) {
  const it = itemById(cid); if (!it) return '';
  const g = chatGroup(cid), list = chatMsgs(g), people = chatPeople(g), me = role === 'manager' ? 'manager' : cid.split('|')[0];
  const others = people.filter(x => x !== me);
  if (!list.length) return role === 'manager'
    ? `<button class="btn ${it.thin ? 'sm primary' : 'link small'}" data-a="openPanel" data-t="thread" data-k="${esc(cid)}" style="align-self:flex-start">${people.length > 1 ? `Open a chat with ${esc(people.join(' and '))}` : it.thin ? `Ask ${esc(people[0])} for more detail` : `Ask ${esc(people[0])} a question`}</button>`
    : `<button class="btn link small" data-a="openPanel" data-t="thread" data-k="${esc(cid)}" style="align-self:flex-start">Message the UAT manager about this comment</button>`;
  return launcher('thread', cid, people.length > 1 ? `Group chat · UAT manager, ${people.join(', ')}` : role === 'manager' ? `Chat with ${people[0]}` : 'Chat with the UAT manager', list.length, list[list.length - 1], g.ids);
}
function launcher(t, k, title, n, last, ids) {
  const on = S.panel && (ids || [k]).includes(S.panel.k);
  return `<button class="chatlaunch ${on ? 'on' : ''}" data-a="openPanel" data-t="${t}" data-k="${esc(k)}"><span class="stack" style="gap:2px;min-width:0"><b>${esc(title)}</b><span class="small muted cl-last">${last ? `${last.from === 'manager' ? 'UAT manager' : esc(last.from)}: ${esc(last.text || 'Photo')}${last.text && last.img ? ' · photo' : ''}` : 'No messages yet'}</span></span><span class="small muted">${n} message${n !== 1 ? 's' : ''} ›</span></button>`;
}
const catChip = i => i.cat === 'nonbug' ? '<span class="chip c-idea">Non-bug feedback</span>' : '<span class="chip c-bug">Bug feedback</span>';
const shotHTML = (src, alt) => src ? `<button class="shotbtn" data-a="zoom" aria-label="Open the picture full size"><img class="shotimg" src="${esc(src)}" alt="${esc(alt || 'Screenshot attached by the tester')}"></button>` : '';
const shotOf = c => c.primary && c.shot ? shotHTML(c.shot, `Screenshot from ${c.tester}, step ${c.step}`) : '';
const KIND = { question: ['Question', 'var(--accent)'], reply: ['Reply', 'var(--accent)'], update: ['Status update', 'var(--ok)'], feedback: ['New feedback', 'var(--warn)'], complete: ['Test completed', 'var(--ok)'] };
function noteList(to) {
  const ns = S.notes.filter(n => n.to === to);
  if (!ns.length) return '<div class="empty small">No messages yet.</div>';
  return ns.map(n => `<button class="nitem ${n.read ? '' : 'unread'}" data-a="openNote" data-v="${esc(n.id)}"><span class="dot"></span><span class="stack" style="gap:2px"><span class="kind" style="color:${(KIND[n.kind] || KIND.update)[1]}">${(KIND[n.kind] || KIND.update)[0]}</span><span class="t">${esc(n.text)}</span></span><span class="tm">${esc(n.at)}</span></button>`).join('');
}

/* ===================== FIRST RUN ===================== */
const fmtDate = at => at && /T/.test(at) ? fmtDay(at) : '';
function cycleCard(c, done) {
  const st = c.stats || {}, line = st.testers !== undefined ? `${st.testers} tester${st.testers !== 1 ? 's' : ''} · ${st.done || 0} of ${st.steps || 0} steps done · ${st.comments || 0} comment${st.comments !== 1 ? 's' : ''} · ${st.tickets || 0} ticket${st.tickets !== 1 ? 's' : ''}` : 'Open it to see its progress.';
  return `<div class="cyclecard"><div class="cyclebar"><h3>${esc(c.name)}</h3>${done ? '<span class="chip c-ok">Completed</span>' : st.waiting ? `<span class="chip c-bug">${st.waiting} to decide</span>` : '<span class="chip c-new">In progress</span>'}</div>
  <span class="small muted">${c.app ? 'Testing ' + esc(c.app) + ' · ' : ''}${done ? 'Ended ' + esc(fmtDate(c.ended) || '') : 'Started ' + esc(fmtDate(c.created) || '')}</span><span class="small">${esc(line)}</span>
  <div class="row">${done ? `<button class="btn sm" data-a="openCycle" data-v="${esc(c.id)}">View</button><button class="btn sm primary" data-a="reopenFromHome" data-v="${esc(c.id)}">Reopen test cycle</button>` : `<button class="btn sm primary" data-a="openCycle" data-v="${esc(c.id)}">Open</button>`}</div></div>`;
}
// The first screen: every test cycle, and a way to add one.
// Notifications from every test cycle, grouped by test cycle. Clicking one opens that test cycle at the right place.
function homeUpdates() {
  const ns = CY.notes, un = ns.filter(n => !n.is_read).length;
  if (!ns.length) return '<div class="empty"><b>No messages yet</b><span>Messages from every test cycle appear here.</span></div>';
  const groups = CY.list.map(c => [c, ns.filter(n => n.cycle === c.id)]).filter(([, l]) => l.length);
  return `<div class="row between"><span class="small muted">${un ? `${un} unread` : 'All read'} · from ${groups.length} test cycle${groups.length !== 1 ? 's' : ''}</span>${un ? '<button class="btn sm" data-a="homeReadAll">Mark all as read</button>' : ''}</div>
  ${groups.map(([c, l]) => { const u = l.filter(n => !n.is_read).length, open = !!CY.openG[c.id]; return `<div class="stack notegroup"><button class="droptog" data-a="togG" data-v="${esc(c.id)}" aria-expanded="${open}"><span class="chev">${open ? '▾' : '▸'}</span><b>${esc(c.name)}</b>${c.status === 'completed' ? '<span class="chip c-ok">Completed</span>' : ''}<span class="small muted">${l.length} notification${l.length !== 1 ? 's' : ''}</span>${u ? `<span class="badge inline">${u} new</span>` : ''}</button>
    ${!open ? '' : l.map(n => `<button class="nitem ${n.is_read ? '' : 'unread'}" data-a="homeNote" data-c="${esc(n.cycle)}" data-v="${esc(n.id)}"><span class="dot"></span><span class="stack" style="gap:2px"><span class="kind" style="color:${(KIND[n.kind] || KIND.update)[1]}">${(KIND[n.kind] || KIND.update)[0]}</span><span class="t">${esc(n.body)}</span></span><span class="tm">${esc(n.sent_at)}</span></button>`).join('')}</div>`; }).join('')}`;
}
function vHome() {
  const isT = S.role === 'tester', mine = isT ? myCycles() : CY.list;
  const prog = mine.filter(c => c.status !== 'completed'), done = mine.filter(c => c.status === 'completed'), un = CY.notes.filter(n => !n.is_read).length;
  if (isT && !CY.me) { const ts = allTesters();
    return `<section class="panel"><div class="phead"><div><span class="eyebrow">Tester interface</span><h2>Who are you logging in as?</h2><p class="muted">Pick your name. These are the testers in every test cycle.</p></div></div>
    <div class="login">${ts.map(t => { const n = CY.list.filter(c => (c.people || []).includes(t) && c.status !== 'completed').length; return `<button class="who-card" data-a="login" data-v="${esc(t)}">${av(t)}<b style="font-size:16px">${esc(t)}</b><span class="small muted">${n} test cycle${n !== 1 ? 's' : ''} in progress</span></button>`; }).join('') || '<div class="empty small">No testers yet. The UAT manager adds testers when they start a test cycle.</div>'}</div>
    <p class="note">No password in this version: pick your own name.</p></section>`; }
  const tab = S.htab || (isT ? 'prog' : prog.length || done.length ? 'prog' : 'new');
  const tabs = isT ? [['prog', 'Test Cycles In Progress', prog.length], ['done', 'Completed Test Cycles', done.length], ['updates', 'My updates', un]]
    : [['prog', 'Test Cycles In Progress', prog.length], ['done', 'Completed Test Cycles', done.length], ['updates', 'My updates', un], ['new', 'Add a new test cycle', 0]];
  if (isT) {
    const card = (c, d) => `<div class="cyclecard"><div class="cyclebar"><h3>${esc(c.name)}</h3>${d ? '<span class="chip c-ok">Completed</span>' : '<span class="chip c-new">In progress</span>'}</div><span class="small muted">${c.app ? 'Testing ' + esc(c.app) + ' · ' : ''}${d ? 'Ended ' + esc(fmtDate(c.ended) || '') : 'Started ' + esc(fmtDate(c.created) || '')}</span><div class="row"><button class="btn sm ${d ? '' : 'primary'}" data-a="openCycle" data-v="${esc(c.id)}">${d ? 'View' : 'Open my test script'}</button></div></div>`;
    const body = tab === 'updates' ? homeUpdates() : tab === 'done'
      ? (done.length ? `<div class="cyclelist">${done.map(c => card(c, true)).join('')}</div>` : '<div class="empty"><b>No completed test cycles yet</b><span>Test cycles you were part of appear here when the UAT manager ends them.</span></div>')
      : (prog.length ? `<div class="cyclelist">${prog.map(c => card(c, false)).join('')}</div>` : '<div class="empty"><b>No test cycles in progress</b><span>When the UAT manager adds you to a test cycle, it appears here.</span></div>');
    return `<section class="panel"><div class="phead"><div><span class="eyebrow">Tester interface</span><h2>Hi tester ${esc(CY.me)},</h2><p class="muted">Open a test cycle to do your steps, look back at completed ones, or read your messages.</p></div><button class="btn sm" data-a="logout">Not ${esc(CY.me)}? Switch person</button></div>
    <div class="hometabs" role="tablist">${tabs.map(([v, l, n]) => `<button class="hometab" role="tab" aria-selected="${tab === v}" data-a="htab" data-v="${v}">${l}${v === 'new' ? '' : v === 'updates' ? (n ? `<span class="badge inline">${n}</span>` : '') : `<span class="badge inline zero">${n}</span>`}</button>`).join('')}</div>
    ${body}</section>`;
  }
  const body = tab === 'new' ? vSetup(true) : tab === 'updates' ? homeUpdates() : tab === 'done'
    ? (done.length ? `<div class="cyclelist">${done.map(c => cycleCard(c, true)).join('')}</div>` : '<div class="empty"><b>No completed test cycles yet</b><span>When testing is over, open a test cycle and click End test cycle. It then moves here.</span></div>')
    : (prog.length ? `<div class="cyclelist">${prog.map(c => cycleCard(c, false)).join('')}</div>` : `<div class="empty"><b>No test cycles in progress</b><span>Start one to set up testers and test steps.</span><button class="btn primary" data-a="htab" data-v="new">Add a new test cycle</button></div>`);
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">ReleaseReady</span><h2>Hi UAT manager</h2><p class="muted">Open a test cycle to keep working on it, look back at a completed one, read your messages from every test cycle, or start a new one.</p></div></div>
  <div class="hometabs" role="tablist">${tabs.map(([v, l, n]) => `<button class="hometab" role="tab" aria-selected="${tab === v}" data-a="htab" data-v="${v}">${v === 'new' ? '+ ' : ''}${l}${v === 'new' ? '' : v === 'updates' ? (n ? `<span class="badge inline">${n}</span>` : '') : `<span class="badge inline zero">${n}</span>`}</button>`).join('')}</div>
  ${body}</section>`;
}
function vSetup(inHome) {
  const s = S.setup;
  return `<section class="${inHome ? 'stack lg' : 'panel'} setup">${inHome ? '' : `<div class="phead"><div><span class="eyebrow">Welcome to ReleaseReady</span><h2>Add a new test cycle</h2></div></div>`}<p class="muted">Tell us who is testing. You can add the test steps next. Everything is saved to the database as you go.</p>
  <div class="form">
    <label class="fl wide" for="su-cname">Name of this test cycle<input type="text" class="full" id="su-cname" data-a="suCname" value="${esc(s.cname)}" placeholder="e.g. Release 2.1 UAT (leave empty for Test cycle ${CY.list.length + 1})"></label>
    <label class="fl wide" for="su-app">Name of the app you are testing (optional)<input type="text" class="full" id="su-app" data-a="suApp" value="${esc(s.app)}" placeholder="e.g. ExpenseTracker 2.0"></label>
    <label class="fl" for="su-n">Number of testers<input type="number" id="su-n" data-a="suN" min="1" max="20" value="${s.n}"></label>
  </div>
  <div class="stack"><span class="eyebrow">Tester names</span><div class="grid3">${s.names.map((nm, i) => `<label class="fl" for="su-name-${i}">Tester ${i + 1}<input type="text" class="full" id="su-name-${i}" data-a="suName" data-i="${i}" value="${esc(nm)}" placeholder="Name"></label>`).join('')}</div></div>
  ${s.err ? `<div class="q">${esc(s.err)}</div>` : ''}
  <div class="row"><button class="btn primary" data-a="suStart">Start the test cycle</button><span class="small muted">You can add more testers later in Test script.</span></div></section>`;
}

/* ===================== TESTER INTERFACE ===================== */
function tLogin() {
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">Tester interface</span><h2>Who are you logging in as?</h2><p class="muted">Pick your name. These are the testers in the UAT manager's test script.</p></div></div>
  <div class="login">${testers().map(t => { const a = assigned(t), d = a.filter(s => isDone(t, s.step)).length, u = unread(t); return `<button class="who-card" data-a="login" data-v="${esc(t)}"><span class="row between">${av(t)}${u ? `<span class="badge inline">${u} new</span>` : ''}</span><b style="font-size:16px">${esc(t)}</b><span class="small muted">${a.length} step${a.length !== 1 ? 's' : ''} to test · ${d} done</span><span class="prog"><i style="width:${a.length ? d / a.length * 100 : 0}%"></i></span></button>`; }).join('')}</div>
  <p class="note">No password in this version: pick your own name.</p></section>`;
}
function tStep(s) {
  const t = S.me, k = t + '|' + s.step, res = S.res[k];
  const head = `<div class="row between"><div class="stack" style="gap:2px"><span class="eyebrow">${esc(s.scen)} · step ${esc(s.step)}</span><h3>${esc(s.act)}</h3><span class="small"><span class="muted">Expected:</span> ${esc(s.exp)}</span></div>${res ? `<span class="chip ${res.r === 'pass' ? 'c-ok' : 'c-bad'}">${res.r === 'pass' ? 'Pass' : 'Fail'} · saved</span>` : '<span class="chip c-grey">To do</span>'}</div>`;
  if (!res) {
    const u = S.ui[k] || (S.ui[k] = { r: null, text: '', shot: '' }), ok = canSave('p', k);
    return `<div class="stepcard">${head}
    <div class="stack" style="gap:6px"><span class="small muted" style="font-weight:600">Did it work as expected?</span><div class="bigresult"><button class="btn ${u.r === 'pass' ? 'on-pass' : ''}" data-a="setR" data-k="${esc(k)}" data-v="pass">${I.check}Pass</button><button class="btn ${u.r === 'fail' ? 'on-fail' : 'fail'}" data-a="setR" data-k="${esc(k)}" data-v="fail">${I.x}Fail</button></div></div>
    ${u.r ? `<div class="ctx"><span>Step ${esc(s.step)}</span>${s.screen ? `<span>${esc(s.screen)}</span>` : ''}<span>${esc(ENV)}</span><span>auto-filled</span></div>
    ${u.r === 'fail' ? `<label class="fl" for="p-${esc(k)}">What went wrong? (required · bug feedback)<textarea id="p-${esc(k)}" rows="2" data-a="cmt" data-f="p" data-k="${esc(k)}" placeholder="What did you see on screen?">${esc(u.text)}</textarea></label>` : ''}
    <div class="helper ${!ok ? 'need' : ''}" id="h-p-${esc(k)}">${helperHTML('p', k)}</div>
    <div class="row">${u.shot ? `<span class="shot">${shotHTML(u.shot)}<button class="btn link small" data-a="shotClear" data-k="${esc(k)}">Remove</button></span>` : `<label class="btn sm filebtn">+ Attach screenshot<input type="file" accept="image/*" data-a="shotFile" data-k="${esc(k)}"></label>`}${saveBtn('p', k)}</div>` : '<span class="small muted">Do the step in the app, then choose Pass or Fail.</span>'}</div>`;
  }
  const x = S.ux[k];
  const items = res.items.map(i => { const c = comments().find(z => z.id === i.id); const st = c ? stageOf(c) : 0;
    return `<div class="citem" id="cm-${esc(i.id)}"><div class="row between"><div class="row">${catChip(i)}${i.primary ? '<span class="small muted">Reason for result</span>' : ''}</div>${c ? stageChips(st) : '<span class="small muted">Pass recorded</span>'}</div>${S.ue[i.id] ? editBox(i) : `<div class="row between" style="align-items:flex-start;flex-wrap:nowrap"><span class="quote">"${esc(i.text)}"</span><button class="btn link small" data-a="editC" data-k="${esc(i.id)}" style="flex:none">Edit</button></div>${i.edited ? '<span class="small muted">Edited</span>' : ''}${i.thin ? '<span class="small q">Marked "needs more detail". Add more detail with <b>Edit</b>, or answer the UAT manager in the chat.</span>' : ''}`}${i.primary ? shotHTML(res.shot) : ''}${threadHTML(i.id, 'tester')}</div>`; }).join('') || (res.r === 'pass' ? '<span class="small muted">Passed. No comment needed. You can add an idea or suggestion below.</span>' : '');
  let add = '';
  if (x && x.open) { const ok = canSave('x', k);
    add = `<div class="box sunk"><span class="eyebrow">Add a comment to step ${esc(s.step)}</span>
    <div class="radio" role="group" aria-label="Category"><button class="bug" aria-pressed="${x.cat === 'bug'}" data-a="xcat" data-k="${esc(k)}" data-v="bug">Bug feedback</button><button class="nonbug" aria-pressed="${x.cat === 'nonbug'}" data-a="xcat" data-k="${esc(k)}" data-v="nonbug">Non-bug feedback (idea, suggestion)</button></div>
    <label class="fl" for="x-${esc(k)}">Comment<textarea id="x-${esc(k)}" rows="2" data-a="cmt" data-f="x" data-k="${esc(k)}" placeholder="${x.cat === 'bug' ? 'What went wrong?' : 'What would make this better?'}">${esc(x.text)}</textarea></label>
    <div class="helper ${!ok ? 'need' : ''}" id="h-x-${esc(k)}">${helperHTML('x', k)}</div>
    <div class="row">${saveBtn('x', k)}<button class="btn sm" data-a="closeX" data-k="${esc(k)}">Cancel</button></div></div>`;
  } else add = `<button class="btn sm" data-a="openX" data-k="${esc(k)}" style="align-self:flex-start">+ Add a comment (bug or non-bug)</button>`;
  return `<div class="stepcard done">${head}<div class="stack">${items}</div>${add}</div>`;
}
function editBox(i) {
  const k = i.id;
  return `<div class="box sunk"><label class="fl" for="e-${esc(k)}">Edit your comment<textarea id="e-${esc(k)}" rows="3" data-a="cmt" data-f="e" data-k="${esc(k)}">${esc(S.ue[k].text)}</textarea></label>
  <div class="helper" id="h-e-${esc(k)}">${helperHTML('e', k)}</div>
  <div class="row">${saveBtn('e', k)}<button class="btn sm" data-a="cancelE" data-k="${esc(k)}">Cancel</button><span class="small muted">The UAT manager is told when you change it.</span></div></div>`;
}
function tScript() {
  const t = S.me, a = assigned(t), d = a.filter(s => isDone(t, s.step)).length;
  let cur = S.openStep && a.some(s => t + '|' + s.step === S.openStep) ? S.openStep : null;
  if (!cur) { const nx = a.find(s => !isDone(t, s.step)); cur = nx ? t + '|' + nx.step : null; }
  const stepper = a.map((s, i) => { const k = t + '|' + s.step, dn = isDone(t, s.step); return `${i ? '<span class="sline"></span>' : ''}<button class="sdot ${dn ? 'done' : ''} ${k === cur ? 'cur' : ''}" data-a="openStep" data-k="${esc(k)}"><span class="c">${dn ? I.check : i + 1}</span>Step ${esc(s.step)}</button>`; }).join('');
  const cards = a.map(s => { const k = t + '|' + s.step, dn = isDone(t, s.step);
    if (k === cur) { let h = tStep(s).replace('class="stepcard', 'class="stepcard cur'); if (!dn) h = h.replace('<div class="row between"><div class="stack" style="gap:2px">', '<span class="nextlabel">' + I.play + ' Your next step</span><div class="row between"><div class="stack" style="gap:2px">'); return h; }
    const r = S.res[k];
    return `<div class="stepcard mini"><div class="row"><span class="sdot ${dn ? 'done' : ''}" style="cursor:default;border:none;padding:0"><span class="c">${dn ? I.check : '·'}</span></span><div class="stack" style="gap:0"><b>Step ${esc(s.step)} · ${esc(s.act)}</b><span class="small muted">${dn ? `${r.r === 'pass' ? 'Pass' : 'Fail'}${r.items.length ? ` · ${r.items.length} comment${r.items.length !== 1 ? 's' : ''}` : ''}` : 'Not tested yet'}</span></div></div><div class="row">${dn ? (() => { const n = r.items.reduce((a, i) => a + i.thread.length, 0); return n ? `<button class="btn sm" data-a="openStep" data-k="${esc(k)}">Chats (${n})</button>` : ''; })() : ''}<button class="btn sm" data-a="openStep" data-k="${esc(k)}">${dn ? 'Open' : 'Start'}</button></div></div>`; }).join('');
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">My test script</span><h2>${d === a.length && a.length ? 'All steps done. Thank you!' : `<span class="muted">Hi, ${esc(t)}!</span> You have ${a.length - d} step${a.length - d !== 1 ? 's' : ''} to test`}</h2><p class="muted">Do one step at a time. Write what you saw in your own words. The AI only checks that a developer can act on it. It never changes your words.</p></div></div>
  ${guide('tester')}
  ${S.ended ? '<div class="note">The UAT manager has ended this test cycle. Thank you! You can still read your messages in My updates.</div>' : ''}
  ${a.length ? `<div class="stepper">${stepper}</div>` : ''}
  ${d === a.length && a.length ? '<div class="toast">You have completed your test. The UAT manager has been told. You can still open any step to add a comment.</div>' : ''}
  <div class="stack lg">${cards || '<div class="empty">No steps are assigned to you yet. The UAT manager assigns steps in the Test script.</div>'}</div></section>`;
}
function tUpdates() {
  const t = S.me, mine = comments().filter(c => c.tester === t);
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">My updates</span><h2>Messages from the UAT manager</h2><p class="muted">Questions, replies and status updates about your feedback. Click a message to open the comment it is about.</p></div>${unread(t) ? `<button class="btn sm" data-a="readAll" data-v="${esc(t)}">Mark all as read</button>` : ''}</div>
  <div class="stack">${noteList(t)}</div>
  <div class="stack"><span class="eyebrow">Status of my feedback</span>${mine.map(c => `<div class="box"><div class="row between"><div class="stack" style="gap:3px"><div class="row">${catChip(c)}<span class="quote small">"${esc(c.text)}"</span></div>${stepUnder(c)}</div>${stageChips(stageOf(c))}</div>${S.sent[c.id] ? `<div class="inbox small">${esc(S.sent[c.id])}</div>` : ''}${threadHTML(c.id, 'tester')}</div>`).join('') || '<div class="empty small">You have not sent any feedback yet.</div>'}</div></section>`;
}
function testerUI() {
  if (!S.me) S.me = CY.me;
  if (!S.me || !testers().includes(S.me)) return `<section class="panel"><div class="empty"><b>${S.me ? esc(S.me) + ' is not a tester in this test cycle' : 'Who are you?'}</b><span>Go back to your test cycles and pick one you are part of.</span><button class="btn primary" data-a="goHome">← My test cycles</button></div></section>`;
  return `<div class="banner tst"><span class="row">${av(S.me, 'av')}<span>Logged in as <b>${esc(S.me)}</b> · tester</span></span><span class="row"><span class="small muted">Your messages are in My updates on the first screen.</span><button class="btn sm" data-a="logout">Switch person</button></span></div>
  ${tScript()}${myFeedback()}`;
}
// Inbox: only the comments the UAT manager has written about, each with its chat. It opens and closes like a drop-down.
function myFeedback() {
  const t = S.me, mine = comments().filter(c => c.tester === t && chatMsgs(chatGroup(c.id)).some(m => m.from === 'manager'));
  const seen = new Set(), list = mine.filter(c => { const k = chatGroup(c.id).ids.join(','); if (seen.has(k)) return false; seen.add(k); return true; });   // a merged problem is listed once
  const open = S.inboxOpen && list.length;
  return `<section class="panel"><button class="droptog" data-a="togInbox" aria-expanded="${!!open}"><span class="chev">${open ? '▾' : '▸'}</span><span class="stack" style="gap:2px;text-align:left"><b style="font-size:17px">Inbox</b><span class="small muted">${list.length ? `Messages from the UAT manager about ${list.length} of your comment${list.length !== 1 ? 's' : ''}` : 'No messages from the UAT manager yet'}</span></span>${list.length ? `<span class="badge inline">${list.length}</span>` : ''}</button>
  ${open ? `<div class="stack">${list.map(c => { const g = chatGroup(c.id), ms = chatMsgs(g), last = ms.filter(m => m.from === 'manager').pop();
    return `<div class="box"><div class="row between"><div class="stack" style="gap:3px"><div class="row">${catChip(c)}<span class="quote small">"${esc(c.text)}"</span></div>${stepUnder(c)}</div>${stageChips(stageOf(c))}</div>
    <div class="inbox small"><b>UAT manager${g.p ? ' (group chat with ' + esc(chatPeople(g).filter(x => x !== t).join(', ')) + ')' : ''}:</b> ${esc(last.text || 'Sent a photo')}</div>${threadHTML(c.id, 'tester')}</div>`; }).join('')}</div>` : ''}</section>`;
}

/* ===================== MANAGER INTERFACE ===================== */
function v1() {
  const rows = S.script.map((r, i) => { const used = testers().some(t => S.res[t + '|' + r.step]);
    return `<tr><td>${esc(r.scen)}</td><td class="mono">${esc(r.step)}</td><td>${esc(r.screen)}</td><td>${esc(r.act)}</td><td>${esc(r.exp)}</td><td><div class="row" style="gap:4px">${testers().map(t => `<button class="tchip" aria-pressed="${r.who.includes(t)}" data-a="assign" data-i="${i}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div></td><td>${used ? '<span class="small muted" title="Testers have results on this step">in use</span>' : `<button class="btn link small" data-a="delStep" data-i="${i}">Remove</button>`}</td></tr>`; }).join('');
  const scens = [...new Set(S.script.map(s => s.scen))];
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 1</span><h2>Test script</h2><p class="muted">The scenarios, steps and expected results testers will follow. Click a name to assign or unassign a tester. Each tester sees only their own steps.</p></div></div>
  <div class="row"><span class="small muted">Testers:</span>${testers().map(t => `<span class="row" style="gap:6px">${av(t, 'av')}<b class="small">${esc(t)}</b></span>`).join('')}
    <input type="text" id="nt-name" placeholder="Add a tester" aria-label="New tester name"><button class="btn sm" data-a="addTester">Add tester</button></div>
  ${S.script.length ? `<div class="tablewrap"><table><thead><tr><th>Scenario</th><th>Step</th><th>Screen</th><th>Action</th><th>Expected result</th><th>Assigned to</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty"><b>No steps yet</b><span>Add the first step below, for example scenario "Login", action "Enter email and password", expected "Dashboard opens".</span></div>'}
  <div class="box sunk"><span class="eyebrow">Add a step</span>
    <div class="form"><label class="fl" for="ns-scen">Scenario<input type="text" class="full" id="ns-scen" list="scen-list" placeholder="e.g. Expenses"><datalist id="scen-list">${scens.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
    <label class="fl" for="ns-screen">Screen (optional)<input type="text" class="full" id="ns-screen" placeholder="e.g. Add Expense"></label>
    <label class="fl" for="ns-act">Action<input type="text" class="full" id="ns-act" placeholder="e.g. Click Save"></label>
    <label class="fl" for="ns-exp">Expected result<input type="text" class="full" id="ns-exp" placeholder='e.g. "Saved" message shows'></label></div>
    <div class="row"><button class="btn primary sm" data-a="addStep">Add step</button><span class="small muted" id="ns-err"></span></div></div>
  <div class="row between"><p class="note">${S.script.reduce((a, s) => a + s.who.length, 0)} tester-steps across ${S.script.length} step${S.script.length !== 1 ? 's' : ''}.</p><button class="btn primary" data-a="sec" data-v="2">See testing progress →</button></div></section>`;
}
function v2() {
  if (!S.mtester || !testers().includes(S.mtester)) S.mtester = testers()[0];
  const cards = testers().map(t => { const a = assigned(t), d = a.filter(s => isDone(t, s.step)).length, st = d === a.length && a.length ? ['Completed', 'c-ok'] : d ? ['In progress', 'c-bug'] : ['Not started', 'c-grey'];
    return `<button class="pcard" aria-pressed="${S.mtester === t}" data-a="mtester" data-v="${esc(t)}"><span class="row between"><b>${esc(t)}</b><span class="chip ${st[1]}">${st[0]}</span></span><span class="row small"><span class="muted">${d}/${a.length}</span><span class="prog"><i style="width:${a.length ? d / a.length * 100 : 0}%"></i></span></span></button>`; }).join('');
  const t = S.mtester, a = assigned(t);
  const detail = a.map(s => { const k = t + '|' + s.step, res = S.res[k];
    return `<div class="stepcard ${res ? 'done' : ''}"><div class="row between"><div class="stack" style="gap:2px"><span class="eyebrow">${esc(s.scen)} · step ${esc(s.step)}</span><b>${esc(s.act)}</b><span class="small"><span class="muted">Expected:</span> ${esc(s.exp)}</span></div>${res ? `<span class="chip ${res.r === 'pass' ? 'c-ok' : 'c-bad'}">${res.r === 'pass' ? 'Pass' : 'Fail'}</span>` : '<span class="chip c-grey">Not tested yet</span>'}</div>
    ${res ? `<span class="small muted">${esc(res.env)}</span>` + res.items.map(i => `<div class="citem" id="cm-${esc(i.id)}"><div class="row">${catChip(i)}${i.primary ? '<span class="small muted">Reason for result</span>' : ''}${i.thin ? '<span class="chip c-thin">Needs more detail</span>' : ''}${i.edited ? '<span class="chip c-grey">Edited</span>' : ''}</div><span class="quote">"${esc(i.text)}"</span>${i.primary ? shotHTML(res.shot) : ''}${threadHTML(i.id, 'manager')}</div>`).join('') + (res.items.length ? '' : '<span class="small muted">Passed. No comment.</span>') : ''}</div>`; }).join('');
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 2</span><h2>Testing progress</h2><p class="muted">Testers record results in the Tester interface (switch at the top). Here you can follow their progress, read every comment and ask a tester a question under their feedback.</p></div></div>
  <div class="grid3">${cards}</div>
  ${endCycleHTML()}
  <div class="stack"><span class="eyebrow">${esc(t || '')}'s steps</span>${detail || '<div class="empty small">No steps assigned to this tester yet.</div>'}</div>
  <div class="row between"><span></span><button class="btn primary" data-a="sec" data-v="3">Go to bugs and comments →</button></div></section>`;
}
const apprRow = c => { const d = S.appr[c.id];
  return !d ? `<div class="row"><button class="btn go" data-a="approve" data-k="${esc(c.id)}" data-v="yes">Approve as a problem</button><button class="btn" data-a="approve" data-k="${esc(c.id)}" data-v="no">Don't approve</button></div>`
    : `<div class="row"><span class="toast">${d === 'yes' ? 'Approved. It is now in Unique problems.' : 'Not approved. It stays in the test record.'}</span><button class="btn link small" data-a="approve" data-k="${esc(c.id)}" data-v="">${undoLabel([c.id])}</button></div>`; };
// Shown instead of approving when a comment is marked "Needs more detail".
function confirmHTML(match) {
  const q = S.confirm; if (!q || !match(q)) return '';
  const who = [...new Set(q.ids.map(id => id.split('|')[0]))], names = who.join(' and ');
  const attrs = Object.entries(q.data).filter(([x]) => x !== 'a' && x !== 'sure').map(([x, y]) => `data-${x}="${esc(y)}"`).join(' ');
  return `<div class="ask"><b>${esc(names)}'s comment${q.ids.length > 1 ? 's are' : ' is'} marked "Needs more detail".</b><span class="small">A developer may not be able to act on it yet. Are you sure you want to approve it, or would you like to ask ${esc(who.length > 1 ? 'them' : names)} for more detail first?</span>
  <div class="row"><button class="btn sm go" data-a="${q.a}" ${attrs} data-sure="1">Yes, approve it</button><button class="btn sm primary" data-a="askFirst">Ask ${esc(who.length > 1 ? 'them' : names)} first</button><button class="btn sm" data-a="cancelConfirm">Cancel</button></div></div>`;
}
function v3() {
  const T = triage();
  if (!T.cs.length) return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 3 · duplicate finder</span><h2>Bugs and comments</h2></div></div><div class="empty"><b>No bugs or comments yet</b><span>Failed steps and extra comments from testers appear here.</span></div></section>`;
  // Every card has a type (dup, known, idea, bug) and says whether it still needs a decision, so the boxes above can filter.
  const byScen = {}; let pt = '', pw = false;
  const place = (scen, html) => (byScen[scen] = byScen[scen] || []).push({ html, type: pt, wait: pw });
  const quoteHead = (c, chip) => `<div class="row between"><div class="row">${chip}${c.thin ? '<span class="chip c-thin">Needs more detail</span>' : ''}${c.edited ? '<span class="chip c-grey">Edited</span>' : ''}<h3>${esc(c.tester)}: <span class="quote" style="font-weight:400">"${esc(c.text)}"</span></h3></div></div>${stepUnder(c)}${shotOf(c)}`;
  // A comment kept apart from a duplicate group: its own card, decided on its own.
  const sepCard = (c, g, note) => { pt = 'bug'; pw = !S.appr[c.id];
    place(step(c.step).scen, `<div class="box ${!S.appr[c.id] ? 'hl' : ''}">${quoteHead(c, '<span class="chip c-new">Separate comment</span>')}<div class="row"><span class="small muted">${note}</span><button class="btn link small" data-a="undoMerge" data-g="${esc(g.anchor)}">Undo the merge decision</button></div>${apprRow(c)}${confirmHTML(q => q.data.k === c.id)}${told(c)}${threadHTML(c.id, 'manager')}</div>`); };
  T.groups.forEach(g => {
    g.members.forEach(c => { if (S.sel[c.id] === undefined) S.sel[c.id] = memberScore(c, g).score >= 60; });
    const merged = S.groups[g.anchor], scores = g.members.map(c => memberScore(c, g).score), avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const a0 = g.members[0], st0 = step(a0.step), gk = 'g:' + g.anchor;
    if (merged === false) { g.members.forEach(c => sepCard(c, g, 'You chose not to merge it with the possible duplicates.')); return; }
    if (merged === true) {
      const ins = g.members.filter(c => S.mem[c.id] === 'in'), news = g.members.filter(c => !S.mem[c.id]);
      g.members.filter(c => S.mem[c.id] === 'out').forEach(c => sepCard(c, g, 'Not ticked when you merged, so it is a separate comment.'));
      if (!ins.length) return;
      const d = S.appr[gk], row = c => `<div class="member" id="cm3-${esc(c.id)}"><span class="chip c-ok">Merged</span><div class="stack" style="gap:3px"><div class="row"><b>${esc(c.tester)}</b>${c.thin ? '<span class="chip c-thin">Needs more detail</span>' : ''}${c.edited ? '<span class="chip c-grey">Edited</span>' : ''}</div><span class="quote">"${esc(c.text)}"</span>${stepUnder(c)}${shotOf(c)}${S.sent[c.id] || S.pending[c.id] ? told(c) : ''}</div></div>`;
      const late = c => `<div class="member" id="cm3-${esc(c.id)}"><span class="chip c-new">New</span><div class="stack" style="gap:3px"><div class="row"><b>${esc(c.tester)}</b>${c.thin ? '<span class="chip c-thin">Needs more detail</span>' : ''}</div><span class="quote">"${esc(c.text)}"</span>${stepUnder(c)}${shotOf(c)}<div class="row"><span class="small q">Arrived after you merged and looks like the same problem.</span><button class="btn sm go" data-a="memIn" data-g="${esc(g.anchor)}" data-k="${esc(c.id)}">Add to the merged comment</button><button class="btn sm" data-a="memOut" data-g="${esc(g.anchor)}" data-k="${esc(c.id)}">Keep it separate</button></div></div></div>`;
      pt = 'dup'; pw = !d || news.length > 0;
      place(st0.scen, `<div class="box ${!d ? 'hl' : ''}"><div class="row between"><div class="row"><span class="chip c-bug">Merged comment · ${ins.length}</span><h3>${ins.length > 1 ? `${ins.length} testers reported the same problem` : 'One comment'}${st0.screen ? ' on ' + esc(st0.screen) : ''}</h3></div><button class="btn link small" data-a="undoMerge" data-g="${esc(g.anchor)}">Undo merge</button></div>
      <div>${ins.map(row).join('')}${news.map(late).join('')}</div>
      ${ins.length > 1 ? `<div class="stack" style="gap:4px"><span class="small muted">The merged comments share one group chat: you and ${esc(chatPeople(chatGroup(ins[0].id)).join(', '))}. Everyone sees every message.</span>${threadHTML(ins[0].id, 'manager')}</div>` : threadHTML(ins[0].id, 'manager')}
      ${!d ? `<div class="row"><button class="btn go" data-a="approve" data-k="${esc(gk)}" data-v="yes">Approve as one problem</button><button class="btn" data-a="approve" data-k="${esc(gk)}" data-v="no">Don't approve</button><span class="small muted">Approved, it moves to Unique problems as one problem.</span></div>`
        : `<div class="row"><span class="toast">${d === 'yes' ? 'Approved. It is now one problem in Unique problems.' : 'Not approved. It stays in the test record.'}</span><button class="btn link small" data-a="approve" data-k="${esc(gk)}" data-v="">${undoLabel(ins.map(x => x.id))}</button></div>`}
      ${confirmHTML(q => q.data.k === gk)}</div>`);
      return;
    }
    const mrow = c => { const p = memberScore(c, g), v = p.score, [l] = lvl(v);
      return `<div class="member" id="cm3-${esc(c.id)}"><input type="checkbox" id="sel-${esc(c.id)}" data-a="sel" data-k="${esc(c.id)}" ${S.sel[c.id] ? 'checked' : ''} aria-label="Include ${esc(c.tester)}'s comment in the merge"><div class="stack" style="gap:3px"><div class="row"><b>${esc(c.tester)}</b>${c.thin ? '<span class="chip c-thin">Needs more detail</span>' : ''}${c.edited ? '<span class="chip c-grey">Edited</span>' : ''}${S.sel[c.id] ? '' : '<span class="chip c-grey">Not ticked: stays a separate comment</span>'}</div><span class="quote">"${esc(c.text)}"</span>${stepUnder(c)}${shotOf(c)}
      <div class="row small muted"><span>${mark(p.sameStep)} same step</span><span>${mark(p.sameScreen)} same screen</span><span>${mark(p.sim >= 0.5 ? true : p.sim >= 0.3 ? null : false)} wording ${Math.round(p.sim * 100)}% alike</span><span>${mark(errSeen(c))} error or screenshot</span></div>
      ${S.sent[c.id] || S.pending[c.id] ? told(c) : ''}${threadHTML(c.id, 'manager')}</div>
      <span class="mono" style="font-weight:600;color:var(--${l === 'h' ? 'ok' : l === 'm' ? 'warn' : 'bad'})">${v}%</span></div>`; };
    const n = g.members.filter(c => S.sel[c.id]).length;
    pt = 'dup'; pw = true;
    place(st0.scen, `<div class="box hl"><div class="row"><span class="chip c-bug">Possible duplicates</span><h3>${g.members.length} comments may be the same bug${st0.screen ? ' on ' + esc(st0.screen) : ''}</h3></div>${conf(avg, 'Duplicate match')}
    <div class="why"><b>Why grouped</b><span>Score for each comment, against its closest match = same step (35) + same screen (20) + wording alike (up to 30) + both show an error or screenshot (15).</span>${scores.some(s => s < 60) ? '<span class="q"><b>Not sure about one comment.</b> Its score is low, so it starts unticked. Tick it if you think it is the same bug.</span>' : ''}</div>
    <div>${g.members.map(mrow).join('')}</div>
    ${confirmHTML(q => q.a === 'merge' && q.data.g === g.anchor)}
    <div class="row"><button class="btn go" data-a="merge" data-g="${esc(g.anchor)}" ${n ? '' : 'disabled'}>Merge ${n} ticked comment${n !== 1 ? 's' : ''} into one</button><button class="btn" data-a="noMerge" data-g="${esc(g.anchor)}">Don't merge</button></div><span class="small muted">Merging makes one comment here in Bugs and comments. You then approve it. Unticked comments become separate comments.</span></div>`);
  });
  T.known.forEach(c => { const cl = c.cl, d = S.known[c.id], t = S.tickets.find(x => x.key === cl.jira) || { summary: '', status: '' };
    pt = 'known'; pw = !d;
    place(step(c.step).scen, `<div class="box ${!d ? 'hl' : ''}">${quoteHead(c, '<span class="chip c-known">Already known</span>')}${conf(cl.conf, `Matches ${cl.jira}`)}<div class="why"><b>Compared with existing ticket ${esc(cl.jira)}: "${esc(t.summary)}" (${t.reopened ? 'reopened' : esc(t.status)})</b>${cl.why.map(w => `<div class="sig">${mark(w[1])}<span>${esc(w[0])}</span></div>`).join('')}</div>
    ${!d ? `<div class="row"><button class="btn go" data-a="known" data-k="${esc(c.id)}" data-t="${esc(cl.jira)}" data-v="link">${cl.closed ? `Link and reopen ${esc(cl.jira)}` : `Link to ${esc(cl.jira)}`}</button><button class="btn" data-a="known" data-k="${esc(c.id)}" data-t="${esc(cl.jira)}" data-v="new">Not the same, approve as a new problem</button></div>${confirmHTML(q => q.data.k === c.id)}` : `<div class="row"><span class="toast">${d === 'link' ? `Linked to ${esc(cl.jira)}. Not counted as a unique problem.` : 'Kept as a new problem.'}</span><button class="btn link small" data-a="known" data-k="${esc(c.id)}" data-t="${esc(cl.jira)}" data-v="">${undoLabel([c.id])}</button></div>`}${told(c)}${threadHTML(c.id, 'manager')}</div>`); });
  T.ideas.forEach(c => { const d = S.idea[c.id];
    pt = 'idea'; pw = !d;
    place(step(c.step).scen, `<div class="box ${!d ? 'hl' : ''}">${quoteHead(c, '<span class="chip c-idea">Good idea</span>')}${conf(IDEA.test(c.text) ? 88 : 72, 'Suggestion, not a bug')}<div class="why"><div class="sig">${mark(true)}<span>The tester marked it as non-bug feedback</span></div><div class="sig">${mark(IDEA.test(c.text) ? true : null)}<span>${IDEA.test(c.text) ? 'Suggestion wording, like "would be great" or "would help"' : 'No clear suggestion wording, so check it'}</span></div></div>
    ${!d ? `<div class="row"><button class="btn go" data-a="idea" data-k="${esc(c.id)}" data-v="add">Add to Good ideas</button><button class="btn" data-a="idea" data-k="${esc(c.id)}" data-v="no">Not for now</button><button class="btn" data-a="idea" data-k="${esc(c.id)}" data-v="bug">It's actually a bug</button></div>${confirmHTML(q => q.data.k === c.id)}` : `<div class="row"><span class="toast">${d === 'add' ? 'Added to Good ideas in Section 4.' : d === 'no' ? 'Checked. Not added to Good ideas.' : 'Treated as a bug.'}</span><button class="btn link small" data-a="idea" data-k="${esc(c.id)}" data-v="">${undoLabel([c.id])}</button></div>`}${told(c)}${threadHTML(c.id, 'manager')}</div>`); });
  T.bugs.forEach(c => (pt = 'bug', pw = !S.appr[c.id], place(step(c.step).scen, `<div class="box ${!S.appr[c.id] ? 'hl' : ''}">${quoteHead(c, '<span class="chip c-new">Unique</span>')}<div class="why"><div class="sig">${mark(false)}<span>No duplicate among other comments, and no matching ticket</span></div></div>${apprRow(c)}${confirmHTML(q => q.data.k === c.id)}${told(c)}${threadHTML(c.id, 'manager')}</div>`)));
  const scenOrder = [...new Set([...S.script.map(s => s.scen), ...Object.keys(byScen)])].filter(s => byScen[s]);
  const F = S.f3, show = x => F === 'all' || (F === 'wait' ? x.wait : x.type === F);
  const scen = scenOrder.map(s => { const cards = byScen[s].filter(show); if (!cards.length) return '';
    const list = T.cs.filter(c => step(c.step).scen === s), fails = new Set(list.filter(c => c.r === 'fail').map(c => c.tester + c.step)).size, hid = !!S.hide3[s], wait = cards.filter(x => x.wait).length;
    return `<div class="scen"><button class="scenhead scentog" data-a="tog3" data-v="${esc(s)}" aria-expanded="${!hid}"><span class="chev">${hid ? '▸' : '▾'}</span><h3>${esc(s)}</h3><span class="small muted">${fails} failed step${fails !== 1 ? 's' : ''} · ${list.length} comment${list.length !== 1 ? 's' : ''}${F !== 'all' ? ` · ${cards.length} shown` : ''}</span>${wait ? `<span class="chip c-bug">${wait} to decide</span>` : ''}<span class="small muted togtxt">${hid ? 'Show comments' : 'Hide comments'}</span></button>${hid ? '' : cards.map(x => x.html).join('')}</div>`; }).join('')
    || `<div class="empty small">Nothing here for this filter. <button class="btn link small" data-a="f3" data-v="all">Show all comments</button></div>`;
  const pend = pendingTriage();
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 3 · duplicate finder</span><h2>Bugs and comments</h2><p class="muted">Every bug and non-bug comment waits here until you decide. The duplicate finder groups the same bug, checks each comment against tickets already made in this test cycle, and flags good ideas. Only approved comments move on to Unique problems and Good ideas. The tester gets a kind message either way.</p></div></div>
  <div class="stats" role="group" aria-label="Show comments by type">${[['all', T.cs.length, 'all comments'], ['dup', T.dups.length, 'possible duplicates'], ['known', T.known.length, 'already known'], ['idea', T.ideas.length, 'good ideas'], ['bug', T.bugs.length, 'unique'], ['wait', pend, 'need your decision']].map(([v, n, l]) => `<button class="stat statbtn" data-a="f3" data-v="${v}" aria-pressed="${S.f3 === v}"><b>${n}</b><span>${l}</span></button>`).join('')}</div>
  <div class="row between"><span class="small muted">${S.f3 === 'all' ? 'Click a box to show only that kind of comment.' : 'Showing only one kind. Click the box again, or "all comments", to show everything.'}</span><span class="row"><button class="btn link small" data-a="togAll" data-v="hide">Hide all comments</button><button class="btn link small" data-a="togAll" data-v="show">Show all comments</button></span></div>
  <div class="stack lg">${scen}</div>
  <div class="row between"><p class="note">${pend ? `${pend} decision${pend > 1 ? 's' : ''} left. Only approved comments move to Section 4.` : 'All decided.'}</p><button class="btn primary" data-a="sec" data-v="4">Go to unique problems →</button></div></section>`;
}
function ticketForm(p) {
  const d = S.drafts[p.pid];
  const f = (k, l, rows, wide) => `<label class="fl ${wide ? 'wide' : ''}" for="f-${k}">${l}${rows ? `<textarea id="f-${k}" rows="${rows}" data-a="edit" data-k="${k}">${esc(d[k])}</textarea>` : `<input type="text" class="full" id="f-${k}" data-a="edit" data-k="${k}" value="${esc(d[k])}">`}</label>`;
  const sel = (k, l, opts) => `<label class="fl" for="f-${k}">${l}<select id="f-${k}" data-a="edit" data-k="${k}">${opts.map(o => `<option ${o === d[k] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  const ep = epics().includes(d.epic) ? epics() : [d.epic, ...epics()];
  return `<div class="box hl"><div class="row between"><span class="eyebrow">${d._src === 'ai' ? `New ticket · drafted by AI from ${p.members.length} comment${p.members.length > 1 ? 's' : ''} · check and edit every field` : 'New ticket · basic draft (AI not available) · edit anything'}</span><div class="row">${aiReady() ? `<button class="btn sm" data-a="redraft" data-p="${esc(p.pid)}">Redraft with AI</button>` : ''}<button class="btn link small" data-a="closeForm">Close</button></div></div>${d._note ? `<span class="small muted">${esc(d._note)}</span>` : ''}
  <div class="form">${f('summary', 'Summary', 0, true)}${sel('type', 'Issue type', ['Bug', 'Improvement'])}${sel('epic', 'Linked epic', ep)}
  ${f('description', 'Description', 2, true)}${f('steps', 'Steps to reproduce', 4, true)}${f('expected', 'Expected result (from the test script)', 2)}${f('actual', 'Actual result', 2)}
  ${f('env', 'Environment')}${f('labels', 'Labels')}${sel('priority', 'Priority', ['High', 'Medium', 'Low'])}${f('why', 'Why this priority', 2)}</div>
  <div class="why"><b>Evidence attached · testers' original words kept</b>${p.members.map(m => `<span>${esc(m.tester)}, step ${esc(m.step)}: <span class="quote">"${esc(m.text)}"</span>${m.shot && m.primary ? `<span style="display:block;margin-top:4px">${shotOf(m)}</span>` : ''}${m.thread.filter(x => x.from === 'tester').map(x => ` · answered: "${esc(x.text)}"`).join('')}</span>`).join('')}${(S.chats[p.pid] || []).filter(x => x.from !== 'manager').map(x => `<span>${esc(x.from)} in the chat: <span class="quote">"${esc(x.text)}"</span></span>`).join('')}</div>
  <div class="box sunk"><span style="font-weight:600">Clarity check: could a developer act on this without asking?</span><div class="check" id="vchk"></div></div>
  <div class="row"><button class="btn go" id="createBtn" data-a="create" data-p="${esc(p.pid)}">Create ticket</button><span class="small muted" id="vmsg"></span></div></div>`;
}
function renderCheck() {
  const d = S.open && S.drafts[S.open], box = document.getElementById('vchk'); if (!d || !box) return;
  const P = problems(), p = [...P.bugs, ...P.ideas].find(x => x.pid === S.open), ch = vagueCheck(d, p), bad = ch.filter(c => !c[1]).length;
  box.innerHTML = ch.map(c => `<div class="sig">${mark(c[1])}<span>${esc(c[0])}${c[1] ? '' : `<span class="small q" style="display:block">${esc(c[2])}</span>`}</span></div>`).join('');
  document.getElementById('createBtn').disabled = !!bad;
  document.getElementById('vmsg').textContent = bad ? `Still vague: fix ${bad} item${bad > 1 ? 's' : ''} before creating.` : 'Clear enough for a developer to act on.';
}
const roomPeople = p => [...new Set(p.members.map(m => m.tester))];
function chatHTML(p, me) { return threadHTML(p.members[0].id, me === 'manager' ? 'manager' : 'tester'); }
const fmtTime = at => { if (!at || !/T/.test(at)) return at || ''; const d = new Date(at); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const fmtDay = at => { if (!at || !/T/.test(at)) return ''; return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const stepUnder = c => `<span class="stepdesc">${esc(stepLine(c))} · ${esc(step(c.step).act)} · ${c.r === 'pass' ? 'Pass' : 'Fail'}</span>`;
const stepLine = c => { const st = step(c.step); return `Step ${st.step} · ${st.scen}${st.screen ? ' · ' + st.screen + ' screen' : ''}`; };
// The side chat panel: like a marketplace "message seller" panel, with the step and comment pinned at the top.
function panelHTML() {
  const P = S.panel; if (!P) return '';
  const me = S.role === 'manager' ? 'manager' : S.me;
  let title, sub, ctx, list, who;
  let k = P.k;
  if (P.t === 'room') { const Pr = problems(), p = [...Pr.bugs, ...Pr.ideas].find(x => x.pid === P.k); if (!p) return ''; k = p.members[0].id; }
  const g = chatGroup(k), people = chatPeople(g), cs = g.ids.map(id => comments().find(x => x.id === id)).filter(Boolean);
  if (!cs.length || (me !== 'manager' && !people.includes(me))) return '';
  if (g.p) {
    title = 'Group chat'; sub = 'UAT manager, ' + people.map(x => x === me ? x + ' (you)' : x).join(', ') + ' · everyone who reported this problem';
    ctx = `<div class="pctx"><span class="eyebrow">${g.p.members.length} comments about one problem${S.ptk[g.p.pid] ? ' · ticket ' + esc(S.ptk[g.p.pid]) : ''}</span><b>${esc(g.p.title)}</b>${cs.map(c => `<div class="pctx-item"><span class="quote small"><b>${esc(c.tester)}${c.tester === me ? ' (you)' : ''}:</b> "${esc(c.text)}"</span>${stepUnder(c)}${shotOf(c)}</div>`).join('')}</div>`;
  } else {
    const c = cs[0], st = step(c.step);
    title = me === 'manager' ? c.tester : 'UAT manager'; sub = me === 'manager' ? 'Tester' : 'About your comment';
    ctx = `<div class="pctx"><span class="eyebrow">${me === 'manager' ? esc(c.tester) + "'s comment" : 'Your comment'}</span><span class="quote">"${esc(c.text)}"</span><div class="row" style="gap:6px">${catChip(c)}<span class="chip ${c.r === 'pass' ? 'c-ok' : 'c-bad'}">${c.r === 'pass' ? 'Pass' : 'Fail'}</span>${c.thin ? '<span class="chip c-thin">Needs more detail</span>' : ''}</div>${shotOf(c)}<div class="pctx-item"><span class="small muted">${esc(stepLine(c))}</span><b class="small">${esc(st.act)}</b><span class="small"><span class="muted">Expected:</span> ${esc(st.exp)}</span></div></div>`;
  }
  list = chatMsgs(g); who = people;
  P.k = k; P.t = 'thread';
  let day = '';
  const msgs = list.map(m => { const d = fmtDay(m.at), sep = d && d !== day ? `<div class="pday">${esc(d)}</div>` : ''; if (d) day = d; const mine = m.from === me;
    return `${sep}<div class="pm ${mine ? 'me' : ''}">${mine ? '' : av(m.from === 'manager' ? 'M' : m.from)}<div class="stack" style="gap:3px;min-width:0"><span class="small muted">${m.from === 'manager' ? 'UAT manager' : esc(m.from)}${mine ? ' (you)' : ''}</span><div class="bub">${m.img ? shotHTML(m.img, 'Photo sent in the chat') : ''}${m.text ? `<span>${esc(m.text)}</span>` : ''}</div><span class="small muted">${esc(fmtTime(m.at))}</span></div></div>`; }).join('');
  const key = P.t + ':' + P.k, hint = me === 'manager' ? 'e.g. What did you see on screen? Did it happen every time?' : 'Write to the UAT manager…';
  return `<aside class="sidepanel" role="dialog" aria-label="${esc(title)}"><div class="ph"><div class="row">${who.length === 1 ? av(me === 'manager' ? who[0] : 'M') : `<span class="avatar av-M">${who.length + 1}</span>`}<div class="stack" style="gap:0"><h3>${esc(title)}</h3><span class="small muted">${esc(sub)}</span></div></div><button class="iconbtn" data-a="closePanel" aria-label="Close chat">${I.x}</button></div>
  ${ctx}
  <div class="pmsgs" id="pmsgs">${msgs || `<div class="empty small">${me === 'manager' ? `Ask ${esc(who.join(' and '))} anything that would make this clearer. ${who.length > 1 ? 'Everyone in the chat sees every message, and the answers go into the AI ticket draft.' : 'They get a notification in My updates, and the answers go into the AI ticket draft.'}` : 'No messages yet.'}</div>`}</div>
  <div class="pcomp">${S.panelImg[key] ? `<div class="pimg">${shotHTML(S.panelImg[key], 'Photo to send')}<button class="btn link small" data-a="pimgClear" data-k="${esc(key)}">Remove</button></div>` : ''}<div class="row" style="align-items:flex-start;flex-wrap:nowrap"><textarea id="pn-input" rows="2" data-a="pdraft" data-k="${esc(key)}" aria-label="Message" placeholder="${esc(hint)}">${esc(S.panelDraft[key] || '')}</textarea><label class="iconbtn attach" title="Attach a photo" aria-label="Attach a photo">${I.img}<input type="file" accept="image/*" data-a="pimg" data-k="${esc(key)}"></label></div></div>
  <button class="btn primary psend" data-a="panelSend">Send message</button></aside>`;
}
function v4() {
  const P = problems(), pend = pendingTriage();
  const card = p => { const key = S.ptk[p.pid], dr = S.drafting[p.pid];
    return `<div class="stack"><div class="box ${S.open === p.pid ? 'hl' : ''}"><div class="row between"><div class="row"><span class="chip ${p.kind === 'idea' ? 'c-idea' : 'c-bug'}">${p.kind === 'idea' ? 'Good idea' : p.merged ? `Merged · ${p.members.length} comments` : 'Bug'}</span><h3>${esc(p.title)}</h3></div>${key ? `<span class="chip c-ok">${esc(key)} created</span>` : ''}</div>
    <div class="stack" style="gap:6px">${p.members.map(m => `<div class="stack" style="gap:4px"><span class="small"><b>${esc(m.tester)}:</b> <span class="quote">"${esc(m.text)}"</span></span>${stepUnder(m)}${shotOf(m)}</div>`).join('')}</div>
    ${key ? `<span class="small muted">${[...new Set(p.members.map(m => esc(m.tester)))].join(', ')} told: now ticket ${esc(key)}.</span><button class="btn link small" data-a="seeTicket" data-v="${esc(key)}" style="align-self:flex-start">See ${esc(key)} in existing tickets</button>`
      : dr && dr.status === 'drafting' ? `<div class="row"><span class="chip c-new">AI is writing the ticket draft…</span><span class="small muted">Usually 5 to 30 seconds.</span><button class="btn sm" data-a="stopDraft" data-p="${esc(p.pid)}">Stop</button></div>`
      : S.open === p.pid ? '' : `<div class="row"><button class="btn primary" data-a="makeTicket" data-p="${esc(p.pid)}">${dr && dr.status === 'error' ? 'Try again' : 'Make a ticket'}</button>${dr && dr.status === 'error' ? `<span class="small q">${esc(dr.err)}</span><button class="btn sm" data-a="basicDraft" data-p="${esc(p.pid)}">Use a basic draft</button>` : `<span class="small muted">${aiReady() ? 'The AI drafts it. You check and create.' : 'AI is off: a basic draft is used.'}</span>`}</div>`}
    ${chatHTML(p, 'manager')}</div>
    ${S.open === p.pid && !key && S.drafts[p.pid] ? ticketForm(p) : ''}</div>`; };
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 4 · ticket drafter</span><h2>Unique problems</h2><p class="muted">Approved problems from Bugs and comments. Open a chat with the testers who reported a problem to ask for more detail. "Make a ticket" asks the AI ticket drafter to write the ticket from every linked comment, the testers' answers and the chat. You check every field. A clarity check stops vague tickets.</p></div></div>
  ${pend ? `<div class="note">${pend} item${pend > 1 ? 's' : ''} in Section 3 still need${pend > 1 ? '' : 's'} a decision, so ${pend > 1 ? 'they are' : 'it is'} not shown here yet. <button class="btn link small" data-a="sec" data-v="3">Go to Section 3</button></div>` : ''}
  <div class="stack"><div class="row between"><span class="eyebrow">Unique problems · ${P.bugs.length}</span><span class="small muted">${P.bugs.filter(p => S.ptk[p.pid]).length} with a ticket</span></div>${P.bugs.map(card).join('') || '<div class="empty small">No unique problems yet.</div>'}</div>
  <div class="stack"><div class="row between"><span class="eyebrow">Good ideas · ${P.ideas.length}</span><span class="small muted">Not bugs. Make a ticket only if you want to plan it.</span></div>${P.ideas.map(card).join('') || '<div class="empty small">No good ideas added yet. Add them in Section 3.</div>'}</div></section>`;
}
function v5() {
  const rows = S.tickets.map(t => { const open = S.openTicket === t.key;
    return `<tr class="${t.src === 'UAT' ? 'new' : ''}"><td>${t.d ? `<button class="btn link mono" data-a="tOpen" data-v="${esc(t.key)}">${esc(t.key)}</button>` : `<span class="mono">${esc(t.key)}</span>`}</td><td>${esc(t.summary)}${t.links ? `<div class="small muted">+${t.links} UAT report${t.links > 1 ? 's' : ''} linked</div>` : ''}</td><td>${esc(t.type)}</td><td>${esc(t.priority)}</td><td>${esc(t.epic)}</td><td><select aria-label="Status of ${esc(t.key)}" id="st-${esc(t.key)}" data-a="tStatus" data-v="${esc(t.key)}">${['To do', 'In progress', 'Done'].map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td>${t.reopened ? '<span class="chip c-bug">Reopened</span>' : `<span class="small muted">${(t.ev || []).length + (t.links || 0)} report${(t.ev || []).length + (t.links || 0) !== 1 ? 's' : ''}</span>`}</td></tr>
    ${open && t.d ? `<tr class="tdetail"><td colspan="7"><div class="form"><div class="stack wide"><b>Description</b><span>${esc(t.d.description)}</span></div><div class="stack wide"><b>Steps to reproduce</b><span style="white-space:pre-line">${esc(t.d.steps)}</span></div><div class="stack"><b>Expected</b><span>${esc(t.d.expected)}</span></div><div class="stack"><b>Actual</b><span>${esc(t.d.actual)}</span></div><div class="stack"><b>Environment</b><span>${esc(t.d.env)}</span></div><div class="stack"><b>Priority reason</b><span>${esc(t.d.why)}</span></div><div class="stack wide"><b>Evidence</b>${(t.ev || []).map(m => `<span>${esc(m.tester)}: <span class="quote">"${esc(m.text)}"</span></span>`).join('')}</div></div></td></tr>` : ''}`; }).join('');
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 5</span><h2>Existing tickets</h2><p class="muted">Every ticket made from Unique problems in this test cycle. Bugs and comments checks new comments against this list, so the same problem never gets two tickets. Change a status and the testers who reported it are told.</p></div></div>
  ${endCycleHTML()}
  ${S.tickets.length ? `<div class="tablewrap"><table><thead><tr><th>Key</th><th>Summary</th><th>Type</th><th>Priority</th><th>Epic</th><th>Status</th><th>Reports</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty"><b>No tickets yet</b><span>Tickets you create in Unique problems appear here.</span></div>'}</section>`;
}
function vInbox() {
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">My updates</span><h2>Notifications</h2><p class="muted">You are told when a tester answers your question, completes their test, or sends new feedback. Click one to open it.</p></div>${unread('manager') ? '<button class="btn sm" data-a="readAll" data-v="manager">Mark all as read</button>' : ''}</div>
  <div class="stack">${noteList('manager')}</div></section>`;
}
const SECS = [[1, 'Test script', 'Steps and testers', I.list], [2, 'Testing progress', 'Results and questions', I.play], [3, 'Bugs and comments', 'Duplicates, known, ideas', I.layers], [4, 'Unique problems', 'Make a ticket', I.ticket], [5, 'Existing tickets', 'All tickets', I.board]];
const GROUPS = [['Before testing', [1]], ['During testing', [2]], ['After testing', [3, 4]], ['Handover', [5]]];
function managerUI() {
  const P = problems(), um = unread('manager');
  const badge = { 2: S.script.reduce((a, s) => a + s.who.filter(t => !isDone(t, s.step)).length, 0), 3: pendingTriage(), 4: [...P.bugs, ...P.ideas].filter(p => !S.ptk[p.pid]).length };
  const secBtn = s => `<button class="sec" aria-current="${S.sec === s[0]}" data-a="sec" data-v="${s[0]}"><span class="n">${s[3]}</span><b>${s[1]}</b>${badge[s[0]] ? `<span class="badge">${badge[s[0]]}</span>` : '<span></span>'}<span class="s">${s[2]}</span></button>`;
  const view = [vInbox, v1, v2, v3, v4, v5][S.sec]();
  return `<div class="banner mgr"><span class="row">${av('M', 'av')}<span>Logged in as <b>UAT manager</b></span></span><span class="small muted">The AI suggests. You decide every step.</span></div>
  <div class="shell"><nav class="rail" aria-label="Sections">
  ${GROUPS.map(g => `<span class="railgroup">${g[0]}</span>${g[1].map(n => secBtn(SECS[n - 1])).join('')}`).join('')}
  </nav>
  <main>${view.replace(/(<section class="panel"><div class="phead">[\s\S]*?<\/div><\/div>)/, '$1' + guide(S.sec))}</main></div>`;
}

/* ===================== RENDER ===================== */
function render() {
  TRI = null;
  const app = document.getElementById('app');
  const aiLabel = CFG.ai === 'none' ? 'AI off (basic checks)' : S.aiOff ? 'AI unavailable (basic checks)' : 'AI by Gemini';
  const header = `<header class="top"><div class="brandrow"><span class="logo">${I.bug}</span><div class="stack" style="gap:0"><h1>ReleaseReady</h1><span class="small muted">${S.boot === 'ready' && curCycle() ? `${esc(curCycle().name)} · ` : ''}${S.boot === 'ready' ? `UAT for ${esc(S.appName || 'your app')} · ` : ''}${aiLabel}</span></div></div>
  ${S.boot === 'ready' || S.boot === 'home' ? `<div class="row">${S.boot === 'ready' ? `<button class="btn sm" data-a="goHome">← ${S.role === 'tester' ? 'My test cycles' : 'All test cycles'}</button><span id="savestate" class="savestate ${S.saveState}">${{ saved: 'All changes saved', saving: 'Saving…', error: 'Could not save. Retrying…' }[S.saveState]}</span>` : ''}<div class="role"><span class="eyebrow">Switch interface</span><div class="seg" role="group" aria-label="Switch interface"><button aria-pressed="${S.role === 'manager'}" data-a="role" data-v="manager">${I.board}UAT manager</button><button aria-pressed="${S.role === 'tester'}" data-a="role" data-v="tester">${I.user}Tester</button></div></div><button class="btn sm" data-a="askReset">Reset demo</button></div>` : ''}</header>`;
  const resetBar = S.confirmReset ? `<div class="banner danger"><span><b>Delete everything?</b> This removes every test cycle, in progress and completed, with all their testers, steps, comments, messages and tickets. You will then start with a new test cycle.</span><div class="row"><button class="btn sm dangerbtn" data-a="doReset">Delete everything</button><button class="btn sm" data-a="cancelReset">Cancel</button></div></div>` : '';
  let body;
  if (S.boot === 'loading') body = `<section class="panel"><div class="empty">${CY.cur ? 'Opening the test cycle…' : 'Loading your test cycles…'}</div></section>`;
  else if (S.boot === 'error') body = `<section class="panel"><div class="empty"><b>Could not reach the server or database</b><span>${esc(S.bootErr || '')}</span><button class="btn primary" data-a="retryBoot">Try again</button></div></section>`;
  else if (S.boot === 'home') body = vHome();
  else if (S.boot === 'setup') body = vSetup();
  else body = S.role === 'manager' ? managerUI() : testerUI();
  const hadFocus = document.activeElement && document.activeElement.id === 'pn-input';
  const doneBar = cycleDone() ? `<div class="banner"><span><b>This test cycle is completed.</b> You can look at everything in it. To change anything, reopen it.</span><button class="btn sm primary" data-a="reopenCycle">Reopen test cycle</button></div>` : '';
  app.innerHTML = header + resetBar + doneBar + body + (S.boot === 'ready' ? panelHTML() : '') + (S.zoom ? `<div class="lightbox" data-a="unzoom" role="dialog" aria-label="Picture"><img src="${esc(S.zoom)}" alt="Picture, full size"><button class="iconbtn" data-a="unzoom" aria-label="Close picture">${I.x}</button></div>` : '');
  document.body.classList.toggle('haspanel', !!document.querySelector('.sidepanel'));
  const pm = document.getElementById('pmsgs'); if (pm) pm.scrollTop = pm.scrollHeight;
  if (hadFocus && !S.focusInput) S.focusInput = 'pn-input';
  if (S.boot === 'ready' && S.role === 'manager' && S.sec === 4) renderCheck();
  if (S.focusInput) { const el = document.getElementById(S.focusInput); S.focusInput = null; if (el) { el.focus({ preventScroll: true }); if (el.id !== 'pn-input') el.scrollIntoView({ block: 'center' }); if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length); } }
  if (S.focus) { const el = document.getElementById('cm-' + S.focus) || document.getElementById('cm3-' + S.focus); S.focus = null; if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); } }
  schedulePersist();
}

/* ===================== ACTIONS ===================== */
const val = id => (document.getElementById(id) || {}).value || '';
async function resizeImage(file, max = 1000, q = 0.72) {
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const scale = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
const A = {
  role: e => { S.panel = null; const v = e.dataset.v; if (v === S.role) return; CY.openG = {};
    if (v === 'tester') { CY.me = null; S.role = 'tester'; S.me = null; goHome(); return 'keep'; }   // testers always start by saying who they are
    S.role = 'manager'; S.me = null; if (S.boot === 'home') { S.htab = null; loadNotes().then(render); } window.scrollTo({ top: 0 }); },
  login: e => { CY.me = e.dataset.v; CY.openG = {}; S.htab = 'prog'; loadNotes().then(render); },
  openStep: e => { S.openStep = e.dataset.k; },
  hideGuide: e => { S.hideGuide[e.dataset.v] = true; },
  showGuide: e => { delete S.hideGuide[e.dataset.v]; },
  logout: () => { CY.me = null; CY.notes = []; goHome(); return 'keep'; },
  homeNote: e => { openHomeNote(e.dataset.c, e.dataset.v); return 'keep'; },
  togG: e => { const v = e.dataset.v; if (CY.openG[v]) delete CY.openG[v]; else CY.openG[v] = true; },
  togInbox: () => { S.inboxOpen = !S.inboxOpen; },
  homeReadAll: () => { const items = CY.notes.filter(n => !n.is_read).map(n => ({ cycle: n.cycle, id: n.id, row: stripCycle(n) })); CY.notes.forEach(n => { n.is_read = true; }); api('/api/notes/read', { items }).catch(() => {}); },
  ttab: e => { S.ttab = e.dataset.v; },
  sec: e => { S.sec = +e.dataset.v; window.scrollTo({ top: 0 }); },
  askReset: () => { S.confirmReset = true; },
  cancelReset: () => { S.confirmReset = false; },
  doReset: async () => {
    Object.values(S.pending).forEach(p => clearTimeout(p.timer)); clearTimeout(syncTimer);
    try { await api('/api/data/reset', {}); } catch (e) { toast('Could not delete the data. Check the server.'); return; }
    const role = S.role; S = freshState(); S.role = role; LAST = {}; CY = { list: [], cur: null, me: null, notes: [], openG: {} }; S.boot = 'home'; S.htab = 'new'; render(); toast('All test cycles deleted. Add a new test cycle to start again.');
  },
  goHome: () => { goHome(); return 'keep'; },
  openCycle: e => { openCycle(e.dataset.v); return 'keep'; },
  htab: e => { S.htab = e.dataset.v; },
  reopenFromHome: e => { const c = CY.list.find(x => x.id === e.dataset.v); if (!c) return; saveCycle({ id: c.id, status: 'active', ended: null }); S.htab = 'prog'; toast(`"${c.name}" is back in Test cycles in progress.`); },
  retryBoot: () => { boot(); },
  suStart: () => {
    const names = S.setup.names.map(n => n.trim());
    if (names.some(n => !n)) { S.setup.err = 'Please enter a name for every tester.'; return; }
    if (new Set(names.map(n => n.toLowerCase())).size !== names.length) { S.setup.err = 'Each tester needs a different name.'; return; }
    if (names.some(n => n.includes('|'))) { S.setup.err = 'Names cannot contain the | character.'; return; }
    const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), n = CY.list.length + 1;
    const name = (S.setup.cname || '').trim() || 'Test cycle ' + n, pos = Math.max(0, ...CY.list.map(c => c.position || 0)) + 1;
    const app = S.setup.app.trim(), role = 'manager';
    S = freshState(); S.role = role; CY.cur = id; LAST = {};
    S.testers = names.map(name => ({ name })); S.appName = app; S.boot = 'ready'; S.sec = 1;
    saveCycle({ id, name, app, status: 'active', created: stamp(), ended: null, stats: null, position: pos });
    toast(`"${name}" is set up. Now add the test steps.`);
  },
  addTester: () => { const n = val('nt-name').trim(); if (!n || n.includes('|') || testers().some(t => t.toLowerCase() === n.toLowerCase())) { toast(n ? 'That name is already used or not allowed.' : 'Type a name first.'); return; } S.testers.push({ name: n }); toast(n + ' added'); },
  assign: e => { const s = S.script[+e.dataset.i], t = e.dataset.t; s.who = s.who.includes(t) ? s.who.filter(x => x !== t) : [...s.who, t]; },
  delStep: e => { S.script.splice(+e.dataset.i, 1); },
  addStep: () => {
    const sc = val('ns-scen').trim(), screen = val('ns-screen').trim(), act = val('ns-act').trim(), ex = val('ns-exp').trim();
    if (!sc || !act || !ex) { const el = document.getElementById('ns-err'); if (el) el.textContent = 'Scenario, action and expected result are needed.'; return 'keep'; }
    const scens = [...new Set(S.script.map(s => s.scen))], exist = scens.find(s => s.toLowerCase() === sc.toLowerCase()), scen = exist || sc;
    const idx = (exist ? scens.indexOf(exist) : scens.length) + 1, same = S.script.filter(s => s.scen === scen);
    let n = same.length + 1, id = idx + '.' + n; while (S.script.some(s => s.step === id)) id = idx + '.' + (++n);
    const at = same.length ? S.script.indexOf(same[same.length - 1]) + 1 : S.script.length;
    S.script.splice(at, 0, { step: id, scen, screen, act, exp: ex, who: [] });
    toast('Step ' + id + ' added. Click names to assign testers.');
  },
  mtester: e => { S.mtester = e.dataset.v; },
  askEnd: () => { S.confirmEnd = true; },
  cancelEnd: () => { S.confirmEnd = false; },
  endCycle: () => { S.confirmEnd = false; if (S.ended) return; const who = testers().filter(t => assigned(t).length); who.forEach(t => { const m = summaryFor(t); S.sumSent[t] = m; notify(t, 'update', m, {}); }); S.ended = stamp(); saveCycle({ id: CY.cur, status: 'completed', ended: S.ended }); toast('Test cycle ended and moved to Completed test cycles. Thank-you summaries sent to ' + (who.join(', ') || 'no one') + '.'); },
  reopenCycle: () => { S.ended = null; saveCycle({ id: CY.cur, status: 'active', ended: null }); toast('Test cycle reopened. End it again when testing is over to send updated thank-yous.'); },
  setR: e => { S.ui[e.dataset.k].r = e.dataset.v; },
  saveAnyway: e => { const kind = e.dataset.f, k = e.dataset.k; if (!(kind === 'p' ? S.ui[k] : kind === 'e' ? S.ue[k] : S.ux[k])) return; commit(kind, k, thinFor(kind, k)); },
  keepSave: e => { const kind = e.dataset.f, k = e.dataset.k; if (!(kind === 'p' ? S.ui[k] : kind === 'e' ? S.ue[k] : S.ux[k])) return; commit(kind, k, thinFor(kind, k)); },
  editC: e => { const it = itemById(e.dataset.k); if (!it) return; S.ue[e.dataset.k] = { text: it.text, cat: it.cat, primary: !!it.primary, orig: it.text }; S.focusInput = 'e-' + e.dataset.k; },
  cancelE: e => { delete S.ue[e.dataset.k]; delete S.ai['e:' + e.dataset.k]; },
  saveE: e => { const k = e.dataset.k; if (!S.ue[k]) return 'keep'; if ((S.ue[k].text || '').trim() === S.ue[k].orig) { delete S.ue[k]; toast('No changes to save.'); return; } if (canSave('e', k)) trySave('e', k); return 'keep'; },
  toPass: e => { const u = S.ui[e.dataset.k]; u.r = 'pass'; u.text = ''; },
  toFail: e => { const k = e.dataset.k, thin = thinFor('x', k); S.res[k].r = 'fail'; S.ux[k].primary = true; S.ux[k].cat = 'bug'; commit('x', k, thin); },
  basicCheck: e => { useBasic(e.dataset.f, e.dataset.k); },
  shotClear: e => { S.ui[e.dataset.k].shot = ''; },
  saveStep: e => { const k = e.dataset.k; if (canSave('p', k)) trySave('p', k); return 'keep'; },
  openX: e => { S.ux[e.dataset.k] = { open: true, cat: 'bug', text: '' }; },
  closeX: e => { delete S.ux[e.dataset.k]; },
  xcat: e => { S.ux[e.dataset.k].cat = e.dataset.v; },
  saveX: e => { const k = e.dataset.k; if (canSave('x', k)) trySave('x', k); return 'keep'; },
  openNote: e => { const n = S.notes.find(x => x.id === e.dataset.v); if (!n) return; n.read = true;
    if (n.ref.room) { if (n.to === 'manager') S.sec = 4; S.panel = { t: 'room', k: n.ref.room }; return; }   // older group-chat notifications
    if (n.ref.cid && (n.kind === 'question' || n.kind === 'reply')) S.panel = { t: 'thread', k: n.ref.cid };
    if (n.to === 'manager') { if (n.ref.tester) { S.sec = 2; S.mtester = n.ref.tester; S.focus = n.ref.cid || null; } }
    else { S.ttab = 'script'; S.focus = n.ref.cid || null; if (n.ref.cid) { const [t, s] = n.ref.cid.split('|'); S.openStep = t + '|' + s; } } },
  readAll: e => { S.notes.filter(n => n.to === e.dataset.v).forEach(n => n.read = true); },
  merge: e => { const g = triage().groups.find(x => x.anchor === e.dataset.g); if (!g) return; S.groups[g.anchor] = true; g.members.forEach(c => S.mem[c.id] = S.sel[c.id] ? 'in' : 'out'); const ins = g.members.filter(c => S.mem[c.id] === 'in'); g.members.forEach(c => tell(c.id, S.mem[c.id] === 'in' ? withCredit(MSG.merged(c, ins.length), c, ins) : withCredit(MSG.separate(c), c))); toast('Merged into one comment. Approve it when you are ready. Unticked comments are now separate comments.'); },
  noMerge: e => { const g = triage().groups.find(x => x.anchor === e.dataset.g); if (!g) return; S.groups[g.anchor] = false; g.members.forEach(c => tell(c.id, withCredit(MSG.separate(c), c))); toast('Kept separate. Messages send in 10 s (Undo to stop)'); },
  undoMerge: e => { const g = triage().groups.find(x => x.anchor === e.dataset.g); if (!g) return; const quiet = g.members.map(c => revoke(c.id)).every(Boolean); delete S.groups[g.anchor]; delete S.appr['g:' + g.anchor]; g.members.forEach(c => { delete S.mem[c.id]; delete S.appr[c.id]; }); delete S.drafts['g:' + g.anchor]; toast(quiet ? 'Undone. No message was sent.' : 'Decision reopened. A correction is sent when you decide again.'); },
  memIn: e => { const T = triage(), g = T.groups.find(x => x.anchor === e.dataset.g), c = g && g.members.find(x => x.id === e.dataset.k); if (!c) return; S.mem[c.id] = 'in'; const n = g.members.filter(x => S.mem[x.id] === 'in').length, k = S.ptk['g:' + g.anchor];
    if (k) { const t = S.tickets.find(t => t.key === k); if (t) { t.links++; t.ev = [...(t.ev || []), { id: c.id, tester: c.tester, step: c.step, text: c.text }]; } tell(c.id, withCredit(MSG.merged(c, n) + ' It is part of ticket ' + k + '.', c), true); } else tell(c.id, withCredit(MSG.merged(c, n), c), true); toast(c.tester + ' told'); },
  memOut: e => { const g = triage().groups.find(x => x.anchor === e.dataset.g), c = g && g.members.find(x => x.id === e.dataset.k); if (!c) return; S.mem[c.id] = 'out'; tell(c.id, withCredit(MSG.separate(c), c), true); toast(c.tester + ' told'); },
  known: e => { const k = e.dataset.k, v = e.dataset.v, key = e.dataset.t, c = comments().find(x => x.id === k), t = S.tickets.find(x => x.key === key); if (!c || !t) return;
    if (!v) { const quiet = revoke(k); toast(quiet ? 'Undone. No message was sent.' : 'Decision reopened. A correction is sent when you decide again.'); }
    if (S.known[k] === 'link') { t.links = Math.max(0, t.links - 1); if (t.reopened) { t.status = 'Done'; t.reopened = false; } }
    if (v) { S.known[k] = v; S.knownT[k] = key; } else { delete S.known[k]; delete S.knownT[k]; }
    if (v === 'link') { t.links++; const re = t.status === 'Done'; if (re) { t.status = 'To do'; t.reopened = true; } tell(k, withCredit(MSG.link(c, t, re), c)); toast('Linked to ' + t.key + '. Message to ' + c.tester + ' sends in 10 s'); }
    if (v === 'new') { tell(k, withCredit(MSG.newProb(c), c)); toast('Kept as a new problem. Message to ' + c.tester + ' sends in 10 s'); } },
  idea: e => { const k = e.dataset.k, v = e.dataset.v, c = comments().find(x => x.id === k); if (!c) return;
    if (!v) { delete S.idea[k]; toast(revoke(k) ? 'Undone. No message was sent.' : 'Decision reopened. A correction is sent when you decide again.'); return; }
    S.idea[k] = v; tell(k, withCredit(v === 'add' ? MSG.ideaAdd(c) : v === 'no' ? MSG.ideaNo(c) : MSG.ideaBug(c), c)); toast((v === 'add' ? 'Added to Good ideas. ' : 'Checked. ') + 'Message to ' + c.tester + ' sends in 10 s'); },
  makeTicket: e => { const pid = e.dataset.p, P = problems(), p = [...P.bugs, ...P.ideas].find(x => x.pid === pid); if (!p) return; S.panel = { t: 'thread', k: p.members[0].id }; if (S.drafts[pid]) { S.open = pid; return; } aiDraft(p); },
  openChat: e => { S.openChat[e.dataset.p] = true; S.focusInput = 'ch-' + e.dataset.p; },
  openPanel: e => { S.panel = { t: e.dataset.t, k: e.dataset.k }; S.focusInput = 'pn-input'; },
  closePanel: () => { S.panel = null; },
  zoom: e => { const img = e.querySelector('img'); if (img) S.zoom = img.src; },
  unzoom: () => { S.zoom = null; },
  pimgClear: e => { delete S.panelImg[e.dataset.k]; },
  panelSend: () => { panelSend(); },
  approve: e => { const k = e.dataset.k, v = e.dataset.v;
    if (k.startsWith('g:')) { const g = triage().groups.find(x => x.anchor === k.slice(2)); if (!g) return; const ins = g.members.filter(c => S.mem[c.id] === 'in');
      if (!v) { delete S.appr[k]; const quiet = ins.map(c => revoke(c.id)).every(Boolean); toast(quiet ? 'Undone. No message was sent.' : 'Decision reopened. A correction is sent when you decide again.'); return; }
      S.appr[k] = v; ins.forEach(c => tell(c.id, v === 'yes' ? withCredit(MSG.mergedApproved(c, ins.length), c, ins) : MSG.notApproved(c)));
      toast((v === 'yes' ? 'Merged comment approved and moved to Unique problems. ' : 'Merged comment not approved. ') + 'Messages send in 10 s'); return; }
    const c = comments().find(x => x.id === k); if (!c) return;
    if (!v) { delete S.appr[k]; toast(revoke(k) ? 'Undone. No message was sent.' : 'Decision reopened. A correction is sent when you decide again.'); return; }
    S.appr[k] = v; tell(k, v === 'yes' ? withCredit(MSG.approved(c, c.thin), c) : MSG.notApproved(c));
    toast((v === 'yes' ? 'Approved and moved to Unique problems. ' : 'Not approved. ') + 'Message to ' + c.tester + ' sends in 10 s'); },
  askFirst: () => { const q = S.confirm; S.confirm = null; if (!q) return; S.panel = { t: 'thread', k: q.ids[0] }; S.focusInput = 'pn-input'; },
  cancelConfirm: () => { S.confirm = null; },
  f3: e => { S.f3 = S.f3 === e.dataset.v && e.dataset.v !== 'all' ? 'all' : e.dataset.v; },
  tog3: e => { const v = e.dataset.v; if (S.hide3[v]) delete S.hide3[v]; else S.hide3[v] = true; },
  togAll: e => { if (e.dataset.v === 'show') S.hide3 = {}; else [...new Set([...S.script.map(x => x.scen), ...triage().cs.map(c => step(c.step).scen)])].forEach(v => { S.hide3[v] = true; }); },
  redraft: e => { const pid = e.dataset.p, P = problems(), p = [...P.bugs, ...P.ideas].find(x => x.pid === pid); delete S.drafts[pid]; aiDraft(p, true); },
  basicDraft: e => { const pid = e.dataset.p, P = problems(), p = [...P.bugs, ...P.ideas].find(x => x.pid === pid); if (!p) return; S.drafts[pid] = Object.assign(draft(p), { _src: 'basic', _note: 'Basic draft used because the AI was not available.' }); delete S.drafting[pid]; S.open = pid; },
  stopDraft: e => { const d = S.drafting[e.dataset.p]; if (d && d.ctl) d.ctl.abort(); },
  closeForm: () => { S.open = null; },
  create: e => { const pid = e.dataset.p, d = S.drafts[pid], P = problems(), p = [...P.bugs, ...P.ideas].find(x => x.pid === pid); if (!d || !p || vagueCheck(d, p).some(c => !c[1])) return;
    let key; do { key = 'UAT-' + (S.nextKey++); } while (S.tickets.some(t => t.key === key));
    const fields = { ...d }; delete fields._src; delete fields._note;
    S.ptk[pid] = key; S.tickets.unshift({ key, summary: d.summary, type: d.type, priority: d.priority, epic: d.epic, status: 'To do', src: 'UAT', links: 0, d: fields, ev: p.members.map(m => ({ id: m.id, tester: m.tester, step: m.step, text: m.text })), seq: ++S.seq }); S.open = null; delete S.drafts[pid];
    p.members.forEach(m => tell(m.id, p.kind === 'idea' ? MSG.ideaTicket(m, key) : withCredit(MSG.ticket(m, key, d.summary, d.priority), m, p.members), true));
    toast('Ticket ' + key + ' created. ' + [...new Set(p.members.map(m => m.tester))].join(', ') + ' told'); },
  seeTicket: e => { S.openTicket = e.dataset.v; S.sec = 5; window.scrollTo({ top: 0 }); },
  tOpen: e => { S.openTicket = S.openTicket === e.dataset.v ? null : e.dataset.v; }
};
// Approving a comment marked "Needs more detail" asks the manager to confirm first.
const APPROVES = { approve: d => d.v === 'yes', idea: d => d.v === 'add' || d.v === 'bug', known: d => d.v === 'link' || d.v === 'new' };
function thinIds(a, d) {
  if (a === 'merge') { const g = triage().groups.find(x => x.anchor === d.g); return g ? g.members.filter(c => S.sel[c.id] && c.thin).map(c => c.id) : []; }
  if (a === 'approve' && String(d.k).startsWith('g:')) { const g = triage().groups.find(x => x.anchor === d.k.slice(2)); return g ? g.members.filter(c => S.mem[c.id] === 'in' && c.thin).map(c => c.id) : []; }
  const c = comments().find(x => x.id === d.k); return c && c.thin ? [c.id] : [];
}
function panelSend() {
  if (cycleDone()) { readOnlyNote(); return; }
  const P = S.panel, inp = document.getElementById('pn-input'); if (!P || !inp) return;
  const key = P.t + ':' + P.k, img = S.panelImg[key] || '', text = inp.value; if (!text.trim() && !img) return;
  const me = S.role === 'manager' ? 'manager' : S.me;
  post(P.k, me === 'manager' ? 'manager' : 'tester', text, img);
  toast(me === 'manager' ? 'Sent to ' + chatPeople(chatGroup(P.k)).join(', ') : 'Sent to the UAT manager');
  delete S.panelDraft[key]; delete S.panelImg[key]; S.focusInput = 'pn-input';
}
function chatPost(pid, from, text, img) {
  text = (text || '').trim(); if (!text && !img) return;
  const P = problems(), p = [...P.bugs, ...P.ideas].find(x => x.pid === pid); if (!p) return;
  (S.chats[pid] = S.chats[pid] || []).push({ id: uid('ch'), from, text, at: stamp(), img: img || '' });
  if (!text) text = '(a photo)'; else if (img) text += ' (with a photo)';
  const people = roomPeople(p), first = S.chats[pid].length === 1;
  if (from === 'manager') people.forEach(t => notify(t, 'question', first ? `The UAT manager started a chat about the problem you reported ("${p.title}"): "${text}"` : `New message from the UAT manager in the chat about "${p.title}": "${text}"`, { room: pid }));
  else { notify('manager', 'reply', `${from} wrote in the chat about "${p.title}": "${text}"`, { room: pid }); people.filter(t => t !== from).forEach(t => notify(t, 'reply', `${from} wrote in the chat about "${p.title}": "${text}"`, { room: pid })); }
  toast(from === 'manager' ? 'Sent to ' + people.join(', ') : 'Sent to the chat');
}
// What can still be clicked in a completed test cycle: looking around, not changing anything.
const VIEW_OK = new Set(['role', 'login', 'logout', 'homeNote', 'homeReadAll', 'togG', 'togInbox', 'ttab', 'sec', 'mtester', 'openStep', 'openPanel', 'closePanel', 'zoom', 'unzoom', 'tOpen', 'seeTicket', 'openNote', 'readAll', 'reopenCycle', 'goHome', 'openCycle', 'hideGuide', 'showGuide', 'f3', 'tog3', 'togAll', 'askReset', 'cancelReset', 'doReset', 'htab', 'cancelEnd', 'closeForm', 'retryBoot']);
const readOnlyNote = () => toast('This test cycle is completed. Click "Reopen test cycle" to change it.');
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-a]'); if (!el || ['SELECT', 'TEXTAREA', 'INPUT'].includes(el.tagName)) return;
  const f = A[el.dataset.a]; if (!f) return;
  if (cycleDone() && !VIEW_OK.has(el.dataset.a)) { readOnlyNote(); return; }
  const ap = APPROVES[el.dataset.a];
  if (ap && ap(el.dataset)) {
    const ids = thinIds(el.dataset.a, el.dataset);
    if (ids.length && !el.dataset.sure) { S.confirm = { a: el.dataset.a, data: { ...el.dataset }, ids }; render(); return; }
    S.confirm = null;
  }
  const r = await f(el); if (r !== 'keep') render();
});
document.addEventListener('keydown', ev => {
  const el = ev.target;
  if (ev.key === 'Escape' && S.zoom) { S.zoom = null; render(); return; }
  if (ev.key === 'Enter' && !ev.shiftKey && el.id === 'pn-input') { ev.preventDefault(); panelSend(); render(); return; }
});
document.addEventListener('focusout', () => { if (S.renderLater) setTimeout(() => { if (!typing()) { S.renderLater = false; render(); } }, 50); });
document.addEventListener('change', async ev => {
  const el = ev.target, a = el.dataset.a;
  if (cycleDone() && ['tStatus', 'sel', 'shotFile', 'pimg', 'edit'].includes(a)) { readOnlyNote(); render(); return; }
  if (a === 'sel') { S.sel[el.dataset.k] = el.checked; render(); }
  if (a === 'suN') { const n = Math.max(1, Math.min(20, parseInt(el.value, 10) || 1)); S.setup.n = n; S.setup.names = Array.from({ length: n }, (_, i) => S.setup.names[i] || ''); render(); }
  if (a === 'pimg' && el.files && el.files[0]) { const k = el.dataset.k; try { S.panelImg[k] = await resizeImage(el.files[0], 900, 0.7); S.focusInput = 'pn-input'; } catch (e) { toast('That file could not be read as a picture.'); } render(); }
  if (a === 'shotFile' && el.files && el.files[0]) { try { S.ui[el.dataset.k].shot = await resizeImage(el.files[0]); } catch (e) { toast('That file could not be read as an image.'); } render(); }
  if (a === 'tStatus') { const t = S.tickets.find(t => t.key === el.dataset.v); if (!t) return; t.status = el.value; if (el.value === 'Done') t.reopened = false;
    if (el.value !== 'To do') { const P = problems(), T = triage(), ids = new Set();
      [...P.bugs, ...P.ideas].forEach(p => { if (S.ptk[p.pid] === t.key) p.members.forEach(m => ids.add(m.id)); });
      T.known.forEach(c => { if (c.cl.jira === t.key && S.known[c.id] === 'link') ids.add(c.id); });
      const cs = comments().filter(c => ids.has(c.id));
      cs.forEach(c => tell(c.id, el.value === 'Done' ? MSG.fixed(c, t.key) : MSG.progress(c, t.key), true));
      if (cs.length) toast(t.key + ' is ' + el.value.toLowerCase() + '. ' + [...new Set(cs.map(c => c.tester))].join(', ') + ' told'); }
    render(); }
  if (a === 'edit' && el.tagName === 'SELECT') { S.drafts[S.open][el.dataset.k] = el.value; renderCheck(); schedulePersist(); }
});
document.addEventListener('input', ev => {
  const el = ev.target, a = el.dataset.a;
  if (a === 'cmt') { const k = el.dataset.k, f = el.dataset.f, u = f === 'p' ? S.ui[k] : f === 'e' ? S.ue[k] : S.ux[k]; if (!u) return; u.text = el.value;
    const h = document.getElementById(`h-${f}-${k}`); if (h) { h.innerHTML = helperHTML(f, k); h.classList.toggle('need', !canSave(f, k)); const b = document.getElementById(`sv-${f}-${k}`); if (b) b.outerHTML = saveBtn(f, k); } }
  if (a === 'edit') { S.drafts[S.open][el.dataset.k] = el.value; renderCheck(); schedulePersist(); }
  if (a === 'pdraft') S.panelDraft[el.dataset.k] = el.value;
  if (a === 'suApp') S.setup.app = el.value;
  if (a === 'suCname') S.setup.cname = el.value;
  if (a === 'suName') S.setup.names[+el.dataset.i] = el.value;
});

/* ===================== START ===================== */
async function boot() {
  S.boot = 'loading'; render();
  try { CFG = await api('/api/config'); await loadCycles(); await loadNotes(); S.boot = 'home'; }
  catch (e) { S.boot = 'error'; S.bootErr = e.message; }
  render();
}
boot();
})();

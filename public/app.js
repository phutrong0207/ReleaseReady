/* ReleaseReady: UAT feedback app.
   The page keeps the working state in memory (S), saves every change to the server (which stores it in Supabase),
   and asks the server for the two AI functions (comment check, ticket drafter). */
(function () {
'use strict';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wc = t => (t || '').trim().split(/\s+/).filter(Boolean).length;
const nowTime = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
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
let S;
function freshState() {
  return {
    boot: 'loading', setup: { n: 3, names: ['', '', ''], app: '', err: '' },
    // saved
    appName: '', testers: [], script: [], res: {}, notes: [], completed: {}, groups: {},
    sel: {}, mem: {}, known: {}, knownT: {}, idea: {}, checked: {}, sent: {}, fix: {},
    drafts: {}, ptk: {}, tickets: [], nextKey: 1, seq: 0, npos: 0, sumSent: {},
    // view only
    role: 'manager', me: null, ttab: 'script', sec: 1, mtester: null, focus: null, openTh: {}, ui: {}, ux: {},
    ai: {}, aiOff: false, drafting: {}, pending: {}, open: null, openTicket: null, hideGuide: {}, openStep: null,
    confirmReset: false, saveState: 'saved', renderLater: false
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
const TABLES = ['testers', 'steps', 'results', 'feedback', 'messages', 'notifications', 'decisions', 'group_decisions', 'tickets', 'drafts', 'settings'];
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
      o.feedback[i.id] = { id: i.id, result_id: k, tester, step: st, category: i.cat, body: i.text, is_primary: !!i.primary, seq: i.seq || 0, needs_detail: !!i.thin };
      i.thread.forEach((m, n) => o.messages[m.id] = { id: m.id, feedback_id: i.id, sender: m.from, body: m.text, sent_at: m.at, position: n });
    });
  });
  S.notes.forEach(n => o.notifications[n.id] = { id: n.id, recipient: n.to, kind: n.kind, body: n.text, ref: n.ref || {}, sent_at: n.at, is_read: !!n.read, position: n.pos || 0 });
  const ids = new Set([...Object.keys(S.sel), ...Object.keys(S.mem), ...Object.keys(S.known), ...Object.keys(S.idea), ...Object.keys(S.checked), ...Object.keys(S.sent), ...Object.keys(S.fix)]);
  ids.forEach(id => o.decisions[id] = { feedback_id: id, member: S.mem[id] || null, known: S.known[id] || null, known_ticket: S.knownT[id] || null, idea: S.idea[id] || null, selected: S.sel[id] === undefined ? null : !!S.sel[id], checked: !!S.checked[id], sent_text: S.sent[id] || null, needs_correction: !!S.fix[id] });
  Object.entries(S.groups).forEach(([a, m]) => { if (m === true || m === false) o.group_decisions[a] = { anchor_id: a, merged: m }; });
  const pidOf = {}; Object.entries(S.ptk).forEach(([pid, key]) => pidOf[key] = pid);
  S.tickets.forEach(t => o.tickets[t.key] = { key: t.key, summary: t.summary, type: t.type, priority: t.priority, epic: t.epic, status: t.status, source: t.src, links: t.links || 0, reopened: !!t.reopened, problem_id: pidOf[t.key] || null, details: t.d || null, evidence: t.ev || null, position: t.seq || 0 });
  Object.entries(S.drafts).forEach(([pid, f]) => o.drafts[pid] = { problem_id: pid, fields: f });
  const set = { appName: S.appName, completed: S.completed, nextKey: S.nextKey, seq: S.seq, npos: S.npos, sumSent: S.sumSent };
  Object.entries(set).forEach(([k, v]) => o.settings[k] = { key: k, value: v });
  return o;
}
function hydrate(tb) {
  const by = (rows, f) => (rows || []).slice().sort((a, b) => (a[f] || 0) - (b[f] || 0));
  const st = {}; (tb.settings || []).forEach(r => st[r.key] = r.value);
  S.appName = st.appName || ''; S.completed = st.completed || {}; S.nextKey = st.nextKey || 1; S.seq = st.seq || 0; S.npos = st.npos || 0; S.sumSent = st.sumSent || {};
  S.testers = by(tb.testers, 'position').map(r => ({ name: r.name }));
  S.script = by(tb.steps, 'position').map(r => ({ step: r.id, scen: r.scenario, screen: r.screen || '', act: r.action, exp: r.expected, who: r.assigned || [] }));
  const msgs = {}; by(tb.messages, 'position').forEach(m => (msgs[m.feedback_id] = msgs[m.feedback_id] || []).push({ id: m.id, from: m.sender, text: m.body, at: m.sent_at }));
  const items = {}; by(tb.feedback, 'seq').forEach(f => (items[f.result_id] = items[f.result_id] || []).push({ id: f.id, cat: f.category, text: f.body, primary: f.is_primary, seq: f.seq, thin: !!f.needs_detail, thread: msgs[f.id] || [] }));
  S.res = {}; (tb.results || []).forEach(r => S.res[r.id] = { r: r.result, shot: r.screenshot_data || '', env: r.env || '', saved: true, items: (items[r.id] || []).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || a.seq - b.seq) });
  S.notes = (tb.notifications || []).map(n => ({ id: n.id, to: n.recipient, kind: n.kind, text: n.body, ref: n.ref || {}, at: n.sent_at, read: n.is_read, pos: n.position })).sort((a, b) => b.pos - a.pos);
  S.sel = {}; S.mem = {}; S.known = {}; S.knownT = {}; S.idea = {}; S.checked = {}; S.sent = {}; S.fix = {};
  (tb.decisions || []).forEach(d => {
    const id = d.feedback_id;
    if (d.selected !== null && d.selected !== undefined) S.sel[id] = d.selected;
    if (d.member) S.mem[id] = d.member; if (d.known) S.known[id] = d.known; if (d.known_ticket) S.knownT[id] = d.known_ticket;
    if (d.idea) S.idea[id] = d.idea; if (d.checked) S.checked[id] = true; if (d.sent_text) S.sent[id] = d.sent_text; if (d.needs_correction) S.fix[id] = true;
  });
  S.groups = {}; (tb.group_decisions || []).forEach(g => { if (g.merged === true || g.merged === false) S.groups[g.anchor_id] = g.merged; });
  S.ptk = {}; S.tickets = by(tb.tickets, 'position').reverse().map(t => { if (t.problem_id) S.ptk[t.problem_id] = t.key; return { key: t.key, summary: t.summary, type: t.type, priority: t.priority, epic: t.epic, status: t.status, src: t.source, links: t.links, reopened: t.reopened, d: t.details || null, ev: t.evidence || null, seq: t.position || 0 }; });
  S.drafts = {}; (tb.drafts || []).forEach(d => S.drafts[d.problem_id] = d.fields);
}
async function api(path, body, opts = {}) {
  const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: opts.signal });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.message || 'Request failed'); e.code = j.code || 'upstream_error'; throw e; }
  return j;
}
function schedulePersist() { if (S.boot !== 'ready') return; clearTimeout(syncTimer); syncTimer = setTimeout(persist, 250); }
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
  if (syncing) { syncTimer = setTimeout(persist, 300); return; }
  const { snap, up, del, any } = diff();
  if (!any) return setSave('saved');
  syncing = true; setSave('saving');
  try { await api('/api/data/sync', { upsert: up, delete: del }); LAST = stringified(snap); setSave('saved'); }
  catch (e) { console.error(e); setSave('error'); syncTimer = setTimeout(persist, 3000); }
  finally { syncing = false; }
}
function setSave(s) { S.saveState = s; const el = document.getElementById('savestate'); if (el) { el.textContent = { saved: 'All changes saved', saving: 'Saving…', error: 'Could not save. Retrying…' }[s]; el.className = 'savestate ' + s; } }
const typing = () => { const a = document.activeElement; return !!(a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')); };
// Pick up changes made in other browsers (e.g. a tester on another computer)
setInterval(async () => {
  if (S.boot !== 'ready' || document.hidden || syncing || typing() || Object.keys(S.pending).length) return;
  if (diff().any) return;
  try {
    const { tables } = await api('/api/data');
    const keep = S; const before = JSON.stringify(LAST);
    hydrate(tables); const snap = snapshot(); const after = stringified(snap);
    if (JSON.stringify(after) !== before) { LAST = after; if (!S.testers.length) { S.boot = 'setup'; } render(); }
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
function post(cid, from, text) {
  const it = itemById(cid); if (!it || !text.trim()) return;
  it.thread.push({ id: cid + '|m' + uid(''), from, text: text.trim(), at: nowTime() });
  const [t, s] = cid.split('|'), q = /\?\s*$/.test(text.trim());
  if (from === 'manager') notify(t, q ? 'question' : 'reply', `The UAT manager ${q ? 'asked a question' : 'replied'} on your step ${s} feedback: "${text.trim()}"`, { cid });
  else notify('manager', 'reply', `${t} answered on step ${s}: "${text.trim()}"`, { cid, tester: t });
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
function ctxOf(kind, k) {
  const u = kind === 'p' ? S.ui[k] : S.ux[k], r = kind === 'p' ? u.r : S.res[k].r, cat = kind === 'p' ? 'bug' : u.cat;
  return { u, r, cat, st: step(k.split('|')[1]), key: kind + ':' + k };
}
async function runCheck(kind, k) {
  const { u, r, cat, st, key } = ctxOf(kind, k), text = (u.text || '').trim();
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
function useBasic(kind, k) { const { u, r, cat, key } = ctxOf(kind, k), text = (u.text || '').trim(); S.ai[key] = { status: 'done', text, r, cat, result: basicResult(kind, r, cat, text, 'Basic check used because the AI was not available.') }; }
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
  if (a && a.result.helpful && !a.result.mismatch) commit(kind, k, false);
  render();
}
function commit(kind, k, thin) {
  const [t, s] = k.split('|');
  if (kind === 'p') { const u = S.ui[k]; saveStep(t, s, u.r, u.text, u.shot, thin); delete S.ui[k]; delete S.ai['p:' + k]; S.openStep = null; toast(thin ? 'Saved. The UAT manager may ask you for a little more detail.' : assigned(t).every(x => isDone(t, x.step)) ? 'Saved. That was your last step!' : 'Saved. On to your next step.'); }
  else { const x = S.ux[k]; addItem(t, s, x.cat, x.text, thin, x.primary); delete S.ux[k]; delete S.ai['x:' + k]; toast(thin ? 'Comment added. The UAT manager may ask you for a little more detail.' : 'Comment added. The UAT manager has been told.'); }
}
const mark = b => b === true ? '<span class="m y">✓</span>' : b === false ? '<span class="m x">✗</span>' : '<span class="m q">?</span>';
function helperHTML(kind, k) {
  const { u, r, cat, key } = ctxOf(kind, k), text = (u.text || '').trim();
  if (kind === 'p' && !u.r) return '';
  if (kind === 'p' && r === 'pass') return '<span class="muted">No comment needed for a Pass. After saving, you can still add an idea or suggestion to this step.</span>';
  const a = S.ai[key], ek = esc(k), sv = kind === 'p' ? 'Save result' : 'Add comment';
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
  const sv = kind === 'p' ? 'Save result' : 'Add comment';
  if (res.mismatch) {
    if (kind === 'p') h += `<div class="ask"><b>You chose Fail, but your comment sounds like it worked.</b><span class="small">Did you mean Pass? A Pass needs no comment.</span><div class="row"><button class="btn sm primary" data-a="toPass" data-k="${esc(k)}">Yes, switch to Pass</button><button class="btn sm" data-a="keepSave" data-f="${kind}" data-k="${esc(k)}">No, keep Fail and save</button></div></div>`;
    else h += `<div class="ask"><b>This sounds like the step did not work, but it is marked Pass.</b><span class="small">Do you want to change the step to Fail? Your comment becomes the reason.</span><div class="row"><button class="btn sm primary" data-a="toFail" data-k="${esc(k)}">Yes, change to Fail</button><button class="btn sm" data-a="keepSave" data-f="${kind}" data-k="${esc(k)}">No, keep Pass and add it</button></div></div>`;
  } else if (!res.helpful) {
    if (res.question) h += `<div class="stack" style="gap:4px"><span><b>A question for you:</b> ${esc(res.question)}</span><span class="muted">Add the answer to your comment in your own words, then click ${sv} again.</span></div>`;
    h += `<div class="row"><button class="btn sm" data-a="saveAnyway" data-f="${kind}" data-k="${esc(k)}">Save anyway</button><span class="small muted">Not sure what to add? Save it as it is. It will be marked "needs more detail" so the UAT manager can ask you.</span></div>`;
  }
  const cat = kind === 'p' ? 'bug' : S.ux[k].cat;
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
  Object.entries(S.res).forEach(([k, v]) => { if (!v.saved) return; const [tester, st] = k.split('|'); v.items.forEach(i => out.push({ id: i.id, tester, step: st, r: v.r, shot: v.shot, cat: i.cat, text: i.text, primary: i.primary, thread: i.thread, seq: i.seq, thin: !!i.thin })); });
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
function pendingTriage() {
  const T = triage(); let n = 0;
  T.groups.forEach(g => { const m = S.groups[g.anchor]; if (m === undefined) n++; else if (m === true) n += g.members.filter(c => !S.mem[c.id]).length; });
  return n + T.known.filter(c => !S.known[c.id]).length + T.ideas.filter(c => !S.idea[c.id]).length;
}
const short = (t, n = 70) => { t = (t || '').trim(); t = t.charAt(0).toUpperCase() + t.slice(1); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
function problems() {
  const T = triage(), bugs = [], ideas = [];
  T.groups.forEach(g => {
    const m = S.groups[g.anchor];
    if (m === true) {
      const ins = g.members.filter(c => S.mem[c.id] === 'in');
      if (ins.length) bugs.push({ pid: 'g:' + g.anchor, kind: 'bug', members: ins, merged: ins.length > 1 });
      g.members.filter(c => S.mem[c.id] === 'out').forEach(c => bugs.push({ pid: 'c:' + c.id, kind: 'bug', members: [c] }));
    } else if (m === false) g.members.forEach(c => bugs.push({ pid: 'c:' + c.id, kind: 'bug', members: [c] }));
  });
  T.bugs.forEach(c => bugs.push({ pid: 'c:' + c.id, kind: 'bug', members: [c] }));
  T.known.filter(c => S.known[c.id] === 'new').forEach(c => bugs.push({ pid: 'c:' + c.id, kind: 'bug', members: [c] }));
  T.ideas.filter(c => S.idea[c.id] === 'bug').forEach(c => bugs.push({ pid: 'c:' + c.id, kind: 'bug', members: [c] }));
  T.ideas.filter(c => S.idea[c.id] === 'add').forEach(c => ideas.push({ pid: 'i:' + c.id, kind: 'idea', members: [c] }));
  [...bugs, ...ideas].forEach(p => { const c = p.members[0], st = step(c.step); p.title = S.ptk[p.pid] ? (S.tickets.find(t => t.key === S.ptk[p.pid]) || {}).summary : p.kind === 'idea' ? short(c.text) : `${st.screen || st.scen}: ${short(c.text, 60)}`; });
  return { bugs, ideas };
}

/* ===================== TICKET DRAFTER ===================== */
function draft(p) {
  const c = p.members[0], st = step(c.step);
  const answers = p.members.flatMap(m => m.thread.filter(x => x.from === 'tester').map(x => `${m.tester}: ${x.text}`));
  const envs = [...new Set(p.members.map(m => (S.res[m.tester + '|' + m.step] || {}).env).filter(Boolean))];
  return {
    summary: `${st.screen || st.scen}: ${short(c.text, 80)}`, type: p.kind === 'idea' ? 'Improvement' : 'Bug',
    description: `Found during UAT of ${appName()}. Reported by ${[...new Set(p.members.map(m => m.tester))].join(', ')} on step ${[...new Set(p.members.map(m => m.step))].join(' and ')}.${answers.length ? ' Follow-up answers: ' + answers.join('; ') + '.' : ''}`,
    steps: `1. Go to ${st.screen || st.scen}\n2. ${st.act}`, expected: st.exp, actual: p.members.map(m => m.text).join(' / '),
    env: 'UAT · ' + (envs.join('; ') || 'Not reported'), priority: p.kind === 'idea' ? 'Low' : 'Medium', why: '', epic: p.kind === 'idea' ? 'UX improvements' : st.scen, labels: p.kind === 'idea' ? 'uat, idea' : 'uat'
  };
}
async function aiDraft(p, fresh) {
  const pid = p.pid;
  if (!aiReady()) { S.drafts[pid] = Object.assign(draft(p), { _src: 'basic' }); S.open = pid; render(); return; }
  const ctl = new AbortController(); S.drafting[pid] = { status: 'drafting', ctl }; S.open = null; render();
  try {
    const envs = [...new Set(p.members.map(m => (S.res[m.tester + '|' + m.step] || {}).env).filter(Boolean))];
    const j = await api('/api/draft-ticket', { app: appName(), kind: p.kind, epics: epics(), envs, members: p.members.map(m => { const st = step(m.step); return { tester: m.tester, step: { scen: st.scen, step: st.step, screen: st.screen, act: st.act, exp: st.exp }, r: m.r, cat: m.cat, shot: !!(m.shot && m.primary), text: m.text, thread: m.thread.map(x => ({ from: x.from, text: x.text })) }; }), fresh: !!fresh }, { signal: ctl.signal });
    const base = draft(p), str = v => typeof v === 'string' ? v.trim() : '';
    S.drafts[pid] = { summary: str(j.summary) || base.summary, type: ['Bug', 'Improvement'].includes(j.type) ? j.type : base.type, description: str(j.description) || base.description,
      steps: str(j.steps).replace(/\\n/g, '\n') || base.steps, expected: str(j.expected), actual: str(j.actual), env: str(j.env) || base.env,
      priority: ['High', 'Medium', 'Low'].includes(j.priority) ? j.priority : base.priority, why: str(j.why), epic: epics().includes(j.epic) ? j.epic : base.epic, labels: str(j.labels) || 'uat', _src: 'ai' };
    delete S.drafting[pid]; S.open = pid;
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Stopped.' : aiErrorText(e);
    if (S.aiOff) { S.drafts[pid] = Object.assign(draft(p), { _src: 'basic', _note: msg }); delete S.drafting[pid]; S.open = pid; }
    else S.drafting[pid] = { status: 'error', err: msg };
  }
  TRI = null; render();
}
function vagueCheck(d) {
  const stepLines = (d.steps || '').split('\n').filter(l => /^\s*\d+[.)]/.test(l)).length;
  return [
    ['Summary says what breaks and where (6+ words, no "didn\'t work")', wc(d.summary) >= 6 && !VAGUE.test(d.summary)],
    ['At least 2 numbered steps to reproduce', stepLines >= 2],
    ['Expected result is stated', wc(d.expected) >= 3],
    ['Actual result describes what was seen (6+ words, no vague words)', wc(d.actual) >= 6 && !VAGUE.test(d.actual)],
    ['Environment named', wc(d.env) >= 2],
    ['Priority has a reason', wc(d.why) >= 3],
    ['Linked to an epic', !!d.epic]
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
  newProb: c => `Your feedback on ${stepTxt(c)} has been checked. It is a new problem, not one we already knew about, so it will get its own ticket.`,
  merged: (c, n) => `Your feedback on ${stepTxt(c)} has been checked. ${n > 1 ? `${n - 1} other tester${n > 2 ? 's' : ''} reported the same problem, so we merged the reports into one.` : 'It is now grouped as one problem.'} Your words are kept as evidence for the developer.${n >= 3 ? ' Because several testers reported it, it will be treated as a high priority.' : ''}`,
  separate: c => `Your feedback on ${stepTxt(c)} has been checked. It is a separate problem, so it will get its own ticket.`,
  ideaAdd: c => `Your idea "${c.text}" has been checked and added to the Good ideas list. Ideas like yours help make the next version better. Thank you!`,
  ideaNo: c => `Your idea "${c.text}" has been checked. Thank you, the team has read it. We are not adding it to the Good ideas list this time.`,
  ideaBug: c => `Your comment on ${stepTxt(c)} has been checked. It describes a problem, so we are treating it as bug feedback.`,
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
function summaryFor(t) {
  const mine = comments().filter(c => c.tester === t), steps = assigned(t).length;
  const probs = mine.filter(c => c.cat !== 'nonbug' || S.idea[c.id] === 'bug').length;
  const tickets = new Set(), fixed = new Set(); let linked = 0, ideas = 0, blocker = false;
  mine.forEach(c => {
    const r = ticketOfComment(c.id);
    if (r && r.key) { const tk = S.tickets.find(x => x.key === r.key) || {}; if (r.p.kind !== 'idea') tickets.add(r.key); if (tk.status === 'Done') fixed.add(r.key); if (tk.priority === 'High' && r.p.kind !== 'idea') blocker = true; }
    if (S.known[c.id] === 'link') { linked++; const tk = S.tickets.find(x => x.key === S.knownT[c.id]); if (tk && tk.status === 'Done') fixed.add(tk.key); }
    if (S.idea[c.id] === 'add') ideas++;
  });
  let s = `Thank you, ${t}! This test cycle you checked ${steps} step${steps !== 1 ? 's' : ''} and reported ${probs} problem${probs !== 1 ? 's' : ''}`;
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
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>'
};
const AV = ['#4f6fae', '#b0673d', '#3d8a80', '#7a65b0', '#a8577a', '#5b7d3a', '#9a6417', '#2e6d96'];
const av = (n, cls = 'avatar') => { if (n === 'M') return `<span class="${cls} av-M">UM</span>`; const i = Math.max(0, testers().indexOf(n)); return `<span class="${cls}" style="background:${AV[i % AV.length]}">${esc((n || '?')[0].toUpperCase())}</span>`; };
function toast(msg) { try { document.querySelectorAll('.toastpop').forEach(e => e.remove()); const d = document.createElement('div'); d.className = 'toastpop'; d.setAttribute('role', 'status'); d.innerHTML = I.check + '<span></span>'; d.lastChild.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); } catch (e) { /* ignore */ } }
const GUIDE = {
  tester: ['Choose <b>Pass</b> or <b>Fail</b> for your step.', '<b>Pass:</b> just click <b>Save result</b>. No comment needed.', '<b>Fail:</b> say what you saw in your own words, then click <b>Save result</b>. The AI checks it and may ask one question.', 'Add ideas or more comments to any step at any time.'],
  0: ['New feedback, replies and finished tests appear here.', 'Click a message to open the comment it is about.'],
  1: ['Add the steps testers will follow: scenario, screen, action and expected result.', 'Click names to assign testers to each step.', 'Testers then log in through the <b>Tester</b> interface.'],
  2: ['Pick a tester to see their results and comments.', 'Ask a question under any comment. The tester gets a notification.', 'When a tester has finished, send them a thank-you summary of what their feedback achieved.'],
  3: ['Go through each suggestion: duplicates, already known, good ideas.', 'Read the % and the reasons, then decide.', 'Nothing moves on until you click.', 'The tester gets a message automatically when you decide.'],
  4: ['Click <b>Make a ticket</b>. The AI writes a draft.', 'Check every field and fix anything that is wrong.', 'When the clarity check is all ✓, click <b>Create ticket</b>.'],
  5: ['Add tickets you already have, so new comments can be matched against them.', 'Change a status when a developer starts or fixes something. The testers who reported it are told automatically.']
};
function guide(id) {
  if (S.hideGuide[id]) return `<button class="btn link small guide-show" data-a="showGuide" data-v="${id}">Show help for this page</button>`;
  return `<div class="guide"><span class="gi">${I.bulb}</span><div><b>What to do here</b><ol>${GUIDE[id].map(x => `<li>${x}</li>`).join('')}</ol></div><button class="btn sm" data-a="hideGuide" data-v="${id}">Got it</button></div>`;
}
function threadHTML(cid, role) {
  const it = itemById(cid); if (!it) return '';
  const th = it.thread, tester = cid.split('|')[0], open = S.openTh[cid] || th.length || (role === 'manager' && it.thin);
  if (!open) return role === 'manager' ? `<button class="btn link small" data-a="openTh" data-k="${esc(cid)}" style="align-self:flex-start">Ask ${esc(tester)} a question</button>` : '';
  const canWrite = role === 'manager' || th.some(m => m.from === 'manager');
  return `<div class="thread">${th.map(m => `<div class="tmsg ${m.from === 'manager' ? 'mgr' : 'tst'}"><span><span class="who">${m.from === 'manager' ? 'UAT manager' : esc(tester)}</span> <span class="meta">${esc(m.at)}</span></span><span>${esc(m.text)}</span></div>`).join('')}
  ${canWrite ? `<div class="tinput"><input type="text" id="th-${esc(cid)}" aria-label="${role === 'manager' ? 'Message to ' + esc(tester) : 'Reply to the UAT manager'}" placeholder="${role === 'manager' ? (it.thin && !th.length ? `Ask ${esc(tester)} what happened, e.g. what did you see on screen?` : `Ask ${esc(tester)} a question or reply…`) : 'Reply to the UAT manager…'}"><button class="btn sm primary" data-a="post" data-k="${esc(cid)}" data-r="${role}">${role === 'manager' ? 'Send' : 'Reply'}</button></div><span class="small muted">${role === 'manager' ? `${esc(tester)} gets a notification in My updates.` : 'The UAT manager gets a notification.'}</span>` : ''}</div>`;
}
const catChip = i => i.cat === 'nonbug' ? '<span class="chip c-idea">Non-bug feedback</span>' : '<span class="chip c-bug">Bug feedback</span>';
const shotHTML = src => src ? `<img class="shotimg" src="${esc(src)}" alt="Screenshot attached by the tester">` : '';
const KIND = { question: ['Question', 'var(--accent)'], reply: ['Reply', 'var(--accent)'], update: ['Status update', 'var(--ok)'], feedback: ['New feedback', 'var(--warn)'], complete: ['Test completed', 'var(--ok)'] };
function noteList(to) {
  const ns = S.notes.filter(n => n.to === to);
  if (!ns.length) return '<div class="empty small">No messages yet.</div>';
  return ns.map(n => `<button class="nitem ${n.read ? '' : 'unread'}" data-a="openNote" data-v="${esc(n.id)}"><span class="dot"></span><span class="stack" style="gap:2px"><span class="kind" style="color:${(KIND[n.kind] || KIND.update)[1]}">${(KIND[n.kind] || KIND.update)[0]}</span><span class="t">${esc(n.text)}</span></span><span class="tm">${esc(n.at)}</span></button>`).join('');
}

/* ===================== FIRST RUN ===================== */
function vSetup() {
  const s = S.setup;
  return `<section class="panel setup"><div class="phead"><div><span class="eyebrow">Welcome to ReleaseReady</span><h2>Set up your test cycle</h2><p class="muted">Tell us who is testing. You can add the test steps next. Everything is saved to the database as you go.</p></div></div>
  <div class="form">
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
    <div class="row">${u.shot ? `<span class="shot">${shotHTML(u.shot)}<button class="btn link small" data-a="shotClear" data-k="${esc(k)}">Remove</button></span>` : `<label class="btn sm filebtn">+ Attach screenshot<input type="file" accept="image/*" data-a="shotFile" data-k="${esc(k)}"></label>`}<button class="btn sm primary" id="sv-p-${esc(k)}" data-a="saveStep" data-k="${esc(k)}" ${ok ? '' : 'disabled'}>${(S.ai['p:' + k] || {}).status === 'checking' ? 'Checking…' : 'Save result'}</button></div>` : '<span class="small muted">Do the step in the app, then choose Pass or Fail.</span>'}</div>`;
  }
  const x = S.ux[k];
  const items = res.items.map(i => { const c = comments().find(z => z.id === i.id); const st = c ? stageOf(c) : 0;
    return `<div class="citem" id="cm-${esc(i.id)}"><div class="row between"><div class="row">${catChip(i)}${i.primary ? '<span class="small muted">Reason for result</span>' : ''}</div>${c ? stageChips(st) : '<span class="small muted">Pass recorded</span>'}</div><span class="quote">"${esc(i.text)}"</span>${i.thin ? '<span class="small q">Marked "needs more detail". The UAT manager may ask you a question here.</span>' : ''}${i.primary ? shotHTML(res.shot) : ''}${threadHTML(i.id, 'tester')}</div>`; }).join('') || (res.r === 'pass' ? '<span class="small muted">Passed. No comment needed. You can add an idea or suggestion below.</span>' : '');
  let add = '';
  if (x && x.open) { const ok = canSave('x', k);
    add = `<div class="box sunk"><span class="eyebrow">Add a comment to step ${esc(s.step)}</span>
    <div class="radio" role="group" aria-label="Category"><button class="bug" aria-pressed="${x.cat === 'bug'}" data-a="xcat" data-k="${esc(k)}" data-v="bug">Bug feedback</button><button class="nonbug" aria-pressed="${x.cat === 'nonbug'}" data-a="xcat" data-k="${esc(k)}" data-v="nonbug">Non-bug feedback (idea, suggestion)</button></div>
    <label class="fl" for="x-${esc(k)}">Comment<textarea id="x-${esc(k)}" rows="2" data-a="cmt" data-f="x" data-k="${esc(k)}" placeholder="${x.cat === 'bug' ? 'What went wrong?' : 'What would make this better?'}">${esc(x.text)}</textarea></label>
    <div class="helper ${!ok ? 'need' : ''}" id="h-x-${esc(k)}">${helperHTML('x', k)}</div>
    <div class="row"><button class="btn sm primary" id="sv-x-${esc(k)}" data-a="saveX" data-k="${esc(k)}" ${ok ? '' : 'disabled'}>${(S.ai['x:' + k] || {}).status === 'checking' ? 'Checking…' : 'Add comment'}</button><button class="btn sm" data-a="closeX" data-k="${esc(k)}">Cancel</button></div></div>`;
  } else add = `<button class="btn sm" data-a="openX" data-k="${esc(k)}" style="align-self:flex-start">+ Add a comment (bug or non-bug)</button>`;
  return `<div class="stepcard done">${head}<div class="stack">${items}</div>${add}</div>`;
}
function tScript() {
  const t = S.me, a = assigned(t), d = a.filter(s => isDone(t, s.step)).length;
  let cur = S.openStep && a.some(s => t + '|' + s.step === S.openStep) ? S.openStep : null;
  if (!cur) { const nx = a.find(s => !isDone(t, s.step)); cur = nx ? t + '|' + nx.step : null; }
  const stepper = a.map((s, i) => { const k = t + '|' + s.step, dn = isDone(t, s.step); return `${i ? '<span class="sline"></span>' : ''}<button class="sdot ${dn ? 'done' : ''} ${k === cur ? 'cur' : ''}" data-a="openStep" data-k="${esc(k)}"><span class="c">${dn ? I.check : i + 1}</span>Step ${esc(s.step)}</button>`; }).join('');
  const cards = a.map(s => { const k = t + '|' + s.step, dn = isDone(t, s.step);
    if (k === cur) { let h = tStep(s).replace('class="stepcard', 'class="stepcard cur'); if (!dn) h = h.replace('<div class="row between"><div class="stack" style="gap:2px">', '<span class="nextlabel">' + I.play + ' Your next step</span><div class="row between"><div class="stack" style="gap:2px">'); return h; }
    const r = S.res[k];
    return `<div class="stepcard mini"><div class="row"><span class="sdot ${dn ? 'done' : ''}" style="cursor:default;border:none;padding:0"><span class="c">${dn ? I.check : '·'}</span></span><div class="stack" style="gap:0"><b>Step ${esc(s.step)} · ${esc(s.act)}</b><span class="small muted">${dn ? `${r.r === 'pass' ? 'Pass' : 'Fail'}${r.items.length ? ` · ${r.items.length} comment${r.items.length !== 1 ? 's' : ''}` : ''}` : 'Not tested yet'}</span></div></div><button class="btn sm" data-a="openStep" data-k="${esc(k)}">${dn ? 'Open' : 'Start'}</button></div>`; }).join('');
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">My test script</span><h2>${d === a.length && a.length ? 'All steps done. Thank you!' : `<span class="muted">Hi, ${esc(t)}!</span> You have ${a.length - d} step${a.length - d !== 1 ? 's' : ''} to test`}</h2><p class="muted">Do one step at a time. Write what you saw in your own words. The AI only checks that a developer can act on it. It never changes your words.</p></div></div>
  ${guide('tester')}
  ${a.length ? `<div class="stepper">${stepper}</div>` : ''}
  ${d === a.length && a.length ? '<div class="toast">You have completed your test. The UAT manager has been told. You can still open any step to add a comment.</div>' : ''}
  <div class="stack lg">${cards || '<div class="empty">No steps are assigned to you yet. The UAT manager assigns steps in the Test script.</div>'}</div></section>`;
}
function tUpdates() {
  const t = S.me, mine = comments().filter(c => c.tester === t);
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">My updates</span><h2>Messages from the UAT manager</h2><p class="muted">Questions, replies and status updates about your feedback. Click a message to open the comment it is about.</p></div>${unread(t) ? `<button class="btn sm" data-a="readAll" data-v="${esc(t)}">Mark all as read</button>` : ''}</div>
  <div class="stack">${noteList(t)}</div>
  <div class="stack"><span class="eyebrow">Status of my feedback</span>${mine.map(c => `<div class="box"><div class="row between"><div class="row">${catChip(c)}<span class="mono small muted">step ${esc(c.step)}</span><span class="quote small">"${esc(c.text)}"</span></div>${stageChips(stageOf(c))}</div>${S.sent[c.id] ? `<div class="inbox small">${esc(S.sent[c.id])}</div>` : ''}</div>`).join('') || '<div class="empty small">You have not sent any feedback yet.</div>'}</div></section>`;
}
function testerUI() {
  if (!S.me || !testers().includes(S.me)) return tLogin();
  const u = unread(S.me);
  return `<div class="banner tst"><span class="row">${av(S.me, 'av')}<span>Logged in as <b>${esc(S.me)}</b> · tester</span></span><button class="btn sm" data-a="logout">Switch person</button></div>
  <div class="ttabs" role="tablist"><button class="ttab" role="tab" aria-selected="${S.ttab === 'script'}" data-a="ttab" data-v="script">My test script</button><button class="ttab" role="tab" aria-selected="${S.ttab === 'updates'}" data-a="ttab" data-v="updates">My updates${u ? `<span class="badge">${u}</span>` : ''}</button></div>
  ${S.ttab === 'script' ? tScript() : tUpdates()}`;
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
    ${res ? `<span class="small muted">${esc(res.env)}</span>` + res.items.map(i => `<div class="citem" id="cm-${esc(i.id)}"><div class="row">${catChip(i)}${i.primary ? '<span class="small muted">Reason for result</span>' : ''}${i.thin ? '<span class="chip c-thin">Needs more detail</span>' : ''}</div><span class="quote">"${esc(i.text)}"</span>${i.primary ? shotHTML(res.shot) : ''}${threadHTML(i.id, 'manager')}</div>`).join('') + (res.items.length ? '' : '<span class="small muted">Passed. No comment.</span>') : ''}</div>`; }).join('');
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 2</span><h2>Testing progress</h2><p class="muted">Testers record results in the Tester interface (switch at the top). Here you can follow their progress, read every comment and ask a tester a question under their feedback.</p></div></div>
  <div class="grid3">${cards}</div>
  ${t && S.completed[t] ? (() => { const m = summaryFor(t), sent = S.sumSent[t] === m; return `<div class="box sunk"><div class="row between"><b>Thank-you summary for ${esc(t)}</b>${sent ? '<span class="chip c-ok">Sent</span>' : ''}</div><p class="small">${esc(m)}</p>${sent ? '' : `<div class="row"><button class="btn sm primary" data-a="sendSum" data-v="${esc(t)}">Send thank-you summary to ${esc(t)}</button><span class="small muted">${S.sumSent[t] ? 'Updated since you last sent it.' : 'Best sent at the end of the test cycle, so it includes fixes.'}</span></div>`}</div>`; })() : ''}
  <div class="stack"><span class="eyebrow">${esc(t || '')}'s steps</span>${detail || '<div class="empty small">No steps assigned to this tester yet.</div>'}</div>
  <div class="row between"><span></span><button class="btn primary" data-a="sec" data-v="3">Go to bugs and comments →</button></div></section>`;
}
function v3() {
  const T = triage();
  if (!T.cs.length) return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 3 · duplicate finder</span><h2>Bugs and comments</h2></div></div><div class="empty"><b>No bugs or comments yet</b><span>Failed steps and extra comments from testers appear here.</span></div></section>`;
  const byScen = {};
  const place = (scen, html) => (byScen[scen] = byScen[scen] || []).push(html);
  const quoteHead = (c, chip) => `<div class="row between"><div class="row">${chip}${c.thin ? '<span class="chip c-thin">Needs more detail</span>' : ''}<h3>${esc(c.tester)}: <span class="quote" style="font-weight:400">"${esc(c.text)}"</span></h3></div><span class="mono small muted">step ${esc(c.step)} · ${c.r === 'pass' ? 'Pass' : 'Fail'}</span></div>`;
  T.groups.forEach(g => {
    g.members.forEach(c => { if (S.sel[c.id] === undefined) S.sel[c.id] = memberScore(c, g).score >= 60; });
    const merged = S.groups[g.anchor], scores = g.members.map(c => memberScore(c, g).score), avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const a0 = g.members[0], st0 = step(a0.step);
    const mrow = c => { const p = memberScore(c, g), v = p.score, [l] = lvl(v), dec = S.mem[c.id], out = merged === true ? dec === 'out' : merged === false ? false : !S.sel[c.id];
      const ctl = merged === undefined ? `<input type="checkbox" id="sel-${esc(c.id)}" data-a="sel" data-k="${esc(c.id)}" ${S.sel[c.id] ? 'checked' : ''} aria-label="Include ${esc(c.tester)}'s comment in the merge">` : merged === true && !dec ? '<span class="chip c-new">New</span>' : `<span class="chip ${out ? 'c-grey' : 'c-ok'}">${merged === false ? 'Separate' : out ? 'Kept out' : 'Merged'}</span>`;
      return `<div class="member ${out ? 'out' : ''}" id="cm3-${esc(c.id)}">${ctl}<div class="stack" style="gap:3px"><div class="row"><b>${esc(c.tester)}</b><span class="mono small muted">step ${esc(c.step)}</span>${c.thin ? '<span class="chip c-thin">Needs more detail</span>' : ''}</div><span class="quote">"${esc(c.text)}"</span>
      <div class="row small muted"><span>${mark(p.sameStep)} same step</span><span>${mark(p.sameScreen)} same screen</span><span>${mark(p.sim >= 0.5 ? true : p.sim >= 0.3 ? null : false)} wording ${Math.round(p.sim * 100)}% alike</span><span>${mark(errSeen(c))} error or screenshot</span></div>
      ${merged === true && !dec ? `<div class="row"><span class="small q">Arrived after you merged.</span><button class="btn sm go" data-a="memIn" data-g="${esc(g.anchor)}" data-k="${esc(c.id)}">Add to merged problem</button><button class="btn sm" data-a="memOut" data-g="${esc(g.anchor)}" data-k="${esc(c.id)}">Keep separate</button></div>` : ''}${S.sent[c.id] || S.pending[c.id] ? told(c) : ''}${threadHTML(c.id, 'manager')}</div>
      <span class="mono" style="font-weight:600;color:var(--${l === 'h' ? 'ok' : l === 'm' ? 'warn' : 'bad'})">${v}%</span></div>`; };
    const n = g.members.filter(c => S.sel[c.id]).length;
    place(st0.scen, `<div class="box ${merged === undefined ? 'hl' : ''}"><div class="row"><span class="chip c-bug">Possible duplicates</span><h3>${g.members.length} comments may be the same bug${st0.screen ? ' on ' + esc(st0.screen) : ''}</h3></div>${conf(avg, 'Duplicate match')}
    <div class="why"><b>Why grouped</b><span>Score for each comment, against its closest match = same step (35) + same screen (20) + wording alike (up to 30) + both show an error or screenshot (15).</span>${scores.some(s => s < 60) ? '<span class="q"><b>Not sure about one comment.</b> Its score is low, so it starts unticked. Tick it if you think it is the same bug.</span>' : ''}</div>
    <div>${g.members.map(mrow).join('')}</div>
    ${merged === undefined ? `<div class="row"><button class="btn go" data-a="merge" data-g="${esc(g.anchor)}" ${n ? '' : 'disabled'}>Merge ${n} ticked comment${n !== 1 ? 's' : ''} into one problem</button><button class="btn" data-a="noMerge" data-g="${esc(g.anchor)}">Don't merge</button></div><span class="small muted">Each tester gets a message automatically when you decide.</span>` : `<div class="row"><span class="toast">${merged ? 'Merged. Unticked comments stay as separate problems.' : 'Not merged. Each comment stays a separate problem.'}</span><button class="btn link small" data-a="undoMerge" data-g="${esc(g.anchor)}">${undoLabel(g.members.map(x => x.id))}</button></div>`}</div>`);
  });
  T.known.forEach(c => { const cl = c.cl, d = S.known[c.id], t = S.tickets.find(x => x.key === cl.jira) || { summary: '', status: '' };
    place(step(c.step).scen, `<div class="box ${!d ? 'hl' : ''}">${quoteHead(c, '<span class="chip c-known">Already known</span>')}${conf(cl.conf, `Matches ${cl.jira}`)}<div class="why"><b>Compared with existing ticket ${esc(cl.jira)}: "${esc(t.summary)}" (${t.reopened ? 'reopened' : esc(t.status)})</b>${cl.why.map(w => `<div class="sig">${mark(w[1])}<span>${esc(w[0])}</span></div>`).join('')}</div>
    ${!d ? `<div class="row"><button class="btn go" data-a="known" data-k="${esc(c.id)}" data-t="${esc(cl.jira)}" data-v="link">${cl.closed ? `Link and reopen ${esc(cl.jira)}` : `Link to ${esc(cl.jira)}`}</button><button class="btn" data-a="known" data-k="${esc(c.id)}" data-t="${esc(cl.jira)}" data-v="new">Not the same, it's a new problem</button></div>` : `<div class="row"><span class="toast">${d === 'link' ? `Linked to ${esc(cl.jira)}. Not counted as a unique problem.` : 'Kept as a new problem.'}</span><button class="btn link small" data-a="known" data-k="${esc(c.id)}" data-t="${esc(cl.jira)}" data-v="">${undoLabel([c.id])}</button></div>`}${told(c)}${threadHTML(c.id, 'manager')}</div>`); });
  T.ideas.forEach(c => { const d = S.idea[c.id];
    place(step(c.step).scen, `<div class="box ${!d ? 'hl' : ''}">${quoteHead(c, '<span class="chip c-idea">Good idea</span>')}${conf(IDEA.test(c.text) ? 88 : 72, 'Suggestion, not a bug')}<div class="why"><div class="sig">${mark(true)}<span>The tester marked it as non-bug feedback</span></div><div class="sig">${mark(IDEA.test(c.text) ? true : null)}<span>${IDEA.test(c.text) ? 'Suggestion wording, like "would be great" or "would help"' : 'No clear suggestion wording, so check it'}</span></div></div>
    ${!d ? `<div class="row"><button class="btn go" data-a="idea" data-k="${esc(c.id)}" data-v="add">Add to Good ideas</button><button class="btn" data-a="idea" data-k="${esc(c.id)}" data-v="no">Not for now</button><button class="btn" data-a="idea" data-k="${esc(c.id)}" data-v="bug">It's actually a bug</button></div>` : `<div class="row"><span class="toast">${d === 'add' ? 'Added to Good ideas in Section 4.' : d === 'no' ? 'Checked. Not added to Good ideas.' : 'Treated as a bug.'}</span><button class="btn link small" data-a="idea" data-k="${esc(c.id)}" data-v="">${undoLabel([c.id])}</button></div>`}${told(c)}${threadHTML(c.id, 'manager')}</div>`); });
  T.bugs.forEach(c => place(step(c.step).scen, `<div class="box">${quoteHead(c, '<span class="chip c-new">Unique</span>')}<div class="why"><div class="sig">${mark(false)}<span>No duplicate among other comments, and no matching ticket</span></div></div><span class="small muted">Goes straight to unique problems. ${esc(c.tester)} is told when its ticket is created.</span>${S.sent[c.id] ? told(c) : ''}${threadHTML(c.id, 'manager')}</div>`));
  const scenOrder = [...new Set([...S.script.map(s => s.scen), ...Object.keys(byScen)])].filter(s => byScen[s]);
  const scen = scenOrder.map(s => { const list = T.cs.filter(c => step(c.step).scen === s), fails = new Set(list.filter(c => c.r === 'fail').map(c => c.tester + c.step)).size;
    return `<div class="scen"><div class="scenhead"><h3>${esc(s)}</h3><span class="small muted">${fails} failed step${fails !== 1 ? 's' : ''} · ${list.length} comment${list.length !== 1 ? 's' : ''}</span></div>${byScen[s].join('')}</div>`; }).join('');
  const pend = pendingTriage();
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 3 · duplicate finder</span><h2>Bugs and comments</h2><p class="muted">Every bug and non-bug comment. The duplicate finder groups the same bug, compares each comment with existing tickets, and flags good ideas. You decide, one at a time, and can ask the tester a question under any comment.</p></div></div>
  <div class="stats"><div class="stat"><b>${T.cs.length}</b><span>comments</span></div><div class="stat"><b>${T.dups.length}</b><span>possible duplicates</span></div><div class="stat"><b>${T.known.length}</b><span>already known</span></div><div class="stat"><b>${T.ideas.length}</b><span>good ideas</span></div><div class="stat"><b>${pend}</b><span>need your decision</span></div></div>
  <div class="stack lg">${scen}</div>
  <div class="row between"><p class="note">${pend ? `${pend} decision${pend > 1 ? 's' : ''} left. Undecided items don't move to Section 4 yet.` : 'All decided.'}</p><button class="btn primary" data-a="sec" data-v="4">Go to unique problems →</button></div></section>`;
}
function ticketForm(p) {
  const d = S.drafts[p.pid];
  const f = (k, l, rows, wide) => `<label class="fl ${wide ? 'wide' : ''}" for="f-${k}">${l}${rows ? `<textarea id="f-${k}" rows="${rows}" data-a="edit" data-k="${k}">${esc(d[k])}</textarea>` : `<input type="text" class="full" id="f-${k}" data-a="edit" data-k="${k}" value="${esc(d[k])}">`}</label>`;
  const sel = (k, l, opts) => `<label class="fl" for="f-${k}">${l}<select id="f-${k}" data-a="edit" data-k="${k}">${opts.map(o => `<option ${o === d[k] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  const ep = epics().includes(d.epic) ? epics() : [d.epic, ...epics()];
  return `<div class="box hl"><div class="row between"><span class="eyebrow">${d._src === 'ai' ? `New ticket · drafted by AI from ${p.members.length} comment${p.members.length > 1 ? 's' : ''} · check and edit every field` : 'New ticket · basic draft (AI not available) · edit anything'}</span><div class="row">${aiReady() ? `<button class="btn sm" data-a="redraft" data-p="${esc(p.pid)}">Redraft with AI</button>` : ''}<button class="btn link small" data-a="closeForm">Close</button></div></div>${d._note ? `<span class="small muted">${esc(d._note)}</span>` : ''}
  <div class="form">${f('summary', 'Summary', 0, true)}${sel('type', 'Issue type', ['Bug', 'Improvement'])}${sel('epic', 'Linked epic', ep)}
  ${f('description', 'Description', 2, true)}${f('steps', 'Steps to reproduce', 4, true)}${f('expected', 'Expected result', 2)}${f('actual', 'Actual result', 2)}
  ${f('env', 'Environment')}${f('labels', 'Labels')}${sel('priority', 'Priority', ['High', 'Medium', 'Low'])}${f('why', 'Why this priority', 2)}</div>
  <div class="why"><b>Evidence attached · testers' original words kept</b>${p.members.map(m => `<span>${esc(m.tester)}, step ${esc(m.step)}: <span class="quote">"${esc(m.text)}"</span>${m.shot && m.primary ? ' · screenshot' : ''}${m.thread.filter(x => x.from === 'tester').map(x => ` · answered: "${esc(x.text)}"`).join('')}</span>`).join('')}</div>
  <div class="box sunk"><span style="font-weight:600">Clarity check: could a developer act on this without asking?</span><div class="check" id="vchk"></div></div>
  <div class="row"><button class="btn go" id="createBtn" data-a="create" data-p="${esc(p.pid)}">Create ticket</button><span class="small muted" id="vmsg"></span></div></div>`;
}
function renderCheck() {
  const d = S.open && S.drafts[S.open], box = document.getElementById('vchk'); if (!d || !box) return;
  const ch = vagueCheck(d), bad = ch.filter(c => !c[1]).length;
  box.innerHTML = ch.map(c => `<div class="sig">${mark(c[1])}<span>${esc(c[0])}</span></div>`).join('');
  document.getElementById('createBtn').disabled = !!bad;
  document.getElementById('vmsg').textContent = bad ? `Still vague: fix ${bad} item${bad > 1 ? 's' : ''} before creating.` : 'Clear enough for a developer to act on.';
}
function v4() {
  const P = problems(), pend = pendingTriage();
  const card = p => { const key = S.ptk[p.pid], dr = S.drafting[p.pid];
    return `<div class="stack"><div class="box ${S.open === p.pid ? 'hl' : ''}"><div class="row between"><div class="row"><span class="chip ${p.kind === 'idea' ? 'c-idea' : 'c-bug'}">${p.kind === 'idea' ? 'Good idea' : p.merged ? `Merged · ${p.members.length} comments` : 'Bug'}</span><h3>${esc(p.title)}</h3></div>${key ? `<span class="chip c-ok">${esc(key)} created</span>` : ''}</div>
    <div class="stack" style="gap:3px">${p.members.map(m => `<span class="small">${esc(m.tester)} · step ${esc(m.step)}: <span class="quote">"${esc(m.text)}"</span></span>`).join('')}</div>
    ${key ? `<span class="small muted">${[...new Set(p.members.map(m => esc(m.tester)))].join(', ')} told: now ticket ${esc(key)}.</span><button class="btn link small" data-a="seeTicket" data-v="${esc(key)}" style="align-self:flex-start">See ${esc(key)} in existing tickets</button>`
      : dr && dr.status === 'drafting' ? `<div class="row"><span class="chip c-new">AI is writing the ticket draft…</span><span class="small muted">Usually 5 to 30 seconds.</span><button class="btn sm" data-a="stopDraft" data-p="${esc(p.pid)}">Stop</button></div>`
      : S.open === p.pid ? '' : `<div class="row"><button class="btn primary" data-a="makeTicket" data-p="${esc(p.pid)}">${dr && dr.status === 'error' ? 'Try again' : 'Make a ticket'}</button>${dr && dr.status === 'error' ? `<span class="small q">${esc(dr.err)}</span><button class="btn sm" data-a="basicDraft" data-p="${esc(p.pid)}">Use a basic draft</button>` : `<span class="small muted">${aiReady() ? 'The AI drafts it. You check and create.' : 'AI is off: a basic draft is used.'}</span>`}</div>`}</div>
    ${S.open === p.pid && !key && S.drafts[p.pid] ? ticketForm(p) : ''}</div>`; };
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 4 · ticket drafter</span><h2>Unique problems</h2><p class="muted">What's left after merging duplicates and removing already-known problems. "Make a ticket" asks the AI ticket drafter to write the ticket from every linked comment and the testers' answers. You check every field. A clarity check stops vague tickets.</p></div></div>
  ${pend ? `<div class="note">${pend} item${pend > 1 ? 's' : ''} in Section 3 still need${pend > 1 ? '' : 's'} a decision, so ${pend > 1 ? 'they are' : 'it is'} not shown here yet. <button class="btn link small" data-a="sec" data-v="3">Go to Section 3</button></div>` : ''}
  <div class="stack"><div class="row between"><span class="eyebrow">Unique problems · ${P.bugs.length}</span><span class="small muted">${P.bugs.filter(p => S.ptk[p.pid]).length} with a ticket</span></div>${P.bugs.map(card).join('') || '<div class="empty small">No unique problems yet.</div>'}</div>
  <div class="stack"><div class="row between"><span class="eyebrow">Good ideas · ${P.ideas.length}</span><span class="small muted">Not bugs. Make a ticket only if you want to plan it.</span></div>${P.ideas.map(card).join('') || '<div class="empty small">No good ideas added yet. Add them in Section 3.</div>'}</div></section>`;
}
function v5() {
  const rows = S.tickets.map(t => { const open = S.openTicket === t.key;
    return `<tr class="${t.src === 'UAT' ? 'new' : ''}"><td>${t.d ? `<button class="btn link mono" data-a="tOpen" data-v="${esc(t.key)}">${esc(t.key)}</button>` : `<span class="mono">${esc(t.key)}</span>`}</td><td>${esc(t.summary)}${t.links ? `<div class="small muted">+${t.links} UAT report${t.links > 1 ? 's' : ''} linked</div>` : ''}</td><td>${esc(t.type)}</td><td>${esc(t.priority)}</td><td>${esc(t.epic)}</td><td><select aria-label="Status of ${esc(t.key)}" id="st-${esc(t.key)}" data-a="tStatus" data-v="${esc(t.key)}">${['To do', 'In progress', 'Done'].map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td>${t.src === 'UAT' ? '<span class="chip c-new">New from UAT</span>' : t.reopened ? '<span class="chip c-bug">Reopened by UAT</span>' : `<span class="small muted">${esc(t.src)}</span>`}</td></tr>
    ${open && t.d ? `<tr class="tdetail"><td colspan="7"><div class="form"><div class="stack wide"><b>Description</b><span>${esc(t.d.description)}</span></div><div class="stack wide"><b>Steps to reproduce</b><span style="white-space:pre-line">${esc(t.d.steps)}</span></div><div class="stack"><b>Expected</b><span>${esc(t.d.expected)}</span></div><div class="stack"><b>Actual</b><span>${esc(t.d.actual)}</span></div><div class="stack"><b>Environment</b><span>${esc(t.d.env)}</span></div><div class="stack"><b>Priority reason</b><span>${esc(t.d.why)}</span></div><div class="stack wide"><b>Evidence</b>${(t.ev || []).map(m => `<span>${esc(m.tester)}: <span class="quote">"${esc(m.text)}"</span></span>`).join('')}</div></div></td></tr>` : ''}`; }).join('');
  return `<section class="panel"><div class="phead"><div><span class="eyebrow">Section 5</span><h2>Existing tickets</h2><p class="muted">Tickets you already had, plus new ones from this UAT cycle. Section 3 compares new comments against this list. Set a status to Done to tell testers to re-test.</p></div></div>
  ${S.tickets.length ? `<div class="tablewrap"><table><thead><tr><th>Key</th><th>Summary</th><th>Type</th><th>Priority</th><th>Epic</th><th>Status</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty"><b>No tickets yet</b><span>Tickets created in Unique problems appear here. You can also add tickets you already have.</span></div>'}
  <div class="box sunk"><span class="eyebrow">Add an existing ticket</span>
    <div class="form"><label class="fl" for="et-key">Ticket key<input type="text" class="full" id="et-key" placeholder="e.g. PROJ-142"></label>
    <label class="fl" for="et-epic">Epic / area<input type="text" class="full" id="et-epic" list="ep-list" placeholder="e.g. Login"><datalist id="ep-list">${epics().map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
    <label class="fl wide" for="et-sum">Summary<input type="text" class="full" id="et-sum" placeholder="e.g. Login page takes over 8 seconds to load"></label>
    <label class="fl" for="et-status">Status<select id="et-status"><option>To do</option><option>In progress</option><option>Done</option></select></label></div>
    <div class="row"><button class="btn primary sm" data-a="addTicket">Add ticket</button><span class="small muted" id="et-err"></span></div></div></section>`;
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
  <button class="sec" aria-current="${S.sec === 0}" data-a="sec" data-v="0"><span class="n">${I.inbox}</span><b>My updates</b>${um ? `<span class="badge">${um}</span>` : '<span></span>'}<span class="s">Notifications</span></button>
  ${GROUPS.map(g => `<span class="railgroup">${g[0]}</span>${g[1].map(n => secBtn(SECS[n - 1])).join('')}`).join('')}
  </nav>
  <main>${view.replace(/(<section class="panel"><div class="phead">[\s\S]*?<\/div><\/div>)/, '$1' + guide(S.sec))}</main></div>`;
}

/* ===================== RENDER ===================== */
function render() {
  TRI = null;
  const app = document.getElementById('app');
  const aiLabel = CFG.ai === 'none' ? 'AI off (basic checks)' : S.aiOff ? 'AI unavailable (basic checks)' : 'AI by Gemini';
  const header = `<header class="top"><div class="brandrow"><span class="logo">${I.bug}</span><div class="stack" style="gap:0"><h1>ReleaseReady</h1><span class="small muted">UAT for ${esc(S.appName || 'your app')} · ${aiLabel}</span></div></div>
  ${S.boot === 'ready' ? `<div class="row"><span id="savestate" class="savestate ${S.saveState}">${{ saved: 'All changes saved', saving: 'Saving…', error: 'Could not save. Retrying…' }[S.saveState]}</span><div class="role"><span class="eyebrow">Switch interface</span><div class="seg" role="group" aria-label="Switch interface"><button aria-pressed="${S.role === 'manager'}" data-a="role" data-v="manager">${I.board}UAT manager</button><button aria-pressed="${S.role === 'tester'}" data-a="role" data-v="tester">${I.user}Tester</button></div></div><button class="btn sm" data-a="askReset">Reset demo</button></div>` : ''}</header>`;
  const resetBar = S.confirmReset ? `<div class="banner danger"><span><b>Delete everything?</b> This removes all testers, steps, results, comments, messages and tickets from the database. You will then set up a new test cycle.</span><div class="row"><button class="btn sm dangerbtn" data-a="doReset">Delete everything</button><button class="btn sm" data-a="cancelReset">Cancel</button></div></div>` : '';
  let body;
  if (S.boot === 'loading') body = '<section class="panel"><div class="empty">Loading your test cycle…</div></section>';
  else if (S.boot === 'error') body = `<section class="panel"><div class="empty"><b>Could not reach the server or database</b><span>${esc(S.bootErr || '')}</span><button class="btn primary" data-a="retryBoot">Try again</button></div></section>`;
  else if (S.boot === 'setup') body = vSetup();
  else body = S.role === 'manager' ? managerUI() : testerUI();
  app.innerHTML = header + resetBar + body;
  if (S.boot === 'ready' && S.role === 'manager' && S.sec === 4) renderCheck();
  if (S.focus) { const el = document.getElementById('cm-' + S.focus) || document.getElementById('cm3-' + S.focus); S.focus = null; if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); } }
  schedulePersist();
}

/* ===================== ACTIONS ===================== */
const val = id => (document.getElementById(id) || {}).value || '';
async function resizeImage(file) {
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const scale = Math.min(1, 1000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}
const A = {
  role: e => { S.role = e.dataset.v; if (S.role === 'tester') { S.me = null; S.ttab = 'script'; } window.scrollTo({ top: 0 }); },
  login: e => { S.me = e.dataset.v; S.ttab = 'script'; S.openStep = null; },
  openStep: e => { S.openStep = e.dataset.k; },
  hideGuide: e => { S.hideGuide[e.dataset.v] = true; },
  showGuide: e => { delete S.hideGuide[e.dataset.v]; },
  logout: () => { S.me = null; },
  ttab: e => { S.ttab = e.dataset.v; },
  sec: e => { S.sec = +e.dataset.v; window.scrollTo({ top: 0 }); },
  askReset: () => { S.confirmReset = true; },
  cancelReset: () => { S.confirmReset = false; },
  doReset: async () => {
    Object.values(S.pending).forEach(p => clearTimeout(p.timer)); clearTimeout(syncTimer);
    try { await api('/api/data/reset', {}); } catch (e) { toast('Could not delete the data. Check the server.'); return; }
    S = freshState(); LAST = {}; S.boot = 'setup'; render(); toast('All data deleted. Set up a new test cycle.');
  },
  retryBoot: () => { boot(); },
  suStart: () => {
    const names = S.setup.names.map(n => n.trim());
    if (names.some(n => !n)) { S.setup.err = 'Please enter a name for every tester.'; return; }
    if (new Set(names.map(n => n.toLowerCase())).size !== names.length) { S.setup.err = 'Each tester needs a different name.'; return; }
    if (names.some(n => n.includes('|'))) { S.setup.err = 'Names cannot contain the | character.'; return; }
    S.testers = names.map(name => ({ name })); S.appName = S.setup.app.trim(); S.boot = 'ready'; S.sec = 1; S.role = 'manager';
    toast('Test cycle set up. Now add the test steps.');
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
  sendSum: e => { const t = e.dataset.v, m = summaryFor(t); S.sumSent[t] = m; notify(t, 'update', m, {}); toast('Thank-you summary sent to ' + t); },
  setR: e => { S.ui[e.dataset.k].r = e.dataset.v; },
  saveAnyway: e => { const kind = e.dataset.f, k = e.dataset.k, a = freshCheck(kind, k); commit(kind, k, !(a && a.result.helpful)); },
  keepSave: e => { const kind = e.dataset.f, k = e.dataset.k, a = freshCheck(kind, k); commit(kind, k, !(a && a.result.helpful)); },
  toPass: e => { const u = S.ui[e.dataset.k]; u.r = 'pass'; u.text = ''; },
  toFail: e => { const k = e.dataset.k, a = freshCheck('x', k); S.res[k].r = 'fail'; S.ux[k].primary = true; S.ux[k].cat = 'bug'; commit('x', k, !(a && a.result.helpful)); },
  basicCheck: e => { useBasic(e.dataset.f, e.dataset.k); },
  shotClear: e => { S.ui[e.dataset.k].shot = ''; },
  saveStep: e => { const k = e.dataset.k; if (canSave('p', k)) trySave('p', k); return 'keep'; },
  openX: e => { S.ux[e.dataset.k] = { open: true, cat: 'bug', text: '' }; },
  closeX: e => { delete S.ux[e.dataset.k]; },
  xcat: e => { S.ux[e.dataset.k].cat = e.dataset.v; },
  saveX: e => { const k = e.dataset.k; if (canSave('x', k)) trySave('x', k); return 'keep'; },
  openTh: e => { S.openTh[e.dataset.k] = true; },
  post: e => { const k = e.dataset.k, inp = document.getElementById('th-' + k); if (!inp || !inp.value.trim()) return; post(k, e.dataset.r, inp.value); toast(e.dataset.r === 'manager' ? 'Sent to ' + k.split('|')[0] : 'Reply sent to the UAT manager'); },
  openNote: e => { const n = S.notes.find(x => x.id === e.dataset.v); if (!n) return; n.read = true;
    if (n.to === 'manager') { if (n.ref.tester) { S.sec = 2; S.mtester = n.ref.tester; S.focus = n.ref.cid || null; } }
    else { S.ttab = 'script'; S.focus = n.ref.cid || null; if (n.ref.cid) { const [t, s] = n.ref.cid.split('|'); S.openStep = t + '|' + s; } } },
  readAll: e => { S.notes.filter(n => n.to === e.dataset.v).forEach(n => n.read = true); },
  merge: e => { const g = triage().groups.find(x => x.anchor === e.dataset.g); if (!g) return; S.groups[g.anchor] = true; g.members.forEach(c => S.mem[c.id] = S.sel[c.id] ? 'in' : 'out'); const ins = g.members.filter(c => S.mem[c.id] === 'in'); g.members.forEach(c => tell(c.id, S.mem[c.id] === 'in' ? withCredit(MSG.merged(c, ins.length), c, ins) : withCredit(MSG.separate(c), c))); toast('Merged. Messages send in 10 s (Undo to stop)'); },
  noMerge: e => { const g = triage().groups.find(x => x.anchor === e.dataset.g); if (!g) return; S.groups[g.anchor] = false; g.members.forEach(c => tell(c.id, withCredit(MSG.separate(c), c))); toast('Kept separate. Messages send in 10 s (Undo to stop)'); },
  undoMerge: e => { const g = triage().groups.find(x => x.anchor === e.dataset.g); if (!g) return; const quiet = g.members.map(c => revoke(c.id)).every(Boolean); delete S.groups[g.anchor]; g.members.forEach(c => delete S.mem[c.id]); delete S.drafts['g:' + g.anchor]; toast(quiet ? 'Undone. No message was sent.' : 'Decision reopened. A correction is sent when you decide again.'); },
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
  makeTicket: e => { const pid = e.dataset.p, P = problems(), p = [...P.bugs, ...P.ideas].find(x => x.pid === pid); if (!p) return; if (S.drafts[pid]) { S.open = pid; return; } aiDraft(p); },
  redraft: e => { const pid = e.dataset.p, P = problems(), p = [...P.bugs, ...P.ideas].find(x => x.pid === pid); delete S.drafts[pid]; aiDraft(p, true); },
  basicDraft: e => { const pid = e.dataset.p, P = problems(), p = [...P.bugs, ...P.ideas].find(x => x.pid === pid); if (!p) return; S.drafts[pid] = Object.assign(draft(p), { _src: 'basic', _note: 'Basic draft used because the AI was not available.' }); delete S.drafting[pid]; S.open = pid; },
  stopDraft: e => { const d = S.drafting[e.dataset.p]; if (d && d.ctl) d.ctl.abort(); },
  closeForm: () => { S.open = null; },
  create: e => { const pid = e.dataset.p, d = S.drafts[pid]; if (!d || vagueCheck(d).some(c => !c[1])) return; const P = problems(), p = [...P.bugs, ...P.ideas].find(x => x.pid === pid); if (!p) return;
    let key; do { key = 'UAT-' + (S.nextKey++); } while (S.tickets.some(t => t.key === key));
    const fields = { ...d }; delete fields._src; delete fields._note;
    S.ptk[pid] = key; S.tickets.unshift({ key, summary: d.summary, type: d.type, priority: d.priority, epic: d.epic, status: 'To do', src: 'UAT', links: 0, d: fields, ev: p.members.map(m => ({ id: m.id, tester: m.tester, step: m.step, text: m.text })), seq: ++S.seq }); S.open = null; delete S.drafts[pid];
    p.members.forEach(m => tell(m.id, p.kind === 'idea' ? MSG.ideaTicket(m, key) : withCredit(MSG.ticket(m, key, d.summary, d.priority), m, p.members), true));
    toast('Ticket ' + key + ' created. ' + [...new Set(p.members.map(m => m.tester))].join(', ') + ' told'); },
  addTicket: () => { const key = val('et-key').trim(), sum = val('et-sum').trim(), epic = val('et-epic').trim(), status = val('et-status') || 'To do', err = document.getElementById('et-err');
    if (!key || !sum) { if (err) err.textContent = 'Ticket key and summary are needed.'; return 'keep'; }
    if (S.tickets.some(t => t.key.toLowerCase() === key.toLowerCase())) { if (err) err.textContent = 'That ticket key already exists.'; return 'keep'; }
    S.tickets.push({ key, summary: sum, type: 'Bug', priority: 'Medium', epic, status, src: 'Existing', links: 0, d: null, ev: null, seq: 0 }); toast(key + ' added. New comments are now checked against it.'); },
  seeTicket: e => { S.openTicket = e.dataset.v; S.sec = 5; window.scrollTo({ top: 0 }); },
  tOpen: e => { S.openTicket = S.openTicket === e.dataset.v ? null : e.dataset.v; }
};
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-a]'); if (!el || ['SELECT', 'TEXTAREA', 'INPUT'].includes(el.tagName)) return;
  const f = A[el.dataset.a]; if (!f) return;
  const r = await f(el); if (r !== 'keep') render();
});
document.addEventListener('keydown', ev => {
  const el = ev.target; if (ev.key === 'Enter' && el.tagName === 'INPUT' && el.id.startsWith('th-')) { const k = el.id.slice(3); const b = el.parentElement.querySelector('[data-a="post"]'); if (b) { post(k, b.dataset.r, el.value); render(); } }
});
document.addEventListener('focusout', () => { if (S.renderLater) setTimeout(() => { if (!typing()) { S.renderLater = false; render(); } }, 50); });
document.addEventListener('change', async ev => {
  const el = ev.target, a = el.dataset.a;
  if (a === 'sel') { S.sel[el.dataset.k] = el.checked; render(); }
  if (a === 'suN') { const n = Math.max(1, Math.min(20, parseInt(el.value, 10) || 1)); S.setup.n = n; S.setup.names = Array.from({ length: n }, (_, i) => S.setup.names[i] || ''); render(); }
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
  if (a === 'cmt') { const k = el.dataset.k, f = el.dataset.f, u = f === 'p' ? S.ui[k] : S.ux[k]; u.text = el.value;
    const h = document.getElementById(`h-${f}-${k}`); if (h) { h.innerHTML = helperHTML(f, k); const ok = canSave(f, k); h.classList.toggle('need', !ok); document.getElementById(`sv-${f}-${k}`).disabled = !ok; } }
  if (a === 'edit') { S.drafts[S.open][el.dataset.k] = el.value; renderCheck(); schedulePersist(); }
  if (a === 'suApp') S.setup.app = el.value;
  if (a === 'suName') S.setup.names[+el.dataset.i] = el.value;
});

/* ===================== START ===================== */
async function boot() {
  S.boot = 'loading'; render();
  try {
    CFG = await api('/api/config');
    const { tables } = await api('/api/data');
    hydrate(tables); LAST = stringified(snapshot());
    S.boot = S.testers.length ? 'ready' : 'setup';
  } catch (e) { S.boot = 'error'; S.bootErr = e.message; }
  render();
}
boot();
})();

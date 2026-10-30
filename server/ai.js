// AI for ReleaseReady: Google Gemini through its REST API.
// The API key stays on the server. The browser never sees it.
const BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const KEY = process.env.GEMINI_API_KEY || '';

class AIError extends Error { constructor(code, message) { super(message); this.code = code; } }

let picked = null; // { check, draft }

// Pick the newest stable Flash-Lite model for quick comment checks and the newest Flash model for ticket drafts.
// GEMINI_MODEL_CHECK / GEMINI_MODEL_DRAFT in .env override this.
async function models() {
  if (picked) return picked;
  const fallback = { check: 'gemini-flash-lite-latest', draft: 'gemini-flash-latest' };
  let names = [];
  try {
    let token = '';
    do {
      const res = await fetch(`${BASE}/models?pageSize=200${token ? '&pageToken=' + token : ''}`, { headers: { 'x-goog-api-key': KEY }, signal: AbortSignal.timeout(6000) });
      if (!res.ok) break;
      const j = await res.json();
      (j.models || []).forEach(m => { if ((m.supportedGenerationMethods || []).includes('generateContent')) names.push(m.name.replace(/^models\//, '')); });
      token = j.nextPageToken || '';
    } while (token);
  } catch { /* use fallback */ }
  const usable = names.filter(n => /flash/.test(n) && !/(image|tts|audio|live|embed|transcribe|translate|robotics|computer)/.test(n));
  const rank = n => {
    const v = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
    const stable = /(preview|exp)/.test(n) ? 0 : 1;
    return stable * 1000 + v;
  };
  const best = list => list.sort((a, b) => rank(b) - rank(a))[0];
  picked = {
    check: process.env.GEMINI_MODEL_CHECK || best(usable.filter(n => /lite/.test(n))) || best(usable) || fallback.check,
    draft: process.env.GEMINI_MODEL_DRAFT || best(usable.filter(n => !/lite/.test(n))) || best(usable) || fallback.draft
  };
  return picked;
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch { /* try the outer braces */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new AIError('invalid_json', 'The AI answer could not be read.');
}

// Newer Flash models "think" before answering, at a medium level by default, which makes ticket drafts slow.
// These tasks are short and well defined, so keep thinking low. Models that reject the setting are retried without it.
const noThinking = new Set();
function thinkingFor(model, which) {
  if (noThinking.has(model)) return null;
  if (/gemini-2\.5/.test(model)) return /pro/.test(model) ? null : { thinkingBudget: 0 };
  return which === 'draft' ? { thinkingLevel: 'low' } : null;   // Flash-Lite already defaults to minimal thinking
}

// How long one try may take before it is given up, and the next try starts.
const LIMIT = { check: 12000, draft: 22000 };
const wait = (ms, signal) => new Promise((ok, no) => { const t = setTimeout(ok, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); no(Object.assign(new Error('Stopped'), { name: 'AbortError' })); }, { once: true }); });

// One request to one model, stopped after `ms` or when the caller stops.
async function tryOnce(model, which, prompt, signal, ms) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(new Error('timeout')), ms);
  const stop = () => ctl.abort(new Error('cancelled'));
  if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }
  const call = thinking => fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal: ctl.signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: Object.assign({ temperature: 0.2, responseMimeType: 'application/json' }, thinking ? { thinkingConfig: thinking } : {})
    })
  });
  const started = Date.now();
  try {
    const thinking = thinkingFor(model, which);
    let res = await call(thinking);
    if (!res.ok && res.status === 400 && thinking) {
      const detail = await res.text();
      if (/thinking/i.test(detail)) { noThinking.add(model); res = await call(null); }
      else res = new Response(detail, { status: 400 });
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`AI ${which === 'draft' ? 'ticket draft' : 'comment check'} (${model}): ${secs} s${res.ok ? '' : ', error ' + res.status}`);
    if (!res.ok) {
      const detail = await res.text();
      if (res.status === 429) throw new AIError('rate_limited', 'The free AI quota is used up for now.');
      if (res.status === 401 || res.status === 403 || (res.status === 400 && /API key|API_KEY|credential/i.test(detail))) throw new AIError('ai_auth', 'The Gemini API key was rejected.');
      if (res.status === 404) { picked = null; throw new AIError('no_model', `Model ${model} was not found.`); }
      if (res.status >= 500) throw new AIError('busy', `Gemini is busy (error ${res.status}).`);
      throw new AIError('upstream_error', `Gemini error ${res.status}: ${detail.slice(0, 300)}`);
    }
    const j = await res.json();
    if (j.promptFeedback && j.promptFeedback.blockReason) throw new AIError('refused', 'The AI declined this input.');
    const text = ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (!text.trim()) throw new AIError('empty_completion', 'The AI gave no answer.');
    return parseJSON(text);
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (signal && signal.aborted) throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
    if (ctl.signal.aborted) { console.log(`AI ${which} (${model}): gave up after ${(ms / 1000).toFixed(0)} s`); throw new AIError('timeout', `Gemini took longer than ${ms / 1000} s.`); }
    throw new AIError('busy', 'Could not reach Gemini: ' + (e.message || e));   // network problem
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', stop); }
}

// Gemini's free tier is sometimes overloaded (errors 500/503) or slow. Instead of failing at once:
// try the chosen model, wait a moment and try again if it was only busy, then fall back to the faster Flash-Lite model.
async function askJSON(prompt, which, signal) {
  if (!KEY) throw new AIError('ai_off', 'No GEMINI_API_KEY set.');
  const m = await models(), first = m[which], lite = m.check;
  const second = which === 'draft' && lite ? lite : first;
  const plan = [[first, 0], [second, second === first ? 1500 : 0], [second, 3000]];   // a short wait helps only when Gemini answered "busy", not when it was slow
  let last;
  for (const [model, pause] of plan) {
    if (pause && last && last.code === 'timeout') continue;
    try { if (pause) await wait(pause, signal); return await tryOnce(model, which, prompt, signal, LIMIT[which]); }
    catch (e) {
      last = e;
      if (e.name === 'AbortError' || !['busy', 'timeout', 'rate_limited', 'no_model', 'invalid_json', 'empty_completion'].includes(e.code)) throw e;
      if (e.code === 'no_model') await models();
    }
  }
  throw last;
}

module.exports = { askJSON, models, AIError, hasKey: () => !!KEY };

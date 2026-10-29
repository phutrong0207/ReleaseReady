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
      const res = await fetch(`${BASE}/models?pageSize=200${token ? '&pageToken=' + token : ''}`, { headers: { 'x-goog-api-key': KEY } });
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

async function askJSON(prompt, which, signal) {
  if (!KEY) throw new AIError('ai_off', 'No GEMINI_API_KEY set.');
  const m = await models();
  const model = m[which];
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
    })
  });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 429) throw new AIError('rate_limited', 'The free AI quota is used up for now.');
    if (res.status === 401 || res.status === 403 || (res.status === 400 && /API key|API_KEY|credential/i.test(detail))) throw new AIError('ai_auth', 'The Gemini API key was rejected.');
    if (res.status === 404) { picked = null; }
    throw new AIError('upstream_error', `Gemini error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const j = await res.json();
  if (j.promptFeedback && j.promptFeedback.blockReason) throw new AIError('refused', 'The AI declined this input.');
  const text = ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!text.trim()) throw new AIError('empty_completion', 'The AI gave no answer.');
  return parseJSON(text);
}

module.exports = { askJSON, models, AIError, hasKey: () => !!KEY };

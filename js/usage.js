/* Groq usage and limits.
   Groq does not let a web page read its rate-limit headers, so the app learns about limits two ways:
   - every successful reply says how many tokens it used: counted here per model over the last 24 hours;
   - when a limit is hit, Groq's error text says which one, the limit, what was used and when to try again. */

const LIMIT_LABELS = { TPD: 'tokens per day', RPD: 'requests per day', TPM: 'tokens per minute', RPM: 'requests per minute' };
const DAY_MS = 24 * 3600 * 1000;

class GroqLimitError extends Error {
  constructor(info) { super(limitText(info)); this.name = 'GroqLimitError'; this.limit = info; }
}

function usageFor(model) {
  S.usage = S.usage || {};
  return S.usage[model] || (S.usage[model] = { log: [], limits: {} });
}

/* Called after every successful reply. */
function recordUsage(model, tokens) {
  const u = usageFor(model), now = Date.now();
  u.log = u.log.filter(([t]) => now - t < DAY_MS).slice(-400);
  u.log.push([now, Math.max(0, Math.round(tokens || 0))]);
  delete u.block; // it answered, so it is not blocked
  save();
}

function usage24h(model) {
  const u = S.usage && S.usage[model], now = Date.now();
  const log = u ? u.log.filter(([t]) => now - t < DAY_MS) : [];
  return { tokens: log.reduce((s, [, n]) => s + n, 0), requests: log.length };
}

/* "Rate limit reached for model `x` ... on tokens per day (TPD): Limit 100000, Used 99312, Requested 2341.
    Please try again in 23m11.452s." → {kind, per, limit, used, requested, waitSec} */
function parseGroqLimit(msg) {
  msg = String(msg || '');
  const m = msg.match(/on (tokens|requests) per (minute|day)\s*\((\w+)\)\s*:?\s*Limit\s*(\d+)(?:,\s*Used\s*(\d+))?(?:,\s*Requested\s*(\d+))?/i);
  if (!m) return null;
  const info = { unit: m[1].toLowerCase(), per: m[2].toLowerCase(), kind: m[3].toUpperCase(), limit: +m[4], used: m[5] != null ? +m[5] : null, requested: m[6] != null ? +m[6] : null, waitSec: null };
  const w = msg.match(/try again in\s+([\dhms.]+)/i);
  if (w) {
    const t = w[1];
    const h = +(t.match(/(\d+)h/) || [])[1] || 0;
    const mi = +(t.match(/(\d+)m(?!s)/) || [])[1] || 0;
    const ms = parseFloat((t.match(/([\d.]+)ms/) || [])[1]) || 0;
    const s = parseFloat((t.replace(/[\d.]+ms/, '').match(/([\d.]+)s/) || [])[1]) || 0;
    info.waitSec = h * 3600 + mi * 60 + s + ms / 1000;
  }
  return info;
}

/* Remembers a limit Groq reported. Long waits block the model so the app stops sending requests that would fail. */
function recordLimit(model, info) {
  const u = usageFor(model);
  u.limits[info.kind] = info.limit;
  const wait = info.waitSec != null ? info.waitSec : (info.per === 'day' ? 15 * 60 : 60);
  if (info.per === 'day' || wait > 60) {
    u.block = { kind: info.kind, per: info.per, unit: info.unit, limit: info.limit, used: info.used, until: Date.now() + wait * 1000 };
  }
  save();
}

/* The model's current block, if Groq said to wait and that time hasn't passed. */
function activeBlock(model) {
  const u = S.usage && S.usage[model];
  if (!u || !u.block) return null;
  if (u.block.until <= Date.now()) { delete u.block; return null; }
  return u.block;
}

function fmtWait(ms) {
  const min = Math.ceil(ms / 60000);
  if (ms < 60000) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
const fmtClockTime = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtNum = n => Number(n).toLocaleString();

function limitText(info) {
  const wait = info.waitSec != null ? fmtWait(info.waitSec * 1000) : null;
  const label = LIMIT_LABELS[info.kind] || `${info.unit} per ${info.per}`;
  if (info.per === 'day') return `You've used today's Groq allowance for ${info.model} (${fmtNum(info.limit)} ${label}).${wait ? ` It comes back in ${wait}.` : ''}`;
  return `Groq's limit of ${fmtNum(info.limit)} ${label} for ${info.model} is used up.${wait ? ` Try again in ${wait}.` : ''}`;
}

/* Other models to switch to, best first. Each Groq model has its own separate allowance. */
const FALLBACK_ORDER = ['openai/gpt-oss-120b', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
function otherModels(current, n = 3) {
  const avail = (S.settings.models || []).filter(m => m !== current && !activeBlock(m));
  const rank = m => { const i = FALLBACK_ORDER.indexOf(m); return i < 0 ? 99 : i; };
  return avail.sort((a, b) => rank(a) - rank(b)).slice(0, n);
}

function openLimitDialog(info) {
  const model = info.model;
  const until = Date.now() + (info.waitSec || 0) * 1000;
  const others = otherModels(model);
  const pct = info.used != null && info.limit ? Math.min(100, Math.round(info.used / info.limit * 100)) : null;
  openModal(info.per === 'day' ? 'Out of AI allowance for today' : 'AI limit reached', `
    <div class="limit-box">
      <p>${esc(limitText(info))}</p>
      ${pct != null ? `
        <div class="meter" role="img" aria-label="${pct}% of the allowance used">
          <span style="width:${pct}%"></span>
        </div>
        <p class="muted small">${fmtNum(info.used)} of ${fmtNum(info.limit)} ${esc(LIMIT_LABELS[info.kind] || '')} used${info.requested ? `, and this request needed ${fmtNum(info.requested)} more` : ''}.</p>` : ''}
      ${info.waitSec ? `<p>Back at <b>${fmtClockTime(until)}</b>${info.per === 'day' ? ' (the allowance comes back gradually over 24 hours)' : ''}.</p>` : ''}
      ${others.length ? `
        <h3 class="small-head">Keep studying now</h3>
        <p class="muted small">Every Groq model has its own allowance. Switch to another one, then try again:</p>
        <div class="row gap wrap">${others.map(m => `<button class="btn" data-act="switchModel" data-m="${esc(m)}">Switch to ${esc(m)}</button>`).join('')}</div>` : ''}
      <h3 class="small-head">Use less</h3>
      <ul class="tips">
        <li>Make shorter quizzes (5 questions instead of 20).</li>
        <li>Set <b>Material sent per request</b> to Small in Settings.</li>
      </ul>
      <p class="muted small">Your exact limits are on <a href="https://console.groq.com/settings/limits" target="_blank" rel="noopener">Groq's limits page</a>. Groq's paid plan has much higher limits.</p>
      <div class="row end gap"><button class="btn ghost" data-act="closeModal">Close</button></div>
    </div>`);
}

ACT.switchModel = el => {
  S.settings.model = el.dataset.m;
  save(); closeModal();
  toast(`Switched to ${el.dataset.m}. Try again now.`, 'good', 5000);
  if (route().name === 'settings') render();
};

/* Settings → AI usage. Counts are from this computer only. */
function usageSectionHTML() {
  const st = S.settings, cur = st.model;
  const models = Object.keys(S.usage || {}).filter(m => m === cur || usage24h(m).requests || activeBlock(m));
  if (!models.includes(cur)) models.unshift(cur);
  const row = m => {
    const u = usage24h(m), blk = activeBlock(m), lim = (S.usage?.[m]?.limits || {}).TPD;
    // Groq's own count (from its limit message) also includes other computers, so prefer it while it's fresh.
    const used = blk && blk.kind === 'TPD' && blk.used != null ? Math.max(blk.used, u.tokens) : u.tokens;
    const pct = lim ? Math.min(100, Math.round(used / lim * 100)) : null;
    return `
      <div class="usage-row ${m === cur ? 'cur' : ''}">
        <div class="row between wrap gap">
          <b>${esc(m)}${m === cur ? ' <span class="muted small">(in use)</span>' : ''}</b>
          ${blk ? `<span class="status bad-text">Paused until ${fmtClockTime(blk.until)} (${esc(LIMIT_LABELS[blk.kind] || 'limit')})</span>` : `<span class="status good-text">Available</span>`}
        </div>
        <p class="muted small">Last 24 hours on this computer: ${fmtNum(u.tokens)} tokens in ${u.requests} request${u.requests === 1 ? '' : 's'}.</p>
        ${pct != null ? `
          <div class="meter ${pct >= 90 ? 'high' : ''}" role="img" aria-label="About ${pct}% of the daily allowance used"><span style="width:${pct}%"></span></div>
          <p class="muted small">About ${fmtNum(used)} of ${fmtNum(lim)} tokens a day used (${pct}%).</p>` : ''}
      </div>`;
  };
  return `
    <section class="block">
      <div class="block-head"><h2>AI usage</h2>${hasKey() ? '<button class="btn small" data-act="testAI">Check now</button>' : ''}</div>
      <p class="muted small">Groq's free plan has a daily allowance for each model. When it runs out, Study Buddy tells you when it comes back and offers another model. Counts here are from this computer only; Groq's own numbers are on <a href="https://console.groq.com/settings/limits" target="_blank" rel="noopener">its limits page</a>.</p>
      ${models.map(row).join('')}
    </section>`;
}

/* A tiny request (a few tokens) to see whether the current model is answering. */
ACT.testAI = async el => {
  const model = S.settings.model;
  const u = S.usage && S.usage[model];
  if (u) delete u.block; // ask Groq directly instead of trusting the saved pause
  try {
    await busy(el, 'Checking…', () => groqChat([{ role: 'user', content: 'Reply with the word OK.' }], { json: false, maxTokens: 5, temperature: 0 }));
    toast(`${model} is answering normally.`, 'good');
  } catch (e) { showError(e); }
  render();
};

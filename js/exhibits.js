/* Reference material shown with quiz questions, so a question never asks about something the student can't see.
   - Exhibits the AI writes as data: code (highlighted, line numbers), tables, charts, formulas.
   - Pictures (embedded JPEG): cropped from a page of the subject's PDF, or added by the student. */

const EXHIBIT_TYPES = ['code', 'table', 'chart', 'formula'];
const IMAGE_SRC_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function validateExhibit(x) {
  // Models sometimes send the exhibit as a JSON string or a ``` fenced block instead of an object.
  if (typeof x === 'string') x = parseExhibitString(x);
  if (Array.isArray(x)) x = x[0];
  if (!x || typeof x !== 'object') return null;
  if (!EXHIBIT_TYPES.includes(x.type)) {
    // Missing or odd "type": infer it from the fields.
    x = { ...x, type: (x.content || x.code) ? 'code' : x.latex ? 'formula' : x.series ? 'chart' : x.rows ? 'table' : '' };
    if (!x.type) return null;
  }
  const str = (v, n) => String(v ?? '').slice(0, n);
  if (x.type === 'code') {
    const content = unescapeCode(str(x.content ?? x.code, 8000)).replace(/\r/g, '').replace(/^\n+/, '').replace(/\s+$/, '');
    return content ? { type: 'code', language: str(x.language, 20).toLowerCase().trim(), content } : null;
  }
  if (x.type === 'formula') {
    const latex = str(x.latex, 1500).trim().replace(/^\\\[|\\\]$/g, '').replace(/^\$\$|\$\$$/g, '').trim();
    return latex ? { type: 'formula', latex } : null;
  }
  if (x.type === 'table') {
    const headers = (Array.isArray(x.headers) ? x.headers : []).slice(0, 8).map(h => str(h, 80));
    const rows = (Array.isArray(x.rows) ? x.rows : []).slice(0, 40).filter(Array.isArray).map(r => r.slice(0, 8).map(c => str(c, 160)));
    return rows.length ? { type: 'table', title: str(x.title, 120), headers, rows } : null;
  }
  // chart
  const labels = (Array.isArray(x.labels) ? x.labels : []).slice(0, 24).map(l => str(l, 40));
  let chart = ['bar', 'line', 'pie'].includes(x.chart) ? x.chart : 'bar';
  const series = (Array.isArray(x.series) ? x.series : []).slice(0, 4)
    .map(s => ({ name: str(s && s.name, 40), values: (s && Array.isArray(s.values) ? s.values : []).slice(0, labels.length).map(Number) }))
    .filter(s => s.values.length === labels.length && s.values.every(Number.isFinite));
  if (!labels.length || !series.length) return null;
  if (chart === 'pie' && (labels.length > 8 || series[0].values.some(v => v < 0))) chart = 'bar';
  return { type: 'chart', chart, title: str(x.title, 120), labels, series: chart === 'pie' ? series.slice(0, 1) : series, xLabel: str(x.xLabel, 40), yLabel: str(x.yLabel, 40) };
}

/* Code that arrived with "\n" written out (escaped twice) and no real line breaks: turn the escapes
   outside string literals back into line breaks and tabs, so `System.out.print("a\n")` keeps its "\n". */
function unescapeCode(s) {
  if (s.includes('\n') || !/\\[nt]/.test(s)) return s;
  let out = '', quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < s.length) { out += s[++i]; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    if (c === '\\' && s[i + 1] === 'n') { out += '\n'; i++; continue; }
    if (c === '\\' && s[i + 1] === 't') { out += '\t'; i++; continue; }
    out += c;
  }
  return out;
}

/* Reads an exhibit written as text: a JSON object (possibly escaped once more) or a fenced code block. */
function parseExhibitString(s) {
  s = String(s).trim();
  const fence = s.match(/^```([\w#+.\-]*)[ \t]*\n?([\s\S]*?)```$/);
  if (fence) return { type: 'code', language: fence[1] || '', content: fence[2] };
  if (!s.startsWith('{')) return null;
  const tries = [s, s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')];
  for (const t of tries) {
    try { return JSON.parse(t); } catch {}
    // Real line breaks or tabs inside JSON strings are invalid: escape them and try again.
    try { return JSON.parse(t.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t')); } catch {}
  }
  return null;
}

/* Finds the end of a {...} object starting at `start`, skipping braces inside strings. */
function matchBrace(s, start) {
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/* Moves an exhibit the AI wrote into the question text (as JSON or a ``` code block) into q.exhibit.
   Returns true when it changed the question. */
function liftExhibit(q) {
  if (!q || typeof q.question !== 'string') return false;
  let text = q.question, found = null;
  const m = text.match(/\{\s*\\?"type\\?"\s*:/);
  if (m) {
    const end = matchBrace(text, m.index);
    const raw = end > -1 ? text.slice(m.index, end + 1) : text.slice(m.index);
    const ex = validateExhibit(raw);
    if (ex) { found = ex; text = text.slice(0, m.index) + text.slice(m.index + raw.length); }
  }
  if (!found) {
    const f = text.match(/```([\w#+.\-]*)[ \t]*\n?([\s\S]*?)```/);
    const ex = f && validateExhibit({ type: 'code', language: f[1], content: f[2] });
    if (ex) { found = ex; text = text.slice(0, f.index) + text.slice(f.index + f[0].length); }
  }
  if (!found) return false;
  if (!q.exhibit) q.exhibit = found;
  q.question = text.replace(/\s*(exhibit|code)\s*:\s*$/i, '').replace(/\s+/g, ' ').trim() || 'What is the result of this code?';
  return true;
}

/* Repairs saved quizzes made before liftExhibit existed. */
function repairStoredExhibits() {
  let changed = false;
  for (const qz of S.quizzes || []) for (const q of qz.questions || []) {
    if (liftExhibit(q)) changed = true;
    else if (q.exhibit && q.exhibit.type === 'code') {
      const fixed = unescapeCode(q.exhibit.content);
      if (fixed !== q.exhibit.content) { q.exhibit.content = fixed; changed = true; }
    }
  }
  if (changed) save();
}

function validateFigure(f) {
  if (!f || typeof f.src !== 'string' || f.src.length > 3e6 || !IMAGE_SRC_RE.test(f.src)) return null;
  return { src: f.src, caption: String(f.caption || '').slice(0, 160), page: Number.isInteger(f.page) ? f.page : undefined };
}

/* Plain-text version, for AI prompts (the AI review needs to know what the student saw). */
function exhibitText(qq) {
  const x = qq.exhibit;
  let t = '';
  if (x) {
    if (x.type === 'code') t = `Code (${x.language || 'code'}):\n${x.content.slice(0, 1200)}`;
    if (x.type === 'formula') t = `Formula: ${x.latex}`;
    if (x.type === 'table') t = `Table: ${x.headers.join(' | ')}\n${x.rows.slice(0, 12).map(r => r.join(' | ')).join('\n')}`;
    if (x.type === 'chart') t = `${x.chart} chart "${x.title}": ` + x.series.map(s => `${s.name || 'values'}: ` + x.labels.map((l, i) => `${l}=${s.values[i]}`).join(', ')).join('; ');
  }
  if (qq.figure) t += `${t ? '\n' : ''}(The question shows a picture${qq.figure.page ? ` from page ${qq.figure.page} of the PDF` : ''}.)`;
  return t;
}

/* ---------- HTML ---------- */

function exhibitsHTML(qq, { quizId = '', index = -1, compact = false } = {}) {
  const parts = [];
  const x = qq.exhibit;
  if (x && x.type === 'code') parts.push(codeHTML(x));
  if (x && x.type === 'formula') parts.push(`<div class="ex ex-formula">\\[ ${esc(x.latex)} \\]</div>`);
  if (x && x.type === 'table') parts.push(tableHTML(x));
  if (x && x.type === 'chart') parts.push(chartHTML(x));
  if (qq.figure) parts.push(`
    <figure class="ex ex-figure ${compact ? 'compact' : ''}">
      <button class="fig-btn" data-act="zoomFigure" data-q="${esc(quizId)}" data-i="${index}" aria-label="Enlarge picture">
        <img src="${esc(qq.figure.src)}" alt="${esc(qq.figure.caption || 'Reference picture for this question')}">
      </button>
      ${qq.figure.caption ? `<figcaption>${esc(qq.figure.caption)}</figcaption>` : ''}
    </figure>`);
  return parts.length ? `<div class="exhibits">${parts.join('')}</div>` : '';
}

ACT.zoomFigure = el => {
  const q = quizById(el.dataset.q);
  const f = q && q.questions[+el.dataset.i]?.figure;
  if (!f) return;
  openModal(f.caption || 'Picture', `<img class="zoomed" src="${esc(f.src)}" alt="${esc(f.caption || 'Reference picture')}">`, { wide: true });
};

/* --- code --- */

const CODE_KEYWORDS = new Set(('abstract and as assert async await auto bool boolean break byte case catch char class const constexpr continue def default del delete do double elif else enum except explicit export extends extern false final finally float fn for foreach from func function goto if impl implements import in inline instanceof int interface is lambda let long match mod mut namespace new nil none not null nullptr or override package pass print printf println private protected public raise readonly ref return self short signed sizeof static string struct super switch template this throw throws true try type typedef typeof uint unsigned using val var virtual void volatile where while with yield None True False String System cout cin endl std').split(' '));
const HASH_COMMENT_LANGS = /^(py|python|rb|ruby|sh|bash|shell|zsh|r|perl|yaml|yml|toml|powershell|ps1)$/;

function codeHTML(x) {
  const hash = HASH_COMMENT_LANGS.test(x.language);
  const re = new RegExp([
    hash ? '(#[^\\n]*)' : '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
    '("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)',
    '(\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?[fFlLdDuU]?\\b)',
    '([A-Za-z_]\\w*)',
  ].join('|'), 'g');
  const segs = []; // [cls, text]
  let last = 0, m;
  while ((m = re.exec(x.content))) {
    if (m.index > last) segs.push(['', x.content.slice(last, m.index)]);
    const cls = m[1] ? 'c-com' : m[2] ? 'c-str' : m[3] ? 'c-num' : CODE_KEYWORDS.has(m[4]) ? 'c-kw' : '';
    segs.push([cls, m[0]]);
    last = re.lastIndex;
  }
  if (last < x.content.length) segs.push(['', x.content.slice(last)]);
  // Split segments into lines so every line can carry its own number.
  const lines = [[]];
  for (const [cls, text] of segs) {
    text.split('\n').forEach((piece, k) => {
      if (k > 0) lines.push([]);
      if (piece) lines[lines.length - 1].push(cls ? `<span class="${cls}">${esc(piece)}</span>` : esc(piece));
    });
  }
  return `<figure class="ex ex-code">
    <figcaption>${esc(x.language ? x.language.toUpperCase() === x.language ? x.language : x.language[0].toUpperCase() + x.language.slice(1) : 'Code')}</figcaption>
    <pre><code>${lines.map(l => `<span class="ln">${l.join('') || ' '}</span>`).join('')}</code></pre>
  </figure>`;
}

/* --- table --- */

function tableHTML(x) {
  return `<figure class="ex ex-table">
    ${x.title ? `<figcaption>${esc(x.title)}</figcaption>` : ''}
    <div class="table-wrap"><table>
      ${x.headers.length ? `<thead><tr>${x.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}
      <tbody>${x.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
  </figure>`;
}

/* --- chart (SVG; colours are the validated categorical order: blue, orange, aqua, yellow) --- */

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw) || raw;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}
const fmtNum = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(+v.toFixed(2));

function chartHTML(x) {
  const multi = x.chart === 'pie' ? true : x.series.length > 1;
  const legendItems = x.chart === 'pie' ? x.labels : x.series.map((s, i) => s.name || `Series ${i + 1}`);
  const legend = multi ? `<ul class="ch-legend">${legendItems.map((l, i) => `<li><i class="sw s${i + 1}"></i>${esc(l)}</li>`).join('')}</ul>` : '';
  const svg = x.chart === 'pie' ? pieSVG(x) : axisChartSVG(x);
  const data = `<details class="ch-data"><summary>Show the numbers</summary>${tableHTML({
    headers: [x.xLabel || '', ...x.series.map((s, i) => s.name || (x.series.length > 1 ? `Series ${i + 1}` : x.yLabel || 'Value'))],
    rows: x.labels.map((l, i) => [l, ...x.series.map(s => fmtNum(s.values[i]))]),
  })}</details>`;
  return `<figure class="ex ex-chart">${x.title ? `<figcaption>${esc(x.title)}</figcaption>` : ''}${legend}${svg}${data}</figure>`;
}

function axisChartSVG(x) {
  const W = 560, H = 260, P = { l: 48, r: 14, t: 14, b: x.xLabel ? 50 : 34 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const all = x.series.flatMap(s => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = v => P.t + ih - (v - lo) / (hi - lo) * ih;
  const n = x.labels.length, band = iw / n;
  const every = Math.ceil(n / 10); // keep x labels from colliding
  let out = ticks.map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'base' : 'grid'}"/><text x="${P.l - 8}" y="${y(t) + 4}" text-anchor="end" class="axis">${fmtNum(t)}</text>`).join('');
  out += x.labels.map((l, i) => i % every ? '' : `<text x="${P.l + band * (i + 0.5)}" y="${P.t + ih + 18}" text-anchor="middle" class="axis">${esc(l.length > 12 ? l.slice(0, 11) + '…' : l)}</text>`).join('');
  if (x.xLabel) out += `<text x="${P.l + iw / 2}" y="${H - 8}" text-anchor="middle" class="axis-title">${esc(x.xLabel)}</text>`;
  if (x.yLabel) out += `<text x="12" y="${P.t + ih / 2}" text-anchor="middle" class="axis-title" transform="rotate(-90 12 ${P.t + ih / 2})">${esc(x.yLabel)}</text>`;
  if (x.chart === 'bar') {
    const k = x.series.length, gap = 2;
    const bw = Math.max(3, Math.min(40, (band * 0.72 - gap * (k - 1)) / k));
    const groupW = bw * k + gap * (k - 1);
    x.series.forEach((s, si) => s.values.forEach((v, i) => {
      const bx = P.l + band * i + (band - groupW) / 2 + si * (bw + gap);
      const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
      const r = Math.min(4, bw / 2, h);
      // Round only the end away from the baseline.
      const d = v >= 0
        ? `M${bx},${top + h}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + bw - r}Q${bx + bw},${top} ${bx + bw},${top + r}V${top + h}Z`
        : `M${bx},${top}V${top + h - r}Q${bx},${top + h} ${bx + r},${top + h}H${bx + bw - r}Q${bx + bw},${top + h} ${bx + bw},${top + h - r}V${top}Z`;
      out += `<path d="${d}" class="f${si + 1}"><title>${esc((s.name ? s.name + ', ' : '') + x.labels[i])}: ${fmtNum(v)}</title></path>`;
    }));
  } else {
    x.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [P.l + band * (i + 0.5), y(v)]);
      out += `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('')}" class="ln${si + 1}"/>`;
      out += pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" class="f${si + 1} ring"><title>${esc((s.name ? s.name + ', ' : '') + x.labels[i])}: ${fmtNum(s.values[i])}</title></circle>`).join('');
    });
  }
  return `<svg class="ch-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(x.title || 'Chart')}">${out}</svg>`;
}

function pieSVG(x) {
  const vals = x.series[0].values, total = vals.reduce((a, b) => a + b, 0) || 1;
  const cx = 130, cy = 120, r = 104, r0 = 56;
  let a0 = -Math.PI / 2, out = '';
  vals.forEach((v, i) => {
    const a1 = a0 + v / total * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
    if (v > 0) out += `<path d="M${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z" class="f${i + 1} gap"><title>${esc(x.labels[i])}: ${fmtNum(v)} (${Math.round(v / total * 100)}%)</title></path>`;
    a0 = a1;
  });
  return `<svg class="ch-svg pie" viewBox="0 0 260 240" role="img" aria-label="${esc(x.title || 'Pie chart')}">${out}</svg>`;
}

/* ---------- pictures from the PDF ---------- */

const pdfDocCache = new Map();
async function getPdfDoc(docId) {
  if (!pdfDocCache.has(docId)) {
    pdfDocCache.set(docId, (async () => {
      const bytes = await kvGet('pdf:' + docId);
      if (!bytes || !window.pdfjsLib) return null;
      return pdfjsLib.getDocument({ data: new Uint8Array(bytes).slice() }).promise;
    })());
  }
  return pdfDocCache.get(docId);
}

async function renderPdfPage(docId, pageNo, width = 1400) {
  const pdf = await getPdfDoc(docId);
  if (!pdf || pageNo < 1 || pageNo > pdf.numPages) return null;
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 'print' intent draws without requestAnimationFrame, which stalls while the window is in the background.
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  return { canvas, page, vp };
}

/* Finds the largest picture drawn on a PDF page by walking its drawing operations. */
async function findImageBox(page, vp) {
  const ops = await page.getOperatorList();
  const O = pdfjsLib.OPS;
  const paints = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintJpegXObject].filter(v => v !== undefined));
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let best = null;
  const pageArea = vp.width * vp.height;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(ctm, args);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (args && args[0]) ctm = mul(ctm, args[0]); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (paints.has(fn)) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      const ratio = box.w * box.h / pageArea;
      if (ratio > 0.03 && ratio < 0.9 && (!best || box.w * box.h > best.w * best.h)) best = box;
    }
  }
  if (!best) return null;
  const pad = 14;
  const x = Math.max(0, best.x - pad), yy = Math.max(0, best.y - pad);
  return { x, y: yy, w: Math.min(vp.width - x, best.w + pad * 2), h: Math.min(vp.height - yy, best.h + pad * 2) };
}

function canvasToJpeg(canvas, crop, maxW = 1100) {
  const c = crop || { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const scale = Math.min(1, maxW / c.w);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(c.w * scale)); out.height = Math.max(1, Math.round(c.h * scale));
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.84);
}

/* The figure on a page as an embedded JPEG: cropped to the page's main picture, or the whole page if it has none. */
async function figureFromPage(docId, pageNo) {
  const r = await renderPdfPage(docId, pageNo);
  if (!r) return null;
  let box = null;
  try { box = await findImageBox(r.page, r.vp); } catch (e) { console.warn('Figure search failed', e); }
  return { src: canvasToJpeg(r.canvas, box, box ? 1100 : 1000), page: pageNo, cropped: !!box };
}

async function imageFileToJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('That file is not a picture Study Buddy can read.')); im.src = url; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return canvasToJpeg(c, null, 1200);
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- "Add picture" dialog: upload, paste, or crop a PDF page ---------- */

ACT.addPicture = el => openPictureDialog(el.dataset.q, +el.dataset.i);

function openPictureDialog(quizId, index) {
  const quiz = quizById(quizId), qq = quiz.questions[index];
  const s = subjectById(quiz.subjectId);
  const docs = (s?.docs || []).filter(d => d.hasPdf);
  let pending = null; // {src, caption, page}
  const { el } = openModal(qq.figure ? 'Change the picture' : 'Add a picture to this question', `
    <p class="muted">Show what the question is about: a code listing, chart, diagram or formula from your material.</p>
    <label class="drop small-drop"><input type="file" id="picFile" accept="image/*" hidden><span><u>Choose a picture</u>, or paste a screenshot with Ctrl+V</span></label>
    ${docs.length ? `
    <fieldset class="pdf-pick"><legend>Or take it from your PDF</legend>
      <div class="row gap wrap">
        ${docs.length > 1 ? `<select id="picDoc">${docs.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>` : ''}
        <label class="inline">Page <input type="number" id="picPage" min="1" max="${docs[0].pages}" value="${qq.figure?.page || 1}"></label>
        <button type="button" class="btn small" id="picShow">Show page</button>
      </div>
      <p class="muted small">Drag across the page to keep only the part you need.</p>
    </fieldset>` : (s?.docs.length ? '<p class="muted small">To take pictures from your PDF, add the PDF file again on the subject page (older uploads only kept the text).</p>' : '')}
    <div id="picStage" class="pic-stage"></div>
    <div class="row end gap">
      ${qq.figure ? '<button type="button" class="btn ghost danger-text" id="picRemove">Remove picture</button>' : ''}
      <button type="button" class="btn ghost" data-act="closeModal">Cancel</button>
      <button type="button" class="btn primary" id="picUse" disabled>Use picture</button>
    </div>`, { wide: true, onClose: () => document.removeEventListener('paste', onPaste) });
  const stage = $('#picStage', el), use = $('#picUse', el);
  let crop = null, pageCanvas = null;

  const showImage = src => { pending = { src, caption: '' }; pageCanvas = null; stage.innerHTML = `<img src="${esc(src)}" alt="Preview">`; use.disabled = false; };
  const fromFile = async f => { try { showImage(await imageFileToJpeg(f)); } catch (e) { showError(e); } };
  const onPaste = e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); fromFile(item.getAsFile()); }
  };
  document.addEventListener('paste', onPaste);
  $('#picFile', el).addEventListener('change', e => e.target.files[0] && fromFile(e.target.files[0]));

  const showBtn = $('#picShow', el);
  showBtn && showBtn.addEventListener('click', async () => {
    const docId = $('#picDoc', el)?.value || docs[0].id;
    const doc = docs.find(d => d.id === docId);
    const pageNo = clamp(parseInt($('#picPage', el).value, 10) || 1, 1, doc.pages);
    stage.innerHTML = '<p class="progress-line"><span class="spin"></span>Drawing the page…</p>';
    const r = await renderPdfPage(docId, pageNo, 1300);
    if (!r) { stage.innerHTML = '<p class="error-text">Could not open that page.</p>'; return; }
    pageCanvas = r.canvas; crop = null;
    let auto = null;
    try { auto = await findImageBox(r.page, r.vp); } catch {}
    pending = { src: null, caption: `Page ${pageNo} of ${doc.name.replace(/\.pdf$/i, '')}`, page: pageNo };
    stage.innerHTML = '<div class="crop-wrap"><div class="crop-sel" hidden></div></div>';
    const wrap = $('.crop-wrap', stage), sel = $('.crop-sel', stage);
    r.canvas.className = 'crop-canvas';
    wrap.prepend(r.canvas);
    const drawSel = () => {
      if (!crop) { sel.hidden = true; return; }
      const k = r.canvas.getBoundingClientRect().width / r.canvas.width;
      Object.assign(sel.style, { left: crop.x * k + 'px', top: crop.y * k + 'px', width: crop.w * k + 'px', height: crop.h * k + 'px' });
      sel.hidden = false;
    };
    if (auto) { crop = auto; drawSel(); } // start from the page's main picture
    let start = null;
    const pt = e => { const b = r.canvas.getBoundingClientRect(), k = r.canvas.width / b.width; return { x: clamp((e.clientX - b.left) * k, 0, r.canvas.width), y: clamp((e.clientY - b.top) * k, 0, r.canvas.height) }; };
    r.canvas.addEventListener('pointerdown', e => { start = pt(e); r.canvas.setPointerCapture(e.pointerId); });
    r.canvas.addEventListener('pointermove', e => {
      if (!start) return;
      const p = pt(e);
      crop = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      drawSel();
    });
    r.canvas.addEventListener('pointerup', () => { start = null; if (crop && (crop.w < 20 || crop.h < 20)) { crop = null; drawSel(); } });
    use.disabled = false;
  });

  use.addEventListener('click', () => {
    if (pageCanvas) pending.src = canvasToJpeg(pageCanvas, crop, 1100);
    if (!pending?.src) return;
    qq.figure = { src: pending.src, caption: pending.caption || '', ...(pending.page ? { page: pending.page } : {}) };
    save(); closeModal(); toast('Picture added to the question', 'good', 2000); render();
  });
  const rm = $('#picRemove', el);
  rm && rm.addEventListener('click', () => { delete qq.figure; save(); closeModal(); render(); });
}

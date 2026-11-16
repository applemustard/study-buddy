/* PDF text extraction, chapter detection and building the material sent to the AI. */

const pageCache = new Map();

async function getPages(docId) {
  if (pageCache.has(docId)) return pageCache.get(docId);
  const pages = (await kvGet('doc:' + docId)) || [];
  pageCache.set(docId, pages);
  return pages;
}

function cleanText(s) {
  return s.replace(/\u0000/g, '').replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractPdf(file, onProgress) {
  if (!window.pdfjsLib) throw new Error('The PDF reader did not load. Check your internet connection and reload.');
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let out = '', lastY = null, lastEnd = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const x = it.transform[4], y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > Math.max(2, (it.height || 10) * 0.5)) out += '\n';
      else if (lastEnd !== null && x - lastEnd > 1 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
      out += it.str;
      if (it.hasEOL) { out += '\n'; lastY = null; lastEnd = null; continue; }
      lastY = y; lastEnd = x + (it.width || 0);
    }
    pages.push(cleanText(out));
    onProgress && onProgress(i, pdf.numPages);
    page.cleanup();
  }
  await pdf.destroy();
  return pages;
}

/* Pasted notes become pseudo-pages of ~3000 characters, split on paragraph breaks. */
function textToPages(text) {
  const paras = cleanText(text).split(/\n\s*\n/);
  const pages = []; let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > 3000) { pages.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) pages.push(cur);
  return pages;
}

const NUM_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const HEAD_RE = /^\s*(chapter|unit|lesson|module|part|topic)\s+(\d{1,3}|[ivxlc]{1,6}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b[\s.:\-–—]*(.{0,80})$/i;

/* Fast path: real "Chapter N" headings near the top of a page. */
function detectChaptersHeuristic(pages) {
  const found = [];
  const seen = new Set();
  pages.forEach((p, idx) => {
    const lines = p.split('\n').slice(0, 8);
    const hits = lines.map(l => l.match(HEAD_RE)).filter(Boolean);
    if (hits.length === 0 || hits.length >= 3) return; // 3+ hits on one page = table of contents
    const m = hits[0];
    const key = (m[1] + ' ' + m[2]).toLowerCase();
    if (seen.has(key)) return; // running headers repeat on every page
    seen.add(key);
    let rest = m[3].trim();
    if (!rest) { // title often sits on the next line
      const li = lines.findIndex(l => HEAD_RE.test(l));
      rest = (lines[li + 1] || '').trim().slice(0, 80);
    }
    const label = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + ' ' + (NUM_WORDS.includes(m[2].toLowerCase()) ? NUM_WORDS.indexOf(m[2].toLowerCase()) + 1 : m[2].toUpperCase());
    found.push({ title: rest ? `${label}: ${rest}` : label, start: idx + 1 });
  });
  return found.length >= 2 ? found : null;
}

function finalizeChapters(list, nPages) {
  const sorted = list
    .map(c => ({ title: String(c.title || '').trim().slice(0, 90) || 'Section', start: clamp(parseInt(c.start ?? c.startPage, 10) || 1, 1, nPages) }))
    .sort((a, b) => a.start - b.start)
    .filter((c, i, a) => i === 0 || c.start > a[i - 1].start);
  if (!sorted.length) return [];
  if (sorted[0].start > 1) {
    // Front matter before the first chapter: fold it into chapter one if short.
    if (sorted[0].start <= 3) sorted[0].start = 1;
    else sorted.unshift({ title: 'Introduction', start: 1 });
  }
  return sorted.map((c, i) => ({ ...c, end: i + 1 < sorted.length ? sorted[i + 1].start - 1 : nPages }));
}

function chunkChapters(nPages) {
  const size = Math.max(3, Math.ceil(nPages / 6));
  const out = [];
  for (let s = 1; s <= nPages; s += size) out.push({ title: `Pages ${s}–${Math.min(nPages, s + size - 1)}`, start: s });
  return out;
}

/* Returns {chapters, method}. Tries headings, then the AI, then even page chunks. */
async function detectChapters(pages) {
  const n = pages.length;
  const h = detectChaptersHeuristic(pages);
  if (h) return { chapters: finalizeChapters(h, n), method: 'headings' };
  if (hasKey()) {
    try {
      const ai = await aiOutline(pages);
      const fin = finalizeChapters(ai, n);
      if (fin.length) return { chapters: fin, method: 'ai' };
    } catch (e) { console.warn('AI outline failed', e); }
  }
  return { chapters: finalizeChapters(chunkChapters(n), n), method: 'pages' };
}

/* Flat chapter list for a subject. Names are unique and prefixed by file when there are several files. */
function subjectChapters(subject) {
  if (!subject) return [];
  const multi = subject.docs.length > 1;
  const out = [];
  const used = new Set();
  for (const d of subject.docs) {
    const short = d.name.replace(/\.pdf$/i, '').slice(0, 28);
    for (const c of d.chapters || []) {
      let name = multi ? `${short}: ${c.title}` : c.title;
      let k = 2;
      while (used.has(name)) name = `${multi ? short + ': ' : ''}${c.title} (${k++})`;
      used.add(name);
      out.push({ name, docId: d.id, start: c.start, end: c.end });
    }
  }
  return out;
}

/* Picks random, evenly spread excerpts from each chapter so repeated generations see different material. */
async function buildContext(subject, { chapters = null, budget = 12000 } = {}) {
  const chs = subjectChapters(subject).filter(c => !chapters || chapters.includes(c.name));
  const texts = [];
  for (const c of chs) {
    const pages = await getPages(c.docId);
    // [p.N] markers let the AI point at the page a figure is on.
    texts.push({ name: c.name, text: pages.slice(c.start - 1, c.end).map((p, k) => `[p.${c.start + k}]\n${p}`).join('\n') });
  }
  const total = texts.reduce((s, t) => s + t.text.length, 0) || 1;
  return texts.filter(t => t.text.trim()).map(t => {
    const share = Math.max(700, Math.floor(budget * t.text.length / total));
    return `### Chapter: ${t.name}\n${excerpt(t.text, Math.min(share, budget))}`;
  }).join('\n\n');
}

function excerpt(text, budget) {
  if (text.length <= budget) return text;
  const k = Math.max(1, Math.floor(budget / 1200));
  const win = Math.floor(budget / k);
  const seg = Math.floor(text.length / k);
  const parts = [];
  for (let i = 0; i < k; i++) {
    const room = Math.max(0, seg - win);
    let s = i * seg + Math.floor(Math.random() * (room + 1));
    // start on a word boundary
    const sp = text.indexOf(' ', s);
    if (sp > -1 && sp - s < 40) s = sp + 1;
    // Keep the page number visible at the start of every excerpt.
    const mk = text.lastIndexOf('[p.', s);
    const marker = mk > -1 && !text.slice(s, s + 12).startsWith('[p.') ? (text.slice(mk).match(/^\[p\.\d+\]/) || [''])[0] + ' ' : '';
    parts.push(marker + text.slice(s, s + win));
  }
  return parts.join('\n[…]\n');
}

/* Adds a document (pages already extracted) to a subject. */
async function addDocument(subject, name, pages, onStatus, pdfBytes = null) {
  const chars = pages.reduce((s, p) => s + p.length, 0);
  if (chars < 200) throw new Error(`"${name}" has almost no selectable text. If it is a scanned PDF, run it through OCR first or paste the text instead.`);
  onStatus && onStatus('Finding chapters…');
  const { chapters, method } = await detectChapters(pages);
  const doc = { id: uid(), name, pages: pages.length, chars, addedAt: Date.now(), chapters, method };
  // The original file is kept so quizzes can show figures from its pages.
  if (pdfBytes) { await kvSet('pdf:' + doc.id, pdfBytes); doc.hasPdf = true; }
  await kvSet('doc:' + doc.id, pages);
  pageCache.set(doc.id, pages);
  subject.docs.push(doc);
  save();
  return doc;
}

async function redetectChapters(subject, doc) {
  const pages = await getPages(doc.id);
  const { chapters, method } = await detectChapters(pages);
  doc.chapters = chapters; doc.method = method;
  save();
}

async function removeDocument(subject, docId) {
  subject.docs = subject.docs.filter(d => d.id !== docId);
  pageCache.delete(docId);
  pdfDocCache.delete(docId);
  await kvDel('doc:' + docId);
  await kvDel('pdf:' + docId);
  save();
}

/* Older uploads kept only the text. Attaching the file again enables figures without touching chapters. */
async function reattachPdf(doc, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const n = pdf.numPages; await pdf.destroy();
  if (n !== doc.pages) throw new Error(`That PDF has ${n} pages, but "${doc.name}" has ${doc.pages}. Pick the same file.`);
  await kvSet('pdf:' + doc.id, bytes);
  pdfDocCache.delete(doc.id);
  doc.hasPdf = true;
  save();
}

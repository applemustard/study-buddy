/* Storage (IndexedDB key/value), app state and small shared helpers. */

const DB_NAME = 'study-buddy';
const KV = 'kv';
let _dbPromise;

function idb() {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(KV);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return _dbPromise;
}

async function kvGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(KV).objectStore(KV).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function kvSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV, 'readwrite');
    tx.objectStore(KV).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function kvDel(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV, 'readwrite');
    tx.objectStore(KV).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function kvKeys() {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(KV).objectStore(KV).getAllKeys();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const DEFAULT_STATE = {
  version: 1,
  settings: {
    apiKey: '',
    model: DEFAULT_MODEL,
    models: [],
    flipKey: ' ',
    againKey: '1',
    gotKey: '2',
    contextChars: 12000,
    displayName: '',
  },
  subjects: [],   // {id, name, hue, createdAt, docs:[{id, name, pages, chars, addedAt, chapters:[{title, start, end}]}]}
  quizzes: [],    // {id, subjectId, title, kind, chapters, createdAt, questions:[...], attempts:[...]}
  cards: [],      // {id, subjectId, front, back, chapter, kind, status:'new'|'got'|'again', reviews, createdAt, lastReviewed}
  exams: [],      // {id, subjectId, title, date, createdAt, plan:{startDate, rationale, sessions:[...], builtAt}}
  notes: [],      // {id, subjectId, title, style, chapters, input, markdown, createdAt, updatedAt, sharedBy?}
  usage: {},      // {[model]: {log: [[time, tokens]], limits: {TPD, RPD, ...}, block?: {kind, per, limit, used, until}}}
};

let S = structuredClone(DEFAULT_STATE);

async function loadState() {
  const saved = await kvGet('state');
  S = Object.assign(structuredClone(DEFAULT_STATE), saved || {});
  S.settings = Object.assign({}, DEFAULT_STATE.settings, (saved && saved.settings) || {});
}

let _saveTimer;
function save() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    kvSet('state', S).catch(err => toast('Could not save: ' + err.message, 'error'));
  }, 120);
}

/* ---------- helpers ---------- */

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Dates are stored as local YYYY-MM-DD strings. */
function iso(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const todayISO = () => iso(new Date());
function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 864e5); }
function isValidISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(parseISO(s)) && iso(parseISO(s)) === s; }
function fmtDate(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return parseISO(s).toLocaleDateString(undefined, opts);
}
function relDays(s) {
  const n = daysBetween(todayISO(), s);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/* ---------- lookups ---------- */

const subjectById = id => S.subjects.find(s => s.id === id);
const quizById = id => S.quizzes.find(q => q.id === id);
const examById = id => S.exams.find(e => e.id === id);
const cardsFor = sid => S.cards.filter(c => c.subjectId === sid);
const quizzesFor = sid => S.quizzes.filter(q => q.subjectId === sid);
const noteById = id => S.notes.find(n => n.id === id);
const notesFor = sid => S.notes.filter(n => n.subjectId === sid);

function subjectHue(sub) { return sub ? sub.hue : 220; }

/* Per-chapter performance across every quiz attempt of a subject. */
function chapterStats(sid) {
  const stats = {};
  for (const q of quizzesFor(sid)) {
    for (const a of q.attempts || []) {
      q.questions.forEach((qq, i) => {
        const k = qq.chapter || 'General';
        stats[k] = stats[k] || { chapter: k, correct: 0, total: 0 };
        stats[k].total++;
        if (a.answers[i] === qq.answer) stats[k].correct++;
      });
    }
  }
  return Object.values(stats).map(s => ({ ...s, pct: Math.round((s.correct / s.total) * 100) }));
}

function lastAttempt(sid) {
  let best = null;
  for (const q of quizzesFor(sid)) for (const a of q.attempts || []) if (!best || a.at > best.at) best = { ...a, quiz: q };
  return best;
}

/* Sharing with friends: no server. Items become a compressed share code ("SB1.…") that travels as
   pasted text, a small .txt file, or through the system share sheet. The friend imports it in their copy of the app. */

const SHARE_CODE_MAX = 60000; // longer codes are offered as a file only

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (window.CompressionStream) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 'SB1.' + b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return 'SB0.' + b64url(bytes);
}

async function decodeShare(text) {
  text = String(text || '').trim();
  if (text.startsWith('{')) return JSON.parse(text);
  const m = text.match(/SB([01])\.([A-Za-z0-9_-]{8,})/);
  if (!m) throw new Error('No Study Buddy share code found. It starts with “SB1.”.');
  try {
    const bytes = unb64url(m[2]);
    if (m[1] === '0') return JSON.parse(new TextDecoder().decode(bytes));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(stream).text());
  } catch {
    throw new Error('That share code is incomplete or damaged. Ask your friend to send it again, or send the file instead.');
  }
}

/* ---------- building payloads ---------- */

const cleanQuestion = q => ({ question: q.question, options: q.options, answer: q.answer, chapter: q.chapter, explanation: q.explanation,
  ...(q.exhibit ? { exhibit: q.exhibit } : {}), ...(q.figure ? { figure: { src: q.figure.src, caption: q.figure.caption, page: q.figure.page } } : {}) });
const cleanCard = c => ({ front: c.front, back: c.back, chapter: c.chapter, kind: c.kind });
const cleanNote = n => ({ title: n.title, style: n.style, markdown: n.markdown });

async function buildShare(kind, id, opts = {}) {
  const base = { app: 'study-buddy', v: 1, type: kind, from: (S.settings.displayName || '').trim(), createdAt: Date.now() };
  if (kind === 'quiz') {
    const q = quizById(id); const s = subjectById(q.subjectId);
    return { ...base, subject: s.name, title: q.title, data: { title: q.title, kind: q.kind, questions: q.questions.map(cleanQuestion) } };
  }
  if (kind === 'cards') {
    const s = subjectById(id);
    const cards = cardsFor(id).filter(c => opts.pile === 'again' ? c.status === 'again' : true);
    return { ...base, subject: s.name, title: `${s.name} flashcards`, data: { cards: cards.map(cleanCard) } };
  }
  if (kind === 'note') {
    const n = noteById(id); const s = subjectById(n.subjectId);
    return { ...base, subject: s.name, title: n.title, data: cleanNote(n) };
  }
  if (kind === 'subject') {
    const s = subjectById(id);
    const data = {
      quizzes: quizzesFor(id).map(q => ({ title: q.title, kind: q.kind, questions: q.questions.map(cleanQuestion) })),
      cards: cardsFor(id).map(cleanCard),
      notes: notesFor(id).map(cleanNote),
    };
    if (opts.material) {
      data.docs = [];
      for (const d of s.docs) data.docs.push({ name: d.name, chapters: d.chapters, method: d.method, pages: await getPages(d.id) });
    }
    return { ...base, subject: s.name, title: s.name, data };
  }
  throw new Error('Unknown share type');
}

function describeShare(p) {
  const d = p.data || {};
  const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;
  if (p.type === 'quiz') return `a quiz, “${p.title}” (${n(d.questions?.length || 0, 'question', 'questions')})`;
  if (p.type === 'cards') return `${n(d.cards?.length || 0, 'flashcard', 'flashcards')} for ${p.subject}`;
  if (p.type === 'note') return `notes, “${p.title}”`;
  if (p.type === 'subject') {
    const parts = [n(d.quizzes?.length || 0, 'quiz', 'quizzes'), n(d.cards?.length || 0, 'flashcard', 'flashcards'), n(d.notes?.length || 0, 'set of notes', 'sets of notes')];
    if (d.docs?.length) parts.push(n(d.docs.length, 'PDF', 'PDFs'));
    return `the whole subject “${p.subject}”: ${parts.join(', ')}`;
  }
  return 'something';
}

const slug = s => String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, ' ').slice(0, 50) || 'shared';

/* ---------- share dialog ---------- */

function openShareDialog(kind, id) {
  const extra = kind === 'cards'
    ? `<fieldset><legend>Which cards</legend>
         <label class="check"><input type="radio" name="pile" value="all" checked> All cards (${cardsFor(id).length})</label>
         <label class="check"><input type="radio" name="pile" value="again"> Only the Again pile (${cardsFor(id).filter(c => c.status === 'again').length})</label>
       </fieldset>`
    : kind === 'subject'
      ? `<label class="check"><input type="checkbox" name="material"> Include the PDF text, so your friend can make their own quizzes and cards</label>`
      : '';
  const { el } = openModal('Share with a friend', `
    <form class="form" id="shareForm" onsubmit="return false">
      <label>Your name, shown to your friend
        <input name="from" maxlength="40" value="${esc(S.settings.displayName)}" placeholder="e.g. Sam">
      </label>
      ${extra}
      <p id="shareWhat" class="share-what"></p>
      <div class="share-actions">
        <button type="button" class="btn primary" id="shareNative" hidden>Send with…</button>
        <button type="button" class="btn" id="shareCopy">Copy share code</button>
        <button type="button" class="btn" id="shareFile">Download share file</button>
      </div>
      <p class="muted small">Send the code in any chat or email, or attach the file. Your friend opens Study Buddy and picks <b>Import from a friend</b>. If they don't have the app yet, send them <b>Study Buddy.html</b> from the export folder too. Your quiz scores and card progress are not shared.</p>
    </form>`);
  let payload = null, code = '';
  const btnNative = $('#shareNative', el), btnCopy = $('#shareCopy', el), btnFile = $('#shareFile', el);
  const fileFor = () => new File([`Study Buddy share: ${describeShare(payload)}${payload.from ? `, from ${payload.from}` : ''}.\nOpen Study Buddy, choose "Import from a friend" and pick this file (or paste the code below).\n\n${code}\n`],
    `${slug(payload.title)} - Study Buddy.txt`, { type: 'text/plain' });

  async function rebuild() {
    S.settings.displayName = $('[name="from"]', el).value.trim(); save();
    const opts = { pile: $('[name="pile"]:checked', el)?.value, material: $('[name="material"]', el)?.checked };
    [btnNative, btnCopy, btnFile].forEach(b => (b.disabled = true));
    try {
      payload = await buildShare(kind, id, opts);
      code = await encodeShare(payload);
    } catch (e) { showError(e); return; }
    const empty = (kind === 'cards' && !payload.data.cards.length);
    $('#shareWhat', el).innerHTML = empty ? 'There are no cards in that pile.' : `You're sharing ${esc(describeShare(payload))}.`;
    btnFile.disabled = empty;
    btnCopy.disabled = empty || code.length > SHARE_CODE_MAX;
    btnCopy.title = code.length > SHARE_CODE_MAX ? 'Too long to paste. Send the file instead.' : '';
    if (code.length > SHARE_CODE_MAX) btnCopy.textContent = 'Too long to copy, use the file';
    const canNative = !!(navigator.canShare && navigator.canShare({ files: [fileFor()] }));
    btnNative.hidden = !canNative; btnNative.disabled = empty;
  }
  $$('input[type="radio"], input[type="checkbox"]', el).forEach(i => i.addEventListener('change', rebuild));
  $('[name="from"]', el).addEventListener('input', () => { clearTimeout(el._t); el._t = setTimeout(rebuild, 400); });

  btnCopy.addEventListener('click', async () => {
    const text = `${payload.from ? payload.from + ' shared ' : 'Shared '}${describeShare(payload)} from Study Buddy. Open Study Buddy, choose “Import from a friend” and paste this:\n${code}`;
    try { await navigator.clipboard.writeText(text); toast('Share code copied. Paste it in a chat or email.', 'good'); }
    catch { openModal('Copy this code', `<textarea class="code-box" rows="8" readonly>${esc(text)}</textarea><p class="muted small">Select all and copy it.</p>`); $('.code-box').select(); }
  });
  btnFile.addEventListener('click', () => {
    const f = fileFor();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Saved “${f.name}”. Attach it in a message to your friend.`, 'good', 6000);
  });
  btnNative.addEventListener('click', async () => {
    try { await navigator.share({ files: [fileFor()], title: payload.title, text: `Study Buddy: ${describeShare(payload)}` }); }
    catch (e) { if (e.name !== 'AbortError') showError(e); }
  });
  rebuild();
}

ACT.shareQuiz = el => openShareDialog('quiz', el.dataset.id);
ACT.shareDeck = el => openShareDialog('cards', el.dataset.sid);
ACT.shareNote = el => openShareDialog('note', el.dataset.id);
ACT.shareSubject = el => openShareDialog('subject', el.dataset.id);

/* ---------- import ---------- */

ACT.importShared = () => openImportDialog();

function openImportDialog(prefill = '') {
  const { el } = openModal('Import from a friend', `
    <div class="form">
      <label>Paste the share code or the whole message
        <textarea id="impText" rows="5" placeholder="SB1.…">${esc(prefill)}</textarea>
      </label>
      <label class="drop small-drop">
        <input type="file" id="impFile" accept=".txt,.json,text/plain,application/json" hidden>
        <span>or <u>choose the share file</u> (…Study Buddy.txt)</span>
      </label>
      <div id="impPreview"></div>
      <div class="row end gap" id="impButtons"><button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary" id="impRead">Read share</button></div>
    </div>`, { wide: true });
  const read = async text => {
    try { showImportPreview(el, validateShare(await decodeShare(text))); }
    catch (e) { $('#impPreview', el).innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
  };
  $('#impRead', el).addEventListener('click', () => read($('#impText', el).value));
  $('#impFile', el).addEventListener('change', async e => { const f = e.target.files[0]; if (f) read(await f.text()); });
  if (prefill) read(prefill);
}

/* Never trust shared data: keep only known fields, as strings, within limits. */
function validateShare(p) {
  if (!p || p.app !== 'study-buddy' || !['quiz', 'cards', 'note', 'subject'].includes(p.type)) throw new Error('That is not something Study Buddy can import.');
  const str = (v, n = 4000) => String(v ?? '').slice(0, n);
  const q = x => {
    const options = (Array.isArray(x.options) ? x.options : []).map(o => str(o, 500)).slice(0, 6);
    const answer = Number.isInteger(x.answer) && x.answer >= 0 && x.answer < options.length ? x.answer : -1;
    if (!(options.length >= 2 && answer >= 0 && x.question)) return null;
    const item = { id: uid(), question: str(x.question, 1500), options, answer, chapter: str(x.chapter, 120) || 'General', explanation: str(x.explanation, 1500) };
    const ex = validateExhibit(x.exhibit), fig = validateFigure(x.figure);
    if (ex) item.exhibit = ex;
    if (fig) item.figure = fig;
    liftExhibit(item); // quizzes shared from 1.0.2 can have the code inside the question text
    return item;
  };
  const quiz = x => ({ title: str(x.title, 100) || 'Shared quiz', kind: x.kind === 'test' ? 'test' : 'quiz', questions: (x.questions || []).slice(0, 200).map(q).filter(Boolean) });
  const card = x => x && x.front && x.back ? { front: str(x.front, 2000), back: str(x.back, 4000), chapter: str(x.chapter, 120), kind: ['targeted', 'broad', 'core', 'manual'].includes(x.kind) ? x.kind : 'core' } : null;
  const note = x => ({ title: str(x.title, 100) || 'Shared notes', style: NOTE_STYLES[x.style] ? x.style : 'outline', markdown: str(x.markdown, 200000) });
  const d = p.data || {};
  const out = { type: p.type, from: str(p.from, 40), subject: str(p.subject, 60) || 'Shared subject', title: str(p.title, 100), data: {} };
  if (p.type === 'quiz') out.data = quiz(d);
  if (p.type === 'cards') out.data = { cards: (d.cards || []).slice(0, 2000).map(card).filter(Boolean) };
  if (p.type === 'note') out.data = note(d);
  if (p.type === 'subject') out.data = {
    quizzes: (d.quizzes || []).slice(0, 100).map(quiz).filter(x => x.questions.length),
    cards: (d.cards || []).slice(0, 5000).map(card).filter(Boolean),
    notes: (d.notes || []).slice(0, 200).map(note),
    docs: (d.docs || []).slice(0, 20).filter(x => Array.isArray(x.pages)).map(x => ({
      name: str(x.name, 120) || 'Shared PDF', method: str(x.method, 20),
      pages: x.pages.slice(0, 3000).map(pg => str(pg, 50000)),
      chapters: (x.chapters || []).map(c => ({ title: str(c.title, 90), start: +c.start || 1, end: +c.end || 1 })),
    })),
  };
  if (p.type === 'quiz' && !out.data.questions.length) throw new Error('That quiz has no usable questions.');
  if (p.type === 'cards' && !out.data.cards.length) throw new Error('That deck has no cards.');
  return out;
}

function showImportPreview(el, p) {
  const match = S.subjects.find(s => s.name.toLowerCase() === p.subject.toLowerCase());
  $('#impPreview', el).innerHTML = `
    <div class="import-card">
      <p><b>${esc(p.from || 'A friend')}</b> shared ${esc(describeShare(p))}.</p>
      ${p.type === 'subject' ? '' : `<label>Add it to
        <select id="impTarget">
          ${S.subjects.map(s => `<option value="${s.id}" ${match && match.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          <option value="new" ${match ? '' : 'selected'}>New subject: ${esc(p.subject)}</option>
        </select></label>`}
    </div>`;
  $('#impButtons', el).innerHTML = `<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary" id="impGo">Add to my Study Buddy</button>`;
  $('#impGo', el).addEventListener('click', async e => {
    try { await busy(e.target, 'Adding…', () => importShared(p, $('#impTarget', el)?.value || 'new')); }
    catch (err) { showError(err); }
  });
}

async function importShared(p, target) {
  let s = target !== 'new' && subjectById(target);
  if (!s) {
    let name = p.subject, k = 2;
    while (p.type === 'subject' && S.subjects.some(x => x.name === name)) name = `${p.subject} (${k++})`;
    s = { id: uid(), name, hue: HUES[S.subjects.length % HUES.length], createdAt: Date.now(), docs: [] };
    S.subjects.push(s);
  }
  const now = Date.now();
  const addQuiz = q => { const quiz = { id: uid(), subjectId: s.id, ...q, chapters: null, createdAt: now, attempts: [], sharedBy: p.from }; S.quizzes.push(quiz); return quiz; };
  const addCards = list => { const cards = list.map(c => ({ id: uid(), subjectId: s.id, ...c, status: 'new', reviews: 0, createdAt: now, sharedBy: p.from })); S.cards.push(...cards); return cards; };
  const addNote = n => { const note = { id: uid(), subjectId: s.id, ...n, chapters: null, input: '', createdAt: now, updatedAt: now, sharedBy: p.from }; S.notes.push(note); return note; };

  let go = '#/subject/' + s.id, msg;
  if (p.type === 'quiz') { const q = addQuiz(p.data); go = '#/quiz/' + q.id; msg = `Added the quiz “${q.title}”`; }
  if (p.type === 'cards') { const c = addCards(p.data.cards); startCardSession(s.id, 'new', false, c.map(x => x.id)); go = '#/cards/' + s.id; msg = `Added ${c.length} flashcards to ${s.name}`; }
  if (p.type === 'note') { const n = addNote(p.data); go = '#/note/' + n.id; msg = `Added “${n.title}”`; }
  if (p.type === 'subject') {
    p.data.quizzes.forEach(addQuiz); addCards(p.data.cards); p.data.notes.forEach(addNote);
    for (const d of p.data.docs) {
      const doc = { id: uid(), name: d.name, pages: d.pages.length, chars: d.pages.reduce((n, x) => n + x.length, 0), addedAt: now, chapters: d.chapters, method: d.method };
      await kvSet('doc:' + doc.id, d.pages); pageCache.set(doc.id, d.pages); s.docs.push(doc);
    }
    msg = `Added the subject “${s.name}”`;
  }
  save(); closeModal(); toast(msg, 'good');
  if (location.hash === go) render(); else location.hash = go;
}

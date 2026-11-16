/* Subjects list and subject detail (documents, chapters, quizzes, performance). */

const HUES = [214, 152, 8, 268, 32, 186, 330, 96];

function subjectDot(sub) { return `<i class="sdot" style="--h:${subjectHue(sub)}"></i>`; }

function renderSubjects() {
  return `
    <header class="page-head">
      <h1>Subjects</h1>
      <div class="row gap wrap">
        <button class="btn" data-act="importShared">Import from a friend</button>
        <button class="btn primary" data-act="newSubject">New subject</button>
      </div>
    </header>
    ${S.subjects.length ? `<ul class="subject-list">${S.subjects.map(subjectRow).join('')}</ul>` : `
      <div class="empty">
        <h2>Add your first subject</h2>
        <p>A subject holds the PDFs for one class, for example “Biology” or “Macroeconomics”. Quizzes, flashcards and exam plans are built from those PDFs.</p>
        <button class="btn primary" data-act="newSubject">New subject</button>
      </div>`}`;
}

function subjectRow(s) {
  const cards = cardsFor(s.id);
  const last = lastAttempt(s.id);
  const pages = s.docs.reduce((n, d) => n + d.pages, 0);
  return `<li><a class="subject-row" href="#/subject/${s.id}">
    ${subjectDot(s)}
    <span class="sr-name">${esc(s.name)}</span>
    <span class="sr-meta">${s.docs.length ? `${s.docs.length} PDF${s.docs.length > 1 ? 's' : ''}, ${pages} pages` : 'No PDFs yet'}</span>
    <span class="sr-meta">${cards.length} cards</span>
    <span class="sr-score ${last ? scoreTone(last.score) : ''}">${last ? last.score + '%' : '—'}</span>
  </a></li>`;
}

ACT.newSubject = () => {
  const { el } = openModal('New subject', `
    <form id="subForm" class="form">
      <label>Name<input name="name" required maxlength="60" placeholder="e.g. Cell Biology"></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Create subject</button></div>
    </form>`);
  $('#subForm', el).addEventListener('submit', e => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    if (!name) return;
    const sub = { id: uid(), name, hue: HUES[S.subjects.length % HUES.length], createdAt: Date.now(), docs: [] };
    S.subjects.push(sub); save(); closeModal();
    location.hash = '#/subject/' + sub.id;
  });
};

function renderSubject(id) {
  const s = subjectById(id);
  if (!s) return notFound('That subject no longer exists.');
  const chapters = subjectChapters(s);
  const quizzes = quizzesFor(id).slice().sort((a, b) => b.createdAt - a.createdAt);
  const stats = chapterStats(id);
  const points = [];
  quizzesFor(id).forEach(q => (q.attempts || []).forEach(a => points.push({ at: a.at, score: a.score, label: q.title, date: new Date(a.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })));
  points.sort((a, b) => a.at - b.at);
  const cards = cardsFor(id);
  const exams = S.exams.filter(e => e.subjectId === id && e.date >= todayISO());

  return `
    <header class="page-head">
      <div>
        <p class="crumb"><a href="#/subjects">Subjects</a></p>
        <h1 class="with-dot">${subjectDot(s)}${esc(s.name)}</h1>
      </div>
      <div class="row gap wrap">
        <button class="btn" data-act="shareSubject" data-id="${s.id}">Share subject</button>
        <button class="btn" data-act="renameSubject" data-id="${s.id}">Rename</button>
        <button class="btn ghost danger-text" data-act="deleteSubject" data-id="${s.id}">Delete</button>
      </div>
    </header>

    ${exams.length ? `<p class="note">Next exam: <b>${esc(exams[0].title)}</b> on ${fmtDate(exams[0].date)} (${relDays(exams[0].date)}). <a href="#/calendar">See the plan</a></p>` : ''}

    <section class="block">
      <div class="block-head">
        <h2>Study material</h2>
      </div>
      <label class="drop" id="drop">
        <input type="file" id="pdfInput" accept="application/pdf,.pdf" multiple hidden>
        <span class="drop-main">Drop PDFs here or <u>choose files</u></span>
        <span class="muted small">Text is read in your browser. Chapters are found automatically.</span>
      </label>
      <p class="small"><button class="link" data-act="pasteText" data-id="${s.id}">Paste notes as text instead</button></p>
      <div id="uploadStatus"></div>
      ${s.docs.length ? `<ul class="docs">${s.docs.map(d => docRow(s, d)).join('')}</ul>` : ''}
    </section>

    <section class="block">
      <div class="block-head">
        <h2>Practice</h2>
      </div>
      <div class="actions-grid">
        <button class="action" data-act="newQuiz" data-id="${s.id}" ${chapters.length ? '' : 'disabled'}>
          <b>New quiz</b><span>Multiple choice, graded out of 100</span>
        </button>
        <a class="action" href="#/cards/${s.id}">
          <b>Flashcards</b><span>${cards.length ? `${cards.length} cards, ${cards.filter(c => c.status === 'again').length} to repeat` : 'No cards yet'}</span>
        </a>
        <button class="action" data-act="newCards" data-id="${s.id}" ${chapters.length ? '' : 'disabled'}>
          <b>New flashcards from PDF</b><span>AI writes cards from your material</span>
        </button>
        <button class="action" data-act="newNotes" data-sid="${s.id}" ${chapters.length ? '' : 'disabled'}>
          <b>Create notes</b><span>AI-structured notes from the PDF and your input</span>
        </button>
        <button class="action" data-act="addExam" data-sid="${s.id}">
          <b>Add exam date</b><span>Get a review schedule</span>
        </button>
      </div>
      ${chapters.length ? '' : '<p class="muted small">Upload a PDF to unlock quizzes, notes and AI flashcards.</p>'}
    </section>

    ${notesFor(id).length ? `
    <section class="block">
      <div class="block-head"><h2>Notes</h2></div>
      <ul class="note-list">${notesFor(id).sort((a, b) => b.updatedAt - a.updatedAt).map(noteRow).join('')}</ul>
    </section>` : ''}

    ${points.length ? `
    <section class="block">
      <div class="block-head"><h2>How you're doing</h2></div>
      <div class="perf">
        ${points.length > 1 ? `<div><h3>Quiz scores</h3>${trendSVG(points)}</div>` : ''}
        <div><h3>By chapter, all attempts</h3>${chapterBarsHTML(stats)}</div>
      </div>
    </section>` : ''}

    <section class="block">
      <div class="block-head"><h2>Quizzes</h2></div>
      ${quizzes.length ? `<ul class="quiz-list">${quizzes.map(quizRow).join('')}</ul>` : '<p class="muted">No quizzes yet.</p>'}
    </section>`;
}

function docRow(s, d) {
  const how = { headings: 'from headings', ai: 'found by AI', pages: 'split by pages' }[d.method] || '';
  return `<li class="doc">
    <details>
      <summary>
        <span class="doc-name">${esc(d.name)}</span>
        <span class="muted small">${d.pages} pages, ${d.chapters.length} chapters ${how ? `(${how})` : ''}</span>
      </summary>
      <ol class="chapters">${d.chapters.map(c => `<li>${esc(c.title)} <span class="muted small">p. ${c.start}${c.end > c.start ? '–' + c.end : ''}</span></li>`).join('')}</ol>
      ${d.hasPdf || !/\.pdf$/i.test(d.name) ? '' : `
      <p class="small note-inline">This PDF was added before quizzes could show its figures.
        <label class="link">Add the file again<input type="file" accept="application/pdf,.pdf" hidden data-reattach="${d.id}" data-sid="${s.id}"></label>
        to turn them on. Your chapters stay the same.</p>`}
      <div class="row gap wrap">
        <button class="btn small" data-act="redetect" data-sid="${s.id}" data-id="${d.id}">Find chapters again${hasKey() ? ' with AI' : ''}</button>
        <button class="btn small ghost danger-text" data-act="removeDoc" data-sid="${s.id}" data-id="${d.id}">Remove PDF</button>
      </div>
    </details>
  </li>`;
}

function quizRow(q) {
  const atts = q.attempts || [];
  const best = atts.length ? Math.max(...atts.map(a => a.score)) : null;
  const last = atts[atts.length - 1];
  return `<li class="quiz-row">
    <div>
      <b>${esc(q.title)}</b>
      <span class="muted small">${q.questions.length} questions${q.kind === 'test' ? ', mock test' : ''}, ${new Date(q.createdAt).toLocaleDateString()}${atts.length ? `, ${atts.length} attempt${atts.length > 1 ? 's' : ''}` : ''}</span>
    </div>
    <div class="row gap">
      ${best != null ? `<span class="pill ${scoreTone(best)}">Best ${best}%</span>` : ''}
      ${last ? `<a class="btn small" href="#/result/${q.id}/${last.id}">Results</a>` : ''}
      <a class="btn small ${atts.length ? '' : 'primary'}" href="#/quiz/${q.id}">${atts.length ? 'Retake' : 'Start'}</a>
      <button class="btn small ghost" data-act="shareQuiz" data-id="${q.id}">Share</button>
      <button class="icon-btn" data-act="deleteQuiz" data-id="${q.id}" aria-label="Delete quiz">✕</button>
    </div>
  </li>`;
}

function mountSubject(id) {
  const s = subjectById(id);
  if (!s) return;
  const drop = $('#drop'), input = $('#pdfInput');
  input.addEventListener('change', () => { uploadFiles(s, Array.from(input.files)); input.value = ''; });
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => uploadFiles(s, Array.from(e.dataTransfer.files).filter(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name))));
  $$('input[data-reattach]').forEach(inp => inp.addEventListener('change', async () => {
    const d = s.docs.find(x => x.id === inp.dataset.reattach);
    if (!inp.files[0] || !d) return;
    try { await reattachPdf(d, inp.files[0]); toast(`Figures turned on for ${d.name}`, 'good'); render(); }
    catch (e) { showError(e); }
  }));
}

let uploading = false;
async function uploadFiles(s, files) {
  if (!files.length || uploading) return;
  uploading = true;
  const status = $('#uploadStatus');
  const set = msg => { if (status && status.isConnected) status.innerHTML = `<p class="progress-line"><span class="spin"></span>${esc(msg)}</p>`; };
  try {
    for (const f of files) {
      set(`Reading ${f.name}…`);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const pages = await extractPdf(f, (i, n) => set(`Reading ${f.name}: page ${i} of ${n}`));
      const doc = await addDocument(s, f.name, pages, m => set(`${f.name}: ${m}`), bytes);
      toast(`Added ${doc.name}: ${doc.pages} pages, ${doc.chapters.length} chapters`, 'good');
    }
  } catch (e) { showError(e); }
  finally { uploading = false; if (location.hash === '#/subject/' + s.id) render(); }
}

ACT.pasteText = el => {
  const s = subjectById(el.dataset.id);
  const { el: m } = openModal('Paste notes', `
    <form class="form" id="pasteForm">
      <label>Title<input name="name" required maxlength="80" placeholder="e.g. Lecture 4 notes"></label>
      <label>Text<textarea name="text" rows="12" required placeholder="Paste your notes or book text here"></textarea></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Add notes</button></div>
    </form>`, { wide: true });
  $('#pasteForm', m).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('.btn.primary');
    try {
      await busy(btn, 'Finding chapters…', () => addDocument(s, fd.get('name').trim(), textToPages(fd.get('text'))));
      closeModal(); toast('Notes added', 'good'); render();
    } catch (err) { showError(err); }
  });
};

ACT.redetect = async el => {
  const s = subjectById(el.dataset.sid);
  const d = s.docs.find(x => x.id === el.dataset.id);
  try { await busy(el, 'Working…', () => redetectChapters(s, d)); toast(`Found ${d.chapters.length} chapters`, 'good'); render(); }
  catch (e) { showError(e); }
};

ACT.removeDoc = async el => {
  const s = subjectById(el.dataset.sid);
  const d = s.docs.find(x => x.id === el.dataset.id);
  if (!(await confirmBox('Remove PDF?', `“${d.name}” will be removed from ${s.name}. Your quizzes and flashcards stay.`, 'Remove PDF'))) return;
  await removeDocument(s, d.id); render();
};

ACT.renameSubject = el => {
  const s = subjectById(el.dataset.id);
  const { el: m } = openModal('Rename subject', `
    <form id="renForm" class="form">
      <label>Name<input name="name" required maxlength="60" value="${esc(s.name)}"></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Save name</button></div>
    </form>`);
  $('#renForm', m).addEventListener('submit', e => {
    e.preventDefault(); s.name = new FormData(e.target).get('name').trim() || s.name; save(); closeModal(); render();
  });
};

ACT.deleteSubject = async el => {
  const s = subjectById(el.dataset.id);
  if (!(await confirmBox('Delete subject?', `This deletes “${s.name}” with its PDFs, quizzes, flashcards and exams. It cannot be undone.`, 'Delete subject'))) return;
  for (const d of s.docs) { await kvDel('doc:' + d.id); await kvDel('pdf:' + d.id); }
  S.subjects = S.subjects.filter(x => x.id !== s.id);
  S.quizzes = S.quizzes.filter(x => x.subjectId !== s.id);
  S.cards = S.cards.filter(x => x.subjectId !== s.id);
  S.exams = S.exams.filter(x => x.subjectId !== s.id);
  S.notes = S.notes.filter(x => x.subjectId !== s.id);
  save(); location.hash = '#/subjects';
};

ACT.deleteQuiz = async el => {
  const q = quizById(el.dataset.id);
  if (!(await confirmBox('Delete quiz?', `“${q.title}” and its results will be deleted.`, 'Delete quiz'))) return;
  S.quizzes = S.quizzes.filter(x => x.id !== q.id); save(); render();
};

/* ---------- create quiz ---------- */

ACT.newQuiz = el => openQuizDialog(subjectById(el.dataset.id));

function openQuizDialog(s, { chapters = null, kind = 'quiz', count = 10, onDone } = {}) {
  if (!hasKey()) { toast('Add your Groq API key in Settings first.', 'error'); location.hash = '#/settings'; return; }
  const chs = subjectChapters(s);
  const { el } = openModal(kind === 'test' ? 'New mock test' : 'New quiz', `
    <form id="quizForm" class="form">
      <div class="row gap wrap">
        <label class="grow">Questions
          <select name="count">${[5, 10, 15, 20, 25, 30].map(n => `<option ${n === count ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
        <label class="grow">Difficulty
          <select name="difficulty"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select>
        </label>
      </div>
      <label>Timer
        <select name="timer">${timerOptions(kind === 'test' ? suggestedMinutes(count) : 0)}</select>
      </label>
      <fieldset><legend>Chapters</legend>${chapterChecklist(chs, chapters)}</fieldset>
      <div class="row end gap"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Create quiz</button></div>
    </form>`);
  wireChecklist(el);
  // A mock test keeps its suggested time in step with the number of questions.
  const form = $('#quizForm', el);
  form.count.addEventListener('change', () => { if (kind === 'test' || +form.timer.value) form.timer.innerHTML = timerOptions(suggestedMinutes(+form.count.value)); });
  $('#quizForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const picked = checkedChapters(el);
    if (picked && !picked.length) return toast('Pick at least one chapter.', 'error');
    const btn = e.target.querySelector('.btn.primary');
    try {
      const out = await busy(btn, 'Writing questions…', () => aiGenerateQuiz(s, { count: +fd.get('count'), difficulty: fd.get('difficulty'), chapters: picked, kind }));
      const quiz = { id: uid(), subjectId: s.id, title: out.title, kind, chapters: picked, createdAt: Date.now(), questions: out.questions, attempts: [], timeLimit: +fd.get('timer') || 0 };
      S.quizzes.push(quiz); save(); closeModal();
      const asked = +fd.get('count');
      if (out.questions.length < asked) toast(`Made ${out.questions.length} of ${asked} questions.${out.offCourse ? ' Questions about things that aren\'t in your course material were left out.' : ''}${out.unconfirmed ? ` ${out.unconfirmed} question${out.unconfirmed > 1 ? 's were' : ' was'} left out because a second check got a different answer.` : ''}`, 'info', 8000);
      onDone && onDone(quiz);
      location.hash = '#/quiz/' + quiz.id;
    } catch (err) { showError(err); }
  });
}

/* ---------- AI flashcards dialog ---------- */

ACT.newCards = el => openCardsDialog(subjectById(el.dataset.id || el.dataset.sid));

function openCardsDialog(s) {
  if (!hasKey()) { toast('Add your Groq API key in Settings first.', 'error'); location.hash = '#/settings'; return; }
  const chs = subjectChapters(s);
  const weak = chapterStats(s.id).filter(c => c.pct < 70).map(c => c.chapter).filter(n => chs.some(c => c.name === n));
  const { el } = openModal('New flashcards from your PDF', `
    <form id="cardForm" class="form">
      <label>How many cards
        <select name="count">${[6, 10, 15, 20, 30].map(n => `<option ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </label>
      ${weak.length ? `<label class="check"><input type="checkbox" id="weakOnly"> Focus on chapters you scored under 70% on (${weak.length})</label>` : ''}
      <fieldset><legend>Chapters</legend>${chapterChecklist(chs)}</fieldset>
      <div class="row end gap"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Create flashcards</button></div>
    </form>`);
  wireChecklist(el);
  const weakBox = $('#weakOnly', el);
  weakBox && weakBox.addEventListener('change', () => {
    $$('input[name="ch"]', el).forEach(b => (b.checked = !weakBox.checked || weak.includes(b.value)));
    $('[data-all="ch"]', el).checked = !weakBox.checked;
  });
  $('#cardForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const picked = checkedChapters(el);
    if (picked && !picked.length) return toast('Pick at least one chapter.', 'error');
    const btn = e.target.querySelector('.btn.primary');
    try {
      const cards = await busy(btn, 'Writing cards…', () => aiGenerateCards(s, { count: +new FormData(e.target).get('count'), chapters: picked }));
      S.cards.push(...cards); save(); closeModal();
      toast(`Added ${cards.length} flashcards`, 'good');
      startCardSession(s.id, 'new', false, cards.map(c => c.id));
      location.hash = '#/cards/' + s.id;
      render();
    } catch (err) { showError(err); }
  });
}

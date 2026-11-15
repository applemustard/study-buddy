/* Notes: AI-structured notes built from the PDF, your study plan / quiz results and your own input. */

const NOTE_STYLES = {
  outline: { label: 'Outline', desc: 'Headings and nested bullet points' },
  cornell: { label: 'Cornell', desc: 'Cue questions beside the notes, summary per chapter' },
  summary: { label: 'Summary sheet', desc: 'One page: key ideas, terms, common mistakes' },
  qa: { label: 'Questions and answers', desc: 'Notes written as self-test questions' },
};

let NOTE_EDIT = null; // id of the note being edited

function renderNotes() {
  const groups = S.subjects.map(s => ({ s, notes: notesFor(s.id).sort((a, b) => b.updatedAt - a.updatedAt) })).filter(g => g.notes.length);
  return `
    <header class="page-head">
      <h1>Notes</h1>
      <div class="row gap wrap">
        <button class="btn" data-act="importShared">Import from a friend</button>
        <button class="btn primary" data-act="newNotes">Create notes</button>
      </div>
    </header>
    ${groups.length ? groups.map(({ s, notes }) => `
      <section class="block">
        <div class="block-head"><h2 class="with-dot">${subjectDot(s)}${esc(s.name)}</h2><button class="btn small" data-act="newNotes" data-sid="${s.id}">Create notes</button></div>
        <ul class="note-list">${notes.map(noteRow).join('')}</ul>
      </section>`).join('') : `
      <div class="empty">
        <h2>No notes yet</h2>
        <p>The AI turns your PDF into structured notes. Add your own notes or say what to focus on, and it builds them around your study plan and the chapters you score lowest on.</p>
        <button class="btn primary" data-act="newNotes">Create notes</button>
      </div>`}`;
}

function noteRow(n) {
  return `<li><a class="note-row" href="#/note/${n.id}">
    <span class="nr-title">${esc(n.title)}</span>
    <span class="muted small">${esc(NOTE_STYLES[n.style]?.label || 'Notes')}${n.sharedBy ? `, from ${esc(n.sharedBy)}` : ''}, ${new Date(n.updatedAt).toLocaleDateString()}</span>
  </a></li>`;
}

function renderNote(id) {
  const n = noteById(id);
  if (!n) return notFound('That note no longer exists.');
  const s = subjectById(n.subjectId);
  const editing = NOTE_EDIT === id;
  return `
    <header class="page-head">
      <div>
        <p class="crumb"><a href="#/notes">Notes</a> <span class="muted">/</span> <a href="#/subject/${s?.id}">${esc(s?.name || '')}</a></p>
        <h1>${esc(n.title)}</h1>
      </div>
      <div class="row gap wrap no-print">
        ${editing
          ? `<button class="btn ghost" data-act="cancelNoteEdit">Cancel</button><button class="btn primary" data-act="saveNote" data-id="${n.id}">Save notes</button>`
          : `<button class="btn" data-act="editNote" data-id="${n.id}">Edit</button>
             <button class="btn" data-act="shareNote" data-id="${n.id}">Share</button>
             <details class="menu">
               <summary class="btn">More</summary>
               <div class="menu-list">
                 <button data-act="cardsFromNote" data-id="${n.id}">Make flashcards from these notes</button>
                 <button data-act="printNote">Print or save as PDF</button>
                 <button data-act="renameNote" data-id="${n.id}">Rename</button>
                 <button data-act="deleteNote" data-id="${n.id}" class="danger-text">Delete notes</button>
               </div>
             </details>`}
      </div>
    </header>
    ${n.sharedBy ? `<p class="note no-print">Shared with you by <b>${esc(n.sharedBy)}</b>.</p>` : ''}
    ${editing ? `
      <p class="muted small">Markdown: <code># heading</code>, <code>- bullet</code>, <code>**bold**</code>, <code>==highlight==</code>, <code>| table |</code>.</p>
      <textarea id="noteText" class="note-editor" spellcheck="true">${esc(n.markdown)}</textarea>`
    : `<article class="note-doc">${renderMarkdown(n.markdown)}</article>
       ${n.input ? `<details class="note-input no-print"><summary>What you asked for</summary><p>${esc(n.input)}</p></details>` : ''}`}`;
}

ACT.editNote = el => { NOTE_EDIT = el.dataset.id; render(); $('#noteText')?.focus(); };
ACT.cancelNoteEdit = () => { NOTE_EDIT = null; render(); };
ACT.saveNote = el => {
  const n = noteById(el.dataset.id);
  n.markdown = $('#noteText').value; n.updatedAt = Date.now();
  NOTE_EDIT = null; save(); toast('Notes saved', 'good', 1800); render();
};
ACT.printNote = el => { el.closest('details')?.removeAttribute('open'); window.print(); };
ACT.renameNote = el => {
  el.closest('details')?.removeAttribute('open');
  const n = noteById(el.dataset.id);
  const { el: m } = openModal('Rename notes', `
    <form id="renNote" class="form">
      <label>Title<input name="title" required maxlength="100" value="${esc(n.title)}"></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Save title</button></div>
    </form>`);
  $('#renNote', m).addEventListener('submit', e => { e.preventDefault(); n.title = new FormData(e.target).get('title').trim() || n.title; save(); closeModal(); render(); });
};
ACT.deleteNote = async el => {
  el.closest('details')?.removeAttribute('open');
  const n = noteById(el.dataset.id);
  if (!(await confirmBox('Delete notes?', `“${n.title}” will be deleted.`, 'Delete notes'))) return;
  S.notes = S.notes.filter(x => x.id !== n.id); save(); location.hash = '#/notes';
};
ACT.cardsFromNote = async el => {
  el.closest('details')?.removeAttribute('open');
  const n = noteById(el.dataset.id);
  const s = subjectById(n.subjectId);
  if (!hasKey()) { toast('Add your Groq API key in Settings first.', 'error'); return; }
  try {
    const cards = await busy($('.page-head .btn:not(.ghost)'), 'Writing cards…', () => aiGenerateCards(s, { count: 12, context: `### Notes: ${n.title}\n${n.markdown}` }));
    S.cards.push(...cards); save();
    startCardSession(s.id, 'new', false, cards.map(c => c.id));
    toast(`Added ${cards.length} flashcards from your notes`, 'good');
    location.hash = '#/cards/' + s.id;
  } catch (e) { showError(e); }
};

/* ---------- creator ---------- */

ACT.newNotes = el => {
  const sid = el.dataset.sid;
  if (sid) return openNotesDialog(subjectById(sid), { chapters: el.dataset.chapters ? JSON.parse(el.dataset.chapters) : null });
  const ready = S.subjects.filter(s => subjectChapters(s).length);
  if (!ready.length) { toast('Upload a PDF to a subject first.', 'error'); location.hash = '#/subjects'; return; }
  if (ready.length === 1) return openNotesDialog(ready[0]);
  const { el: m } = openModal('Create notes for…', `<ul class="subject-list">${ready.map(s => `<li><button class="subject-row as-btn" data-pick="${s.id}">${subjectDot(s)}<span class="sr-name">${esc(s.name)}</span></button></li>`).join('')}</ul>`);
  $$('[data-pick]', m).forEach(b => b.addEventListener('click', () => openNotesDialog(subjectById(b.dataset.pick))));
};

function openNotesDialog(s, { chapters = null } = {}) {
  if (!hasKey()) { toast('Add your Groq API key in Settings first.', 'error'); location.hash = '#/settings'; return; }
  const chs = subjectChapters(s);
  if (!chs.length) { toast(`Upload a PDF to ${s.name} first.`, 'error'); return; }
  const guide = studyGuideFor(s);
  const { el } = openModal(`Create notes: ${s.name}`, `
    <form id="notesForm" class="form">
      <fieldset><legend>Structure</legend>
        <div class="style-pick">
          ${Object.entries(NOTE_STYLES).map(([k, v], i) => `
            <label class="style-opt"><input type="radio" name="style" value="${k}" ${i === 0 ? 'checked' : ''}><span><b>${v.label}</b><span class="muted small">${v.desc}</span></span></label>`).join('')}
        </div>
      </fieldset>
      <label>Your input (optional)
        <textarea name="input" rows="5" placeholder="Paste your own rough notes to clean up, or say what you need, e.g. “focus on mitosis, I keep mixing up the phases” or “explain it simply with examples”."></textarea>
      </label>
      <div class="row gap wrap">
        <label class="grow">Length
          <select name="length"><option value="short">Short</option><option value="medium" selected>Medium</option><option value="detailed">Detailed</option></select>
        </label>
      </div>
      ${guide.hasAny ? `<label class="check"><input type="checkbox" name="guide" checked> Build around my study guide: ${esc(guide.label)}</label>` : ''}
      <fieldset><legend>Chapters</legend>${chapterChecklist(chs, chapters)}</fieldset>
      <div class="row end gap"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">Create notes</button></div>
    </form>`, { wide: true });
  wireChecklist(el);
  $('#notesForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const picked = checkedChapters(el);
    if (picked && !picked.length) return toast('Pick at least one chapter.', 'error');
    const btn = e.target.querySelector('.btn.primary');
    try {
      const opts = { style: fd.get('style'), chapters: picked, input: (fd.get('input') || '').trim(), length: fd.get('length'), useGuide: !!fd.get('guide') };
      const out = await busy(btn, 'Writing your notes…', () => aiGenerateNotes(s, opts));
      const note = { id: uid(), subjectId: s.id, title: out.title, style: opts.style, chapters: picked, input: opts.input, markdown: out.markdown, createdAt: Date.now(), updatedAt: Date.now() };
      S.notes.push(note); save(); closeModal();
      location.hash = '#/note/' + note.id;
    } catch (err) { showError(err); }
  });
}

/* What the app knows about this subject's study guide: weak chapters, AI mistake reviews, the exam plan. */
function studyGuideFor(s) {
  const weak = chapterStats(s.id).filter(c => c.total >= 2 && c.pct < 75).sort((a, b) => a.pct - b.pct);
  const focus = [], diagnoses = [];
  quizzesFor(s.id).flatMap(q => (q.attempts || []).filter(a => a.review)).sort((a, b) => b.at - a.at).slice(0, 3).forEach(a => {
    focus.push(...a.review.focus);
    a.review.chapters.forEach(c => diagnoses.push(`${c.chapter}: ${c.diagnosis}`));
  });
  const exam = S.exams.filter(e => e.subjectId === s.id && e.date >= todayISO()).sort((a, b) => a.date.localeCompare(b.date))[0];
  const parts = [];
  if (exam) parts.push(`${exam.title} ${relDays(exam.date)}`);
  if (weak.length) parts.push(`${weak.length} weak chapter${weak.length > 1 ? 's' : ''}`);
  if (focus.length) parts.push('topics from your quiz reviews');
  return { weak, focus: [...new Set(focus)].slice(0, 8), diagnoses: diagnoses.slice(0, 6), exam, hasAny: parts.length > 0, label: parts.join(', ') };
}

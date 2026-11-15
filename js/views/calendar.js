/* Calendar of exams and AI study plans. */

const CAL = { y: new Date().getFullYear(), m: new Date().getMonth() };

const SESSION_TYPES = {
  read: { label: 'Read', verb: 'Open material' },
  flashcards: { label: 'Flashcards', verb: 'Study cards' },
  quiz: { label: 'Practice quiz', verb: 'Take quiz' },
  test: { label: 'Mock test', verb: 'Take mock test' },
};

/* Every plan session with its exam, for agenda views. */
function allSessions() {
  const out = [];
  for (const ex of S.exams) for (const ses of ex.plan?.sessions || []) out.push({ ex, ses });
  return out;
}

function renderCalendar() {
  const first = new Date(CAL.y, CAL.m, 1);
  const startPad = (first.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(CAL.y, CAL.m + 1, 0).getDate();
  const today = todayISO();
  const byDay = {};
  for (const ex of S.exams) (byDay[ex.date] = byDay[ex.date] || { exams: [], ses: [] }).exams.push(ex);
  for (const { ex, ses } of allSessions()) (byDay[ses.date] = byDay[ses.date] || { exams: [], ses: [] }).ses.push({ ex, ses });
  const starts = new Set(S.exams.filter(e => e.plan).map(e => e.plan.startDate));

  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push('<div class="cal-cell pad" aria-hidden="true"></div>');
  for (let d = 1; d <= daysIn; d++) {
    const ds = iso(new Date(CAL.y, CAL.m, d));
    const info = byDay[ds] || { exams: [], ses: [] };
    cells.push(`
      <button class="cal-cell ${ds === today ? 'today' : ''} ${ds < today ? 'past' : ''}" data-act="calDay" data-date="${ds}" aria-label="${fmtDate(ds, { weekday: 'long', month: 'long', day: 'numeric' })}${info.exams.length ? ', ' + info.exams.length + ' exam' : ''}${info.ses.length ? ', ' + info.ses.length + ' study sessions' : ''}">
        <span class="cal-num">${d}</span>
        ${starts.has(ds) ? '<span class="cal-start">Start review</span>' : ''}
        ${info.exams.map(ex => `<span class="cal-exam" style="--h:${subjectHue(subjectById(ex.subjectId))}">${esc(ex.title)}</span>`).join('')}
        ${info.ses.map(({ ex, ses }) => `<span class="cal-ses t-${ses.type} ${ses.done ? 'done' : ''}" style="--h:${subjectHue(subjectById(ex.subjectId))}">${SESSION_TYPES[ses.type].label}</span>`).join('')}
      </button>`);
  }

  const upcoming = S.exams.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = S.exams.filter(e => e.date < today);
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return `
    <header class="page-head">
      <h1>Calendar</h1>
      <button class="btn primary" data-act="addExam">Add exam</button>
    </header>
    <div class="cal-layout">
      <section class="cal">
        <div class="cal-head">
          <button class="icon-btn" data-act="calMove" data-d="-1" aria-label="Previous month">‹</button>
          <h2>${esc(monthName)}</h2>
          <button class="icon-btn" data-act="calMove" data-d="1" aria-label="Next month">›</button>
          <button class="btn small" data-act="calToday">Today</button>
        </div>
        <div class="cal-grid">
          ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
          ${cells.join('')}
        </div>
        <p class="legend small">
          <span><i class="sw sw-exam"></i>Exam</span>
          <span><i class="sw t-read"></i>Read</span>
          <span><i class="sw t-flashcards"></i>Flashcards</span>
          <span><i class="sw t-quiz"></i>Practice quiz</span>
          <span><i class="sw t-test"></i>Mock test</span>
        </p>
      </section>
      <section class="exams">
        <h2>Upcoming exams</h2>
        ${upcoming.length ? upcoming.map(examCard).join('') : `<div class="empty small-empty"><p>Add an exam and the AI works out when to start reviewing and when to test yourself.</p><button class="btn primary" data-act="addExam">Add exam</button></div>`}
        ${past.length ? `<details class="past"><summary>Past exams (${past.length})</summary>${past.map(e => `<p class="row between"><span>${esc(e.title)} <span class="muted small">${fmtDate(e.date)}</span></span><button class="icon-btn" data-act="deleteExam" data-id="${e.id}" aria-label="Delete exam">✕</button></p>`).join('')}</details>` : ''}
      </section>
    </div>`;
}

function examCard(ex) {
  const s = subjectById(ex.subjectId);
  const left = daysBetween(todayISO(), ex.date);
  const p = ex.plan;
  const done = p ? p.sessions.filter(x => x.done).length : 0;
  return `<article class="exam" style="--h:${subjectHue(s)}">
    <div class="exam-head">
      <div>
        <h3>${esc(ex.title)}</h3>
        <p class="muted small">${esc(s?.name || '')}, ${fmtDate(ex.date, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>
      <div class="countdown"><b>${left}</b><span>${left === 1 ? 'day' : 'days'}</span></div>
    </div>
    ${p ? `
      <p class="plan-start">Start review: <b>${fmtDate(p.startDate)}</b> <span class="muted">(${relDays(p.startDate)})</span></p>
      ${p.rationale ? `<p class="muted small">${esc(p.rationale)}</p>` : ''}
      <div class="plan-progress"><span style="width:${p.sessions.length ? done / p.sessions.length * 100 : 0}%"></span></div>
      <p class="muted small">${done} of ${p.sessions.length} sessions done</p>
      <details class="plan" ${left <= 14 ? 'open' : ''}>
        <summary>Study plan</summary>
        <ol class="sessions">${p.sessions.map(ses => sessionRow(ex, ses)).join('')}</ol>
      </details>`
      : `<p class="muted small">${s && subjectChapters(s).length ? 'No plan yet.' : `Upload a PDF to <a href="#/subject/${s?.id}">${esc(s?.name || 'the subject')}</a> first so the plan knows what to cover.`}</p>`}
    <div class="row gap wrap">
      <button class="btn small ${p ? '' : 'primary'}" data-act="buildPlan" data-id="${ex.id}" ${s && subjectChapters(s).length ? '' : 'disabled'}>${p ? 'Rebuild plan' : 'Build study plan'}</button>
      <button class="btn small ghost" data-act="editExam" data-id="${ex.id}">Edit</button>
      <button class="btn small ghost danger-text" data-act="deleteExam" data-id="${ex.id}">Delete</button>
    </div>
  </article>`;
}

function sessionRow(ex, ses, withExam = false) {
  const today = todayISO();
  const t = SESSION_TYPES[ses.type];
  return `<li class="ses ${ses.done ? 'done' : ''} ${ses.date === today ? 'is-today' : ''} ${ses.date < today && !ses.done ? 'overdue' : ''}">
    <label class="ses-check"><input type="checkbox" data-toggle-ses data-ex="${ex.id}" data-id="${ses.id}" ${ses.done ? 'checked' : ''} aria-label="Mark done"></label>
    <div class="ses-body">
      <p><span class="ses-type t-${ses.type}">${t.label}</span> <span class="muted small">${ses.date === today ? 'Today' : fmtDate(ses.date)}, ${ses.minutes} min${withExam ? `, for ${esc(ex.title)}` : ''}</span></p>
      <p class="small">${esc(ses.chapters.join(', '))}</p>
      ${ses.note ? `<p class="muted small">${esc(ses.note)}</p>` : ''}
    </div>
    <div class="ses-btns">${!ses.done && ses.type === "read" ? `<button class="btn small ghost" data-act="newNotes" data-sid="${ex.subjectId}" data-chapters="${esc(JSON.stringify(ses.chapters))}">Make notes</button>` : ""}
    ${!ses.done ? `<button class="btn small" data-act="runSession" data-ex="${ex.id}" data-id="${ses.id}">${t.verb}</button>` : ''}</div>
  </li>`;
}

ACT.calMove = el => { CAL.m += +el.dataset.d; if (CAL.m < 0) { CAL.m = 11; CAL.y--; } if (CAL.m > 11) { CAL.m = 0; CAL.y++; } render(); };
ACT.calToday = () => { const d = new Date(); CAL.y = d.getFullYear(); CAL.m = d.getMonth(); render(); };

ACT.calDay = el => {
  const ds = el.dataset.date;
  const exams = S.exams.filter(e => e.date === ds);
  const ses = allSessions().filter(x => x.ses.date === ds);
  if (!exams.length && !ses.length) return examForm(null, ds);
  openModal(fmtDate(ds, { weekday: 'long', month: 'long', day: 'numeric' }), `
    ${exams.map(e => `<p class="day-exam" style="--h:${subjectHue(subjectById(e.subjectId))}"><b>${esc(e.title)}</b> <span class="muted">${esc(subjectById(e.subjectId)?.name || '')}</span></p>`).join('')}
    ${ses.length ? `<ol class="sessions">${ses.map(({ ex, ses }) => sessionRow(ex, ses, true)).join('')}</ol>` : ''}
    <div class="row end gap"><button class="btn" data-act="addExam" data-date="${ds}">Add exam on this day</button></div>`, { wide: true });
};

ACT.addExam = el => examForm(null, el.dataset.date || addDays(todayISO(), 14), el.dataset.sid);
ACT.editExam = el => examForm(examById(el.dataset.id));

function examForm(ex, date, sid) {
  if (!S.subjects.length) { toast('Create a subject first.', 'error'); location.hash = '#/subjects'; return; }
  const { el } = openModal(ex ? 'Edit exam' : 'Add exam', `
    <form id="examForm" class="form">
      <label>Subject<select name="subjectId" required>${S.subjects.map(s => `<option value="${s.id}" ${(ex?.subjectId || sid) === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label>What is it<input name="title" required maxlength="80" placeholder="e.g. Midterm exam" value="${esc(ex?.title || '')}"></label>
      <label>Date<input type="date" name="date" required min="${todayISO()}" value="${esc(ex?.date || date)}"></label>
      ${hasKey() ? `<label class="check"><input type="checkbox" name="plan" checked> ${ex?.plan ? 'Rebuild the study plan' : 'Build a study plan now'}</label>` : '<p class="muted small">Add a Groq API key in Settings to get an AI study plan.</p>'}
      <div class="row end gap"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">${ex ? 'Save exam' : 'Add exam'}</button></div>
    </form>`);
  $('#examForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!isValidISO(fd.get('date'))) return toast('Pick a valid date.', 'error');
    const isNew = !ex;
    const target = ex || { id: uid(), createdAt: Date.now(), plan: null };
    const changed = !ex || ex.date !== fd.get('date') || ex.subjectId !== fd.get('subjectId');
    Object.assign(target, { subjectId: fd.get('subjectId'), title: fd.get('title').trim(), date: fd.get('date') });
    if (isNew) S.exams.push(target);
    if (changed && target.plan && !fd.get('plan')) target.plan = null;
    save();
    const d = parseISO(target.date); CAL.y = d.getFullYear(); CAL.m = d.getMonth();
    const s = subjectById(target.subjectId);
    if (fd.get('plan') && subjectChapters(s).length) {
      try { await busy(e.target.querySelector('.btn.primary'), 'Planning your review…', async () => { target.plan = await aiStudyPlan(target); }); save(); }
      catch (err) { showError(err); }
    } else if (fd.get('plan')) toast(`Exam saved. Upload a PDF to ${s.name} to build a plan.`, 'info');
    closeModal();
    if (location.hash !== '#/calendar') location.hash = '#/calendar'; else render();
  });
}

ACT.buildPlan = async el => {
  const ex = examById(el.dataset.id);
  try {
    const plan = await busy(el, 'Planning…', () => aiStudyPlan(ex));
    ex.plan = plan; save(); toast(`Plan ready: start ${relDays(plan.startDate)}`, 'good'); render();
  } catch (e) { showError(e); }
};

ACT.deleteExam = async el => {
  const ex = examById(el.dataset.id);
  if (!(await confirmBox('Delete exam?', `“${ex.title}” and its study plan will be deleted.`, 'Delete exam'))) return;
  S.exams = S.exams.filter(x => x.id !== ex.id); save(); render();
};

function findSession(el) {
  const ex = examById(el.dataset.ex);
  return { ex, ses: ex?.plan?.sessions.find(x => x.id === el.dataset.id) };
}

// Session checkboxes use the native change event (not data-act, which would cancel the toggle).
document.addEventListener('change', e => {
  const cb = e.target.closest('input[data-toggle-ses]');
  if (!cb) return;
  const { ses } = findSession(cb);
  if (!ses) return;
  ses.done = cb.checked; save();
  const inModal = cb.closest('.modal');
  setTimeout(() => { if (inModal) cb.closest('.ses')?.classList.toggle('done', ses.done); render(); }, 150);
});

ACT.runSession = el => {
  const { ex, ses } = findSession(el);
  if (!ses) return;
  const s = subjectById(ex.subjectId);
  closeModal();
  if (ses.type === 'read') {
    ses.done = true; save();
    location.hash = '#/subject/' + s.id;
    toast(`Read: ${ses.chapters.join(', ')}`, 'info', 6000);
  } else if (ses.type === 'flashcards') {
    const ids = cardsFor(s.id).filter(c => !ses.chapters.length || ses.chapters.includes(c.chapter)).map(c => c.id);
    if (!ids.length) { openCardsDialog(s); return; }
    startCardSession(s.id, 'all', true, ids);
    ses.done = true; save();
    location.hash = '#/cards/' + s.id; render();
  } else {
    const existing = ses.quizId && quizById(ses.quizId);
    if (existing) { location.hash = '#/quiz/' + existing.id; return; }
    const all = subjectChapters(s).map(c => c.name);
    const chs = ses.chapters.length && ses.chapters.length < all.length ? ses.chapters : null;
    openQuizDialog(s, { chapters: chs, kind: ses.type === 'test' ? 'test' : 'quiz', count: ses.type === 'test' ? 25 : 10, onDone: q => { ses.quizId = q.id; save(); } });
  }
};

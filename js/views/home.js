/* Today: what to study now, upcoming exams, subjects at a glance. */

function renderHome() {
  const today = todayISO();
  const sessions = allSessions().filter(({ ses }) => !ses.done && ses.date <= today && ses.date >= addDays(today, -7))
    .sort((a, b) => a.ses.date.localeCompare(b.ses.date));
  const upcoming = S.exams.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  const nextStart = S.exams.filter(e => e.plan && e.plan.startDate > today && e.date >= today).sort((a, b) => a.plan.startDate.localeCompare(b.plan.startDate))[0];
  const againTotal = S.cards.filter(c => c.status === 'again').length;

  return `
    <header class="page-head">
      <div>
        <p class="crumb">${fmtDate(today, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1>Today</h1>
      </div>
    </header>

    ${!hasKey() ? `<div class="setup">
      <p><b>Connect the AI.</b> Study Buddy uses Groq to write quizzes, flashcards and study plans. Paste your Groq API key in Settings to switch these on. Free keys are available at console.groq.com.</p>
      <a class="btn primary" href="#/settings">Open settings</a>
    </div>` : ''}

    ${!S.subjects.length ? `
      <div class="empty">
        <h2>Start with a subject</h2>
        <p>Make a subject for each class, upload its PDFs, then build quizzes and flashcards from them. Add your exam dates to get a review schedule.</p>
        <div class="row gap center wrap"><button class="btn" data-act="importShared">Import from a friend</button><button class="btn primary" data-act="newSubject">New subject</button></div>
      </div>` : `

    <section class="block">
      <div class="block-head"><h2>Study now</h2><a class="small" href="#/calendar">Calendar</a></div>
      ${sessions.length ? `<ol class="sessions">${sessions.map(({ ex, ses }) => sessionRow(ex, ses, true)).join('')}</ol>`
        : `<p class="muted">${nextStart ? `Nothing scheduled today. Review for <b>${esc(nextStart.title)}</b> starts ${relDays(nextStart.plan.startDate)} (${fmtDate(nextStart.plan.startDate)}).` : upcoming.length ? 'Nothing scheduled today.' : 'No exams on the calendar. Add one to get a day-by-day review plan.'}</p>
           ${againTotal ? `<p>You have <b class="again-text">${againTotal} card${againTotal > 1 ? 's' : ''}</b> in the Again pile. <a href="#/cards">Review them</a></p>` : ''}`}
    </section>

    <div class="two-col">
      <section class="block">
        <div class="block-head"><h2>Exams</h2><button class="btn small" data-act="addExam">Add exam</button></div>
        ${upcoming.length ? `<ul class="exam-mini">${upcoming.map(e => {
          const s = subjectById(e.subjectId); const left = daysBetween(today, e.date);
          return `<li style="--h:${subjectHue(s)}"><a href="#/calendar">
            <span class="countdown small-cd"><b>${left}</b><span>${left === 1 ? 'day' : 'days'}</span></span>
            <span><b>${esc(e.title)}</b><span class="muted small">${esc(s?.name || '')}, ${fmtDate(e.date)}${e.plan ? `. Review ${e.plan.startDate <= today ? 'under way' : 'starts ' + fmtDate(e.plan.startDate)}` : '. No plan yet'}</span></span>
          </a></li>`; }).join('')}</ul>` : '<p class="muted">No upcoming exams.</p>'}
      </section>
      <section class="block">
        <div class="block-head"><h2>Subjects</h2><a class="small" href="#/subjects">All subjects</a></div>
        <ul class="subject-list compact">${S.subjects.map(subjectRow).join('')}</ul>
      </section>
    </div>`}`;
}

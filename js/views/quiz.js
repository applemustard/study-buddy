/* Taking a quiz, grading it out of 100 and the results page. */

let QZ = null; // {quizId, idx, answers[], started, startedAt, limitSec, warned}

/* ---------- timer ---------- */

const TIMER_CHOICES = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];
function timerOptions(selected = 0) {
  const list = TIMER_CHOICES.includes(selected) ? TIMER_CHOICES : [...TIMER_CHOICES, selected].sort((a, b) => a - b);
  return list.map(m => `<option value="${m}" ${m === selected ? 'selected' : ''}>${m ? `${m} minutes` : 'No timer'}</option>`).join('');
}
/* About 1.5 minutes a question, rounded to a listed choice. */
function suggestedMinutes(count) {
  const want = count * 1.5;
  return TIMER_CHOICES.filter(Boolean).reduce((a, b) => Math.abs(b - want) < Math.abs(a - want) ? b : a);
}
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
}

let quizTimer = null;
function stopTimer() { clearInterval(quizTimer); quizTimer = null; }
function startTimer() { stopTimer(); quizTimer = setInterval(tickTimer, 500); tickTimer(); }

function timerState() {
  const elapsed = (Date.now() - QZ.startedAt) / 1000;
  if (!QZ.limitSec) return { text: fmtClock(elapsed), label: 'elapsed', tone: '' };
  const left = QZ.limitSec - elapsed;
  return { left, text: fmtClock(left), label: 'left', tone: left <= 60 ? 'urgent' : left <= Math.max(120, QZ.limitSec * 0.2) ? 'low' : '' };
}

function tickTimer() {
  if (!QZ || !QZ.started) return stopTimer();
  const t = timerState();
  const el = document.getElementById('qtimer');
  if (el) {
    el.querySelector('b').textContent = t.text;
    el.className = `qtimer ${t.tone}`;
  }
  if (!QZ.limitSec) return;
  if (t.left <= 60 && !QZ.warned) { QZ.warned = true; toast('1 minute left. Unanswered questions count as wrong.', 'error', 6000); }
  if (t.left <= 0) finishQuiz(true);
}

function timerHTML() {
  const t = timerState();
  return `<div id="qtimer" class="qtimer ${t.tone}" role="timer" aria-label="${QZ.limitSec ? 'Time left' : 'Time spent'}"><b>${t.text}</b> <span>${t.label}</span></div>`;
}

/* ---------- taking the quiz ---------- */

function renderQuiz(id) {
  const q = quizById(id);
  if (!q) return notFound('That quiz no longer exists.');
  if (!QZ || QZ.quizId !== id) { stopTimer(); QZ = { quizId: id, idx: 0, answers: new Array(q.questions.length).fill(null), started: false }; }
  const s = subjectById(q.subjectId);
  const head = `
    <header class="page-head">
      <div>
        <p class="crumb"><a href="#/subject/${s?.id}">${esc(s?.name || 'Subject')}</a></p>
        <h1>${esc(q.title)}</h1>
      </div>
      <button class="btn ghost" data-act="quitQuiz">Leave quiz</button>
    </header>`;
  if (!QZ.started) return head + startScreenHTML(q);
  if (!quizTimer) startTimer();
  const i = QZ.idx, n = q.questions.length, qq = q.questions[i];
  const answered = QZ.answers.filter(a => a != null).length;
  const codeOpts = optionsAreCode(qq);
  return `${head}
    <div class="quiz">
      <div class="quiz-top">
        <div class="qprogress" aria-label="Question ${i + 1} of ${n}">
          ${q.questions.map((_, k) => `<button class="qdot ${k === i ? 'cur' : ''} ${QZ.answers[k] != null ? 'done' : ''}" data-act="quizGo" data-i="${k}" aria-label="Question ${k + 1}${QZ.answers[k] != null ? ', answered' : ''}"></button>`).join('')}
        </div>
        ${timerHTML()}
      </div>
      <p class="qmeta">Question ${i + 1} of ${n} <span class="muted">· ${esc(qq.chapter)}</span></p>
      <h2 class="qtext">${inlineCode(qq.question)}</h2>
      ${exhibitsHTML(qq, { quizId: q.id, index: i })}
      <p class="small add-pic"><button class="link" data-act="addPicture" data-q="${q.id}" data-i="${i}">${qq.figure ? 'Change the picture' : 'Is a picture missing? Add one'}</button></p>
      <div class="options" role="radiogroup">
        ${qq.options.map((o, k) => `
          <button class="option ${codeOpts ? 'code' : ''} ${QZ.answers[i] === k ? 'picked' : ''}" role="radio" aria-checked="${QZ.answers[i] === k}" data-act="quizPick" data-k="${k}">
            <kbd>${k + 1}</kbd><span class="opt-body">${optionHTML(qq, o)}</span>
          </button>`).join('')}
      </div>
      <div class="row between quiz-nav">
        <button class="btn" data-act="quizPrev" ${i === 0 ? 'disabled' : ''}>Back</button>
        <span class="muted small">${answered} of ${n} answered</span>
        ${i < n - 1
          ? `<button class="btn primary" data-act="quizNext">Next</button>`
          : `<button class="btn primary" data-act="quizSubmit">Submit quiz</button>`}
      </div>
      <p class="muted small hint">Keys: <kbd>1</kbd>–<kbd>${qq.options.length}</kbd> pick an answer, <kbd>←</kbd> <kbd>→</kbd> move, <kbd>Enter</kbd> next.</p>
    </div>`;
}

function startScreenHTML(q) {
  const n = q.questions.length;
  const atts = q.attempts || [];
  const best = atts.length ? Math.max(...atts.map(a => a.score)) : null;
  const visuals = q.questions.filter(x => x.exhibit || x.figure).length;
  const chapters = [...new Set(q.questions.map(x => x.chapter))];
  return `
    <section class="quiz-start">
      <p class="qs-count"><b>${n}</b> question${n === 1 ? '' : 's'}</p>
      <p class="muted">${esc(chapters.slice(0, 4).join(', '))}${chapters.length > 4 ? ` and ${chapters.length - 4} more` : ''}${visuals ? `. ${visuals} come${visuals === 1 ? 's' : ''} with code, a chart or a picture.` : '.'}</p>
      ${best != null ? `<p class="muted">Your best so far: <b class="${scoreTone(best)}-text">${best}%</b> after ${atts.length} attempt${atts.length === 1 ? '' : 's'}.</p>` : ''}
      <label class="qs-timer">Timer
        <select id="qsTimer">${timerOptions(q.timeLimit || 0)}</select>
      </label>
      <p class="muted small">The timer starts when you press Start. If time runs out, the quiz is submitted with the answers you have.</p>
      <button class="btn primary qs-go" data-act="quizStart">Start quiz</button>
    </section>`;
}

ACT.quizStart = () => {
  const q = quizById(QZ.quizId);
  const minutes = +($('#qsTimer')?.value || 0);
  q.timeLimit = minutes; save(); // remembered for the next attempt
  Object.assign(QZ, { started: true, startedAt: Date.now(), limitSec: minutes * 60, warned: false });
  startTimer();
  render();
};

ACT.quizPick = el => {
  QZ.answers[QZ.idx] = +el.dataset.k;
  render();
};
ACT.quizGo = el => { QZ.idx = +el.dataset.i; render(); };
ACT.quizPrev = () => { if (QZ.idx > 0) { QZ.idx--; render(); } };
ACT.quizNext = () => { const q = quizById(QZ.quizId); if (QZ.idx < q.questions.length - 1) { QZ.idx++; render(); } };
ACT.quitQuiz = async () => {
  const q = quizById(QZ.quizId);
  if (QZ.answers.some(a => a != null) && !(await confirmBox('Leave this quiz?', 'Your answers so far will not be graded.', 'Leave quiz'))) return;
  stopTimer(); QZ = null; location.hash = '#/subject/' + q.subjectId;
};

ACT.quizSubmit = async () => {
  const blank = QZ.answers.filter(a => a == null).length;
  if (blank && !(await confirmBox('Submit with unanswered questions?', `${blank} question${blank > 1 ? 's are' : ' is'} unanswered and will count as wrong.`, 'Submit quiz', false))) return;
  if (QZ) finishQuiz(false); // the timer may have submitted it while the box was open
};

function finishQuiz(timedOut) {
  stopTimer();
  if (timedOut) closeModal();
  const q = quizById(QZ.quizId);
  const correct = q.questions.filter((qq, i) => QZ.answers[i] === qq.answer).length;
  const spent = Math.round((Date.now() - QZ.startedAt) / 1000);
  const attempt = {
    id: uid(), at: Date.now(), answers: QZ.answers.slice(), correct, score: Math.round(correct / q.questions.length * 100),
    review: null, cardsOffer: null,
    durationSec: QZ.limitSec ? Math.min(spent, QZ.limitSec) : spent, timeLimitSec: QZ.limitSec || 0, timedOut: !!timedOut,
  };
  q.attempts = q.attempts || [];
  q.attempts.push(attempt);
  // A quiz launched from a study plan session marks that session done.
  for (const ex of S.exams) for (const ses of ex.plan?.sessions || []) if (ses.quizId === q.id) ses.done = true;
  save(); QZ = null;
  if (timedOut) toast("Time's up. Your quiz was submitted with the answers you had.", 'info', 7000);
  location.hash = `#/result/${q.id}/${attempt.id}`;
}

function quizKeys(e) {
  if (!QZ) return;
  if (!QZ.started) { if (e.key === 'Enter' && !e.target.closest('button, select')) ACT.quizStart(); return; }
  const q = quizById(QZ.quizId);
  const qq = q.questions[QZ.idx];
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= qq.options.length) { QZ.answers[QZ.idx] = n - 1; render(); }
  else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest('button'))) { if (QZ.idx < q.questions.length - 1) { QZ.idx++; render(); } }
  else if (e.key === 'ArrowLeft') { if (QZ.idx > 0) { QZ.idx--; render(); } }
}

/* ---------- results ---------- */

function renderResult(qid, aid) {
  const q = quizById(qid);
  const a = q && (q.attempts || []).find(x => x.id === aid);
  if (!a) return notFound('Those results no longer exist.');
  const s = subjectById(q.subjectId);
  const stats = attemptChapterStats(q, a);
  const missed = q.questions.map((qq, i) => ({ qq, i })).filter(({ qq, i }) => a.answers[i] !== qq.answer);
  const tone = scoreTone(a.score);
  const verdict = a.score >= 90 ? 'Excellent work.' : a.score >= 75 ? 'Solid. A few gaps to close.' : a.score >= 50 ? 'Getting there. Focus on the chapters below.' : 'This material needs another pass.';
  const prev = q.attempts.filter(x => x.at < a.at).pop();

  return `
    <header class="page-head">
      <div>
        <p class="crumb"><a href="#/subject/${s?.id}">${esc(s?.name || 'Subject')}</a></p>
        <h1>${esc(q.title)}</h1>
      </div>
      <div class="row gap wrap">
        <a class="btn" href="#/quiz/${q.id}">Retake quiz</a>
        <a class="btn ghost" href="#/subject/${s?.id}">Back to subject</a>
      </div>
    </header>

    <section class="score-hero ${tone}">
      <div class="score-num"><span class="hl">${a.score}%</span></div>
      <div>
        <p class="score-line"><b>${a.correct} of ${q.questions.length}</b> correct, ${a.score} out of 100 points.</p>
        <p>${verdict}${prev ? ` ${a.score > prev.score ? `Up ${a.score - prev.score} points` : a.score < prev.score ? `Down ${prev.score - a.score} points` : 'Same score as'} from your last attempt.` : ''}</p>
        ${a.durationSec != null ? `<p class="time-line">${a.timedOut
          ? `<b class="bad-text">Time ran out</b> after ${fmtClock(a.timeLimitSec)}.`
          : `Time: <b>${fmtClock(a.durationSec)}</b>${a.timeLimitSec ? ` of ${fmtClock(a.timeLimitSec)}` : ''}, about ${fmtClock(a.durationSec / q.questions.length)} a question.`}</p>` : ''}
      </div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Score by chapter</h2></div>
      ${chapterBarsHTML(stats)}
    </section>

    ${missed.length ? `
    <section class="block">
      <div class="block-head"><h2>Where you went wrong</h2></div>
      <div id="aiReview">${a.review ? reviewHTML(a.review) : `<p class="progress-line"><span class="spin"></span>Reading your answers…</p>`}</div>
    </section>

    <section class="offer" id="cardOffer">${cardOfferHTML(q, a, missed.length, s)}</section>

    <section class="block">
      <div class="block-head">
        <h2>Questions you missed</h2>
        <button class="btn" data-act="practiceMissed" data-q="${q.id}" data-a="${a.id}" title="A new quiz that tests the same ideas in new ways">Practice what I missed</button>
      </div>
      <ol class="missed">${missed.map(({ qq, i }) => `
        <li>
          <p class="mq">${inlineCode(qq.question)} <span class="muted small">${esc(qq.chapter)}</span></p>
          ${exhibitsHTML(qq, { quizId: q.id, index: i, compact: true })}
          <div class="ans wrong">Your answer: ${a.answers[i] == null ? '<i>skipped</i>' : optionHTML(qq, qq.options[a.answers[i]])}</div>
          <div class="ans right">Correct: ${optionHTML(qq, qq.options[qq.answer])}</div>
          ${qq.explanation ? `<p class="muted">${inlineCode(qq.explanation)}</p>` : ''}
          ${qq.source && qq.source.quote ? `<blockquote class="course-quote"><span class="small">From your course${qq.source.page ? `, page ${qq.source.page}` : ''}</span>“${esc(qq.source.quote)}”</blockquote>` : ''}
          <button class="btn small" data-act="moreLike" data-q="${q.id}" data-i="${i}">More like this</button>
        </li>`).join('')}
      </ol>
    </section>` : `<p class="note good">You answered every question correctly.</p>`}`;
}

function reviewHTML(r) {
  return `
    ${r.summary ? `<p class="ai-summary">${esc(r.summary)}</p>` : ''}
    ${r.chapters.length ? `<dl class="diag">${r.chapters.map(c => `
      <div><dt>${esc(c.chapter)}</dt><dd>${esc(c.diagnosis)}${c.tip ? `<span class="tip">Review: ${esc(c.tip)}</span>` : ''}</dd></div>`).join('')}</dl>` : ''}
    ${r.focus.length ? `<p class="focus">${r.focus.map(f => `<span class="tag">${esc(f)}</span>`).join('')}</p>` : ''}`;
}

function cardOfferHTML(q, a, nMissed, s) {
  if (a.cardsOffer === 'created') return `<p><b>Flashcards added.</b> ${a.cardsCount || ''} new cards are waiting in ${esc(s.name)}.</p><a class="btn primary" href="#/cards/${s.id}">Study them now</a>`;
  if (a.cardsOffer === 'dismissed') return `<p class="muted">You skipped making flashcards for this attempt. <button class="link" data-act="reofferCards" data-q="${q.id}" data-a="${a.id}">Make them anyway</button></p>`;
  return `
    <p><b>Create flashcards for the ${nMissed} question${nMissed > 1 ? 's' : ''} you missed?</b></p>
    <p class="muted">The cards will target those concepts, with a few broader questions from ${esc(s.name)} mixed in to keep things fresh.</p>
    <div class="row gap wrap">
      <button class="btn primary" data-act="makeMissedCards" data-q="${q.id}" data-a="${a.id}">Create flashcards</button>
      <button class="btn ghost" data-act="dismissCards" data-q="${q.id}" data-a="${a.id}">Not now</button>
    </div>`;
}

function getAttempt(el) {
  const q = quizById(el.dataset.q);
  return { q, a: q.attempts.find(x => x.id === el.dataset.a) };
}

ACT.dismissCards = el => { const { a } = getAttempt(el); a.cardsOffer = 'dismissed'; save(); render(); };
ACT.reofferCards = el => { const { a } = getAttempt(el); a.cardsOffer = null; save(); render(); };

ACT.makeMissedCards = async el => {
  const { q, a } = getAttempt(el);
  const s = subjectById(q.subjectId);
  const missed = q.questions.map((qq, i) => ({ qq, i })).filter(({ qq, i }) => a.answers[i] !== qq.answer)
    .map(({ qq }) => ({ question: qq.question, chapter: qq.chapter, correctAnswer: qq.options[qq.answer] }));
  const count = clamp(Math.round(missed.length * 1.6), 6, 30);
  try {
    const cards = await busy(el, 'Writing flashcards…', () => aiGenerateCards(s, { count, missed, broadRatio: 0.35 }));
    S.cards.push(...cards);
    a.cardsOffer = 'created'; a.cardsCount = cards.length;
    save();
    startCardSession(s.id, 'new', false, cards.map(c => c.id));
    toast(`Added ${cards.length} flashcards`, 'good');
    render();
  } catch (e) { showError(e); }
};

/* New questions on the same core ideas: 5 for one question, about two per question for everything missed. */
async function makePracticeQuiz(el, quiz, sources, count) {
  if (!hasKey()) { toast('Add your Groq API key in Settings first.', 'error'); location.hash = '#/settings'; return; }
  const s = subjectById(quiz.subjectId);
  if (!s) return toast('This quiz\'s subject was deleted.', 'error');
  try {
    const out = await busy(el, 'Writing new questions…', () => aiSimilarQuiz(s, sources, { count }));
    const practice = { id: uid(), subjectId: s.id, title: out.title, kind: 'quiz', practiceOf: quiz.id, createdAt: Date.now(), questions: out.questions, attempts: [], timeLimit: 0 };
    S.quizzes.push(practice); save();
    location.hash = '#/quiz/' + practice.id;
  } catch (e) { showError(e); }
}
ACT.moreLike = el => {
  const q = quizById(el.dataset.q);
  const src = q && q.questions[+el.dataset.i];
  if (src) makePracticeQuiz(el, q, [src], 5);
};
ACT.practiceMissed = el => {
  const { q, a } = getAttempt(el);
  const missed = q.questions.filter((qq, i) => a.answers[i] !== qq.answer);
  if (missed.length) makePracticeQuiz(el, q, missed.slice(0, 15), clamp(missed.length * 2, 5, 20));
};

async function mountResult(qid, aid) {
  const q = quizById(qid);
  const a = q && (q.attempts || []).find(x => x.id === aid);
  if (!a || a.review || a.correct === q.questions.length) return;
  const box = $('#aiReview');
  if (!hasKey()) { box.innerHTML = '<p class="muted">Add your Groq API key in Settings to get an AI summary of your mistakes.</p>'; return; }
  try {
    a.review = await aiReviewAttempt(q, a);
    save();
    const b = $('#aiReview'); if (b) { b.innerHTML = reviewHTML(a.review); renderMath(b); }
  } catch (e) {
    const b = $('#aiReview');
    if (b) b.innerHTML = `<p class="muted">Could not get the AI summary: ${esc(e.message)} <button class="link" data-act="retryReview" data-q="${qid}" data-a="${aid}">Try again</button></p>`;
  }
}
ACT.retryReview = el => {
  $('#aiReview').innerHTML = `<p class="progress-line"><span class="spin"></span>Reading your answers…</p>`;
  mountResult(el.dataset.q, el.dataset.a);
};

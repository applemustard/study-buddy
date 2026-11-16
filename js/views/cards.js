/* Flashcards: flip with a chosen key, back/next, Got it / Again tracking, piles and shuffling. */

let CS = null; // {subjectId, pile, shuffled, queue:[ids], idx, flipped, got, again, manage}

const PILES = {
  all: { label: 'All cards', test: () => true },
  again: { label: 'Again', test: c => c.status === 'again' },
  got: { label: 'Got it', test: c => c.status === 'got' },
  new: { label: 'Not studied', test: c => c.status === 'new' },
};

function startCardSession(sid, pile = 'all', shuffled = false, ids = null) {
  let list = ids ? S.cards.filter(c => ids.includes(c.id)) : cardsFor(sid).filter(PILES[pile].test);
  if (shuffled) list = shuffle(list);
  CS = { subjectId: sid, pile: ids ? 'custom' : pile, shuffled, queue: list.map(c => c.id), idx: 0, flipped: false, got: 0, again: 0, manage: CS?.subjectId === sid ? CS.manage : false };
}

function renderCards(sid) {
  if (!sid) {
    if (S.subjects.length === 1) sid = S.subjects[0].id;
    else if (CS && subjectById(CS.subjectId)) sid = CS.subjectId;
  }
  if (!sid) {
    return `<header class="page-head"><h1>Flashcards</h1></header>
      ${S.subjects.length ? `<p class="muted">Pick a subject to study.</p>
        <ul class="subject-list">${S.subjects.map(s => `<li><a class="subject-row" href="#/cards/${s.id}">${subjectDot(s)}<span class="sr-name">${esc(s.name)}</span><span class="sr-meta">${cardsFor(s.id).length} cards</span><span class="sr-meta">${cardsFor(s.id).filter(c => c.status === 'again').length} to repeat</span><span></span></a></li>`).join('')}</ul>`
      : `<div class="empty"><h2>No subjects yet</h2><p>Create a subject and upload a PDF, then make flashcards from it.</p><a class="btn primary" href="#/subjects">Go to subjects</a></div>`}`;
  }
  const s = subjectById(sid);
  if (!s) return notFound('That subject no longer exists.');
  if (!CS || CS.subjectId !== sid) startCardSession(sid);
  // Drop cards that were deleted since the session started.
  CS.queue = CS.queue.filter(id => S.cards.some(c => c.id === id));
  const all = cardsFor(sid);
  const count = p => all.filter(PILES[p].test).length;
  const k = S.settings;
  const card = S.cards.find(c => c.id === CS.queue[CS.idx]);
  const pileName = CS.pile === 'custom' ? 'New cards' : PILES[CS.pile].label;

  return `
    <header class="page-head">
      <div>
        <p class="crumb"><a href="#/subject/${s.id}">${esc(s.name)}</a>${S.subjects.length > 1 ? ` <span class="muted">·</span> <a href="#/cards">Switch subject</a>` : ''}</p>
        <h1>Flashcards</h1>
      </div>
      <div class="row gap wrap">
        <details class="menu">
          <summary class="btn">Shuffle</summary>
          <div class="menu-list">
            <button data-act="shufflePile" data-pile="all">Shuffle all cards <span class="muted">${all.length}</span></button>
            <button data-act="shufflePile" data-pile="again">Shuffle the Again pile <span class="muted">${count('again')}</span></button>
            <button data-act="shufflePile" data-pile="got">Shuffle the Got it pile <span class="muted">${count('got')}</span></button>
          </div>
        </details>
        <button class="btn" data-act="addCard" data-sid="${s.id}">Add card</button>
        ${all.length ? `<button class="btn" data-act="shareDeck" data-sid="${s.id}">Share deck</button>` : ""}
        <button class="btn primary" data-act="newCards" data-sid="${s.id}" ${subjectChapters(s).length ? '' : 'disabled title="Upload a PDF first"'}>New flashcards from PDF</button>
      </div>
    </header>

    ${all.length ? `
      <div class="deck-progress">${progressStackHTML(all)}</div>
      <div class="tabs" role="tablist" aria-label="Which cards to study">
        ${['all', 'again', 'got', 'new'].map(p => `<button role="tab" aria-selected="${CS.pile === p}" class="tab ${CS.pile === p ? 'on' : ''} tab-${p}" data-act="pickPile" data-pile="${p}">${PILES[p].label} <span>${count(p)}</span></button>`).join('')}
      </div>
      <p class="muted small session-line">Studying: <b>${esc(pileName)}</b>${CS.shuffled ? ', shuffled' : ', in order'}. ${CS.queue.length} card${CS.queue.length === 1 ? '' : 's'} in this round.</p>
      ${card ? studyHTML(card) : roundDoneHTML(all)}
      <p class="keys-hint muted small">
        <span><kbd>${esc(keyLabel(k.flipKey))}</kbd> flip <button class="link" data-act="changeFlipKey">change</button></span>
        <span><kbd>←</kbd> <kbd>→</kbd> back / next</span>
        <span><kbd>${esc(keyLabel(k.againKey))}</kbd> Again</span>
        <span><kbd>${esc(keyLabel(k.gotKey))}</kbd> Got it</span>
      </p>
      <section class="block">
        <div class="block-head"><h2>All cards in ${esc(s.name)}</h2><button class="btn small" data-act="toggleManage">${CS.manage ? 'Hide list' : 'Show list'}</button></div>
        ${CS.manage ? manageHTML(all) : ''}
        <div class="row gap wrap deck-tools">
          <button class="btn small" data-act="startOver" data-sid="${s.id}">Delete cards and start over</button>
          <button class="link small danger-text" data-act="resetProgress" data-sid="${s.id}">Reset Got it / Again marks</button>
        </div>
      </section>`
    : `<div class="empty">
        <h2>No flashcards yet</h2>
        <p>Have the AI write cards from your PDF, or write your own.</p>
        <div class="row gap center wrap">
          <button class="btn primary" data-act="newCards" data-sid="${s.id}" ${subjectChapters(s).length ? '' : 'disabled'}>New flashcards from PDF</button>
          <button class="btn" data-act="addCard" data-sid="${s.id}">Add card</button>
        </div>
        ${subjectChapters(s).length ? '' : `<p class="muted small">Upload a PDF in <a href="#/subject/${s.id}">${esc(s.name)}</a> to let the AI write cards.</p>`}
      </div>`}`;
}

function studyHTML(card) {
  const statusTxt = { got: 'Got it', again: 'Again', new: 'Not studied' }[card.status];
  const kindTxt = { targeted: 'From your mistakes', broad: 'Broader review' }[card.kind];
  return `
    <div class="study">
      <div class="flash-wrap">
        <button class="flash ${CS.flipped ? 'flipped' : ''}" data-act="flip" aria-label="${CS.flipped ? 'Answer shown. Activate to show the question' : 'Question shown. Activate to show the answer'}">
          <span class="face front">
            <span class="card-top"><span>${esc(card.chapter || '')}</span><span class="st st-${card.status}">${statusTxt}</span></span>
            <span class="card-text">${esc(card.front)}</span>
            <span class="card-foot">${kindTxt ? `<span class="kind">${kindTxt}</span>` : '<span></span>'}<span>Question</span></span>
          </span>
          <span class="face back">
            <span class="card-top"><span>${esc(card.chapter || '')}</span><span class="st st-${card.status}">${statusTxt}</span></span>
            <span class="card-text">${esc(card.back)}</span>
            <span class="card-foot"><span class="q-echo">${esc(card.front)}</span><span>Answer</span></span>
          </span>
        </button>
      </div>
      <div class="row between card-nav">
        <button class="btn" data-act="cardPrev" ${CS.idx === 0 ? 'disabled' : ''}>Back</button>
        <span class="counter">${CS.idx + 1} / ${CS.queue.length}</span>
        <button class="btn" data-act="cardNext">Next</button>
      </div>
      <div class="grade">
        <button class="btn again-btn" data-act="mark" data-v="again">Again <kbd>${esc(keyLabel(S.settings.againKey))}</kbd></button>
        <button class="btn got-btn" data-act="mark" data-v="got">Got it <kbd>${esc(keyLabel(S.settings.gotKey))}</kbd></button>
      </div>
    </div>`;
}

function roundDoneHTML(all) {
  const again = all.filter(c => c.status === 'again').length;
  const got = all.filter(c => c.status === 'got').length;
  if (!CS.queue.length) {
    const msg = { again: 'Nothing in the Again pile. Every card you have marked is a Got it.', got: 'No cards marked Got it yet.', new: 'You have studied every card at least once.' }[CS.pile] || 'No cards here.';
    return `<div class="round-done"><p>${msg}</p><button class="btn primary" data-act="pickPile" data-pile="all">Study all cards</button></div>`;
  }
  return `<div class="round-done">
    <h2>Round finished</h2>
    <p>This round: <b class="got-text">${CS.got} Got it</b>, <b class="again-text">${CS.again} Again</b>.</p>
    <div class="row gap center wrap">
      ${again ? `<button class="btn primary" data-act="shufflePile" data-pile="again">Study the Again pile (${again})</button>` : ''}
      <button class="btn" data-act="shufflePile" data-pile="all">Shuffle all and go again</button>
      ${got ? `<button class="btn ghost" data-act="shufflePile" data-pile="got">Shuffle Got it pile (${got})</button>` : ''}
    </div>
  </div>`;
}

function manageHTML(all) {
  return `<ul class="card-list">${all.map(c => `
    <li class="cl-item st-border-${c.status}">
      <div><b>${esc(c.front)}</b><p class="muted">${esc(c.back)}</p><span class="muted small">${esc(c.chapter || '')}</span></div>
      <div class="row gap">
        <button class="btn small" data-act="editCard" data-id="${c.id}">Edit</button>
        <button class="icon-btn" data-act="deleteCard" data-id="${c.id}" aria-label="Delete card">✕</button>
      </div>
    </li>`).join('')}</ul>`;
}

ACT.flip = () => { CS.flipped = !CS.flipped; const f = $('.flash'); if (f) { f.classList.toggle('flipped', CS.flipped); f.setAttribute('aria-label', CS.flipped ? 'Answer shown. Activate to show the question' : 'Question shown. Activate to show the answer'); } };
ACT.cardNext = () => { if (CS.idx < CS.queue.length) { CS.idx++; CS.flipped = false; render(); } };
ACT.cardPrev = () => { if (CS.idx > 0) { CS.idx--; CS.flipped = false; render(); } };
ACT.mark = el => markCard(el.dataset.v);
ACT.pickPile = el => { startCardSession(CS.subjectId, el.dataset.pile, false); render(); };
ACT.shufflePile = el => {
  el.closest('details')?.removeAttribute('open');
  startCardSession(CS.subjectId, el.dataset.pile, true);
  toast(CS.queue.length ? `Shuffled ${CS.queue.length} cards` : 'That pile is empty', CS.queue.length ? 'info' : 'error', 2200);
  render();
};
ACT.toggleManage = () => { CS.manage = !CS.manage; render(); };

function markCard(v) {
  const card = S.cards.find(c => c.id === CS.queue[CS.idx]);
  if (!card) return;
  card.status = v; card.reviews = (card.reviews || 0) + 1; card.lastReviewed = Date.now();
  CS[v]++;
  save();
  const f = $('.flash-wrap');
  if (f && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    f.classList.add('sent-' + v);
    setTimeout(() => { CS.idx++; CS.flipped = false; render(); }, 180);
  } else { CS.idx++; CS.flipped = false; render(); }
}

function cardKeys(e) {
  if (!CS || !$('.study') && !$('.round-done')) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const st = S.settings;
  if (!$('.study')) return;
  if (k === st.flipKey) { e.preventDefault(); ACT.flip(); }
  else if (k === 'ArrowRight') { e.preventDefault(); ACT.cardNext(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); ACT.cardPrev(); }
  else if (k === st.againKey) { e.preventDefault(); markCard('again'); }
  else if (k === st.gotKey) { e.preventDefault(); markCard('got'); }
}

function setStudyKey(which, k) {
  const st = S.settings;
  const others = { flipKey: [st.againKey, st.gotKey], againKey: [st.flipKey, st.gotKey], gotKey: [st.flipKey, st.againKey] }[which];
  if (others.includes(k)) return `${keyLabel(k)} is already used for another action.`;
  st[which] = k; save(); render();
  return null;
}
ACT.changeFlipKey = () => captureKey('Key to flip cards', S.settings.flipKey, k => setStudyKey('flipKey', k));

ACT.addCard = el => cardEditor(el.dataset.sid, null);
ACT.editCard = el => { const c = S.cards.find(x => x.id === el.dataset.id); cardEditor(c.subjectId, c); };
ACT.deleteCard = el => { S.cards = S.cards.filter(c => c.id !== el.dataset.id); save(); render(); };
ACT.resetProgress = async el => {
  if (!(await confirmBox('Reset progress?', 'Every card goes back to Not studied. The cards themselves stay.', 'Reset marks'))) return;
  cardsFor(el.dataset.sid).forEach(c => (c.status = 'new')); save();
  startCardSession(el.dataset.sid); render();
};

/* ---------- delete and start over ---------- */

const isAiCard = c => ['core', 'targeted', 'broad'].includes(c.kind) && !c.sharedBy;
const DELETE_SETS = {
  all: { label: 'All cards', test: () => true },
  ai: { label: 'Only cards the AI made', test: isAiCard, hint: 'Keeps cards you wrote and cards from friends' },
  again: { label: 'Only the Again pile', test: c => c.status === 'again' },
  got: { label: 'Only the Got it pile', test: c => c.status === 'got' },
};

ACT.startOver = el => {
  const s = subjectById(el.dataset.sid);
  const all = cardsFor(s.id);
  const canMake = hasKey() && subjectChapters(s).length > 0;
  const { el: m } = openModal('Delete cards and start over', `
    <form id="overForm" class="form">
      <fieldset><legend>Delete</legend>
        ${Object.entries(DELETE_SETS).map(([k, d], i) => {
          const n = all.filter(d.test).length;
          return `<label class="check"><input type="radio" name="which" value="${k}" ${i === 0 ? 'checked' : ''} ${n ? '' : 'disabled'}> ${d.label} (${n})${d.hint ? ` <span class="muted small">${d.hint}</span>` : ''}</label>`;
        }).join('')}
      </fieldset>
      ${canMake ? `
      <label class="check"><input type="checkbox" name="remake" checked> Then make a new set from the PDF</label>
      <label class="indent" id="remakeCount">How many new cards
        <select name="count">${[6, 10, 15, 20, 30].map(n => `<option>${n}</option>`).join('')}</select>
      </label>` : `<p class="muted small">${hasKey() ? 'Upload a PDF to this subject to have the AI make a new set.' : 'Add your Groq API key in Settings to have the AI make a new set afterwards.'}</p>`}
      <p class="warn small">Deleted cards and their Got it / Again marks can't be recovered.</p>
      <div class="row end gap"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn danger" id="overGo"></button></div>
    </form>`);
  const form = $('#overForm', m), go = $('#overGo', m);
  const sync = () => {
    const which = form.which.value, n = all.filter(DELETE_SETS[which].test).length;
    const remake = form.remake && form.remake.checked;
    if (form.count) {
      $('#remakeCount', m).hidden = !remake;
      // Default to replacing about as many cards as are being deleted.
      if (!form.count.dataset.touched) form.count.value = String([6, 10, 15, 20, 30].reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a));
    }
    go.textContent = `Delete ${n} card${n === 1 ? '' : 's'}${remake ? ' and make new ones' : ''}`;
  };
  form.count && form.count.addEventListener('change', () => (form.count.dataset.touched = '1'));
  form.addEventListener('change', sync);
  sync();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const test = DELETE_SETS[form.which.value].test;
    const doomed = new Set(all.filter(test).map(c => c.id));
    const remake = form.remake && form.remake.checked;
    const count = form.count ? +form.count.value : 0;
    S.cards = S.cards.filter(c => !doomed.has(c.id));
    save();
    if (!remake) {
      closeModal(); startCardSession(s.id);
      toast(`Deleted ${doomed.size} card${doomed.size === 1 ? '' : 's'}`, 'good'); render();
      return;
    }
    try {
      const cards = await busy(go, 'Writing new cards…', () => aiGenerateCards(s, { count }));
      S.cards.push(...cards); save(); closeModal();
      startCardSession(s.id, 'new', false, cards.map(c => c.id));
      toast(`Deleted ${doomed.size} and added ${cards.length} new cards`, 'good');
      render();
    } catch (err) {
      closeModal(); startCardSession(s.id); render();
      showError(new Error(`Deleted ${doomed.size} cards, but the new set failed: ${err.message} Use "New flashcards from PDF" to try again.`));
    }
  });
};

function cardEditor(sid, card) {
  const s = subjectById(sid);
  const chs = subjectChapters(s);
  const { el } = openModal(card ? 'Edit card' : 'Add card', `
    <form id="cardEdit" class="form">
      <label>Question (front)<textarea name="front" rows="3" required>${esc(card?.front || '')}</textarea></label>
      <label>Answer (back)<textarea name="back" rows="4" required>${esc(card?.back || '')}</textarea></label>
      <p class="muted small">For math, wrap it in <code>\\( \\)</code>, for example <code>\\( \\frac{1}{2} \\times x^{2} \\)</code> or <code>\\( \\int_0^1 x\\,dx \\)</code>.</p>
      ${chs.length ? `<label>Chapter<select name="chapter"><option value="">None</option>${chs.map(c => `<option ${card?.chapter === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      <div class="row end gap"><button type="button" class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary">${card ? 'Save card' : 'Add card'}</button></div>
    </form>`);
  $('#cardEdit', el).addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { front: fd.get('front').trim(), back: fd.get('back').trim(), chapter: fd.get('chapter') || '' };
    if (card) Object.assign(card, data);
    else {
      const c = { id: uid(), subjectId: sid, ...data, kind: 'manual', status: 'new', reviews: 0, createdAt: Date.now() };
      S.cards.push(c);
      if (CS && CS.subjectId === sid && (CS.pile === 'all' || CS.pile === 'new')) CS.queue.push(c.id);
    }
    save(); closeModal(); toast(card ? 'Card saved' : 'Card added', 'good', 1800); render();
  });
}

/* UI primitives: action delegation, toasts, modals, busy buttons, key names. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* Any element with data-act="name" calls ACT.name(el, event) on click. */
const ACT = {};
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) { ev.preventDefault(); fn(el, ev); }
});

function toast(msg, type = 'info', ms = 4200) {
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

function showError(err) {
  console.error(err);
  if (err && err.limit && typeof openLimitDialog === 'function') { openLimitDialog(err.limit); return; }
  toast(err && err.message ? err.message : String(err), 'error', 7000);
}

/* Modal: returns {el, close}. Escape and backdrop click close it. */
let _modal = null;
function openModal(title, bodyHTML, { wide = false, onClose } = {}) {
  closeModal();
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="backdrop" data-modal-backdrop>
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <header class="modal-head">
          <h2 id="modalTitle">${esc(title)}</h2>
          <button class="icon-btn" data-act="closeModal" aria-label="Close">✕</button>
        </header>
        <div class="modal-body">${bodyHTML}</div>
      </div>
    </div>`;
  const el = $('.modal', root);
  _modal = { el, onClose, prevFocus: document.activeElement };
  root.querySelector('[data-modal-backdrop]').addEventListener('mousedown', e => {
    if (e.target.hasAttribute('data-modal-backdrop')) closeModal();
  });
  const first = el.querySelector('input, select, textarea, button:not(.icon-btn)');
  (first || el).focus();
  renderMath(el);
  return { el, close: closeModal };
}
function closeModal() {
  if (!_modal) return;
  const m = _modal; _modal = null;
  $('#modalRoot').innerHTML = '';
  m.onClose && m.onClose();
  m.prevFocus && m.prevFocus.focus && m.prevFocus.focus();
}
const modalOpen = () => !!_modal;
ACT.closeModal = closeModal;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && _modal) closeModal(); });

function confirmBox(title, text, okLabel = 'Delete', danger = true) {
  return new Promise(resolve => {
    let answered = false;
    const { el } = openModal(title, `
      <p>${esc(text)}</p>
      <div class="row end gap">
        <button class="btn ghost" data-r="0">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(okLabel)}</button>
      </div>`, { onClose: () => { if (!answered) resolve(false); } });
    $$('[data-r]', el).forEach(b => b.addEventListener('click', () => {
      answered = true; closeModal(); resolve(b.dataset.r === '1');
    }));
    $('[data-r="1"]', el).focus();
  });
}

/* Disable a button and show progress text while a promise runs. */
async function busy(btn, label, fn) {
  const old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(label)}`; }
  try { return await fn(); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}

function keyLabel(k) {
  if (k === ' ') return 'Space';
  if (k === 'ArrowLeft') return '←';
  if (k === 'ArrowRight') return '→';
  if (k === 'ArrowUp') return '↑';
  if (k === 'ArrowDown') return '↓';
  if (k && k.length === 1) return k.toUpperCase();
  return k || '?';
}

const isTyping = e => {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
};

/* "Press a key" capture used by Settings and the flashcard page. */
function captureKey(title, current, onPick) {
  const reserved = ['ArrowLeft', 'ArrowRight', 'Escape', 'Tab', 'Enter'];
  const { el } = openModal(title, `
    <p class="muted">Press the key you want to use. Arrow keys, Tab, Enter and Escape are reserved.</p>
    <div class="keycap-big" id="capKey">${esc(keyLabel(current))}</div>
    <p class="muted small" id="capMsg"></p>`);
  const handler = e => {
    if (!_modal || _modal.el !== el) { document.removeEventListener('keydown', handler, true); return; }
    if (e.key === 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    if (reserved.includes(e.key) || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      $('#capMsg', el).textContent = `${keyLabel(e.key)} is reserved. Pick another key.`;
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const err = onPick(k);
    if (err) { $('#capMsg', el).textContent = err; return; }
    $('#capKey', el).textContent = keyLabel(k);
    document.removeEventListener('keydown', handler, true);
    setTimeout(closeModal, 250);
  };
  document.addEventListener('keydown', handler, true);
}

function chapterChecklist(chapters, checked = null, name = 'ch') {
  if (!chapters.length) return '<p class="muted">No chapters found yet.</p>';
  return `<div class="checklist">
    <label class="check all"><input type="checkbox" data-all="${name}" ${!checked ? 'checked' : ''}> All chapters</label>
    ${chapters.map(c => `<label class="check"><input type="checkbox" name="${name}" value="${esc(c.name)}" ${!checked || checked.includes(c.name) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}
  </div>`;
}
function wireChecklist(root, name = 'ch') {
  const all = $(`[data-all="${name}"]`, root);
  if (!all) return;
  const boxes = $$(`input[name="${name}"]`, root);
  all.addEventListener('change', () => boxes.forEach(b => (b.checked = all.checked)));
  boxes.forEach(b => b.addEventListener('change', () => (all.checked = boxes.every(x => x.checked))));
}
function checkedChapters(root, name = 'ch') {
  const boxes = $$(`input[name="${name}"]`, root);
  const picked = boxes.filter(b => b.checked).map(b => b.value);
  return picked.length === boxes.length ? null : picked;
}

/* Typeset LaTeX math inside an element: \( inline \), \[ display \] and $$ display $$.
   Single $ is not a delimiter, so prices like $5 stay plain text. Textareas are left alone. */
function renderMath(root) {
  if (!root || !window.renderMathInElement) return;
  const text = root.textContent;
  if (!text.includes('\\(') && !text.includes('\\[') && !text.includes('$$')) return;
  try {
    renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
      // Full-size fractions even inside a sentence, so divisions stay readable.
      macros: { '\\frac': '\\dfrac' },
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
    });
  } catch (e) { console.warn('Math rendering failed', e); }
}

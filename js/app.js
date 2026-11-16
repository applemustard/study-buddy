/* Hash router, global keyboard handling and startup. */

function notFound(msg) {
  return `<div class="empty"><h2>Not found</h2><p>${esc(msg)}</p><a class="btn primary" href="#/">Go to Today</a></div>`;
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'home', args: parts.slice(1) };
}

let _lastRoute = '';
function render() {
  const { name, args } = route();
  const main = $('#main');
  const views = {
    home: () => [renderHome()],
    subjects: () => [renderSubjects()],
    subject: () => [renderSubject(args[0]), () => mountSubject(args[0])],
    quiz: () => [renderQuiz(args[0])],
    result: () => [renderResult(args[0], args[1]), () => mountResult(args[0], args[1])],
    cards: () => [renderCards(args[0])],
    calendar: () => [renderCalendar()],
    settings: () => [renderSettings(), mountSettings],
    notes: () => [renderNotes()],
    note: () => [renderNote(args[0])],
    import: () => [renderHome(), () => openImportDialog(decodeURIComponent(args.join('/')))],
  };
  const [htmlOut, mount] = (views[name] || (() => [notFound('That page does not exist.')]))();
  const scrollY = window.scrollY;
  main.innerHTML = htmlOut;
  renderMath(main);
  const nav = { subject: 'subjects', quiz: 'subjects', result: 'subjects', note: 'notes', import: 'home' }[name] || name;
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === nav));
  const key = location.hash;
  if (key !== _lastRoute) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); _lastRoute = key; }
  else window.scrollTo(0, scrollY);
  mount && mount();
}

function updateKeyStatus() {
  const el = $('#keyStatus');
  el.innerHTML = hasKey()
    ? `<span class="ok-dot"></span>AI on: ${esc(S.settings.model)}`
    : `<a href="#/settings"><span class="off-dot"></span>AI off: add a Groq key</a>`;
}

document.addEventListener('keydown', e => {
  if (modalOpen() || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  const { name } = route();
  if (name === 'quiz') quizKeys(e);
  else if (name === 'cards') cardKeys(e);
});

// Close open dropdown menus when clicking elsewhere.
document.addEventListener('click', e => {
  $$('details.menu[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open'); });
});

window.addEventListener('hashchange', render);

(async function start() {
  try {
    await loadState();
    try { repairStoredExhibits(); } catch (e) { console.warn('Exhibit repair failed', e); }
  } catch (e) {
    $('#main').innerHTML = `<div class="empty"><h2>Storage is blocked</h2><p>This browser is not allowing Study Buddy to save data (${esc(e.message)}). Try a normal, non-private window.</p></div>`;
    return;
  }
  // The launcher opens "#/updated/<version>" right after installing an update.
  const upd = location.hash.match(/^#\/updated\/([\w.\-]+)/);
  if (upd) {
    history.replaceState(null, '', location.pathname + location.search + '#/');
    toast(`Study Buddy updated to version ${upd[1]}.${APP_NOTES ? ' ' + APP_NOTES : ''}`, 'good', 9000);
  }
  updateKeyStatus();
  render();
  // Keep the sidebar status in sync after settings change.
  const origSave = save;
  window.save = save = function () { origSave(); updateKeyStatus(); };
  checkForUpdate(false);
})();

/* ---------- updates ---------- */

function newerVersion(a, b) { // true when a > b
  const pa = String(a).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

/* Looks at the published version.json at most twice a day. The launcher installs updates;
   this only tells people who opened the HTML file directly that a newer version exists. */
async function checkForUpdate(manual) {
  if (typeof UPDATE_REPO === 'undefined' || !UPDATE_REPO) {
    if (manual) toast('Updates are not set up for this copy yet.', 'info');
    return null;
  }
  let last = 0;
  try { last = +localStorage.getItem('sb-update-check') || 0; } catch {}
  if (!manual && Date.now() - last < 12 * 3600e3) return null;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_BRANCH}/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const remote = await res.json();
    try { localStorage.setItem('sb-update-check', String(Date.now())); } catch {}
    if (newerVersion(remote.version, APP_VERSION)) {
      toast(`Version ${remote.version} is available. Close Study Buddy and open it again from its icon to update.`, 'info', 10000);
      return remote.version;
    }
    if (manual) toast(`You have the latest version (${APP_VERSION}).`, 'good');
  } catch (e) {
    if (manual) toast('Could not check for updates. Check your internet connection.', 'error');
  }
  return null;
}
ACT.checkUpdate = el => busy(el, 'Checking…', () => checkForUpdate(true));

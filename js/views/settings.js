/* Settings: Groq key and model, study keys, request size, backup. */

function renderSettings() {
  const st = S.settings;
  const models = st.models.length ? st.models : [st.model];
  return `
    <header class="page-head"><h1>Settings</h1></header>

    <section class="block">
      <div class="block-head"><h2>AI (Groq Cloud)</h2></div>
      <form id="keyForm" class="form narrow">
        <label>Groq API key
          <span class="row gap">
            <input type="password" name="key" id="apiKey" autocomplete="off" spellcheck="false" placeholder="gsk_…" value="${esc(st.apiKey)}" class="grow">
            <button type="button" class="btn" data-act="toggleKey">Show</button>
          </span>
        </label>
        <p class="muted small">Get a key at console.groq.com under API Keys. It is stored only in this browser and sent only to api.groq.com.</p>
        <div class="row gap wrap"><button class="btn primary">Save key and load models</button>${st.apiKey ? '<button type="button" class="btn ghost danger-text" data-act="forgetKey">Remove key</button>' : ''}</div>
      </form>
      <label class="form narrow">Model
        <select id="modelSel">${models.map(m => `<option ${m === st.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
        <span class="muted small">Larger models write better questions. ${esc(DEFAULT_MODEL)} is a good default.</span>
      </label>
      <label class="form narrow">Material sent per request
        <select id="ctxSel">
          ${[[6000, 'Small, about 1.5k tokens (best for free-tier limits)'], [12000, 'Medium, about 3k tokens'], [24000, 'Large, about 6k tokens'], [48000, 'Extra large, about 12k tokens (paid plans)']].map(([v, l]) => `<option value="${v}" ${st.contextChars === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <span class="muted small">More material gives more varied questions but uses more of your Groq rate limit.</span>
      </label>
    </section>

    ${usageSectionHTML()}

    <section class="block">
      <div class="block-head"><h2>Flashcard keys</h2></div>
      <div class="keyrows">
        ${[['flipKey', 'Flip card'], ['againKey', 'Mark Again'], ['gotKey', 'Mark Got it']].map(([k, l]) => `
          <div class="keyrow"><span>${l}</span><kbd class="big">${esc(keyLabel(st[k]))}</kbd><button class="btn small" data-act="setKey" data-k="${k}" data-l="${l}">Change</button></div>`).join('')}
        <div class="keyrow"><span>Back / Next</span><kbd class="big">← →</kbd><span class="muted small">Fixed</span></div>
      </div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Version</h2></div>
      <p>Study Buddy ${esc(APP_VERSION)}.${APP_NOTES ? ` <span class="muted">${esc(APP_NOTES)}</span>` : ''}</p>
      <p class="muted small">Open Study Buddy from its desktop icon and it installs new versions by itself.</p>
      <button class="btn" data-act="checkUpdate">Check for updates</button>
    </section>

    <section class="block">
      <div class="block-head"><h2>Your data</h2></div>
      <p class="muted">Everything is saved in this browser. Export a backup to move it to another computer. The API key is not included.</p>
      <div class="row gap wrap">
        <button class="btn" data-act="exportData">Export backup</button>
        <label class="btn">Import backup<input type="file" id="importFile" accept="application/json,.json" hidden></label>
        <button class="btn ghost danger-text" data-act="wipeData">Erase everything</button>
      </div>
    </section>`;
}

function mountSettings() {
  $('#keyForm').addEventListener('submit', async e => {
    e.preventDefault();
    const key = $('#apiKey').value.trim();
    if (!key) return toast('Paste your Groq API key first.', 'error');
    const btn = e.target.querySelector('.btn.primary');
    try {
      const models = await busy(btn, 'Checking key…', () => listGroqModels(key));
      S.settings.apiKey = key;
      S.settings.models = models;
      if (!models.includes(S.settings.model)) S.settings.model = models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (models.find(m => /70b|120b|maverick|scout/i.test(m)) || models[0]);
      save(); toast(`Key saved. ${models.length} models available.`, 'good'); render(); updateKeyStatus();
    } catch (err) { showError(err); }
  });
  $('#modelSel').addEventListener('change', e => { S.settings.model = e.target.value; save(); toast('Model set to ' + e.target.value, 'good', 2000); render(); });
  $('#ctxSel').addEventListener('change', e => { S.settings.contextChars = +e.target.value; save(); });
  $('#importFile').addEventListener('change', importData);
}

ACT.toggleKey = el => { const i = $('#apiKey'); i.type = i.type === 'password' ? 'text' : 'password'; el.textContent = i.type === 'password' ? 'Show' : 'Hide'; };
ACT.forgetKey = () => { S.settings.apiKey = ''; save(); render(); updateKeyStatus(); toast('Key removed from this browser.'); };
ACT.setKey = el => captureKey(`Key for: ${el.dataset.l}`, S.settings[el.dataset.k], k => setStudyKey(el.dataset.k, k));

ACT.exportData = async () => {
  const docs = {};
  for (const s of S.subjects) for (const d of s.docs) docs[d.id] = await getPages(d.id);
  const data = { app: 'study-buddy', exportedAt: new Date().toISOString(), state: { ...S, settings: { ...S.settings, apiKey: '' } }, docs };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `study-buddy-backup-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

async function importData(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'study-buddy' || !data.state) throw new Error('That file is not a Study Buddy backup.');
    if (!(await confirmBox('Replace your data?', 'Importing replaces all subjects, quizzes, flashcards and exams in this browser with the backup.', 'Import backup'))) return;
    const key = S.settings.apiKey;
    for (const [id, pages] of Object.entries(data.docs || {})) { await kvSet('doc:' + id, pages); pageCache.set(id, pages); }
    S = Object.assign(structuredClone(DEFAULT_STATE), data.state);
    S.settings = Object.assign({}, DEFAULT_STATE.settings, data.state.settings, { apiKey: key });
    CS = null; QZ = null;
    save(); toast('Backup imported', 'good'); render();
  } catch (err) { showError(err); }
  finally { e.target.value = ''; }
}

ACT.wipeData = async () => {
  if (!(await confirmBox('Erase everything?', 'All subjects, PDFs, quizzes, flashcards, exams and settings in this browser will be deleted. This cannot be undone.', 'Erase everything'))) return;
  for (const k of await kvKeys()) await kvDel(k);
  pageCache.clear(); S = structuredClone(DEFAULT_STATE); CS = null; QZ = null;
  await kvSet('state', S);
  updateKeyStatus(); location.hash = '#/';
  render();
};

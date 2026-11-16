/* Groq Cloud API (OpenAI-compatible) and every AI prompt the app uses. */

const GROQ_BASE = 'https://api.groq.com/openai/v1';

function hasKey() { return !!(S.settings.apiKey || '').trim(); }

async function groqChat(messages, { json = true, temperature = 0.5, maxTokens = 4096 } = {}) {
  if (!hasKey()) throw new Error('Add your Groq API key in Settings to use the AI features.');
  const model = S.settings.model || DEFAULT_MODEL;
  // Groq already said this model is out of allowance: don't send a request that would fail.
  const blk = activeBlock(model);
  if (blk) throw new GroqLimitError({ ...blk, model, waitSec: (blk.until - Date.now()) / 1000 });
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(GROQ_BASE + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.settings.apiKey.trim() },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
    } catch (e) {
      throw new Error('Could not reach Groq. Check your internet connection.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 || res.status >= 500) {
      lastErr = data?.error?.message || `HTTP ${res.status}`;
      const info = res.status === 429 ? parseGroqLimit(lastErr) : null;
      if (info) {
        info.model = model;
        // One request bigger than the per-minute allowance can never succeed by waiting.
        if (info.per === 'minute' && info.unit === 'tokens' && info.requested > info.limit)
          throw new Error('That request was too large for your Groq plan. Set "Material sent per request" to Small in Settings, or make fewer questions at a time.');
        recordLimit(model, info);
        if (info.per === 'day' || info.waitSec > 60 || attempt === 3) throw new GroqLimitError(info);
        await sleep(Math.min(60, (info.waitSec || 2 ** attempt * 3) + 0.5) * 1000);
        continue;
      }
      const wait = parseFloat(res.headers.get('retry-after')) || 2 ** attempt * 3;
      await sleep(Math.min(wait, 30) * 1000);
      continue;
    }
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText;
      if (res.status === 401) throw new Error('Groq rejected the API key. Check it in Settings.');
      if (res.status === 404 || /model/i.test(msg) && /not (found|exist)|decommissioned/i.test(msg))
        throw new Error(`The model "${S.settings.model}" is not available. Pick another one in Settings.`);
      if (res.status === 413 || /too large|context|tokens per minute/i.test(msg))
        throw new Error('That request was too large for your Groq plan. Lower "Material sent per request" in Settings.');
      if (json && /json/i.test(msg) && attempt < 2) { lastErr = msg; continue; }
      throw new Error('Groq: ' + msg);
    }
    recordUsage(model, data.usage?.total_tokens);
    const text = data.choices?.[0]?.message?.content || '';
    if (!json) return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    try { return parseJSONLoose(text); }
    catch { lastErr = 'The AI returned malformed JSON.'; continue; }
  }
  throw new Error(/rate|limit|429/i.test(lastErr)
    ? 'Groq is rate-limiting requests. Wait a minute and try again.'
    : 'The AI request failed: ' + lastErr);
}

function parseJSONLoose(text) {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  // LaTeX like \sqrt or \( written with a single backslash is invalid JSON: double those backslashes.
  t = t.replace(/\\(?:(["\\/bfnrt])|(u[0-9a-fA-F]{4}))|\\/g, (m, esc1, uni) => (esc1 || uni ? m : '\\\\'));
  let out;
  try { out = JSON.parse(t); }
  catch {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (!(a >= 0 && b > a)) throw new Error('bad json');
    out = JSON.parse(t.slice(a, b + 1));
  }
  return fixLatexDeep(out);
}

/* \frac, \times, \beta, \rho and \neq written with one backslash are *valid* JSON escapes
   (form feed, tab, backspace, CR, newline), so they arrive as control characters. Put the backslash back. */
function fixLatex(s) {
  s = s.replace(/\f/g, '\\f').replace(/\x08/g, '\\b').replace(/\t(?=[a-zA-Z])/g, '\\t').replace(/\r(?=[a-zA-Z])/g, '\\r');
  return s.replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g, m => m.replace(/\n(?=[a-zA-Z])/g, '\\n'));
}
/* Bare LaTeX (no delimiters), as in a formula exhibit: no real tab or newline belongs before a letter. */
function fixLatexBare(s) {
  return s.replace(/\f/g, '\\f').replace(/\x08/g, '\\b').replace(/\t(?=[a-zA-Z])/g, '\\t').replace(/\r(?=[a-zA-Z])/g, '\\r').replace(/\n(?=[a-zA-Z])/g, '\\n');
}
function fixLatexDeep(v, key) {
  // Code is left exactly as written: its tabs and newlines are real.
  if (typeof v === 'string') return key === 'content' ? v : key === 'latex' ? fixLatexBare(v) : fixLatex(v);
  if (Array.isArray(v)) return v.map(x => fixLatexDeep(x));
  if (v && typeof v === 'object') { for (const k in v) v[k] = fixLatexDeep(v[k], k); }
  return v;
}

/* Math formatting rules added to every prompt that can contain formulas. */
const MATH_CORE = `- MATH: whenever there is any math, physics or chemistry notation (formulas, equations, integrals, derivatives, fractions, powers, roots, units with exponents), write it in LaTeX. Inline math goes in \\( ... \\), standalone equations in \\[ ... \\]. Use \\times for multiplication (never * or x), \\frac{a}{b} for division and fractions (never a/b), \\int_{a}^{b} f(x)\\,dx for integrals, \\frac{d}{dx} or f'(x) for derivatives, \\sqrt{x}, x^{2}, x_{1}, \\pi, \\infty, \\leq, \\geq, \\neq, \\approx, \\lim_{x \\to 0}, \\sum_{i=1}^{n}. Never use $ signs as math delimiters. Plain words stay outside the delimiters.`;
const MATH_JSON = MATH_CORE + `\n- Because the answer is JSON, every LaTeX backslash must be escaped inside strings: write "\\\\frac{1}{2}" and "\\\\( x \\\\)".`;
const MATH_MD = MATH_CORE;

async function listGroqModels(key) {
  const res = await fetch(GROQ_BASE + '/models', { headers: { Authorization: 'Bearer ' + key.trim() } });
  if (res.status === 401) throw new Error('Groq rejected that key.');
  if (!res.ok) throw new Error('Could not load models (HTTP ' + res.status + ').');
  const data = await res.json();
  const skip = /whisper|tts|guard|embed|playai|orpheus|prompt-guard|distil|compound/i;
  return (data.data || []).filter(m => m.active !== false && !skip.test(m.id)).map(m => m.id).sort();
}

/* Match an AI-provided chapter label to a known chapter name. */
function matchChapter(label, names) {
  if (!names.length) return label || 'General';
  if (!label) return names[0];
  const l = String(label).toLowerCase().trim();
  return names.find(n => n.toLowerCase() === l)
    || names.find(n => n.toLowerCase().includes(l) || l.includes(n.toLowerCase()))
    || names.find(n => { const num = l.match(/\d+/); return num && n.match(/\d+/)?.[0] === num[0]; })
    || names[0];
}

const SYS_TEACHER = 'You are a precise, encouraging teacher. You only use facts from the study material you are given. You always answer with a single JSON object and nothing else.';

/* ---------- quizzes ---------- */

/* Keeps the AI on the subject matter instead of how the PDF is organised. Used by quizzes and flashcards. */
const CONTENT_ONLY = `- ONLY WHAT THE COURSE TEACHES. Every question must be about something the study material below actually explains. Do not bring in outside facts, other programming languages, tools, people, history or examples the material does not mention, even closely related ones, and do not ask about topics that are not in the material below (for example from later in the course).
- Ask about the subject matter, never about the document itself. Never ask about how the material is organised: which chapter, section, page, slide or lecture something is in; chapter or section titles and headings; the order topics come in; what a chapter "covers", "introduces" or "discusses"; the table of contents, learning objectives, course details, who wrote the PDF, or the PDF itself. The chapter names are only for the "chapter" field.
- Do not start with "According to the text/chapter/PDF/slides". Ask about the idea directly.
- Ignore front matter (title pages, contents, objectives, references, index) and use the explanatory content.
  Bad: "Which chapter introduces recursion?" (about the document), "Which language is an example of strong typing?" when the material never names one (outside knowledge).
  Good: "What must every recursive method have to avoid infinite recursion?" when the material explains base cases.`;

const META_QUESTION_RES = [
  // Kept narrow on purpose: "what unit is force measured in", "which Python module" and "which heading tag" are real questions.
  /\b(which|what|in which|in what)\s+(chapter|page|slide|lecture|lesson)s?\b/i,
  /\b(chapter|section|page|slide|lecture|lesson)\s+\d+(\.\d+)*\b/i,
  /\b(table of contents|learning (objectives|outcomes|goals)|syllabus|course (outline|structure)|reading list)\b/i,
  /\b(covered|discussed|introduced|presented|mentioned|listed|explained|described|addressed)\s+(first|last|next|earlier|later|before|after)\b/i,
  /\b(first|last|next|final|opening)\s+(topic|chapter|slide|lecture)\b/i,
  /\b(purpose|aim|goal|scope|objective|focus|main (topic|idea|theme)|central (topic|theme))s?\s+of\s+(the|this)\s+(chapter|section|lecture|lesson|document|pdf|text|textbook|course|book|material|slides?|presentation|handout)\b/i,
  /\b(title|heading|name)\s+of\s+(the|this)\s+(chapter|section|lecture|lesson|pdf|book|slide)\b/i,
  /\bhow many (chapters|sections|pages|slides|topics|lectures)\b/i,
  /\b(the|this) (pdf|handout|study guide)\b/i,
  /\b(chapter|section|lecture|document|pdf|text|slides?)\s+(covers?|discuss(es)?|introduces?|focus(es)? on|is about|deals with)\b/i,
];

/* True for a question about the PDF's structure rather than its content. */
function isMetaQuestion(text, options = [], chapterNames = []) {
  const t = String(text || '');
  if (META_QUESTION_RES.some(re => re.test(t))) return true;
  // Options that are chapter titles or "Chapter 3"-style labels give it away too.
  const lower = chapterNames.map(n => n.toLowerCase().trim());
  const chapterish = options.filter(o => {
    const s = String(o).toLowerCase().trim();
    return lower.includes(s) || /^(chapter|section|lecture|lesson|page|slide)\s*\d+\b/.test(s);
  }).length;
  return chapterish >= 2;
}

/* "According to the text, what is X?" → "What is X?" */
function dropSourcePrefix(text) {
  const t = String(text).replace(/^(according to|based on|as (stated|described|explained|mentioned|defined|shown) in|in) (the|this) (text|material|study material|chapter|section|pdf|document|slides?|lecture|reading|passage|notes|book|textbook)s?\s*,\s*/i, '');
  return t === text ? text : t.charAt(0).toUpperCase() + t.slice(1);
}

async function aiGenerateQuiz(subject, { count = 10, difficulty = 'medium', chapters = null, kind = 'quiz' }) {
  const all = subjectChapters(subject);
  const picked = chapters ? all.filter(c => chapters.includes(c.name)) : all;
  const names = picked.map(c => c.name);
  const context = await buildContext(subject, { chapters, budget: S.settings.contextChars });
  if (!context.trim()) throw new Error('This subject has no readable material yet. Upload a PDF first.');

  const past = pastQuestions(subject.id);
  const first = await requestQuestions(count, { difficulty, names, context, past });
  const topped = await topUp(first, count, { difficulty, names, context, past });
  const offCourse = topped.offCourse;
  const { questions, unconfirmed } = await verifyAnswers(topped.questions);
  if (!questions.length) throw new Error(offCourse ? 'The AI only wrote questions that are not in your course material, so they were dropped. Try again, or pick other chapters.' : 'The AI did not return usable questions. Try again.');
  await attachFigures(subject, questions);
  return { title: String(first.title || `${subject.name} quiz`).slice(0, 90), questions, offCourse, unconfirmed };
}

/* Questions about the PDF's structure, off the course, or repeating earlier quizzes are dropped:
   ask once more for replacements. */
async function topUp(first, count, opts) {
  const questions = first.questions;
  let offCourse = first.offCourse || 0;
  if (questions.length < count && (first.rejected.length || first.repeats.length)) {
    try {
      const more = await requestQuestions(count - questions.length, {
        ...opts, avoid: first.rejected,
        past: [...(opts.past || []), ...first.repeats].slice(-60),
        existing: questions.map(q => q.question),
      });
      offCourse += more.offCourse || 0;
      questions.push(...more.questions.slice(0, count - questions.length));
    } catch (e) { console.warn('Replacement questions failed', e); }
  }
  return { questions, offCourse };
}

/* A practice quiz with new questions on the same core ideas as the given ones. */
async function aiSimilarQuiz(subject, sources, { count = 5, difficulty = 'medium' } = {}) {
  const all = subjectChapters(subject);
  const names = [...new Set(sources.map(q => q.chapter))].filter(n => all.some(c => c.name === n));
  const context = await buildContext(subject, { chapters: names.length ? names : null, budget: S.settings.contextChars });
  if (!context.trim()) throw new Error('This subject has no readable material yet. Upload a PDF first.');
  const opts = { difficulty, names: names.length ? names : all.map(c => c.name), context, past: pastQuestions(subject.id), similarTo: sources };
  const first = await requestQuestions(count, opts);
  const { questions } = await verifyAnswers((await topUp(first, count, opts)).questions);
  if (!questions.length) throw new Error('The AI did not return usable questions that are in your course material. Try again.');
  await attachFigures(subject, questions);
  // The AI's title names the idea ("Assignment expressions"); the question text is the fallback.
  const fallback = sources.length === 1 ? sources[0].question.replace(/\\\(|\\\)|\\\[|\\\]/g, '') : `${sources.length} missed questions`;
  const t = String(first.title || fallback).replace(/^practice\s*:\s*/i, '');
  return { title: `Practice: ${t.length > 70 ? t.slice(0, 70) + '…' : t}`, questions };
}

/* Theory stays exactly on the course; only exercises (code, maths, problems) get new versions. */
const TWO_KINDS = `- STRICT RULE: THEORY OR EXERCISE. Decide the type of every question FIRST and write it in "type" before anything else. The two types follow different rules and must never be mixed.
  How to decide: it is an "exercise" if answering it means working something out: running or tracing code, finding a bug, a calculation, solving an equation, applying a formula to numbers, reading values from a table or chart. Everything else (definitions, concepts, facts, rules, comparisons, how and why) is "theory".
  "theory": TAKE IT FROM THE COURSE. Ask only about what the material states, and the correct option must say what the material says, using the material's own words and terms. Add nothing the material doesn't say. Never invent new situations, examples or code for a theory question.
  "exercise": MAKE YOUR OWN, THEN SOLVE IT YOURSELF. Write a new version of a kind of exercise the material shows (predict the output, which line has the bug, what changes if…, solve for…), with your own code (different names, values and structure) or new numbers, using only the constructs, formulas and methods the material teaches. Then forget the material's answer and solve YOUR version from scratch, step by step, in "working". The answer comes only from that working.
  Write exercises when the material teaches code, maths or problem solving. If it doesn't, write only theory questions.
  NEVER CARRY OVER THE MATERIAL'S ANSWER. When your exercise is a changed version of an example in the material, its answer is different: work it out again from your own code or numbers. Example: the material shows "2 + 3 * 2" giving 8; your version "5 + 3 * 2" gives 5 + 6 = 11, not 8. The explanation must use your values too.
- SOURCE: for every question, "source" is a short exact quote (8 to 25 words, copied word for word) from the material that the question is based on, and "page" is the number of the [p.N] marker it is under. For an exercise, quote the part that teaches the rule or technique it practises. A question you cannot back with a quote from the material must not be written.`;

/* Exercises are decided by the app too, not only by the AI's label: anything with code to trace, a formula,
   code answers or a "calculate / what does it print" question is an exercise, so it always gets re-solved. */
function isExercise(item, aiType) {
  if (aiType === 'exercise') return true;
  if (item.exhibit && ['code', 'formula'].includes(item.exhibit.type)) return true;
  if (optionsAreCode(item)) return true;
  return /\b(print(s|ed)?|output|evaluates?|calculate|compute|solve|simplify|how many times|what (is the )?value|result of|returns?)\b/i.test(item.question)
    && (/\d/.test(item.question) || !!item.exhibit);
}

const STOP_WORDS = new Set('the and for are was were that this with from into its not but can has have had any all one only also than then when which what who whom why how does did will would should could may might must each other such been being more most some very'.split(' '));
/* For theory: the correct answer has to come from the course, so at least half of its key words must be in the material. */
function answerInMaterial(item, materialNorm) {
  const words = normQ(item.options[item.answer]).split(' ').filter(w => (w.length >= 3 && !STOP_WORDS.has(w)) || /^\d+$/.test(w));
  if (!words.length) return true; // "Yes", "No", "A and B"…: nothing to check
  const found = words.filter(w => materialNorm.includes(' ' + w + ' ') || (w.length > 4 && materialNorm.includes(' ' + w.replace(/(es|s)$/, ''))));
  return found.length >= Math.ceil(words.length / 2);
}

/* Share of a quote's 3-word runs found in the material (1 = word for word). */
function quoteCoverage(quote, materialNorm) {
  const w = normQ(quote).split(' ').filter(Boolean);
  if (w.length < 4) return 0;
  if (materialNorm.includes(' ' + w.join(' ') + ' ')) return 1;
  let hit = 0, n = 0;
  for (let i = 0; i + 3 <= w.length; i++) { n++; if (materialNorm.includes(' ' + w.slice(i, i + 3).join(' ') + ' ')) hit++; }
  return n ? hit / n : 0;
}

/* Earlier quiz questions for a subject, newest first, so a new quiz doesn't repeat them. */
function pastQuestions(subjectId, limit = 40) {
  const out = [];
  const quizzes = S.quizzes.filter(q => q.subjectId === subjectId).sort((a, b) => b.createdAt - a.createdAt);
  for (const qz of quizzes) for (const q of qz.questions) {
    if (out.length >= limit) return out;
    out.push(q);
  }
  return out;
}
const normQ = s => String(s || '').toLowerCase().replace(/\\[()[\]]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/* Same wording and same code/data = the same question, even if the options were shuffled. */
function questionKey(q) {
  return normQ(q.question) + '|' + (q.exhibit ? normQ(exhibitText(q)) : '');
}
function pastLine(q) {
  const ex = q.exhibit ? exhibitText(q).replace(/\s+/g, ' ').slice(0, 160) : '';
  return `${q.question.slice(0, 200)}${ex ? ` [shown: ${ex}]` : ''}`;
}

async function requestQuestions(count, { difficulty, names, context, avoid = [], existing = [], past = [], similarTo = [] }) {
  const task = similarTo.length
    ? `Write ${count} new multiple-choice practice questions (difficulty: ${difficulty}) on the same core ideas as the questions below. For each one, work out the idea it really tests. If it is an exercise (code, a calculation, a problem), write new versions of that exercise with new code or numbers, or from a different angle (predict the output, find the bug, what happens if one thing changes). If it is theory, ask about other things the material says about the same topic, never about facts the material does not state. Spread the new questions evenly over these ideas. Never repeat an original question, its code or its numbers:
${similarTo.map(q => `  - ${pastLine(q)} (correct answer: ${q.options[q.answer]})`).join('\n')}
Use the study material below for the facts.`
    : `Write ${count} multiple-choice exam questions (difficulty: ${difficulty}) based only on the study material below.`;
  const prompt = `${task}
${CONTENT_ONLY}
${TWO_KINDS}
- Spread the questions across these chapters roughly in proportion to how much material each has: ${JSON.stringify(names)}
- Each question has exactly 4 options and exactly one correct option.
- Mix question styles: definitions, applying a concept, cause and effect, comparisons, key facts, worked problems.
- Wrong options must be plausible.
- CODE IN OPTIONS: when the options are code (for example "which fragment is correct"), add "optionLanguage": "java" (the language) to the question, and write each option as real, complete code laid out the normal way: one statement per line with "\\n" line breaks and 4-space indents, never squashed onto one line. A short piece of code inside an ordinary sentence goes in \`backticks\`.
- "chapter" must be copied exactly from the list above.
- "answer" is the 0-based index of the correct option. Before setting it, fill in "working": solve the question yourself step by step (trace code line by line with each variable's value, do every calculation explicitly, check operator precedence), then make sure the option at "answer" matches your result exactly, and that the explanation agrees with it.
- SHOW WHAT YOU ASK ABOUT: the student only sees the question, so every question must be answerable from what is shown. When a question is about code, a formula, a table of values or data that would be charted, put that material in the separate "exhibit" field as a JSON object (otherwise leave "exhibit" out):
  {"type": "code", "language": "java", "content": "the complete code, with line breaks written as \\n"}
  {"type": "table", "title": "...", "headers": ["...", "..."], "rows": [["...", "..."]]}
  {"type": "chart", "chart": "bar|line|pie", "title": "...", "labels": ["..."], "series": [{"name": "...", "values": [1, 2]}], "xLabel": "...", "yLabel": "..."}
  {"type": "formula", "latex": "LaTeX without delimiters"}
  The exhibit never goes inside the "question" text: "question" is only the sentence the student reads, such as "What does this code print?". Never write "the following code", "the table below" or "the switch statement" without an exhibit. Never put the answer itself in the exhibit.
- The material is split into pages marked [p.N]. When a question is about a figure, diagram, chart, picture or screenshot printed in the material (look for words like Figure, Fig., Diagram, Chart, Graph, Listing), set "figurePage" to the page number it is on, so the app can show the student that page. Otherwise leave "figurePage" out.
${avoid.length ? `- These questions were rejected, for asking about the document itself or about things the material does not say. Do not write anything like them:\n${avoid.map(q => '  - ' + q).join('\n')}\n` : ''}${existing.length ? `- Do not repeat these questions:\n${existing.map(q => '  - ' + q).join('\n')}\n` : ''}${past.length ? `- Earlier quizzes on this subject already asked the questions below. Do not reuse any of them, their code or their numbers. An idea may come back only as a clearly different question (new code, values or scenario):\n${past.map(q => '  - ' + pastLine(q)).join('\n')}\n` : ''}
${MATH_JSON}
Return: {"title": "short descriptive quiz title", "questions": [{"type": "theory|exercise", "question": "the sentence the student reads", "exhibit": {"type": "code", "language": "...", "content": "first line\\nsecond line"}, "options": ["...","...","...","..."], "working": "short step-by-step solution", "answer": 0, "chapter": "...", "explanation": "1-2 sentences on why the answer is right, using the material's explanation", "source": "exact words copied from the material", "page": 3}]}
(The exhibit above only shows the format. Leave "exhibit" out of questions that don't need one.)

STUDY MATERIAL:
${context}`;

  const out = await groqChat([{ role: 'system', content: SYS_TEACHER }, { role: 'user', content: prompt }],
    { temperature: 0.6, maxTokens: Math.min(8000, 500 + count * 520) });

  const rejected = [], repeats = [];
  let offCourse = 0;
  const materialNorm = ' ' + normQ(context) + ' ';
  const pages = new Set([...context.matchAll(/\[p\.(\d+)\]/g)].map(m => +m[1]));
  const pastKeys = new Set([...past, ...similarTo].map(questionKey));
  const questions = (out.questions || []).map(q => {
    if (!q || typeof q !== 'object') return null;
    const options = (q.options || []).map(String).filter(Boolean).slice(0, 6);
    let ans = Number.isInteger(q.answer) ? q.answer : parseInt(q.answer, 10);
    if (typeof q.answer === 'string' && isNaN(ans)) ans = options.indexOf(q.answer);
    if (!q.question || options.length < 2 || !(ans >= 0 && ans < options.length)) return null;
    // Shuffle options so the correct answer isn't always in the same slot.
    const order = shuffle(options.map((_, i) => i));
    const item = {
      id: uid(),
      question: String(q.question),
      options: order.map(i => options[i]),
      answer: order.indexOf(ans),
      chapter: matchChapter(q.chapter, names),
      explanation: String(q.explanation || ''),
    };
    const ex = validateExhibit(q.exhibit);
    if (ex) item.exhibit = ex;
    const lang = String(q.optionLanguage || '').toLowerCase().trim().slice(0, 20);
    if (lang && item.options.some(o => o.includes('\n') || looksLikeCode(o))) item.optionLang = lang;
    liftExhibit(item); // the exhibit sometimes lands inside the question text
    item.question = dropSourcePrefix(item.question);
    if (isMetaQuestion(item.question, item.options, names)) { rejected.push(item.question); return null; }
    // Off the course: the quote it is based on has to be in the material that was sent.
    const quote = String(q.source || '').trim().slice(0, 400);
    if (quoteCoverage(quote, materialNorm) < 0.5) { rejected.push(item.question); offCourse++; return null; }
    const page = parseInt(q.page, 10);
    item.source = { quote, ...(pages.has(page) ? { page } : {}) };
    item.qtype = isExercise(item, q.type) ? 'exercise' : 'theory';
    // Theory: the right answer itself must come from the course, not only the quote.
    if (item.qtype === 'theory' && !answerInMaterial(item, materialNorm)) { rejected.push(item.question); offCourse++; return null; }
    if (pastKeys.has(questionKey(item))) { repeats.push(item); return null; }
    pastKeys.add(questionKey(item));
    const fp = parseInt(q.figurePage, 10);
    if (fp > 0) item.figurePage = fp;
    return item;
  }).filter(Boolean);
  return { title: out.title, questions, rejected, repeats, offCourse };
}

/* ---------- answer checking ---------- */

/* Solves questions independently (without seeing the answer key). Returns [{answer, working}] in order;
   answer is the option index, -1 if no single option is right, or null if the AI gave nothing usable. */
async function aiSolve(items, { reshuffle = false } = {}) {
  // A second opinion sees the options in a new order, so it is a fresh attempt rather than a repeat.
  const perms = items.map(q => reshuffle ? shuffle(q.options.map((_, i) => i)) : q.options.map((_, i) => i));
  const shown = items.map((q, k) => ({ ...q, options: perms[k].map(i => q.options[i]) }));
  const results = await solveShown(shown);
  return results.map((r, k) => ({ ...r, answer: r.answer === null || r.answer < 0 ? r.answer : perms[k][r.answer] }));
}

async function solveShown(items) {
  const prompt = `You are checking the answer key of a quiz. Solve each question yourself, independently, without assuming any option is right.
- Trace code line by line, writing down each variable's value. Do every calculation explicitly and check operator precedence and integer division.
- Work only from the code and numbers exactly as written in the question. They may look like a familiar textbook example with different values: never use a remembered answer.
- For a theory question, use the course passage given with it.
- "answer" is the 0-based index of the option that matches your result. Use -1 if no option is correct or more than one is.
- Keep "working" short: the key steps and the result.
${MATH_JSON}
Return: {"answers": [{"n": 1, "working": "key steps and result", "answer": 0}]}

QUESTIONS:
${items.map((q, k) => {
    const ex = q.exhibit ? exhibitText({ exhibit: q.exhibit }) : '';
    const passage = q.qtype !== 'exercise' && q.source?.quote ? `\nCourse passage: "${q.source.quote}"` : '';
    return `${k + 1}. ${q.question}${ex ? `\n${ex}` : ''}${passage}\n${q.options.map((o, i) => `   [${i}] ${o.replace(/\n/g, '\n       ')}`).join('\n')}`;
  }).join('\n\n')}`;
  const out = await groqChat([{ role: 'system', content: 'You are a careful examiner who double-checks quiz answers. You always answer with a single JSON object and nothing else.' }, { role: 'user', content: prompt }],
    { temperature: 0, maxTokens: Math.min(8000, 300 + items.length * 450) });
  const byN = new Map((Array.isArray(out.answers) ? out.answers : []).map(a => [parseInt(a && a.n, 10), a]));
  return items.map((q, k) => {
    const a = byN.get(k + 1) || (Array.isArray(out.answers) && out.answers.length === items.length ? out.answers[k] : null);
    const n = a ? parseInt(a.answer, 10) : NaN;
    return { answer: Number.isInteger(n) && n >= -1 && n < q.options.length ? n : null, working: String(a?.working || '').slice(0, 1200) };
  });
}


/* Every exercise is solved again independently (no answer key, no course text). When that solve disagrees,
   it is solved a third time with the options reordered:
   - the two fresh solves agree → the answer key is corrected to their answer, with their working as the explanation;
   - the third solve agrees with the original → kept as it was;
   - no two agree → dropped. If the check itself fails (network, limits), the questions are kept. */
async function verifyAnswers(questions) {
  const toCheck = questions.filter(q => q.qtype === 'exercise' && !q.figurePage);
  if (!toCheck.length) return { questions, unconfirmed: 0, corrected: 0 };
  let first;
  try { first = await aiSolve(toCheck); }
  catch (e) { console.warn('Answer check failed; keeping the questions', e); return { questions, unconfirmed: 0, corrected: 0 }; }
  const disputed = toCheck.map((q, k) => ({ q, r: first[k] })).filter(({ q, r }) => r.answer !== null && r.answer !== q.answer);
  if (!disputed.length) return { questions, unconfirmed: 0, corrected: 0 };
  let second = null;
  try { second = await aiSolve(disputed.map(d => d.q), { reshuffle: true }); }
  catch (e) { console.warn('Second answer check failed', e); }
  const drop = new Set();
  let corrected = 0;
  disputed.forEach(({ q, r }, k) => {
    const s = second && second[k];
    if (s && r.answer >= 0 && s.answer === r.answer) {
      q.answer = r.answer;
      q.explanation = (s.working || r.working || '').trim();
      corrected++;
    } else if (!(s && s.answer === q.answer)) drop.add(q);
  });
  return { questions: questions.filter(q => !drop.has(q)), unconfirmed: drop.size, corrected };
}

/* Turns "figurePage" into an embedded JPEG of that page's picture (needs the original PDF file). */
async function attachFigures(subject, questions) {
  const chs = subjectChapters(subject);
  let added = 0;
  for (const q of questions) {
    const page = q.figurePage;
    delete q.figurePage;
    if (!page || added >= 8) continue;
    const ch = chs.find(c => c.name === q.chapter);
    const doc = ch && subject.docs.find(d => d.id === ch.docId);
    if (!doc || !doc.hasPdf || page > doc.pages) continue;
    try {
      const fig = await figureFromPage(doc.id, page);
      if (fig) { q.figure = { src: fig.src, caption: `Page ${page} of ${doc.name.replace(/\.pdf$/i, '')}`, page }; added++; }
    } catch (e) { console.warn('Could not draw page', page, e); }
  }
}

/* AI summary of what went wrong in an attempt. Chapter numbers are computed locally. */
async function aiReviewAttempt(quiz, attempt) {
  const subject = subjectById(quiz.subjectId);
  const missed = quiz.questions.map((q, i) => ({ q, i })).filter(({ q, i }) => attempt.answers[i] !== q.answer);
  const perChapter = attemptChapterStats(quiz, attempt);
  const prompt = `A student just took a quiz on "${subject?.name || 'a subject'}" and scored ${attempt.score}%.
Per-chapter results: ${JSON.stringify(perChapter.map(c => ({ chapter: c.chapter, correct: c.correct, total: c.total })))}

Questions they got wrong:
${missed.map(({ q, i }) => `- [${q.chapter}] ${q.question}${exhibitText(q) ? `\n  Shown with it: ${exhibitText(q).replace(/\n/g, '\n    ')}` : ''}
  Their answer: ${attempt.answers[i] == null ? '(skipped)' : q.options[attempt.answers[i]]}
  Correct answer: ${q.options[q.answer]}`).join('\n') || '(none)'}

Explain where they went wrong. Speak directly to the student ("you"), be specific about concepts and misconceptions, and stay brief.
${MATH_JSON}
Return: {"summary": "2-4 sentences overall", "chapters": [{"chapter": "chapter name exactly as given", "diagnosis": "what went wrong in this chapter", "tip": "one concrete thing to review"}], "focus": ["3-5 short topic phrases to review"]}
Only include chapters where they made mistakes.`;

  const out = await groqChat([{ role: 'system', content: SYS_TEACHER }, { role: 'user', content: prompt }], { temperature: 0.4, maxTokens: 1500 });
  const names = perChapter.map(c => c.chapter);
  return {
    summary: String(out.summary || ''),
    chapters: (out.chapters || []).map(c => ({ chapter: matchChapter(c.chapter, names), diagnosis: String(c.diagnosis || ''), tip: String(c.tip || '') })),
    focus: (out.focus || []).map(String).slice(0, 6),
  };
}

function attemptChapterStats(quiz, attempt) {
  const m = {};
  quiz.questions.forEach((q, i) => {
    const k = q.chapter || 'General';
    m[k] = m[k] || { chapter: k, correct: 0, total: 0 };
    m[k].total++;
    if (attempt.answers[i] === q.answer) m[k].correct++;
  });
  return Object.values(m).map(c => ({ ...c, pct: Math.round(c.correct / c.total * 100) }));
}

/* ---------- flashcards ---------- */

async function aiGenerateCards(subject, { count = 12, chapters = null, missed = [], broadRatio = 0.35, context: givenContext = null }) {
  const names = subjectChapters(subject).map(c => c.name);
  const existing = cardsFor(subject.id).map(c => c.front).slice(-50);
  // Targeted decks pull material from the missed chapters plus everything else (for the broad cards).
  // A given context (e.g. the student's notes) replaces the PDF material.
  const context = givenContext ? givenContext.slice(0, S.settings.contextChars * 1.5) : await buildContext(subject, { chapters, budget: S.settings.contextChars });
  if (!context.trim()) throw new Error('This subject has no readable material yet. Upload a PDF first.');

  let task;
  if (missed.length) {
    const broad = Math.max(2, Math.round(count * broadRatio));
    const targeted = Math.max(missed.length, count - broad);
    task = `Create ${targeted + broad} flashcards in two groups.
Group A (kind "targeted", ${targeted} cards): target the concepts behind these questions the student got wrong. Do not copy the question word for word; test the underlying idea from a slightly different angle so the student really learns it.
${missed.map(m => `- [${m.chapter}] ${m.question} (correct answer: ${m.correctAnswer})`).join('\n')}
Group B (kind "broad", ${broad} cards): broader questions about other important ideas in the same subject, to keep review fresh.`;
  } else {
    task = `Create ${count} flashcards (kind "core") covering the most important ideas in the material, spread across the chapters.`;
  }

  const prompt = `${task}
Rules:
- Front: one clear question or prompt. Back: a short, complete answer (1-3 sentences or a short list).
- Use only facts from the study material.
${CONTENT_ONLY.replace(/question/g, 'card')}
- "chapter" must be copied exactly from: ${JSON.stringify(names)}
- Do not repeat these existing cards: ${JSON.stringify(existing)}

${MATH_JSON}
Return: {"cards": [{"front": "...", "back": "...", "chapter": "...", "kind": "targeted|broad|core"}]}

STUDY MATERIAL:
${context}`;

  const out = await groqChat([{ role: 'system', content: SYS_TEACHER }, { role: 'user', content: prompt }],
    { temperature: 0.8, maxTokens: Math.min(8000, 300 + count * 160) });
  const seen = new Set(existing.map(f => f.toLowerCase().trim()));
  const cards = (out.cards || []).filter(c => c && c.front && c.back && !isMetaQuestion(dropSourcePrefix(String(c.front)))).map(c => ({
    id: uid(), subjectId: subject.id,
    front: dropSourcePrefix(String(c.front)), back: String(c.back),
    chapter: matchChapter(c.chapter, names),
    kind: ['targeted', 'broad', 'core'].includes(c.kind) ? c.kind : (missed.length ? 'broad' : 'core'),
    status: 'new', reviews: 0, createdAt: Date.now(),
  })).filter(c => { const k = c.front.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!cards.length) throw new Error('The AI did not return usable flashcards. Try again.');
  return cards;
}

/* ---------- notes ---------- */

const NOTE_STYLE_PROMPTS = {
  outline: `Write a hierarchical outline: one "## " heading per chapter, "### " headings for main topics, and nested "- " bullets (indent sub-points by two spaces). Keep bullets short.`,
  cornell: `Write Cornell notes. For each chapter: a "## " heading, then a markdown table with two columns "| Cue | Notes |" where each Cue is a short question or keyword and Notes holds the concise facts that answer it, then a line starting with "**Summary:**" giving 2-3 sentences.`,
  summary: `Write a one-page summary sheet with these sections: "## Key ideas" (bullets), "## Key terms" (a markdown table "| Term | Meaning |"), "## Facts and formulas" (only if the material has any), "## Common mistakes" (bullets), "## Quick self-test" (5 numbered questions, answers in parentheses at the end of each).`,
  qa: `Write the notes as questions and answers. For each chapter: a "## " heading, then pairs written as "**Q:** question" on one line and "A: answer" on the next line, with a blank line between pairs. Order them from basic to harder.`,
};

async function aiGenerateNotes(subject, { style = 'outline', chapters = null, input = '', length = 'medium', useGuide = true }) {
  const all = subjectChapters(subject);
  const names = (chapters ? all.filter(c => chapters.includes(c.name)) : all).map(c => c.name);
  const context = await buildContext(subject, { chapters, budget: S.settings.contextChars });
  if (!context.trim()) throw new Error('This subject has no readable material yet. Upload a PDF first.');

  let guideTxt = '';
  if (useGuide) {
    const g = studyGuideFor(subject);
    const lines = [];
    if (g.exam) {
      lines.push(`Exam: "${g.exam.title}" on ${g.exam.date} (${relDays(g.exam.date)}).`);
      const ses = (g.exam.plan?.sessions || []).filter(x => !x.done && x.chapters.some(c => names.includes(c))).slice(0, 6);
      if (ses.length) lines.push('Upcoming study sessions: ' + ses.map(x => `${x.date} ${x.type} (${x.chapters.join(', ')})`).join('; '));
    }
    if (g.weak.length) lines.push('Weakest chapters by quiz score: ' + g.weak.map(c => `${c.chapter} ${c.pct}%`).join(', '));
    if (g.diagnoses.length) lines.push('Mistakes the student made: ' + g.diagnoses.join(' | '));
    if (g.focus.length) lines.push('Topics to review: ' + g.focus.join(', '));
    if (lines.length) guideTxt = `\nSTUDY GUIDE (give extra space and a "**Watch out:**" line to these weak areas):\n${lines.join('\n')}\n`;
  }

  const size = { short: 'about 300-450 words', medium: 'about 600-900 words', detailed: 'about 1200-1800 words' }[length];
  const prompt = `Create study notes for "${subject.name}" covering: ${names.join(', ')}.
${NOTE_STYLE_PROMPTS[style] || NOTE_STYLE_PROMPTS.outline}
Length: ${size}.
- Use only facts from the study material. Be accurate and concrete; include definitions, examples and numbers from the text.
- Bold key terms with **term**. Wrap the 5-10 most exam-critical facts in ==double equals== so they show as highlighted.
- Use plain markdown only: # and ## headings, - bullets, 1. numbered lists, | tables |, **bold**. No HTML, no code fences.
${MATH_MD}
${input ? `\nSTUDENT'S INPUT (follow it: if it contains their own notes, merge them in and fix anything that is wrong, marking fixes with "(corrected)"; if it is a request, do what it asks):\n"""${input.slice(0, 4000)}"""\n` : ''}${guideTxt}
Start your answer with one line "# " followed by a short title for these notes, then the notes.

STUDY MATERIAL:
${context}`;

  const maxTokens = { short: 1200, medium: 2400, detailed: 4500 }[length];
  let text = await groqChat([{ role: 'system', content: 'You are an expert teacher who writes clear, well-structured study notes in markdown. You only use facts from the material you are given.' }, { role: 'user', content: prompt }],
    { json: false, temperature: 0.4, maxTokens });
  text = text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
  const m = text.match(/^#\s+(.+)\n?/);
  const title = (m ? m[1] : `${subject.name} notes`).replace(/[*_=#]/g, '').trim().slice(0, 100);
  const markdown = (m ? text.slice(m[0].length) : text).trim();
  if (markdown.length < 40) throw new Error('The AI returned empty notes. Try again.');
  return { title, markdown };
}

/* ---------- chapter outline ---------- */

async function aiOutline(pages) {
  const n = pages.length;
  const per = clamp(Math.floor(7000 / n), 60, 260);
  const listing = pages.map((p, i) => `[p${i + 1}] ${p.replace(/\s+/g, ' ').slice(0, per)}`).join('\n');
  const prompt = `Below is the start of each page of a ${n}-page study document. Identify its chapters or main sections in order.
Return: {"chapters": [{"title": "short chapter title (keep any chapter number)", "startPage": 1}]}
Rules: startPage is the page where the chapter begins; the first chapter starts at page 1 (use "Introduction" if needed); between 1 and 30 chapters; ignore tables of contents, headers and footers.

${listing}`;
  const out = await groqChat([{ role: 'system', content: 'You structure documents. Answer only with JSON.' }, { role: 'user', content: prompt }], { temperature: 0.1, maxTokens: 2000 });
  return out.chapters || [];
}

/* ---------- study plan ---------- */

async function aiStudyPlan(exam) {
  const subject = subjectById(exam.subjectId);
  const today = todayISO();
  const left = daysBetween(today, exam.date);
  if (left < 1) throw new Error('The exam date has to be after today to build a plan.');
  const lastDay = addDays(exam.date, -1);
  const chs = subjectChapters(subject).map(c => ({ chapter: c.name, pages: c.end - c.start + 1 }));
  if (!chs.length) throw new Error(`Upload a PDF to "${subject.name}" first so the plan knows what to cover.`);
  const weak = chapterStats(subject.id).filter(c => c.total >= 2).sort((a, b) => a.pct - b.pct).map(c => ({ chapter: c.chapter, score: c.pct + '%' }));
  const cards = cardsFor(subject.id);

  const prompt = `Plan exam preparation for a student.
Today: ${today} (${fmtDate(today, { weekday: 'long' })}). Exam: "${exam.title}" on ${exam.date} (${left} days away).
Subject: ${subject.name}. Chapters and size: ${JSON.stringify(chs)} (total ${chs.reduce((s, c) => s + c.pages, 0)} pages).
Past quiz scores by chapter (weakest first): ${weak.length ? JSON.stringify(weak) : 'none yet'}.
Flashcards: ${cards.length} total, ${cards.filter(c => c.status === 'again').length} still marked "again".

Decide:
1. startDate: the best day to begin review. Use the amount of material (roughly 10-20 pages a session) and the scores. Do not start wastefully early, but leave enough time for spaced repetition. If the exam is close, start today.
2. sessions between startDate and ${lastDay}, at most 2 per day, following spaced repetition:
   - "read": first pass over one or two chapters.
   - "flashcards": review chapters already read, at growing intervals (e.g. 1, 3, 7 days later).
   - "quiz": a practice quiz on a group of chapters once they have been read and reviewed.
   - "test": one full mock test on all chapters 2-3 days before the exam (if there is room).
   - Give weak chapters more sessions. Keep the last day light: flashcards on weak spots.
Every chapter name must be copied exactly from the list. Dates are YYYY-MM-DD.

Return: {"startDate": "YYYY-MM-DD", "rationale": "2-3 sentences explaining why this start date and rhythm", "sessions": [{"date": "YYYY-MM-DD", "type": "read|flashcards|quiz|test", "chapters": ["..."], "minutes": 30, "note": "one short instruction"}]}`;

  const out = await groqChat([{ role: 'system', content: 'You are an expert study coach who applies spaced repetition and retrieval practice. Answer only with JSON.' }, { role: 'user', content: prompt }],
    { temperature: 0.3, maxTokens: 4000 });

  const names = chs.map(c => c.chapter);
  let start = isValidISO(out.startDate) ? out.startDate : today;
  if (start < today) start = today;
  if (start > lastDay) start = lastDay;
  const types = ['read', 'flashcards', 'quiz', 'test'];
  const sessions = (out.sessions || []).filter(s => isValidISO(s.date) && s.date >= today && s.date < exam.date).map(s => ({
    id: uid(),
    date: s.date,
    type: types.includes(s.type) ? s.type : 'flashcards',
    chapters: s.type === 'test' ? names.slice() : [...new Set((s.chapters || []).map(c => matchChapter(c, names)))],
    minutes: clamp(parseInt(s.minutes, 10) || 30, 10, 180),
    note: String(s.note || ''),
    done: false,
  })).sort((a, b) => a.date.localeCompare(b.date));
  if (!sessions.length) throw new Error('The AI did not return a usable plan. Try again.');
  return { startDate: sessions[0].date < start ? sessions[0].date : start, rationale: String(out.rationale || ''), sessions, builtAt: Date.now() };
}

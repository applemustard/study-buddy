/* Small hand-built charts: chapter score bars, score trend line, card progress bar. */

function scoreTone(pct) { return pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'bad'; }

/* Horizontal bars: one row per chapter, fill = % correct. */
function chapterBarsHTML(stats, { caption = '' } = {}) {
  if (!stats.length) return '<p class="muted">No results yet.</p>';
  const rows = stats.slice().sort((a, b) => a.pct - b.pct);
  return `<figure class="bars">
    ${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}
    ${rows.map(s => `
      <div class="bar-row" title="${esc(s.chapter)}: ${s.correct} of ${s.total} correct">
        <span class="bar-label">${esc(s.chapter)}</span>
        <span class="bar-track"><span class="bar-fill ${scoreTone(s.pct)}" style="width:${Math.max(s.pct, 2)}%"></span></span>
        <span class="bar-val"><b>${s.pct}%</b> <span class="muted">${s.correct}/${s.total}</span></span>
      </div>`).join('')}
  </figure>`;
}

/* Line chart of quiz scores over time. */
function trendSVG(points) {
  if (points.length < 2) return '';
  const W = 560, H = 150, P = { l: 34, r: 12, t: 12, b: 24 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const x = i => P.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = v => P.t + ih - (v / 100) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join('');
  const grid = [0, 50, 100].map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${v}%</text>`).join('');
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.score)}" r="4" class="dot ${scoreTone(p.score)}"><title>${esc(p.label)}: ${p.score}%</title></circle>`).join('');
  const first = points[0], last = points[points.length - 1];
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Quiz scores over time, from ${first.score}% to ${last.score}%">
    ${grid}
    <path d="${path}" class="line"/>
    ${dots}
    <text x="${x(0)}" y="${H - 6}" class="axis">${esc(first.date)}</text>
    <text x="${x(points.length - 1)}" y="${H - 6}" text-anchor="end" class="axis">${esc(last.date)}</text>
  </svg>`;
}

/* Stacked bar: got it / again / new. */
function progressStackHTML(cards) {
  const n = cards.length || 1;
  const got = cards.filter(c => c.status === 'got').length;
  const again = cards.filter(c => c.status === 'again').length;
  const fresh = cards.length - got - again;
  return `<div class="stack" role="img" aria-label="${got} got it, ${again} again, ${fresh} not studied">
      <span class="seg got" style="width:${got / n * 100}%"></span>
      <span class="seg again" style="width:${again / n * 100}%"></span>
      <span class="seg new" style="width:${fresh / n * 100}%"></span>
    </div>
    <div class="legend">
      <span><i class="sw got"></i>Got it ${got}</span>
      <span><i class="sw again"></i>Again ${again}</span>
      <span><i class="sw new"></i>Not studied ${fresh}</span>
    </div>`;
}

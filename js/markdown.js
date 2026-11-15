/* Small, safe markdown renderer for notes. Everything is escaped first; only known syntax becomes HTML.
   Supports: # headings, - / 1. lists (nested by indent), > quotes, | tables |, ---, **bold**, *italic*, `code`, ==highlight==. */

/* Math spans (\( \), \[ \], $$ $$) are set aside so markdown never touches the * _ | = inside formulas;
   KaTeX typesets them after the page renders. */
const MATH_SPAN = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g;
function protectMath(s) {
  const spans = [];
  return { text: String(s).replace(MATH_SPAN, m => `\u0000${spans.push(m) - 1}\u0000`), spans };
}
const restoreMath = (s, spans, escape = true) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => (escape ? esc(spans[i]) : spans[i]));

function mdInline(s) {
  const { text, spans } = protectMath(s);
  return restoreMath(esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>'), spans);
}

function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  const lists = []; // stack of {type, indent}
  let para = [];

  const flushPara = () => { if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para = []; } };
  const closeLists = (toIndent = -1) => {
    while (lists.length && lists[lists.length - 1].indent > toIndent) out.push(`</li></${lists.pop().type}>`);
  };
  const splitRow = l => {
    const { text, spans } = protectMath(l); // |x| inside a formula is not a column break
    return text.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => restoreMath(c.trim(), spans, false));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); closeLists(); continue; }

    let m;
    if ((m = line.match(/^\s{0,3}(#{1,4})\s+(.*)$/))) {
      flushPara(); closeLists();
      const lvl = Math.min(4, m[1].length + 1);
      out.push(`<h${lvl}>${mdInline(m[2].replace(/#+\s*$/, ''))}</h${lvl}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); closeLists(); out.push('<hr>'); continue; }

    if ((m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
      flushPara();
      const indent = m[1].replace(/\t/g, '    ').length;
      const type = /\d/.test(m[2]) ? 'ol' : 'ul';
      const top = lists[lists.length - 1];
      if (!top || indent > top.indent) {
        lists.push({ type, indent });
        out.push(`<${type}><li>${mdInline(m[3])}`);
      } else {
        closeLists(indent);
        const cur = lists[lists.length - 1];
        if (cur && cur.type === type) out.push(`</li><li>${mdInline(m[3])}`);
        else {
          if (cur) out.push(`</li></${lists.pop().type}>`);
          lists.push({ type, indent });
          out.push(`<${type}><li>${mdInline(m[3])}`);
        }
      }
      continue;
    }

    // Table: a row of pipes followed by a separator row.
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushPara(); closeLists();
      const head = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      i--;
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${mdInline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td>${mdInline(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if ((m = line.match(/^\s*>\s?(.*)$/))) {
      flushPara(); closeLists();
      const q = [m[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) q.push(lines[++i].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${q.map(mdInline).join('<br>')}</blockquote>`);
      continue;
    }

    // Continuation of a list item, or a paragraph line.
    if (lists.length && /^\s+\S/.test(line)) { out.push(' ' + mdInline(line.trim())); continue; }
    closeLists();
    para.push(line.trim());
  }
  flushPara(); closeLists();
  return out.join('');
}

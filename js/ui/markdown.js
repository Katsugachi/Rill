// Safe Markdown → DOM renderer. Builds nodes with createElement/textContent
// only; there is no innerHTML anywhere, so model or file text can never become
// markup. Links are restricted to http(s)/mailto and open in a new tab.

const SAFE_URL = /^(https?:|mailto:)/i;

export function safeHref(url) {
  try {
    const u = new URL(String(url).trim(), 'https://invalid.local/');
    if (!SAFE_URL.test(u.protocol) || u.hostname === 'invalid.local') return null;
    return u.href;
  } catch { return null; }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Inline: `code`, **bold**, *em*/_em_, ~~del~~, [text](url), bare URLs.
const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^\s*][\s\S]*?)\*|(?<![\w])_([^\s_][\s\S]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/;

export function renderInline(text, parent, depth = 0) {
  let rest = String(text);
  while (rest) {
    const m = depth > 6 ? null : INLINE.exec(rest);
    if (!m) { parent.append(rest); break; }
    if (m.index) parent.append(rest.slice(0, m.index));
    if (m[1]) parent.append(el('code', 'md-code', m[2]));
    else if (m[3] || m[4]) renderInline(m[3] || m[4], parent.appendChild(el('strong')), depth + 1);
    else if (m[5]) renderInline(m[5], parent.appendChild(el('del')), depth + 1);
    else if (m[6] || m[7]) renderInline(m[6] || m[7], parent.appendChild(el('em')), depth + 1);
    else if (m[8]) {
      const href = safeHref(m[9]);
      if (href) renderInline(m[8], parent.appendChild(link(href)), depth + 1);
      else parent.append(m[0]);
    } else if (m[10]) {
      const href = safeHref(m[10]);
      parent.append(href ? link(href, m[10]) : m[10]);
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return parent;
}

function link(href, text) {
  const a = el('a', 'md-link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer nofollow';
  a.referrerPolicy = 'no-referrer';
  return a;
}

function codeBlock(lang, code, opts) {
  const wrap = el('figure', 'md-pre');
  const bar = el('figcaption', 'md-pre-bar');
  bar.append(el('span', 'md-pre-lang', lang || 'text'));
  const copy = el('button', 'md-copy', 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
  });
  bar.append(copy);
  const pre = el('pre');
  pre.append(el('code', lang ? 'lang-' + lang.replace(/[^\w-]/g, '') : '', code));
  wrap.append(bar, pre);
  return wrap;
}

const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function renderMarkdown(src, opts = {}) {
  const root = el('div', 'md');
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) { root.append(renderInline(para.join('\n'), el('p'))); para = []; }
  };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line))) {
      flush();
      const fence = m[1];
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++;
      root.append(codeBlock(m[2], buf.join('\n'), opts));
      continue;
    }
    if ((m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line))) {
      flush();
      const level = Math.min(m[1].length + 1, 6); // h1 is reserved for the app
      root.append(renderInline(m[2], el('h' + level, 'md-h')));
      i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); root.append(el('hr')); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      const q = el('blockquote');
      q.append(...renderMarkdown(buf.join('\n'), opts).childNodes);
      root.append(q);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const table = el('table', 'md-table');
      const head = table.appendChild(el('thead')).appendChild(el('tr'));
      for (const c of cells(line)) head.append(renderInline(c, el('th')));
      const body = table.appendChild(el('tbody'));
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const tr = body.appendChild(el('tr'));
        for (const c of cells(lines[i++])) tr.append(renderInline(c, el('td')));
      }
      const scroll = el('div', 'md-table-wrap');
      scroll.append(table);
      root.append(scroll);
      continue;
    }
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line))) {
      flush();
      const ordered = /\d/.test(m[2]);
      const list = el(ordered ? 'ol' : 'ul');
      if (ordered) { const start = parseInt(m[2], 10); if (start > 1) list.start = start; }
      while (i < lines.length && (m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])) && /\d/.test(m[2]) === ordered) {
        let text = m[3];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) text += ' ' + lines[i++].trim();
        const li = el('li');
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
        if (task) {
          li.className = 'md-task' + (task[1] !== ' ' ? ' done' : '');
          const box = el('span', 'md-check');
          box.setAttribute('aria-hidden', 'true');
          li.append(box);
          renderInline(task[2], li.appendChild(el('span')));
          li.setAttribute('aria-label', (task[1] !== ' ' ? 'Done: ' : 'To do: ') + task[2]);
        } else renderInline(text, li);
        list.append(li);
      }
      root.append(list);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line);
    i++;
  }
  flush();
  return root;
}

// Mini Markdown renderer for the guide intent/overview texts, with the page language typography fixes.

import { esc } from './dom.js';
import { T, typography } from './strings.js';

export function inline(src) {
  return src
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
      return typography(esc(part))
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(
          /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
        );
    })
    .join('');
}

export function md(src) {
  const lines = String(src || '')
    .replace(/\r/g, '')
    .split('\n');
  const out = [];
  let i = 0;
  const isBlockStart = (l) =>
    /^```/.test(l) || /^>/.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l) || /^#{1,6}\s/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="md-code"><code>${esc(body.join('\n'))}</code></pre>`);
    } else if (/^>/.test(line)) {
      const body = [];
      while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      const m = /^\[!(IMPORTANT|WARNING|NOTE|TIP|CAUTION)\]\s*$/i.exec(body[0] || '');
      if (m) {
        const kind = m[1].toLowerCase();
        const title = T.callouts[kind];
        out.push(
          `<div class="callout callout-${kind}"><div class="callout-title">${title}</div>${md(body.slice(1).join('\n'))}</div>`,
        );
      } else {
        out.push(`<blockquote>${md(body.join('\n'))}</blockquote>`);
      }
    } else if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      const items = [];
      while (i < lines.length && re.test(lines[i])) {
        let item = lines[i++].replace(re, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    } else if (/^#{1,6}\s/.test(line)) {
      out.push(`<h4>${inline(line.replace(/^#+\s/, ''))}</h4>`);
      i++;
    } else if (!line.trim()) {
      i++;
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('');
}

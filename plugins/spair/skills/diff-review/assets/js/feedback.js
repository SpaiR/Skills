// Builds the feedback Markdown sent back to the Claude Code session.

import { quote } from './lines.js';
import { fileByPath, R, S, sections } from './state.js';
import { T } from './strings.js';

export function fence(text, lang) {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map((s) => s.length));
  const f = '`'.repeat(longest + 1);
  return `${f}${lang || ''}\n${text}\n${f}`;
}

// head: extra list lines after the range (the publish dialog adds the chosen action).
export function buildMarkdown(action, head = []) {
  const g = R.guide,
    m = R.meta;
  const out = [];
  out.push(T.feedback.title(action, g.title), '');
  out.push(T.feedback.range(T.rangeLabel(m)));
  out.push(...head);
  out.push(m.pr ? T.feedback.pr(m.pr) : T.feedback.repo(m.root, m.branch));
  out.push('');
  if (S.globalComment.trim()) out.push(T.feedback.global, '', S.globalComment.trim(), '');

  sections.forEach((sec, i) => {
    const c = S.sectionComments[sec.key];
    if (c && c.trim()) out.push(T.feedback.chapter(sec.synthetic ? null : i + 1, sec.title), '', c.trim(), '');
  });

  const order = new Map(R.files.map((f, i) => [f.path, i]));
  const notes = [...S.annotations].sort(
    (a, b) => (order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9) || a.start - b.start,
  );
  for (const a of notes) {
    const file = fileByPath.get(a.file);
    out.push(`## \`${a.file}\`, ${T.lineRange(a.start, a.end)} (${T.side(a.side)})`, '');
    if (file) {
      const quoted = quote(file, a.side, a.start, a.end)
        .slice(0, 20)
        .map((l) => (l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' ') + l.s)
        .join('\n');
      if (quoted) out.push(fence(quoted, 'diff'), '');
    }
    if (a.text) out.push(a.text, '');
    if (a.suggestion) out.push(T.feedback.suggestion, '', fence(a.suggestion, 'suggestion'), '');
  }
  return out.join('\n').trim();
}

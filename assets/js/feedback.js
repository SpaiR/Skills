// Builds the feedback Markdown sent back to the Claude Code session.

import { fileByPath, R, S, sections } from './state.js';
import { rangeLabel, sideLabel } from './dom.js';
import { quote } from './lines.js';

function fence(text, lang) {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map((s) => s.length));
  const f = '`'.repeat(longest + 1);
  return `${f}${lang || ''}\n${text}\n${f}`;
}

export function buildMarkdown(action) {
  const g = R.guide, m = R.meta;
  const out = [];
  out.push(`# ${action === 'approve' ? 'Ревью одобрено' : 'Фидбек по ревью'}: ${g.title}`, '');
  out.push(`- Диапазон: ${m.label}`);
  out.push(`- Репозиторий: \`${m.root}\`${m.branch ? `, ветка \`${m.branch}\`` : ''}`);
  out.push('');
  if (S.globalComment.trim()) out.push('## Общий комментарий', '', S.globalComment.trim(), '');

  sections.forEach((sec, i) => {
    const c = S.sectionComments[sec.key];
    if (c && c.trim()) out.push(`## Глава ${sec.synthetic ? '' : `${i + 1}. `}${sec.title}`, '', c.trim(), '');
  });

  const order = new Map(R.files.map((f, i) => [f.path, i]));
  const notes = [...S.annotations].sort((a, b) =>
    (order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9) || a.start - b.start);
  for (const a of notes) {
    const file = fileByPath.get(a.file);
    out.push(`## \`${a.file}\`, ${rangeLabel(a)} (${sideLabel(a.side)})`, '');
    if (file) {
      const quoted = quote(file, a.side, a.start, a.end).slice(0, 20)
        .map((l) => (l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' ') + l.s).join('\n');
      if (quoted) out.push(fence(quoted, 'diff'), '');
    }
    if (a.text) out.push(a.text, '');
    if (a.suggestion) out.push('Предложенная замена:', '', fence(a.suggestion, 'suggestion'), '');
  }
  return out.join('\n').trim();
}

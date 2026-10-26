// Mouse selection of line ranges on the line numbers: click, Shift+click and drag.

import { fileByPath, finished, selection, ui } from './state.js';
import { lineAt, rangeOf } from './lines.js';
import { fileView } from './model.js';
import { paintSelection } from './diff.js';
import { openLineForm, refreshFiles } from './forms.js';

export function numLine(num) {
  const fileEl = num.closest('.file'), secEl = num.closest('.sec');
  const file = fileEl && fileByPath.get(fileEl.dataset.path);
  const line = file && lineAt(file, num.dataset.side, +num.dataset.no);
  return line ? { file, fileEl, sec: secEl.dataset.key, line } : null;
}

export function onMainMouseDown(e) {
  const num = e.button === 0 && !finished ? e.target.closest('td.num[data-no]') : null;
  if (!num) return;
  // Без выделения текста страницы и без потери фокуса.
  e.preventDefault();
  const hit = numLine(num);
  if (!hit) return;
  const { file, fileEl, sec, line } = hit;
  // У строки контекста комментарий всегда к новой версии, по какой бы цифре ни кликнули.
  const side = line.t === 'ctx' ? 'new' : num.dataset.side;
  const extend = e.shiftKey && selection && selection.anchor && selection.path === file.path && selection.sec === sec
    && !(ui.form && ui.form.editId);
  const anchor = extend ? selection.anchor : { li: line.i, side };
  ui.drag = { file, sec, fileEl, anchor, extend, range: rangeOf(file, anchor, line), row: num.closest('tr') };
  document.body.classList.add('dragging');
  paintSelection(fileEl, { side: ui.drag.range.side, start: ui.drag.range.start, end: ui.drag.range.end }, fileView(file) === 'split');
  document.addEventListener('mouseup', onDragEnd, { once: true });
}

export function onMainMouseOver(e) {
  const g = ui.drag;
  if (!g) return;
  const num = e.target.closest('td.num[data-no]');
  if (!num || !g.fileEl.contains(num)) return;
  const hit = numLine(num);
  if (!hit) return;
  const r = rangeOf(g.file, g.anchor, hit.line);
  g.row = num.closest('tr');
  if (r.side === g.range.side && r.start === g.range.start && r.end === g.range.end) return;
  g.range = r;
  paintSelection(g.fileEl, r, fileView(g.file) === 'split');
}

function onDragEnd() {
  const g = ui.drag;
  ui.drag = null;
  document.body.classList.remove('dragging');
  if (g && g.fileEl.isConnected) openLineForm(g.file, g.sec, g.range, g.anchor, g.extend, g.row);
}

export function cancelDrag() {
  const g = ui.drag;
  ui.drag = null;
  document.body.classList.remove('dragging');
  document.removeEventListener('mouseup', onDragEnd);
  if (g) refreshFiles([g.file.path]);
}

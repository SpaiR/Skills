// File card: header, summary, collapsed note and the diff body.

import { NOTES } from './constants.js';
import { guideOf, ui } from './state.js';
import { basename, dirname, fileDomId, h, icon, plural } from './dom.js';
import { inline } from './markdown.js';
import { canExpand, expandReason, isWhole } from './expand.js';
import { collapseReason, fileComments, fileOpen, isViewed } from './model.js';
import { statPair, statusBadge } from './toc.js';
import { renderDiff } from './diff.js';

function renderPath(file) {
  const parts = [];
  if (file.oldPath) parts.push(h('span', { class: 'p-old' }, h('span', { class: 'p-old-dir' }, dirname(file.oldPath)), h('span', { class: 'p-old-name' }, basename(file.oldPath))), h('span', { class: 'p-arrow' }, '→'));
  parts.push(h('span', { class: 'p-dir' }, dirname(file.path)), h('span', { class: 'p-name' }, basename(file.path)));
  return h('span', { class: 'path' }, parts);
}

// "Whole file" is offered for modified files with hunks. Added and deleted files already show the whole file in the diff.
export function wholeButton(file) {
  if (file.binary || !file.baseHunks.length || file.status === 'added' || file.status === 'deleted') return null;
  const ok = canExpand(file), on = ok && isWhole(file);
  return h('button', {
    class: 'btn sm ghost whole-btn', type: 'button', dataset: { act: 'whole-file' },
    'aria-pressed': String(on), 'aria-keyshortcuts': 'E', disabled: !ok,
    title: ok ? (on ? 'Показать только изменения и раскрытое (E)' : 'Показать весь файл (E)') : expandReason(file),
  }, icon('expand-all'), h('span', { class: 'whole-text' }, 'Весь файл'));
}

export function renderFile(file, sec) {
  const open = fileOpen(file);
  const viewed = isViewed(file);
  const g = sec && sec.headless ? guideOf.get(file.path) : null;
  const d = sec && !sec.headless && sec.diffs.find((x) => x.file === file.path);
  const summary = g ? g.summary : d && d.summary;
  const count = fileComments(file.path);
  const current = ui.curFile && ui.curFile.path === file.path && sec && ui.curFile.sec === sec.key;
  const head = h('div', { class: `file-head${current ? ' is-current' : ''}`, dataset: { anchor: `fh:${sec ? sec.key : ''}:${file.path}` } },
    // A level-3 heading: screen reader heading navigation reaches the files.
    h('div', { class: 'file-h', role: 'heading', 'aria-level': '3' },
      h('button', { class: 'file-toggle', type: 'button', 'aria-expanded': String(open), 'aria-keyshortcuts': 'O', dataset: { act: 'toggle-file' }, title: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path },
        icon('chevron', 'chev'), statusBadge(file), renderPath(file))),
    count > 0 && h('button', { class: 'badge comments', type: 'button', dataset: { act: 'first-note' }, title: plural(count, NOTES) }, icon('comment'), String(count)),
    open && wholeButton(file),
    h('span', { class: 'file-stat' }, statPair(file.additions, file.deletions, file.binary)),
    h('label', { class: 'viewed' },
      h('input', { type: 'checkbox', class: 'check', checked: viewed, dataset: { act: 'file-viewed' }, 'aria-label': `Просмотрено: ${file.path}`, 'aria-keyshortcuts': 'V' }),
      h('span', { class: 'viewed-text' }, 'Просмотрено')));

  const box = h('div', {
    class: `file${viewed ? ' is-viewed' : ''}${open ? '' : ' collapsed'}`, id: fileDomId(file.path),
    dataset: { path: file.path, anchor: `f:${sec ? sec.key : ''}:${file.path}` },
    hidden: !!(sec && sec.headless && ui.visible && !ui.visible.has(file.path)),
  }, head);
  // In Files mode, a file from a chapter shows the chapter number and title: a jump to the file in the guide.
  if (g && g.sec) {
    box.append(h('div', { class: 'file-summary with-chip' },
      h('button', { class: 'sec-chip', type: 'button', dataset: { act: 'to-guide' }, title: 'Открыть этот файл в гайде' },
        g.sec.synthetic ? g.sec.title : `Глава ${g.sec.idx + 1} · ${g.sec.title}`),
      summary && h('span', { html: inline(summary) })));
  } else if (summary) box.append(h('div', { class: 'file-summary', html: inline(summary) }));
  if (!open) {
    const reason = collapseReason(file);
    if (reason) {
      box.append(h('div', { class: 'collapsed-note' }, h('span', {}, reason.text),
        !reason.noShow && h('button', { class: 'btn sm ghost', type: 'button', dataset: { act: 'show-file' } }, 'Показать')));
    }
    return box;
  }
  if (file.binary) box.append(h('div', { class: 'file-empty' }, 'Бинарный файл — содержимое не показывается'));
  else if (!file.hunks.length) box.append(h('div', { class: 'file-empty' }, 'Содержимое не менялось (переименование или смена прав).'));
  else box.append(renderDiff(file, sec));
  return box;
}

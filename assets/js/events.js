// Delegated click and change handlers of #main, and the actions they trigger.

import { $main } from './dom.js';
import { expandGap, isWhole, setWholeFile } from './expand.js';
import { continueDraft, deleteDraft, deleteNote, lineRowBefore, openEditForm, openLineForm } from './forms.js';
import { updateChrome } from './header.js';
import { rangeOf } from './lines.js';
import { fileOpen, groupFor, groups, sectionOpen } from './model.js';
import { setMode } from './modes.js';
import { jumpToFile, jumpToSection, scrollToElement } from './nav.js';
import { save } from './persist.js';
import { fileQ, rerenderFile, rerenderSection, secQ, stickyOffset, withAnchor } from './rerender.js';
import { closeSectionComment, deleteSectionComment, openSectionComment } from './section.js';
import { numLine } from './selection.js';
import { fileByPath, finished, S, secByKey, sections, ui } from './state.js';
import { resetFilter } from './tree.js';
import { setFileViewed, setSectionViewed } from './viewed.js';

export function onMainClick(e) {
  if (finished) return;
  const num = e.target.closest('td.num[data-no]');
  if (num) {
    // The mouse is handled by mousedown/mouseup; only a non-mouse activation of the "+" button gets here.
    if (e.detail !== 0) return;
    const hit = numLine(num);
    if (!hit) return;
    const side = hit.line.t === 'ctx' ? 'new' : num.dataset.side;
    const anchor = { li: hit.line.i, side };
    openLineForm(hit.file, hit.sec, rangeOf(hit.file, anchor, hit.line), anchor, false, num.closest('tr'));
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.tagName === 'INPUT') return;
  const act = btn.dataset.act;
  const secEl = btn.closest('.sec');
  const sec = secEl && secByKey.get(secEl.dataset.key);
  const fileEl = btn.closest('.file');
  const file = fileEl && fileByPath.get(fileEl.dataset.path);
  if (act === 'toggle-sec') {
    toggleSection(sec, btn.closest('.sec-head'));
    const again = $main().querySelector(`${secQ(sec.key)} .sec-toggle`);
    if (again && e.detail === 0) again.focus({ preventScroll: true });
  } else if (act === 'toggle-file' || act === 'show-file') {
    toggleFile(file, sec, act === 'show-file' ? true : !fileOpen(file));
    const again = $main().querySelector(`${fileQ(sec.key, file.path)} .file-toggle`);
    if (again && (e.detail === 0 || act === 'toggle-file')) again.focus({ preventScroll: true });
  } else if (act === 'to-guide') {
    setMode('guide', file.path);
  } else if (act === 'filter-reset') {
    resetFilter();
  } else if (act === 'gap') {
    expandGap(btn, e.detail === 0);
  } else if (act === 'whole-file') {
    setWholeFile(file, !isWhole(file));
  } else if (act === 'goto-file') {
    jumpToFile(btn.dataset.path, btn.dataset.sec);
  } else if (act === 'sec-done') {
    const next = sections[sec.idx + 1];
    setSectionViewed(sec, true);
    if (next) jumpToSection(next.key);
  } else if (act === 'first-note') {
    const first = S.annotations.filter((a) => a.file === file.path).sort((a, b) => a.start - b.start)[0];
    if (first) goToNote(first.id, sec.key);
  } else if (act === 'note-edit') {
    const a = S.annotations.find((x) => x.id === btn.dataset.id);
    if (a) openEditForm(a, sec.key);
  } else if (act === 'note-delete') {
    deleteNote(btn.dataset.id);
  } else if (act === 'draft-continue') {
    continueDraft(btn.dataset.key, sec.key, lineRowBefore(btn));
  } else if (act === 'draft-delete') {
    deleteDraft(btn.dataset.key);
  } else if (act === 'sec-comment-edit') {
    openSectionComment(sec.key);
  } else if (act === 'sec-comment-done') {
    closeSectionComment();
  } else if (act === 'sec-comment-delete') {
    deleteSectionComment(sec.key);
  }
}

export function toggleSection(sec, keep) {
  S.sectionOpen[sec.key] = !sectionOpen(sec);
  save();
  withAnchor(() => rerenderSection(sec.key), keep);
  updateChrome();
}

export function toggleFile(file, sec, open) {
  S.fileOpen[file.path] = open;
  save();
  const head = $main().querySelector(`${fileQ(sec.key, file.path)} > .file-head`);
  withAnchor(() => rerenderFile(file.path), head);
  updateChrome();
}

// Expand the chapter and the file if collapsed, and scroll to the comment card, highlighting it.
export function goToNote(id, secKey) {
  const a = S.annotations.find((x) => x.id === id);
  const file = a && fileByPath.get(a.file);
  if (!file) return;
  const sec = groups().includes(secByKey.get(secKey)) ? secByKey.get(secKey) : groupFor(a.file);
  if (!sec) return;
  revealFile(file, sec);
  const q = `${fileQ(sec.key, file.path)} .note[data-id="${CSS.escape(id)}"]`;
  const note = $main().querySelector(q);
  if (!note) return;
  scrollToElement(() => $main().querySelector(q), stickyOffset() + 16);
  flash(note);
}

// Expand the chapter and the file so the lines can be reached.
export function revealFile(file, sec) {
  if (sec.headless && ui.visible && !ui.visible.has(file.path)) resetFilter();
  const changed = [];
  if (!sectionOpen(sec)) {
    S.sectionOpen[sec.key] = true;
    changed.push('sec');
  }
  if (!fileOpen(file)) {
    S.fileOpen[file.path] = true;
    changed.push('file');
  }
  if (!changed.length) return;
  save();
  withAnchor(() => {
    if (changed.includes('sec')) rerenderSection(sec.key);
    else rerenderFile(file.path);
  });
  updateChrome();
}

export function flash(el) {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
}

export function onMainChange(e) {
  const input = e.target;
  if (!input.matches('input[data-act]')) return;
  const secEl = input.closest('.sec');
  const sec = secEl && secByKey.get(secEl.dataset.key);
  if (input.dataset.act === 'sec-viewed') setSectionViewed(sec, input.checked, input.closest('.sec-head'));
  if (input.dataset.act === 'file-viewed') {
    const path = input.closest('.file').dataset.path;
    const closed = setFileViewed(fileByPath.get(path), input.checked, input.closest('.file-head'));
    // The chapter closed along with the file: focus goes to its header, otherwise to the same checkbox.
    const again = closed
      ? $main().querySelector(`${secQ(closed)} .sec-toggle`)
      : $main().querySelector(`${fileQ(sec.key, path)} input[data-act="file-viewed"]`);
    if (again && document.activeElement === document.body) again.focus({ preventScroll: true });
  }
}

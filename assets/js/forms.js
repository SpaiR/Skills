// Line comment form lifecycle: open, edit, close, drafts and deletion with undo.

import { draftKey, editKey, fitTextarea } from './comments.js';
import { $main } from './dom.js';
import { pinRange } from './expand.js';
import { updateChrome } from './header.js';
import { lineAt } from './lines.js';
import { save } from './persist.js';
import { fileQ, rerenderFile, stickyOffset, withAnchor } from './rerender.js';
import { closeSectionComment } from './section.js';
import { fileByPath, finished, L, S, selection, setSelection, ui } from './state.js';
import { T } from './strings.js';
import { toast } from './toast.js';

// Re-render the files where the form or the selection was or has appeared.
export function refreshFiles(paths, keep) {
  const set = new Set(paths.filter(Boolean));
  withAnchor(() => {
    for (const p of set) rerenderFile(p);
  }, keep);
  updateChrome();
}

// Bring the form into view: below the sticky headers and not below the window.
export function revealEditor(el) {
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  const top = (el.closest('.sec-aside') ? L.header + L.secHead : stickyOffset()) + 8;
  const r = el.getBoundingClientRect();
  if (r.top < top) window.scrollBy({ top: r.top - top, behavior: 'instant' });
}

function focusForm() {
  const ta = $main().querySelector('.annot-form textarea');
  if (!ta) return;
  fitTextarea(ta);
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(ta.value.length, ta.value.length);
  revealEditor(ta.closest('.editor'));
}

// New comment form on a range. extend: the range of the same form was extended, the draft moves with it.
// row is the table row the user worked with: it stays in place on screen.
export function openLineForm(file, secKey, range, anchor, extend, row) {
  if (finished) return;
  const prev = ui.form,
    prevSel = selection;
  if (ui.secForm) closeSectionComment();
  const key = draftKey(file.path, range.side, range.start, range.end);
  let sugOpen = false;
  if (extend && prev && !prev.editId && prev.path === file.path) {
    sugOpen = prev.sugOpen;
    if (prev.key !== key && S.drafts[prev.key]) {
      S.drafts[key] = { ...S.drafts[prev.key], side: range.side, start: range.start, end: range.end };
      delete S.drafts[prev.key];
      save();
    }
  }
  const d = S.drafts[key];
  pinRange(file, range);
  setSelection({ path: file.path, sec: secKey, ...range, anchor });
  ui.form = { key, path: file.path, sec: secKey, ...range, editId: null, sugOpen: sugOpen || !!(d && d.suggestion) };
  refreshFiles([prev && prev.path, prevSel && prevSel.path, file.path], row);
  focusForm();
}

export function openEditForm(a, secKey) {
  if (finished) return;
  const prev = ui.form,
    prevSel = selection;
  if (ui.secForm) closeSectionComment();
  const key = editKey(a.id),
    d = S.drafts[key];
  ui.form = {
    key,
    path: a.file,
    sec: secKey,
    side: a.side,
    start: a.start,
    end: a.end,
    editId: a.id,
    sugOpen: !!(d ? d.suggestion : a.suggestion),
  };
  setSelection({ path: a.file, sec: secKey, side: a.side, start: a.start, end: a.end, anchor: null });
  refreshFiles([prev && prev.path, prevSel && prevSel.path, a.file]);
  focusForm();
}

// Close the form: the text stays as a draft. focusBack: return focus from the form to the file header.
export function closeForm(focusBack) {
  const f = ui.form,
    sel = selection;
  if (!f && !sel) return;
  const active = document.activeElement;
  const hadFocus = focusBack && active && active.closest && active.closest('.annot-form');
  ui.form = null;
  setSelection(null);
  refreshFiles([f && f.path, sel && sel.path]);
  if (hadFocus && f) {
    const t = $main().querySelector(`${fileQ(f.sec, f.path)} .file-toggle`);
    if (t) t.focus({ preventScroll: true });
  }
}

// The diff row an element (card, draft) sits under: the scroll position is held by it.
export function lineRowBefore(el) {
  let tr = el && el.closest('tr');
  while (tr && !tr.matches('tr.ln')) tr = tr.previousElementSibling;
  return tr || null;
}

export function continueDraft(key, secKey, row) {
  const d = S.drafts[key];
  if (!d) return;
  if (d.editingId) {
    const a = S.annotations.find((x) => x.id === d.editingId);
    if (a) openEditForm(a, secKey);
    return;
  }
  const file = fileByPath.get(d.file);
  if (!file) return;
  const l = lineAt(file, d.side, d.start);
  openLineForm(
    file,
    secKey,
    { side: d.side, start: d.start, end: d.end },
    l ? { li: l.i, side: d.side } : null,
    false,
    row,
  );
}

export function deleteDraft(key) {
  const d = S.drafts[key];
  delete S.drafts[key];
  save();
  if (ui.form && ui.form.key === key) closeForm(true);
  else if (d) refreshFiles([d.file]);
}

export function deleteNote(id) {
  const idx = S.annotations.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const a = S.annotations[idx];
  const dk = editKey(id),
    d = S.drafts[dk];
  S.annotations.splice(idx, 1);
  delete S.drafts[dk];
  if (ui.form && ui.form.editId === id) {
    ui.form = null;
    setSelection(null);
  }
  save();
  refreshFiles([a.file]);
  toast(T.comments.deleted, {
    label: T.undo,
    run: () => {
      if (S.annotations.some((x) => x.id === id)) return;
      S.annotations.splice(Math.min(idx, S.annotations.length), 0, a);
      if (d && !S.drafts[dk]) S.drafts[dk] = d;
      save();
      refreshFiles([a.file]);
    },
  });
}

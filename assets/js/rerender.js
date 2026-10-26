// Targeted re-rendering of chapters and files while keeping the scroll anchor and input focus in place.

import { fileByPath, L, secByKey } from './state.js';
import { $main } from './dom.js';
import { groups, sectionOpen } from './model.js';
import { fileRow } from './toc.js';
import { renderSection } from './section.js';
import { renderFile } from './file.js';
import { FIELD_SIZING, fitTextarea } from './comments.js';

export const stickyOffset = () => L.header + L.secHead + L.fileHead;

export const secQ = (key) => `.sec[data-key="${CSS.escape(key)}"]`;
export const fileQ = (key, path) => `${secQ(key)} .file[data-path="${CSS.escape(path)}"]`;
// Top of a header in the flow: the card top plus its border. For a sticky header, rect does not show this position.
export const headTop = (box) => box.getBoundingClientRect().top + box.clientTop;
const topOf = (sel) => { const el = $main().querySelector(sel); return el ? headTop(el) : null; };

// Keeps an anchor point in place while fn() re-renders nodes. Anchors are tried in order:
// the first one found after re-rendering determines the scroll position. keep is the header the user worked
// with (clicked it, V, O): it stays where it was, even if it was sticky. Or the diff row whose
// number was clicked: the form opens under it, and a form above collapses into a draft.
export function withAnchor(fn, keep) {
  const anchors = collectAnchors(keep);
  fn();
  for (const a of anchors) {
    const now = a.find();
    if (now == null) continue;
    const delta = now - a.top;
    if (Math.abs(delta) >= 0.5) window.scrollBy({ top: delta, behavior: 'instant' });
    return;
  }
}

// File or chapter header. After re-rendering its place is the top of the container: the header comes first in the flow.
function headAnchor(head, top) {
  const box = head.parentElement;
  const key = head.closest('.sec').dataset.key;
  const sel = box.classList.contains('file') ? fileQ(key, box.dataset.path) : secQ(key);
  return { top: top == null ? headTop(box) : top, find: () => topOf(sel) };
}

// A diff row or a comment card. If the view changed, the row is looked up by the number of its side.
function rowAnchor(el) {
  const file = el.closest('.file'), sec = el.closest('.sec');
  const key = el.dataset.anchor;
  const num = el.matches('tr.ln') ? el.querySelector('td.num[data-no]') : null;
  const fsel = file && sec ? fileQ(sec.dataset.key, file.dataset.path) : null;
  return {
    top: el.getBoundingClientRect().top,
    find: () => {
      const same = $main().querySelector(`[data-anchor="${CSS.escape(key)}"]`);
      if (same) return same.getBoundingClientRect().top;
      const f = num && fsel && $main().querySelector(fsel);
      const n = f && f.querySelector(`td.num[data-side="${num.dataset.side}"][data-no="${num.dataset.no}"]`);
      return n ? n.closest('tr').getBoundingClientRect().top : null;
    },
  };
}

function collectAnchors(keep) {
  const main = $main();
  const vh = window.innerHeight;
  const out = [];
  if (keep && keep.isConnected) {
    const r = keep.getBoundingClientRect();
    if (keep.matches('tr.ln')) {
      if (r.bottom > L.header && r.top < vh) out.push(rowAnchor(keep));
    // A header hidden under the top bar does not count: the user can no longer see it.
    } else if (r.top >= L.header - 1 && r.top < vh) out.push(headAnchor(keep, r.top));
  }
  // The first element below the sticky headers (at the horizontal center of #main).
  const y = stickyOffset() + 2;
  if (y >= vh) return out;
  const mr = main.getBoundingClientRect();
  const hit = document.elementFromPoint(mr.left + mr.width / 2, y);
  const el = hit && main.contains(hit) ? hit.closest('[data-anchor]') : null;
  if (el && el.matches('tr.ln, .note, .draft-row, .annot-form')) out.push(rowAnchor(el));
  // Visible headers below: if the row under the point disappears (a chapter or file above was collapsed), they stay in place.
  for (const head of main.querySelectorAll('.sec-head, .file-head')) {
    const top = head.getBoundingClientRect().top;
    if (top < y - 2) continue;
    if (top >= vh) break;
    out.push(headAnchor(head));
  }
  // Last resort: the ancestors, the file and then the chapter.
  const file = el && el.closest('.file'), sec = el && el.closest('.sec');
  if (file) out.push(headAnchor(file.querySelector('.file-head')));
  const secHead = sec && sec.querySelector(':scope > .sec-head');
  if (secHead) out.push(headAnchor(secHead));
  return out;
}

export function rerenderSection(key) {
  const sec = secByKey.get(key);
  const old = $main().querySelector(`.sec[data-key="${CSS.escape(key)}"]`);
  if (!sec || !old) return;
  const card = renderSection(sec);
  keepFocus(old, card, () => old.replaceWith(card));
}

// skip: chapters that have already been re-rendered in full.
export function rerenderFile(path, skip) {
  const file = fileByPath.get(path);
  if (!file) return;
  for (const old of $main().querySelectorAll(`.file[data-path="${CSS.escape(path)}"]`)) {
    const secEl = old.closest('.sec');
    if (skip && skip.includes(secEl.dataset.key)) continue;
    const sec = secByKey.get(secEl.dataset.key);
    const box = renderFile(file, sec);
    keepFocus(old, box, () => old.replaceWith(box));
    if (!FIELD_SIZING) for (const t of box.querySelectorAll('textarea.grow')) fitTextarea(t);
    // A file row in the "Chapter files" list shows the viewed mark and the comment counter.
    const row = secEl.querySelector(`.aside-files .file-row[data-path="${CSS.escape(path)}"]`);
    if (row) row.replaceWith(fileRow(file, sec, false));
  }
}

// Re-rendering must not knock focus and the caret out of an input field inside the node.
function keepFocus(oldNode, newNode, replace) {
  const active = document.activeElement;
  const inside = active && oldNode.contains(active) && active.dataset.focusKey;
  const sel = inside && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  replace();
  if (!inside) return;
  const again = newNode.querySelector(`[data-focus-key="${CSS.escape(active.dataset.focusKey)}"]`);
  if (!again) return;
  again.focus({ preventScroll: true });
  if (sel) again.setSelectionRange(sel[0], sel[1]);
}

// before: a change of layout classes. It runs inside withAnchor: otherwise the anchor would be captured
// in the already rebuilt chapter (in side-by-side view the overview moves above the diffs) and the reading position would shift.
export function rerenderAllFiles(before) {
  withAnchor(() => {
    if (before) before();
    for (const sec of groups()) if (sectionOpen(sec)) rerenderSection(sec.key);
  });
}

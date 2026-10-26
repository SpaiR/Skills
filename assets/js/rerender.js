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
// Верх заголовка в потоке: верх карточки плюс её рамка. У закреплённого заголовка rect показывает не это место.
export const headTop = (box) => box.getBoundingClientRect().top + box.clientTop;
const topOf = (sel) => { const el = $main().querySelector(sel); return el ? headTop(el) : null; };

// Держит на месте точку опоры, пока fn() перерисовывает узлы. Опоры перебираются по порядку:
// первая, что нашлась после перерисовки, определяет прокрутку. keep — заголовок, с которым работал
// пользователь (клик по нему, V, O): он остаётся там, где был, даже если был закреплён. Или строка
// диффа, по номеру которой кликнули: форма открывается под ней, а форма выше схлопывается в черновик.
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

// Заголовок файла или главы. После перерисовки его место — верх контейнера: в потоке заголовок первый.
function headAnchor(head, top) {
  const box = head.parentElement;
  const key = head.closest('.sec').dataset.key;
  const sel = box.classList.contains('file') ? fileQ(key, box.dataset.path) : secQ(key);
  return { top: top == null ? headTop(box) : top, find: () => topOf(sel) };
}

// Строка диффа или карточка комментария. Если вид сменился, строка ищется по номеру своей стороны.
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
    // Заголовок, спрятанный под шапкой, не в счёт: пользователь его уже не видит.
    } else if (r.top >= L.header - 1 && r.top < vh) out.push(headAnchor(keep, r.top));
  }
  // Первый элемент под закреплёнными заголовками (по центру #main).
  const y = stickyOffset() + 2;
  if (y >= vh) return out;
  const mr = main.getBoundingClientRect();
  const hit = document.elementFromPoint(mr.left + mr.width / 2, y);
  const el = hit && main.contains(hit) ? hit.closest('[data-anchor]') : null;
  if (el && el.matches('tr.ln, .note, .draft-row, .annot-form')) out.push(rowAnchor(el));
  // Видимые заголовки ниже: если строка под точкой исчезла (свернули главу или файл выше), на месте остаются они.
  for (const head of main.querySelectorAll('.sec-head, .file-head')) {
    const top = head.getBoundingClientRect().top;
    if (top < y - 2) continue;
    if (top >= vh) break;
    out.push(headAnchor(head));
  }
  // Последний вариант — предки: файл, затем глава.
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

// skip — главы, которые уже перерисованы целиком.
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
    // Строка файла в списке «Файлы главы» показывает отметку и счётчик комментариев.
    const row = secEl.querySelector(`.aside-files .file-row[data-path="${CSS.escape(path)}"]`);
    if (row) row.replaceWith(fileRow(file, sec, false));
  }
}

// Перерисовка не должна выбивать фокус и курсор из поля ввода внутри узла.
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

// before — смена классов раскладки. Она идёт внутри withAnchor: иначе опора запоминается
// уже в перестроенной главе (в «Рядом» обзор встаёт над диффами) и место чтения уезжает.
export function rerenderAllFiles(before) {
  withAnchor(() => {
    if (before) before();
    for (const sec of groups()) if (sectionOpen(sec)) rerenderSection(sec.key);
  });
}

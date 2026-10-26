// Context expansion: loading the full file text, gap buttons, "whole file" mode and rebuilding a file view.

import * as D from './diffcore.js';
import { EXPAND_STEP, TOKEN } from './constants.js';
import { fileByPath, S, selection, ui } from './state.js';
import { $main } from './dom.js';
import { save } from './persist.js';
import { lineKey } from './lines.js';
import { fileQ, rerenderFile, withAnchor } from './rerender.js';
import { cancelDrag } from './selection.js';
import { toast } from './toast.js';

// Раскрывать можно, если collect.py собрал полный текст файла и он сошёлся с патчем.
export const canExpand = (file) => file.fullAvail && !file.fullBad && file.newLines != null;
const expandedOf = (file) => S.expanded[file.path] || (S.expanded[file.path] = { ranges: [], full: false });
export const isWhole = (file) => !!(S.expanded[file.path] && S.expanded[file.path].full);

export function expandReason(file) {
  if (file.fullBad) return 'Файл изменился после сбора диффа — раскрытие недоступно';
  const c = file.content;
  if (!c) return 'Полный текст не собран: ревью создано старой версией скилла';
  return c.reason ? `Полный текст не собран: ${c.reason}` : 'Полный текст недоступен';
}

// Полный текст файла (один ханк из full.patch) грузится один раз, при первом раскрытии.
// Строки исходного патча сверяются с ним: не сошлись — раскрытие у файла выключается.
const fullLoads = new Map();
export function ensureFull(file) {
  if (file.full) return Promise.resolve(!file.fullBad);
  if (!canExpand(file)) return Promise.resolve(false);
  if (!fullLoads.has(file.path)) {
    fullLoads.set(file.path, fetch(`/api/full?i=${file.idx}`, { headers: { 'X-Review-Token': TOKEN } })
      .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.text(); })
      .then((text) => {
        const hunks = D.parsePatch(text);
        file.full = hunks.length === 1 ? hunks[0].lines : [];
        if (!D.buildView(file.full, file.baseHunks, [], false)) {
          file.fullBad = true;
          toast('Файл изменился после сбора диффа — раскрытие недоступно');
        }
        return !file.fullBad;
      })
      .catch(() => {
        fullLoads.delete(file.path);
        toast('Не удалось загрузить полный текст файла');
        return false;
      }));
  }
  return fullLoads.get(file.path);
}

// Ханки по текущему раскрытию. Индексы строк i пересчитываются, кэши файла сбрасываются.
export function applyView(file) {
  const ex = S.expanded[file.path];
  let hunks = file.baseHunks;
  if (file.full && !file.fullBad && ex && (ex.full || ex.ranges.length)) {
    const v = D.buildView(file.full, file.baseHunks, ex.ranges, ex.full);
    if (v) hunks = v.hunks;
    else file.fullBad = true;
  }
  file.hunks = hunks;
  file.lines = hunks.flatMap((hk) => hk.lines);
  file.split = file.blocks = file.wd = file.syn = null;
}

// Пересобрать вид файла. Курсор N/P и опора выделения держатся за индексы строк: они переносятся
// по номерам строк (строки изменений видны всегда, так что находятся). keep — строка, которая не сдвигается.
function reshapeFile(file, keep) {
  if (ui.drag && ui.drag.file === file) cancelDrag();
  const at = (li) => (li != null && file.lines[li] ? lineKey(file.lines[li]) : null);
  const cur = ui.cursor && ui.cursor.path === file.path ? [at(ui.cursor.from), at(ui.cursor.to)] : null;
  const anc = selection && selection.path === file.path && selection.anchor ? at(selection.anchor.li) : null;
  applyView(file);
  const find = (k) => { const i = k ? file.lines.findIndex((l) => lineKey(l) === k) : -1; return i < 0 ? null : i; };
  if (cur) {
    const a = find(cur[0]), b = find(cur[1]);
    ui.cursor = a == null || b == null ? null : { ...ui.cursor, from: a, to: b };
  }
  if (selection && selection.path === file.path && selection.anchor) {
    const a = find(anc);
    selection.anchor = a == null ? null : { ...selection.anchor, li: a };
  }
  withAnchor(() => rerenderFile(file.path), keep);
}

function dropEmptyExpanded(file) {
  const ex = S.expanded[file.path];
  if (ex && !ex.full && !ex.ranges.length) delete S.expanded[file.path];
}

// Кнопка промежутка: «↑» раскрывает строки над следующим ханком, «↓» — под предыдущим. Строка рядом
// с кнопкой остаётся на месте экрана, новые строки встают с другой стороны от неё.
export async function expandGap(btn, byKeyboard) {
  const fileEl = btn.closest('.file');
  const file = fileEl && fileByPath.get(fileEl.dataset.path);
  if (!file) return;
  const dir = btn.dataset.dir;
  const gap = { newFrom: +btn.dataset.from, newTo: +btn.dataset.to };
  gap.n = gap.newTo - gap.newFrom + 1;
  const sep = btn.closest('tr');
  const near = (el, step) => { let tr = el && el[step]; while (tr && !tr.matches('tr.ln')) tr = tr[step]; return tr; };
  const below = near(sep, 'nextElementSibling'), above = near(sep, 'previousElementSibling');
  const keep = dir === 'up' ? below || above : above || below;
  const keepKey = keep && keep.dataset.anchor;
  if (!(await ensureFull(file))) { rerenderFile(file.path); return; }
  const ex = expandedOf(file);
  ex.ranges = D.mergeRanges([...ex.ranges, D.expandRange(gap, dir, EXPAND_STEP)]);
  save();
  const again = keepKey && $main().querySelector(`[data-anchor="${CSS.escape(keepKey)}"]`);
  reshapeFile(file, again || null);
  if (byKeyboard) {
    // Фокус — на кнопку того же направления у той же строки, если промежуток ещё остался, иначе на заголовок файла.
    const row = keepKey && $main().querySelector(`[data-anchor="${CSS.escape(keepKey)}"]`);
    const sepNow = row && (dir === 'up' ? row.previousElementSibling : row.nextElementSibling);
    const b = sepNow && sepNow.matches('tr.gap') ? sepNow.querySelector(`.gap-btn[data-dir="${dir}"], .gap-btn[data-dir="all"]`) : null;
    const t = b || $main().querySelector(`${fileQ(fileEl.closest('.sec').dataset.key, file.path)} .file-toggle`);
    if (t) t.focus({ preventScroll: true });
  }
}

// «Весь файл»: все промежутки раскрыты. Выключение возвращает раскрытое вручную и строки с комментариями.
export async function setWholeFile(file, on) {
  if (!canExpand(file)) { toast(expandReason(file)); return; }
  if (!(await ensureFull(file))) { rerenderFile(file.path); return; }
  expandedOf(file).full = on;
  dropEmptyExpanded(file);
  save();
  reshapeFile(file, null);
}

// Строки формы комментария остаются раскрытыми: иначе после «Весь файл» → выкл. комментарий
// на раскрытой строке пропал бы со страницы. Номера старой стороны переводятся в новые по полному тексту.
export function pinRange(file, r) {
  if (!file.full || file.fullBad) return;
  let range = null;
  if (r.side === 'new') range = [r.start, r.end];
  else {
    const ns = file.full.filter((l) => l.t === 'ctx' && l.o >= r.start && l.o <= r.end).map((l) => l.n);
    if (ns.length) range = [Math.min(...ns), Math.max(...ns)];
  }
  if (!range) return;
  const ex = expandedOf(file);
  ex.ranges = D.mergeRanges([...ex.ranges, range]);
  dropEmptyExpanded(file);
}

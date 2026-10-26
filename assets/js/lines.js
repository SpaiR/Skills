// Per-file line helpers: quoting, side-by-side pairs, selection ranges, change blocks and cached
// intraline/syntax highlighting.

import * as D from './diffcore.js';
import { fileView } from './model.js';

// Строки диапазона для цитаты: из полного текста, если он загружен, иначе из того, что видно в диффе.
export const quote = (file, side, start, end) => D.quoteLines(file.full && !file.fullBad ? file.full : file.lines, side, start, end);

export const lineAt = (file, side, no) => file.lines.find((l) => (side === 'new' ? l.n : l.o) === no) || null;
const otherSide = (side) => (side === 'new' ? 'old' : 'new');

// Пары «Рядом» по ханкам и индекс строки файла → номер пары (это data-i строки в «Рядом»).
export function splitIndex(file) {
  if (!file.split) {
    const pairs = [], at = new Int32Array(file.lines.length);
    for (const hk of file.hunks) {
      hk.pairs = D.splitPairs(hk.lines);
      for (const [l, r] of hk.pairs) {
        if (l) at[l.i] = pairs.length;
        if (r) at[r.i] = pairs.length;
        pairs.push([l, r]);
      }
    }
    file.split = { pairs, at };
  }
  return file.split;
}

// Строка таблицы, в которой стоит строка файла li, в текущем виде файла.
export const rowIndex = (file, li) => (fileView(file) === 'split' ? splitIndex(file).at[li] : li);

// Диапазон от опоры до строки line по правилу 4.4: строки таблицы между ними, сторона опоры,
// если у неё есть номера в диапазоне, иначе противоположная.
export function rangeOf(file, anchor, line) {
  const split = fileView(file) === 'split';
  const a = rowIndex(file, anchor.li), b = rowIndex(file, line.i);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const rows = split ? splitIndex(file).pairs.slice(lo, hi + 1).flat().filter(Boolean) : file.lines.slice(lo, hi + 1);
  const pick = (s) => rows.map((l) => (s === 'new' ? l.n : l.o)).filter((x) => x != null);
  let side = anchor.side, nos = pick(side);
  if (!nos.length) { side = otherSide(side); nos = pick(side); }
  return { side, start: Math.min(...nos), end: Math.max(...nos) };
}

// Блоки изменений файла (подряд идущие add/del внутри ханка) в индексах строк файла.
export function fileBlocks(file) {
  if (!file.blocks) {
    file.blocks = [];
    for (const hk of file.hunks) {
      for (const b of D.changeBlocks(hk.lines)) file.blocks.push({ from: hk.lines[b.from].i, to: hk.lines[b.to].i });
    }
  }
  return file.blocks;
}

// Внутристрочный дифф считается один раз на файл: результат одинаков для обоих видов.
export function wordRangesOf(file) {
  if (!file.wd) {
    file.wd = new Array(file.lines.length).fill(null);
    for (const hk of file.hunks) {
      const r = D.intraline(hk.lines);
      hk.lines.forEach((l, k) => { file.wd[l.i] = r[k]; });
    }
  }
  return file.wd;
}

// Подсветка синтаксиса (4.8) тоже считается один раз на файл. Пустой массив — у файла подсветки нет.
export function synTokensOf(file) {
  if (!file.syn) file.syn = D.highlightFile(file.hunks, file.path) || [];
  return file.syn;
}

export const lineKey = (l) => (l.t === 'del' ? `o${l.o}` : `n${l.n}`);

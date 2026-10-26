// Per-file line helpers: quoting, side-by-side pairs, selection ranges, change blocks and cached
// intraline/syntax highlighting.

import * as D from './diffcore.js';
import { fileView } from './model.js';

// Lines of a range for a quote: from the full text if loaded, otherwise from what is visible in the diff.
export const quote = (file, side, start, end) => D.quoteLines(file.full && !file.fullBad ? file.full : file.lines, side, start, end);

export const lineAt = (file, side, no) => file.lines.find((l) => (side === 'new' ? l.n : l.o) === no) || null;
const otherSide = (side) => (side === 'new' ? 'old' : 'new');

// Side-by-side pairs per hunk, and a map from file line index to pair number (the data-i of a side-by-side row).
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

// The table row that holds file line li in the current file view.
export const rowIndex = (file, li) => (fileView(file) === 'split' ? splitIndex(file).at[li] : li);

// Range from the anchor to row line: the table rows between them, on the anchor's side
// if it has numbers within the range, otherwise on the opposite side.
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

// Change blocks of a file (consecutive add/del lines inside a hunk) as file line indices.
export function fileBlocks(file) {
  if (!file.blocks) {
    file.blocks = [];
    for (const hk of file.hunks) {
      for (const b of D.changeBlocks(hk.lines)) file.blocks.push({ from: hk.lines[b.from].i, to: hk.lines[b.to].i });
    }
  }
  return file.blocks;
}

// The intraline diff is computed once per file: the result is the same for both views.
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

// Syntax highlighting is also computed once per file. An empty array means the file has no highlighting.
export function synTokensOf(file) {
  if (!file.syn) file.syn = D.highlightFile(file.hunks, file.path) || [];
  return file.syn;
}

export const lineKey = (l) => (l.t === 'del' ? `o${l.o}` : `n${l.n}`);

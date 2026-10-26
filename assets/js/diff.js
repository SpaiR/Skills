// Diff table rendering (unified and side-by-side), hunk and gap rows, selection painting.

import * as D from './diffcore.js';
import { EXPAND_STEP } from './constants.js';
import { S, selection, ui } from './state.js';
import { h, icon } from './dom.js';
import { lineKey, splitIndex, synTokensOf, wordRangesOf } from './lines.js';
import { canExpand } from './expand.js';
import { fileView } from './model.js';
import { trailing } from './comments.js';
import { T } from './strings.js';

// Fast cell constructors: big files have thousands of rows.
export function td(cls, text) {
  const c = document.createElement('td');
  c.className = cls;
  if (text) c.textContent = text;
  return c;
}

// The "+" button at a line number. No tabindex: from the keyboard, C opens a comment.
function cmtBtn(no) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cmt-btn';
  b.tabIndex = -1;
  b.setAttribute('aria-label', T.diff.commentLine(no));
  return b;
}

// btn: this side can be commented on; the new side for add and ctx, the old side for del.
function numTd(side, no, t, extra, marks, btn) {
  let cls = `num ${side} l-${t}${extra || ''}`;
  if (no != null && marks) {
    if (marks.note[side].has(no)) cls += ' has-note';
    if (marks.draft[side].has(no)) cls += ' has-draft';
  }
  const c = td(cls, no == null ? '' : String(no));
  c.dataset.side = side;
  if (no != null) {
    c.dataset.no = String(no);
    if (btn) c.append(cmtBtn(no));
  }
  return c;
}

const SIGN = { add: '+', del: '−', ctx: ' ' };

function codeTd(file, l, wd, extra) {
  const c = td(`code l-${l.t}${extra || ''}`);
  const segs = D.segments(l.s, wd[l.i], synTokensOf(file)[l.i]);
  for (const s of segs) {
    if (!s.w && !s.cls) { c.append(s.text); continue; }
    const sp = document.createElement('span');
    sp.className = [s.w && 'w', s.cls].filter(Boolean).join(' ');
    sp.textContent = s.text;
    c.append(sp);
  }
  if (l.nonl) {
    c.append(h('span', { class: 'nonl', title: T.diff.noEol }, '⏎̸'));
  }
  return c;
}

// Gap separator with expand buttons. hk is the hunk after the gap (null for the end of the file).
function gapRow(gap, hk, cols) {
  const btn = (dir, label, ic) => h('button', {
    class: 'gap-btn', type: 'button', title: label, 'aria-label': label,
    dataset: { act: 'gap', dir, from: String(gap.newFrom), to: String(gap.newTo) },
  }, icon(ic));
  const tail = !hk, head = gap.newFrom === 1;
  const btns = gap.n <= EXPAND_STEP
    ? [btn('all', T.diff.showLines(gap.n), 'expand-all')]
    : [
      !head && btn('down', T.diff.showBelow(EXPAND_STEP), 'expand-down'),
      !tail && btn('up', T.diff.showAbove(EXPAND_STEP), 'expand-up'),
    ];
  const cell = td('hunk-cell');
  cell.colSpan = cols;
  const inner = h('div', { class: 'hunk-in' },
    h('span', { class: 'gap-btns' }, btns),
    h('span', { class: 'hunk-skip' }, tail
      ? T.diff.toEnd(gap.n)
      : T.diff.unchanged(gap.n)));
  if (hk) {
    const range = /^@@ [^@]*@@/.exec(hk.header);
    inner.append(h('span', { class: 'hunk-range' }, range ? range[0].replace(/^@@ -/, '@@ −') : hk.header));
    if (hk.fn) inner.append(h('span', { class: 'hunk-fn' }, hk.fn));
  }
  cell.append(inner);
  const tr = document.createElement('tr');
  tr.className = 'hunk gap';
  tr.append(cell);
  return tr;
}

function hunkRow(hk, cols) {
  const cell = td('hunk-cell');
  cell.colSpan = cols;
  const inner = h('div', { class: 'hunk-in' });
  if (hk.skip) {
    inner.append(h('span', { class: 'hunk-skip' }, hk.skip.first
      ? T.diff.firstHidden(hk.skip.n, hk.skip.to)
      : T.diff.unchanged(hk.skip.n)));
  }
  const range = /^@@ [^@]*@@/.exec(hk.header);
  inner.append(h('span', { class: 'hunk-range' }, range ? range[0].replace(/^@@ -/, '@@ −') : hk.header));
  if (hk.fn) inner.append(h('span', { class: 'hunk-fn' }, hk.fn));
  cell.append(inner);
  const tr = document.createElement('tr');
  tr.className = 'hunk';
  tr.append(cell);
  return tr;
}

function numDigits(file) {
  let max = file.newLines || 0;
  for (const l of file.lines) max = Math.max(max, l.o || 0, l.n || 0);
  return Math.max(3, String(max).length);
}

export const formIn = (path, secKey) => (ui.form && ui.form.path === path && ui.form.sec === secKey ? ui.form : null);

// Comment and draft markers on line numbers and what goes under the end line of its side:
// cards, draft rows and the open form. The key is "side:no".
function fileMarks(file, secKey) {
  const after = new Map();
  const note = { old: new Set(), new: new Set() }, draft = { old: new Set(), new: new Set() };
  const push = (k, item) => { const list = after.get(k); if (list) list.push(item); else after.set(k, [item]); };
  const markRange = (set, r) => { if (set) for (let n = r.start; n <= r.end; n++) set.add(n); };
  for (const a of S.annotations) {
    if (a.file !== file.path) continue;
    markRange(note[a.side], a);
    push(`${a.side}:${a.end}`, { kind: 'note', a });
  }
  const form = formIn(file.path, secKey);
  for (const [key, d] of Object.entries(S.drafts)) {
    if (!d || d.file !== file.path || d.editingId || (form && form.key === key)) continue;
    markRange(draft[d.side], d);
    push(`${d.side}:${d.end}`, { kind: 'draft', key, d });
  }
  if (form && !form.editId) push(`${form.side}:${form.end}`, { kind: 'form' });
  return { after, note, draft };
}

export function renderDiff(file, sec) {
  const view = fileView(file);
  const wd = wordRangesOf(file);
  const secKey = sec ? sec.key : '';
  const marks = fileMarks(file, secKey);
  const cur = ui.cursor && ui.cursor.path === file.path && ui.cursor.sec === secKey ? ui.cursor : null;
  const inCur = (l) => !!(cur && l && l.i >= cur.from && l.i <= cur.to);
  const onlyNew = file.status === 'added', onlyOld = file.status === 'deleted';
  const table = document.createElement('table');
  table.className = `diff ${view}${view === 'unified' && onlyNew ? ' only-new' : ''}${view === 'unified' && onlyOld ? ' only-old' : ''}`;
  table.style.setProperty('--num-ch', String(numDigits(file)));
  table.setAttribute('aria-label', T.diff.table(file.path));
  const colgroup = document.createElement('colgroup');
  const col = (cls) => { const c = document.createElement('col'); if (cls) c.className = cls; colgroup.append(c); };
  const tbody = document.createElement('tbody');
  const pathKey = `${secKey}:${file.path}`;
  // Gaps by line numbers. Without the full text: the old hunk headers without buttons.
  const gaps = canExpand(file) ? new Map(D.gapsOf(file.hunks, file.newLines).map((g) => [g.at, g])) : null;
  const sepRow = (k, cols) => {
    const hk = file.hunks[k];
    if (!gaps) return hk ? hunkRow(hk, cols) : null;
    const gap = gaps.get(k);
    return gap ? gapRow(gap, hk || null, cols) : hk ? hunkRow(hk, cols) : null;
  };
  let rows = 0;

  if (view === 'unified') {
    if (!onlyNew) col('c-num');
    if (!onlyOld) col('c-num');
    col('c-sign');
    col('c-code');
    const cols = colgroup.children.length;
    for (const [k, hk] of file.hunks.entries()) {
      tbody.append(sepRow(k, cols));
      rows += 1.4;
      for (const l of hk.lines) {
        const tr = document.createElement('tr');
        tr.className = inCur(l) ? 'ln cursor' : 'ln';
        tr.dataset.t = l.t;
        tr.dataset.i = String(l.i);
        tr.dataset.anchor = `r:${pathKey}:${lineKey(l)}`;
        if (!onlyNew) tr.append(numTd('old', l.o, l.t, '', marks, l.t === 'del'));
        if (!onlyOld) tr.append(numTd('new', l.n, l.t, '', marks, l.t !== 'del'));
        tr.append(td(`sign l-${l.t}`, SIGN[l.t]), codeTd(file, l, wd));
        tbody.append(tr);
        rows++;
        const keys = l.t === 'ctx' ? [['new', l.n], ['old', l.o]] : l.t === 'add' ? [['new', l.n]] : [['old', l.o]];
        for (const extra of trailing(file, sec, marks, keys, cols)) tbody.append(extra);
      }
    }
    const tail = sepRow(file.hunks.length, cols);
    if (tail) { tbody.append(tail); rows += 1.4; }
  } else {
    col('c-num'); col('c-sign'); col('c-code'); col('c-num'); col('c-sign'); col('c-code');
    splitIndex(file);
    let k = 0;
    for (const [hi, hk] of file.hunks.entries()) {
      tbody.append(sepRow(hi, 6));
      rows += 1.4;
      for (const [left, right] of hk.pairs) {
        const tr = document.createElement('tr');
        tr.className = inCur(left) || inCur(right) ? 'ln cursor' : 'ln';
        tr.dataset.i = String(k);
        tr.dataset.anchor = `p:${pathKey}:${lineKey(right || left)}`;
        k++;
        for (const [side, l] of [['old', left], ['new', right]]) {
          if (!l) {
            const half = side === 'new' ? ' half-new' : '';
            tr.append(numTd(side, null, 'none', ` filler${half}`), td('sign filler'), td('code filler'));
            continue;
          }
          const t = side === 'old' ? (l.t === 'del' ? 'del' : 'ctx') : (l.t === 'add' ? 'add' : 'ctx');
          const btn = side === 'old' ? l.t === 'del' : true;
          tr.append(numTd(side, side === 'old' ? l.o : l.n, t, side === 'new' ? ' half-new' : '', marks, btn), td(`sign l-${t}`, SIGN[t]), codeTd(file, l, wd));
        }
        tbody.append(tr);
        rows++;
        for (const extra of trailing(file, sec, marks, [['old', left && left.o], ['new', right && right.n]], 6)) tbody.append(extra);
      }
    }
    const tail = sepRow(file.hunks.length, 6);
    if (tail) { tbody.append(tail); rows += 1.4; }
  }
  const sel = selection && selection.path === file.path && selection.sec === secKey ? selection : null;
  if (sel) paintSelection(tbody, sel, view === 'split');
  table.append(colgroup, tbody);
  const wrap = h('div', { class: 'diff-wrap' }, table);
  wrap.style.containIntrinsicSize = `auto ${Math.round(rows * 20)}px`;
  if (ui.ready) markFresh(wrap);
  return wrap;
}

// A re-rendered diff is rendered in full for the first frames (content-visibility: visible). The height estimate
// knows nothing about line wrapping, cards and the form, and an off-screen file would get its real height only after
// withAnchor has set the scroll position: the reading position would shift. While the diff is fully rendered, its size
// is exact and remembered by the browser (contain-intrinsic-size: auto), so switching back to auto moves nothing.
let freshQueued = false;
function markFresh(wrap) {
  wrap.classList.add('cv-fresh');
  if (freshQueued) return;
  freshQueued = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    freshQueued = false;
    for (const el of document.querySelectorAll('.diff-wrap.cv-fresh')) el.classList.remove('cv-fresh');
  }));
}

// Selected lines: an overlay on the code and highlighted numbers of the selected side. In side-by-side view, only its own half.
export function paintSelection(root, sel, split) {
  for (const el of root.querySelectorAll('.sel')) el.classList.remove('sel');
  if (!sel) return;
  for (const num of root.querySelectorAll(`td.num[data-side="${sel.side}"][data-no]`)) {
    const no = +num.dataset.no;
    if (no < sel.start || no > sel.end) continue;
    num.classList.add('sel');
    num.parentElement.classList.add('sel');
    if (split) {
      num.nextElementSibling.classList.add('sel');
      num.nextElementSibling.nextElementSibling.classList.add('sel');
    }
  }
}

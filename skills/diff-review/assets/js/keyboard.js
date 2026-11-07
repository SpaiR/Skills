// Global keyboard shortcuts and the actions behind them (J/K, ]/[, N/P, V, O, E, C, ...).

import { isMod, narrowScreen } from './constants.js';
import { $main } from './dom.js';
import { toggleFile, toggleSection } from './events.js';
import { isWhole, setWholeFile } from './expand.js';
import { wholeButton } from './file.js';
import { closeForm, openLineForm } from './forms.js';
import { openHelp } from './help.js';
import { fileBlocks, rowIndex } from './lines.js';
import { closeMenu } from './menu.js';
import { fileOpen, filesMode, guideMode, isViewed, overviewMode } from './model.js';
import { setAllFilesOpen, setMode } from './modes.js';
import { applyCurrent, jumpToSection, scrollToElement, trackCurrent } from './nav.js';
import { fileQ, secQ, stickyOffset } from './rerender.js';
import { closeSectionComment, openSectionComment } from './section.js';
import { cancelDrag } from './selection.js';
import { fileByPath, finished, L, S, secByKey, sections, selection, ui } from './state.js';
import { T } from './strings.js';
import { openSubmit } from './submit.js';
import { toast } from './toast.js';
import { setDrawer, toggleToc } from './toc.js';
import { setViewMode, setWrap } from './view.js';
import { setFileViewed, setSectionViewed } from './viewed.js';

// Fields where letters are input. "Viewed" checkboxes are not included: keys must keep working after clicking them.
const TEXT_INPUT =
  'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])';

const KEYS = {
  KeyJ: () => stepFile(1),
  KeyK: () => stepFile(-1),
  BracketRight: () => stepSection(1),
  BracketLeft: () => stepSection(-1),
  KeyN: () => stepChange(1),
  KeyP: () => stepChange(-1),
  KeyV: () => toggleCurrentFileViewed(),
  KeyO: () => toggleCurrentFile(),
  KeyE: () => toggleCurrentWholeFile(),
  KeyC: () => commentAtCursor(),
  // Overview shows no diffs and hides the view switch: S there only explains where it works.
  KeyS: () => (overviewMode() ? toast(T.keys.diffViewOnly) : setViewMode(S.viewMode === 'split' ? 'unified' : 'split')),
  KeyW: () => setWrap(!S.wrap),
  KeyT: () => toggleToc(),
  // G: Guide <-> Files; from Overview it goes to Guide.
  KeyG: () => setMode(guideMode() ? 'files' : 'guide'),
  KeyZ: () => setAllFilesOpen(false),
  Slash: () => focusFilter(),
};
// Chapter keys: only Guide mode has chapters (Overview has cards, Files a single group), elsewhere a hint is shown.
const guideOnly = (fn) => () => (guideMode() ? fn() : toast(T.keys.guideOnly));
KEYS.BracketRight = guideOnly(KEYS.BracketRight);
KEYS.BracketLeft = guideOnly(KEYS.BracketLeft);
const SHIFT_KEYS = {
  KeyV: guideOnly(() => toggleCurrentSectionViewed()),
  KeyO: guideOnly(() => toggleCurrentSection()),
  KeyC: guideOnly(() => {
    if (ui.curSec) openSectionComment(ui.curSec);
  }),
  KeyZ: () => setAllFilesOpen(true),
};

function focusFilter() {
  if (!filesMode()) setMode('files');
  if (narrowScreen.matches && !ui.drawer) setDrawer(true);
  else if (!narrowScreen.matches && S.tocOpen === false) toggleToc();
  const input = document.getElementById('tree-filter');
  if (input) {
    input.focus();
    input.select();
  }
}

export function onKeyDown(e) {
  if (finished || e.isComposing) return;
  const t = e.target instanceof Element ? e.target : null;
  if (t && t.closest(TEXT_INPUT)) return;
  if (document.querySelector('dialog[open]')) return;
  if (ui.menu && t && ui.menu.contains(t)) return;
  const code = e.code;
  if (code === 'Enter' && isMod(e) && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    openSubmit('feedback');
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '?' || (code === 'Slash' && e.shiftKey)) {
    e.preventDefault();
    openHelp();
    return;
  }
  if (code === 'Escape') {
    onEscape();
    return;
  }
  const fn = (e.shiftKey ? SHIFT_KEYS : KEYS)[code];
  if (!fn) return;
  e.preventDefault();
  // The current item is updated in the frame after scrolling; a key pressed right after it gets a fresh one.
  trackCurrent();
  fn();
}

// Esc closes, in order: the menu, the slide-out contents, the form (the draft stays), the selection, the cursor.
function onEscape() {
  if (ui.menu) {
    closeMenu(true);
    return;
  }
  if (narrowScreen.matches && ui.drawer) {
    setDrawer(false);
    return;
  }
  if (ui.drag) {
    cancelDrag();
    return;
  }
  if (ui.secForm) {
    closeSectionComment();
    return;
  }
  if (ui.form || selection) {
    closeForm(true);
    return;
  }
  if (ui.cursor) {
    ui.cursor = null;
    applyCursor();
  }
}

const openFileEls = () => [...$main().querySelectorAll('.sec:not(.collapsed) .file:not([hidden])')];

// J/K: the adjacent file in expanded chapters, including collapsed files.
function stepFile(dir) {
  const list = openFileEls();
  if (!list.length) return;
  const c = ui.curFile;
  const cur = c ? list.findIndex((f) => f.dataset.path === c.path && f.closest('.sec').dataset.key === c.sec) : -1;
  let next = cur + dir;
  if (cur < 0) {
    // No current file (after ]/[ or a V that closed the chapter): the adjacent file is counted from the current chapter.
    const at = sections.findIndex((s) => s.key === ui.curSec);
    const secIdx = (f) => secByKey.get(f.closest('.sec').dataset.key).idx;
    if (at < 0) next = dir > 0 ? 0 : list.length - 1;
    else if (dir > 0) {
      next = list.findIndex((f) => secIdx(f) >= at);
      if (next < 0) next = list.length;
    } else {
      next = -1;
      list.forEach((f, k) => {
        if (secIdx(f) < at) next = k;
      });
    }
  }
  if (next < 0 || next >= list.length) {
    toast(dir > 0 ? T.keys.lastFile : T.keys.firstFile);
    return;
  }
  const el = list[next];
  goFile(el.dataset.path, el.closest('.sec').dataset.key);
}

// Put the file header under the chapter header, make the file current and focus its button.
function goFile(path, key) {
  ui.curFile = { path, sec: key };
  ui.curSec = key;
  ui.pin = { sec: key, path };
  applyCurrent(true);
  scrollToElement(() => $main().querySelector(fileQ(key, path)), L.header + L.secHead);
  const t = $main().querySelector(`${fileQ(key, path)} .file-toggle`);
  if (t) t.focus({ preventScroll: true });
}

// ]/[: the adjacent chapter, including collapsed ones.
function stepSection(dir) {
  const cur = sections.findIndex((s) => s.key === ui.curSec);
  const next = cur < 0 ? 0 : cur + dir;
  if (next < 0 || next >= sections.length) {
    toast(dir > 0 ? T.keys.lastChapter : T.keys.firstChapter);
    return;
  }
  const key = sections[next].key;
  ui.curSec = key;
  ui.curFile = null;
  ui.pin = { sec: key, path: null };
  applyCurrent(true);
  jumpToSection(key);
  const t = $main().querySelector(`${secQ(key)} .sec-toggle`);
  if (t) t.focus({ preventScroll: true });
}

// Table rows of a change block (in side-by-side view a block spans pairs).
function blockRows(c) {
  const fileEl = c && $main().querySelector(fileQ(c.sec, c.path));
  const file = c && fileByPath.get(c.path);
  if (!fileEl || !file || !fileEl.querySelector('table.diff')) return [];
  const idx = new Set();
  for (let li = c.from; li <= c.to; li++) idx.add(rowIndex(file, li));
  return [...idx].map((i) => fileEl.querySelector(`tr.ln[data-i="${i}"]`)).filter(Boolean);
}

function applyCursor() {
  for (const el of $main().querySelectorAll('tr.ln.cursor')) el.classList.remove('cursor');
  for (const tr of blockRows(ui.cursor)) tr.classList.add('cursor');
}

// N/P: the next change block in expanded files of expanded chapters.
function stepChange(dir) {
  const list = [];
  for (const fileEl of $main().querySelectorAll('.sec:not(.collapsed) .file:not(.collapsed):not([hidden])')) {
    if (!fileEl.querySelector('table.diff')) continue;
    const file = fileByPath.get(fileEl.dataset.path),
      sec = fileEl.closest('.sec').dataset.key;
    for (const b of fileBlocks(file)) list.push({ path: file.path, sec, from: b.from, to: b.to });
  }
  const c = ui.cursor;
  let next = -1;
  const cur = c ? list.findIndex((b) => b.path === c.path && b.sec === c.sec && b.from === c.from) : -1;
  if (cur >= 0) next = cur + dir;
  else if (list.length) {
    // Without a cursor, start from the screen: the first block below the sticky headers or the last one above them.
    const line = stickyOffset() - 1;
    const top = (b) => {
      const r = blockRows(b)[0];
      return r ? r.getBoundingClientRect().top : -Infinity;
    };
    if (dir > 0) next = list.findIndex((b) => top(b) >= line);
    else for (let k = 0; k < list.length && top(list[k]) < line; k++) next = k;
    if (next < 0) next = dir > 0 ? list.length : -1;
  }
  if (next < 0 || next >= list.length) {
    toast(dir > 0 ? T.keys.noMoreChanges : T.keys.firstChange);
    return;
  }
  ui.cursor = list[next];
  // The cursor's file becomes current and pinned: otherwise V, O and Shift+V would act
  // on a file or chapter pinned earlier by J/K/]/[ that is no longer on screen.
  ui.curFile = { path: ui.cursor.path, sec: ui.cursor.sec };
  ui.curSec = ui.cursor.sec;
  ui.pin = { sec: ui.cursor.sec, path: ui.cursor.path };
  applyCurrent(true);
  applyCursor();
  scrollToElement(() => blockRows(ui.cursor)[0], stickyOffset() + Math.round(window.innerHeight * 0.25));
}

// C: a form on the block under the cursor. If there are added lines, the new side is used, otherwise the old side of the deleted ones.
function commentAtCursor() {
  const c = ui.cursor;
  const file = c && fileByPath.get(c.path);
  if (!file || !blockRows(c).length) {
    toast(T.keys.pickChange);
    return;
  }
  const lines = file.lines.slice(c.from, c.to + 1);
  const adds = lines.filter((l) => l.t === 'add');
  const side = adds.length ? 'new' : 'old';
  const picked = adds.length ? adds : lines.filter((l) => l.t === 'del');
  const nos = picked.map((l) => (side === 'new' ? l.n : l.o));
  openLineForm(
    file,
    c.sec,
    { side, start: Math.min(...nos), end: Math.max(...nos) },
    { li: picked[0].i, side },
    false,
    blockRows(c)[0],
  );
}

function currentFile() {
  const c = ui.curFile;
  const file = c && fileByPath.get(c.path);
  const el = file && $main().querySelector(fileQ(c.sec, c.path));
  return el ? { file, sec: secByKey.get(c.sec), head: el.querySelector('.file-head') } : null;
}

// Re-rendering removes the focused node. Focus returns to the button of the file or chapter header
// unless it has moved elsewhere by itself (for example, into a form field).
function refocus(secKey, path) {
  if (document.activeElement && document.activeElement !== document.body) return;
  const t = $main().querySelector(path ? `${fileQ(secKey, path)} .file-toggle` : `${secQ(secKey)} .sec-toggle`);
  if (t) t.focus({ preventScroll: true });
}

function toggleCurrentFileViewed() {
  const cur = currentFile();
  if (!cur) {
    toast(T.keys.noFile);
    return;
  }
  ui.pin = { sec: cur.sec.key, path: cur.file.path };
  const closed = setFileViewed(cur.file, !isViewed(cur.file), cur.head);
  refocus(closed || cur.sec.key, closed ? null : cur.file.path);
}

function toggleCurrentFile() {
  const cur = currentFile();
  if (!cur) {
    toast(T.keys.noFile);
    return;
  }
  if (cur.file.binary) return;
  ui.pin = { sec: cur.sec.key, path: cur.file.path };
  toggleFile(cur.file, cur.sec, !fileOpen(cur.file));
  refocus(cur.sec.key, cur.file.path);
}

function toggleCurrentWholeFile() {
  const cur = currentFile();
  if (!cur) {
    toast(T.keys.noFile);
    return;
  }
  if (!wholeButton(cur.file)) {
    toast(T.keys.wholeInDiff);
    return;
  }
  ui.pin = { sec: cur.sec.key, path: cur.file.path };
  setWholeFile(cur.file, !isWhole(cur.file));
}

function currentSecHead() {
  const el = ui.curSec && $main().querySelector(secQ(ui.curSec));
  return el ? el.querySelector('.sec-head') : null;
}

function toggleCurrentSectionViewed() {
  const sec = secByKey.get(ui.curSec);
  if (!sec) return;
  ui.pin = { sec: sec.key, path: null };
  setSectionViewed(sec, !S.reviewed[sec.key], currentSecHead());
  refocus(sec.key, null);
}

function toggleCurrentSection() {
  const sec = secByKey.get(ui.curSec);
  if (!sec) return;
  ui.pin = { sec: sec.key, path: null };
  toggleSection(sec, currentSecHead());
  refocus(sec.key, null);
}

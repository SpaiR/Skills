// Overview/Guide/Files mode switching, layout variables read from CSS, collapsing all files.

import { TREE_DEFAULT } from './constants.js';
import { $main } from './dom.js';
import { updateChrome } from './header.js';
import { closeMenu } from './menu.js';
import { filesMode, groupFor, groups, overviewMode, secFiles, sectionOpen } from './model.js';
import { applyCurrent, scrollToElement, trackCurrent } from './nav.js';
import { save } from './persist.js';
import { fileQ, rerenderAllFiles, stickyOffset } from './rerender.js';
import { renderMain } from './section.js';
import { cancelDrag } from './selection.js';
import { finished, L, S, secByKey, selection, ui } from './state.js';
import { T } from './strings.js';
import { toast } from './toast.js';
import { computeVisible } from './tree.js';

// Mode class and panel width. --sec-head-h is 0 in Files mode, which has no sticky chapter headers,
// so every offset below the top bar (L.secHead) is recomputed by itself.
export function applyModeLayout() {
  const root = document.documentElement;
  root.classList.toggle('mode-files', filesMode());
  root.classList.toggle('mode-overview', overviewMode());
  if (filesMode()) root.style.setProperty('--sidebar-w', `${S.treeW || TREE_DEFAULT}px`);
  else root.style.removeProperty('--sidebar-w');
  readLayoutVars();
}

export function observeTitle() {
  if (ui.titleObs) ui.titleObs.disconnect();
  const title = document.getElementById('review-title');
  if (!title) return;
  ui.titleObs = new IntersectionObserver(
    ([entry]) => {
      if (finished) return;
      ui.heroHidden = !entry.isIntersecting && entry.boundingClientRect.top < L.header;
      document.getElementById('top').classList.toggle('show-title', ui.heroHidden);
    },
    { rootMargin: `-${L.header}px 0px 0px 0px` },
  );
  ui.titleObs.observe(title);
}

// Mode switch: the current file and the row under the sticky headers stay in place on screen.
// toPath is the file to go to (chapter chip) instead of the current one by scroll position.
// Overview mode has no files (groupFor is null there): it opens at the top. The file and row left for it are
// remembered, and leaving Overview without a target goes back to them, so a look at it keeps the reading place.
export function setMode(mode, toPath) {
  if (finished || S.mode === mode) return;
  closeMenu(false);
  if (ui.drag) cancelDrag();
  if (!toPath) trackCurrent();
  let path = toPath || (ui.curFile && ui.curFile.path);
  let ref = null;
  const oldGroup = path && groupFor(path);
  const fileEl = oldGroup && $main().querySelector(fileQ(oldGroup.key, path));
  if (fileEl) {
    // The anchor is the first row fully visible in both modes: below the sticky headers of Guide mode.
    // Otherwise, switching back and forth would pick a different anchor row each time and the text would drift by a chapter header height.
    const y = L.header + L.secHeadGuide + L.fileHead;
    for (const tr of fileEl.querySelectorAll('tr.ln')) {
      const r = tr.getBoundingClientRect();
      if (r.top < y - 0.5) continue;
      const num = r.top < window.innerHeight && tr.querySelector('td.num[data-no]');
      if (num) ref = { side: num.dataset.side, no: num.dataset.no, top: r.top };
      break;
    }
  }
  if (mode === 'overview') ui.modeReturn = path ? { path, ref } : null;
  else if (overviewMode()) {
    if (!toPath && ui.modeReturn) ({ path, ref } = ui.modeReturn);
    ui.modeReturn = null;
  }
  S.mode = mode;
  save();
  applyModeLayout();
  const key = (p) => {
    const g = p && groupFor(p);
    return g ? g.key : null;
  };
  if (path && key(path)) {
    ui.curFile = { path, sec: key(path) };
    ui.curSec = ui.curFile.sec;
    const sec = secByKey.get(ui.curSec);
    if (!sec.headless && !sectionOpen(sec)) S.sectionOpen[sec.key] = true;
  } else {
    ui.curFile = null;
    ui.curSec = null;
  }
  if (ui.cursor) ui.cursor = { ...ui.cursor, sec: key(ui.cursor.path) };
  if (selection) selection.sec = key(selection.path);
  if (ui.form) ui.form.sec = key(ui.form.path);
  ui.secForm = null;
  ui.pin = ui.curFile ? { sec: ui.curFile.sec, path } : null;
  if (filesMode()) computeVisible();
  document.getElementById('toc').replaceChildren();
  renderMain();
  updateChrome();
  observeTitle();
  if (ui.curFile) {
    const q = fileQ(ui.curFile.sec, path);
    const find = () => {
      const f = $main().querySelector(q);
      const n = f && ref && f.querySelector(`td.num[data-side="${ref.side}"][data-no="${ref.no}"]`);
      return n ? n.closest('tr') : f;
    };
    const el = find();
    scrollToElement(find, el && el.matches('tr') ? Math.max(ref.top, stickyOffset()) : L.header + L.secHead, true);
  } else window.scrollTo({ top: 0, behavior: 'instant' });
  applyCurrent(true);
}

// Z / Shift+Z: collapse or expand all files of the visible groups.
export function setAllFilesOpen(open) {
  const files = groups()
    .filter(sectionOpen)
    .flatMap(secFiles)
    .filter((f) => !f.binary && !(ui.visible && filesMode() && !ui.visible.has(f.path)));
  if (!files.length) return;
  for (const f of files) S.fileOpen[f.path] = open;
  save();
  rerenderAllFiles();
  updateChrome();
  toast(open ? T.keys.allExpanded : T.keys.allCollapsed);
}

function readLayoutVars() {
  const cs = getComputedStyle(document.documentElement);
  const px = (name, def) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) ? v : def;
  };
  L.header = px('--header-h', 52);
  L.secHead = px('--sec-head-h', 48);
  if (!filesMode()) L.secHeadGuide = L.secHead;
  L.fileHead = px('--file-head-h', 40);
}

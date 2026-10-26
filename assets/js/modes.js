// Guide/Files mode switching, layout variables read from CSS, collapsing all files.

import { TREE_DEFAULT } from './constants.js';
import { finished, L, S, secByKey, selection, ui } from './state.js';
import { $main } from './dom.js';
import { save } from './persist.js';
import { filesMode, groupFor, groups, secFiles, sectionOpen } from './model.js';
import { fileQ, rerenderAllFiles, stickyOffset } from './rerender.js';
import { updateChrome } from './header.js';
import { computeVisible } from './tree.js';
import { applyCurrent, scrollToElement, trackCurrent } from './nav.js';
import { renderMain } from './section.js';
import { cancelDrag } from './selection.js';
import { toast } from './toast.js';
import { closeMenu } from './menu.js';

// Класс режима и ширина панели. --sec-head-h: 0 в «Файлах» — закреплённых заголовков глав там нет,
// и все отступы под шапкой (L.secHead) пересчитываются сами.
export function applyModeLayout() {
  const root = document.documentElement;
  root.classList.toggle('mode-files', filesMode());
  if (filesMode()) root.style.setProperty('--sidebar-w', `${S.treeW || TREE_DEFAULT}px`);
  else root.style.removeProperty('--sidebar-w');
  readLayoutVars();
}

export function observeTitle() {
  if (ui.titleObs) ui.titleObs.disconnect();
  const title = document.getElementById('review-title');
  if (!title) return;
  ui.titleObs = new IntersectionObserver(([entry]) => {
    if (finished) return;
    ui.heroHidden = !entry.isIntersecting && entry.boundingClientRect.top < L.header;
    document.getElementById('top').classList.toggle('show-title', ui.heroHidden);
  }, { rootMargin: `-${L.header}px 0px 0px 0px` });
  ui.titleObs.observe(title);
}

// Переключение режима: текущий файл и строка под закреплёнными заголовками остаются на месте экрана.
// toPath — файл, к которому перейти (чип главы), вместо текущего по прокрутке.
export function setMode(mode, toPath) {
  if (finished || S.mode === mode) return;
  closeMenu(false);
  if (ui.drag) cancelDrag();
  if (!toPath) trackCurrent();
  const path = toPath || (ui.curFile && ui.curFile.path);
  let ref = null;
  const oldGroup = path && groupFor(path);
  const fileEl = oldGroup && $main().querySelector(fileQ(oldGroup.key, path));
  if (fileEl) {
    // Опора — первая строка, целиком видная в обоих режимах: ниже закреплённых заголовков «Гайда».
    // Иначе туда-обратно опорой каждый раз была бы другая строка, и текст уезжал бы на высоту заголовка главы.
    const y = L.header + L.secHeadGuide + L.fileHead;
    for (const tr of fileEl.querySelectorAll('tr.ln')) {
      const r = tr.getBoundingClientRect();
      if (r.top < y - 0.5) continue;
      const num = r.top < window.innerHeight && tr.querySelector('td.num[data-no]');
      if (num) ref = { side: num.dataset.side, no: num.dataset.no, top: r.top };
      break;
    }
  }
  S.mode = mode;
  save();
  applyModeLayout();
  const key = (p) => { const g = p && groupFor(p); return g ? g.key : null; };
  if (path && key(path)) {
    ui.curFile = { path, sec: key(path) };
    ui.curSec = ui.curFile.sec;
    const sec = secByKey.get(ui.curSec);
    if (!sec.headless && !sectionOpen(sec)) S.sectionOpen[sec.key] = true;
  } else { ui.curFile = null; ui.curSec = null; }
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

// Z / Shift+Z: свернуть или развернуть все файлы видимых групп.
export function setAllFilesOpen(open) {
  const files = groups().filter(sectionOpen).flatMap(secFiles)
    .filter((f) => !f.binary && !(ui.visible && filesMode() && !ui.visible.has(f.path)));
  if (!files.length) return;
  for (const f of files) S.fileOpen[f.path] = open;
  save();
  rerenderAllFiles();
  updateChrome();
  toast(open ? 'Все файлы развёрнуты' : 'Все файлы свёрнуты');
}

function readLayoutVars() {
  const cs = getComputedStyle(document.documentElement);
  const px = (name, def) => { const v = parseFloat(cs.getPropertyValue(name)); return Number.isFinite(v) ? v : def; };
  L.header = px('--header-h', 52);
  L.secHead = px('--sec-head-h', 48);
  if (!filesMode()) L.secHeadGuide = L.secHead;
  L.fileHead = px('--file-head-h', 40);
}

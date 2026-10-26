// Entry point: loads the review, builds the model, renders the page and wires global listeners.

import * as D from './diffcore.js';
import { narrowScreen } from './constants.js';
import {
  fileByPath, filesGroup, finished, guideOf, R, S, secByKey, sections, setFilesGroup, setR, setS, setSections,
  setTreeRoot, treeRoot, ui,
} from './state.js';
import { $main, h } from './dom.js';
import { api, flushSave, migrateFilesViewed, normalizeState } from './persist.js';
import { applyView, ensureFull } from './expand.js';
import { filesMode, splitAvailable } from './model.js';
import { rerenderAllFiles } from './rerender.js';
import { renderHeader, updateChrome, updateHeader } from './header.js';
import { applyTocState, onDrawerTab, onTocClick } from './toc.js';
import { buildTree, computeVisible } from './tree.js';
import { applyModeLayout, observeTitle } from './modes.js';
import { queueTrack, trackCurrent } from './nav.js';
import { renderMain } from './section.js';
import { onMainMouseDown, onMainMouseOver } from './selection.js';
import { onMainChange, onMainClick } from './events.js';
import { applyTheme } from './view.js';
import { onKeyDown } from './keyboard.js';

function renderShell() {
  renderHeader();
  applyTocState();
  renderMain();
  updateChrome();
  document.getElementById('toc').addEventListener('click', onTocClick);
  document.addEventListener('keydown', onDrawerTab);
  const main = $main();
  main.addEventListener('click', onMainClick);
  main.addEventListener('change', onMainChange);
  main.addEventListener('mousedown', onMainMouseDown);
  main.addEventListener('mouseover', onMainMouseOver);
}

function watchLayout() {
  const main = $main();
  ui.mainW = main.clientWidth;
  new ResizeObserver(() => {
    if (finished) return;
    const before = splitAvailable();
    ui.mainW = main.clientWidth;
    if (before !== splitAvailable()) {
      if (S.viewMode === 'split') rerenderAllFiles();
      updateHeader();
    }
  }).observe(main);
  narrowScreen.addEventListener('change', () => { if (finished) return; ui.drawer = false; applyTocState(); });
  const toc = document.getElementById('toc');
  toc.addEventListener('mouseenter', () => { ui.tocHover = true; });
  toc.addEventListener('mouseleave', () => { ui.tocHover = false; });
  // Close the slide-out contents with a click outside the panel.
  document.addEventListener('mousedown', (e) => {
    if (narrowScreen.matches && ui.drawer && !e.target.closest('#toc, #toc-btn')) { ui.drawer = false; applyTocState(); }
  });
  window.addEventListener('scroll', queueTrack, { passive: true });
  // Scrolling by the user releases the pinned current item (J/K pin it again).
  const unpin = () => { ui.pin = null; };
  for (const ev of ['wheel', 'touchmove', 'mousedown']) window.addEventListener(ev, unpin, { passive: true, capture: true });
  const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'Space']);
  window.addEventListener('keydown', (e) => { if (SCROLL_KEYS.has(e.code)) unpin(); }, { capture: true });
  window.addEventListener('resize', queueTrack, { passive: true });
  // While the review title is visible, the top bar shows the repository context; after that, the review title.
  observeTitle();
}

async function init() {
  let review;
  try {
    review = await api('GET', '/api/review');
  } catch (err) {
    $main().replaceChildren(h('div', { class: 'load-error' },
      h('div', { class: 'callout callout-warning' },
        h('div', { class: 'callout-title' }, 'Внимание'),
        h('p', {}, `Не удалось загрузить ревью: ${err.message}. Возможно, сервер уже остановлен или ссылка без токена.`)),
      h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Повторить')));
    return;
  }
  performance.mark('dr-review');
  setR(review);
  setS(normalizeState(R.state));
  applyTheme();
  applyModeLayout();
  R.files.forEach((f, idx) => {
    const hunks = D.parsePatch(f.patch);
    const lines = hunks.flatMap((hk) => hk.lines);
    fileByPath.set(f.path, {
      ...f, idx, hunks, lines, baseHunks: hunks, baseCount: lines.length, hash: D.fnv1a(f.patch),
      fullAvail: !!f.full, newLines: f.content && f.content.lines != null ? f.content.lines : null, full: null, fullBad: false,
    });
  });
  // Expanded last time: the full text of these files is needed before the first render, otherwise the page would jump.
  for (const p of Object.keys(S.expanded)) if (!fileByPath.has(p)) delete S.expanded[p];
  await Promise.all(Object.keys(S.expanded).map((p) => {
    const file = fileByPath.get(p);
    return ensureFull(file).then(() => applyView(file));
  }));
  setSections(R.guide.sections.map((s, i) => ({ ...s, key: `s${i + 1}` })));
  if (R.guide.unplacedFiles && R.guide.unplacedFiles.length) {
    sections.push({
      key: 'rest', synthetic: true, title: 'Остальные файлы',
      overview: 'Файлы, которые не вошли ни в одну главу: шум или мелочи без отдельной истории.',
      diffs: R.guide.unplacedFiles.map((file) => ({ file })),
    });
  }
  const numbered = sections.filter((s) => !s.synthetic).length;
  sections.forEach((s, i) => { s.idx = i; s.total = numbered; secByKey.set(s.key, s); });
  for (const sec of sections) for (const d of sec.diffs) if (!guideOf.has(d.file)) guideOf.set(d.file, { sec, summary: d.summary || '' });
  setTreeRoot(buildTree(R.files.map((f) => f.path)));
  setFilesGroup({ key: 'files', headless: true, idx: 0, total: 0, title: 'Файлы', diffs: treeRoot.all.map((file) => ({ file })) });
  secByKey.set(filesGroup.key, filesGroup);
  if (filesMode()) computeVisible();
  migrateFilesViewed();
  document.title = `Ревью: ${R.guide.title}`;
  document.body.classList.toggle('view-split', S.viewMode === 'split');
  document.body.classList.toggle('nowrap', !S.wrap);
  ui.mainW = $main().clientWidth;
  renderShell();
  ui.ready = true;
  watchLayout();
  trackCurrent();
  performance.mark('dr-ready');
  performance.measure('dr-render', 'dr-review', 'dr-ready');
  window.addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  document.addEventListener('keydown', onKeyDown);
}

init();

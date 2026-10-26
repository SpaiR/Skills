// Scrolling and jumps, plus tracking of the current chapter and file.

import { reducedMotion } from './constants.js';
import { fileByPath, finished, L, S, secByKey, ui } from './state.js';
import { $main } from './dom.js';
import { save } from './persist.js';
import { fileOpen, sectionOpen } from './model.js';
import { fileQ, headTop, rerenderFile, rerenderSection, secQ, withAnchor } from './rerender.js';
import { updateChrome } from './header.js';

const scrollBehavior = () => (reducedMotion.matches ? 'instant' : 'smooth');

// Прокрутка к элементу с поправкой: размеры ещё не отрисованных блоков (content-visibility) оцениваются
// и уточняются по мере прокрутки, поэтому после неё позиция проверяется, пока не простоит три кадра.
let jumpSeq = 0;
export function scrollToElement(getEl, offset, instant) {
  const seq = ++jumpSeq;
  const behavior = instant ? 'instant' : scrollBehavior();
  const target = () => {
    const el = getEl();
    if (!el) return null;
    const y = (el.matches('.sec, .file') ? headTop(el) : el.getBoundingClientRect().top) + window.scrollY - offset;
    return Math.max(0, Math.min(y, document.documentElement.scrollHeight - window.innerHeight));
  };
  const y = target();
  if (y == null) return;
  // Далёкий переход: плавная анимация через десятки экранов идёт секунды. Переносимся почти к цели
  // мгновенно и доезжаем плавно последние полэкрана — направление движения остаётся видно.
  const far = window.innerHeight * 2;
  if (behavior === 'smooth' && Math.abs(y - window.scrollY) > far) {
    window.scrollTo({ top: y - Math.sign(y - window.scrollY) * window.innerHeight / 2, behavior: 'instant' });
  }
  window.scrollTo({ top: target(), behavior });
  let tries = 0, stable = 0;
  const fix = () => {
    if (seq !== jumpSeq) return;
    const y2 = target();
    if (y2 == null) return;
    if (Math.abs(y2 - window.scrollY) > 0.5) {
      if (tries++ > 10) return;
      stable = 0;
      window.scrollTo({ top: y2, behavior: 'instant' });
    } else if (++stable >= 3) return;
    requestAnimationFrame(fix);
  };
  if (behavior === 'instant') requestAnimationFrame(fix);
  else waitScrollEnd(fix);
}

function waitScrollEnd(fn) {
  let done = false, timer = null;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('scrollend', finish);
    window.removeEventListener('scroll', onScroll);
    fn();
  };
  const onScroll = () => { clearTimeout(timer); timer = setTimeout(finish, 150); };
  window.addEventListener('scrollend', finish, { once: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  timer = setTimeout(finish, 150);
}

export function jumpToSection(key) {
  scrollToElement(() => $main().querySelector(`.sec[data-key="${CSS.escape(key)}"]`), L.header);
}

export function jumpToFile(path, key) {
  const sec = secByKey.get(key);
  // В «Файлах» клик по файлу в дереве раскрывает свёрнутый файл, как в GitHub.
  const file = fileByPath.get(path);
  if (sec && sec.headless && file && !file.binary && !fileOpen(file)) {
    S.fileOpen[path] = true;
    save();
    withAnchor(() => rerenderFile(path));
  }
  if (sec && !sectionOpen(sec)) {
    S.sectionOpen[key] = true;
    save();
    withAnchor(() => rerenderSection(key));
    updateChrome();
  }
  ui.curFile = { path, sec: key };
  // Файл остаётся текущим, пока он на экране: у конца страницы прокрутка не доводит его до верха.
  ui.pin = { sec: key, path };
  scrollToElement(() => $main().querySelector(`.sec[data-key="${CSS.escape(key)}"] .file[data-path="${CSS.escape(path)}"]`), L.header + L.secHead);
}

let trackQueued = false;
export function queueTrack() {
  if (trackQueued) return;
  trackQueued = true;
  requestAnimationFrame(() => { trackQueued = false; trackCurrent(); });
}

export function trackCurrent() {
  if (finished) return;
  const main = $main();
  const line = L.header + L.secHead;
  let cur = null, firstVisible = null;
  for (const f of main.querySelectorAll('.file')) {
    const r = f.getBoundingClientRect();
    if (r.top <= line + 1 && r.bottom > line + L.fileHead) cur = f;
    if (!firstVisible && r.top > line && r.top < window.innerHeight) firstVisible = f;
    if (r.top > window.innerHeight) break;
  }
  cur = cur || firstVisible;
  let secEl = cur && cur.closest('.sec');
  if (!secEl) {
    const secs = [...main.querySelectorAll('.sec')];
    secEl = secs.filter((s) => s.getBoundingClientRect().top <= L.header + 1).pop() || secs[0] || null;
  }
  let fileKey = cur ? { path: cur.dataset.path, sec: secEl.dataset.key } : null;
  let secKey = secEl ? secEl.dataset.key : null;
  // После J/K/]/[/V текущим остаётся выбранный элемент, пока он на экране: у конца страницы
  // заголовок не доезжает до закреплённой позиции, и расчёт по прокрутке выбрал бы соседний.
  if (ui.pin) {
    const el = main.querySelector(ui.pin.path ? fileQ(ui.pin.sec, ui.pin.path) : secQ(ui.pin.sec));
    const r = el && el.getBoundingClientRect();
    if (r && r.bottom > L.header && r.top < window.innerHeight) {
      secKey = ui.pin.sec;
      if (ui.pin.path) fileKey = { path: ui.pin.path, sec: ui.pin.sec };
      else if (fileKey && fileKey.sec !== secKey) fileKey = null;
    } else ui.pin = null;
  }
  const same = ui.curSec === secKey && (ui.curFile && fileKey ? ui.curFile.path === fileKey.path && ui.curFile.sec === fileKey.sec : ui.curFile === fileKey);
  ui.curFile = fileKey;
  ui.curSec = secKey;
  applyCurrent(!same);
}

export function applyCurrent(scrollToc) {
  const main = $main(), toc = document.getElementById('toc');
  for (const el of main.querySelectorAll('.is-current')) el.classList.remove('is-current');
  for (const el of toc.querySelectorAll('[aria-current]')) el.removeAttribute('aria-current');
  if (ui.curSec) {
    const secEl = main.querySelector(`.sec[data-key="${CSS.escape(ui.curSec)}"]`);
    const secHead = secEl && secEl.querySelector(':scope > .sec-head');
    if (secHead) secHead.classList.add('is-current');
    const row = toc.querySelector(`.toc-group[data-key="${CSS.escape(ui.curSec)}"] .toc-sec`);
    if (row) row.setAttribute('aria-current', 'true');
  }
  let tocRow = null;
  if (ui.curFile) {
    const q = `.sec[data-key="${CSS.escape(ui.curFile.sec)}"] .file[data-path="${CSS.escape(ui.curFile.path)}"] > .file-head`;
    const head = main.querySelector(q);
    if (head) head.classList.add('is-current');
    tocRow = toc.querySelector(`.file-row[data-sec="${CSS.escape(ui.curFile.sec)}"][data-path="${CSS.escape(ui.curFile.path)}"]`);
    if (tocRow) tocRow.setAttribute('aria-current', 'true');
  }
  if (scrollToc && !ui.tocHover) {
    const target = tocRow || toc.querySelector('.toc-sec[aria-current]');
    if (target && toc.scrollHeight > toc.clientHeight) target.scrollIntoView({ block: 'nearest' });
  }
}

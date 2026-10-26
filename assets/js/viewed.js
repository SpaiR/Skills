// Viewed marks for files and chapters, kept in sync with each other.

import { S, secByKey, sections, ui } from './state.js';
import { save } from './persist.js';
import { isViewed, secFiles, sectionOpen } from './model.js';
import { rerenderFile, rerenderSection, withAnchor } from './rerender.js';
import { updateChrome } from './header.js';
import { applyCurrent } from './nav.js';

// Пересчитать отметки глав, где стоят файлы paths. except — глава, которую отметили вручную.
function syncSections(paths, except) {
  const changed = [];
  for (const sec of sections) {
    if (sec.key === except || !sec.diffs.some((d) => paths.has(d.file))) continue;
    const files = secFiles(sec);
    const all = files.length > 0 && files.every(isViewed);
    if (all && !S.reviewed[sec.key]) {
      S.reviewed[sec.key] = true;
      delete S.sectionOpen[sec.key];
      changed.push(sec.key);
    } else if (!all && S.reviewed[sec.key]) {
      S.reviewed[sec.key] = false;
      changed.push(sec.key);
    }
  }
  return changed;
}

export function setFileViewed(file, value, keep) {
  if (value) {
    S.filesViewed[file.path] = file.hash;
    delete S.fileOpen[file.path];
  } else {
    delete S.filesViewed[file.path];
  }
  const changed = syncSections(new Set([file.path]));
  // Отметка закрыла главу (это был её последний файл): на месте остаётся заголовок свёрнутой главы,
  // и текущей становится она, а не файл соседней главы, который поднялся бы под шапку.
  const secEl = keep && keep.closest('.sec');
  const closed = secEl && changed.includes(secEl.dataset.key) && !sectionOpen(secByKey.get(secEl.dataset.key)) ? secEl.dataset.key : null;
  if (closed) {
    keep = secEl.querySelector('.sec-head');
    ui.pin = { sec: closed, path: null };
    ui.curSec = closed;
    ui.curFile = null;
  }
  save();
  withAnchor(() => {
    for (const key of changed) rerenderSection(key);
    rerenderFile(file.path, changed);
  }, keep);
  updateChrome();
  if (closed) applyCurrent(false);
  return closed;
}

export function setSectionViewed(sec, value, keep) {
  S.reviewed[sec.key] = value;
  delete S.sectionOpen[sec.key];
  const paths = new Set();
  for (const f of secFiles(sec)) {
    paths.add(f.path);
    if (value) { S.filesViewed[f.path] = f.hash; delete S.fileOpen[f.path]; }
    else delete S.filesViewed[f.path];
  }
  const changed = [sec.key, ...syncSections(paths, sec.key)];
  save();
  withAnchor(() => {
    for (const key of changed) rerenderSection(key);
    for (const p of paths) rerenderFile(p, changed);
  }, keep);
  updateChrome();
}

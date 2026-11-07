// Viewed marks for files and chapters, kept in sync with each other.

import { updateChrome } from './header.js';
import { isViewed, secFiles, sectionOpen } from './model.js';
import { applyCurrent } from './nav.js';
import { save } from './persist.js';
import { rerenderFile, rerenderSection, withAnchor } from './rerender.js';
import { S, secByKey, sections, ui } from './state.js';

// Recompute the chapter marks of chapters containing paths. except is the chapter marked by hand.
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
  // The mark closed the chapter (it was its last file): the collapsed chapter header stays in place
  // and becomes current, rather than a file of the next chapter that would move up under the top bar.
  const secEl = keep && keep.closest('.sec');
  const closed =
    secEl && changed.includes(secEl.dataset.key) && !sectionOpen(secByKey.get(secEl.dataset.key))
      ? secEl.dataset.key
      : null;
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
    if (value) {
      S.filesViewed[f.path] = f.hash;
      delete S.fileOpen[f.path];
    } else delete S.filesViewed[f.path];
  }
  const changed = [sec.key, ...syncSections(paths, sec.key)];
  save();
  withAnchor(() => {
    for (const key of changed) rerenderSection(key);
    for (const p of paths) rerenderFile(p, changed);
  }, keep);
  updateChrome();
}

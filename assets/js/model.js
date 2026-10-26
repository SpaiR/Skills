// Derived model queries over the review data and user state: groups, viewed/open flags, counters.

import { BIG_FILE_LINES, LOCKFILE, SPLIT_MIN_MAIN } from './constants.js';
import { fileByPath, filesGroup, S, sections, ui } from './state.js';
import { T } from './strings.js';

export const secFiles = (sec) => sec.diffs.map((d) => fileByPath.get(d.file)).filter(Boolean);
export const filesMode = () => S.mode === 'files';
// Groups of the main column in the current mode: the guide chapters or a single headless Files group.
export const groups = () => (filesMode() ? [filesGroup] : sections);
export const groupFor = (path) => (filesMode() ? filesGroup : sections.find((s) => s.diffs.some((d) => d.file === path)) || null);
export const isViewed = (file) => !!S.filesViewed && S.filesViewed[file.path] === file.hash;
export const sectionOpen = (sec) => (sec.headless ? true : sec.key in S.sectionOpen ? !!S.sectionOpen[sec.key] : !S.reviewed[sec.key]);
// Size of the original diff: expanded context does not make a file "big" and does not collapse it.
const lineCount = (file) => file.baseCount;

export function fileOpen(file) {
  if (file.path in S.fileOpen) return !!S.fileOpen[file.path];
  return !collapseReason(file);
}

// Reason for collapsing by default: the first condition that matches.
export function collapseReason(file) {
  if (isViewed(file)) return { text: T.viewedFile };
  if (file.binary) return { text: T.file.binary, noShow: true };
  if (file.status === 'deleted') return { text: T.file.collapsedDeleted(file.deletions) };
  if (LOCKFILE.test(file.path)) return { text: T.file.collapsedLockfile };
  if (lineCount(file) > BIG_FILE_LINES) return { text: T.file.collapsedBig(lineCount(file)) };
  return null;
}

export function secStats(sec) {
  const files = secFiles(sec);
  return {
    files: files.length,
    viewed: files.filter(isViewed).length,
    add: files.reduce((a, f) => a + f.additions, 0),
    del: files.reduce((a, f) => a + f.deletions, 0),
  };
}

// Chapter comments are counted only for chapters in the guide: a comment on a chapter that no longer exists
// does not get into the Markdown (buildMarkdown iterates over sections) and is not visible on the page.
export function commentCount() {
  return S.annotations.length + secComments().length + (S.globalComment.trim() ? 1 : 0);
}

export const fileComments = (path) => S.annotations.filter((a) => a.file === path).length;
export const splitAvailable = () => ui.mainW >= SPLIT_MIN_MAIN;
export const fileView = (file) => (S.viewMode === 'split' && splitAvailable() && file.status !== 'added' && file.status !== 'deleted' ? 'split' : 'unified');

export const secComments = () => sections.filter((s) => (S.sectionComments[s.key] || '').trim());

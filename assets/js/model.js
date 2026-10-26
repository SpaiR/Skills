// Derived model queries over the review data and user state: groups, viewed/open flags, counters.

import { BIG_FILE_LINES, LINES, LOCKFILE, SPLIT_MIN_MAIN } from './constants.js';
import { fileByPath, filesGroup, S, sections, ui } from './state.js';
import { plural } from './dom.js';

export const secFiles = (sec) => sec.diffs.map((d) => fileByPath.get(d.file)).filter(Boolean);
export const filesMode = () => S.mode === 'files';
// Группы основной колонки в текущем режиме: главы гайда или одна безголовая группа «Файлы».
export const groups = () => (filesMode() ? [filesGroup] : sections);
export const groupFor = (path) => (filesMode() ? filesGroup : sections.find((s) => s.diffs.some((d) => d.file === path)) || null);
export const isViewed = (file) => !!S.filesViewed && S.filesViewed[file.path] === file.hash;
export const sectionOpen = (sec) => (sec.headless ? true : sec.key in S.sectionOpen ? !!S.sectionOpen[sec.key] : !S.reviewed[sec.key]);
// Размер исходного диффа: раскрытый контекст не делает файл «большим» и не сворачивает его.
const lineCount = (file) => file.baseCount;

export function fileOpen(file) {
  if (file.path in S.fileOpen) return !!S.fileOpen[file.path];
  return !collapseReason(file);
}

// Причина сворачивания по умолчанию — первое сработавшее условие (3.6).
export function collapseReason(file) {
  if (isViewed(file)) return { text: 'Просмотрен' };
  if (file.binary) return { text: 'Бинарный файл — содержимое не показывается', noShow: true };
  if (file.status === 'deleted') return { text: `Удалён, ${plural(file.deletions, LINES)}` };
  if (LOCKFILE.test(file.path)) return { text: 'Lock-файл — обычно не читают' };
  if (lineCount(file) > BIG_FILE_LINES) return { text: `Большой дифф: ${plural(lineCount(file), LINES)}` };
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

// Комментарии к главам считаются только у глав из гайда: комментарий к главе, которой больше нет,
// в Markdown не попадает (buildMarkdown идёт по sections) и на странице не виден.
export function commentCount() {
  return S.annotations.length + secComments().length + (S.globalComment.trim() ? 1 : 0);
}

export const fileComments = (path) => S.annotations.filter((a) => a.file === path).length;
export const splitAvailable = () => ui.mainW >= SPLIT_MIN_MAIN;
export const fileView = (file) => (S.viewMode === 'split' && splitAvailable() && file.status !== 'added' && file.status !== 'deleted' ? 'split' : 'unified');

export const secComments = () => sections.filter((s) => (S.sectionComments[s.key] || '').trim());

// Server API calls and persistence of the user state: normalization, migration, debounced saves.

import * as D from './diffcore.js';
import { TOKEN, TREE_MAX, TREE_MIN } from './constants.js';
import { finished, S, sections } from './state.js';
import { secFiles } from './model.js';

export async function api(method, path, body, keepalive) {
  const res = await fetch(path, {
    method,
    keepalive: !!keepalive,
    headers: { 'X-Review-Token': TOKEN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return {
    version: 1,
    reviewed: obj(s.reviewed),
    sectionOpen: obj(s.sectionOpen),
    fileOpen: obj(s.fileOpen),
    annotations: Array.isArray(s.annotations) ? s.annotations : [],
    sectionComments: obj(s.sectionComments),
    globalComment: typeof s.globalComment === 'string' ? s.globalComment : '',
    viewMode: s.viewMode === 'split' ? 'split' : 'unified',
    filesViewed: s.filesViewed && typeof s.filesViewed === 'object' ? s.filesViewed : null, // null: filled in by the migration
    drafts: obj(s.drafts),
    wrap: s.wrap !== false,
    theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'auto',
    tocOpen: typeof s.tocOpen === 'boolean' ? s.tocOpen : null,
    mode: s.mode === 'files' ? 'files' : 'guide',
    treeCollapsed: obj(s.treeCollapsed),
    treeW: Number.isFinite(s.treeW) ? Math.min(TREE_MAX, Math.max(TREE_MIN, s.treeW)) : null,
    hideViewed: !!s.hideViewed,
    // Expanded context per file: {ranges: [[from, to]] in new line numbers, full: whole file}.
    expanded: Object.fromEntries(Object.entries(obj(s.expanded))
      .map(([p, e]) => [p, { ranges: D.mergeRanges(Array.isArray(e && e.ranges) ? e.ranges : []), full: !!(e && e.full) }])
      .filter(([, e]) => e.full || e.ranges.length)),
  };
}

// State from an older version: files of chapters already marked as viewed count as viewed.
export function migrateFilesViewed() {
  if (S.filesViewed) return;
  S.filesViewed = {};
  for (const sec of sections) {
    if (!S.reviewed[sec.key]) continue;
    for (const f of secFiles(sec)) S.filesViewed[f.path] = f.hash;
  }
}

let saveTimer = null;
export function save() {
  if (finished) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    api('PUT', '/api/state', S).then(hideSaveError, showSaveError);
  }, 400);
}
export function flushSave() {
  if (finished || !saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  api('PUT', '/api/state', S, true).catch(() => {});
}
function showSaveError() {
  const bar = document.getElementById('save-error');
  if (bar) bar.hidden = false;
}
function hideSaveError() {
  const bar = document.getElementById('save-error');
  if (bar) bar.hidden = true;
}

// Drop a pending debounced save: the caller writes the state itself right away.
export function cancelSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
}

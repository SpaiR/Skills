// File tree sidebar of Files mode: tree building, path filter, "hide viewed", resizer, tree keyboard.

import { TREE_DEFAULT, TREE_MAX, TREE_MIN } from './constants.js';
import { fileByPath, filesGroup, R, S, treeRoot, ui } from './state.js';
import { $main, basename, h, icon, plural } from './dom.js';
import { save } from './persist.js';
import { fileComments, isViewed } from './model.js';
import { withAnchor } from './rerender.js';
import { statPair, statusBadge } from './toc.js';
import { applyModeLayout } from './modes.js';
import { jumpToFile, queueTrack } from './nav.js';
import { filterStatus } from './section.js';
import { LOCALE, T, WORDS } from './strings.js';

// Directories before files, everything alphabetical with numeric ordering. A directory without files and with a single
// subdirectory is merged with it into one row: src/core/.
export function buildTree(paths) {
  const coll = new Intl.Collator(LOCALE, { numeric: true, sensitivity: 'base' });
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let k = 0; k < parts.length - 1; k++) {
      if (!node.dirs.has(parts[k])) node.dirs.set(parts[k], { name: parts[k], path: parts.slice(0, k + 1).join('/'), dirs: new Map(), files: [] });
      node = node.dirs.get(parts[k]);
    }
    node.files.push(p);
  }
  const finish = (node) => {
    node.dirs = [...node.dirs.values()].map((d) => {
      let dir = finish(d);
      while (!dir.files.length && dir.dirs.length === 1) {
        const only = dir.dirs[0];
        dir = { ...only, name: `${dir.name}/${only.name}` };
      }
      return dir;
    }).sort((a, b) => coll.compare(a.name, b.name));
    node.files.sort((a, b) => coll.compare(basename(a), basename(b)));
    node.all = [...node.dirs.flatMap((d) => d.all), ...node.files];
    return node;
  };
  return finish(root);
}

export function computeVisible() {
  const terms = ui.filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length && !S.hideViewed) { ui.visible = null; return; }
  ui.visible = new Set(R.files.map((f) => f.path).filter((p) =>
    terms.every((t) => p.toLowerCase().includes(t)) && !(S.hideViewed && isViewed(fileByPath.get(p)))));
}

// The filter changes only card visibility: no re-render, withAnchor keeps the reading position.
function applyVisible() {
  computeVisible();
  withAnchor(() => {
    for (const el of $main().querySelectorAll('.sec.headless > .file')) el.hidden = !!ui.visible && !ui.visible.has(el.dataset.path);
    const st = $main().querySelector('.sec.headless > .filter-status');
    if (st) st.replaceWith(filterStatus());
  });
  renderTree();
  queueTrack();
}

export function resetFilter() {
  ui.filter = '';
  S.hideViewed = false;
  save();
  const input = document.getElementById('tree-filter');
  if (input) input.value = '';
  const hide = document.getElementById('tree-hide-viewed');
  if (hide) hide.checked = false;
  applyVisible();
}

function treeHead() {
  const input = h('input', {
    id: 'tree-filter', type: 'search', class: 'tree-input', placeholder: T.toc.filterPlaceholder, autocomplete: 'off', spellcheck: 'false',
    'aria-label': T.toc.filterAria, 'aria-keyshortcuts': '/',
  });
  input.value = ui.filter;
  input.addEventListener('input', () => { ui.filter = input.value; applyVisible(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (input.value) { input.value = ''; ui.filter = ''; applyVisible(); } else input.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = document.querySelector('#toc .tree-row');
      if (first) focusTreeRow(first);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const first = document.querySelector('#toc .tree-file');
      if (first) jumpToFile(first.dataset.path, first.dataset.sec);
    }
  });
  const hide = h('input', { id: 'tree-hide-viewed', type: 'checkbox', class: 'check', checked: S.hideViewed });
  hide.addEventListener('change', () => { S.hideViewed = hide.checked; save(); applyVisible(); });
  return h('div', { class: 'tree-head' },
    h('div', { class: 'tree-title' }, h('span', { class: 'toc-label' }, T.toc.files), h('span', { class: 'tree-progress', title: T.viewedFiles })),
    h('div', { class: 'tree-filter' }, icon('search'), input),
    h('label', { class: 'tree-opt' }, hide, h('span', {}, T.toc.hideViewed)));
}

function treeResizer() {
  const bar = h('div', {
    class: 'tree-resize', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': T.toc.resizeAria,
    'aria-valuemin': String(TREE_MIN), 'aria-valuemax': String(TREE_MAX), 'aria-valuenow': String(S.treeW || TREE_DEFAULT),
    title: T.toc.resizeTitle,
  });
  const set = (w) => {
    S.treeW = Math.round(Math.min(TREE_MAX, Math.max(TREE_MIN, w)));
    bar.setAttribute('aria-valuenow', String(S.treeW));
    applyModeLayout();
  };
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const left = document.getElementById('toc').getBoundingClientRect().left;
    document.body.classList.add('resizing');
    const move = (ev) => set(ev.clientX - left);
    const up = () => {
      bar.removeEventListener('pointermove', move);
      document.body.classList.remove('resizing');
      save();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
    bar.addEventListener('pointercancel', up, { once: true });
  });
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    set((S.treeW || TREE_DEFAULT) + (e.key === 'ArrowRight' ? 16 : -16));
    save();
  });
  return bar;
}

function treeDirRow(d, level, open, viewed) {
  const total = d.all.length;
  return h('div', {
    class: `tree-row tree-dir${viewed === total ? ' done' : ''}`, role: 'treeitem', tabindex: '-1',
    'aria-level': String(level), 'aria-expanded': String(open), style: `--lvl: ${level}`, title: d.path,
    dataset: { act: 'tree-dir', dir: d.path, tkey: `d:${d.path}` },
  },
  icon('chevron', 'chev'),
  h('span', { class: 'tree-name' }, `${d.name}/`),
  h('span', { class: 'tree-count', title: T.viewedFiles }, `${viewed}/${total}`));
}

function treeFileRow(file, level) {
  const comments = fileComments(file.path);
  const viewed = isViewed(file);
  const current = ui.curFile && ui.curFile.path === file.path && ui.curFile.sec === filesGroup.key;
  return h('div', {
    class: `tree-row tree-file file-row${viewed ? ' viewed' : ''}`, role: 'treeitem', tabindex: '-1',
    'aria-level': String(level), style: `--lvl: ${level}`, title: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path,
    'aria-current': current ? 'true' : null,
    dataset: { act: 'goto-file', path: file.path, sec: filesGroup.key, tkey: `f:${file.path}` },
  },
  statusBadge(file, true),
  h('span', { class: 'fr-name' }, h('span', { class: 'fr-base' }, basename(file.path))),
  h('span', { class: 'fr-meta' },
    comments > 0 && h('span', { class: 'fr-comments', title: plural(comments, WORDS.notes) }, icon('comment'), String(comments)),
    statPair(file.additions, file.deletions, file.binary),
    viewed && h('span', { class: 'fr-check', title: T.viewedFile }, icon('check'))));
}

export function renderTree() {
  const toc = document.getElementById('toc');
  let list = toc.querySelector(':scope > .tree');
  if (!list) {
    list = h('div', { class: 'tree', role: 'tree', 'aria-label': T.toc.files });
    list.addEventListener('keydown', onTreeKey);
    toc.replaceChildren(treeHead(), list,
      h('button', { class: 'toc-help', type: 'button', dataset: { act: 'help' }, 'aria-keyshortcuts': '?' }, h('kbd', {}, '?'), T.helpButton),
      treeResizer());
  }
  const total = R.files.length;
  const viewedAll = R.files.filter((f) => isViewed(fileByPath.get(f.path))).length;
  toc.querySelector('.tree-progress').textContent = `${viewedAll} / ${total}`;
  const active = document.activeElement;
  const focusKey = active && list.contains(active) ? active.dataset.tkey : null;
  const scroll = toc.scrollTop;
  const filtering = !!ui.visible;
  const rows = [];
  const walk = (node, level) => {
    for (const d of node.dirs) {
      if (filtering && !d.all.some((p) => ui.visible.has(p))) continue;
      const open = filtering || !S.treeCollapsed[d.path];
      rows.push(treeDirRow(d, level, open, d.all.filter((p) => isViewed(fileByPath.get(p))).length));
      if (open) walk(d, level + 1);
    }
    for (const p of node.files) if (!filtering || ui.visible.has(p)) rows.push(treeFileRow(fileByPath.get(p), level));
  };
  walk(treeRoot, 1);
  list.replaceChildren(...(rows.length ? rows : [h('div', { class: 'tree-empty' }, T.toc.noMatch)]));
  // One tree item in the Tab order (roving tabindex): the one that had focus, the current file, or the first.
  const pick = (focusKey && list.querySelector(`[data-tkey="${CSS.escape(focusKey)}"]`))
    || list.querySelector('.tree-row[aria-current]') || list.querySelector('.tree-row');
  if (pick) pick.tabIndex = 0;
  if (focusKey && pick) pick.focus({ preventScroll: true });
  toc.scrollTop = scroll;
}

function focusTreeRow(row) {
  for (const r of document.querySelectorAll('#toc .tree-row[tabindex="0"]')) r.tabIndex = -1;
  row.tabIndex = 0;
  row.focus();
}

export function toggleTreeDir(dir, open) {
  const now = !S.treeCollapsed[dir];
  const want = open == null ? !now : open;
  if (want === now) return;
  if (want) delete S.treeCollapsed[dir];
  else S.treeCollapsed[dir] = true;
  save();
  renderTree();
}

// Tree keyboard following the ARIA tree pattern: arrows, Home/End, Enter/Space. Letters go to the global shortcuts.
function onTreeKey(e) {
  const row = e.target.closest('.tree-row');
  if (!row || e.altKey || e.ctrlKey || e.metaKey) return;
  const rows = [...document.querySelectorAll('#toc .tree-row')];
  const i = rows.indexOf(row);
  const isDir = row.classList.contains('tree-dir');
  const open = row.getAttribute('aria-expanded') === 'true';
  const level = +row.getAttribute('aria-level');
  let to = null;
  switch (e.key) {
    case 'ArrowDown': to = rows[i + 1]; break;
    case 'ArrowUp': to = rows[i - 1] || null; if (!to) { e.preventDefault(); document.getElementById('tree-filter').focus(); return; } break;
    case 'Home': to = rows[0]; break;
    case 'End': to = rows[rows.length - 1]; break;
    case 'ArrowRight':
      if (isDir && !open && !ui.visible) { toggleTreeDir(row.dataset.dir, true); break; }
      if (isDir && open) to = rows[i + 1];
      break;
    case 'ArrowLeft':
      if (isDir && open && !ui.visible) { toggleTreeDir(row.dataset.dir, false); break; }
      for (let k = i - 1; k >= 0; k--) if (+rows[k].getAttribute('aria-level') < level) { to = rows[k]; break; }
      break;
    case 'Enter': case ' ':
      row.click();
      break;
    default: return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (to) focusTreeRow(to);
}

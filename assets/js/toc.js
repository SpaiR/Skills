// Sidebar in Guide mode: chapter list, slide-out drawer on narrow screens, file rows and badges.

import { narrowScreen, STATUS } from './constants.js';
import { $main, basename, dirname, h, icon, pad2, plural } from './dom.js';
import { openHelp } from './help.js';
import { fileComments, filesMode, isViewed, secFiles, secStats } from './model.js';
import { jumpToFile, jumpToSection } from './nav.js';
import { save } from './persist.js';
import { fileQ, secQ } from './rerender.js';
import { S, secByKey, sections, ui } from './state.js';
import { T, WORDS } from './strings.js';
import { renderTree, toggleTreeDir } from './tree.js';
import { setSectionViewed } from './viewed.js';

export const tocVisible = () => (narrowScreen.matches ? ui.drawer : S.tocOpen !== false);

export function applyTocState() {
  document.body.classList.toggle('toc-hidden', !narrowScreen.matches && S.tocOpen === false);
  document.body.classList.toggle('toc-drawer-open', narrowScreen.matches && ui.drawer);
  const btn = document.getElementById('toc-btn');
  if (btn) btn.setAttribute('aria-expanded', String(tocVisible()));
}

export function toggleToc() {
  if (narrowScreen.matches) {
    setDrawer(!ui.drawer);
    return;
  }
  S.tocOpen = S.tocOpen === false;
  save();
  applyTocState();
}

// Slide-out contents (window narrower than 1100px). On open, focus goes to the current chapter row;
// on close it returns to the Contents button if it was inside the panel.
export function setDrawer(open) {
  const toc = document.getElementById('toc');
  const inside = toc.contains(document.activeElement);
  ui.drawer = open;
  applyTocState();
  if (open) {
    const row = filesMode()
      ? toc.querySelector('.tree-row[aria-current]') || toc.querySelector('.tree-row')
      : toc.querySelector('.toc-sec[aria-current] .toc-sec-go') || toc.querySelector('.toc-sec-go');
    if (!row) return;
    row.focus({ preventScroll: true });
    const r = row.getBoundingClientRect(),
      box = toc.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) toc.scrollTop += r.top - box.top - box.height / 3;
  } else if (inside) {
    document.getElementById('toc-btn').focus({ preventScroll: true });
  }
}

// Tab cycles inside the open panel; Shift+Tab from the first row goes to the Contents button,
// and Tab from that button goes into the panel: the panel comes right after the button, not after the whole top bar.
export function onDrawerTab(e) {
  if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey || !(narrowScreen.matches && ui.drawer)) return;
  const toc = document.getElementById('toc');
  const items = [...toc.querySelectorAll('button, input, .tree-row[tabindex="0"]')].filter(
    (el) => el.getClientRects().length,
  );
  if (!items.length) return;
  const a = document.activeElement,
    first = items[0],
    last = items[items.length - 1];
  const btn = document.getElementById('toc-btn');
  let to = null;
  if (a === btn && !e.shiftKey) to = first;
  else if (a === first && e.shiftKey) to = btn;
  else if (a === last && !e.shiftKey) to = first;
  if (to) {
    e.preventDefault();
    to.focus();
  }
}

// "+N −M": a zero part is grey, since a red "−0" on new files says nothing. A binary file has no lines.
export function statPair(add, del, binary) {
  if (binary) return h('span', { class: 'stat-bin' }, T.binaryStat);
  return [
    h('span', { class: add ? 'stat-add' : 'stat-zero' }, `+${add}`),
    ' ',
    h('span', { class: del ? 'stat-del' : 'stat-zero' }, `−${del}`),
  ];
}

export function statusBadge(file, small) {
  const st = file.status in STATUS ? file.status : 'modified';
  return h('span', { class: `status st-${file.status}${small ? ' sm' : ''}`, title: T.status[st] }, STATUS[st]);
}

// File row: in the contents and in the "Chapter files" list.
export function fileRow(file, sec, inToc) {
  const comments = fileComments(file.path);
  const viewed = isViewed(file);
  const current = ui.curFile && ui.curFile.path === file.path && ui.curFile.sec === sec.key;
  return h(
    'button',
    {
      class: `file-row${viewed ? ' viewed' : ''}`,
      type: 'button',
      title: file.path,
      dataset: { act: 'goto-file', path: file.path, sec: sec.key },
      'aria-current': inToc && current ? 'true' : null,
    },
    statusBadge(file, true),
    h(
      'span',
      { class: 'fr-name' },
      h('span', { class: 'fr-base' }, basename(file.path)),
      h('span', { class: 'fr-dir' }, dirname(file.path)),
    ),
    h(
      'span',
      { class: 'fr-meta' },
      comments > 0 &&
        h('span', { class: 'fr-comments', title: plural(comments, WORDS.notes) }, icon('comment'), String(comments)),
      statPair(file.additions, file.deletions, file.binary),
      viewed && h('span', { class: 'fr-check', title: T.viewedFile }, icon('check')),
    ),
  );
}

export function renderToc() {
  if (filesMode()) {
    renderTree();
    return;
  }
  const toc = document.getElementById('toc');
  const scroll = toc.scrollTop;
  toc.replaceChildren(
    h('div', { class: 'toc-label' }, T.toc.chapters),
    h(
      'div',
      { class: 'toc-list' },
      sections.map((sec) => {
        const st = secStats(sec);
        const done = !!S.reviewed[sec.key];
        const state = done ? 'full' : st.viewed > 0 ? 'half' : 'empty';
        const current = ui.curSec === sec.key;
        return h(
          'div',
          { class: `toc-group${done ? ' reviewed' : ''}`, dataset: { key: sec.key } },
          h(
            'div',
            { class: 'toc-sec', 'aria-current': current ? 'true' : null },
            h(
              'button',
              {
                class: `toc-status ${state}`,
                type: 'button',
                dataset: { act: 'toc-sec-viewed', key: sec.key },
                'aria-label': T.toc.markChapter(sec.title),
                'aria-pressed': String(done),
                title: done ? T.toc.chapterViewed : T.toc.markChapterTitle,
              },
              state === 'full' && icon('check'),
            ),
            h(
              'button',
              { class: 'toc-sec-go', type: 'button', dataset: { act: 'goto-sec', key: sec.key } },
              h('span', { class: 'toc-num' }, sec.synthetic ? '—' : pad2(sec.idx + 1)),
              h('span', { class: 'toc-title' }, sec.title),
              h('span', { class: 'toc-count', title: T.viewedFiles }, `${st.viewed}/${st.files}`),
            ),
          ),
          !done &&
            st.files > 0 &&
            h(
              'div',
              { class: 'toc-files' },
              secFiles(sec).map((f) => fileRow(f, sec, true)),
            ),
        );
      }),
    ),
    h(
      'button',
      { class: 'toc-help', type: 'button', dataset: { act: 'help' }, 'aria-keyshortcuts': '?' },
      h('kbd', {}, '?'),
      T.helpButton,
    ),
  );
  toc.scrollTop = scroll;
}

export function onTocClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'toc-sec-viewed') {
    const sec = secByKey.get(btn.dataset.key);
    setSectionViewed(sec, !S.reviewed[sec.key]);
    return;
  }
  if (act === 'help') {
    openHelp();
    return;
  }
  if (act === 'tree-dir') {
    toggleTreeDir(btn.dataset.dir);
    return;
  }
  if (act === 'goto-sec') jumpToSection(btn.dataset.key);
  if (act === 'goto-file') jumpToFile(btn.dataset.path, btn.dataset.sec);
  if (narrowScreen.matches && ui.drawer) {
    setDrawer(false);
    // From the keyboard, focus goes to the jump target, not to the Contents button.
    if (e.detail === 0) {
      const q =
        act === 'goto-file'
          ? `${fileQ(btn.dataset.sec, btn.dataset.path)} .file-toggle`
          : `${secQ(btn.dataset.key)} .sec-toggle`;
      const t = $main().querySelector(q);
      if (t) t.focus({ preventScroll: true });
    }
  }
}

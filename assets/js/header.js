// Top bar: mode and view switches, progress, submit buttons.

import { isMac, MOD_ENTER } from './constants.js';
import * as D from './diffcore.js';
import { h, icon } from './dom.js';
import { toggleMenu } from './menu.js';
import { commentCount, isViewed, splitAvailable } from './model.js';
import { setMode } from './modes.js';
import { canPublish, openPublish } from './publish.js';
import { fileByPath, R, S, sections } from './state.js';
import { T, WORDS } from './strings.js';
import { openSubmit } from './submit.js';
import { renderToc, tocVisible, toggleToc } from './toc.js';
import { setViewMode } from './view.js';

export function renderHeader() {
  const m = R.meta;
  const ctx = m.worktree
    ? `${m.repoName} (worktree ${m.worktree})`
    : `${m.repoName}${m.branch ? ` · ${T.branch(m.branch)}` : ''}`;
  const range = T.rangeLabel(m);
  const pr = m.pr;
  const top = document.getElementById('top');
  top.replaceChildren(
    h(
      'div',
      { class: 'top-left' },
      h(
        'button',
        {
          class: 'icon-btn',
          id: 'toc-btn',
          type: 'button',
          'aria-label': T.header.sidebar,
          title: T.header.sidebarTitle,
          'aria-keyshortcuts': 'T',
          'aria-controls': 'toc',
          onclick: toggleToc,
        },
        icon('sidebar'),
      ),
      h(
        'div',
        { class: 'seg mode-seg', role: 'group', 'aria-label': T.header.mode, 'aria-keyshortcuts': 'G' },
        [
          ['guide', T.header.guide],
          ['files', T.header.files],
        ].map(([mode, label]) =>
          h(
            'button',
            {
              type: 'button',
              dataset: { mode },
              title: `${label} (G)`,
              onclick: () => setMode(mode),
            },
            label,
          ),
        ),
      ),
      pr
        ? h(
            'a',
            {
              class: 'range-label',
              href: pr.url,
              target: '_blank',
              rel: 'noopener noreferrer',
              title: T.pr.open(pr.provider),
            },
            range,
          )
        : h('span', { class: 'range-label', title: range }, range),
      pr && h('span', { class: `pr-state is-${pr.state === 'open' && pr.draft ? 'draft' : pr.state}` }, T.pr.state(pr)),
      h(
        'div',
        { class: 'top-ctx' },
        h('span', { class: 'ctx-repo', title: m.root }, ctx),
        h('span', { class: 'ctx-title', 'aria-hidden': 'true' }, R.guide.title),
      ),
    ),
    h(
      'div',
      { class: 'top-right' },
      h(
        'div',
        { class: 'progress', id: 'progress', role: 'status' },
        h(
          'div',
          { class: 'progress-text' },
          h('span', { class: 'progress-num' }),
          ' ',
          h('span', { class: 'progress-cap' }),
        ),
        h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill' })),
      ),
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': T.header.diffView, 'aria-keyshortcuts': 'S' },
        ['unified', 'split'].map((mode) =>
          h(
            'button',
            {
              type: 'button',
              dataset: { mode },
              onclick: () => setViewMode(mode),
            },
            mode === 'unified' ? T.header.unified : T.header.split,
          ),
        ),
      ),
      h(
        'button',
        {
          class: 'icon-btn',
          id: 'more-btn',
          type: 'button',
          'aria-label': T.header.more,
          title: T.header.more,
          'aria-haspopup': 'menu',
          'aria-expanded': 'false',
          onclick: toggleMenu,
        },
        icon('more'),
      ),
      canPublish() &&
        h(
          'button',
          {
            class: 'btn',
            id: 'publish-btn',
            type: 'button',
            title: T.header.publish(pr.provider),
            'aria-label': T.header.publish(pr.provider),
            onclick: openPublish,
          },
          h('span', { class: 'btn-text' }, T.header.publishShort),
        ),
      h(
        'button',
        {
          class: 'btn',
          id: 'approve-btn',
          type: 'button',
          'aria-label': T.header.approve,
          onclick: () => openSubmit('approve'),
        },
        icon('check'),
        h('span', { class: 'btn-text' }, T.header.approve),
      ),
      h(
        'button',
        {
          class: 'btn primary',
          id: 'submit-btn',
          type: 'button',
          'aria-keyshortcuts': isMac ? 'Meta+Enter' : 'Control+Enter',
          title: T.header.submitTitle(MOD_ENTER),
          onclick: () => openSubmit('feedback'),
        },
        T.header.submit,
        h('span', { class: 'badge', id: 'comment-count' }, '0'),
      ),
    ),
    h('div', { id: 'save-error', role: 'alert', hidden: true }, T.header.saveError),
  );
}

export function updateHeader() {
  const total = R.files.length;
  const viewed = R.files.filter((f) => isViewed(fileByPath.get(f.path))).length;
  const secDone = sections.filter((s) => S.reviewed[s.key]).length;
  const all = total > 0 && viewed === total;
  const p = document.getElementById('progress');
  p.classList.toggle('done', all);
  p.title = T.header.progressTitle(viewed, total, secDone, sections.length);
  p.querySelector('.progress-num').textContent = all ? T.header.allViewed : `${viewed} / ${total}`;
  p.querySelector('.progress-cap').textContent = all ? '' : D.plural(total, WORDS.files);
  p.querySelector('.progress-fill').style.width = `${total ? (100 * viewed) / total : 0}%`;
  for (const b of document.querySelectorAll('#top .mode-seg button'))
    b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode));
  for (const b of document.querySelectorAll('#top .seg:not(.mode-seg) button')) {
    b.setAttribute(
      'aria-pressed',
      String(b.dataset.mode === (S.viewMode === 'split' && splitAvailable() ? 'split' : 'unified')),
    );
    if (b.dataset.mode === 'split') {
      b.disabled = !splitAvailable();
      b.title = splitAvailable() ? T.header.splitTitle : T.header.splitUnavailable;
    } else b.title = T.header.unifiedTitle;
  }
  document.getElementById('comment-count').textContent = String(commentCount());
  document.getElementById('toc-btn').setAttribute('aria-expanded', String(tocVisible()));
}

export function updateChrome() {
  updateHeader();
  renderToc();
}

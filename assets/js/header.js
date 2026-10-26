// Top bar: mode and view switches, progress, submit buttons.

import * as D from './diffcore.js';
import { FILES, isMac, MOD_ENTER } from './constants.js';
import { fileByPath, R, S, sections } from './state.js';
import { h, icon } from './dom.js';
import { commentCount, isViewed, splitAvailable } from './model.js';
import { renderToc, tocVisible, toggleToc } from './toc.js';
import { setMode } from './modes.js';
import { setViewMode } from './view.js';
import { toggleMenu } from './menu.js';
import { openSubmit } from './submit.js';

export function renderHeader() {
  const m = R.meta;
  const ctx = m.worktree ? `${m.repoName} (worktree ${m.worktree})` : `${m.repoName}${m.branch ? ` · ветка ${m.branch}` : ''}`;
  const top = document.getElementById('top');
  top.replaceChildren(
    h('div', { class: 'top-left' },
      h('button', { class: 'icon-btn', id: 'toc-btn', type: 'button', 'aria-label': 'Боковая панель', title: 'Боковая панель (T)', 'aria-keyshortcuts': 'T', 'aria-controls': 'toc', onclick: toggleToc }, icon('sidebar')),
      h('div', { class: 'seg mode-seg', role: 'group', 'aria-label': 'Режим', 'aria-keyshortcuts': 'G' },
        [['guide', 'Гайд'], ['files', 'Файлы']].map(([mode, label]) => h('button', {
          type: 'button', dataset: { mode }, title: `${label} (G)`, onclick: () => setMode(mode),
        }, label))),
      h('span', { class: 'range-label', title: m.label }, m.label),
      h('div', { class: 'top-ctx' },
        h('span', { class: 'ctx-repo', title: m.root }, ctx),
        h('span', { class: 'ctx-title', 'aria-hidden': 'true' }, R.guide.title))),
    h('div', { class: 'top-right' },
      h('div', { class: 'progress', id: 'progress', role: 'status' },
        h('div', { class: 'progress-text' }, h('span', { class: 'progress-num' }), ' ', h('span', { class: 'progress-cap' })),
        h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill' }))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Вид диффа', 'aria-keyshortcuts': 'S' },
        ['unified', 'split'].map((mode) => h('button', {
          type: 'button', dataset: { mode },
          onclick: () => setViewMode(mode),
        }, mode === 'unified' ? 'Единый' : 'Рядом'))),
      h('button', { class: 'icon-btn', id: 'more-btn', type: 'button', 'aria-label': 'Ещё', title: 'Ещё', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: toggleMenu }, icon('more')),
      h('button', { class: 'btn', id: 'approve-btn', type: 'button', 'aria-label': 'Одобрить', onclick: () => openSubmit('approve') }, icon('check'), h('span', { class: 'btn-text' }, 'Одобрить')),
      h('button', { class: 'btn primary', id: 'submit-btn', type: 'button', 'aria-keyshortcuts': isMac ? 'Meta+Enter' : 'Control+Enter', title: `Отправить фидбек (${MOD_ENTER})`, onclick: () => openSubmit('feedback') },
        'Отправить фидбек', h('span', { class: 'badge', id: 'comment-count' }, '0'))),
    h('div', { id: 'save-error', role: 'alert', hidden: true },
      'Не удалось сохранить прогресс: сервер недоступен. Комментарии на странице пока целы, но отправить их не получится.'),
  );
}

export function updateHeader() {
  const total = R.files.length;
  const viewed = R.files.filter((f) => isViewed(fileByPath.get(f.path))).length;
  const secDone = sections.filter((s) => S.reviewed[s.key]).length;
  const all = total > 0 && viewed === total;
  const p = document.getElementById('progress');
  p.classList.toggle('done', all);
  p.title = `Просмотрено файлов: ${viewed} из ${total}, глав: ${secDone} из ${sections.length}`;
  p.querySelector('.progress-num').textContent = all ? 'Всё просмотрено' : `${viewed} / ${total}`;
  p.querySelector('.progress-cap').textContent = all ? '' : D.plural(total, FILES);
  p.querySelector('.progress-fill').style.width = `${total ? (100 * viewed) / total : 0}%`;
  for (const b of document.querySelectorAll('#top .mode-seg button')) b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode));
  for (const b of document.querySelectorAll('#top .seg:not(.mode-seg) button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === (S.viewMode === 'split' && splitAvailable() ? 'split' : 'unified')));
    if (b.dataset.mode === 'split') {
      b.disabled = !splitAvailable();
      b.title = splitAvailable() ? 'Рядом (S)' : 'Недостаточно ширины';
    } else b.title = 'Единый (S)';
  }
  document.getElementById('comment-count').textContent = String(commentCount());
  document.getElementById('toc-btn').setAttribute('aria-expanded', String(tocVisible()));
}

export function updateChrome() {
  updateHeader();
  renderToc();
}

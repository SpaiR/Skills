// Main column: the hero block, chapter cards, the Files mode group and chapter comments.

import { FILES, isMac, MOD_ENTER } from './constants.js';
import { finished, R, S, secByKey, sections, ui } from './state.js';
import { $main, h, icon, pad2, plural } from './dom.js';
import { save } from './persist.js';
import { md } from './markdown.js';
import { filesMode, groups, secFiles, secStats, sectionOpen } from './model.js';
import { rerenderSection, secQ, withAnchor } from './rerender.js';
import { updateChrome, updateHeader } from './header.js';
import { fileRow, statPair } from './toc.js';
import { renderFile } from './file.js';
import { fitTextarea } from './comments.js';
import { closeForm, revealEditor } from './forms.js';
import { toast } from './toast.js';

// In Files mode, no intent: people read code there, not the story of the change.
function renderHero() {
  const g = R.guide, m = R.meta, t = m.totals;
  const compact = filesMode();
  const commits = m.commits || [];
  const meta = [
    m.label,
    m.branch && `ветка ${m.branch}`,
    m.worktree ? `${m.repoName} (worktree ${m.worktree})` : m.repoName,
    plural(t.files, FILES),
    statPair(t.additions, t.deletions),
    commits.length > 0 && plural(commits.length, ['коммит', 'коммита', 'коммитов']),
    g.generator && g.generator.model && `гайд: ${g.generator.model}`,
  ].filter(Boolean);
  return h('header', { class: 'hero' },
    h('h1', { id: 'review-title' }, g.title),
    !compact && g.intent && h('div', { class: 'intent md', html: md(g.intent) }),
    h('div', { class: 'hero-meta' }, meta.flatMap((part, i) => (i ? [h('span', { class: 'sep' }, ' · '), part] : [part]))),
    (m.notes || []).map((note) => h('div', { class: 'callout callout-note' }, note)),
    commits.length > 0 && h('details', { class: 'commits' },
      h('summary', {}, h('span', { class: 'marker', 'aria-hidden': 'true' }, '›'), `Коммиты · ${commits.length}`),
      h('ul', {}, commits.map((c) => {
        const sp = c.indexOf(' ');
        return h('li', {}, h('code', { class: 'hash' }, sp > 0 ? c.slice(0, sp) : c), h('span', {}, sp > 0 ? c.slice(sp + 1) : ''));
      }))),
    m.untrackedIncluded > 0 && h('p', { class: 'hero-untracked' }, `Включены неотслеживаемые файлы: ${m.untrackedIncluded}`));
}

export function renderMain() {
  $main().replaceChildren(renderHero(), ...groups().map(renderSection));
}

// Headless group of Files mode: only the filter row and the file cards.
function renderFilesGroup(sec) {
  return h('section', { class: 'sec headless', id: sec.key, dataset: { key: sec.key }, 'aria-label': 'Файлы' },
    filterStatus(),
    secFiles(sec).map((f) => renderFile(f, sec)));
}

export function filterStatus() {
  const total = R.files.length, shown = ui.visible ? ui.visible.size : total;
  return h('div', { class: 'filter-status', hidden: !ui.visible, role: 'status' },
    h('span', {}, `Показано ${shown} из ${plural(total, FILES)}`),
    h('button', { class: 'btn sm ghost', type: 'button', dataset: { act: 'filter-reset' } }, 'Сбросить фильтр'));
}

export function renderSection(sec) {
  if (sec.headless) return renderFilesGroup(sec);
  const open = sectionOpen(sec);
  const done = !!S.reviewed[sec.key];
  const st = secStats(sec);
  const current = ui.curSec === sec.key;
  const summary = open || !done
    ? [plural(st.files, FILES), st.files > 0 && [' · ', statPair(st.add, st.del)]]
    : [plural(st.files, FILES), ' · просмотрено'];
  const head = h('div', { class: `sec-head${current ? ' is-current' : ''}`, dataset: { anchor: `s:${sec.key}` } },
    h('button', {
      class: 'sec-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': `${sec.key}-body`, 'aria-keyshortcuts': 'Shift+O',
      dataset: { act: 'toggle-sec' },
    },
    h('span', { class: 'sec-num' }, sec.synthetic ? '—' : `${pad2(sec.idx + 1)} / ${pad2(sec.total)}`),
    h('h2', {}, sec.title),
    icon('chevron', 'chev')),
    h('span', { class: 'sec-sum' }, summary),
    h('label', { class: 'viewed-toggle' },
      h('input', { type: 'checkbox', class: 'check', checked: done, dataset: { act: 'sec-viewed' }, 'aria-label': `Просмотрено: глава «${sec.title}»`, 'aria-keyshortcuts': 'Shift+V' }),
      h('span', {}, 'Просмотрено')));

  const card = h('section', {
    class: `sec${open ? '' : ' collapsed'}${done ? ' reviewed' : ''}`, id: sec.key,
    dataset: { key: sec.key }, 'aria-labelledby': null,
  }, head);
  if (!open) return card;

  const files = secFiles(sec);
  const aside = h('div', { class: 'sec-aside' },
    h('div', { class: 'aside-in' },
      sec.overview && h('div', { class: 'overview md', html: md(sec.overview) }),
      renderSectionComment(sec),
      files.length > 0 && h('div', { class: 'aside-files' },
        h('div', { class: 'aside-label' }, 'Файлы главы'),
        files.map((f) => fileRow(f, sec, false)))));
  const filesBox = h('div', { class: 'sec-files' });
  if (!files.length) {
    filesBox.append(h('div', { class: 'sec-empty' }, 'Файлов этой главы нет в текущем диффе. Гайд мог устареть.'));
  } else {
    for (const f of files) filesBox.append(renderFile(f, sec));
  }
  if (!done) {
    const last = sec.idx === sections.length - 1;
    filesBox.append(h('div', { class: 'sec-foot' },
      h('button', { class: 'btn', type: 'button', dataset: { act: 'sec-done' } },
        last ? 'Глава просмотрена' : 'Глава просмотрена — к следующей', !last && icon('arrow-right'))));
  }
  card.append(h('div', { class: 'sec-body', id: `${sec.key}-body` }, aside, filesBox));
  return card;
}

// Chapter comment: the text is written straight into S.sectionComments, it has no draft.
function renderSectionComment(sec) {
  const value = S.sectionComments[sec.key] || '';
  const wrap = h('div', { class: 'sec-comment', dataset: { key: sec.key } });
  if (ui.secForm === sec.key) {
    wrap.append(sectionCommentEditor(sec));
  } else if (!value.trim()) {
    wrap.append(h('button', { class: 'btn sm ghost add-sec-comment', type: 'button', dataset: { act: 'sec-comment-edit' }, 'aria-keyshortcuts': 'Shift+C' },
      icon('plus'), 'Комментарий к главе'));
  } else {
    wrap.append(h('div', { class: 'note', dataset: { anchor: `sc:${sec.key}` } },
      h('div', { class: 'note-head' }, h('span', { class: 'note-title' }, 'Комментарий к главе')),
      h('div', { class: 'note-text' }, value.trim()),
      h('div', { class: 'note-foot' },
        h('button', { class: 'btn sm ghost', type: 'button', dataset: { act: 'sec-comment-edit' }, 'aria-keyshortcuts': 'Shift+C' }, 'Изменить'),
        h('button', { class: 'btn sm ghost danger', type: 'button', dataset: { act: 'sec-comment-delete' } }, 'Удалить'))));
  }
  return wrap;
}

function sectionCommentEditor(sec) {
  const ta = h('textarea', {
    class: 'grow', rows: 3, placeholder: 'Что думаешь о главе целиком', 'aria-label': `Комментарий к главе «${sec.title}»`,
    'data-focus-key': `sec-comment:${sec.key}`,
  });
  ta.value = S.sectionComments[sec.key] || '';
  ta.addEventListener('input', () => {
    if (ta.value.trim()) S.sectionComments[sec.key] = ta.value;
    else delete S.sectionComments[sec.key];
    fitTextarea(ta);
    save();
    updateHeader();
  });
  ta.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSectionComment();
    }
  });
  return h('div', { class: 'editor sec-editor' },
    h('div', { class: 'editor-head' }, h('span', { class: 'editor-title' }, 'Комментарий к главе')),
    ta,
    h('div', { class: 'editor-actions' },
      h('button', { class: 'btn sm primary', type: 'button', dataset: { act: 'sec-comment-done' } }, 'Готово'),
      h('span', { class: 'hint' }, `${MOD_ENTER} или Esc — готово`)));
}

export function openSectionComment(key) {
  const sec = secByKey.get(key);
  if (!sec || finished) return;
  if (ui.form) closeForm(false);
  if (!sectionOpen(sec)) S.sectionOpen[key] = true;
  ui.secForm = key;
  withAnchor(() => rerenderSection(key));
  updateChrome();
  const ta = $main().querySelector(`${secQ(key)} .sec-comment textarea`);
  if (!ta) return;
  fitTextarea(ta);
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(ta.value.length, ta.value.length);
  revealEditor(ta.closest('.editor'));
}

export function closeSectionComment() {
  const key = ui.secForm;
  if (!key) return;
  ui.secForm = null;
  const v = (S.sectionComments[key] || '').trim();
  if (v) S.sectionComments[key] = v; else delete S.sectionComments[key];
  save();
  const hadFocus = document.activeElement && document.activeElement.closest('.sec-comment');
  withAnchor(() => rerenderSection(key));
  updateChrome();
  if (hadFocus) {
    const btn = $main().querySelector(`${secQ(key)} .sec-comment button`);
    if (btn) btn.focus({ preventScroll: true });
  }
}

export function deleteSectionComment(key) {
  const before = S.sectionComments[key];
  delete S.sectionComments[key];
  save();
  withAnchor(() => rerenderSection(key));
  updateChrome();
  toast('Комментарий к главе удалён', {
    label: 'Вернуть', run: () => {
      S.sectionComments[key] = before;
      save();
      withAnchor(() => rerenderSection(key));
      updateChrome();
    },
  });
}

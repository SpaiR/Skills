// Submit dialog (feedback / approve / close), jumps to comments and drafts, the finished screen.

import { CLOSE_AFTER_S, isMac, narrowScreen, NOTES } from './constants.js';
import { fileByPath, finished, R, S, secByKey, sections, setFinished, ui } from './state.js';
import { $main, h, icon, pad2, plural } from './dom.js';
import { api, cancelSave, save } from './persist.js';
import { lineAt } from './lines.js';
import { commentCount, filesMode, groupFor, isViewed, secComments, sectionOpen } from './model.js';
import { fileQ, rerenderSection, secQ, stickyOffset, withAnchor } from './rerender.js';
import { updateChrome } from './header.js';
import { setDrawer } from './toc.js';
import { setMode } from './modes.js';
import { jumpToSection, scrollToElement } from './nav.js';
import { flash, goToNote, revealFile } from './events.js';
import { closeMenu } from './menu.js';
import { dialogEl, dialogOpener } from './dialogs.js';
import { buildMarkdown } from './feedback.js';

const SUBMIT_TITLES = { feedback: 'Отправить фидбек', approve: 'Одобрить изменения', close: 'Закрыть без ответа' };
const SUBMIT_HINTS = {
  feedback: 'Сессия Claude Code получит этот текст как твоё сообщение: ответит на вопросы и внесёт просьбы о правках.',
  approve: 'Сессия получит одобрение. Ничего не будет закоммичено. Комментарии, если есть, приложатся.',
  close: 'Сервер остановится, в сессию уйдёт только отметка, что ревью закрыто. Комментарии останутся в state.json.',
};

const fileOrder = () => new Map(R.files.map((f, i) => [f.path, i]));

// A draft is visible on the page if its end line is in the file patch (for a suggestion, the comment's end line)
// and the file is in some chapter. A draft on lines no longer in the patch has nowhere to be shown.
function draftReachable(d) {
  const file = d && fileByPath.get(d.file);
  if (!file || !sections.some((s) => s.diffs.some((x) => x.file === d.file))) return false;
  const a = d.editingId ? S.annotations.find((x) => x.id === d.editingId) : d;
  return !!a && !!lineAt(file, a.side, a.end);
}

// Non-empty drafts that can be reached, in file and line order.
function draftList() {
  const order = fileOrder();
  return Object.entries(S.drafts)
    .filter(([, d]) => draftReachable(d))
    .sort(([, a], [, b]) => (order.get(a.file) - order.get(b.file)) || a.start - b.start);
}

function submitCounts() {
  return { lines: S.annotations.length, secs: secComments().length, global: !!S.globalComment.trim() };
}

function submitSummary() {
  const c = submitCounts();
  const files = R.files.length;
  const viewed = R.files.filter((f) => isViewed(fileByPath.get(f.path))).length;
  const secDone = sections.filter((s) => S.reviewed[s.key]).length;
  const item = (dt, dd) => h('div', { class: 'sum-item' }, h('dt', {}, dt), h('dd', {}, dd));
  return [
    item('Комментарии к строкам', String(c.lines)),
    item('К главам', String(c.secs)),
    item('Общий', c.global ? 'есть' : 'нет'),
    item('Просмотрено', `${viewed} из ${plural(files, ['файла', 'файлов', 'файлов'])}, ${secDone} из ${plural(sections.length, ['главы', 'глав', 'глав'])}`),
  ];
}

function submitWarnings(action, d) {
  const out = [];
  if (action === 'approve') {
    const left = R.files.filter((f) => !isViewed(fileByPath.get(f.path)));
    if (left.length) {
      out.push(h('div', { class: 'callout callout-warning dlg-warn' },
        h('p', { class: 'warn-head' }, 'Не все файлы просмотрены'),
        h('ul', { class: 'dlg-paths' }, left.slice(0, 5).map((f) => h('li', {}, f.path))),
        left.length > 5 && h('p', { class: 'dlg-more' }, `и ещё ${left.length - 5}`)));
    }
  }
  const drafts = draftList();
  if (drafts.length) {
    out.push(h('div', { class: 'callout callout-warning dlg-warn dlg-drafts' },
      h('p', {}, `Есть неотправленные черновики: ${drafts.length}. Они не войдут в фидбек.`),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { d.close(); goToDraft(drafts[0][0]); } }, 'Перейти', icon('arrow-right'))));
  }
  return out;
}

const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';

function submitList(d) {
  const order = fileOrder();
  const items = secComments().map((sec) => ({
    loc: sec.synthetic ? sec.title : `Глава ${pad2(sec.idx + 1)}`,
    text: S.sectionComments[sec.key],
    go: () => goToSectionComment(sec.key),
  }));
  const notes = [...S.annotations].sort((a, b) => ((order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9)) || a.start - b.start);
  for (const a of notes) {
    items.push({
      loc: `${a.file}:${a.start === a.end ? a.start : `${a.start}–${a.end}`}`,
      text: a.text || (a.suggestion ? 'Предложенная правка' : ''),
      go: () => goToNote(a.id),
    });
  }
  if (!items.length) return null;
  return h('ul', { class: 'dlg-list', 'aria-label': 'Комментарии' }, items.map((it) => h('li', {},
    h('button', { class: 'dlg-item', type: 'button', title: it.loc, onclick: () => { d.close(); it.go(); } },
      h('span', { class: 'dlg-loc' }, it.loc),
      h('span', { class: 'dlg-text' }, firstLine(it.text))))));
}

export function openSubmit(action) {
  if (finished) return;
  const opener = dialogOpener();
  closeMenu(false);
  if (narrowScreen.matches && ui.drawer) setDrawer(false);
  const d = dialogEl('submit', 'submit');
  if (d.open) return;
  d.opener = opener || document.getElementById(action === 'approve' ? 'approve-btn' : 'submit-btn');
  const title = SUBMIT_TITLES[action];
  const withComments = action !== 'close';
  const send = h('button', { class: 'btn primary', type: 'button', 'aria-keyshortcuts': isMac ? 'Meta+Enter' : 'Control+Enter' }, title);
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Отмена');
  const summary = h('dl', { class: 'dlg-summary' });
  const preview = h('pre', { class: 'preview' });
  const empty = h('p', { class: 'dlg-empty', hidden: true }, 'Комментариев пока нет: кликни по номеру строки в диффе или напиши общий комментарий.');
  const error = h('div', { class: 'dlg-error', role: 'alert', hidden: true });
  let sending = false;
  const refresh = () => {
    summary.replaceChildren(...submitSummary());
    if (withComments) preview.textContent = buildMarkdown(action);
    const nothing = action === 'feedback' && commentCount() === 0;
    empty.hidden = !nothing;
    if (!sending) send.disabled = nothing;
  };
  let ta = null;
  if (withComments) {
    ta = h('textarea', { class: 'global', rows: 4, placeholder: 'Общий комментарий к ревью (необязательно)', 'aria-label': 'Общий комментарий' });
    ta.value = S.globalComment;
    ta.addEventListener('input', () => { S.globalComment = ta.value; save(); refresh(); });
  }
  send.addEventListener('click', async () => {
    if (send.disabled) return;
    sending = true;
    send.disabled = true;
    send.textContent = 'Отправляю…';
    error.hidden = true;
    const markdown = action === 'close' || (action === 'approve' && commentCount() === 0) ? '' : buildMarkdown(action);
    const counts = submitCounts();
    try {
      cancelSave();
      await api('PUT', '/api/state', S);
      await api('POST', '/api/submit', { action, markdown });
      setFinished(true);
      d.close();
      showFinished(action, counts);
    } catch (err) {
      sending = false;
      send.disabled = false;
      send.textContent = title;
      error.textContent = `Не удалось отправить: ${err.message}. Прогресс сохранён, попробуй ещё раз.`;
      error.hidden = false;
    }
  });
  d.primary = send;
  d.setAttribute('aria-labelledby', 'submit-title');
  d.setAttribute('aria-describedby', 'submit-hint');
  d.replaceChildren(...[
    h('div', { class: 'dlg-head' },
      h('div', {}, h('h2', { id: 'submit-title' }, title), h('p', { id: 'submit-hint', class: 'dlg-hint' }, SUBMIT_HINTS[action]))),
    summary,
    ...submitWarnings(action, d),
    withComments && submitList(d),
    ta,
    withComments && h('details', { class: 'dlg-preview' }, h('summary', {}, 'Что уйдёт в сессию'), preview),
    action === 'feedback' && empty,
    error,
    h('div', { class: 'dlg-actions' }, cancel, send),
  ].filter(Boolean));
  refresh();
  d.showModal();
  // The button width does not change when its text switches to "Sending…".
  send.style.minWidth = `${send.offsetWidth}px`;
  (ta || cancel).focus();
}

function goToSectionComment(key) {
  const sec = secByKey.get(key);
  if (!sec) return;
  if (filesMode()) setMode('guide');
  if (!sectionOpen(sec)) {
    S.sectionOpen[key] = true;
    save();
    withAnchor(() => rerenderSection(key));
    updateChrome();
  }
  jumpToSection(key);
  flash($main().querySelector(`${secQ(key)} .sec-comment .note`));
}

function goToDraft(key) {
  const d = S.drafts[key];
  const file = d && fileByPath.get(d.file);
  const sec = file && groupFor(d.file);
  if (!sec) return;
  revealFile(file, sec);
  const q = ui.form && ui.form.key === key ? `${fileQ(sec.key, file.path)} .annot-form` : `${fileQ(sec.key, file.path)} .draft-row[data-key="${CSS.escape(key)}"]`;
  const el = $main().querySelector(q);
  if (!el) return;
  scrollToElement(() => $main().querySelector(q), stickyOffset() + 16);
  flash(el);
}

function showFinished(action, counts) {
  const text = {
    feedback: 'Фидбек отправлен в сессию Claude Code.',
    approve: 'Одобрение отправлено в сессию Claude Code.',
    close: 'Ревью закрыто.',
  }[action];
  let sub = 'Комментарии сохранены в state.json.';
  if (action !== 'close') {
    // Zero parts are omitted: "0 on chapters" is noise. The word "comment" is inflected by the first number.
    const parts = [];
    if (counts.lines) parts.push(`${plural(counts.lines, NOTES)} к строкам`);
    if (counts.secs) parts.push(`${parts.length ? counts.secs : plural(counts.secs, NOTES)} к главам`);
    if (counts.global) parts.push(parts.length ? 'и общий комментарий' : 'общий комментарий');
    sub = parts.length ? `Отправлено: ${parts.join(', ').replace(', и ', ' и ')}.` : 'Без комментариев.';
  }
  const closing = h('p', { class: 'finished-close', role: 'status' });
  document.body.replaceChildren(h('main', { class: 'finished' },
    h('div', { class: `finished-icon ${action === 'close' ? 'closed' : 'sent'}` }, icon(action === 'close' ? 'x' : 'check')),
    h('h1', {}, text),
    h('p', {}, 'Сервер остановлен, вкладку можно закрыть.'),
    h('p', { class: 'finished-sub' }, sub),
    closing));
  autoClose(closing, CLOSE_AFTER_S);
}

// A tab opened by the skill (a single history entry) may be closed by a script. If the browser refuses,
// the tab stays open and a line asks the user to close it by hand.
function autoClose(el, seconds) {
  const tick = (left) => {
    if (left > 0) {
      el.textContent = `Вкладка закроется через ${left} с`;
      setTimeout(() => tick(left - 1), 1000);
      return;
    }
    window.close();
    setTimeout(() => { if (!window.closed) el.textContent = 'Браузер не дал закрыть вкладку автоматически — закройте её вручную.'; }, 300);
  };
  tick(seconds);
}

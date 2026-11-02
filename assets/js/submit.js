// Submit dialog (feedback / approve / close), jumps to comments and drafts, the finished screen.

import { CLOSE_AFTER_S, isMac, narrowScreen } from './constants.js';
import { dialogEl, dialogOpener } from './dialogs.js';
import { $main, h, icon, pad2 } from './dom.js';
import { flash, goToNote, revealFile } from './events.js';
import { buildMarkdown } from './feedback.js';
import { updateChrome } from './header.js';
import { lineAt } from './lines.js';
import { closeMenu } from './menu.js';
import { commentCount, groupFor, guideMode, isViewed, overviewMode, secComments, sectionOpen } from './model.js';
import { setMode } from './modes.js';
import { jumpToSection, scrollToElement } from './nav.js';
import { api, cancelSave, save } from './persist.js';
import { fileQ, rerenderSection, secQ, stickyOffset, withAnchor } from './rerender.js';
import { fileByPath, finished, R, S, secByKey, sections, setFinished, ui } from './state.js';
import { T } from './strings.js';
import { setDrawer } from './toc.js';

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
    .sort(([, a], [, b]) => order.get(a.file) - order.get(b.file) || a.start - b.start);
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
    item(T.submit.lineComments, String(c.lines)),
    item(T.submit.chapterComments, String(c.secs)),
    item(T.submit.globalComment, c.global ? T.submit.yes : T.submit.no),
    item(T.viewed, T.submit.viewed(viewed, files, secDone, sections.length)),
  ];
}

export function submitWarnings(action, d) {
  const out = [];
  if (action === 'approve') {
    const left = R.files.filter((f) => !isViewed(fileByPath.get(f.path)));
    if (left.length) {
      out.push(
        h(
          'div',
          { class: 'callout callout-warning dlg-warn' },
          h('p', { class: 'warn-head' }, T.submit.notAllViewed),
          h(
            'ul',
            { class: 'dlg-paths' },
            left.slice(0, 5).map((f) => h('li', {}, f.path)),
          ),
          left.length > 5 && h('p', { class: 'dlg-more' }, T.submit.andMore(left.length - 5)),
        ),
      );
    }
  }
  const drafts = draftList();
  if (drafts.length) {
    out.push(
      h(
        'div',
        { class: 'callout callout-warning dlg-warn dlg-drafts' },
        h('p', {}, T.submit.drafts(drafts.length)),
        h(
          'button',
          {
            class: 'btn sm',
            type: 'button',
            onclick: () => {
              d.close();
              goToDraft(drafts[0][0]);
            },
          },
          T.submit.goTo,
          icon('arrow-right'),
        ),
      ),
    );
  }
  return out;
}

const firstLine = (s) =>
  String(s || '')
    .split('\n')
    .find((l) => l.trim()) || '';

function submitList(d) {
  const order = fileOrder();
  const items = secComments().map((sec) => ({
    loc: sec.synthetic ? sec.title : T.chapterNo(pad2(sec.idx + 1)),
    text: S.sectionComments[sec.key],
    go: () => goToSectionComment(sec.key),
  }));
  const notes = [...S.annotations].sort(
    (a, b) => (order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9) || a.start - b.start,
  );
  for (const a of notes) {
    items.push({
      loc: `${a.file}:${a.start === a.end ? a.start : `${a.start}–${a.end}`}`,
      text: a.text || (a.suggestion ? T.comments.suggestion : ''),
      go: () => goToNote(a.id),
    });
  }
  if (!items.length) return null;
  return h(
    'ul',
    { class: 'dlg-list', 'aria-label': T.submit.listAria },
    items.map((it) =>
      h(
        'li',
        {},
        h(
          'button',
          {
            class: 'dlg-item',
            type: 'button',
            title: it.loc,
            onclick: () => {
              d.close();
              it.go();
            },
          },
          h('span', { class: 'dlg-loc' }, it.loc),
          h('span', { class: 'dlg-text' }, firstLine(it.text)),
        ),
      ),
    ),
  );
}

export function openSubmit(action) {
  if (finished) return;
  const opener = dialogOpener();
  closeMenu(false);
  if (narrowScreen.matches && ui.drawer) setDrawer(false);
  const d = dialogEl('submit', 'submit');
  if (d.open) return;
  d.opener = opener || document.getElementById(action === 'approve' ? 'approve-btn' : 'submit-btn');
  const title = T.submit.titles[action];
  const withComments = action !== 'close';
  const send = h(
    'button',
    { class: 'btn primary', type: 'button', 'aria-keyshortcuts': isMac ? 'Meta+Enter' : 'Control+Enter' },
    title,
  );
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, T.submit.cancel);
  const summary = h('dl', { class: 'dlg-summary' });
  const preview = h('pre', { class: 'preview' });
  const empty = h('p', { class: 'dlg-empty', hidden: true }, T.submit.empty);
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
    ta = h('textarea', {
      class: 'global',
      rows: 4,
      placeholder: T.submit.globalPlaceholder,
      'aria-label': T.submit.globalAria,
    });
    ta.value = S.globalComment;
    ta.addEventListener('input', () => {
      S.globalComment = ta.value;
      save();
      refresh();
    });
  }
  send.addEventListener('click', async () => {
    if (send.disabled) return;
    sending = true;
    send.disabled = true;
    send.textContent = T.submit.sending;
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
      error.textContent = T.submit.failed(err.message);
      error.hidden = false;
    }
  });
  d.primary = send;
  d.setAttribute('aria-labelledby', 'submit-title');
  d.setAttribute('aria-describedby', 'submit-hint');
  d.replaceChildren(
    ...[
      h(
        'div',
        { class: 'dlg-head' },
        h(
          'div',
          {},
          h('h2', { id: 'submit-title' }, title),
          h('p', { id: 'submit-hint', class: 'dlg-hint' }, T.submit.hints[action]),
        ),
      ),
      summary,
      ...submitWarnings(action, d),
      withComments && submitList(d),
      ta,
      withComments && h('details', { class: 'dlg-preview' }, h('summary', {}, T.submit.preview), preview),
      action === 'feedback' && empty,
      error,
      h('div', { class: 'dlg-actions' }, cancel, send),
    ].filter(Boolean),
  );
  refresh();
  d.showModal();
  // The button width does not change when its text switches to "Sending…".
  send.style.minWidth = `${send.offsetWidth}px`;
  (ta || cancel).focus();
}

function goToSectionComment(key) {
  const sec = secByKey.get(key);
  if (!sec) return;
  if (!guideMode()) {
    // The chapter is the target: the place remembered for Overview is not restored.
    ui.modeReturn = null;
    setMode('guide');
  }
  if (!sectionOpen(sec)) {
    S.sectionOpen[key] = true;
    save();
    withAnchor(() => rerenderSection(key));
    updateChrome();
  }
  jumpToSection(key);
  flash($main().querySelector(`${secQ(key)} .sec-comment .note`));
}

// Overview mode shows no files: the jump goes through Guide mode. Files mode shows drafts itself.
function goToDraft(key) {
  const d = S.drafts[key];
  const file = d && fileByPath.get(d.file);
  if (!file) return;
  // The draft is the target: the place remembered for Overview is not restored.
  if (overviewMode()) setMode('guide', d.file);
  const sec = groupFor(d.file);
  if (!sec) return;
  revealFile(file, sec);
  const q =
    ui.form && ui.form.key === key
      ? `${fileQ(sec.key, file.path)} .annot-form`
      : `${fileQ(sec.key, file.path)} .draft-row[data-key="${CSS.escape(key)}"]`;
  const el = $main().querySelector(q);
  if (!el) return;
  scrollToElement(() => $main().querySelector(q), stickyOffset() + 16);
  flash(el);
}

// pub: for 'publish', {pr, inline, folded} from the publish response.
export function showFinished(action, counts, pub) {
  const text = T.finished.title[action];
  const sub =
    action === 'close'
      ? T.finished.savedInState
      : pub
        ? T.finished.published(pub.pr.provider, pub.inline, pub.folded)
        : T.finished.sent(counts);
  const closing = h('p', { class: 'finished-close', role: 'status' });
  document.body.replaceChildren(
    h(
      'main',
      { class: 'finished' },
      h(
        'div',
        { class: `finished-icon ${action === 'close' ? 'closed' : 'sent'}` },
        icon(action === 'close' ? 'x' : 'check'),
      ),
      h('h1', {}, text),
      h('p', {}, T.finished.serverStopped),
      h('p', { class: 'finished-sub' }, sub),
      pub &&
        h(
          'p',
          {},
          h('a', { href: pub.pr.url, target: '_blank', rel: 'noopener noreferrer' }, T.pr.open(pub.pr.provider)),
        ),
      closing,
    ),
  );
  autoClose(closing, CLOSE_AFTER_S);
}

// A tab opened by the skill (a single history entry) may be closed by a script. If the browser refuses,
// the tab stays open and a line asks the user to close it by hand.
function autoClose(el, seconds) {
  const tick = (left) => {
    if (left > 0) {
      el.textContent = T.finished.closingIn(left);
      setTimeout(() => tick(left - 1), 1000);
      return;
    }
    window.close();
    setTimeout(() => {
      if (!window.closed) el.textContent = T.finished.closeManually;
    }, 300);
  };
  tick(seconds);
}

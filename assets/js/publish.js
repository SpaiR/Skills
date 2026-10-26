// Publishing the review to the PR/MR (meta.pr): the payload for POST /api/publish and its dialog.
// Line comments inside one hunk of the original patch go inline; comments on expanded context, chapter
// comments and the general comment go into the review body. serve.py (scripts/publish.py) talks to gh/glab.

import { isMac } from './constants.js';
import { dialogEl, dialogOpener } from './dialogs.js';
import * as D from './diffcore.js';
import { h } from './dom.js';
import { buildMarkdown, fence } from './feedback.js';
import { quote } from './lines.js';
import { closeMenu } from './menu.js';
import { api, cancelSave, save } from './persist.js';
import { fileByPath, finished, R, S, sections, setFinished } from './state.js';
import { T } from './strings.js';
import { showFinished, submitWarnings } from './submit.js';

export const prOf = () => R.meta.pr || null;
// Publishing makes sense only while the PR/MR is open.
export const canPublish = () => {
  const pr = prOf();
  return !!pr && pr.state === 'open';
};

// Events the provider supports; on GitHub one cannot approve or reject one's own PR.
function events(pr) {
  const own = pr.provider === 'github' && pr.viewer && pr.viewer === pr.author;
  const list = [{ id: 'comment' }, { id: 'approve', off: own }];
  if (pr.provider === 'github') list.push({ id: 'request_changes', off: own });
  return { list, own };
}

function suggestionBlock(a, provider, inline) {
  if (!a.suggestion) return '';
  if (inline && a.side === 'new') {
    const lang = provider === 'gitlab' ? `suggestion:-${a.end - a.start}+0` : 'suggestion';
    return fence(a.suggestion, lang);
  }
  return `${T.publish.suggestion}\n\n${fence(a.suggestion, '')}`;
}

const join = (...parts) => parts.filter(Boolean).join('\n\n');

// The comment as a block of the review body: location, quoted lines, text, suggestion.
function bodyBlock(a, file, provider) {
  const quoted =
    file &&
    quote(file, a.side, a.start, a.end)
      .slice(0, 20)
      .map((l) => (l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' ') + l.s)
      .join('\n');
  return join(
    T.publish.lineHead(a.file, T.lineRange(a.start, a.end), a.side),
    quoted && fence(quoted, 'diff'),
    a.text,
    suggestionBlock(a, provider, false),
  );
}

export function buildPublish(provider) {
  const order = new Map(R.files.map((f, i) => [f.path, i]));
  const notes = [...S.annotations].sort(
    (a, b) => (order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9) || a.start - b.start,
  );
  const comments = [],
    folded = [];
  for (const a of notes) {
    const file = fileByPath.get(a.file);
    const pos = file && D.prPosition(file.baseHunks, a.side, a.start, a.end);
    const block = bodyBlock(a, file, provider);
    if (!pos) {
      folded.push(block);
      continue;
    }
    comments.push({
      id: a.id,
      path: a.file,
      oldPath: (file && file.oldPath) || null,
      side: a.side,
      start: pos.start,
      end: pos.end,
      body: join(a.text, suggestionBlock(a, provider, true)),
      fallback: block,
    });
  }
  const chapters = sections
    .map((sec) => [sec, (S.sectionComments[sec.key] || '').trim()])
    .filter(([, c]) => c)
    .map(([sec, c]) => join(T.publish.chapter(sec.synthetic ? null : sec.idx + 1, sec.title), c));
  return { body: join(S.globalComment.trim(), ...chapters, ...folded), comments, folded: folded.length };
}

export function openPublish() {
  const pr = prOf();
  if (finished || !canPublish()) return;
  const opener = dialogOpener();
  closeMenu(false);
  const d = dialogEl('publish', 'submit');
  if (d.open) return;
  d.opener = opener || document.getElementById('publish-btn');
  const { list, own } = events(pr);
  let event = 'comment',
    force = false,
    sending = false;
  const title = T.publish.title(pr.provider);
  const send = h(
    'button',
    { class: 'btn primary', type: 'button', 'aria-keyshortcuts': isMac ? 'Meta+Enter' : 'Control+Enter' },
    T.publish.send,
  );
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, T.submit.cancel);
  const radios = list.map((ev) =>
    h(
      'label',
      { class: `pub-event${ev.off ? ' is-off' : ''}` },
      h('input', {
        type: 'radio',
        name: 'pub-event',
        value: ev.id,
        checked: ev.id === event,
        disabled: !!ev.off,
        onchange: () => {
          event = ev.id;
          refresh();
        },
      }),
      h('span', { class: 'pub-event-label' }, T.publish.events[ev.id]),
      h('span', { class: 'pub-event-hint' }, T.publish.eventHints[ev.id]),
    ),
  );
  const summary = h('dl', { class: 'dlg-summary' });
  const foldNote = h('p', { class: 'dlg-hint pub-fold', hidden: true }, T.publish.toBodyHint);
  const block = h('p', { class: 'dlg-empty', hidden: true });
  const preview = h('pre', { class: 'preview' });
  const error = h('div', { class: 'dlg-error', role: 'alert', hidden: true });
  const ta = h('textarea', {
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
  const item = (dt, dd) => h('div', { class: 'sum-item' }, h('dt', {}, dt), h('dd', {}, dd));
  function refresh() {
    const p = buildPublish(pr.provider);
    summary.replaceChildren(
      item(T.publish.inline, String(p.comments.length)),
      item(T.publish.toBody, p.body ? T.submit.yes : T.submit.no),
    );
    foldNote.hidden = !p.folded;
    preview.textContent = p.body;
    const why =
      event === 'request_changes' && !p.body.trim()
        ? T.publish.needBody
        : event === 'comment' && !p.body.trim() && !p.comments.length
          ? T.publish.nothing
          : '';
    block.textContent = why;
    block.hidden = !why;
    if (!sending) send.disabled = !!why;
  }
  send.addEventListener('click', async () => {
    if (send.disabled) return;
    sending = true;
    send.disabled = true;
    send.textContent = T.publish.sending;
    error.hidden = true;
    const p = buildPublish(pr.provider);
    const markdown = buildMarkdown('publish', [T.feedback.event(T.publish.events[event])]);
    try {
      cancelSave();
      await api('PUT', '/api/state', S);
      const res = await api('POST', '/api/publish', {
        event,
        body: p.body,
        comments: p.comments,
        markdown,
        force,
      });
      setFinished(true);
      d.close();
      showFinished('publish', null, { pr, inline: res.inline, folded: !!res.folded });
    } catch (err) {
      sending = false;
      send.disabled = false;
      send.textContent = T.publish.send;
      let body = {};
      try {
        body = JSON.parse(err.body || '{}');
      } catch {}
      if (err.status === 409 && body.error === 'head_moved') {
        force = true;
        send.textContent = T.publish.anyway;
        error.textContent = T.publish.headMoved(pr.provider, body.head || '');
      } else {
        const done = Array.isArray(body.done) ? body.done.length : 0;
        error.textContent = [T.publish.failed(body.detail || err.message), done ? T.publish.partial(done) : '']
          .filter(Boolean)
          .join(' ');
      }
      error.hidden = false;
    }
  });
  d.primary = send;
  d.setAttribute('aria-labelledby', 'publish-title');
  d.setAttribute('aria-describedby', 'publish-hint');
  d.replaceChildren(
    ...[
      h(
        'div',
        { class: 'dlg-head' },
        h(
          'div',
          {},
          h('h2', { id: 'publish-title' }, title),
          h('p', { id: 'publish-hint', class: 'dlg-hint' }, T.publish.hint(pr.provider, pr.viewer)),
        ),
      ),
      h('div', { class: 'pub-events', role: 'radiogroup', 'aria-label': T.publish.eventAria }, radios),
      own && h('p', { class: 'dlg-hint' }, T.publish.ownPr),
      summary,
      foldNote,
      ...submitWarnings('publish', d),
      ta,
      h('details', { class: 'dlg-preview' }, h('summary', {}, T.publish.preview), preview),
      block,
      error,
      h('div', { class: 'dlg-actions' }, cancel, send),
    ].filter(Boolean),
  );
  refresh();
  d.showModal();
  send.style.minWidth = `${send.offsetWidth}px`;
  ta.focus();
}

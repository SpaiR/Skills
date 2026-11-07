// Line comment rendering inside the diff: note cards, suggestions, draft rows and the comment editor.

import { isMac, isMod, MOD_ENTER } from './constants.js';
import { formIn, td } from './diff.js';
import { cap, h, uid } from './dom.js';
import { closeForm, deleteDraft, revealEditor } from './forms.js';
import { quote } from './lines.js';
import { save } from './persist.js';
import { S, ui } from './state.js';
import { T } from './strings.js';

export const draftKey = (path, side, start, end) => `${path}|${side}|${start}|${end}`;
export const editKey = (id) => `edit|${id}`;
export const FIELD_SIZING = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content');

// Field height follows the text: from 3 lines up to 50vh. Where field-sizing is supported, CSS does this.
export function fitTextarea(ta) {
  if (FIELD_SIZING || !ta.isConnected) return;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight + 2, window.innerHeight * 0.5)}px`;
}

// Rows placed under a table row: note cards, drafts, the form.
export function trailing(file, sec, marks, keys, cols) {
  const rows = [];
  for (const [side, no] of keys) {
    if (no == null) continue;
    const list = marks.after.get(`${side}:${no}`);
    if (!list) continue;
    for (const it of list) {
      if (it.kind === 'note') rows.push(...noteRows(file, sec, it.a, cols));
      else if (it.kind === 'draft') rows.push(annotRow(cols, it.d.side, draftCard(it.key, it.d)));
      else rows.push(annotRow(cols, ui.form.side, editorCard(file, null)));
    }
  }
  return rows;
}

function annotRow(cols, side, card) {
  const cell = td('annot-cell');
  cell.colSpan = cols;
  cell.append(h('div', { class: `annot-in side-${side}` }, card));
  const tr = document.createElement('tr');
  tr.className = 'annot-row';
  tr.append(cell);
  return tr;
}

function noteRows(file, sec, a, cols) {
  const form = formIn(file.path, sec ? sec.key : '');
  if (form && form.editId === a.id) return [annotRow(cols, a.side, editorCard(file, a))];
  const out = [annotRow(cols, a.side, noteCard(file, a))];
  const dk = editKey(a.id);
  if (S.drafts[dk]) out.push(annotRow(cols, a.side, draftCard(dk, S.drafts[dk])));
  return out;
}

function noteCard(file, a) {
  return h(
    'div',
    { class: 'note', dataset: { anchor: `n:${a.id}`, id: a.id } },
    h(
      'div',
      { class: 'note-head' },
      h('span', { class: 'note-title' }, `${cap(T.lineRange(a.start, a.end))} · ${T.side(a.side)}`),
      h(
        'span',
        { class: 'note-actions' },
        h('button', { class: 'btn sm ghost', type: 'button', dataset: { act: 'note-edit', id: a.id } }, T.edit),
        h(
          'button',
          { class: 'btn sm ghost danger', type: 'button', dataset: { act: 'note-delete', id: a.id } },
          T.delete,
        ),
      ),
    ),
    a.text && h('div', { class: 'note-text' }, a.text),
    a.suggestion && suggestionBox(file, a),
  );
}

// Mini diff of a suggestion: the original lines of the range with a − sign, then the suggested ones with +.
function suggestionBox(file, a) {
  const line = (t, sign, text) =>
    h(
      'div',
      { class: `sg-line sg-${t}` },
      h('span', { class: 'sg-sign' }, sign),
      h('span', { class: 'sg-code' }, text),
    );
  return h(
    'div',
    { class: 'suggestion' },
    h('div', { class: 'suggestion-head' }, T.comments.suggestion),
    h(
      'div',
      { class: 'sg-body' },
      quote(file, a.side, a.start, a.end).map((l) => line('del', '−', l.s)),
      a.suggestion.split('\n').map((s) => line('add', '+', s)),
    ),
  );
}

function draftCard(key, d) {
  const text =
    String(d.text || '')
      .replace(/\s+/g, ' ')
      .trim() || (d.suggestion ? T.comments.suggestionLower : '');
  const short = text.length > 80 ? `${text.slice(0, 80).trimEnd()}…` : text;
  return h(
    'div',
    { class: 'draft-row', dataset: { anchor: `d:${key}`, key } },
    h(
      'span',
      { class: 'draft-text', title: text },
      h('span', { class: 'draft-label' }, d.editingId ? T.comments.draftEdit : T.comments.draft),
      ' ',
      h('span', { class: 'draft-q' }, '«'),
      h('span', { class: 'draft-quote' }, short),
      h('span', { class: 'draft-q' }, '»'),
    ),
    h(
      'span',
      { class: 'draft-actions' },
      h(
        'button',
        { class: 'btn sm ghost', type: 'button', dataset: { act: 'draft-continue', key } },
        T.comments.continue,
      ),
      h('button', { class: 'btn sm ghost danger', type: 'button', dataset: { act: 'draft-delete', key } }, T.delete),
    ),
  );
}

// Form draft: written on every input. An empty new comment and an unchanged edit produce no draft.
function writeDraft(f, text, suggestion, existing) {
  const unchanged = existing
    ? text === existing.text && suggestion === (existing.suggestion || '')
    : !text.trim() && !suggestion.trim();
  if (unchanged) delete S.drafts[f.key];
  else {
    S.drafts[f.key] = { file: f.path, side: f.side, start: f.start, end: f.end, text, suggestion };
    if (existing) S.drafts[f.key].editingId = existing.id;
  }
}

// Tab in the suggestion field inserts two spaces; Shift+Tab removes indentation from the selected lines.
function indentText(ta, outdent) {
  const v = ta.value,
    s = ta.selectionStart,
    e = ta.selectionEnd;
  if (!outdent && s === e) {
    ta.setRangeText('  ', s, e, 'end');
    return;
  }
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e);
  if (le < 0) le = v.length;
  const lines = v.slice(ls, le).split('\n');
  let first = 0,
    total = 0;
  const out = lines.map((l, k) => {
    if (!outdent) return `  ${l}`;
    const n = (/^ {1,2}|^\t/.exec(l) || [''])[0].length;
    if (k === 0) first = n;
    total += n;
    return l.slice(n);
  });
  ta.setRangeText(out.join('\n'), ls, le, 'preserve');
  if (outdent) ta.setSelectionRange(Math.max(ls, s - first), Math.max(ls, e - total));
  else ta.setSelectionRange(s + 2, e + 2 * lines.length);
}

// Comment form. existing is the annotation being edited.
function editorCard(file, existing) {
  const f = ui.form;
  const d = S.drafts[f.key];
  const ta = h('textarea', {
    class: 'grow',
    rows: 3,
    placeholder: T.comments.placeholder,
    'aria-label': T.comments.textAria,
    'data-focus-key': 'form-text',
  });
  ta.value = d ? d.text : existing ? existing.text : '';
  const sg = h('textarea', {
    class: 'grow mono',
    rows: 3,
    spellcheck: 'false',
    placeholder: T.comments.suggestionPlaceholder,
    'aria-label': T.comments.suggestion,
    'data-focus-key': 'form-sug',
  });
  sg.value = d ? d.suggestion || '' : existing ? existing.suggestion || '' : '';
  const sugBox = h(
    'div',
    { class: 'sug-box', hidden: !f.sugOpen },
    h(
      'div',
      { class: 'sug-head' },
      h('span', { class: 'sug-label' }, T.comments.suggestion),
      // Tab inserts indentation here: this is the only way to leave the field with the keyboard.
      h('span', { class: 'hint' }, T.comments.suggestionHint(MOD_ENTER)),
    ),
    sg,
  );
  const sugToggle = h(
    'button',
    { class: 'btn sm ghost sug-toggle', type: 'button', hidden: f.sugOpen },
    T.comments.suggest,
  );
  const saveBtn = h(
    'button',
    { class: 'btn sm primary', type: 'button', 'aria-keyshortcuts': isMac ? 'Meta+Enter' : 'Control+Enter' },
    T.comments.save,
  );
  const closeBtn = h('button', { class: 'btn sm', type: 'button' }, T.close);
  const discard = h('button', { class: 'btn sm ghost danger', type: 'button' }, T.comments.discardDraft);
  const refresh = () => {
    saveBtn.disabled = !ta.value.trim() && !(f.sugOpen && sg.value.trim());
    discard.classList.toggle('is-off', !S.drafts[f.key]);
  };
  const sync = () => {
    writeDraft(f, ta.value, f.sugOpen ? sg.value : '', existing);
    refresh();
    save();
  };
  const commit = () => {
    const text = ta.value.trim();
    const suggestion = f.sugOpen ? sg.value.replace(/\s+$/, '') : '';
    if (!text && !suggestion) return;
    if (existing) Object.assign(existing, { text, suggestion });
    else S.annotations.push({ id: uid(), file: f.path, side: f.side, start: f.start, end: f.end, text, suggestion });
    delete S.drafts[f.key];
    save();
    closeForm(true);
  };
  sugToggle.addEventListener('click', () => {
    f.sugOpen = true;
    sugBox.hidden = false;
    sugToggle.hidden = true;
    if (!sg.value)
      sg.value = quote(file, f.side, f.start, f.end)
        .map((l) => l.s)
        .join('\n');
    sync();
    fitTextarea(sg);
    sg.focus({ preventScroll: true });
    // The form grew: its bottom row with the Save button may have gone past the window edge.
    revealEditor(sg.closest('.editor'));
  });
  saveBtn.addEventListener('click', commit);
  closeBtn.addEventListener('click', () => closeForm(true));
  discard.addEventListener('click', () => deleteDraft(f.key));
  for (const t of [ta, sg]) {
    t.addEventListener('input', () => {
      fitTextarea(t);
      sync();
    });
    t.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter' && isMod(e)) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeForm(true);
      } else if (t === sg && e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        indentText(sg, e.shiftKey);
        sync();
      }
    });
  }
  refresh();
  return h(
    'div',
    { class: 'editor annot-form', dataset: { anchor: 'form' } },
    h(
      'div',
      { class: 'editor-head' },
      h('span', { class: 'editor-title' }, `${cap(T.lineRange(f.start, f.end))} · ${T.side(f.side)}`),
      !existing && h('span', { class: 'hint' }, T.comments.extendHint),
    ),
    ta,
    sugToggle,
    sugBox,
    h(
      'div',
      { class: 'editor-actions' },
      saveBtn,
      closeBtn,
      discard,
      // The short variant is used when the long one does not fit in the row with the buttons (container query in CSS).
      h(
        'span',
        { class: 'hint save-hint', title: T.comments.saveHintTitle },
        h('span', { class: 'hint-long' }, T.comments.saveHintLong(MOD_ENTER)),
        h('span', { class: 'hint-short' }, T.comments.saveHintShort(MOD_ENTER)),
      ),
    ),
  );
}

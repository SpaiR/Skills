// Keyboard shortcuts help dialog.

import { isMac } from './constants.js';
import { finished } from './state.js';
import { h, icon } from './dom.js';
import { filesMode } from './model.js';
import { closeMenu } from './menu.js';
import { dialogEl, dialogOpener } from './dialogs.js';
import { T } from './strings.js';

// A mouse click in a key combination: shown as a word, not as a key cap.
const CLICK = 'click';

// Chapter keys are shown only in Guide mode: in Files mode they do nothing.
function helpGroups() {
  const mod = isMac ? '⌘' : 'Ctrl';
  const guide = !filesMode();
  const rows = (list) => list.filter(Boolean);
  return [
    [T.help.navigation, rows([
      [[['J'], ['K']], T.help.nextFile],
      guide && [[[']'], ['[']], T.help.nextChapter],
      [[['N'], ['P']], T.help.nextChange],
      [[['G']], T.help.mode],
      [[['/']], T.help.filter],
    ])],
    [T.help.review, rows([
      [[['V']], T.help.markFile],
      guide && [[['Shift', 'V']], T.help.markChapter],
      [[['O']], T.help.toggleFile],
      [[['E']], T.help.wholeFile],
      [[['Z'], ['Shift', 'Z']], T.help.toggleAll],
      guide && [[['Shift', 'O']], T.help.toggleChapter],
    ])],
    [T.help.comments, rows([
      [[['C']], T.help.commentChange],
      guide && [[['Shift', 'C']], T.help.commentChapter],
      [[[CLICK]], T.help.commentLine],
      [[['Shift', CLICK]], T.help.extendRange],
      [[[mod, 'Enter']], T.help.saveComment],
    ])],
    [T.help.view, [
      [[['S']], T.help.viewMode],
      [[['W']], T.help.wrap],
      [[['T']], guide ? T.help.toc : T.help.tree],
    ]],
    [T.help.sending, [
      [[[mod, 'Enter']], T.help.submit],
      [[['Esc']], T.help.escape],
      [[['?']], T.help.help],
    ]],
  ];
}

function keyCombo(alts) {
  return alts.flatMap((combo, k) => [
    k > 0 && h('span', { class: 'key-or' }, '/'),
    combo.flatMap((key, j) => [j > 0 && h('span', { class: 'key-plus' }, '+'), key === CLICK ? h('span', { class: 'key-word' }, T.help.click) : h('kbd', {}, key)]),
  ]);
}

export function openHelp() {
  if (finished) return;
  const opener = dialogOpener();
  closeMenu(false);
  const d = dialogEl('help', 'help');
  if (d.open) return;
  d.opener = opener;
  d.primary = null;
  d.setAttribute('aria-labelledby', 'help-title');
  d.replaceChildren(
    h('div', { class: 'dlg-head' },
      h('h2', { id: 'help-title' }, T.help.title),
      h('button', { class: 'icon-btn sm dlg-x', type: 'button', 'aria-label': T.close, onclick: () => d.close() }, icon('x'))),
    h('div', { class: 'help-grid' }, helpGroups().map(([title, rows]) => h('section', { class: 'help-group' },
      h('h3', {}, title),
      h('dl', {}, rows.map(([keys, text]) => h('div', { class: 'help-row' }, h('dt', {}, keyCombo(keys)), h('dd', {}, text))))))),
    h('p', { class: 'dlg-note' }, T.help.note));
  d.showModal();
  // Focus the dialog itself, not the close button: otherwise the close button becomes the most prominent thing in the help.
  d.tabIndex = -1;
  d.focus();
}

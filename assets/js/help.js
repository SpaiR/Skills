// Keyboard shortcuts help dialog.

import { isMac } from './constants.js';
import { finished } from './state.js';
import { h, icon } from './dom.js';
import { filesMode } from './model.js';
import { closeMenu } from './menu.js';
import { dialogEl, dialogOpener } from './dialogs.js';

// Chapter keys are shown only in Guide mode: in Files mode they do nothing.
function helpGroups() {
  const mod = isMac ? '⌘' : 'Ctrl';
  const guide = !filesMode();
  const rows = (list) => list.filter(Boolean);
  return [
    ['Навигация', rows([
      [[['J'], ['K']], 'Следующий / предыдущий файл'],
      guide && [[[']'], ['[']], 'Следующая / предыдущая глава'],
      [[['N'], ['P']], 'Следующее / предыдущее изменение'],
      [[['G']], 'Режим: гайд или файлы'],
      [[['/']], 'Фильтр файлов'],
    ])],
    ['Ревью', rows([
      [[['V']], 'Отметить файл просмотренным'],
      guide && [[['Shift', 'V']], 'Отметить главу просмотренной'],
      [[['O']], 'Свернуть или развернуть файл'],
      [[['E']], 'Весь файл или только изменения'],
      [[['Z'], ['Shift', 'Z']], 'Свернуть / развернуть все файлы'],
      guide && [[['Shift', 'O']], 'Свернуть или развернуть главу'],
    ])],
    ['Комментарии', rows([
      [[['C']], 'Комментарий к изменению под курсором'],
      guide && [[['Shift', 'C']], 'Комментарий к главе'],
      [[['клик']], 'По номеру — комментарий к любой строке'],
      [[['Shift', 'клик']], 'Расширить диапазон строк'],
      [[[mod, 'Enter']], 'Сохранить комментарий'],
    ])],
    ['Вид', [
      [[['S']], 'Единый / Рядом'],
      [[['W']], 'Перенос строк'],
      [[['T']], guide ? 'Оглавление' : 'Дерево файлов'],
    ]],
    ['Отправка', [
      [[[mod, 'Enter']], 'Отправить фидбек'],
      [[['Esc']], 'Закрыть меню, форму, выделение, курсор'],
      [[['?']], 'Эта справка'],
    ]],
  ];
}

function keyCombo(alts) {
  return alts.flatMap((combo, k) => [
    k > 0 && h('span', { class: 'key-or' }, '/'),
    combo.flatMap((key, j) => [j > 0 && h('span', { class: 'key-plus' }, '+'), key === 'клик' ? h('span', { class: 'key-word' }, key) : h('kbd', {}, key)]),
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
      h('h2', { id: 'help-title' }, 'Горячие клавиши'),
      h('button', { class: 'icon-btn sm dlg-x', type: 'button', 'aria-label': 'Закрыть', onclick: () => d.close() }, icon('x'))),
    h('div', { class: 'help-grid' }, helpGroups().map(([title, rows]) => h('section', { class: 'help-group' },
      h('h3', {}, title),
      h('dl', {}, rows.map(([keys, text]) => h('div', { class: 'help-row' }, h('dt', {}, keyCombo(keys)), h('dd', {}, text))))))),
    h('p', { class: 'dlg-note' }, 'Клавиши работают в любой раскладке. В полях ввода отключены.'));
  d.showModal();
  // Focus the dialog itself, not the close button: otherwise the close button becomes the most prominent thing in the help.
  d.tabIndex = -1;
  d.focus();
}

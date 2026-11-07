// The "More" menu in the top bar.

import { h, icon, uid } from './dom.js';
import { openHelp } from './help.js';
import { filesMode } from './model.js';
import { setAllFilesOpen } from './modes.js';
import { S, ui } from './state.js';
import { T } from './strings.js';
import { openSubmit } from './submit.js';
import { tocVisible, toggleToc } from './toc.js';
import { setTheme, setWrap } from './view.js';

function menuItems() {
  return [
    { kind: 'check', label: T.menu.wrap, key: 'W', on: () => S.wrap, run: () => setWrap(!S.wrap) },
    'sep',
    { kind: 'label', label: T.menu.theme },
    {
      kind: 'radio',
      label: T.menu.auto,
      hint: T.menu.autoHint,
      on: () => S.theme === 'auto',
      run: () => setTheme('auto'),
    },
    { kind: 'radio', label: T.menu.light, icon: 'sun', on: () => S.theme === 'light', run: () => setTheme('light') },
    { kind: 'radio', label: T.menu.dark, icon: 'moon', on: () => S.theme === 'dark', run: () => setTheme('dark') },
    'sep',
    {
      kind: 'check',
      label: filesMode() ? T.menu.tree : T.menu.toc,
      key: 'T',
      on: tocVisible,
      run: () => {
        toggleToc();
        renderMenuState();
      },
    },
    {
      kind: 'item',
      label: T.menu.collapseAll,
      key: 'Z',
      run: () => {
        closeMenu(true);
        setAllFilesOpen(false);
      },
    },
    {
      kind: 'item',
      label: T.menu.expandAll,
      key: '⇧Z',
      run: () => {
        closeMenu(true);
        setAllFilesOpen(true);
      },
    },
    { kind: 'item', label: T.menu.help, key: '?', run: () => openHelp() },
    'sep',
    {
      kind: 'item',
      label: T.menu.closeReview,
      run: () => {
        closeMenu();
        openSubmit('close');
      },
    },
  ];
}

export function toggleMenu() {
  if (ui.menu) closeMenu(true);
  else openMenu();
}

function openMenu() {
  const btn = document.getElementById('more-btn');
  const items = menuItems();
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': T.header.more });
  // Theme items are a labelled group: the screen reader reads the label once, and the items do not repeat the word.
  let box = menu;
  for (const it of items) {
    if (it === 'sep') {
      box = menu;
      menu.append(h('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    if (it.kind === 'label') {
      const id = `menu-group-${uid()}`;
      box = h('div', { role: 'group', 'aria-labelledby': id }, h('div', { class: 'menu-group-label', id }, it.label));
      menu.append(box);
      continue;
    }
    const role = it.kind === 'check' ? 'menuitemcheckbox' : it.kind === 'radio' ? 'menuitemradio' : 'menuitem';
    const b = h(
      'button',
      { class: 'menu-item', type: 'button', role, tabindex: '-1' },
      h('span', { class: 'menu-mark' }, it.kind !== 'item' && icon('check')),
      h('span', { class: 'menu-label' }, it.label),
      it.hint && h('span', { class: 'menu-hint' }, it.hint),
      it.icon && h('span', { class: 'menu-icon' }, icon(it.icon)),
      it.key && h('kbd', {}, it.key),
    );
    b._item = it;
    b.addEventListener('click', () => it.run());
    box.append(b);
  }
  menu.addEventListener('keydown', onMenuKey);
  document.getElementById('top').append(menu);
  ui.menu = menu;
  btn.setAttribute('aria-expanded', 'true');
  renderMenuState();
  const r = btn.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.right = `${document.documentElement.clientWidth - r.right}px`;
  menu.querySelector('.menu-item').focus();
  document.addEventListener('mousedown', onMenuOutside);
}

export function renderMenuState() {
  if (!ui.menu) return;
  for (const b of ui.menu.querySelectorAll('.menu-item')) {
    if (b._item.on) b.setAttribute('aria-checked', String(!!b._item.on()));
  }
}

export function closeMenu(focusBtn) {
  if (!ui.menu) return;
  ui.menu.remove();
  ui.menu = null;
  document.removeEventListener('mousedown', onMenuOutside);
  const btn = document.getElementById('more-btn');
  btn.setAttribute('aria-expanded', 'false');
  if (focusBtn) btn.focus();
}

function onMenuOutside(e) {
  if (ui.menu && !ui.menu.contains(e.target) && !e.target.closest('#more-btn')) closeMenu(false);
}

function onMenuKey(e) {
  const items = [...ui.menu.querySelectorAll('.menu-item')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    items[e.key === 'Home' ? 0 : items.length - 1].focus();
  } else if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault();
    e.stopPropagation();
    closeMenu(true);
  }
}

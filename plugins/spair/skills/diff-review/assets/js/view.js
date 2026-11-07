// Diff view mode, line wrapping and color theme.

import { updateChrome } from './header.js';
import { renderMenuState } from './menu.js';
import { splitAvailable } from './model.js';
import { save } from './persist.js';
import { rerenderAllFiles, withAnchor } from './rerender.js';
import { S } from './state.js';

export function setViewMode(mode) {
  if (mode === 'split' && !splitAvailable()) return;
  if (S.viewMode === mode) return;
  S.viewMode = mode;
  save();
  rerenderAllFiles(() => document.body.classList.toggle('view-split', mode === 'split'));
  updateChrome();
}

export function setWrap(value) {
  S.wrap = value;
  save();
  withAnchor(() => document.body.classList.toggle('nowrap', !S.wrap));
  renderMenuState();
}

export function applyTheme() {
  if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', S.theme);
}

export function setTheme(theme) {
  S.theme = theme;
  applyTheme();
  save();
  renderMenuState();
}

// Toast notifications with an optional undo action.

import { h } from './dom.js';

let toastTimer = null, toastLife = 0;
export function toast(text, action) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.replaceChildren(h('span', { class: 'toast-text' }, text));
  if (action) el.append(h('button', { class: 'toast-btn', type: 'button', onclick: () => { hideToast(); action.run(); } }, action.label));
  el.classList.add('show');
  toastLife = action ? 6000 : 4000;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, toastLife);
}

function hideToast() {
  clearTimeout(toastTimer);
  const el = document.getElementById('toast');
  if (el) el.classList.remove('show');
}

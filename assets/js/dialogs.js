// Shared modal dialog scaffold: backdrop close, focus trap, focus return.

import { isMod } from './constants.js';
import { finished, ui } from './state.js';
import { h } from './dom.js';
import { updateChrome } from './header.js';

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])';

export function dialogEl(id, cls) {
  let d = document.getElementById(id);
  if (d) return d;
  d = h('dialog', { id, class: `dlg ${cls}` });
  const outside = (e) => {
    const r = d.getBoundingClientRect();
    return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
  };
  // A click on the backdrop closes the dialog, but only if the press also started on it: selecting text with the mouse will not close it.
  d.addEventListener('mousedown', (e) => { d.downOutside = outside(e); });
  d.addEventListener('click', (e) => { if (d.downOutside && outside(e)) d.close(); });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && isMod(e) && d.primary && !d.primary.disabled) {
      e.preventDefault();
      d.primary.click();
    } else if (e.key === 'Tab') {
      // Keep focus inside: after the last element comes the first, and vice versa.
      const items = [...d.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (document.activeElement === d) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  d.addEventListener('close', () => {
    if (finished) return;
    updateChrome();
    const back = d.opener && d.opener.isConnected ? d.opener : null;
    if (back) back.focus({ preventScroll: true });
  });
  document.body.append(d);
  return d;
}

// Who opened the dialog: focus returns there. A menu item disappears along with the menu; then it is the More button.
export function dialogOpener() {
  const a = document.activeElement;
  if (ui.menu && a && ui.menu.contains(a)) return document.getElementById('more-btn');
  return a && a !== document.body ? a : null;
}

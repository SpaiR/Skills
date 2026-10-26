// DOM helpers: the h() element builder, small string/path utilities and the SVG icon set.

import * as D from './diffcore.js';

export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v; // only for the output of md() and inline()
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const basename = (p) => p.split('/').pop();
export const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
export const pad2 = (n) => String(n).padStart(2, '0');
export const plural = (n, forms) => `${n} ${D.plural(n, forms)}`;
export const cap = (s) => s[0].toUpperCase() + s.slice(1);
export const uid = () => Math.random().toString(36).slice(2, 10);
export const fileDomId = (path) => 'f-' + Array.from(path).map((c) => c.charCodeAt(0).toString(36)).join('');
export const $main = () => document.getElementById('main');

// 16x16 icons: static shapes, no user data.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  chevron: [['path', { d: 'M4 6l4 4 4-4' }]],
  check: [['path', { d: 'M3.5 8.5l3 3 6-7' }]],
  comment: [['path', { d: 'M3 3h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' }]],
  plus: [['path', { d: 'M8 3.5v9M3.5 8h9' }]],
  sidebar: [['rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.5 }], ['path', { d: 'M6.5 3v10' }]],
  more: [['circle', { cx: 3.5, cy: 8, r: 1, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 8, cy: 8, r: 1, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 12.5, cy: 8, r: 1, fill: 'currentColor', stroke: 'none' }]],
  sun: [['circle', { cx: 8, cy: 8, r: 3 }], ['path', { d: 'M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1' }]],
  moon: [['path', { d: 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z' }]],
  'arrow-right': [['path', { d: 'M3 8h10M9 4l4 4-4 4' }]],
  x: [['path', { d: 'M4 4l8 8M12 4l-8 8' }]],
  search: [['circle', { cx: 7, cy: 7, r: 4.5 }], ['path', { d: 'M10.5 10.5L14 14' }]],
  'expand-up': [['path', { d: 'M8 12.5v-9M4.5 7L8 3.5 11.5 7' }]],
  'expand-down': [['path', { d: 'M8 3.5v9M4.5 9L8 12.5 11.5 9' }]],
  'expand-all': [['path', { d: 'M8 1.5v4.5M5.5 4L8 1.5 10.5 4M8 14.5V10M5.5 12L8 14.5 10.5 12M3 8h10' }]],
};
export function icon(name, cls) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: `icon${cls ? ' ' + cls : ''}` };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, a] of ICONS[name]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

// WCAG 2.x contrast checks of the viewer palette from assets/css/tokens.css and assets/css/themes.css.
// The palette below is a copy of those values; the e2e theme test compares a subset of them with the
// computed styles of the page. The unit test tests/unit/contrast.test.js runs every check.
// CLI: node tests/tools/contrast.js prints every check and exits with code 1 if any fails.
import { fileURLToPath } from 'node:url';

const hex = (h) => {
  h = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
export const ratio = (a, b) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
// Colour `over` with alpha `a` blended on `under`.
const mix = (over, a, under) => over.map((v, i) => Math.round(v * a + under[i] * (1 - a)));

export const PALETTE = {
  light: {
    surface: '#ffffff',
    bg: '#f6f7f9',
    tint: '#f3f4f6',
    ink: '#1b1f24',
    ink2: '#4a5260',
    ink3: '#5b6370',
    addLine: '#e8f6ed',
    addGut: '#d3eedc',
    addWord: '#b8e8c6',
    delLine: '#fdeeee',
    delGut: '#f9d8d8',
    delWord: '#f9c6c6',
    addSign: '#14743a',
    delSign: '#b3261e',
    hunk: '#eef3fb',
    accent: '#2c56c9',
    accentInk: '#ffffff',
    accentSoft: '#e8eefc',
    sel: '#2c56c9',
    selA: 0.08,
    kw: '#6c22a6',
    str: '#084f7c',
    com: '#4b5564',
    num: '#7a4100',
    warn: '#8a5300',
    warnSoft: '#fff6e6',
    success: '#14743a',
    successSoft: '#e3f4e8',
    danger: '#b3261e',
    dangerSoft: '#fbe9e8',
    ctrl: '#8c939e',
  },
  dark: {
    surface: '#151618',
    bg: '#0d0e10',
    tint: '#1a1b1e',
    ink: '#e6e8eb',
    ink2: '#b8bec7',
    ink3: '#959daa',
    addLine: '#13271c',
    addGut: '#183324',
    addWord: '#1c4a2e',
    delLine: '#2c1618',
    delGut: '#3b1d20',
    delWord: '#5a2428',
    addSign: '#6fd391',
    delSign: '#ff8f88',
    hunk: '#1a2030',
    accent: '#8ea4ff',
    accentInk: '#0c1330',
    accentSoft: '#222a44',
    sel: '#8ea4ff',
    selA: 0.1,
    kw: '#d8b8ff',
    str: '#93cbff',
    com: '#b9c0ca',
    num: '#f3b878',
    warn: '#f0b35a',
    warnSoft: '#2b2210',
    success: '#6fd391',
    successSoft: '#15291d',
    danger: '#ff8f88',
    dangerSoft: '#2e1819',
    ctrl: '#6e737c',
  },
};

// Every check of the palette as { theme, label, ratio, min }, in a stable order.
export function contrastChecks() {
  const out = [];
  for (const [name, t] of Object.entries(PALETTE)) {
    const c = (k) => hex(t[k]);
    const check = (label, fg, bg, min) => out.push({ theme: name, label, ratio: ratio(fg, bg), min });
    const codeBgs = {
      surface: c('surface'),
      addLine: c('addLine'),
      delLine: c('delLine'),
      addWord: c('addWord'),
      delWord: c('delWord'),
      'sel+addWord': mix(c('sel'), t.selA, c('addWord')),
      'sel+delWord': mix(c('sel'), t.selA, c('delWord')),
      'sel+surface': mix(c('sel'), t.selA, c('surface')),
    };
    for (const fg of ['ink', 'kw', 'str', 'com', 'num'])
      for (const [bn, b] of Object.entries(codeBgs)) check(`${fg} on ${bn}`, c(fg), b, 4.5);
    for (const bn of ['surface', 'bg', 'tint', 'hunk']) check(`ink3 on ${bn}`, c('ink3'), c(bn), 4.5);
    for (const bn of ['surface', 'bg', 'tint', 'addLine', 'delLine', 'addGut', 'delGut', 'accentSoft'])
      check(`ink2 on ${bn}`, c('ink2'), c(bn), 4.5);
    check('addSign on addLine', c('addSign'), c('addLine'), 4.5);
    check('addSign on addGut', c('addSign'), c('addGut'), 4.5);
    check('delSign on delLine', c('delSign'), c('delLine'), 4.5);
    check('delSign on delGut', c('delSign'), c('delGut'), 4.5);
    check('accentInk on accent (button)', c('accentInk'), c('accent'), 4.5);
    check('accent on surface (link)', c('accent'), c('surface'), 4.5);
    check('accent on accentSoft', c('accent'), c('accentSoft'), 4.5);
    check('accent on bg', c('accent'), c('bg'), 4.5);
    check('success on successSoft', c('success'), c('successSoft'), 4.5);
    check('danger on dangerSoft', c('danger'), c('dangerSoft'), 4.5);
    check('warn on warnSoft', c('warn'), c('warnSoft'), 4.5);
    check('success on surface', c('success'), c('surface'), 4.5);
    check('danger on surface', c('danger'), c('surface'), 4.5);
    check('ctrl-border on surface (UI 3:1)', c('ctrl'), c('surface'), 3);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let fail = 0;
  for (const { theme, label, ratio: v, min } of contrastChecks()) {
    const ok = v >= min;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${theme.padEnd(5)} ${label.padEnd(34)} ${v.toFixed(2)} (>= ${min})`);
  }
  process.exit(fail ? 1 : 0);
}

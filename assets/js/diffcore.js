/* diff-review: pure functions without DOM: patch parsing, side-by-side pairs, intraline diff,
   syntax highlighting, segment merging. An ES module: the viewer imports it, Node tests load it with require(). */

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

// ---------- patch parsing ----------

// Hunk: {header, oldStart, oldLen, newStart, newLen, fn, skip, lines}.
// skip: how many old lines are skipped before the hunk: {from, to, n, first} or null.
// Line: {t: 'add'|'del'|'ctx', o, n, s, i, nonl?}; i is the running line index within the file.
export function parsePatch(patch) {
  const lines = String(patch || '').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const hunks = [];
  let hunk = null,
    o = 0,
    n = 0,
    idx = 0,
    prevEnd = 1;
  for (const line of lines) {
    const m = HUNK_RE.exec(line);
    if (m) {
      const oldStart = +m[1],
        oldLen = m[2] == null ? 1 : +m[2];
      const newStart = +m[3],
        newLen = m[4] == null ? 1 : +m[4];
      // With a zero length git points at the line after which the insertion goes: the first real line is one further.
      const first = oldLen ? oldStart : oldStart + 1;
      const gap = first - prevEnd;
      const skip = gap > 0 ? { from: prevEnd, to: first - 1, n: gap, first: !hunks.length } : null;
      prevEnd = first + oldLen;
      hunk = { header: line, oldStart, oldLen, newStart, newLen, fn: m[5].trim(), skip, lines: [] };
      hunks.push(hunk);
      o = oldStart;
      n = newStart;
      continue;
    }
    if (!hunk) continue;
    const c = line[0];
    if (c === '+') hunk.lines.push({ t: 'add', o: null, n: n++, s: line.slice(1), i: idx++ });
    else if (c === '-') hunk.lines.push({ t: 'del', o: o++, n: null, s: line.slice(1), i: idx++ });
    else if (c === ' ') hunk.lines.push({ t: 'ctx', o: o++, n: n++, s: line.slice(1), i: idx++ });
    else if (c === '\\' && hunk.lines.length) hunk.lines[hunk.lines.length - 1].nonl = true;
  }
  return hunks;
}

// Pairs for the side-by-side view: context goes into both halves, a del+add run is paired by index.
export function splitPairs(lines) {
  const pairs = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].t === 'ctx') {
      pairs.push([lines[i], lines[i]]);
      i++;
      continue;
    }
    const dels = [],
      adds = [];
    while (i < lines.length && lines[i].t === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].t === 'add') adds.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) pairs.push([dels[k] || null, adds[k] || null]);
  }
  return pairs;
}

// Change blocks: consecutive add/del lines. Returns [{from, to}]: indices into lines (to is inclusive).
export function changeBlocks(lines) {
  const blocks = [];
  let start = -1;
  lines.forEach((l, k) => {
    if (l.t !== 'ctx') {
      if (start < 0) start = k;
    } else if (start >= 0) {
      blocks.push({ from: start, to: k - 1 });
      start = -1;
    }
  });
  if (start >= 0) blocks.push({ from: start, to: lines.length - 1 });
  return blocks;
}

// ---------- context expansion ----------

// Visible part of the full diff (a single hunk for the whole file from full.patch).
// fullLines: lines of that hunk; baseHunks: hunks of guide.patch; ranges: expanded ranges [from, to]
// in new line numbers; all: show the whole file.
// All lines of the original hunks and context lines from ranges are visible. Consecutive visible lines form a hunk;
// between and around them are gaps {at, from, to, n, newFrom, newTo}: at is the index of the hunk after the gap
// (hunks.length for the file tail), from/to are indices into fullLines, newFrom/newTo are new line numbers.
// Every line of the original patch is checked against the full diff; on mismatch returns null.
export function buildView(fullLines, baseHunks, ranges, all) {
  const key = (l) => (l.t === 'del' ? `o${l.o}` : `n${l.n}`);
  const at = new Map();
  fullLines.forEach((l, k) => {
    at.set(key(l), k);
  });
  const show = new Uint8Array(fullLines.length);
  const fnAt = new Map(); // index in fullLines where an original hunk starts -> fn
  for (const hk of baseHunks) {
    let prev = -1;
    for (const l of hk.lines) {
      const k = at.get(key(l));
      const f = k == null ? null : fullLines[k];
      if (!f || f.t !== l.t || f.o !== l.o || f.n !== l.n || f.s !== l.s || (prev >= 0 && k !== prev + 1)) return null;
      if (prev < 0) fnAt.set(k, hk.fn);
      show[k] = 1;
      prev = k;
    }
  }
  for (let k = 0; k < fullLines.length; k++) {
    const l = fullLines[k];
    if (all || l.t !== 'ctx') {
      show[k] = 1;
      continue;
    }
    for (const [a, b] of ranges || [])
      if (l.n >= a && l.n <= b) {
        show[k] = 1;
        break;
      }
  }
  const hunks = [],
    gaps = [];
  let idx = 0,
    k = 0;
  const gapOf = (from, to) => ({
    at: hunks.length,
    from,
    to,
    n: to - from + 1,
    newFrom: fullLines[from].n,
    newTo: fullLines[to].n,
  });
  while (k < fullLines.length) {
    if (!show[k]) {
      const from = k;
      while (k < fullLines.length && !show[k]) k++;
      gaps.push(gapOf(from, k - 1));
      continue;
    }
    const from = k;
    while (k < fullLines.length && show[k]) k++;
    const lines = fullLines.slice(from, k).map((l) => {
      const c = { t: l.t, o: l.o, n: l.n, s: l.s, i: idx++ };
      if (l.nonl) c.nonl = true;
      return c;
    });
    // Start of a hunk whose side has zero length: the line number before it, as git writes it.
    const startOf = (side) => {
      const first = lines.find((l) => l[side] != null);
      if (first) return first[side];
      for (let p = from - 1; p >= 0; p--) if (fullLines[p][side] != null) return fullLines[p][side];
      return 0;
    };
    const oldLen = lines.filter((l) => l.o != null).length,
      newLen = lines.filter((l) => l.n != null).length;
    const oldStart = startOf('o'),
      newStart = startOf('n');
    const fn = fnAt.get(from) || '';
    hunks.push({
      header: `@@ -${oldStart},${oldLen} +${newStart},${newLen} @@${fn ? ` ${fn}` : ''}`,
      oldStart,
      oldLen,
      newStart,
      newLen,
      fn,
      skip: null,
      lines,
    });
  }
  return { hunks, gaps };
}

// Gaps between hunks by new line numbers: before the first, between neighbours, after the last
// (if the new version length newTotal is known). Same shape as buildView gaps but without fullLines indices:
// expand buttons are visible before the full text is loaded.
export function gapsOf(hunks, newTotal) {
  const gaps = [];
  let prevEnd = 1;
  hunks.forEach((hk, k) => {
    const first = hk.newLen ? hk.newStart : hk.newStart + 1;
    if (first > prevEnd) gaps.push({ at: k, n: first - prevEnd, newFrom: prevEnd, newTo: first - 1 });
    prevEnd = first + hk.newLen;
  });
  if (newTotal != null && newTotal >= prevEnd)
    gaps.push({ at: hunks.length, n: newTotal - prevEnd + 1, newFrom: prevEnd, newTo: newTotal });
  return gaps;
}

// Range of new line numbers revealed by a gap button: 'up' is the lines above the next hunk,
// 'down' below the previous one, 'all' the whole gap.
export function expandRange(gap, dir, step) {
  if (dir === 'all' || gap.n <= step) return [gap.newFrom, gap.newTo];
  return dir === 'up' ? [gap.newTo - step + 1, gap.newTo] : [gap.newFrom, gap.newFrom + step - 1];
}

// Merge overlapping and adjacent ranges [from, to].
export function mergeRanges(ranges) {
  const sorted = ranges
    .filter((r) => Array.isArray(r) && r[0] <= r[1])
    .map((r) => [r[0], r[1]])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

// Lines of side `side` numbered a to b from a flat line list, in order.
export function quoteLines(lines, side, a, b) {
  const key = side === 'new' ? 'n' : 'o';
  return lines.filter((l) => l[key] != null && l[key] >= a && l[key] <= b);
}

// ---------- intraline diff ----------

export const TOKEN_RE = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
const MAX_LINE = 1000;
const MAX_RUN = 50;
const MAX_CELLS = 250000;
const MIN_SIMILARITY = 0.5;
// Runs of different length: pairs may be shifted by at most this many lines (an inserted blank line and the like).
const MAX_SHIFT = 4;

export function tokenize(s) {
  // TOKEN_RE covers any string completely: every character falls into exactly one token.
  const out = [];
  for (const m of s.matchAll(TOKEN_RE)) out.push({ s: m[0], from: m.index, to: m.index + m[0].length });
  return out;
}

const isSpace = (tok) => /^\s+$/.test(tok.s);

// Unmatched tokens -> character ranges; neighbours are merged if only whitespace lies between them.
function toRanges(tokens, changed) {
  const ranges = [];
  let cur = null,
    gapOnlySpace = true;
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (changed[k]) {
      if (cur && gapOnlySpace) cur[1] = tok.to;
      else {
        cur = [tok.from, tok.to];
        ranges.push(cur);
      }
      gapOnlySpace = true;
    } else if (cur && !isSpace(tok)) {
      gapOnlySpace = false;
    }
  }
  return ranges;
}

export function wordDiff(a, b) {
  if (a === b) return null;
  if (a.length > MAX_LINE || b.length > MAX_LINE) return null;
  const ta = tokenize(a),
    tb = tokenize(b);
  const na = ta.length,
    nb = tb.length;
  let pre = 0;
  while (pre < na && pre < nb && ta[pre].s === tb[pre].s) pre++;
  let suf = 0;
  while (suf < na - pre && suf < nb - pre && ta[na - 1 - suf].s === tb[nb - 1 - suf].s) suf++;

  let common = 0;
  for (let k = 0; k < pre; k++) common += ta[k].s.length;
  for (let k = 0; k < suf; k++) common += ta[na - 1 - k].s.length;

  const A = ta.slice(pre, na - suf),
    B = tb.slice(pre, nb - suf);
  const n = A.length,
    m = B.length;
  const chA = new Array(na).fill(false),
    chB = new Array(nb).fill(false);
  for (let k = 0; k < n; k++) chA[pre + k] = true;
  for (let k = 0; k < m; k++) chB[pre + k] = true;

  if (n && m && n * m <= MAX_CELLS) {
    // dp[i][j] is the LCS of suffixes A[i..] and B[j..]; a single flat row-major Uint32Array table.
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      const row = i * w,
        next = (i + 1) * w;
      const ai = A[i].s;
      for (let j = m - 1; j >= 0; j--) {
        dp[row + j] =
          ai === B[j].s ? dp[next + j + 1] + 1 : dp[next + j] >= dp[row + j + 1] ? dp[next + j] : dp[row + j + 1];
      }
    }
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (A[i].s === B[j].s) {
        chA[pre + i] = false;
        chB[pre + j] = false;
        common += A[i].s.length;
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
  }

  const total = a.length + b.length;
  if (!total || (2 * common) / total < MIN_SIMILARITY) return null;
  const del = toRanges(ta, chA),
    add = toRanges(tb, chB);
  if (!del.length && !add.length) return null;
  return { del, add };
}

// Highlighting for hunk lines: an array as long as lines; each element is ranges [[from,to],...] or null.
export function intraline(lines) {
  const out = new Array(lines.length).fill(null);
  let i = 0;
  while (i < lines.length) {
    if (lines[i].t === 'ctx') {
      i++;
      continue;
    }
    const dels = [],
      adds = [];
    while (i < lines.length && lines[i].t === 'del') dels.push(i++);
    while (i < lines.length && lines[i].t === 'add') adds.push(i++);
    if (dels.length > MAX_RUN || adds.length > MAX_RUN) continue;
    const k = Math.min(dels.length, adds.length);
    // Pairs by index. If a run has extra lines on one side, shifts of that side are tried
    // up to MAX_SHIFT and the one with more related pairs wins; on a tie the index pairs stay.
    // This way a blank line inserted before a replaced one does not break highlighting of the real pair.
    const extra = Math.abs(dels.length - adds.length);
    const shifts = extra && extra <= MAX_SHIFT ? extra : 0;
    let best = null;
    for (let o = 0; o <= shifts; o++) {
      const dOff = dels.length > adds.length ? o : 0,
        aOff = adds.length > dels.length ? o : 0;
      const pairs = [];
      for (let p = 0; p < k; p++) {
        const r = wordDiff(lines[dels[p + dOff]].s, lines[adds[p + aOff]].s);
        if (r) pairs.push([dels[p + dOff], adds[p + aOff], r]);
      }
      if (!best || pairs.length > best.length) best = pairs;
    }
    for (const [di, ai, r] of best) {
      if (r.del.length) out[di] = r.del;
      if (r.add.length) out[ai] = r.add;
    }
  }
  return out;
}

// ---------- syntax highlighting ----------

// Four classes: t-com, t-str, t-num, t-kw. The language is chosen by file extension.
// line: line comment; lineAfterSpace: only at line start or after whitespace (shell, YAML);
// block: [open, close] pairs; quotes: quote characters; quoteAfter: what must precede a quote for it to open
// a string (YAML and HTML: otherwise an apostrophe in prose colours the rest of the line); triple and prefixes: Python strings;
// regex: /.../ literals in JS (coloured as strings, otherwise a quote inside them opens a bogus string).
const kw = (s) => new Set(s.split(' ').filter(Boolean));
export const LANGS = {
  js: {
    exts: 'js mjs cjs jsx ts tsx',
    line: '//',
    block: [['/*', '*/']],
    quotes: '\'"`',
    regex: true,
    kw: kw(
      'const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this null undefined true false yield static get set interface type enum implements readonly as delete void super',
    ),
  },
  python: {
    exts: 'py pyi',
    line: '#',
    quotes: '\'"',
    prefixes: true,
    kw: kw(
      'def class return if elif else for while in not and or is import from as with try except finally raise lambda yield None True False pass break continue global nonlocal async await assert del match case',
    ),
  },
  shell: {
    exts: 'sh bash zsh',
    line: '#',
    lineAfterSpace: true,
    quotes: '\'"',
    kw: kw(
      'if then else elif fi for while do done case esac function return in local export readonly set unset echo exit',
    ),
  },
  css: { exts: 'css', block: [['/*', '*/']], quotes: '\'"', css: true, kw: kw('') },
  json: { exts: 'json', quotes: '"', kw: kw('true false null') },
  yaml: {
    exts: 'yml yaml',
    line: '#',
    lineAfterSpace: true,
    quotes: '\'"',
    quoteAfter: /[\s:[{,-]/,
    kw: kw('true false null yes no'),
  },
  go: {
    exts: 'go',
    line: '//',
    block: [['/*', '*/']],
    quotes: '"`\'',
    kw: kw(
      'func package import return if else for range switch case default type struct interface map chan go defer var const nil true false break continue select',
    ),
  },
  rust: {
    exts: 'rs',
    line: '//',
    block: [['/*', '*/']],
    quotes: '"',
    kw: kw(
      'fn let mut pub use mod struct enum impl trait return if else match for while loop in as self Self crate super where move ref true false const static async await',
    ),
  },
  java: {
    exts: 'java kt kts',
    line: '//',
    block: [['/*', '*/']],
    quotes: '"\'',
    kw: kw(
      'class interface public private protected static final void return if else for while new try catch finally throw import package extends implements null true false fun val var when object',
    ),
  },
  c: {
    exts: 'c h cc cpp hpp',
    line: '//',
    block: [['/*', '*/']],
    quotes: '"\'',
    kw: kw(
      'int char void return if else for while do switch case break continue struct typedef enum static const unsigned sizeof include define class public private namespace template nullptr true false',
    ),
  },
  html: { exts: 'html htm', block: [['<!--', '-->']], quotes: '"\'', quoteAfter: /[\s=(,[{:]/, kw: kw('') },
};
const LANG_BY_EXT = new Map();
for (const [name, def] of Object.entries(LANGS)) {
  def.name = name;
  for (const ext of def.exts.split(' ')) LANG_BY_EXT.set(ext, def);
}

export function langOf(path) {
  const base = String(path || '')
    .split('/')
    .pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? LANG_BY_EXT.get(base.slice(dot + 1).toLowerCase()) || null : null;
}

const NUM_RE = /\b\d[\d_]*(\.\d+)?([eE][+-]?\d+)?\b|0x[0-9a-fA-F]+/y;
// CSS: numbers with units (12px, .5s, 100%) and #rgb/#rrggbb colours. Not inside names like --s-12 and h1.
const CSS_NUM_RE =
  /(?<![\w#-])(?:\d+(?:\.\d+)?|\.\d+)(?:%|[a-zA-Z]+)?|#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/y;
const WORD_RE = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const PY_STR_RE = /([rRbBuUfF]{1,2})?("""|'''|"|')/y;
// A "/" starts a regex, not a division, after: line start, an operator, an opening bracket or a keyword.
const REGEX_BEFORE =
  /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new))\s*$/;
const MAX_SYN_LINE = 1000;
const MAX_SYN_FILE = 5000;

// End of a string quoted with q starting at `from`, honouring backslashes. -1 if it does not end on this line.
function closeQuote(text, from, q) {
  for (let k = from; k < text.length; k++) {
    if (text[k] === '\\') {
      k++;
      continue;
    }
    if (text.startsWith(q, k)) return k + q.length;
  }
  return -1;
}

// End of a /.../flags literal or -1. Inside [...] a "/" does not close the literal.
function closeRegex(text, from) {
  let cls = false;
  for (let k = from + 1; k < text.length; k++) {
    const c = text[k];
    if (c === '\\') {
      k++;
      continue;
    }
    if (c === '[') cls = true;
    else if (c === ']') cls = false;
    else if (c === '/' && !cls) {
      let e = k + 1;
      while (e < text.length && /[a-z]/.test(text[e])) e++;
      return e;
    }
  }
  return -1;
}

// Tokens of one line: [{from, to, cls}] ascending, non-overlapping.
// state carries an unclosed block comment or Python triple quote across lines: {end, cls}.
// Without state every line is parsed from scratch.
export function highlight(text, lang, state) {
  const L = typeof lang === 'string' ? LANGS[lang] : lang;
  const st = state || { end: null, cls: null };
  const out = [];
  if (!L || text.length > MAX_SYN_LINE) return out;
  const n = text.length;
  let pos = 0;
  if (st.end) {
    const e = st.cls === 't-str' ? closeQuote(text, 0, st.end) : text.indexOf(st.end);
    const to = e < 0 ? n : st.cls === 't-str' ? e : e + st.end.length;
    if (to > 0) out.push({ from: 0, to, cls: st.cls });
    if (e < 0) return out;
    st.end = null;
    st.cls = null;
    pos = to;
  }
  const push = (from, to, cls) => {
    out.push({ from, to, cls });
    pos = to;
  };
  scan: while (pos < n) {
    const c = text[pos];
    if (L.block) {
      for (const [open, close] of L.block) {
        if (!text.startsWith(open, pos)) continue;
        const e = text.indexOf(close, pos + open.length);
        if (e < 0) {
          st.end = close;
          st.cls = 't-com';
          push(pos, n, 't-com');
          break scan;
        }
        push(pos, e + close.length, 't-com');
        continue scan;
      }
    }
    if (L.line && text.startsWith(L.line, pos) && (!L.lineAfterSpace || pos === 0 || /\s/.test(text[pos - 1]))) {
      push(pos, n, 't-com');
      break;
    }
    if (L.prefixes) {
      // Python: f r b u prefixes and triple quotes that may continue on the following lines.
      PY_STR_RE.lastIndex = pos;
      const m = PY_STR_RE.exec(text);
      if (m) {
        const q = m[2];
        const e = closeQuote(text, pos + m[0].length, q);
        if (e < 0 && q.length === 3) {
          st.end = q;
          st.cls = 't-str';
          push(pos, n, 't-str');
          break;
        }
        push(pos, e < 0 ? n : e, 't-str');
        continue;
      }
    } else if (L.quotes.includes(c) && (!L.quoteAfter || pos === 0 || L.quoteAfter.test(text[pos - 1]))) {
      const e = closeQuote(text, pos + 1, c);
      push(pos, e < 0 ? n : e, 't-str');
      continue;
    }
    if (L.regex && c === '/' && REGEX_BEFORE.test(text.slice(Math.max(0, pos - 12), pos))) {
      const e = closeRegex(text, pos);
      if (e > 0) {
        push(pos, e, 't-str');
        continue;
      }
    }
    const numRe = L.css ? CSS_NUM_RE : NUM_RE;
    numRe.lastIndex = pos;
    const num = numRe.exec(text);
    if (num && num[0]) {
      push(pos, pos + num[0].length, 't-num');
      continue;
    }
    WORD_RE.lastIndex = pos;
    const word = WORD_RE.exec(text);
    if (word) {
      if (L.kw.has(word[0])) push(pos, pos + word[0].length, 't-kw');
      else pos += word[0].length;
      continue;
    }
    pos++;
  }
  return out;
}

// Tokens of hunk lines: an array as long as lines. State is kept separately for the old side
// (ctx and del) and the new side (ctx and add) and is reset at hunk start. A context line takes the new side's tokens.
export function highlightHunk(lines, lang) {
  const L = typeof lang === 'string' ? LANGS[lang] : lang;
  const out = new Array(lines.length).fill(null);
  if (!L) return out;
  const oldSt = { end: null, cls: null },
    newSt = { end: null, cls: null };
  lines.forEach((l, k) => {
    if (l.t === 'del') out[k] = highlight(l.s, L, oldSt);
    else if (l.t === 'add') out[k] = highlight(l.s, L, newSt);
    else {
      highlight(l.s, L, oldSt);
      out[k] = highlight(l.s, L, newSt);
    }
  });
  return out;
}

// Tokens of all file lines by running line index (l.i), or null if there is no highlighting:
// unknown language or more than 5000 lines in the patch.
export function highlightFile(hunks, path) {
  const L = langOf(path);
  if (!L) return null;
  let total = 0;
  for (const hk of hunks) total += hk.lines.length;
  if (total > MAX_SYN_FILE) return null;
  const out = new Array(total).fill(null);
  for (const hk of hunks) {
    const r = highlightHunk(hk.lines, L);
    hk.lines.forEach((l, k) => {
      out[l.i] = r[k];
    });
  }
  return out;
}

// ---------- segment merging ----------

// wordRanges: [[from,to],...]; synTokens: [{from, to, cls}]. Result: [{text, w, cls}] without empty pieces.
export function segments(text, wordRanges, synTokens) {
  const words = wordRanges || [],
    syn = synTokens || [];
  if (!words.length && !syn.length) return text ? [{ text, w: false, cls: null }] : [];
  const cuts = new Set([0, text.length]);
  for (const [a, b] of words) {
    cuts.add(a);
    cuts.add(b);
  }
  for (const t of syn) {
    cuts.add(t.from);
    cuts.add(t.to);
  }
  const points = [...cuts].filter((x) => x >= 0 && x <= text.length).sort((x, y) => x - y);
  const out = [];
  let wi = 0,
    si = 0;
  for (let k = 0; k < points.length - 1; k++) {
    const from = points[k],
      to = points[k + 1];
    if (from === to) continue;
    while (wi < words.length && words[wi][1] <= from) wi++;
    while (si < syn.length && syn[si].to <= from) si++;
    const w = wi < words.length && words[wi][0] <= from;
    const cls = si < syn.length && syn[si].from <= from ? syn[si].cls : null;
    const last = out[out.length - 1];
    if (last && last.w === w && last.cls === cls) last.text += text.slice(from, to);
    else out.push({ text: text.slice(from, to), w, cls });
  }
  return out;
}

// ---------- misc ----------

// FNV-1a, 32 bits over the UTF-16 code units of the string; the result is 8 hex characters.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let k = 0; k < str.length; k++) {
    h ^= str.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const PLURAL = typeof Intl !== 'undefined' ? new Intl.PluralRules('ru') : null;
// Russian plural forms [one, few, many]: plural(5, forms) -> forms[2]; the word forms are in strings.js (WORDS).
export function plural(n, forms) {
  const cat = PLURAL ? PLURAL.select(n) : 'many';
  return cat === 'one' ? forms[0] : cat === 'few' ? forms[1] : forms[2];
}

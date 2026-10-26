/* diff-review: чистые функции без DOM — разбор патча, пары строк, внутристрочный дифф, подсветка синтаксиса,
   слияние сегментов.
   В браузере доступен как globalThis.DiffCore, под Node — через require. */
(function (root) {
  'use strict';

  const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

  // ---------- разбор патча ----------

  // Ханк: {header, oldStart, oldLen, newStart, newLen, fn, skip, lines}.
  // skip — сколько старых строк пропущено перед ханком: {from, to, n, first} или null.
  // Строка: {t: 'add'|'del'|'ctx', o, n, s, i, nonl?}; i — сквозной индекс строки в файле.
  function parsePatch(patch) {
    const lines = String(patch || '').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const hunks = [];
    let hunk = null, o = 0, n = 0, idx = 0, prevEnd = 1;
    for (const line of lines) {
      const m = HUNK_RE.exec(line);
      if (m) {
        const oldStart = +m[1], oldLen = m[2] == null ? 1 : +m[2];
        const newStart = +m[3], newLen = m[4] == null ? 1 : +m[4];
        // При нулевой длине git указывает строку, после которой вставка: первая «настоящая» строка на 1 дальше.
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

  // Пары для вида «Рядом»: контекст стоит в обеих половинах, серия del+add — по индексу.
  function splitPairs(lines) {
    const pairs = [];
    let i = 0;
    while (i < lines.length) {
      if (lines[i].t === 'ctx') { pairs.push([lines[i], lines[i]]); i++; continue; }
      const dels = [], adds = [];
      while (i < lines.length && lines[i].t === 'del') dels.push(lines[i++]);
      while (i < lines.length && lines[i].t === 'add') adds.push(lines[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) pairs.push([dels[k] || null, adds[k] || null]);
    }
    return pairs;
  }

  // Блоки изменений: подряд идущие add/del. Возвращает [{from, to}] — индексы в массиве lines (to включительно).
  function changeBlocks(lines) {
    const blocks = [];
    let start = -1;
    lines.forEach((l, k) => {
      if (l.t !== 'ctx') { if (start < 0) start = k; }
      else if (start >= 0) { blocks.push({ from: start, to: k - 1 }); start = -1; }
    });
    if (start >= 0) blocks.push({ from: start, to: lines.length - 1 });
    return blocks;
  }

  // ---------- раскрытие контекста ----------

  // Видимая часть полного диффа (один ханк на весь файл из full.patch).
  // fullLines — строки этого ханка; baseHunks — ханки guide.patch; ranges — раскрытые диапазоны [from, to]
  // в новых номерах строк; all — показать весь файл.
  // Видны все строки исходных ханков и строки контекста из ranges. Подряд идущие видимые строки — ханк,
  // между ними и по краям — промежутки {at, from, to, n, newFrom, newTo}: at — номер ханка после промежутка
  // (hunks.length — хвост файла), from/to — индексы в fullLines, newFrom/newTo — новые номера строк.
  // Каждая строка исходного патча сверяется с полным диффом; при расхождении — null.
  function buildView(fullLines, baseHunks, ranges, all) {
    const key = (l) => (l.t === 'del' ? `o${l.o}` : `n${l.n}`);
    const at = new Map();
    fullLines.forEach((l, k) => at.set(key(l), k));
    const show = new Uint8Array(fullLines.length);
    const fnAt = new Map(); // индекс в fullLines начала исходного ханка → fn
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
      if (all || l.t !== 'ctx') { show[k] = 1; continue; }
      for (const [a, b] of ranges || []) if (l.n >= a && l.n <= b) { show[k] = 1; break; }
    }
    const hunks = [], gaps = [];
    let idx = 0, k = 0;
    const gapOf = (from, to) => ({ at: hunks.length, from, to, n: to - from + 1, newFrom: fullLines[from].n, newTo: fullLines[to].n });
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
      // Начало ханка с нулевой длиной стороны — номер строки перед ним, как пишет git.
      const startOf = (side) => {
        const first = lines.find((l) => l[side] != null);
        if (first) return first[side];
        for (let p = from - 1; p >= 0; p--) if (fullLines[p][side] != null) return fullLines[p][side];
        return 0;
      };
      const oldLen = lines.filter((l) => l.o != null).length, newLen = lines.filter((l) => l.n != null).length;
      const oldStart = startOf('o'), newStart = startOf('n');
      const fn = fnAt.get(from) || '';
      hunks.push({
        header: `@@ -${oldStart},${oldLen} +${newStart},${newLen} @@${fn ? ` ${fn}` : ''}`,
        oldStart, oldLen, newStart, newLen, fn, skip: null, lines,
      });
    }
    return { hunks, gaps };
  }

  // Промежутки между ханками по новым номерам строк: перед первым, между соседними, после последнего
  // (если известна длина новой версии newTotal). Тот же вид, что gaps у buildView, но без индексов в fullLines:
  // кнопки раскрытия видны до загрузки полного текста.
  function gapsOf(hunks, newTotal) {
    const gaps = [];
    let prevEnd = 1;
    hunks.forEach((hk, k) => {
      const first = hk.newLen ? hk.newStart : hk.newStart + 1;
      if (first > prevEnd) gaps.push({ at: k, n: first - prevEnd, newFrom: prevEnd, newTo: first - 1 });
      prevEnd = first + hk.newLen;
    });
    if (newTotal != null && newTotal >= prevEnd) gaps.push({ at: hunks.length, n: newTotal - prevEnd + 1, newFrom: prevEnd, newTo: newTotal });
    return gaps;
  }

  // Диапазон новых номеров, который раскрывает кнопка промежутка: 'up' — строки над следующим ханком,
  // 'down' — под предыдущим, 'all' — весь промежуток.
  function expandRange(gap, dir, step) {
    if (dir === 'all' || gap.n <= step) return [gap.newFrom, gap.newTo];
    return dir === 'up' ? [gap.newTo - step + 1, gap.newTo] : [gap.newFrom, gap.newFrom + step - 1];
  }

  // Слить пересекающиеся и соседние диапазоны [from, to].
  function mergeRanges(ranges) {
    const sorted = ranges.filter((r) => Array.isArray(r) && r[0] <= r[1]).map((r) => [r[0], r[1]]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of sorted) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else out.push(r);
    }
    return out;
  }

  // Строки стороны side с номерами от a до b из плоского списка строк, по порядку.
  function quoteLines(lines, side, a, b) {
    const key = side === 'new' ? 'n' : 'o';
    return lines.filter((l) => l[key] != null && l[key] >= a && l[key] <= b);
  }

  // ---------- внутристрочный дифф (4.7) ----------

  const TOKEN_RE = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
  const MAX_LINE = 1000;
  const MAX_RUN = 50;
  const MAX_CELLS = 250000;
  const MIN_SIMILARITY = 0.5;
  // Серии разной длины: пары можно сдвинуть не больше чем на столько строк (вставленная пустая строка и т. п.).
  const MAX_SHIFT = 4;

  function tokenize(s) {
    // TOKEN_RE покрывает любую строку целиком: каждый символ попадает ровно в один токен.
    const out = [];
    for (const m of s.matchAll(TOKEN_RE)) out.push({ s: m[0], from: m.index, to: m.index + m[0].length });
    return out;
  }

  const isSpace = (tok) => /^\s+$/.test(tok.s);

  // Несовпавшие токены → символьные диапазоны; соседние склеиваются, если между ними только пробелы.
  function toRanges(tokens, changed) {
    const ranges = [];
    let cur = null, gapOnlySpace = true;
    for (let k = 0; k < tokens.length; k++) {
      const tok = tokens[k];
      if (changed[k]) {
        if (cur && gapOnlySpace) cur[1] = tok.to;
        else { cur = [tok.from, tok.to]; ranges.push(cur); }
        gapOnlySpace = true;
      } else if (cur && !isSpace(tok)) {
        gapOnlySpace = false;
      }
    }
    return ranges;
  }

  function wordDiff(a, b) {
    if (a === b) return null;
    if (a.length > MAX_LINE || b.length > MAX_LINE) return null;
    const ta = tokenize(a), tb = tokenize(b);
    const na = ta.length, nb = tb.length;
    let pre = 0;
    while (pre < na && pre < nb && ta[pre].s === tb[pre].s) pre++;
    let suf = 0;
    while (suf < na - pre && suf < nb - pre && ta[na - 1 - suf].s === tb[nb - 1 - suf].s) suf++;

    let common = 0;
    for (let k = 0; k < pre; k++) common += ta[k].s.length;
    for (let k = 0; k < suf; k++) common += ta[na - 1 - k].s.length;

    const A = ta.slice(pre, na - suf), B = tb.slice(pre, nb - suf);
    const n = A.length, m = B.length;
    const chA = new Array(na).fill(false), chB = new Array(nb).fill(false);
    for (let k = 0; k < n; k++) chA[pre + k] = true;
    for (let k = 0; k < m; k++) chB[pre + k] = true;

    if (n && m && n * m <= MAX_CELLS) {
      // dp[i][j] — LCS суффиксов A[i..] и B[j..]; одна плоская таблица Uint32Array по строкам.
      const w = m + 1;
      const dp = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        const row = i * w, next = (i + 1) * w;
        const ai = A[i].s;
        for (let j = m - 1; j >= 0; j--) {
          dp[row + j] = ai === B[j].s ? dp[next + j + 1] + 1
            : (dp[next + j] >= dp[row + j + 1] ? dp[next + j] : dp[row + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (A[i].s === B[j].s) {
          chA[pre + i] = false;
          chB[pre + j] = false;
          common += A[i].s.length;
          i++; j++;
        } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
        else j++;
      }
    }

    const total = a.length + b.length;
    if (!total || (2 * common) / total < MIN_SIMILARITY) return null;
    const del = toRanges(ta, chA), add = toRanges(tb, chB);
    if (!del.length && !add.length) return null;
    return { del, add };
  }

  // Подсветка для строк ханка: массив той же длины, что lines; элемент — диапазоны [[from,to],…] или null.
  function intraline(lines) {
    const out = new Array(lines.length).fill(null);
    let i = 0;
    while (i < lines.length) {
      if (lines[i].t === 'ctx') { i++; continue; }
      const dels = [], adds = [];
      while (i < lines.length && lines[i].t === 'del') dels.push(i++);
      while (i < lines.length && lines[i].t === 'add') adds.push(i++);
      if (dels.length > MAX_RUN || adds.length > MAX_RUN) continue;
      const k = Math.min(dels.length, adds.length);
      // Пары по индексу (4.7). Если в серии лишние строки с одной стороны, пробуются сдвиги этой стороны
      // до MAX_SHIFT и берётся тот, где родственных пар больше; при равенстве остаются пары по индексу.
      // Так пустая строка, вставленная перед заменённой, не срывает подсветку настоящей пары.
      const extra = Math.abs(dels.length - adds.length);
      const shifts = extra && extra <= MAX_SHIFT ? extra : 0;
      let best = null;
      for (let o = 0; o <= shifts; o++) {
        const dOff = dels.length > adds.length ? o : 0, aOff = adds.length > dels.length ? o : 0;
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

  // ---------- подсветка синтаксиса (4.8) ----------

  // Четыре класса: t-com, t-str, t-num, t-kw. Язык — по расширению файла.
  // line — строчный комментарий; lineAfterSpace — только в начале строки или после пробела (shell, YAML);
  // block — пары [открытие, закрытие]; quotes — символы кавычек; quoteAfter — после чего кавычка открывает
  // строку (YAML и HTML: иначе апостроф в тексте красит остаток строки); triple и prefixes — строки Python;
  // regex — литералы /…/ в JS (красятся как строки, иначе кавычка внутри них открывает ложную строку).
  const kw = (s) => new Set(s.split(' ').filter(Boolean));
  const LANGS = {
    js: {
      exts: 'js mjs cjs jsx ts tsx', line: '//', block: [['/*', '*/']], quotes: '\'"`', regex: true,
      kw: kw('const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this null undefined true false yield static get set interface type enum implements readonly as delete void super'),
    },
    python: {
      exts: 'py pyi', line: '#', quotes: '\'"', prefixes: true,
      kw: kw('def class return if elif else for while in not and or is import from as with try except finally raise lambda yield None True False pass break continue global nonlocal async await assert del match case'),
    },
    shell: {
      exts: 'sh bash zsh', line: '#', lineAfterSpace: true, quotes: '\'"',
      kw: kw('if then else elif fi for while do done case esac function return in local export readonly set unset echo exit'),
    },
    css: { exts: 'css', block: [['/*', '*/']], quotes: '\'"', css: true, kw: kw('') },
    json: { exts: 'json', quotes: '"', kw: kw('true false null') },
    yaml: { exts: 'yml yaml', line: '#', lineAfterSpace: true, quotes: '\'"', quoteAfter: /[\s:[{,-]/, kw: kw('true false null yes no') },
    go: {
      exts: 'go', line: '//', block: [['/*', '*/']], quotes: '"`\'',
      kw: kw('func package import return if else for range switch case default type struct interface map chan go defer var const nil true false break continue select'),
    },
    rust: {
      exts: 'rs', line: '//', block: [['/*', '*/']], quotes: '"',
      kw: kw('fn let mut pub use mod struct enum impl trait return if else match for while loop in as self Self crate super where move ref true false const static async await'),
    },
    java: {
      exts: 'java kt kts', line: '//', block: [['/*', '*/']], quotes: '"\'',
      kw: kw('class interface public private protected static final void return if else for while new try catch finally throw import package extends implements null true false fun val var when object'),
    },
    c: {
      exts: 'c h cc cpp hpp', line: '//', block: [['/*', '*/']], quotes: '"\'',
      kw: kw('int char void return if else for while do switch case break continue struct typedef enum static const unsigned sizeof include define class public private namespace template nullptr true false'),
    },
    html: { exts: 'html htm', block: [['<!--', '-->']], quotes: '"\'', quoteAfter: /[\s=(,[{:]/, kw: kw('') },
  };
  const LANG_BY_EXT = new Map();
  for (const [name, def] of Object.entries(LANGS)) {
    def.name = name;
    for (const ext of def.exts.split(' ')) LANG_BY_EXT.set(ext, def);
  }

  function langOf(path) {
    const base = String(path || '').split('/').pop();
    const dot = base.lastIndexOf('.');
    return dot > 0 ? LANG_BY_EXT.get(base.slice(dot + 1).toLowerCase()) || null : null;
  }

  const NUM_RE = /\b\d[\d_]*(\.\d+)?([eE][+-]?\d+)?\b|0x[0-9a-fA-F]+/y;
  // CSS: числа с единицами (12px, .5s, 100%) и цвета #rgb/#rrggbb. Не внутри имён вроде --s-12 и h1.
  const CSS_NUM_RE = /(?<![\w#-])(?:\d+(?:\.\d+)?|\.\d+)(?:%|[a-zA-Z]+)?|#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/y;
  const WORD_RE = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
  const PY_STR_RE = /([rRbBuUfF]{1,2})?("""|'''|"|')/y;
  // Перед «/» регулярное выражение, а не деление: начало строки, оператор, открывающая скобка или ключевое слово.
  const REGEX_BEFORE = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new))\s*$/;
  const MAX_SYN_LINE = 1000;
  const MAX_SYN_FILE = 5000;

  // Конец строки в кавычках q от позиции from с учётом «\». -1, если на этой строке её нет.
  function closeQuote(text, from, q) {
    for (let k = from; k < text.length; k++) {
      if (text[k] === '\\') { k++; continue; }
      if (text.startsWith(q, k)) return k + q.length;
    }
    return -1;
  }

  // Конец литерала /…/flags или -1. Внутри [...] «/» не закрывает литерал.
  function closeRegex(text, from) {
    let cls = false;
    for (let k = from + 1; k < text.length; k++) {
      const c = text[k];
      if (c === '\\') { k++; continue; }
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

  // Токены одной строки: [{from, to, cls}] по возрастанию, без пересечений.
  // state переносит между строками незакрытый блочный комментарий или тройную кавычку Python: {end, cls}.
  // Без state каждая строка разбирается с чистого листа.
  function highlight(text, lang, state) {
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
    const push = (from, to, cls) => { out.push({ from, to, cls }); pos = to; };
    scan: while (pos < n) {
      const c = text[pos];
      if (L.block) {
        for (const [open, close] of L.block) {
          if (!text.startsWith(open, pos)) continue;
          const e = text.indexOf(close, pos + open.length);
          if (e < 0) { st.end = close; st.cls = 't-com'; push(pos, n, 't-com'); break scan; }
          push(pos, e + close.length, 't-com');
          continue scan;
        }
      }
      if (L.line && text.startsWith(L.line, pos) && (!L.lineAfterSpace || pos === 0 || /\s/.test(text[pos - 1]))) {
        push(pos, n, 't-com');
        break;
      }
      if (L.prefixes) {
        // Python: префиксы f r b u и тройные кавычки, которые могут продолжаться на следующих строках.
        PY_STR_RE.lastIndex = pos;
        const m = PY_STR_RE.exec(text);
        if (m) {
          const q = m[2];
          const e = closeQuote(text, pos + m[0].length, q);
          if (e < 0 && q.length === 3) { st.end = q; st.cls = 't-str'; push(pos, n, 't-str'); break; }
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
        if (e > 0) { push(pos, e, 't-str'); continue; }
      }
      const numRe = L.css ? CSS_NUM_RE : NUM_RE;
      numRe.lastIndex = pos;
      const num = numRe.exec(text);
      if (num && num[0]) { push(pos, pos + num[0].length, 't-num'); continue; }
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

  // Токены строк ханка: массив той же длины, что lines. Состояние ведётся отдельно для старой стороны
  // (ctx и del) и новой (ctx и add) и сбрасывается в начале ханка. Строка контекста берёт токены новой стороны.
  function highlightHunk(lines, lang) {
    const L = typeof lang === 'string' ? LANGS[lang] : lang;
    const out = new Array(lines.length).fill(null);
    if (!L) return out;
    const oldSt = { end: null, cls: null }, newSt = { end: null, cls: null };
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

  // Токены всех строк файла по сквозному индексу строки (l.i) или null, если подсветки нет:
  // язык не знаком или в патче больше 5000 строк.
  function highlightFile(hunks, path) {
    const L = langOf(path);
    if (!L) return null;
    let total = 0;
    for (const hk of hunks) total += hk.lines.length;
    if (total > MAX_SYN_FILE) return null;
    const out = new Array(total).fill(null);
    for (const hk of hunks) {
      const r = highlightHunk(hk.lines, L);
      hk.lines.forEach((l, k) => { out[l.i] = r[k]; });
    }
    return out;
  }

  // ---------- слияние сегментов ----------

  // wordRanges: [[from,to],…]; synTokens: [{from, to, cls}]. Результат: [{text, w, cls}] без пустых отрезков.
  function segments(text, wordRanges, synTokens) {
    const words = wordRanges || [], syn = synTokens || [];
    if (!words.length && !syn.length) return text ? [{ text, w: false, cls: null }] : [];
    const cuts = new Set([0, text.length]);
    for (const [a, b] of words) { cuts.add(a); cuts.add(b); }
    for (const t of syn) { cuts.add(t.from); cuts.add(t.to); }
    const points = [...cuts].filter((x) => x >= 0 && x <= text.length).sort((x, y) => x - y);
    const out = [];
    let wi = 0, si = 0;
    for (let k = 0; k < points.length - 1; k++) {
      const from = points[k], to = points[k + 1];
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

  // ---------- прочее ----------

  // FNV-1a 32 бита по UTF-16 кодам строки, результат — 8 hex-символов.
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let k = 0; k < str.length; k++) {
      h ^= str.charCodeAt(k);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  const PLURAL = typeof Intl !== 'undefined' ? new Intl.PluralRules('ru') : null;
  // plural(5, ['файл', 'файла', 'файлов']) → 'файлов'
  function plural(n, forms) {
    const cat = PLURAL ? PLURAL.select(n) : 'many';
    return cat === 'one' ? forms[0] : cat === 'few' ? forms[1] : forms[2];
  }

  const DiffCore = {
    parsePatch, splitPairs, changeBlocks, buildView, gapsOf, expandRange, mergeRanges, quoteLines, tokenize, wordDiff, intraline,
    LANGS, langOf, highlight, highlightHunk, highlightFile, segments, fnv1a, plural, TOKEN_RE,
  };
  root.DiffCore = DiffCore;
  if (typeof module === 'object' && module.exports) module.exports = DiffCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);

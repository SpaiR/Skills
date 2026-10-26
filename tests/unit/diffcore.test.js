// Tests of the viewer core (assets/js/diffcore.js): patch parsing, word diff, highlighting, helpers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import * as D from '../../assets/js/diffcore.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

// Per-file patches of a fixture, in the format serve.py returns (from "diff --git" to the next one).
function filePatches(fx) {
  const text = fs.readFileSync(path.join(ROOT, 'tests/fixtures', fx, 'guide.patch'), 'utf8');
  const out = {};
  for (const chunk of text.split(/^(?=diff --git )/m)) {
    const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(chunk);
    if (m) out[m[2]] = chunk;
  }
  return out;
}
const mixed = filePatches('mixed');
const pick = (hunks, t, side, no) => hunks.flatMap((h) => h.lines).find((l) => l.t === t && l[side] === no);

test('parsePatch reads the hunks of collect.py: lengths, function context, line numbers', () => {
  const hunks = D.parsePatch(mixed['scripts/collect.py']);
  assert.equal(hunks.length, 3);
  assert.deepEqual(
    hunks.map((h) => [h.oldStart, h.oldLen, h.newStart, h.newLen]),
    [
      [31, 7, 31, 7],
      [50, 9, 50, 12],
      [65, 7, 68, 7],
    ],
  );
  assert.equal(hunks[0].fn, 'DIFF_FLAGS = [');
  assert.equal(hunks[1].fn, 'def out(root, *args, **kw):');
  const del34 = pick(hunks, 'del', 'o', 34),
    add34 = pick(hunks, 'add', 'n', 34);
  assert.equal(del34.s, 'LOG_LIMIT = 50');
  assert.equal(add34.s, 'LOG_LIMIT = 100  # больше коммитов в сводке');
  for (const h of hunks) {
    const olds = h.lines.filter((l) => l.t !== 'add').length,
      news = h.lines.filter((l) => l.t !== 'del').length;
    assert.equal(olds, h.oldLen);
    assert.equal(news, h.newLen);
  }
});

test('parsePatch numbers lines with a running index across hunks', () => {
  const hunks = D.parsePatch(mixed['scripts/collect.py']);
  const all = hunks.flatMap((h) => h.lines);
  assert.deepEqual(
    all.map((l) => l.i),
    all.map((_, k) => k),
  );
});

test('parsePatch computes the skipped ranges before hunks (30, 12 and 6 lines)', () => {
  const hunks = D.parsePatch(mixed['scripts/collect.py']);
  assert.deepEqual(
    hunks.map((h) => h.skip && [h.skip.from, h.skip.to, h.skip.n, h.skip.first]),
    [
      [1, 30, 30, true],
      [38, 49, 12, false],
      [59, 64, 6, false],
    ],
  );
});

test('parsePatch treats a length without a comma as 1 and gives a new file no skip', () => {
  const hunks = D.parsePatch(mixed['package-lock.json']);
  assert.equal(hunks.length, 1);
  assert.deepEqual([hunks[0].oldStart, hunks[0].oldLen, hunks[0].newStart, hunks[0].newLen], [0, 0, 1, 1]);
  assert.equal(hunks[0].skip, null);
});

test('parsePatch returns no hunks for a binary file and flags "No newline at end of file"', () => {
  assert.equal(D.parsePatch(mixed['assets/logo.png']).length, 0);
  const h = D.parsePatch('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n');
  assert.equal(h[0].lines[0].nonl, true);
  assert.equal(h[0].lines[1].nonl, undefined);
});

test('parsePatch does not report a false skip for an insertion after a line (oldLen 0)', () => {
  const h = D.parsePatch('@@ -3,0 +4,1 @@\n+x\n@@ -10,2 +11,2 @@\n a\n b\n');
  assert.deepEqual(h[0].skip, { from: 1, to: 3, n: 3, first: true });
  assert.deepEqual(h[1].skip, { from: 4, to: 9, n: 6, first: false });
});

test('splitPairs and changeBlocks', () => {
  const hunks = D.parsePatch(mixed['scripts/collect.py']);
  const lines = hunks[1].lines;
  const pairs = D.splitPairs(lines);
  const dels = lines.filter((l) => l.t === 'del').length,
    adds = lines.filter((l) => l.t === 'add').length;
  const ctx = lines.filter((l) => l.t === 'ctx').length;
  assert.equal(pairs.length, ctx + Math.max(dels, adds));
  assert.equal(pairs.filter(([a, b]) => a && !b).length, 0);
  assert.equal(pairs.filter(([a, b]) => !a && b).length, adds - dels);
  const blocks = D.changeBlocks(lines);
  assert.equal(blocks.length, 1);
  assert.ok(lines.slice(blocks[0].from, blocks[0].to + 1).every((l) => l.t !== 'ctx'));
  assert.deepEqual(D.changeBlocks(D.parsePatch('@@ -1,3 +1,3 @@\n-a\n+b\n c\n-d\n').flatMap((h) => h.lines)), [
    { from: 0, to: 1 },
    { from: 3, to: 3 },
  ]);
});

test('wordDiff highlights the number on both sides for MAX_SECTIONS 10 -> 12 (validate.py, line 16)', () => {
  const hunks = D.parsePatch(mixed['scripts/validate.py']);
  const a = pick(hunks, 'del', 'o', 16).s,
    b = pick(hunks, 'add', 'n', 16).s;
  const r = D.wordDiff(a, b);
  assert.deepEqual(r, { del: [[15, 17]], add: [[15, 17]] });
  assert.equal(a.slice(15, 17), '10');
});

test('wordDiff skips line 59 of validate.py: a pure 153-character insertion, similarity 0.42 < 0.5, no highlight', () => {
  const hunks = D.parsePatch(mixed['scripts/validate.py']);
  const a = pick(hunks, 'del', 'o', 59).s,
    b = pick(hunks, 'add', 'n', 59).s;
  assert.ok(b.startsWith(a.slice(0, -2)) && b.endsWith('")'));
  assert.equal(D.wordDiff(a, b), null);
});

test('wordDiff shows the inserted argument in add for verify(root, ref) -> verify(root, ref, kind="commit")', () => {
  const r = D.wordDiff('def verify(root, ref):', 'def verify(root, ref, kind="commit"):');
  assert.deepEqual(r.del, []);
  assert.deepEqual(r.add, [[20, 35]]);
  assert.equal('def verify(root, ref, kind="commit"):'.slice(20, 35), ', kind="commit"');
});

test('wordDiff returns null for unrelated lines (similarity threshold)', () => {
  assert.equal(
    D.wordDiff('    res = git(root, "rev-parse", "--verify")', '    """Возвращает полный sha или None."""'),
    null,
  );
  assert.equal(D.wordDiff('foo bar baz', 'completely different words here'), null);
});

test('wordDiff tokenizes Cyrillic words and digits as one word and punctuation as separate tokens', () => {
  assert.deepEqual(
    D.tokenize('Привет, мир_2!').map((t) => t.s),
    ['Привет', ',', ' ', 'мир_2', '!'],
  );
  const r = D.wordDiff('ошибка в главе номер один', 'ошибка в главе номер два');
  assert.deepEqual(r, { del: [[21, 25]], add: [[21, 24]] });
  assert.equal('ошибка в главе номер один'.slice(21, 25), 'один');
});

test('wordDiff merges neighbouring ranges across spaces and highlights whitespace-only changes', () => {
  const r = D.wordDiff('result = one two three + offset', 'result = uno dos tres + offset');
  assert.deepEqual(r, { del: [[9, 22]], add: [[9, 21]] });
  // A shorter line with the same change: 10 of 41 characters in common, similarity 0.49 - no longer related.
  assert.equal(D.wordDiff('a = one two three + x', 'a = uno dos tres + x'), null);
  const ws = D.wordDiff('if (a)  return b', 'if (a) return b');
  assert.deepEqual(ws, { del: [[6, 8]], add: [[6, 7]] });
});

test('wordDiff does not highlight lines longer than 1000 characters', () => {
  assert.equal(D.wordDiff('x'.repeat(1001), 'y' + 'x'.repeat(1000)), null);
});

test('intraline pairs lines by index inside a run and skips runs longer than 50 lines', () => {
  const hunks = D.parsePatch(mixed['scripts/validate.py']);
  const wd = D.intraline(hunks[0].lines);
  const k16 = hunks[0].lines.findIndex((l) => l.t === 'del');
  assert.deepEqual(wd[k16], [[15, 17]]);
  assert.deepEqual(wd[k16 + 1], [[15, 17]]);
  assert.ok(hunks[0].lines.every((l, k) => l.t !== 'ctx' || wd[k] === null));
  const big =
    '@@ -1,51 +1,51 @@\n' +
    Array.from({ length: 51 }, (_, k) => `-v${k} = 1\n`).join('') +
    Array.from({ length: 51 }, (_, k) => `+v${k} = 2\n`).join('');
  assert.ok(D.intraline(D.parsePatch(big)[0].lines).every((x) => x === null));
});

test('intraline shifts the pairing in an uneven run when the pair by index is unrelated', () => {
  // An empty line is inserted before the replaced one: by index the del pairs with the empty add, a shift by 1 finds the real pair.
  const lines = D.parsePatch('@@ -1,2 +1,3 @@\n a\n-\treturn имя + s;\n+\n+\treturn имя + фамилия + s;\n')[0].lines;
  const wd = D.intraline(lines);
  assert.equal(wd[2], null);
  assert.deepEqual(wd[3], [[14, 24]]);
  // Equal lengths pair strictly by index: an unrelated first pair does not look for another partner.
  const eq = D.parsePatch('@@ -1,2 +1,2 @@\n-x = alpha beta gamma\n-y = 1\n+y = 2\n+x = alpha beta delta\n')[0].lines;
  assert.ok(D.intraline(eq).every((r) => r === null));
});

test('segments merges word ranges and highlight tokens', () => {
  assert.deepEqual(D.segments('abc', [], []), [{ text: 'abc', w: false, cls: null }]);
  assert.deepEqual(D.segments('', [], []), []);
  assert.deepEqual(
    D.segments(
      'const x = 10;',
      [[10, 12]],
      [
        { from: 0, to: 5, cls: 't-kw' },
        { from: 10, to: 12, cls: 't-num' },
      ],
    ),
    [
      { text: 'const', w: false, cls: 't-kw' },
      { text: ' x = ', w: false, cls: null },
      { text: '10', w: true, cls: 't-num' },
      { text: ';', w: false, cls: null },
    ],
  );
  assert.deepEqual(
    D.segments('abcdef', [[1, 4]], [{ from: 3, to: 6, cls: 't-str' }]).map((s) => [s.text, s.w, s.cls]),
    [
      ['a', false, null],
      ['bc', true, null],
      ['d', true, 't-str'],
      ['ef', false, 't-str'],
    ],
  );
  const text = 'всё — «текст»';
  assert.equal(
    D.segments(text, [[2, 6]], [])
      .map((s) => s.text)
      .join(''),
    text,
  );
});

test('fnv1a returns the reference values as 8 hex characters', () => {
  assert.equal(D.fnv1a(''), '811c9dc5');
  assert.equal(D.fnv1a('a'), 'e40c292c');
  assert.equal(D.fnv1a('foobar'), 'bf9cf968');
  assert.match(D.fnv1a(mixed['scripts/collect.py']), /^[0-9a-f]{8}$/);
});

test('plural picks the Russian forms', () => {
  const f = ['файл', 'файла', 'файлов'];
  assert.deepEqual(
    [0, 1, 2, 3, 5, 11, 21, 22, 25, 101, 112].map((n) => D.plural(n, f)),
    ['файлов', 'файл', 'файла', 'файла', 'файлов', 'файлов', 'файл', 'файла', 'файлов', 'файл', 'файлов'],
  );
});

// Highlight tokens as [class, text] pairs for readable comparisons.
const hl = (s, lang, st) => D.highlight(s, lang, st).map((t) => [t.cls, s.slice(t.from, t.to)]);

test('highlight Python: keywords, prefixed strings, numbers, comments', () => {
  assert.deepEqual(hl('def verify(root, ref, kind="commit"):  # проверка', 'python'), [
    ['t-kw', 'def'],
    ['t-str', '"commit"'],
    ['t-com', '# проверка'],
  ]);
  assert.deepEqual(hl('import json, re', 'python'), [['t-kw', 'import']]);
  assert.deepEqual(hl("s = r'\\d+' + f\"{x}\" + rb'y' + buf", 'python'), [
    ['t-str', "r'\\d+'"],
    ['t-str', 'f"{x}"'],
    ['t-str', "rb'y'"],
  ]);
  assert.deepEqual(hl('x = 0x1F + 3.14e-2 + 1_000 + v2', 'python'), [
    ['t-num', '0x1F'],
    ['t-num', '3.14e-2'],
    ['t-num', '1_000'],
  ]);
  assert.deepEqual(hl('s = "a # не комментарий \\" ещё строка"', 'python'), [
    ['t-str', '"a # не комментарий \\" ещё строка"'],
  ]);
  assert.deepEqual(
    hl('elif None is not True:', 'python').map((t) => t[1]),
    ['elif', 'None', 'is', 'not', 'True'],
  );
});

test('highlight Python: a triple quote carries over to the next lines and each side keeps its own state', () => {
  const st = { end: null, cls: null };
  assert.deepEqual(hl('    """Возвращает полный sha', 'python', st), [['t-str', '"""Возвращает полный sha']]);
  assert.deepEqual(st, { end: '"""', cls: 't-str' });
  assert.deepEqual(hl('    или None."""  # конец', 'python', st), [
    ['t-str', '    или None."""'],
    ['t-com', '# конец'],
  ]);
  assert.equal(st.end, null);
  // A string opened in del does not colour add or context: the new side has its own state.
  const lines = [
    { t: 'del', s: 'x = """начало' },
    { t: 'add', s: 'x = 1' },
    { t: 'ctx', s: 'y = 2' },
  ];
  const r = D.highlightHunk(lines, 'python');
  assert.deepEqual(
    r[1].map((t) => t.cls),
    ['t-num'],
  );
  assert.deepEqual(
    r[2].map((t) => t.cls),
    ['t-num'],
  );
});

test('highlight JS: keywords, three kinds of strings, /.../ literals, block comment across lines', () => {
  assert.deepEqual(hl("const esc = (s) => String(s).replace(/[&<>\"']/g, (c) => ({ '&': '&amp;' }[c]));", 'js'), [
    ['t-kw', 'const'],
    ['t-str', '/[&<>"\']/g'],
    ['t-str', "'&'"],
    ['t-str', "'&amp;'"],
  ]);
  assert.deepEqual(hl('const a = b / c / 2; // деление', 'js'), [
    ['t-kw', 'const'],
    ['t-num', '2'],
    ['t-com', '// деление'],
  ]);
  assert.deepEqual(hl('if (x) return /a\\/b/i.test(`t ${y}`);', 'js'), [
    ['t-kw', 'if'],
    ['t-kw', 'return'],
    ['t-str', '/a\\/b/i'],
    ['t-str', '`t ${y}`'],
  ]);
  const st = { end: null, cls: null };
  assert.deepEqual(hl('a(); /* открыт', 'js', st), [['t-com', '/* открыт']]);
  assert.deepEqual(hl('  всё ещё', 'js', st), [['t-com', '  всё ещё']]);
  assert.deepEqual(hl('  конец */ let b', 'js', st), [
    ['t-com', '  конец */'],
    ['t-kw', 'let'],
  ]);
});

test('highlight Shell: # starts a comment only after a space, not in $# or ${#...}', () => {
  assert.deepEqual(hl('echo "$#" ${#arr} # комментарий', 'shell'), [
    ['t-kw', 'echo'],
    ['t-str', '"$#"'],
    ['t-com', '# комментарий'],
  ]);
  assert.deepEqual(hl("if [ -n 'x' ]; then exit 1; fi", 'shell'), [
    ['t-kw', 'if'],
    ['t-str', "'x'"],
    ['t-kw', 'then'],
    ['t-kw', 'exit'],
    ['t-num', '1'],
    ['t-kw', 'fi'],
  ]);
});

test('highlight CSS, YAML, HTML, JSON: numbers with units, an apostrophe in text does not open a string', () => {
  assert.deepEqual(
    hl('--s-12: 48px; width: calc(100% - .5rem); color: #2c56c9; /* c */', 'css').map((t) => t[1]),
    ['48px', '100%', '.5rem', '#2c56c9', '/* c */'],
  );
  assert.deepEqual(hl("key: don't # c", 'yaml'), [['t-com', '# c']]);
  assert.deepEqual(hl('<script src="/a.js"></script> <!-- c --> it\'s', 'html'), [
    ['t-str', '"/a.js"'],
    ['t-com', '<!-- c -->'],
  ]);
  assert.deepEqual(
    hl('{"a": true, "b": 12.5}', 'json').map((t) => t[0]),
    ['t-str', 't-kw', 't-str', 't-num'],
  );
});

test('langOf and limits: no highlighting for Markdown, files over 5000 lines or lines over 1000 characters', () => {
  assert.equal(D.langOf('SKILL.md'), null);
  assert.equal(D.langOf('scripts/collect.py').name, 'python');
  assert.equal(D.langOf('assets/viewer.JS').name, 'js');
  assert.equal(D.langOf('.bashrc'), null);
  assert.equal(D.highlightFile(D.parsePatch(mixed['scripts/collect.py']), 'README.md'), null);
  const many = Array.from({ length: 5001 }, (_, k) => `+x = ${k}`);
  assert.equal(D.highlightFile(D.parsePatch(`@@ -0,0 +1,5001 @@\n${many.join('\n')}\n`), 'a.py'), null);
  const ok = D.highlightFile(D.parsePatch('@@ -0,0 +1,2 @@\n+x = 1\n+y = 2\n'), 'a.py');
  assert.deepEqual(
    ok.map((t) => t.map((x) => x.cls)),
    [['t-num'], ['t-num']],
  );
  assert.deepEqual(D.highlight(`x = "${'a'.repeat(1000)}"`, 'python'), []);
});

test('highlight and segments combine a token and a word highlight in one segment', () => {
  const s = 'MAX_SECTIONS = 12';
  const segs = D.segments(s, [[15, 17]], D.highlight(s, 'python'));
  assert.deepEqual(
    segs.map((x) => [x.text, x.w, x.cls]),
    [
      ['MAX_SECTIONS = ', false, null],
      ['12', true, 't-num'],
    ],
  );
});

test('highlightFile on collect.py of the mixed fixture: def in add, # comment, tokens by running index', () => {
  const hunks = D.parsePatch(mixed['scripts/collect.py']);
  const syn = D.highlightFile(hunks, 'scripts/collect.py');
  const lines = hunks.flatMap((h) => h.lines);
  assert.equal(syn.length, lines.length);
  const text = (l) => syn[l.i].map((t) => [t.cls, l.s.slice(t.from, t.to)]);
  const addDef = lines.find((l) => l.t === 'add' && l.s.startsWith('def verify'));
  assert.deepEqual(text(addDef)[0], ['t-kw', 'def']);
  const com = lines.find((l) => l.t === 'add' && l.s.includes('# больше коммитов'));
  assert.deepEqual(text(com).pop(), ['t-com', '# больше коммитов в сводке']);
});

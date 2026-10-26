// Тесты раскрытия контекста (buildView, expandRange, mergeRanges, quoteLines): node harness/tests/expand.test.js
// Патчи настоящие: временный git-репозиторий, -U3 и -U100000000 по одной правке.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const D = require(path.join(__dirname, '../../assets/diffcore.js'));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.log('FAIL', name); console.log(e); process.exitCode = 1; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-expand-'));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
let seq = 0;

// before/after — содержимое файла; rename — новое имя. Возвращает {base, full} как разобранные ханки.
function diffOf(before, after, rename) {
  const dir = path.join(tmp, `r${seq++}`);
  fs.mkdirSync(dir);
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'f.txt'), before);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'a');
  if (rename) { git(dir, 'mv', 'f.txt', rename); }
  fs.writeFileSync(path.join(dir, rename || 'f.txt'), after);
  git(dir, 'add', '-A');
  const flags = ['diff', '--cached', '--no-color', '--find-renames', 'HEAD'];
  const base = D.parsePatch(git(dir, ...flags, '-U3'));
  const fullHunks = D.parsePatch(git(dir, ...flags, '-U100000000'));
  assert.equal(fullHunks.length, 1, 'полный дифф — один ханк');
  return { base, full: fullHunks[0].lines };
}

const nums = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => `line ${a + k}`);
const text = (arr, nl = true) => arr.join('\n') + (nl ? '\n' : '');
const visible = (view) => view.hunks.flatMap((h) => h.lines);
const sig = (lines) => lines.map((l) => `${l.t}:${l.o ?? ''}:${l.n ?? ''}:${l.s}`);

// Файл на 100 строк, правки в 30 и 70: два ханка, три промежутка.
const two = () => {
  const a = nums(1, 100), b = a.slice();
  b[29] = 'changed 30';
  b[69] = 'changed 70';
  return diffOf(text(a), text(b));
};

test('buildView без раскрытий повторяет исходные ханки', () => {
  const { base, full } = two();
  const v = D.buildView(full, base, [], false);
  assert.equal(v.hunks.length, base.length);
  assert.deepEqual(sig(visible(v)), sig(base.flatMap((h) => h.lines)));
  assert.deepEqual(v.hunks.map((h) => h.header.replace(/ @@.*/, ' @@')), base.map((h) => h.header.replace(/ @@.*/, ' @@')));
  visible(v).forEach((l, k) => assert.equal(l.i, k, 'сквозной индекс'));
});

test('промежутки: начало, середина, хвост — с новыми номерами и at', () => {
  const { base, full } = two();
  const v = D.buildView(full, base, [], false);
  assert.deepEqual(v.gaps.map((g) => [g.at, g.newFrom, g.newTo, g.n]), [[0, 1, 26, 26], [1, 34, 66, 33], [2, 74, 100, 27]]);
});

test('expandRange: up — над следующим ханком, down — под предыдущим, короткий — целиком', () => {
  const g = { newFrom: 34, newTo: 66, n: 33 };
  assert.deepEqual(D.expandRange(g, 'up', 20), [47, 66]);
  assert.deepEqual(D.expandRange(g, 'down', 20), [34, 53]);
  assert.deepEqual(D.expandRange(g, 'all', 20), [34, 66]);
  assert.deepEqual(D.expandRange({ newFrom: 1, newTo: 15, n: 15 }, 'up', 20), [1, 15]);
});

test('частичное раскрытие вверх: ханк растёт, заголовок и номера пересчитаны', () => {
  const { base, full } = two();
  const v0 = D.buildView(full, base, [], false);
  const v = D.buildView(full, base, [D.expandRange(v0.gaps[1], 'up', 20)], false);
  assert.equal(v.hunks.length, 2);
  assert.ok(v.hunks[1].header.startsWith('@@ -47,27 +47,27 @@'), v.hunks[1].header);
  assert.deepEqual(v.gaps.find((g) => g.at === 1).newTo, 46);
});

test('промежуток закрылся — ханки слились, разделителя нет', () => {
  const { base, full } = two();
  const v0 = D.buildView(full, base, [], false);
  const v = D.buildView(full, base, [D.expandRange(v0.gaps[1], 'all', 20)], false);
  assert.equal(v.hunks.length, 1);
  assert.deepEqual(v.gaps.map((g) => g.at), [0, 1]);
});

test('весь файл: все строки, промежутков нет', () => {
  const { base, full } = two();
  const v = D.buildView(full, base, [], true);
  assert.equal(v.gaps.length, 0);
  assert.deepEqual(sig(visible(v)), sig(full));
  assert.ok(v.hunks[0].header.startsWith('@@ -1,100 +1,100 @@'));
});

test('изолированный раскрытый диапазон посреди промежутка — отдельный ханк без fn', () => {
  const { base, full } = two();
  const v = D.buildView(full, base, [[50, 50]], false);
  assert.equal(v.hunks.length, 3);
  assert.equal(v.hunks[1].header, '@@ -50,1 +50,1 @@');
  assert.equal(v.hunks[1].lines[0].s, 'line 50');
});

test('вставка в начало файла (старая длина 0 в -U0 смысле) и удаление в конце', () => {
  const a = nums(1, 40);
  const b = ['new top', ...a.slice(0, 39)];
  const { base, full } = diffOf(text(a), text(b));
  const v = D.buildView(full, base, [], false);
  assert.deepEqual(sig(visible(v)), sig(base.flatMap((h) => h.lines)));
  assert.equal(v.gaps.length, 1, 'только середина');
  const all = D.buildView(full, base, [], true);
  assert.equal(visible(all).filter((l) => l.t === 'del').length, 1);
});

test('нет перевода строки в конце: nonl переносится, хвост раскрывается', () => {
  const a = nums(1, 60), b = a.slice();
  b[9] = 'changed 10';
  const { base, full } = diffOf(text(a, false), text(b, false));
  const v0 = D.buildView(full, base, [], false);
  const tail = v0.gaps.find((g) => g.at === v0.hunks.length);
  assert.equal(tail.newTo, 60);
  const v = D.buildView(full, base, [D.expandRange(tail, 'all', 20)], false);
  const last = visible(v).pop();
  assert.equal(last.n, 60);
  assert.equal(last.nonl, true);
});

test('CRLF: \\r остаётся в тексте строк, сверка проходит', () => {
  const a = nums(1, 30).map((s) => `${s}\r`), b = a.slice();
  b[14] = 'changed 15\r';
  const { base, full } = diffOf(text(a), text(b));
  const v = D.buildView(full, base, [], true);
  assert.ok(v);
  assert.ok(visible(v)[0].s.endsWith('\r'));
});

test('переименование с правкой: работает так же', () => {
  const a = nums(1, 50), b = a.slice();
  b[24] = 'changed 25';
  const { base, full } = diffOf(text(a), text(b), 'g.txt');
  const v = D.buildView(full, base, [], false);
  assert.ok(v);
  assert.equal(v.gaps.length, 2);
});

test('расхождение с исходным патчем → null', () => {
  const { base, full } = two();
  const bad = full.map((l) => (l.n === 30 && l.t === 'add' ? { ...l, s: 'другое' } : l));
  assert.equal(D.buildView(bad, base, [], false), null);
  const shifted = full.map((l) => (l.t === 'ctx' && l.n === 28 ? { ...l, n: 999 } : l));
  assert.equal(D.buildView(shifted, base, [], false), null);
});

test('gapsOf по ханкам совпадает с промежутками buildView — до и после раскрытий', () => {
  const strip = (gs) => gs.map(({ at, n, newFrom, newTo }) => ({ at, n, newFrom, newTo }));
  const cases = [two()];
  const a = nums(1, 40);
  cases.push(diffOf(text(a), text(['new top', ...a.slice(0, 39)])));
  const b = nums(1, 60), b2 = b.slice(); b2[9] = 'x';
  cases.push(diffOf(text(b, false), text(b2, false)));
  for (const { base, full } of cases) {
    const total = full.filter((l) => l.n != null).length;
    assert.deepEqual(strip(D.gapsOf(base, total)), strip(D.buildView(full, base, [], false).gaps));
    const v = D.buildView(full, base, [[total - 2, total], [5, 6]], false);
    assert.deepEqual(strip(D.gapsOf(v.hunks, total)), strip(v.gaps));
  }
});

test('mergeRanges: соседние и пересекающиеся сливаются, мусор отброшен', () => {
  assert.deepEqual(D.mergeRanges([[10, 12], [1, 3], [4, 5], [11, 20], [30, 29], 'x']), [[1, 5], [10, 20]]);
});

test('quoteLines: строки стороны по номерам из полного списка', () => {
  const { full } = two();
  assert.deepEqual(D.quoteLines(full, 'new', 29, 31).map((l) => l.s), ['line 29', 'changed 30', 'line 31']);
  assert.deepEqual(D.quoteLines(full, 'old', 30, 30).map((l) => l.s), ['line 30']);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed${process.exitCode ? ', есть провалы' : ''}`);

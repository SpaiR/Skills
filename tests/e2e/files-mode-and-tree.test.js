// The "Files" mode: switching with G, keys that work in it, the file tree, filter, resizing and collapse-all.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expectCleanSession, fileSel, numSel, sleep, useEnv } from './lib.js';

const F = fileSel;

describe('files mode and file tree', () => {
  const env = useEnv();

  const toEl = (page, sel, dy = 300) =>
    page.evaluate(
      ([s, d]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - d),
      [sel, dy],
    );
  const waitSaved = () => sleep(700);

  it('keeps the file and line under the header on G, remembers the mode after reload, and opens a new review in "Гайд"', async (t) => {
    // was F1
    const fx = await env.server('mixed2');
    let page = await env.open(fx);
    assert.ok(
      !(await page.evaluate(() => document.documentElement.classList.contains('mode-files'))),
      'a new review did not open in "Гайд"',
    );
    await toEl(page, numSel(F('scripts/collect.py'), 'new', 56), 400);
    // The mode keeps the first line under the pinned headers (header + chapter + file = 140px in "Гайд").
    const pick = () =>
      page.evaluate(() => {
        const y = 52 + 48 + 40;
        const row = [...document.querySelectorAll('tr.ln')].find((r) => r.getBoundingClientRect().top >= y);
        const n = row.querySelector('td.num[data-no]');
        return {
          key: `${row.closest('.file').dataset.path}:${n.dataset.side}${n.dataset.no}`,
          top: row.getBoundingClientRect().top,
        };
      });
    const where = (key) =>
      page.evaluate((k) => {
        const [path, sn] = [k.slice(0, k.lastIndexOf(':')), k.slice(k.lastIndexOf(':') + 1)];
        const n = document.querySelector(
          `.file[data-path="${path}"] td.num[data-side="${sn.startsWith('new') ? 'new' : 'old'}"][data-no="${sn.replace(/\D/g, '')}"]`,
        );
        return n ? n.closest('tr').getBoundingClientRect().top : null;
      }, key);
    const a = await pick();
    await page.keyboard.press('g');
    await page.waitForTimeout(300);
    const b = await where(a.key);
    const files = await page.evaluate(() => document.documentElement.classList.contains('mode-files'));
    assert.ok(files, 'G did not switch to "Файлы"');
    assert.ok(b != null && Math.abs(b - a.top) < 2, `in "Файлы" line ${a.key}: ${a.top} -> ${b}`);
    await page.keyboard.press('g');
    await page.waitForTimeout(300);
    const c = await where(a.key);
    assert.ok(c != null && Math.abs(c - a.top) < 2, `back in "Гайд": ${a.top} -> ${c}`);
    await page.keyboard.press('g');
    await waitSaved();
    page = await env.open(fx);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.classList.contains('mode-files') && !!document.querySelector('#toc .tree'),
      ),
      'the mode is not "Файлы" after reload',
    );
    t.diagnostic(`${a.key}: ${a.top.toFixed(0)} -> ${b.toFixed(0)} -> ${c.toFixed(0)}`);
  });

  it('supports V, J/K, N/P and O in "Файлы", while chapter keys only show a hint and change nothing', async (t) => {
    // was F2
    const fx = await env.server('mixed2', { mode: 'files' });
    const page = await env.open(fx);
    await page.keyboard.press('j');
    // At the very top the first file is current (as in "Гайд"); J moves to the second.
    const first = await page.evaluate(
      () => document.querySelector('.file-head.is-current').closest('.file').dataset.path,
    );
    assert.equal(first, 'assets/viewer.html', `J -> ${first}`);
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    const cur = await page.evaluate(
      () => document.querySelector('.file-head.is-current').closest('.file').dataset.path,
    );
    assert.equal(cur, 'scripts/collect.py', `J x4 -> ${cur}`);
    await page.keyboard.press('v');
    await page.waitForTimeout(150);
    const viewed = await page.evaluate(() => [
      document.querySelector('.file[data-path="scripts/collect.py"]').classList.contains('is-viewed'),
      document.querySelector('#toc .tree-file[data-path="scripts/collect.py"]').classList.contains('viewed'),
      document.querySelector('.tree-progress').textContent,
    ]);
    assert.ok(viewed[0], JSON.stringify(viewed));
    assert.ok(viewed[1], JSON.stringify(viewed));
    assert.equal(viewed[2], '1 / 7', JSON.stringify(viewed));
    await page.keyboard.press('Shift+V');
    const toast = await page.textContent('#toast');
    await waitSaved();
    const reviewed = Object.values(fx.state().reviewed || {}).filter(Boolean).length;
    assert.match(toast, /режиме «Гайд»/, `Shift+V: ${toast}`);
    await page.keyboard.press('n');
    const curN = await page.evaluate(() => {
      const r = document.querySelector('tr.ln.cursor');
      return r && r.closest('.file').dataset.path;
    });
    assert.ok(curN, 'N did not place a cursor');
    t.diagnostic(`chapters marked: ${reviewed}; N -> ${curN}`);
  });

  it('builds the tree with directories before files, collapsed single-child chains, natural number order and counters', async (t) => {
    // was T1
    const page = await env.open(await env.server('tree', { mode: 'files' }));
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#toc .tree-row')].map(
        (r) =>
          `${r.getAttribute('aria-level')}:${r.classList.contains('tree-dir') ? r.querySelector('.tree-name').textContent : r.querySelector('.fr-base').textContent}`,
      ),
    );
    const want = [
      '1:docs/guide/',
      '2:intro.md',
      '2:setup.md',
      '1:packages/app/src/main/',
      '2:index.js',
      '1:src/',
      '2:core/',
      '3:util/',
      '4:math.js',
      '4:text.js',
      '3:engine.js',
      '2:ui/',
      '3:button.js',
      '3:panel.js',
      '1:file2.txt',
      '1:file10.txt',
      '1:README.md',
    ];
    assert.deepEqual(rows, want);
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('#main .sec.headless > .file')].map((f) => f.dataset.path.split('/').pop()),
    );
    assert.equal(
      order.join(','),
      'intro.md,setup.md,index.js,math.js,text.js,engine.js,button.js,panel.js,file2.txt,file10.txt,README.md',
      `order in the column: ${order}`,
    );
    t.diagnostic(`${rows.length} rows`);
  });

  it('navigates the tree with arrows, collapses a directory with ←, opens a file with Enter and saves the collapsed state', async () => {
    // was T2
    const fx = await env.server('tree', { mode: 'files' });
    const page = await env.open(fx);
    await page.focus('#tree-filter');
    await page.keyboard.press('ArrowDown');
    const f1 = await page.evaluate(() => document.activeElement.dataset.tkey);
    assert.equal(f1, 'd:docs/guide', `first item: ${f1}`);
    await page.keyboard.press('ArrowLeft');
    const collapsed = await page.evaluate(() => [
      document.activeElement.getAttribute('aria-expanded'),
      document.querySelectorAll('#toc .tree-row').length,
    ]);
    assert.equal(collapsed[0], 'false', JSON.stringify(collapsed));
    assert.equal(collapsed[1], 15, JSON.stringify(collapsed));
    for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowDown'); // packages/..., index.js, src/
    await page.keyboard.press('ArrowRight'); // src/ is expanded: focus moves to its first child
    const at = await page.evaluate(() => document.activeElement.dataset.tkey);
    assert.equal(at, 'd:src/core', `-> on an expanded directory goes inside: ${at}`);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const cur = await page.evaluate(() => {
      const h = document.querySelector('.file-head.is-current');
      return h && h.closest('.file').dataset.path;
    });
    assert.equal(cur, 'README.md', `Enter on the last item: ${cur}`);
    await waitSaved();
    assert.equal(fx.state().treeCollapsed['docs/guide'], true, JSON.stringify(fx.state().treeCollapsed));
  });

  it('filters the tree and the column, moves J/K over visible files, resets the filter and hides viewed files', async (t) => {
    // was T3
    const fx = await env.server('tree');
    const page = await env.open(fx);
    await page.keyboard.press('Slash');
    await page.waitForTimeout(200);
    const st0 = await page.evaluate(() => [
      document.documentElement.classList.contains('mode-files'),
      document.activeElement.id,
    ]);
    assert.ok(st0[0], `/ from "Гайд": ${st0}`);
    assert.equal(st0[1], 'tree-filter', `/ from "Гайд": ${st0}`);
    await page.keyboard.type('src/ui');
    await page.waitForTimeout(150);
    const vis = await page.evaluate(() =>
      [...document.querySelectorAll('#main .sec.headless > .file:not([hidden])')].map((f) => f.dataset.path),
    );
    const tree = await page.evaluate(() =>
      [...document.querySelectorAll('#toc .tree-file')].map((f) => f.dataset.path),
    );
    assert.equal(vis.join(), 'src/ui/button.js,src/ui/panel.js', `${vis} / ${tree}`);
    assert.equal(tree.join(), vis.join(), `${vis} / ${tree}`);
    await page.keyboard.press('Escape'); // clears
    await page.keyboard.press('Escape'); // drops focus
    await page.keyboard.type('ui'); // not in the field: nothing happens
    assert.equal(await page.inputValue('#tree-filter'), '', 'Esc did not clear the filter');
    await page.fill('#tree-filter', 'core');
    await page.waitForTimeout(150);
    await page.evaluate(() => document.activeElement.blur());
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    const cur = await page.evaluate(
      () => document.querySelector('.file-head.is-current').closest('.file').dataset.path,
    );
    assert.equal(cur, 'src/core/engine.js', `J x3 over visible files: ${cur}`);
    await page.click('.filter-status button');
    await page.waitForTimeout(150);
    const all = await page.evaluate(
      () => document.querySelectorAll('#main .sec.headless > .file:not([hidden])').length,
    );
    assert.equal(all, 11, `after "Сбросить фильтр": ${all}`);
    await page.keyboard.press('v');
    await page.check('#tree-hide-viewed');
    await page.waitForTimeout(150);
    const hidden = await page.evaluate(() => [
      document.querySelectorAll('#main .sec.headless > .file[hidden]').length,
      document.querySelector('.filter-status').textContent,
    ]);
    assert.equal(hidden[0], 1, JSON.stringify(hidden));
    assert.match(hidden[1], /10 из 11/, JSON.stringify(hidden));
    await waitSaved();
    assert.equal(fx.state().hideViewed, true, 'hideViewed was not saved');
    t.diagnostic(hidden[1]);
  });

  it('resizes the tree by dragging and with keys, within limits, and saves the width', async (t) => {
    // was T4
    const fx = await env.server('tree', { mode: 'files' });
    let page = await env.open(fx);
    const box = await page.$eval('.tree-resize', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 200 };
    });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y, { steps: 5 });
    await page.mouse.up();
    const w1 = await page.$eval('#toc', (e) => e.getBoundingClientRect().width);
    await page.focus('.tree-resize');
    for (let k = 0; k < 20; k++) await page.keyboard.press('ArrowRight');
    const w2 = await page.$eval('#toc', (e) => e.getBoundingClientRect().width);
    await waitSaved();
    page = await env.open(fx);
    const w3 = await page.$eval('#toc', (e) => e.getBoundingClientRect().width);
    assert.ok(Math.abs(w1 - 380) < 3, `width ${w1} -> ${w2} -> ${w3}`);
    assert.equal(w2, 480, `width ${w1} -> ${w2} -> ${w3}`);
    assert.equal(w3, 480, `width ${w1} -> ${w2} -> ${w3}`);
    t.diagnostic(`${w1} -> ${w2} -> ${w3}`);
  });

  it('collapses and expands all files with Z and Shift+Z, also in "Гайд"', async (t) => {
    // was T5
    const fx = await env.server('tree', { mode: 'files' });
    const page = await env.open(fx);
    await page.keyboard.press('z');
    const c1 = await page.evaluate(() => document.querySelectorAll('#main .file.collapsed').length);
    await page.keyboard.press('Shift+Z');
    const c2 = await page.evaluate(() => document.querySelectorAll('#main .file.collapsed').length);
    await page.keyboard.press('g');
    await page.keyboard.press('z');
    const c3 = await page.evaluate(() => document.querySelectorAll('#main .file.collapsed').length);
    assert.ok(c1 === 11 && c2 === 0 && c3 === 11, `${c1}/${c2}/${c3}`);
    t.diagnostic(`${c1}/${c2}/${c3}`);
  });

  it('opens the file in "Гайд" from its chapter chip in "Файлы", and the help of the mode hides chapter keys', async (t) => {
    // was T6
    const page = await env.open(await env.server('tree', { mode: 'files' }));
    await page.keyboard.press('Shift+Slash');
    const filesHelp = await page.evaluate(() => document.querySelector('dialog#help').textContent);
    await page.keyboard.press('Escape');
    assert.ok(!filesHelp.includes('Отметить главу'), 'the help of "Файлы" shows chapter keys');
    assert.ok(filesHelp.includes('Фильтр файлов'), 'the help of "Файлы" shows chapter keys');
    await toEl(page, F('src/ui/panel.js'), 200);
    await page.click(`${F('src/ui/panel.js')} .sec-chip`);
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => [
      document.documentElement.classList.contains('mode-files'),
      document.querySelector('.file-head.is-current').closest('.file').dataset.path,
      document.querySelector('.file-head.is-current').closest('.sec').dataset.key,
    ]);
    assert.ok(!st[0], JSON.stringify(st));
    assert.equal(st[1], 'src/ui/panel.js', JSON.stringify(st));
    assert.equal(st[2], 's1', JSON.stringify(st));
    t.diagnostic(st.join(' '));
  });

  expectCleanSession(env);
});

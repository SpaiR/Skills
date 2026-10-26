// Diff rendering: signs and selection, word diff, hunk separators, line wrapping, split view,
// escaping of HTML in code, and syntax highlighting.
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { expectCleanSession, fileSel, sleep, useEnv } from './lib.js';

describe('syntax highlighting and diff rendering', () => {
  const env = useEnv();
  let mixed, big;
  before(async () => {
    mixed = await env.server('mixed');
    big = await env.server('big');
  });

  it('shows + and − in the sign column and leaves signs and line numbers out of a mouse selection', async () => { // was 6
    const page = await env.open(mixed);
    const signs = await page.evaluate(() => ({
      add: [...document.querySelectorAll('tr.ln[data-t=add] td.sign')].every((td) => td.textContent === '+'),
      del: [...document.querySelectorAll('tr.ln[data-t=del] td.sign')].every((td) => td.textContent === '−'),
    }));
    assert.ok(signs.add && signs.del, JSON.stringify(signs));
    const rows = page.locator(`${fileSel('scripts/collect.py')} tr.ln`);
    const first = await rows.nth(2).locator('td.code').boundingBox();
    const third = await rows.nth(4).locator('td.code').boundingBox();
    await page.mouse.move(first.x + 2, first.y + 10);
    await page.mouse.down();
    await page.mouse.move(third.x + third.width - 4, third.y + 10, { steps: 8 });
    await page.mouse.up();
    const text = await page.evaluate(() => getSelection().toString());
    const lines = text.split('\n').filter(Boolean);
    assert.ok(lines.length >= 3, `selected lines: ${lines.length}: ${JSON.stringify(text)}`);
    assert.ok(lines.every((l) => !/^[+−-]/.test(l) && !/^\s*\d+\s/.test(l)), JSON.stringify(text));
  });

  it('highlights the changed word in a modified pair and nowhere else, and not at all on the big fixture', async (t) => { // was 7
    const page = await env.open(mixed);
    const r = await page.evaluate(() => {
      const f = document.querySelector('.file[data-path="scripts/validate.py"]');
      const del = f.querySelector('td.num[data-side=old][data-no="16"]').closest('tr');
      const add = f.querySelector('td.num[data-side=new][data-no="16"]').closest('tr');
      const d59 = f.querySelector('td.num[data-side=old][data-no="59"]').closest('tr');
      const a59 = f.querySelector('td.num[data-side=new][data-no="59"]').closest('tr');
      return {
        del16: [...del.querySelectorAll('span.w')].map((s) => s.textContent),
        add16: [...add.querySelectorAll('span.w')].map((s) => s.textContent),
        w59: d59.querySelectorAll('span.w').length + a59.querySelectorAll('span.w').length,
        ctx: document.querySelectorAll('tr.ln[data-t=ctx] span.w').length,
      };
    });
    assert.equal(r.del16.join(), '10', `validate.py line 16 (10 -> 12), deleted side: ${JSON.stringify(r)}`);
    assert.equal(r.add16.join(), '12', `validate.py line 16 (10 -> 12), added side: ${JSON.stringify(r)}`);
    assert.equal(r.ctx, 0, `context rows have span.w: ${JSON.stringify(r)}`);
    await page.close();
    const p2 = await env.open(big);
    const n = await p2.evaluate(() => document.querySelectorAll('span.w').length);
    assert.equal(n, 0, `big span.w = ${n}`);
    t.diagnostic(`pair 59 (pure insertion, similarity 0.42): span.w = ${r.w59}`);
  });

  it('shows hunk separators of collect.py: lines 1–30 hidden, then 12 and 6 unchanged lines', async () => { // was 8
    const page = await env.open(mixed);
    const t = await page.$$eval(`${fileSel('scripts/collect.py')} tr.hunk`, (rows) => rows.map((r) => r.textContent));
    assert.ok(t[0].includes('строки 1–30 не показаны'), JSON.stringify(t));
    assert.ok(t[1].includes('12 строк без изменений'), JSON.stringify(t));
    assert.ok(t[2].includes('6 строк без изменений'), JSON.stringify(t));
  });

  it('renders an added file (big SKILL.md) without old-side line numbers', async () => { // was 9
    const page = await env.open(big);
    const n = await page.$$eval(`${fileSel('SKILL.md')} td.num[data-side=old]`, (x) => x.length);
    const rows = await page.$$eval(`${fileSel('SKILL.md')} tr.ln`, (x) => x.length);
    assert.equal(n, 0, `old-side cells: ${n}`);
    assert.ok(rows > 0, `rows: ${rows}`);
  });

  it('wraps long lines under the code with the same indent, and W switches to 20px rows with horizontal scroll and saves the choice', async () => { // was 10
    const page = await env.open(mixed);
    const sel = `${fileSel('scripts/validate.py')} td.num[data-side=new][data-no="59"]`;
    await page.locator(sel).scrollIntoViewIfNeeded();
    const r = await page.evaluate((sel) => {
      const tr = document.querySelector(sel).closest('tr');
      const code = tr.querySelector('td.code');
      const range = document.createRange();
      range.selectNodeContents(code);
      const rects = [...range.getClientRects()].filter((x) => x.width > 0);
      const lines = [...new Set(rects.map((x) => Math.round(x.top)))];
      const firstLeft = Math.min(...rects.filter((x) => Math.round(x.top) === lines[0]).map((x) => x.left));
      const secondLeft = Math.min(...rects.filter((x) => Math.round(x.top) === lines[1]).map((x) => x.left));
      return { len: code.textContent.length, lines: lines.length, firstLeft, secondLeft, signRight: tr.querySelector('td.sign').getBoundingClientRect().right, h: tr.getBoundingClientRect().height };
    }, sel);
    assert.ok(r.lines >= 2, `visual lines: ${JSON.stringify(r)}`);
    assert.ok(Math.abs(r.firstLeft - r.secondLeft) <= 1, `second line indent: ${JSON.stringify(r)}`);
    assert.ok(r.secondLeft > r.signRight, `second line starts under the sign column: ${JSON.stringify(r)}`);
    await page.keyboard.press('w');
    const r2 = await page.evaluate((sel) => {
      const tr = document.querySelector(sel).closest('tr');
      const wrap = tr.closest('.diff-wrap');
      return { h: tr.getBoundingClientRect().height, sw: wrap.scrollWidth, cw: wrap.clientWidth, nowrap: document.body.classList.contains('nowrap') };
    }, sel);
    assert.equal(r2.h, 20, `row height after W: ${JSON.stringify(r2)}`);
    assert.ok(r2.sw > r2.cw, `no horizontal scroll after W: ${JSON.stringify(r2)}`);
    assert.ok(r2.nowrap, `body has no .nowrap after W: ${JSON.stringify(r2)}`);
    await sleep(500);
    const st = mixed.state();
    assert.equal(st.wrap, false, 'state.wrap was not saved');
    await page.keyboard.press('w');
  });

  it('shows added and deleted files unified and modified files split in side-by-side view, with a hatched filler', async () => { // was 11
    const page = await env.open(mixed);
    await page.click(`${fileSel('assets/viewer.html')} [data-act=show-file]`);
    await page.keyboard.press('s');
    const r = await page.evaluate(() => {
      const cls = (p) => { const t = document.querySelector(`.file[data-path="${p}"] table.diff`); return t && t.className; };
      const filler = document.querySelector('td.filler');
      return {
        added: cls('scripts/test_collect.py'), deleted: cls('assets/viewer.html'), modified: cls('scripts/collect.py'),
        filler: filler && getComputedStyle(filler).backgroundImage,
        split: document.body.classList.contains('view-split'),
      };
    });
    assert.match(r.added, /\bunified\b/, JSON.stringify(r));
    assert.match(r.deleted, /\bunified\b/, JSON.stringify(r));
    assert.match(r.modified, /\bsplit\b/, JSON.stringify(r));
    assert.match(r.filler, /repeating-linear-gradient/, JSON.stringify(r));
    await page.keyboard.press('s');
    await sleep(500);
  });

  it('escapes code: no script, img, iframe or on* attributes in #main, and a deleted <script tag is visible as text', async () => { // was 13
    const page = await env.open(mixed);
    const show = page.locator(`${fileSel('assets/viewer.html')} [data-act=show-file]`);
    if (await show.count()) await show.click();
    const r = await page.evaluate(() => {
      const main = document.getElementById('main');
      const bad = main.querySelectorAll('script, img, iframe').length;
      const onAttr = [...main.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length;
      const text = document.querySelector('.file[data-path="assets/viewer.html"]').textContent;
      return { bad, onAttr, hasScriptText: text.includes('<script src="/assets/viewer.js"></script>') };
    });
    assert.equal(r.bad, 0, JSON.stringify(r));
    assert.equal(r.onAttr, 0, JSON.stringify(r));
    assert.ok(r.hasScriptText, JSON.stringify(r));
  });

  it('highlights keywords and comments in collect.py with palette colours and leaves SKILL.md plain', async (t) => { // was 12 (first of two)
    const page = await env.open(await env.server('big'));
    const r = await page.evaluate(() => {
      const f = document.querySelector('.file[data-path="scripts/collect.py"]');
      const kw = [...f.querySelectorAll('span.t-kw')].map((s) => s.textContent);
      const com = [...f.querySelectorAll('span.t-com')].map((s) => s.textContent);
      const skill = document.querySelector('.file[data-path="SKILL.md"]');
      return {
        def: kw.includes('def'), import: kw.includes('import'), com: com.filter((c) => c.startsWith('#')).length,
        skill: skill.querySelectorAll('span.t-kw, span.t-str, span.t-num, span.t-com').length, skillRows: skill.querySelectorAll('tr.ln').length,
        kinds: Object.fromEntries(['t-kw', 't-str', 't-num', 't-com'].map((c) => [c, document.querySelectorAll(`#main span.${c}`).length])),
      };
    });
    assert.ok(r.def, `no t-kw "def": ${JSON.stringify(r)}`);
    assert.ok(r.import, `no t-kw "import": ${JSON.stringify(r)}`);
    assert.ok(r.com > 0, `no t-com starting with "#": ${JSON.stringify(r)}`);
    assert.equal(r.skill, 0, `SKILL.md has t-* spans: ${JSON.stringify(r)}`);
    assert.ok(r.skillRows > 0, `SKILL.md has no rows: ${JSON.stringify(r)}`);
    // Token colours come from the --syn-* palette; the cell itself keeps --ink.
    const colors = await page.evaluate(() => {
      const probe = (v) => { const d = document.createElement('div'); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
      const f = document.querySelector('.file[data-path="scripts/collect.py"]');
      return {
        kw: getComputedStyle(f.querySelector('span.t-kw')).color === probe('--syn-kw'),
        com: getComputedStyle(f.querySelector('span.t-com')).color === probe('--syn-com'),
        cell: getComputedStyle(f.querySelector('td.code')).color === probe('--ink'),
      };
    });
    assert.ok(colors.kw, JSON.stringify(colors));
    assert.ok(colors.com, JSON.stringify(colors));
    assert.ok(colors.cell, JSON.stringify(colors));
    t.diagnostic(`comments with "#": ${r.com}; spans on the page ${JSON.stringify(r.kinds)}`);
  });

  it('combines a syntax token with a word highlight (validate.py line 16: "12" is both t-num and w)', async () => { // was 12 (second of two)
    const page = await env.open(await env.server('mixed'));
    const r = await page.evaluate(() => {
      const tr = document.querySelector('.file[data-path="scripts/validate.py"] td.num[data-side=new][data-no="16"]').closest('tr');
      return [...tr.querySelectorAll('td.code span')].map((s) => `${s.className}:${s.textContent}`);
    });
    assert.ok(r.includes('w t-num:12'), JSON.stringify(r));
  });

  expectCleanSession(env);
});

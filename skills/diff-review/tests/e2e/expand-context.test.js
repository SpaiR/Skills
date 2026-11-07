// Expanding context around hunks, the "whole file" toggle, comments on expanded lines and large files.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expectCleanSession, fileSel, MOD, numSel, sleep, useEnv } from './lib.js';

const F = fileSel;
const COLLECT = F('scripts/collect.py');
const num = (side, no) => numSel(COLLECT, side, no);

describe('expanding context', () => {
  const env = useEnv();

  const toEl = (page, sel, dy = 300) =>
    page.evaluate(
      ([s, d]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - d),
      [sel, dy],
    );
  const rowTop = (page, anchor) =>
    page.evaluate((a) => {
      const el = document.querySelector(`[data-anchor="${a}"]`);
      return el ? el.getBoundingClientRect().top : null;
    }, anchor);
  const gapTexts = (page, file) =>
    page.evaluate(
      (f) => [...document.querySelectorAll(`${f} tr.gap`)].map((r) => r.querySelector('.hunk-skip').textContent),
      file,
    );
  const lnCount = (page, file) => page.evaluate((f) => document.querySelectorAll(`${f} tr.ln`).length, file);
  // Clicks a gap button: the k-th separator of the file, direction dir. The separator is centred on screen before the click.
  // Returns the anchor row next to the gap with its top before and after, to prove that the row did not move.
  const clickGap = async (page, file, k, dir) => {
    const anchor = await page.evaluate(
      ([f, k, dir]) => {
        const gap = document.querySelectorAll(`${f} tr.gap`)[k];
        window.scrollTo(0, gap.getBoundingClientRect().top + scrollY - 450);
        let tr = gap;
        const step = dir === 'up' ? 'nextElementSibling' : 'previousElementSibling';
        do tr = tr[step];
        while (tr && !tr.matches('tr.ln'));
        return tr ? tr.dataset.anchor : null;
      },
      [file, k, dir],
    );
    const before = await rowTop(page, anchor);
    await page.click(`${file} tr.gap >> nth=${k} >> .gap-btn[data-dir="${dir}"]`);
    await page.waitForTimeout(250);
    return { anchor, before, after: await rowTop(page, anchor) };
  };
  const waitSaved = () => sleep(700);

  it('expands the right lines with ↑, ↓ and "Показать N", keeps the neighbouring row in place and merges hunks', async (t) => {
    // was E1
    const page = await env.open(await env.server('mixed2'));
    const g0 = await gapTexts(page, COLLECT);
    assert.equal(g0.length, 4, JSON.stringify(g0));
    assert.ok(g0[0].includes('30 строк'), JSON.stringify(g0));
    assert.ok(g0[3].includes('257 строк до конца'), JSON.stringify(g0));
    const up = await clickGap(page, COLLECT, 0, 'up');
    assert.ok(Math.abs(up.after - up.before) < 1, `↑ moved the row: ${JSON.stringify(up)}`);
    assert.ok(await page.$(num('new', 11)), '↑ did not reveal lines 11-30');
    assert.ok(!(await page.$(num('new', 10))), '↑ did not reveal lines 11-30');
    const down = await clickGap(page, COLLECT, 3, 'down');
    assert.ok(Math.abs(down.after - down.before) < 1, `↓ moved the row: ${JSON.stringify(down)}`);
    assert.ok(await page.$(num('new', 94)), '↓ did not reveal lines 75-94');
    assert.ok(!(await page.$(num('new', 95))), '↓ did not reveal lines 75-94');
    const hunks0 = await page.evaluate((f) => document.querySelectorAll(`${f} tr.hunk`).length, COLLECT);
    const all = await clickGap(page, COLLECT, 2, 'all');
    assert.ok(Math.abs(all.after - all.before) < 1, `"Показать" moved the row: ${JSON.stringify(all)}`);
    const hunks1 = await page.evaluate((f) => document.querySelectorAll(`${f} tr.hunk`).length, COLLECT);
    assert.equal(hunks1, hunks0 - 1, `separators ${hunks0} -> ${hunks1}, expected a merge`);
    const g1 = await gapTexts(page, COLLECT);
    t.diagnostic(`separators: ${g0.length} -> ${g1.length}: ${g1.join(' | ')}`);
  });

  it('keeps the N/P cursor and the form selection when lines are expanded above them', async (t) => {
    // was E2
    const page = await env.open(await env.server('mixed2'));
    await toEl(page, COLLECT, 120);
    await page.keyboard.press('n');
    await page.keyboard.press('n');
    const cur0 = await page.evaluate(
      (f) =>
        [...document.querySelectorAll(`${f} tr.ln.cursor td.num[data-no]`)]
          .map((n) => `${n.dataset.side}${n.dataset.no}`)
          .join(','),
      COLLECT,
    );
    assert.ok(cur0, 'the cursor did not land in collect.py');
    await clickGap(page, COLLECT, 0, 'up');
    const cur1 = await page.evaluate(
      (f) =>
        [...document.querySelectorAll(`${f} tr.ln.cursor td.num[data-no]`)]
          .map((n) => `${n.dataset.side}${n.dataset.no}`)
          .join(','),
      COLLECT,
    );
    assert.equal(cur0, cur1, `cursor: ${cur0} -> ${cur1}`);
    await toEl(page, num('new', 56));
    await page.click(num('new', 56));
    await page.keyboard.type('про строку');
    await page.click(num('new', 58), { modifiers: ['Shift'] });
    await clickGap(page, COLLECT, 0, 'all'); // after the first ↑ 10 lines remain: a single button
    const st = await page.evaluate(
      (f) => ({
        sel: [...document.querySelectorAll(`${f} td.num.sel[data-side=new]`)].map((n) => +n.dataset.no),
        text: (document.querySelector('.annot-form textarea') || {}).value,
        title: (document.querySelector('.annot-form .editor-title') || {}).textContent,
      }),
      COLLECT,
    );
    assert.equal(st.sel.join(','), '56,57,58', JSON.stringify(st));
    assert.equal(st.text, 'про строку', JSON.stringify(st));
    assert.match(st.title, /56–58/, JSON.stringify(st));
    await page.click(num('new', 59), { modifiers: ['Shift'] });
    const t2 = await page.evaluate(() => document.querySelector('.annot-form .editor-title').textContent);
    assert.match(t2, /56–59/, `Shift+click after expanding: ${t2}`);
    t.diagnostic(`cursor ${cur1}; form ${t2}`);
  });

  it('shows every line with "Весь файл" and E, returns to the original plus manual expansions, and offers no button for an added file', async (t) => {
    // was E3
    const fx = await env.server('mixed2');
    const page = await env.open(fx);
    const base = await lnCount(page, COLLECT);
    await clickGap(page, COLLECT, 1, 'all');
    const partial = await lnCount(page, COLLECT);
    await page.click(`${COLLECT} .whole-btn`);
    await page.waitForTimeout(200);
    const whole = await lnCount(page, COLLECT);
    const pressed = await page.$eval(`${COLLECT} .whole-btn`, (b) => b.getAttribute('aria-pressed'));
    assert.equal(whole, 336, `whole file: ${whole} lines, aria-pressed=${pressed}`);
    assert.equal(pressed, 'true', `whole file: ${whole} lines, aria-pressed=${pressed}`);
    await toEl(page, num('new', 200), 200);
    await page.mouse.move(5, 500);
    await page.keyboard.press('e');
    await page.waitForTimeout(200);
    const back = await lnCount(page, COLLECT);
    assert.equal(back, partial, `after E: ${back}, expected ${partial} (original ${base} + manually expanded)`);
    assert.ok(!(await page.$(`${F('scripts/test_collect.py')} .whole-btn`)), 'the added file has a "Весь файл" button');
    await waitSaved();
    const ex = fx.state().expanded['scripts/collect.py'];
    assert.ok(ex, JSON.stringify(ex));
    assert.equal(ex.full, false, JSON.stringify(ex));
    assert.equal(ex.ranges.length, 1, JSON.stringify(ex));
    t.diagnostic(`${base} -> ${partial} -> ${whole} -> ${back}`);
  });

  it('quotes a comment on an expanded line in the feedback and keeps it after switching "Весь файл" off and reloading', async (t) => {
    // was E4
    const fx = await env.server('mixed2');
    let page = await env.open(fx);
    await page.click(`${COLLECT} .whole-btn`);
    await page.waitForTimeout(200);
    await toEl(page, num('new', 150));
    await page.click(num('new', 150));
    await page.keyboard.type('строка вне патча');
    await page.click(num('new', 152), { modifiers: ['Shift'] });
    await page.keyboard.press(`${MOD}+Enter`);
    await page.waitForTimeout(150);
    await page.click(`${COLLECT} .whole-btn`);
    await page.waitForTimeout(200);
    const visible = await page.evaluate(
      (f) => [150, 151, 152, 153].map((n) => !!document.querySelector(`${f} td.num[data-side=new][data-no="${n}"]`)),
      COLLECT,
    );
    assert.equal(visible.join(), 'true,true,true,false', `after switching "Весь файл" off: ${visible}`);
    assert.ok(await page.$(`${COLLECT} .note`), 'no comment card');
    await waitSaved();
    page = await env.open(fx);
    assert.ok(await page.$(`${COLLECT} .note`), 'no comment card after reload');
    const md = await page.evaluate(() => {
      document.getElementById('submit-btn').click();
      return document.querySelector('dialog#submit .preview').textContent;
    });
    const line = (
      await page.evaluate(() =>
        fetch(`/api/full?i=4`, { headers: { 'X-Review-Token': new URLSearchParams(location.search).get('t') } }).then(
          (r) => r.text(),
        ),
      )
    )
      .split(/\n@@ [^\n]*\n/)[1]
      .split('\n')
      .filter((l) => /^[ +]/.test(l))[149]
      .slice(1);
    assert.ok(
      md.includes('строки 150–152'),
      `the feedback lacks the quote of line 150 "${line}":\n${md.slice(0, 600)}`,
    );
    assert.ok(md.includes(` ${line}`), `the feedback lacks the quote of line 150 "${line}":\n${md.slice(0, 600)}`);
    t.diagnostic('quote present');
  });

  it('expands a 10 000-line file with "Весь файл" in under 1 s and does not collapse it as big after reload', async (t) => {
    // was E5
    const fx = await env.server('large');
    let page = await env.open(fx);
    const BIG = F('src/big.js');
    const ms = await page.evaluate(async (f) => {
      const t0 = performance.now();
      document.querySelector(`${f} .whole-btn`).click();
      while (document.querySelectorAll(`${f} tr.ln`).length < 10000) await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    }, BIG);
    assert.ok(ms < 1000, `"Весь файл" took ${ms.toFixed(0)} ms`);
    await waitSaved();
    page = await env.open(fx);
    const st = await page.evaluate(
      (f) => [
        document.querySelector(f).classList.contains('collapsed'),
        document.querySelectorAll(`${f} tr.ln`).length,
      ],
      BIG,
    );
    assert.ok(!st[0], JSON.stringify(st));
    assert.ok(st[1] > 10000, JSON.stringify(st));
    t.diagnostic(`${ms.toFixed(0)} ms, ${st[1]} lines`);
  });

  it('shows no expand buttons for an old review without full.patch, disables "Весь файл" with a reason, and answers E with a hint', async (t) => {
    // was E6
    const page = await env.open(await env.server('mixed'));
    const st = await page.evaluate(
      (f) => ({
        gaps: document.querySelectorAll('tr.gap').length,
        btn: document.querySelector(`${f} .whole-btn`).disabled,
        title: document.querySelector(`${f} .whole-btn`).title,
      }),
      COLLECT,
    );
    assert.equal(st.gaps, 0, JSON.stringify(st));
    assert.ok(st.btn, JSON.stringify(st));
    assert.match(st.title, /старой версией/, JSON.stringify(st));
    await toEl(page, COLLECT, 120);
    await page.keyboard.press('j');
    await page.keyboard.press('e');
    const toast = await page.textContent('#toast');
    assert.match(toast, /старой версией|Полный текст/, `toast: ${toast}`);
    t.diagnostic(st.title);
  });

  expectCleanSession(env);
});

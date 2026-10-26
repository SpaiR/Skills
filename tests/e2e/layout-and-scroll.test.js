// Page layout at several widths, the table of contents overlay, sticky headers and scroll anchoring.
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { expectCleanSession, sleep, useEnv } from './lib.js';

describe('layout and scrolling', () => {
  const env = useEnv();
  let mixed, big;
  before(async () => {
    mixed = await env.server('mixed');
    big = await env.server('big');
  });

  it('keeps #top 52px tall and the page free of horizontal scroll at 1024, 1440 and 1920 px', async () => { // was 14
    for (const fx of [mixed, big]) {
      for (const width of [1024, 1440, 1920]) {
        const page = await env.open(fx, { viewport: { width, height: 900 } });
        const r = await page.evaluate(() => ({ h: document.getElementById('top').getBoundingClientRect().height, sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }));
        assert.equal(r.h, 52, `${width}: ${JSON.stringify(r)}`);
        assert.equal(r.sw, r.cw, `${width}: ${JSON.stringify(r)}`);
        await page.close();
      }
    }
  });

  it('hides the table of contents at 1024 px, opens it over the content with T and closes it with Esc', async () => { // was 15
    const page = await env.open(mixed, { viewport: { width: 1024, height: 800 } });
    const tr = () => page.evaluate(() => { const t = document.getElementById('toc'); const r = t.getBoundingClientRect(); return { tf: getComputedStyle(t).transform, right: r.right, vis: getComputedStyle(t).visibility }; });
    const a = await tr();
    assert.equal(a.tf, 'matrix(1, 0, 0, 1, -300, 0)', `closed: ${JSON.stringify(a)}`);
    assert.ok(a.right <= 0, `closed: ${JSON.stringify(a)}`);
    await page.keyboard.press('t');
    await sleep(50);
    const b = await tr();
    assert.equal(b.tf, 'matrix(1, 0, 0, 1, 0, 0)', `after T: ${JSON.stringify(b)}`);
    assert.equal(b.vis, 'visible', `after T: ${JSON.stringify(b)}`);
    const top = await page.evaluate(() => { const r = document.getElementById('toc').getBoundingClientRect(); const el = document.elementFromPoint(r.left + 100, r.top + 100); return el.closest('#toc') !== null; });
    assert.ok(top, 'the table of contents is not above the content');
    await page.keyboard.press('Escape');
    await sleep(50);
    const c = await tr();
    assert.equal(c.tf, 'matrix(1, 0, 0, 1, -300, 0)', `after Esc: ${JSON.stringify(c)}`);
  });

  it('puts the chapter aside next to the files at 1440, below them at 1024 and in side-by-side view at 1440', async (t) => { // was 16
    const geo = (page) => page.evaluate(() => {
      const sec = document.querySelector('.sec[data-key=s1]');
      const a = sec.querySelector('.sec-aside').getBoundingClientRect(), f = sec.querySelector('.sec-files').getBoundingClientRect();
      return { aRight: a.right, fLeft: f.left, aBottom: a.bottom, fTop: f.top, pos: getComputedStyle(sec.querySelector('.aside-in')).position, mainW: document.getElementById('main').clientWidth };
    });
    let page = await env.open(big);
    const g1 = await geo(page);
    assert.ok(g1.aRight <= g1.fLeft, `1440: ${JSON.stringify(g1)}`);
    assert.equal(g1.pos, 'sticky', `1440: ${JSON.stringify(g1)}`);
    await page.keyboard.press('s');
    const g3 = await geo(page);
    assert.ok(g3.aBottom <= g3.fTop, `1440 split: ${JSON.stringify(g3)}`);
    await page.keyboard.press('s');
    await sleep(500);
    await page.close();
    page = await env.open(big, { viewport: { width: 1024, height: 800 } });
    const g2 = await geo(page);
    assert.ok(g2.aBottom <= g2.fTop, `1024: ${JSON.stringify(g2)}`);
    await page.close();
    page = await env.open(big, { viewport: { width: 1920, height: 1080 } });
    await page.keyboard.press('s');
    const g4 = await geo(page);
    assert.ok(g4.aRight <= g4.fLeft, `1920 split: ${JSON.stringify(g4)}`);
    await page.keyboard.press('s');
    await sleep(500);
    t.diagnostic(`#main at 1440 = ${g1.mainW}px`);
  });

  it('pins the chapter header at 52, the file header at 100 and marks the current file in the table of contents', async () => { // was 17
    const page = await env.open(big);
    await page.evaluate(() => {
      const f = document.querySelector('.file[data-path="assets/viewer.js"]');
      window.scrollTo(0, f.getBoundingClientRect().top + window.scrollY + 3000);
    });
    await sleep(300);
    const r = await page.evaluate(() => {
      const sec = document.querySelector('.sec[data-key=s5]');
      const f = sec.querySelector('.file[data-path="assets/viewer.js"]');
      return {
        sec: sec.querySelector('.sec-head').getBoundingClientRect().top,
        file: f.querySelector('.file-head').getBoundingClientRect().top,
        tocSec: document.querySelector('#toc .toc-group[data-key=s5] .toc-sec').getAttribute('aria-current'),
        tocFile: document.querySelector('#toc .file-row[data-path="assets/viewer.js"]').getAttribute('aria-current'),
        currents: document.querySelectorAll('#toc [aria-current]').length,
        headCur: f.querySelector('.file-head').classList.contains('is-current'),
      };
    });
    assert.equal(r.sec, 52, JSON.stringify(r));
    assert.equal(r.file, 100, JSON.stringify(r));
    assert.equal(r.tocSec, 'true', JSON.stringify(r));
    assert.equal(r.tocFile, 'true', JSON.stringify(r));
    assert.equal(r.currents, 2, JSON.stringify(r));
    assert.ok(r.headCur, JSON.stringify(r));
  });

  it('scrolls a file clicked in the table of contents to 100±1 px at 1024, 1440 and 1920 px', async (t) => { // was 18
    const out = [];
    for (const width of [1024, 1440, 1920]) {
      for (const reducedMotion of ['reduce', 'no-preference']) {
        const page = await env.open(big, { viewport: { width, height: 900 }, reducedMotion });
        for (const p of ['scripts/serve.py', 'assets/viewer.css', 'scripts/collect.py']) {
          if (width === 1024) { await page.keyboard.press('t'); await sleep(250); }
          await page.click(`#toc .file-row[data-path="${p}"]`);
          await sleep(reducedMotion === 'reduce' ? 200 : 1500);
          const top = await page.evaluate((p) => document.querySelector(`.file[data-path="${p}"] .file-head`).getBoundingClientRect().top, p);
          out.push(`${width}/${reducedMotion[0]}/${p.split('/').pop()}=${top}`);
          assert.ok(Math.abs(top - 100) <= 1, out.join(' '));
        }
        await page.close();
      }
    }
    t.diagnostic(out.join(' '));
  });

  it('does not shift chapter 2 by more than 2px when chapter 1 is marked or a file above the window is collapsed', async (t) => { // was 19
    const fx = await env.server('mixed');
    const page = await env.open(fx);
    const y0 = 300;
    await page.evaluate((y) => { const s = document.querySelector('.sec[data-key=s2]'); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - y); }, y0);
    await sleep(100);
    const top = () => page.evaluate(() => document.querySelector('.sec[data-key=s2] .sec-head').getBoundingClientRect().top);
    const before = await top();
    await page.click('#toc .toc-group[data-key=s1] .toc-status');
    await sleep(100);
    const after = await top();
    assert.ok(Math.abs(after - before) <= 2, `marking the chapter: ${before} -> ${after}`);
    // Unmark chapter 1 and put chapter 2 at Y = 120 again, then collapse a chapter 1 file that is entirely above the window
    // (its header is not pinned on screen).
    await page.click('#toc .toc-group[data-key=s1] .toc-status');
    await page.evaluate(() => { const s = document.querySelector('.sec[data-key=s2]'); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 120); });
    await sleep(100);
    const t2 = await top();
    await page.evaluate(() => document.querySelector('.sec[data-key=s1] .file[data-path="scripts/collect.py"] .file-toggle').click());
    await sleep(100);
    const t3 = await top();
    assert.ok(Math.abs(t3 - t2) <= 2, `collapsing a file: ${t2} -> ${t3}`);
    await sleep(600);
    t.diagnostic(`${before} -> ${after} -> ${t2} -> ${t3}`);
  });

  expectCleanSession(env);
});

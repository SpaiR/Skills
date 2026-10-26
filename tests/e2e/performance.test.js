// Timing budgets on the big fixture. These checks compare milliseconds, so under heavy CPU load
// they can flake: rerun this file alone (node --test tests/e2e/performance.test.js) before concluding.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { expectCleanSession, fileSel, sleep, useEnv } from './lib.js';

describe('performance on the big fixture', () => {
  const env = useEnv();
  let big;
  before(async () => {
    big = await env.server('big');
  });

  it('is ready within 300 ms of the data, marks a file viewed within 50 ms and keeps the chapter 3 node', async (t) => {
    // was 48
    const runs = [];
    for (let k = 0; k < 3; k++) {
      const fx = await env.server('big');
      const page = await env.open(fx);
      const ready = await page.evaluate(() => {
        const res = performance.getEntriesByType('resource').find((e) => e.name.includes('/api/review'));
        return performance.getEntriesByName('dr-ready')[0].startTime - res.responseEnd;
      });
      await page.evaluate(() => {
        document.querySelector('.sec[data-key=s3]').__probe = 1;
      });
      const dt = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const box = document.querySelector('.file[data-path="SKILL.md"] input[data-act=file-viewed]');
            const t0 = performance.now();
            box.click();
            requestAnimationFrame(() => resolve(performance.now() - t0));
          }),
      );
      const probe = await page.evaluate(() => document.querySelector('.sec[data-key=s3]').__probe === 1);
      runs.push({ ready: Math.round(ready), viewed: Math.round(dt), probe });
      await sleep(600);
      await page.close();
    }
    assert.ok(
      runs.every((r) => r.ready <= 300),
      JSON.stringify(runs),
    );
    assert.ok(
      runs.every((r) => r.viewed <= 50),
      JSON.stringify(runs),
    );
    assert.ok(
      runs.every((r) => r.probe),
      JSON.stringify(runs),
    );
    t.diagnostic(JSON.stringify(runs));
  });

  it('switches the view and wrapping within 150 ms (until the next frame)', async (t) => {
    // was 4.12 in stage 1-6
    const fx = await env.server('big');
    const page = await env.open(fx, { viewport: { width: 1920, height: 1080 } });
    const ms = [];
    for (const key of ['s', 's', 'w', 'w']) {
      ms.push(
        Math.round(
          await page.evaluate(
            (key) =>
              new Promise((resolve) => {
                const t0 = performance.now();
                document.dispatchEvent(
                  new KeyboardEvent('keydown', { code: key === 's' ? 'KeyS' : 'KeyW', key, bubbles: true }),
                );
                requestAnimationFrame(() => resolve(performance.now() - t0));
              }),
            key,
          ),
        ),
      );
    }
    await sleep(600);
    await page.close();
    assert.ok(
      ms.every((x) => x <= 150),
      JSON.stringify(ms),
    );
    t.diagnostic(`S, S, W, W: ${ms.join(', ')} ms`);
  });

  it('opens the comment form within 50 ms (until the next frame)', async (t) => {
    // was 4.12 in stage 7-10
    const page = await env.open(big);
    await page.evaluate(
      ([s, d]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - d),
      [fileSel('assets/viewer.js'), 100],
    );
    const ms = await page.evaluate(
      () =>
        new Promise((res) => {
          const td = document.querySelector('.file[data-path="assets/viewer.js"] td.num[data-side=new][data-no="20"]');
          const t0 = performance.now();
          td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
          document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
          requestAnimationFrame(() => res(Math.round(performance.now() - t0)));
        }),
    );
    const ok = await page.evaluate(() => !!document.querySelector('.file[data-path="assets/viewer.js"] .annot-form'));
    assert.ok(ok, `form opened: ${ok}`);
    assert.ok(ms <= 50, `${ms} ms`);
    await page.keyboard.press('Escape');
    t.diagnostic(`${ms} ms`);
  });

  expectCleanSession(env);
});

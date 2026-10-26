// Marking files and chapters as viewed, the progress counter and the "everything viewed" state.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { expectCleanSession, fileSel, sleep, useEnv } from './lib.js';

describe('viewed state and progress', () => {
  const env = useEnv();

  const current = (page) =>
    page.evaluate(() => {
      const f = document.querySelector('#toc .file-row[aria-current="true"]');
      const s = document.querySelector('#toc .toc-sec[aria-current="true"]');
      return { file: f && f.dataset.path, sec: s && s.closest('.toc-group').dataset.key };
    });

  it('marks the current file with V: hash in state, "Просмотрен" note, counter +1, table of contents row at opacity .6', async (t) => {
    // was 33
    const fx = await env.server('mixed');
    const page = await env.open(fx);
    await page.keyboard.press('j');
    await sleep(300);
    const cur = await current(page);
    const before = await page.$eval('.progress-num', (e) => e.textContent);
    await page.keyboard.press('v');
    await sleep(600);
    const st = fx.state();
    const hash = st.filesViewed[cur.file];
    const r = await page.evaluate(
      (p) => ({
        note: document.querySelector(`.file[data-path="${p}"] .collapsed-note`)?.textContent,
        progress: document.querySelector('.progress-num').textContent,
        opacity: getComputedStyle(document.querySelector(`#toc .file-row[data-path="${p}"]`)).opacity,
      }),
      cur.file,
    );
    assert.match(hash || '', /^[0-9a-f]{8}$/, `hash: ${hash}`);
    assert.ok(r.note, JSON.stringify(r));
    assert.ok(r.note.startsWith('Просмотрен'), JSON.stringify(r));
    assert.equal(+before.split('/')[0] + 1, +r.progress.split('/')[0], `${before} -> ${r.progress}`);
    assert.equal(r.opacity, '0.6');
    const after = await current(page);
    assert.equal(after.file, cur.file, `the current file jumped: ${cur.file} -> ${after.file}`);
    t.diagnostic(`${cur.file}: ${hash}; ${before} -> ${r.progress}`);
  });

  it('marks chapter 2 as reviewed, collapses it and fills its status when both files are viewed; unmarking one file clears reviewed.s2', async (t) => {
    // was 34
    const fx = await env.server('mixed');
    const page = await env.open(fx);
    for (const p of ['scripts/validate.py', 'scripts/test_collect.py'])
      await page.click(`.sec[data-key=s2] ${fileSel(p)} input[data-act=file-viewed]`);
    await sleep(600);
    const r = await page.evaluate(() => ({
      collapsed: document.querySelector('.sec[data-key=s2]').classList.contains('collapsed'),
      status: document.querySelector('#toc .toc-group[data-key=s2] .toc-status').className,
    }));
    assert.equal(fx.state().reviewed.s2, true, JSON.stringify([fx.state().reviewed, r]));
    assert.ok(r.collapsed, JSON.stringify([fx.state().reviewed, r]));
    assert.ok(r.status.includes('full'), JSON.stringify([fx.state().reviewed, r]));
    await page.click('.sec[data-key=s2] .sec-toggle');
    await page.click(`.sec[data-key=s2] ${fileSel('scripts/validate.py')} input[data-act=file-viewed]`);
    await sleep(600);
    const st = fx.state();
    const half = await page.$eval('#toc .toc-group[data-key=s2] .toc-status', (e) => e.className);
    assert.equal(st.reviewed.s2, false, JSON.stringify([st.reviewed, half]));
    assert.ok(half.includes('half'), JSON.stringify([st.reviewed, half]));
    t.diagnostic(`status: ${r.status} -> ${half}`);
  });

  it('treats chapter 1 as viewed in old state without filesViewed but with reviewed.s1 = true', async (t) => {
    // was 35
    const fx = await env.server('mixed', { version: 1, reviewed: { s1: true } });
    const page = await env.open(fx);
    const r = await page.evaluate(() => ({
      count: document.querySelector('#toc .toc-group[data-key=s1] .toc-count').textContent,
      progress: document.querySelector('.progress-num').textContent,
      status: document.querySelector('#toc .toc-group[data-key=s1] .toc-status').className,
    }));
    assert.equal(r.count, '1/1', JSON.stringify(r));
    assert.ok(r.progress.startsWith('1 /'), JSON.stringify(r));
    assert.ok(r.status.includes('full'), JSON.stringify(r));
    t.diagnostic(JSON.stringify(r));
  });

  it('shows progress without a border at 0 and in --success with "Всё просмотрено" at 100%', async (t) => {
    // was 36
    const fx = await env.server('mixed');
    const page = await env.open(fx);
    const p0 = await page.evaluate(() => {
      const p = document.getElementById('progress');
      const cs = getComputedStyle(p);
      return { border: cs.borderTopWidth, bg: cs.backgroundColor, text: p.innerText };
    });
    assert.equal(p0.border, '0px', JSON.stringify(p0));
    assert.equal(p0.bg, 'rgba(0, 0, 0, 0)', JSON.stringify(p0));
    for (const key of ['s1', 's2', 's3', 'rest']) await page.click(`#toc .toc-group[data-key=${key}] .toc-status`);
    await sleep(100);
    const p1 = await page.evaluate(() => {
      const p = document.getElementById('progress');
      const probe = document.createElement('div');
      probe.style.color = 'var(--success)';
      document.body.append(probe);
      const success = getComputedStyle(probe).color;
      probe.remove();
      return {
        text: p.innerText.replace(/\s+/g, ' ').trim(),
        fill: getComputedStyle(p.querySelector('.progress-fill')).backgroundColor,
        success,
        title: p.title,
      };
    });
    assert.equal(p1.text, 'Всё просмотрено', JSON.stringify(p1));
    assert.equal(p1.fill, p1.success, JSON.stringify(p1));
    await page.screenshot({
      path: path.join(os.tmpdir(), 'dr-progress-100.png'),
      clip: { x: 700, y: 0, width: 740, height: 52 },
    });
    await sleep(600);
    t.diagnostic(`${p0.text.replace(/\s+/g, ' ')} -> ${p1.text}; ${p1.title}`);
  });

  expectCleanSession(env);
});

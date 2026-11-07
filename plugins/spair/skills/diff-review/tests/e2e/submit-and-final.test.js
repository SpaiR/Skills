// Submitting feedback: the dialog, warnings, error handling, the exact feedback.md and the final screens.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { expectCleanSession, MOD, ROOT, sleep, useEnv } from './lib.js';

// Golden feedback.md: produced by the v1 buildMarkdown on the same fixture and state.
const GOLDEN = path.join(ROOT, 'tests/fixtures/mixed/feedback.golden.md');

describe('submit and final screens', () => {
  const env = useEnv();
  let shared;
  before(async () => {
    shared = await env.server('mixed');
  });

  it('opens the submit dialog as :modal, keeps 15 Tab presses inside it, and Esc closes it and returns focus to the button', async () => {
    const page = await env.open(shared);
    await page.click('#submit-btn');
    const modal = await page.evaluate(() => document.querySelector('dialog#submit').matches(':modal'));
    const inside = [];
    for (let k = 0; k < 15; k++) {
      await page.keyboard.press('Tab');
      inside.push(await page.evaluate(() => !!document.activeElement.closest('dialog#submit')));
    }
    await page.keyboard.press('Escape');
    const r = await page.evaluate(() => ({
      open: document.querySelector('dialog#submit').open,
      focus: document.activeElement.id,
    }));
    const detail = JSON.stringify({ modal, inside, r });
    assert.ok(modal, detail);
    assert.ok(inside.every(Boolean), detail);
    assert.ok(!r.open, detail);
    assert.equal(r.focus, 'submit-btn', detail);
  });

  it('warns on "Одобрить" with 1 of 4 chapters viewed and lists the unviewed files', async (t) => {
    const fx = await env.server('mixed');
    const page = await env.open(fx);
    await page.click('#toc .toc-group[data-key=s1] .toc-status');
    await page.click('#approve-btn');
    const r = await page.evaluate(() => {
      const w = document.querySelector('dialog#submit .dlg-warn');
      return (
        w && {
          head: w.querySelector('.warn-head')?.textContent,
          paths: [...w.querySelectorAll('.dlg-paths li')].map((li) => li.textContent),
          more: w.querySelector('.dlg-more')?.textContent,
        }
      );
    });
    assert.ok(r, 'no warning in the dialog');
    assert.equal(r.head, 'Не все файлы просмотрены', JSON.stringify(r));
    assert.equal(r.paths.length, 5, JSON.stringify(r));
    assert.equal(r.more, 'и ещё 1', JSON.stringify(r));
    assert.ok(!r.paths.includes('scripts/collect.py'), JSON.stringify(r));
    t.diagnostic(JSON.stringify(r));
  });

  it('shows "Есть неотправленные черновики: 1" in the dialog and "Перейти" leads to the draft', async (t) => {
    const fx = await env.server('mixed', {
      version: 1,
      drafts: {
        'scripts/validate.py|new|16|16': {
          file: 'scripts/validate.py',
          side: 'new',
          start: 16,
          end: 16,
          text: 'черновик',
          suggestion: '',
        },
      },
    });
    const page = await env.open(fx);
    await page.click('#submit-btn');
    const text = await page.$eval('dialog#submit .dlg-drafts', (e) => e.textContent);
    assert.ok(text.includes('Есть неотправленные черновики: 1'), text);
    await page.click('dialog#submit .dlg-drafts .btn');
    await sleep(400);
    const r = await page.evaluate(() => {
      const d = document.querySelector('.draft-row[data-key="scripts/validate.py|new|16|16"]').getBoundingClientRect();
      return { open: document.querySelector('dialog#submit').open, top: d.top, vh: innerHeight };
    });
    assert.ok(!r.open, JSON.stringify(r));
    assert.ok(r.top > 100, JSON.stringify(r));
    assert.ok(r.top < r.vh, JSON.stringify(r));
    t.diagnostic(text);
  });

  it('closes the dialog and scrolls to the .note when a comment in the list is clicked', async (t) => {
    const notes = [
      { id: 'n1', file: 'scripts/collect.py', side: 'new', start: 34, end: 34, text: 'первый', suggestion: '' },
      {
        id: 'n2',
        file: 'scripts/validate.py',
        side: 'new',
        start: 16,
        end: 16,
        text: 'второй\nвторая строка',
        suggestion: '',
      },
    ];
    const fx = await env.server('mixed', {
      version: 1,
      annotations: notes,
      fileOpen: { 'scripts/validate.py': false },
    });
    const page = await env.open(fx);
    await page.click('#submit-btn');
    const items = await page.$$eval('dialog#submit .dlg-item', (els) => els.map((e) => e.textContent));
    await page.click('dialog#submit .dlg-item >> nth=1');
    await sleep(500);
    const r = await page.evaluate(() => {
      const n = document.querySelector('.note[data-id=n2]');
      const rect = n && n.getBoundingClientRect();
      return { open: document.querySelector('dialog#submit').open, top: rect && rect.top, vh: innerHeight };
    });
    const detail = JSON.stringify({ items, r });
    assert.ok(!r.open, detail);
    assert.ok(r.top > 140, detail);
    assert.ok(r.top < r.vh - 40, detail);
    t.diagnostic(`${items.join(' | ')}; top ${Math.round(r.top)}`);
  });

  it('shows "Не удалось отправить" in [role=alert] inside the dialog, without alert(), when the server is stopped', async (t) => {
    const fx = await env.server('mixed', { version: 1, globalComment: 'общий' });
    const page = await env.open(fx);
    let alerts = 0;
    page.on('dialog', (d) => {
      alerts++;
      d.dismiss();
    });
    await page.click('#submit-btn');
    fx.stop();
    await sleep(300);
    const w0 = await page.$eval('dialog#submit .btn.primary', (b) => b.offsetWidth);
    await page.click('dialog#submit .btn.primary');
    await page.waitForSelector('dialog#submit [role=alert]:not([hidden])', { timeout: 5000 });
    const r = await page.evaluate(() => ({
      text: document.querySelector('dialog#submit [role=alert]').textContent,
      btn: document.querySelector('dialog#submit .btn.primary').textContent,
    }));
    const w1 = await page.$eval('dialog#submit .btn.primary', (b) => b.offsetWidth);
    const detail = JSON.stringify({ r, alerts, w0, w1 });
    assert.ok(r.text.startsWith('Не удалось отправить'), detail);
    assert.equal(alerts, 0, detail);
    assert.equal(r.btn, 'Отправить фидбек', detail);
    assert.equal(w0, w1, detail);
    // Network errors from the stopped server are expected: leave them out of the shared error count.
    page.errors.length = 0;
    t.diagnostic(r.text);
  });

  it('posts Markdown to /api/submit that is byte for byte equal to feedback.golden.md', async (t) => {
    const state = {
      version: 1,
      annotations: [
        { id: 'a1', file: 'scripts/validate.py', side: 'new', start: 16, end: 16, text: 'Почему 12?', suggestion: '' },
        {
          id: 'a2',
          file: 'scripts/collect.py',
          side: 'new',
          start: 54,
          end: 58,
          text: 'Слишком сложно',
          suggestion: 'return verify_simple(root, ref)\n```inner```',
        },
      ],
      sectionComments: { s2: 'Глава про валидатор — ок.' },
      globalComment: 'В целом хорошо.\nНо есть вопросы.',
    };
    const fx = await env.server('mixed', state);
    const page = await env.open(fx);
    let body = null;
    await page.route('**/api/submit', async (route) => {
      body = JSON.parse(route.request().postData());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.click('#submit-btn');
    await page.click('dialog#submit .btn.primary');
    await page.waitForSelector('.finished');
    const want = fs.readFileSync(GOLDEN, 'utf8');
    assert.ok(body, 'no POST to /api/submit');
    assert.equal(body.action, 'feedback');
    assert.equal(body.markdown, want, `difference:\n${JSON.stringify(body.markdown)}\n${JSON.stringify(want)}`);
    const sub = await page.$eval('.finished-sub', (e) => e.textContent);
    t.diagnostic(`${want.length} characters; "${sub}"`);
  });

  it('shows the matching heading and "Сервер остановлен, вкладку можно закрыть." for feedback, approve and close', async (t) => {
    const want = {
      feedback: 'Фидбек отправлен в сессию Claude Code.',
      approve: 'Одобрение отправлено в сессию Claude Code.',
      close: 'Ревью закрыто.',
    };
    const got = [];
    for (const action of ['feedback', 'approve', 'close']) {
      const fx = await env.server('mixed', {
        version: 1,
        globalComment: 'общий',
        annotations: [
          { id: 'x', file: 'scripts/collect.py', side: 'new', start: 34, end: 34, text: 'т', suggestion: '' },
        ],
      });
      const page = await env.open(fx);
      let body = null;
      await page.route('**/api/submit', async (route) => {
        body = JSON.parse(route.request().postData());
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      });
      if (action === 'close') {
        await page.click('#more-btn');
        await page.click('.menu-item:has-text("Закрыть без ответа")');
      } else await page.click(action === 'approve' ? '#approve-btn' : '#submit-btn');
      await page.keyboard.press(`${MOD}+Enter`);
      await page.waitForSelector('.finished');
      const r = await page.evaluate(() => ({
        h1: document.querySelector('.finished h1').textContent,
        p: [...document.querySelectorAll('.finished p')].map((p) => p.textContent),
      }));
      await page.screenshot({ path: path.join(os.tmpdir(), `dr-final-${action}.png`) });
      assert.equal(r.h1, want[action], JSON.stringify(r));
      assert.equal(r.p[0], 'Сервер остановлен, вкладку можно закрыть.', JSON.stringify(r));
      assert.equal(body.action, action, JSON.stringify(r));
      if (action === 'close') assert.equal(body.markdown, '', 'close: markdown is not empty');
      got.push(`${action}: ${r.p[1]}`);
      await page.close();
    }
    t.diagnostic(got.join('; '));
  });

  it('shows "Сервер остановлен, вкладку можно закрыть." on the final screen of all three actions without intercepting the request', async (t) => {
    const out = [];
    for (const action of ['feedback', 'approve', 'close']) {
      const fx = await env.server('mixed', {
        version: 1,
        annotations: [
          { id: 'a1', file: 'scripts/collect.py', side: 'new', start: 54, end: 55, text: 'Вопрос', suggestion: '' },
        ],
      });
      const page = await env.open(fx);
      if (action === 'close') {
        await page.click('#more-btn');
        await page.click('.menu-item:has-text("Закрыть без ответа")');
      } else await page.click(action === 'approve' ? '#approve-btn' : '#submit-btn');
      await page.keyboard.press(`${MOD}+Enter`);
      await page.waitForSelector('.finished');
      const text = await page.evaluate(() => document.querySelector('.finished').innerText.replace(/\n+/g, ' / '));
      assert.ok(text.includes('Сервер остановлен, вкладку можно закрыть.'), text);
      out.push(text);
      await page.close();
    }
    t.diagnostic(out.join(' || '));
  });

  expectCleanSession(env);
});

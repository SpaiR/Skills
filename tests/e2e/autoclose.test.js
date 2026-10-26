// Auto-closing the tab after the review is sent.
// The tab is created with its URL right away (CDP Target.createTarget), like `open <url>` from serve.py --open:
// a single history entry. A plain page.goto gives two (about:blank and the URL), and a script cannot close such a tab.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { sleep, startFixture } from './lib.js';

describe('tab auto-close after submit', () => {
  let dir, ctx, cdp;
  const servers = [];
  const fresh = async (fx) => { const s = await startFixture(fx); servers.push(s); return s; };
  const ready = (p) => p.waitForFunction(() => performance.getEntriesByName('dr-ready').length > 0);
  const openTab = async (url) => {
    const ev = ctx.waitForEvent('page');
    await cdp.send('Target.createTarget', { url });
    return ev;
  };
  const closeReview = async (p) => {
    await p.evaluate(() => document.querySelector('#more-btn').click());
    await p.click('.menu-item:has-text("Закрыть без ответа")');
    await p.click('dialog#submit .btn.primary');
  };

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-ac-'));
    ctx = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true, viewport: { width: 1280, height: 800 } });
    cdp = await ctx.newCDPSession(ctx.pages()[0] || await ctx.newPage());
  });
  after(async () => {
    for (const s of servers) s.stop();
    if (ctx) await ctx.close();
    for (const s of servers) fs.rmSync(s.run, { recursive: true, force: true });
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('closes a tab with a single history entry about 3 s after submit, counting down 3 -> 2', async (t) => { // was AC1
    const fx = await fresh('mixed2');
    const p = await openTab(fx.url);
    await ready(p);
    const hist = await p.evaluate(() => history.length);
    const closed = new Promise((r) => p.once('close', () => r(Date.now())));
    await closeReview(p);
    const t0 = Date.now();
    await p.waitForSelector('.finished-close');
    const texts = [await p.textContent('.finished-close')];
    await sleep(1100);
    texts.push(await p.textContent('.finished-close').catch(() => 'closed'));
    const at = await Promise.race([closed, sleep(6000).then(() => null)]);
    fx.stop();
    assert.ok(at, `the tab did not close (history.length=${hist}); texts: ${texts}`);
    const dt = (at - t0) / 1000;
    assert.equal(texts[0], 'Вкладка закроется через 3 с', `${texts} / ${dt}`);
    assert.match(texts[1], /через 2 с/, `${texts} / ${dt}`);
    assert.ok(dt > 2.5 && dt < 4.5, `${texts} / ${dt}`);
    t.diagnostic(`history.length=${hist}; ${texts.join(' -> ')} -> closed after ${dt.toFixed(1)} s`);
  });

  it('does not close a tab with two history entries and asks the user to close it manually', async (t) => { // was AC2
    const fx = await fresh('mixed2');
    const p = await openTab('about:blank');
    await p.goto(fx.url);
    await ready(p);
    await closeReview(p);
    await sleep(3800);
    const text = await p.textContent('.finished-close');
    fx.stop();
    assert.ok(!p.isClosed(), text);
    assert.match(text, /закройте её вручную/, text);
    t.diagnostic(text);
  });
});

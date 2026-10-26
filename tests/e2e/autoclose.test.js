// Автозакрытие вкладки после отправки: node harness/tests/autoclose.test.js
// Вкладка создаётся сразу с адресом (CDP Target.createTarget) — как при `open <url>` из serve.py --open:
// одна запись в истории. Обычный page.goto даёт две (about:blank + адрес), такую вкладку скрипт закрыть не может.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startFixture, check, summary, assert, sleep } = require('./lib');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-ac-'));
  const ctx = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true, viewport: { width: 1280, height: 800 } });
  const cdp = await ctx.newCDPSession(ctx.pages()[0] || await ctx.newPage());
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
  try {
    await check('AC1 вкладка с одной записью в истории: отсчёт 3 → 2 и закрытие примерно через 3 с', async () => {
      const fx = await startFixture('mixed2');
      const p = await openTab(fx.url);
      await ready(p);
      const hist = await p.evaluate(() => history.length);
      const closed = new Promise((r) => p.once('close', () => r(Date.now())));
      await closeReview(p);
      const t0 = Date.now();
      await p.waitForSelector('.finished-close');
      const texts = [await p.textContent('.finished-close')];
      await sleep(1100);
      texts.push(await p.textContent('.finished-close').catch(() => 'закрыта'));
      const at = await Promise.race([closed, sleep(6000).then(() => null)]);
      fx.stop();
      assert(at, `вкладка не закрылась (history.length=${hist}); тексты: ${texts}`);
      const dt = (at - t0) / 1000;
      assert(texts[0] === 'Вкладка закроется через 3 с' && /через 2 с/.test(texts[1]) && dt > 2.5 && dt < 4.5, `${texts} / ${dt}`);
      return `history.length=${hist}; ${texts.join(' → ')} → закрыта через ${dt.toFixed(1)} с`;
    });
    await check('AC2 вкладка с историей из двух записей: браузер не закрывает — просьба закрыть вручную', async () => {
      const fx = await startFixture('mixed2');
      const p = await openTab('about:blank');
      await p.goto(fx.url);
      await ready(p);
      await closeReview(p);
      await sleep(3800);
      const t = await p.textContent('.finished-close');
      fx.stop();
      assert(!p.isClosed() && /закройте её вручную/.test(t), t);
      return t;
    });
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  summary();
})();

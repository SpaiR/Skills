// Использование: node shoot.js <url> <shots-dir> [prefix]
// Снимает базовый набор скриншотов и печатает ошибки консоли. Для своих сценариев
// пиши отдельный скрипт с require('playwright-core').
const { chromium } = require('playwright-core');
const [url, dir, prefix = ''] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  const shots = [
    ['light-1440', { width: 1440, height: 900 }, 'light', false],
    ['light-1440-full', { width: 1440, height: 900 }, 'light', true],
    ['dark-1440', { width: 1440, height: 900 }, 'dark', false],
    ['dark-1440-full', { width: 1440, height: 900 }, 'dark', true],
    ['light-1024', { width: 1024, height: 800 }, 'light', false],
    ['light-1920', { width: 1920, height: 1080 }, 'light', false],
  ];
  for (const [name, viewport, colorScheme, fullPage] of shots) {
    const page = await browser.newPage({ viewport, colorScheme });
    page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(name + ' console.' + m.type() + ': ' + m.text()); });
    await page.goto(url);
    await page.waitForTimeout(600);
    const p = dir + '/' + prefix + name + '.png';
    await page.screenshot({ path: p, fullPage });
    console.log('shot', p);
    await page.close();
  }
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error('SHOOT FAIL', e); process.exit(1); });

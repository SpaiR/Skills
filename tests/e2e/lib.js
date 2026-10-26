// Общие помощники сценариев: запуск фикстуры (с подложенным state.json), браузер, проверки.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(ROOT, 'tests/fixtures');
const SERVE = path.join(ROOT, 'scripts/serve.py');

async function startFixture(fx, state) {
  const run = fs.mkdtempSync('/tmp/dr-test-');
  for (const f of ['guide.json', 'guide.patch', 'meta.json']) fs.copyFileSync(path.join(FIXTURES, fx, f), path.join(run, f));
  const full = path.join(FIXTURES, fx, 'full.patch');
  if (fs.existsSync(full)) fs.copyFileSync(full, path.join(run, 'full.patch'));
  if (state) fs.writeFileSync(path.join(run, 'state.json'), JSON.stringify(state));
  const proc = spawn('python3', [SERVE, '--dir', run, '--timeout-min', '10'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const url = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('serve.py не стартовал: ' + out)), 8000);
    proc.stdout.on('data', (d) => {
      out += d;
      const m = /DIFF_REVIEW_URL: (\S+)/.exec(out);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.stderr.on('data', (d) => { out += d; });
  });
  return {
    url, run, proc,
    state: () => JSON.parse(fs.readFileSync(path.join(run, 'state.json'), 'utf8')),
    stop: () => { try { proc.kill(); } catch (e) { /* уже остановлен */ } },
  };
}

async function launch() {
  return chromium.launch({ channel: 'chrome', headless: true });
}

// Страница с учётом ошибок консоли и сетевых запросов.
async function openPage(browser, url, opts = {}) {
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1440, height: 900 }, colorScheme: opts.colorScheme || 'light', reducedMotion: opts.reducedMotion || 'reduce' });
  page.errors = [];
  page.requests = [];
  const label = current;
  page.on('pageerror', (e) => page.errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') page.errors.push(`[${label}] console.${m.type()}: ${m.text()} @ ${JSON.stringify(m.location())}`); });
  page.on('request', (r) => page.requests.push(r.url()));
  await page.goto(url);
  await page.waitForFunction(() => performance.getEntriesByName('dr-ready').length > 0);
  return page;
}

const results = [];
let current = '';
async function check(name, fn) {
  current = name.split(' ')[0];
  try {
    const detail = await fn();
    results.push([true, name]);
    console.log('ok  ', name, detail === undefined ? '' : `— ${detail}`);
  } catch (e) {
    results.push([false, name]);
    console.log('FAIL', name, '—', e.message.split('\n').slice(0, 6).join(' | '));
  }
}
function summary() {
  const failed = results.filter(([ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} ok`);
  if (failed.length) process.exitCode = 1;
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { startFixture, launch, openPage, check, summary, assert, sleep, ROOT, FIXTURES };

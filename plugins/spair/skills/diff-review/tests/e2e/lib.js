// Shared helpers for the browser tests: fixture server, browser launch, pages that capture
// console errors and requests, and the per-file environment used with node:test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, afterEach, before, beforeEach, it } from 'node:test';
import { chromium } from 'playwright-core';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const FIXTURES = path.join(ROOT, 'tests/fixtures');
const SERVE = path.join(ROOT, 'scripts/serve.py');

// Selectors: a file block by path, and a line-number cell of a side ('old' or 'new') in a file.
export const fileSel = (p) => `.file[data-path="${p}"]`;
export const numSel = (file, side, no) => `${file} td.num[data-side=${side}][data-no="${no}"]`;

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Servers that are still running; killed on process exit so an aborted run leaves nothing behind.
const live = new Set();
process.on('exit', () => {
  for (const p of live) {
    try {
      p.kill();
    } catch {
      /* already stopped */
    }
  }
});

// Copies a fixture into a temp dir with a state.json, starts serve.py on it and waits for its URL.
// The page opens in "Гайд", the mode most tests are about: state.json gets `mode: "guide"` unless `state` sets
// a mode. opts.fresh: no state.json at all, as for a new review (it opens in "Обзор").
// opts.meta: fields merged into meta.json (`pr` is merged one level deep); opts.guide: top-level fields merged
// into guide.json; opts.env: extra environment for serve.py.
export async function startFixture(fx, state, opts = {}) {
  const run = fs.mkdtempSync('/tmp/dr-test-');
  for (const f of ['guide.json', 'guide.patch', 'meta.json'])
    fs.copyFileSync(path.join(FIXTURES, fx, f), path.join(run, f));
  if (opts.meta) {
    const metaPath = path.join(run, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const { pr, ...rest } = opts.meta;
    Object.assign(meta, rest);
    if (pr) meta.pr = { ...meta.pr, ...pr };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
  }
  if (opts.guide) {
    const guidePath = path.join(run, 'guide.json');
    const guide = JSON.parse(fs.readFileSync(guidePath, 'utf8'));
    fs.writeFileSync(guidePath, JSON.stringify({ ...guide, ...opts.guide }));
  }
  const full = path.join(FIXTURES, fx, 'full.patch');
  if (fs.existsSync(full)) fs.copyFileSync(full, path.join(run, 'full.patch'));
  if (!opts.fresh) fs.writeFileSync(path.join(run, 'state.json'), JSON.stringify({ mode: 'guide', ...state }));
  const proc = spawn('python3', [SERVE, '--dir', run, '--timeout-min', '10'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...opts.env },
  });
  live.add(proc);
  proc.on('exit', () => live.delete(proc));
  let out = '';
  let url;
  try {
    url = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`serve.py did not start: ${out}`)), 8000);
      proc.stdout.on('data', (d) => {
        out += d;
        const m = /DIFF_REVIEW_URL: (\S+)/.exec(out);
        if (m) {
          clearTimeout(t);
          resolve(m[1]);
        }
      });
      proc.stderr.on('data', (d) => {
        out += d;
      });
    });
  } catch (e) {
    proc.kill();
    throw e;
  }
  return {
    url,
    run,
    proc,
    state: () => JSON.parse(fs.readFileSync(path.join(run, 'state.json'), 'utf8')),
    // Everything serve.py printed so far (stdout and stderr).
    output: () => out,
    stop: () => {
      try {
        proc.kill();
      } catch {
        /* already stopped */
      }
    },
  };
}

export function launch() {
  return chromium.launch({ channel: 'chrome', headless: true });
}

// Opens the review page and waits until the viewer reports it is ready. The page collects
// console errors and warnings in page.errors and every request URL in page.requests.
export async function openPage(browser, url, opts = {}) {
  const page = await browser.newPage({
    viewport: opts.viewport || { width: 1440, height: 900 },
    colorScheme: opts.colorScheme || 'light',
    reducedMotion: opts.reducedMotion || 'reduce',
  });
  page.errors = [];
  page.requests = [];
  const label = opts.label || '';
  page.on('pageerror', (e) => page.errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      page.errors.push(`[${label}] console.${m.type()}: ${m.text()} @ ${JSON.stringify(m.location())}`);
  });
  page.on('request', (r) => page.requests.push(r.url()));
  await page.goto(url);
  await page.waitForFunction(() => performance.getEntriesByName('dr-ready').length > 0);
  return page;
}

// Per-file environment. Call inside a describe() body: it registers hooks that launch one browser
// for the whole file, close leftover pages after every test, and always stop every server and the
// browser at the end, also when tests fail.
export function useEnv() {
  const env = {
    browser: null,
    label: '',
    servers: [],
    pages: [],
    errors: [],
    requests: [],
    // Starts a fixture server that is stopped automatically when the file ends.
    async server(fx, state, opts) {
      const s = await startFixture(fx, state, opts);
      env.servers.push(s);
      return s;
    },
    // Opens a page on a running fixture, labelled with the current test name for error messages.
    async open(fx, opts) {
      const page = await openPage(env.browser, fx.url, { ...opts, label: env.label });
      env.errors.push(page.errors);
      env.requests.push(page.requests);
      env.pages.push(page);
      return page;
    },
  };
  before(async () => {
    env.browser = await launch();
  });
  beforeEach((t) => {
    env.label = t.name;
  });
  afterEach(async () => {
    for (const page of env.pages.splice(0)) if (!page.isClosed()) await page.close().catch(() => {});
  });
  after(async () => {
    for (const s of env.servers) s.stop();
    if (env.browser) await env.browser.close();
    for (const s of env.servers) fs.rmSync(s.run, { recursive: true, force: true });
  });
  return env;
}

// Registers the two closing tests of a file: no console errors or exceptions in any scenario of the
// file, and no network request leaves 127.0.0.1 (only /, /assets/* and /api/*). Call it last in the describe().
export function expectCleanSession(env) {
  it('raises no console errors or page exceptions in any scenario', () => {
    const errs = env.errors.flat();
    assert.equal(errs.length, 0, errs.join(' | '));
  });
  it('sends network requests only to 127.0.0.1 paths /, /assets/* and /api/*', () => {
    const bad = env.requests.flat().filter((u) => {
      const x = new URL(u);
      return (
        x.hostname !== '127.0.0.1' ||
        !(x.pathname === '/' || x.pathname.startsWith('/assets/') || x.pathname.startsWith('/api/'))
      );
    });
    assert.equal(bad.length, 0, bad.join(' '));
  });
}

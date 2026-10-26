// Themes: CSS variables, code colours, the theme menu, button contrast and dark theme surfaces.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { expectCleanSession, sleep, useEnv } from './lib.js';

describe('themes and contrast', () => {
  const env = useEnv();
  let mixed;
  before(async () => {
    mixed = await env.server('mixed');
  });

  it('applies the palette variables from the specification in both themes, system and explicit', async () => {
    // was 3
    const want = {
      light: {
        '--surface': '#ffffff',
        '--ink': '#1b1f24',
        '--add-line': '#e8f6ed',
        '--del-word': '#f9c6c6',
        '--accent': '#2c56c9',
        '--syn-com': '#4b5564',
        '--bg': '#f6f7f9',
        '--hunk-bg': '#eef3fb',
      },
      dark: {
        '--surface': '#151618',
        '--ink': '#e6e8eb',
        '--add-line': '#13271c',
        '--del-word': '#5a2428',
        '--accent': '#8ea4ff',
        '--syn-com': '#b9c0ca',
        '--bg': '#0d0e10',
        '--hunk-bg': '#1a2030',
      },
    };
    const read = (page) =>
      page.evaluate(
        (names) =>
          Object.fromEntries(
            names.map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()]),
          ),
        Object.keys(want.light),
      );
    for (const [scheme, attr] of [
      ['light', null],
      ['dark', null],
      ['light', 'dark'],
      ['dark', 'light'],
    ]) {
      const page = await env.open(mixed, { colorScheme: scheme });
      if (attr) await page.evaluate((a) => document.documentElement.setAttribute('data-theme', a), attr);
      const got = await read(page);
      const exp = want[attr || scheme];
      for (const [k, v] of Object.entries(exp))
        assert.equal(got[k], v, `${scheme}/${attr}: ${k}=${got[k]}, expected ${v}`);
      await page.close();
    }
  });

  it('colours add, del and context code the same as --ink in both themes', async () => {
    // was 5
    for (const scheme of ['light', 'dark']) {
      const page = await env.open(mixed, { colorScheme: scheme });
      const r = await page.evaluate(() => {
        const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
        const probe = document.createElement('div');
        probe.style.color = ink;
        document.body.append(probe);
        const inkRgb = getComputedStyle(probe).color;
        probe.remove();
        const colors = ['add', 'del', 'ctx'].map(
          (t) => getComputedStyle(document.querySelector(`tr.ln[data-t=${t}] td.code`)).color,
        );
        return { inkRgb, colors };
      });
      assert.ok(
        r.colors.every((c) => c === r.inkRgb),
        `${scheme}: ${JSON.stringify(r)}`,
      );
      await page.close();
    }
  });

  it('switches the theme from the More menu, saves it in state.json and keeps it after reload; Auto restores the system theme', async (t) => {
    // was 45
    const fx = await env.server('mixed');
    const page = await env.open(fx, { colorScheme: 'light' });
    const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click('#more-btn');
    await page.click('.menu [role=menuitemradio]:has-text("Тёмная")');
    const r = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    assert.equal(r.attr, 'dark', JSON.stringify(r));
    assert.equal(r.bg, 'rgb(13, 14, 16)', JSON.stringify(r));
    const checked = await page.$$eval('.menu [role=menuitemradio]', (els) =>
      els.map((e) => `${e.querySelector('.menu-label').textContent}:${e.getAttribute('aria-checked')}`),
    );
    assert.equal(checked.join(), 'Авто:false,Светлая:false,Тёмная:true', checked.join());
    await sleep(600);
    assert.equal(fx.state().theme, 'dark', `state.theme = ${fx.state().theme}`);
    await page.reload();
    await page.waitForFunction(() => performance.getEntriesByName('dr-ready').length > 0);
    const r2 = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    assert.equal(r2.attr, 'dark', `after reload: ${JSON.stringify(r2)}`);
    assert.equal(r2.bg, 'rgb(13, 14, 16)', `after reload: ${JSON.stringify(r2)}`);
    // "Auto" removes the attribute and returns to the system (light) theme.
    await page.click('#more-btn');
    await page.click('.menu [role=menuitemradio]:has-text("Авто")');
    const r3 = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    assert.equal(r3.attr, null, `auto: ${JSON.stringify(r3)}`);
    assert.equal(r3.bg, before, `auto: ${JSON.stringify(r3)}`);
    await sleep(600);
    assert.equal(fx.state().theme, 'auto', `state.theme after Auto = ${fx.state().theme}`);
    t.diagnostic(`${before} -> ${r.bg}; after reload ${r2.attr}; Auto -> ${r3.bg}`);
  });

  it('keeps the text of .btn.primary at contrast 4.5 or more in the dark theme, system and explicit', async (t) => {
    // was 46
    const fx = await env.server('mixed');
    const out = [];
    for (const [scheme, attr] of [
      ['dark', null],
      ['light', 'dark'],
    ]) {
      const page = await env.open(fx, { colorScheme: scheme });
      if (attr) await page.evaluate((a) => document.documentElement.setAttribute('data-theme', a), attr);
      await page.click('#submit-btn');
      const r = await page.evaluate(() => {
        const rgb = (s) =>
          s
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number);
        const lin = (c) => {
          c /= 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
        const ratio = (a, b) => {
          const x = L(a),
            y = L(b);
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
        };
        return [...document.querySelectorAll('.btn.primary')].map((b) => {
          const cs = getComputedStyle(b);
          return {
            text: b.textContent.trim().slice(0, 20),
            ratio: +ratio(rgb(cs.color), rgb(cs.backgroundColor)).toFixed(2),
          };
        });
      });
      assert.ok(r.length >= 2, JSON.stringify(r));
      assert.ok(
        r.every((x) => x.ratio >= 4.5),
        JSON.stringify(r),
      );
      out.push(`${attr ? 'data-theme' : 'system'}: ${r.map((x) => `${x.text} ${x.ratio}`).join(', ')}`);
      await page.keyboard.press('Escape');
      await page.close();
    }
    t.diagnostic(out.join('; '));
  });

  it('never paints code text in an add or del status colour, in both themes and on both fixtures', async (t) => {
    // was 50
    const out = [];
    for (const fxName of ['mixed', 'big']) {
      const fx = await env.server(fxName);
      for (const scheme of ['light', 'dark']) {
        const page = await env.open(fx, { colorScheme: scheme });
        const r = await page.evaluate(() => {
          const probe = (v) => {
            const d = document.createElement('div');
            d.style.color = `var(${v})`;
            document.body.append(d);
            const c = getComputedStyle(d).color;
            d.remove();
            return c;
          };
          const banned = new Set(
            ['--add-sign', '--del-sign', '--success', '--danger', '--add-bar', '--del-bar'].map(probe),
          );
          const allowed = new Set(['--ink', '--syn-kw', '--syn-str', '--syn-com', '--syn-num'].map(probe));
          let n = 0,
            bad = 0,
            other = 0;
          for (const el of document.querySelectorAll('td.code, td.code span:not(.nonl)')) {
            const c = getComputedStyle(el).color;
            n++;
            if (banned.has(c)) bad++;
            else if (!allowed.has(c)) other++;
          }
          return { n, bad, other };
        });
        assert.equal(r.bad, 0, `${fxName}/${scheme}: ${JSON.stringify(r)}`);
        assert.equal(r.other, 0, `${fxName}/${scheme}: ${JSON.stringify(r)}`);
        out.push(`${fxName}/${scheme} ${r.n}`);
        await page.close();
      }
    }
    t.diagnostic(`elements checked: ${out.join(', ')}`);
  });

  it('keeps --bg, --surface and --tint distinct in the dark theme, and word highlights distinct from their line background', async (t) => {
    // was 51
    const fx = await env.server('mixed');
    const page = await env.open(fx, { colorScheme: 'dark' });
    const r = await page.evaluate(() => {
      const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const card = getComputedStyle(document.querySelector('.sec')).backgroundColor;
      const files = getComputedStyle(document.querySelector('.sec-files')).backgroundColor;
      const w = document.querySelector('td.code.l-add span.w');
      return {
        bg: v('--bg'),
        surface: v('--surface'),
        tint: v('--tint'),
        bodyBg,
        card,
        files,
        addWord: w ? getComputedStyle(w).backgroundColor : null,
        addLine: w ? getComputedStyle(w.closest('td')).backgroundColor : null,
      };
    });
    assert.equal(new Set([r.bodyBg, r.card, r.files]).size, 3, JSON.stringify(r));
    assert.ok(r.addWord, JSON.stringify(r));
    assert.notEqual(r.addWord, r.addLine, JSON.stringify(r));
    t.diagnostic(`body ${r.bodyBg}, chapter ${r.card}, backing ${r.files}; word ${r.addWord} on line ${r.addLine}`);
  });

  expectCleanSession(env);
});

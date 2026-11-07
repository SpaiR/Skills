// The "Обзор" mode and the guide brief: a fresh review opens there, the brief groups and chapter links,
// chapter cards and the way into "Гайд", the G key, persistence, old guides without a brief, untrusted point text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { expectCleanSession, FIXTURES, sleep, useEnv } from './lib.js';

const BRIEF = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'mixed2/guide.json'), 'utf8')).brief;
// typography() binds short words with no-break spaces: compare the text with plain spaces.
const plain = (s) => s.replace(/ /g, ' ');

describe('overview mode and guide brief', () => {
  const env = useEnv();
  const waitSaved = () => sleep(700);
  const mode = (page) =>
    page.evaluate(() => {
      const root = document.documentElement.classList;
      return {
        mode: root.contains('mode-overview') ? 'overview' : root.contains('mode-files') ? 'files' : 'guide',
        pressed: [...document.querySelectorAll('#top .mode-seg button[aria-pressed="true"]')].map((b) => b.textContent),
      };
    });

  it('opens a fresh review in "Обзор" with the brief grouped by kind and one card per chapter', async () => {
    const page = await env.open(await env.server('mixed2', null, { fresh: true }));
    assert.deepEqual(await mode(page), { mode: 'overview', pressed: ['Обзор'] });
    const r = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('#top .mode-seg button')].map((b) => b.textContent),
      groups: [...document.querySelectorAll('.hero .brief .brief-group')].map((g) => ({
        kind: g.className.replace(/.*is-/, ''),
        title: g.querySelector('.brief-title').textContent,
        points: [...g.querySelectorAll('.brief-text')].map((t) => t.textContent),
        links: [...g.querySelectorAll('.brief-ch')].map((b) => b.textContent),
      })),
      // The brief sits after the intent and before the meta line.
      order: [...document.querySelector('.hero').children].map((c) => c.className.split(' ')[0] || c.tagName),
      cards: [...document.querySelectorAll('.ov-sec')].map((c) => ({
        key: c.dataset.key,
        num: c.querySelector('.ov-num').textContent,
        title: c.querySelector('h2').textContent,
        overview: !!c.querySelector('.overview.md'),
        stats: c.querySelector('.ov-stats').textContent,
        read: c.querySelector('.ov-read').textContent,
      })),
      chapters: document.querySelectorAll('#main .sec').length,
      files: document.querySelectorAll('#main .file').length,
      viewSegHidden: document.querySelector('#top .view-seg').hidden,
      toc: [...document.querySelectorAll('#toc .toc-sec-go')].map((b) => b.textContent),
      tocFiles: document.querySelectorAll('#toc .file-row, #toc .toc-status').length,
    }));
    assert.deepEqual(r.buttons, ['Обзор', 'Гайд', 'Файлы']);
    const want = (kind) => BRIEF.filter((p) => p.kind === kind);
    assert.deepEqual(
      r.groups.map((g) => ({ ...g, points: g.points.map(plain) })),
      [
        {
          kind: 'change',
          title: 'Что меняется',
          points: want('change').map((p) => p.text),
          links: ['Глава 1', 'Глава 2'],
        },
        { kind: 'kept', title: 'Что остаётся как было', points: want('kept').map((p) => p.text), links: ['Глава 1'] },
        {
          kind: 'risk',
          title: 'На что смотреть',
          points: want('risk').map((p) => p.text),
          links: ['Глава 1', 'Глава 3'],
        },
      ],
    );
    assert.ok(r.order.indexOf('intent') < r.order.indexOf('brief'), r.order.join(' '));
    assert.ok(r.order.indexOf('brief') < r.order.indexOf('hero-meta'), r.order.join(' '));
    assert.deepEqual(
      r.cards.map((c) => [c.key, c.num, c.title, c.overview, c.read]),
      [
        ['s1', '01 / 03', 'Проверка ревизий в collect.py', true, 'Читать в гайде'],
        ['s2', '02 / 03', 'Валидатор: подробные ошибки и больше глав', true, 'Читать в гайде'],
        ['s3', '03 / 03', 'Уборка ресурсов', true, 'Читать в гайде'],
        ['rest', '—', 'Остальные файлы', true, 'Читать в гайде'],
      ],
    );
    assert.match(r.cards[1].stats, /^2 файла · \+\d+ −\d+$/, r.cards[1].stats);
    assert.equal(r.chapters, 0, 'chapter cards of "Обзор" must not be .sec');
    assert.equal(r.files, 0);
    assert.equal(r.viewSegHidden, true, 'the diff view switch is visible in "Обзор"');
    assert.deepEqual(r.toc, [
      '01Проверка ревизий в collect.py',
      '02Валидатор: подробные ошибки и больше глав',
      '03Уборка ресурсов',
      '—Остальные файлы',
    ]);
    assert.equal(r.tocFiles, 0, 'the sidebar of "Обзор" lists files or viewed toggles');
  });

  it('scrolls to the chapter card from "Глава N" and from the sidebar in "Обзор"', async () => {
    const fx = await env.server('mixed2', { mode: 'overview' });
    const page = await env.open(fx, { viewport: { width: 1440, height: 600 } });
    const cardTop = (key) =>
      page.evaluate((k) => document.querySelector(`.ov-sec[data-key="${k}"]`).getBoundingClientRect().top, key);
    await page.click('.brief-group.is-change .brief-ch >> text=Глава 2');
    await sleep(300);
    const top2 = await cardTop('s2');
    assert.ok(Math.abs(top2 - (52 + 16)) < 2, `card 2 top ${top2}`);
    assert.equal((await mode(page)).mode, 'overview', '"Глава N" left "Обзор"');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#toc .toc-group[data-key="s3"] .toc-sec-go');
    await sleep(300);
    const r = await page.evaluate(() => ({
      top: document.querySelector('.ov-sec[data-key="s3"]').getBoundingClientRect().top,
      y: scrollY,
      max: document.documentElement.scrollHeight - innerHeight,
    }));
    // The last cards may not reach the top: then the page is scrolled to its end.
    assert.ok(r.y > 0 && (Math.abs(r.top - 68) < 2 || Math.abs(r.y - r.max) < 2), JSON.stringify(r));
  });

  it('opens the chapter in "Гайд", expanded and in view, from "Читать в гайде"', async () => {
    const fx = await env.server('mixed2', { mode: 'overview', sectionOpen: { s2: false } });
    const page = await env.open(fx);
    await page.click('.ov-sec[data-key="s2"] .ov-read');
    await sleep(300);
    assert.deepEqual(await mode(page), { mode: 'guide', pressed: ['Гайд'] });
    const r = await page.evaluate(() => {
      const sec = document.querySelector('.sec[data-key="s2"]');
      return {
        collapsed: sec.classList.contains('collapsed'),
        top: sec.getBoundingClientRect().top + sec.clientTop, // the header top, as nav.js measures it
        current: sec.querySelector('.sec-head').classList.contains('is-current'),
        focus: document.activeElement === sec.querySelector('.sec-toggle'),
        files: sec.querySelectorAll('.file').length,
      };
    });
    assert.deepEqual(
      { ...r, top: Math.round(r.top) },
      { collapsed: false, top: 52, current: true, focus: true, files: 2 },
    );
    await waitSaved();
    assert.equal(fx.state().mode, 'guide');
  });

  it('keeps the chosen mode after reload, "Гайд" and "Обзор" alike', async () => {
    const fx = await env.server('mixed2', null, { fresh: true });
    let page = await env.open(fx);
    await page.click('#top .mode-seg button[data-mode="guide"]');
    await waitSaved();
    page = await env.open(fx);
    assert.deepEqual(await mode(page), { mode: 'guide', pressed: ['Гайд'] });
    const fx2 = await env.server('mixed2', { mode: 'files' });
    page = await env.open(fx2);
    await page.click('#top .mode-seg button[data-mode="overview"]');
    await waitSaved();
    page = await env.open(fx2);
    assert.deepEqual(await mode(page), { mode: 'overview', pressed: ['Обзор'] });
    assert.equal(fx2.state().mode, 'overview');
  });

  it('switches modes by click with titles on the buttons, and G goes from "Обзор" to "Гайд", then toggles "Гайд" and "Файлы"', async () => {
    const page = await env.open(await env.server('mixed2', { mode: 'overview' }));
    const titles = await page.$$eval('#top .mode-seg button', (bs) => bs.map((b) => b.title));
    assert.deepEqual(titles, ['Обзор: суть изменения и главы', 'Гайд (G)', 'Файлы (G)']);
    for (const [m, label] of [
      ['files', 'Файлы'],
      ['guide', 'Гайд'],
      ['overview', 'Обзор'],
    ]) {
      await page.click(`#top .mode-seg button[data-mode="${m}"]`);
      assert.deepEqual(await mode(page), { mode: m, pressed: [label] });
    }
    await page.keyboard.press('g');
    assert.equal((await mode(page)).mode, 'guide');
    await page.keyboard.press('g');
    assert.equal((await mode(page)).mode, 'files');
    await page.keyboard.press('g');
    assert.equal((await mode(page)).mode, 'guide');
  });

  it('shows a hint for chapter keys in "Обзор", and file keys there change nothing and do not throw', async () => {
    const fx = await env.server('mixed2', { mode: 'overview' });
    const page = await env.open(fx);
    await page.keyboard.press(']');
    assert.equal(await page.textContent('#toast'), 'Это действие с главами — оно есть в режиме «Гайд» (G)');
    await page.keyboard.press('Shift+V');
    assert.equal(await page.textContent('#toast'), 'Это действие с главами — оно есть в режиме «Гайд» (G)');
    for (const key of ['j', 'k', 'n', 'p', 'v', 'o', 'e', 'c', 'z', 'Shift+Z', 'Shift+O', 'Shift+C', '['])
      await page.keyboard.press(key);
    await waitSaved();
    const st = fx.state();
    assert.equal(st.mode, 'overview');
    assert.deepEqual(st.reviewed || {}, {});
    assert.deepEqual(st.fileOpen || {}, {});
    assert.equal((await mode(page)).mode, 'overview');
    await page.keyboard.press('?');
    const help = await page.textContent('dialog#help');
    assert.ok(help.includes('Режим: гайд или файлы, из обзора — в гайд'), help);
    assert.ok(!help.includes('Следующая / предыдущая глава'), 'chapter keys are listed in the help of "Обзор"');
  });

  it('shows the brief in "Гайд", where "Глава N" expands and opens the chapter, and hides it in "Файлы"', async () => {
    const fx = await env.server('mixed2', { sectionOpen: { s3: false } });
    const page = await env.open(fx);
    assert.equal(await page.locator('.hero .brief .brief-item').count(), BRIEF.length);
    await page.click('.brief-group.is-risk .brief-ch >> text=Глава 3');
    await sleep(300);
    const r = await page.evaluate(() => {
      const sec = document.querySelector('.sec[data-key="s3"]');
      return {
        collapsed: sec.classList.contains('collapsed'),
        top: Math.round(sec.getBoundingClientRect().top + sec.clientTop),
        current: sec.querySelector('.sec-head').classList.contains('is-current'),
      };
    });
    assert.deepEqual(r, { collapsed: false, top: 52, current: true });
    await page.keyboard.press('g');
    assert.equal((await mode(page)).mode, 'files');
    assert.equal(await page.locator('.brief').count(), 0, 'the brief is shown in "Файлы"');
  });

  it('opens an old guide without a brief in "Обзор" with the chapter cards and no brief block', async () => {
    const page = await env.open(await env.server('mixed', null, { fresh: true }));
    assert.deepEqual(await mode(page), { mode: 'overview', pressed: ['Обзор'] });
    assert.equal(await page.locator('.brief').count(), 0);
    assert.ok((await page.locator('.ov-sec').count()) >= 3);
    assert.ok(await page.locator('.hero .intent').count());
  });

  it('shows HTML in a brief point as text and omits empty groups', async () => {
    const xss = '<img src=x onerror="window.__xss=1"><b>жирный</b>';
    const fx = await env.server('mixed2', null, {
      fresh: true,
      guide: {
        brief: [
          { kind: 'change', text: xss, section: 1 },
          { kind: 'risk', text: 'Вторая мысль' },
        ],
      },
    });
    const page = await env.open(fx);
    await sleep(200);
    const r = await page.evaluate(() => ({
      xss: window.__xss ?? null,
      elements: document.querySelectorAll('.brief img, .brief b, .brief script').length,
      texts: [...document.querySelectorAll('.brief-text')].map((t) => t.textContent),
      titles: [...document.querySelectorAll('.brief-title')].map((t) => t.textContent),
      links: document.querySelectorAll('.brief-ch').length,
    }));
    assert.deepEqual(r, {
      xss: null,
      elements: 0,
      texts: [xss, 'Вторая мысль'],
      titles: ['Что меняется', 'На что смотреть'],
      links: 1,
    });
  });

  it('jumps from the submit dialog of "Обзор" to a note, a chapter comment and a draft through "Гайд"', async () => {
    const state = {
      mode: 'overview',
      annotations: [
        { id: 'n1', file: 'scripts/validate.py', side: 'new', start: 16, end: 16, text: 'заметка', suggestion: '' },
      ],
      sectionComments: { s1: 'к главе' },
      drafts: {
        'scripts/collect.py|new|34|34': {
          file: 'scripts/collect.py',
          side: 'new',
          start: 34,
          end: 34,
          text: 'черновик',
          suggestion: '',
        },
      },
    };
    const inView = (page, sel) =>
      page.evaluate((s) => {
        const el = document.querySelector(s);
        const r = el && el.getBoundingClientRect();
        return !!r && r.top >= 52 && r.top < innerHeight;
      }, sel);
    const cases = [
      ['note', 'dialog#submit .dlg-item >> text=заметка', '.note[data-id="n1"]'],
      ['chapter comment', 'dialog#submit .dlg-item >> text=к главе', '.sec[data-key="s1"] .sec-comment .note'],
      ['draft', 'dialog#submit .dlg-drafts .btn', '.draft-row[data-key="scripts/collect.py|new|34|34"]'],
    ];
    for (const [what, click, target] of cases) {
      const page = await env.open(await env.server('mixed2', state));
      await page.click('#submit-btn');
      await page.click(click);
      await sleep(400);
      assert.equal((await mode(page)).mode, 'guide', `${what}: not in "Гайд"`);
      assert.ok(await inView(page, target), `${what}: ${target} is not in view`);
    }
  });

  it('keeps the three-button mode switch clear of the right part of the top bar on medium widths', async () => {
    const cases = [
      ['mixed2', 768],
      ['mixed2', 1024],
      ['pr-github', 900],
      ['pr-github', 1024],
    ];
    const servers = {};
    for (const [fxName, width] of cases) {
      servers[fxName] ??= await env.server(fxName);
      const page = await env.open(servers[fxName], { viewport: { width, height: 700 } });
      const gap = await page.evaluate(
        () =>
          document.querySelector('#top .top-right').getBoundingClientRect().left -
          document.querySelector('#top .mode-seg').getBoundingClientRect().right,
      );
      assert.ok(gap >= 0, `${fxName} at ${width}px: the mode switch runs ${-gap}px into the right part`);
    }
  });

  it('opens "Обзор" for an unknown saved mode', async () => {
    const page = await env.open(await env.server('mixed2', { mode: 'bogus' }));
    assert.deepEqual(await mode(page), { mode: 'overview', pressed: ['Обзор'] });
  });

  it('keeps the reading place of "Гайд" across a look at "Обзор", as a look at "Файлы" does', async () => {
    // The round trip through "Файлы" is the reference: the row anchor of a mode switch may settle a header lower.
    const trip = async (via) => {
      const page = await env.open(await env.server('mixed2'), { viewport: { width: 1440, height: 700 } });
      const place = () =>
        page.evaluate(() => ({
          y: Math.round(scrollY),
          file: document.querySelector('#main .file-head.is-current')?.closest('.file').dataset.path ?? null,
        }));
      await page.locator('#toc .file-row').nth(2).click();
      await sleep(400);
      const before = await place();
      assert.ok(before.y > 0 && before.file, JSON.stringify(before));
      await page.click(`#top .mode-seg button[data-mode="${via}"]`);
      await sleep(200);
      await page.click('#top .mode-seg button[data-mode="guide"]');
      await sleep(400);
      return { before, after: await place() };
    };
    const files = await trip('files');
    const overview = await trip('overview');
    assert.deepEqual(overview.before, files.before);
    assert.equal(overview.after.file, overview.before.file);
    assert.ok(Math.abs(overview.after.y - files.after.y) < 2, JSON.stringify({ files, overview }));
  });

  it('goes back to the chapter of "Гайд" left for "Обзор" when no file was current there', async () => {
    const closed = { s1: false, s2: false, s3: false, rest: false };
    const page = await env.open(await env.server('mixed2', { mode: 'guide', sectionOpen: closed }), {
      viewport: { width: 1440, height: 300 },
    });
    const place = () =>
      page.evaluate(() => ({
        top: Math.round(document.querySelector('#main .sec[data-key="s1"]').getBoundingClientRect().top),
        current: document.querySelector('#toc .toc-sec[aria-current="true"]')?.closest('.toc-group').dataset.key,
        file: !!document.querySelector('#main .file-head.is-current'),
      }));
    await page.click('#toc .toc-group[data-key="s1"] .toc-sec-go');
    await sleep(400);
    const before = await place();
    assert.ok(before.top < 60, JSON.stringify(before));
    assert.equal(before.current, 's1');
    assert.equal(before.file, false);
    await page.click('#top .mode-seg button[data-mode="overview"]');
    await sleep(200);
    await page.click('#top .mode-seg button[data-mode="guide"]');
    await sleep(400);
    assert.deepEqual(await place(), before);
  });

  it('opens only the chosen chapter from "Читать в гайде", not the one of the place left for "Обзор"', async () => {
    const closed = { s1: false, s2: false, s3: false, rest: false };
    const page = await env.open(await env.server('mixed2', { mode: 'files', sectionOpen: closed }), {
      viewport: { width: 1440, height: 700 },
    });
    await page.locator('#toc .tree-row[data-path]').first().click();
    await sleep(400);
    const left = await page.evaluate(
      () => document.querySelector('#main .file-head.is-current')?.closest('.file').dataset.path,
    );
    const guide = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'mixed2/guide.json'), 'utf8'));
    const leftSec = `s${guide.sections.findIndex((x) => x.diffs.some((d) => d.file === left)) + 1}`;
    const target = leftSec === 's3' ? 's2' : 's3';
    await page.click('#top .mode-seg button[data-mode="overview"]');
    await sleep(200);
    await page.click(`.ov-sec[data-key="${target}"] .ov-read`);
    await sleep(400);
    const open = await page.$$eval('#main .sec:not(.collapsed)', (els) => els.map((e) => e.dataset.key));
    assert.deepEqual(open, [target], JSON.stringify({ left, leftSec }));
  });

  it('opens only the target chapter from the submit dialog of "Обзор", not the one of the place left for it', async () => {
    // The place left for "Обзор" is a file of chapter s3; every target lies in s1 or s2.
    const state = {
      mode: 'files',
      sectionOpen: { s1: false, s2: false, s3: false, rest: false },
      annotations: [
        { id: 'n1', file: 'scripts/validate.py', side: 'new', start: 16, end: 16, text: 'заметка', suggestion: '' },
      ],
      sectionComments: { s1: 'к главе' },
      drafts: {
        'scripts/collect.py|new|34|34': {
          file: 'scripts/collect.py',
          side: 'new',
          start: 34,
          end: 34,
          text: 'черновик',
          suggestion: '',
        },
      },
    };
    const cases = [
      ['note', 'dialog#submit .dlg-item >> text=заметка', 's2'],
      ['chapter comment', 'dialog#submit .dlg-item >> text=к главе', 's1'],
      ['draft', 'dialog#submit .dlg-drafts .btn', 's1'],
    ];
    for (const [what, click, target] of cases) {
      const page = await env.open(await env.server('mixed2', state), { viewport: { width: 1440, height: 700 } });
      await page.click('#toc .tree-row[data-path="references/method.md"]');
      await sleep(400);
      const left = await page.evaluate(
        () => document.querySelector('#main .file-head.is-current')?.closest('.file').dataset.path,
      );
      assert.equal(left, 'references/method.md', `${what}: the place left for "Обзор"`);
      await page.click('#top .mode-seg button[data-mode="overview"]');
      await sleep(200);
      await page.click('#submit-btn');
      await page.click(click);
      await sleep(400);
      assert.equal((await mode(page)).mode, 'guide', `${what}: not in "Гайд"`);
      const open = await page.$$eval('#main .sec:not(.collapsed)', (els) => els.map((e) => e.dataset.key));
      assert.deepEqual(open, [target], `${what}: open chapters`);
    }
  });

  it('names the approve button by its title when a narrow header leaves only its icon', async () => {
    const page = await env.open(await env.server('mixed2'), { viewport: { width: 900, height: 700 } });
    const r = await page.$eval('#approve-btn', (b) => ({
      textShown: getComputedStyle(b.querySelector('.btn-text')).display !== 'none',
      title: b.title,
    }));
    assert.deepEqual(r, { textShown: false, title: 'Одобрить' });
  });

  it('marks the current chapter in the sidebar of "Обзор" after a jump and while scrolling', async () => {
    const page = await env.open(await env.server('mixed2', { mode: 'overview' }), {
      viewport: { width: 1440, height: 600 },
    });
    const current = () =>
      page.$$eval('#toc [aria-current="true"]', (els) => els.map((e) => e.closest('.toc-group').dataset.key));
    await page.click('#toc .toc-group[data-key="s2"] .toc-sec-go');
    await sleep(400);
    assert.deepEqual(await current(), ['s2']);
    // The last card cannot reach the top: it stays current while it is on screen.
    await page.click('#toc .toc-group[data-key="rest"] .toc-sec-go');
    await sleep(400);
    assert.deepEqual(await current(), ['rest']);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(100);
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 40);
    await sleep(400);
    assert.deepEqual(await current(), ['s1']);
  });

  it('leaves the hidden diff view alone on S in "Обзор" and says where it works', async () => {
    const fx = await env.server('mixed2', { mode: 'overview', viewMode: 'unified' });
    const page = await env.open(fx);
    await page.keyboard.press('s');
    assert.equal(await page.textContent('#toast'), 'Вид диффа переключается в режимах «Гайд» и «Файлы» (G)');
    await waitSaved();
    assert.equal(fx.state().viewMode ?? 'unified', 'unified');
    await page.keyboard.press('?');
    assert.ok(
      !(await page.textContent('dialog#help')).includes('Единый / Рядом'),
      'S is listed in the help of "Обзор"',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await waitSaved();
    assert.equal(fx.state().viewMode, 'split');
  });

  it('moves focus to "Читать в гайде" of the card from "Глава N" and the narrow drawer by keyboard', async () => {
    const page = await env.open(await env.server('mixed2', { mode: 'overview' }));
    const focused = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        return a.matches('.ov-read') ? a.closest('.ov-sec').dataset.key : a.className;
      });
    await page.focus('.brief-group.is-change .brief-ch >> nth=1');
    await page.keyboard.press('Enter');
    await sleep(300);
    assert.equal(await focused(), 's2');
    const narrow = await env.open(await env.server('mixed2', { mode: 'overview' }), {
      viewport: { width: 800, height: 700 },
    });
    await narrow.click('#toc-btn');
    await sleep(300);
    await narrow.focus('#toc .toc-group[data-key="s3"] .toc-sec-go');
    await narrow.keyboard.press('Enter');
    await sleep(300);
    const r = await narrow.evaluate(() => {
      const a = document.activeElement;
      return {
        key: a.matches('.ov-read') ? a.closest('.ov-sec').dataset.key : a.className,
        drawer: document.getElementById('toc-btn').getAttribute('aria-expanded'),
      };
    });
    assert.deepEqual(r, { key: 's3', drawer: 'false' });
  });

  expectCleanSession(env);
});

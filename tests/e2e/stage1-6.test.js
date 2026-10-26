// Критерии раздела 6, применимые к шагам 1–6: node harness/tests/stage1-6.test.js
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { startFixture, launch, openPage, check, summary, assert, sleep, ROOT } = require('./lib');

const fileSel = (p) => `.file[data-path="${p}"]`;

(async () => {
  const browser = await launch();
  const mixed = await startFixture('mixed');
  const big = await startFixture('big');
  const allErrors = [];
  const allRequests = [];
  const track = (page) => { allErrors.push(page.errors); allRequests.push(page.requests); return page; };
  try {
    await check('1 (частично) диффкор: node-тесты', async () => {
      execFileSync('node', [path.join(ROOT, 'tests/unit/diffcore.test.js')], { stdio: 'pipe' });
    });

    await check('2 contrast.js — код 0', async () => {
      execFileSync('node', [path.join(ROOT, 'tests/tools/contrast.js')], { stdio: 'pipe' });
    });

    await check('3 CSS-переменные совпадают со спецификацией в обеих темах', async () => {
      const want = {
        light: { '--surface': '#ffffff', '--ink': '#1b1f24', '--add-line': '#e8f6ed', '--del-word': '#f9c6c6', '--accent': '#2c56c9', '--syn-com': '#4b5564', '--bg': '#f6f7f9', '--hunk-bg': '#eef3fb' },
        dark: { '--surface': '#151618', '--ink': '#e6e8eb', '--add-line': '#13271c', '--del-word': '#5a2428', '--accent': '#8ea4ff', '--syn-com': '#b9c0ca', '--bg': '#0d0e10', '--hunk-bg': '#1a2030' },
      };
      const read = (page) => page.evaluate((names) => Object.fromEntries(names.map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()])), Object.keys(want.light));
      for (const [scheme, attr] of [['light', null], ['dark', null], ['light', 'dark'], ['dark', 'light']]) {
        const page = track(await openPage(browser, mixed.url, { colorScheme: scheme }));
        if (attr) await page.evaluate((a) => document.documentElement.setAttribute('data-theme', a), attr);
        const got = await read(page);
        const exp = want[attr || scheme];
        for (const [k, v] of Object.entries(exp)) assert(got[k] === v, `${scheme}/${attr}: ${k}=${got[k]}, ждали ${v}`);
        await page.close();
      }
    });

    await check('5 цвет кода одинаков для add/del/ctx и равен --ink (обе темы)', async () => {
      for (const scheme of ['light', 'dark']) {
        const page = track(await openPage(browser, mixed.url, { colorScheme: scheme }));
        const r = await page.evaluate(() => {
          const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
          const probe = document.createElement('div'); probe.style.color = ink; document.body.append(probe);
          const inkRgb = getComputedStyle(probe).color; probe.remove();
          const colors = ['add', 'del', 'ctx'].map((t) => getComputedStyle(document.querySelector(`tr.ln[data-t=${t}] td.code`)).color);
          return { inkRgb, colors };
        });
        assert(r.colors.every((c) => c === r.inkRgb), `${scheme}: ${JSON.stringify(r)}`);
        await page.close();
      }
    });

    await check('6 знаки +/− в колонке; при выделении мышью нет знаков и номеров', async () => {
      const page = track(await openPage(browser, mixed.url));
      const signs = await page.evaluate(() => ({
        add: [...document.querySelectorAll('tr.ln[data-t=add] td.sign')].every((td) => td.textContent === '+'),
        del: [...document.querySelectorAll('tr.ln[data-t=del] td.sign')].every((td) => td.textContent === '−'),
      }));
      assert(signs.add && signs.del, JSON.stringify(signs));
      const rows = page.locator(`${fileSel('scripts/collect.py')} tr.ln`);
      const first = await rows.nth(2).locator('td.code').boundingBox();
      const third = await rows.nth(4).locator('td.code').boundingBox();
      await page.mouse.move(first.x + 2, first.y + 10);
      await page.mouse.down();
      await page.mouse.move(third.x + third.width - 4, third.y + 10, { steps: 8 });
      await page.mouse.up();
      const text = await page.evaluate(() => getSelection().toString());
      const lines = text.split('\n').filter(Boolean);
      assert(lines.length >= 3, `выделено строк: ${lines.length}: ${JSON.stringify(text)}`);
      assert(lines.every((l) => !/^[+−-]/.test(l) && !/^\s*\d+\s/.test(l)), JSON.stringify(text));
      await page.close();
      return JSON.stringify(text);
    });

    await check('7 span.w: validate.py 16 (10→12) в del и add; ctx без span.w; big — 0', async () => {
      const page = track(await openPage(browser, mixed.url));
      const r = await page.evaluate(() => {
        const f = document.querySelector('.file[data-path="scripts/validate.py"]');
        const del = f.querySelector('td.num[data-side=old][data-no="16"]').closest('tr');
        const add = f.querySelector('td.num[data-side=new][data-no="16"]').closest('tr');
        const d59 = f.querySelector('td.num[data-side=old][data-no="59"]').closest('tr');
        const a59 = f.querySelector('td.num[data-side=new][data-no="59"]').closest('tr');
        return {
          del16: [...del.querySelectorAll('span.w')].map((s) => s.textContent),
          add16: [...add.querySelectorAll('span.w')].map((s) => s.textContent),
          w59: d59.querySelectorAll('span.w').length + a59.querySelectorAll('span.w').length,
          ctx: document.querySelectorAll('tr.ln[data-t=ctx] span.w').length,
        };
      });
      assert(r.del16.join() === '10' && r.add16.join() === '12' && r.ctx === 0, JSON.stringify(r));
      await page.close();
      const p2 = track(await openPage(browser, big.url));
      const n = await p2.evaluate(() => document.querySelectorAll('span.w').length);
      assert(n === 0, `big span.w = ${n}`);
      await p2.close();
      return `пара 59 (чистая вставка, сходство 0.42): span.w = ${r.w59}`;
    });

    await check('8 разделители ханков collect.py: 1–30, 12, 6', async () => {
      const page = track(await openPage(browser, mixed.url));
      const t = await page.$$eval(`${fileSel('scripts/collect.py')} tr.hunk`, (rows) => rows.map((r) => r.textContent));
      assert(t[0].includes('строки 1–30 не показаны') && t[1].includes('12 строк без изменений') && t[2].includes('6 строк без изменений'), JSON.stringify(t));
      await page.close();
    });

    await check('9 big SKILL.md (added): нет td.num[data-side=old]', async () => {
      const page = track(await openPage(browser, big.url));
      const n = await page.$$eval(`${fileSel('SKILL.md')} td.num[data-side=old]`, (x) => x.length);
      const rows = await page.$$eval(`${fileSel('SKILL.md')} tr.ln`, (x) => x.length);
      assert(n === 0 && rows > 0, `old=${n}, rows=${rows}`);
      await page.close();
    });

    await check('10 перенос: вторая визуальная строка под кодом; после W — 20px и горизонтальная прокрутка', async () => {
      const page = track(await openPage(browser, mixed.url));
      const sel = `${fileSel('scripts/validate.py')} td.num[data-side=new][data-no="59"]`;
      await page.locator(sel).scrollIntoViewIfNeeded();
      const r = await page.evaluate((sel) => {
        const tr = document.querySelector(sel).closest('tr');
        const code = tr.querySelector('td.code');
        const range = document.createRange();
        range.selectNodeContents(code);
        const rects = [...range.getClientRects()].filter((x) => x.width > 0);
        const lines = [...new Set(rects.map((x) => Math.round(x.top)))];
        const firstLeft = Math.min(...rects.filter((x) => Math.round(x.top) === lines[0]).map((x) => x.left));
        const secondLeft = Math.min(...rects.filter((x) => Math.round(x.top) === lines[1]).map((x) => x.left));
        return { len: code.textContent.length, lines: lines.length, firstLeft, secondLeft, signRight: tr.querySelector('td.sign').getBoundingClientRect().right, h: tr.getBoundingClientRect().height };
      }, sel);
      assert(r.lines >= 2 && Math.abs(r.firstLeft - r.secondLeft) <= 1 && r.secondLeft > r.signRight, JSON.stringify(r));
      await page.keyboard.press('w');
      const r2 = await page.evaluate((sel) => {
        const tr = document.querySelector(sel).closest('tr');
        const wrap = tr.closest('.diff-wrap');
        return { h: tr.getBoundingClientRect().height, sw: wrap.scrollWidth, cw: wrap.clientWidth, nowrap: document.body.classList.contains('nowrap') };
      }, sel);
      assert(r2.h === 20 && r2.sw > r2.cw && r2.nowrap, JSON.stringify(r2));
      await sleep(500);
      const st = mixed.state();
      assert(st.wrap === false, 'state.wrap не сохранён');
      await page.keyboard.press('w');
      await page.close();
      return `до: ${JSON.stringify(r)}; после: ${JSON.stringify(r2)}`;
    });

    await check('11 «Рядом»: added/deleted — unified, modified — split, штриховка у filler', async () => {
      const page = track(await openPage(browser, mixed.url));
      await page.click(`${fileSel('assets/viewer.html')} [data-act=show-file]`);
      await page.keyboard.press('s');
      const r = await page.evaluate(() => {
        const cls = (p) => { const t = document.querySelector(`.file[data-path="${p}"] table.diff`); return t && t.className; };
        const filler = document.querySelector('td.filler');
        return {
          added: cls('scripts/test_collect.py'), deleted: cls('assets/viewer.html'), modified: cls('scripts/collect.py'),
          filler: filler && getComputedStyle(filler).backgroundImage,
          split: document.body.classList.contains('view-split'),
        };
      });
      assert(/\bunified\b/.test(r.added) && /\bunified\b/.test(r.deleted) && /\bsplit\b/.test(r.modified) && /repeating-linear-gradient/.test(r.filler), JSON.stringify(r));
      await page.keyboard.press('s');
      await sleep(500);
      await page.close();
    });

    await check('13 XSS: в #main нет script/img/iframe и on*; <script из удалённого viewer.html виден текстом', async () => {
      const page = track(await openPage(browser, mixed.url));
      const show = page.locator(`${fileSel('assets/viewer.html')} [data-act=show-file]`);
      if (await show.count()) await show.click();
      const r = await page.evaluate(() => {
        const main = document.getElementById('main');
        const bad = main.querySelectorAll('script, img, iframe').length;
        const onAttr = [...main.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length;
        const text = document.querySelector('.file[data-path="assets/viewer.html"]').textContent;
        return { bad, onAttr, hasScriptText: text.includes('<script src="/assets/viewer.js"></script>') };
      });
      assert(r.bad === 0 && r.onAttr === 0 && r.hasScriptText, JSON.stringify(r));
      await page.close();
    });

    await check('14 высота #top 52px и нет горизонтальной прокрутки при 1024/1440/1920', async () => {
      const out = [];
      for (const fx of [mixed, big]) {
        for (const width of [1024, 1440, 1920]) {
          const page = track(await openPage(browser, fx.url, { viewport: { width, height: 900 } }));
          const r = await page.evaluate(() => ({ h: document.getElementById('top').getBoundingClientRect().height, sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }));
          assert(r.h === 52 && r.sw === r.cw, `${width}: ${JSON.stringify(r)}`);
          out.push(width);
          await page.close();
        }
      }
    });

    await check('15 при 1024 оглавление скрыто; T открывает поверх, Esc закрывает', async () => {
      const page = track(await openPage(browser, mixed.url, { viewport: { width: 1024, height: 800 } }));
      const tr = () => page.evaluate(() => { const t = document.getElementById('toc'); const r = t.getBoundingClientRect(); return { tf: getComputedStyle(t).transform, right: r.right, vis: getComputedStyle(t).visibility }; });
      const a = await tr();
      assert(a.tf === 'matrix(1, 0, 0, 1, -300, 0)' && a.right <= 0, 'закрыто: ' + JSON.stringify(a));
      await page.keyboard.press('t');
      await sleep(50);
      const b = await tr();
      assert(b.tf === 'matrix(1, 0, 0, 1, 0, 0)' && b.vis === 'visible', 'после T: ' + JSON.stringify(b));
      const top = await page.evaluate(() => { const r = document.getElementById('toc').getBoundingClientRect(); const el = document.elementFromPoint(r.left + 100, r.top + 100); return el.closest('#toc') !== null; });
      assert(top, 'оглавление не поверх контента');
      await page.keyboard.press('Escape');
      await sleep(50);
      const c = await tr();
      assert(c.tf === 'matrix(1, 0, 0, 1, -300, 0)', 'после Esc: ' + JSON.stringify(c));
      await page.close();
    });

    await check('16 раскладка главы: рядом при 1440, друг под другом при 1024 и в «Рядом» при 1440', async () => {
      const geo = (page) => page.evaluate(() => {
        const sec = document.querySelector('.sec[data-key=s1]');
        const a = sec.querySelector('.sec-aside').getBoundingClientRect(), f = sec.querySelector('.sec-files').getBoundingClientRect();
        return { aRight: a.right, fLeft: f.left, aBottom: a.bottom, fTop: f.top, pos: getComputedStyle(sec.querySelector('.aside-in')).position, mainW: document.getElementById('main').clientWidth };
      });
      let page = track(await openPage(browser, big.url));
      const g1 = await geo(page);
      assert(g1.aRight <= g1.fLeft && g1.pos === 'sticky', '1440: ' + JSON.stringify(g1));
      await page.keyboard.press('s');
      const g3 = await geo(page);
      assert(g3.aBottom <= g3.fTop, '1440 split: ' + JSON.stringify(g3));
      await page.keyboard.press('s');
      await sleep(500);
      await page.close();
      page = track(await openPage(browser, big.url, { viewport: { width: 1024, height: 800 } }));
      const g2 = await geo(page);
      assert(g2.aBottom <= g2.fTop, '1024: ' + JSON.stringify(g2));
      await page.close();
      page = track(await openPage(browser, big.url, { viewport: { width: 1920, height: 1080 } }));
      await page.keyboard.press('s');
      const g4 = await geo(page);
      assert(g4.aRight <= g4.fLeft, '1920 split: ' + JSON.stringify(g4));
      await page.keyboard.press('s');
      await sleep(500);
      await page.close();
      return `#main 1440 = ${g1.mainW}px`;
    });

    await check('17 середина viewer.js: шапка главы 5 на 52, заголовок файла на 100, aria-current в оглавлении', async () => {
      const page = track(await openPage(browser, big.url));
      await page.evaluate(() => {
        const f = document.querySelector('.file[data-path="assets/viewer.js"]');
        window.scrollTo(0, f.getBoundingClientRect().top + window.scrollY + 3000);
      });
      await sleep(300);
      const r = await page.evaluate(() => {
        const sec = document.querySelector('.sec[data-key=s5]');
        const f = sec.querySelector('.file[data-path="assets/viewer.js"]');
        return {
          sec: sec.querySelector('.sec-head').getBoundingClientRect().top,
          file: f.querySelector('.file-head').getBoundingClientRect().top,
          tocSec: document.querySelector('#toc .toc-group[data-key=s5] .toc-sec').getAttribute('aria-current'),
          tocFile: document.querySelector('#toc .file-row[data-path="assets/viewer.js"]').getAttribute('aria-current'),
          currents: document.querySelectorAll('#toc [aria-current]').length,
          headCur: f.querySelector('.file-head').classList.contains('is-current'),
        };
      });
      assert(r.sec === 52 && r.file === 100 && r.tocSec === 'true' && r.tocFile === 'true' && r.currents === 2 && r.headCur, JSON.stringify(r));
      await page.close();
    });

    await check('18 клик по файлу в оглавлении ставит заголовок файла на 100±1 (1024/1440/1920)', async () => {
      const out = [];
      for (const width of [1024, 1440, 1920]) {
        for (const reducedMotion of ['reduce', 'no-preference']) {
          const page = track(await openPage(browser, big.url, { viewport: { width, height: 900 }, reducedMotion }));
          for (const p of ['scripts/serve.py', 'assets/viewer.css', 'scripts/collect.py']) {
            if (width === 1024) { await page.keyboard.press('t'); await sleep(250); }
            await page.click(`#toc .file-row[data-path="${p}"]`);
            await sleep(reducedMotion === 'reduce' ? 200 : 1500);
            const top = await page.evaluate((p) => document.querySelector(`.file[data-path="${p}"] .file-head`).getBoundingClientRect().top, p);
            out.push(`${width}/${reducedMotion[0]}/${p.split('/').pop()}=${top}`);
            assert(Math.abs(top - 100) <= 1, out.join(' '));
          }
          await page.close();
        }
      }
      return out.join(' ');
    });

    await check('19 отметка главы 1 и сворачивание файла выше окна не сдвигают главу 2 больше 2px', async () => {
      const fx = await startFixture('mixed');
      try {
        const page = track(await openPage(browser, fx.url));
        const y0 = 300;
        await page.evaluate((y) => { const s = document.querySelector('.sec[data-key=s2]'); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - y); }, y0);
        await sleep(100);
        const top = () => page.evaluate(() => document.querySelector('.sec[data-key=s2] .sec-head').getBoundingClientRect().top);
        const before = await top();
        await page.click('#toc .toc-group[data-key=s1] .toc-status');
        await sleep(100);
        const after = await top();
        assert(Math.abs(after - before) <= 2, `отметка главы: ${before} → ${after}`);
        // Вернуть главу 1 и снова поставить главу 2 на Y — теперь сворачиваем файл главы 1 выше окна.
        // Файл выше окна целиком (его заголовок не закреплён на экране): глава 2 на Y = 120.
        await page.click('#toc .toc-group[data-key=s1] .toc-status');
        await page.evaluate(() => { const s = document.querySelector('.sec[data-key=s2]'); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 120); });
        await sleep(100);
        const t2 = await top();
        await page.evaluate(() => document.querySelector('.sec[data-key=s1] .file[data-path="scripts/collect.py"] .file-toggle').click());
        await sleep(100);
        const t3 = await top();
        assert(Math.abs(t3 - t2) <= 2, `сворачивание файла: ${t2} → ${t3}`);
        await sleep(600);
        await page.close();
        return `${before} → ${after} → ${t2} → ${t3}`;
      } finally { fx.stop(); }
    });

    await check('36 прогресс: без рамки при 0; при 100% — --success и «Всё просмотрено»', async () => {
      const fx = await startFixture('mixed');
      try {
        const page = track(await openPage(browser, fx.url));
        const p0 = await page.evaluate(() => { const p = document.getElementById('progress'); const cs = getComputedStyle(p); return { border: cs.borderTopWidth, bg: cs.backgroundColor, text: p.innerText }; });
        assert(p0.border === '0px' && p0.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(p0));
        for (const key of ['s1', 's2', 's3', 'rest']) await page.click(`#toc .toc-group[data-key=${key}] .toc-status`);
        await sleep(100);
        const p1 = await page.evaluate(() => {
          const p = document.getElementById('progress');
          const probe = document.createElement('div'); probe.style.color = 'var(--success)'; document.body.append(probe);
          const success = getComputedStyle(probe).color; probe.remove();
          return { text: p.innerText.replace(/\s+/g, ' ').trim(), fill: getComputedStyle(p.querySelector('.progress-fill')).backgroundColor, success, title: p.title };
        });
        assert(p1.text === 'Всё просмотрено' && p1.fill === p1.success, JSON.stringify(p1));
        await page.screenshot({ path: path.join(os.tmpdir(), 'dr-progress-100.png'), clip: { x: 700, y: 0, width: 740, height: 52 } });
        await sleep(600);
        await page.close();
        return `${p0.text.replace(/\s+/g, ' ')} → ${p1.text}; ${p1.title}`;
      } finally { fx.stop(); }
    });

    await check('48 производительность big: dr-ready ≤ 300 мс, «Просмотрено» ≤ 50 мс, узел s3 не пересоздан', async () => {
      const runs = [];
      for (let k = 0; k < 3; k++) {
        const fx = await startFixture('big');
        try {
          const page = track(await openPage(browser, fx.url));
          const t = await page.evaluate(() => {
            const res = performance.getEntriesByType('resource').find((e) => e.name.includes('/api/review'));
            return performance.getEntriesByName('dr-ready')[0].startTime - res.responseEnd;
          });
          await page.evaluate(() => { document.querySelector('.sec[data-key=s3]').__probe = 1; });
          const dt = await page.evaluate(() => new Promise((resolve) => {
            const box = document.querySelector('.file[data-path="SKILL.md"] input[data-act=file-viewed]');
            const t0 = performance.now();
            box.click();
            requestAnimationFrame(() => resolve(performance.now() - t0));
          }));
          const probe = await page.evaluate(() => document.querySelector('.sec[data-key=s3]').__probe === 1);
          runs.push({ ready: Math.round(t), viewed: Math.round(dt), probe });
          await sleep(600);
          await page.close();
        } finally { fx.stop(); }
      }
      assert(runs.every((r) => r.ready <= 300 && r.viewed <= 50 && r.probe), JSON.stringify(runs));
      return JSON.stringify(runs);
    });

    await check('4.12 переключение вида и переноса на big ≤ 150 мс (до следующего кадра)', async () => {
      const fx = await startFixture('big');
      try {
        const page = track(await openPage(browser, fx.url, { viewport: { width: 1920, height: 1080 } }));
        const t = [];
        for (const key of ['s', 's', 'w', 'w']) {
          t.push(Math.round(await page.evaluate((key) => new Promise((resolve) => {
            const t0 = performance.now();
            document.dispatchEvent(new KeyboardEvent('keydown', { code: key === 's' ? 'KeyS' : 'KeyW', key, bubbles: true }));
            requestAnimationFrame(() => resolve(performance.now() - t0));
          }), key)));
        }
        await sleep(600);
        await page.close();
        assert(t.every((x) => x <= 150), JSON.stringify(t));
        return `S, S, W, W: ${t.join(', ')} мс`;
      } finally { fx.stop(); }
    });

    await check('4 сетевые запросы только к 127.0.0.1: /, /assets/*, /api/*', async () => {
      const bad = allRequests.flat().filter((u) => { const x = new URL(u); return x.hostname !== '127.0.0.1' || !(x.pathname === '/' || x.pathname.startsWith('/assets/') || x.pathname.startsWith('/api/')); });
      assert(bad.length === 0, bad.join(' '));
      return `${allRequests.flat().length} запросов`;
    });

    await check('1 ошибок консоли и исключений нет во всех сценариях', async () => {
      const errs = allErrors.flat();
      assert(errs.length === 0, errs.join(' | '));
    });
  } finally {
    mixed.stop();
    big.stop();
    await browser.close();
    summary();
  }
})();

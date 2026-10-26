// Раскрытие контекста, «Весь файл», режим «Файлы» и дерево:
// node harness/tests/stage11-13.test.js [фильтр по номеру проверки, например E1,F3]
const { startFixture, launch, openPage, check: rawCheck, summary, assert, sleep } = require('./lib');

const only = (process.argv[2] || '').split(',').filter(Boolean);
const check = (name, fn) => (only.length && !only.includes(name.split(' ')[0]) ? Promise.resolve() : rawCheck(name, fn));

const F = (p) => `.file[data-path="${p}"]`;
const COLLECT = F('scripts/collect.py');
const num = (side, no, file = COLLECT) => `${file} td.num[data-side=${side}][data-no="${no}"]`;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

(async () => {
  const browser = await launch();
  const servers = [];
  const allErrors = [];
  const fresh = async (fx, state) => { const s = await startFixture(fx, state); servers.push(s); return s; };
  const open = async (fx, opts) => { const p = await openPage(browser, fx.url, opts); allErrors.push(p.errors); return p; };
  const toEl = (page, sel, dy = 300) => page.evaluate(([s, d]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - d), [sel, dy]);
  const rowTop = (page, anchor) => page.evaluate((a) => { const el = document.querySelector(`[data-anchor="${a}"]`); return el ? el.getBoundingClientRect().top : null; }, anchor);
  const gapTexts = (page, file) => page.evaluate((f) => [...document.querySelectorAll(`${f} tr.gap`)].map((r) => r.querySelector('.hunk-skip').textContent), file);
  const lnCount = (page, file) => page.evaluate((f) => document.querySelectorAll(`${f} tr.ln`).length, file);
  // Кнопка промежутка: k-й разделитель файла, направление dir. Перед кликом разделитель — в середине экрана.
  const clickGap = async (page, file, k, dir) => {
    const anchor = await page.evaluate(([f, k, dir]) => {
      const gap = document.querySelectorAll(`${f} tr.gap`)[k];
      window.scrollTo(0, gap.getBoundingClientRect().top + scrollY - 450);
      let tr = gap;
      const step = dir === 'up' ? 'nextElementSibling' : 'previousElementSibling';
      do tr = tr[step]; while (tr && !tr.matches('tr.ln'));
      return tr ? tr.dataset.anchor : null;
    }, [file, k, dir]);
    const before = await rowTop(page, anchor);
    await page.click(`${file} tr.gap >> nth=${k} >> .gap-btn[data-dir="${dir}"]`);
    await page.waitForTimeout(250);
    return { anchor, before, after: await rowTop(page, anchor) };
  };
  const waitSaved = () => sleep(700);

  try {
    // ---------- раскрытие контекста ----------

    await check('E1 ↑, ↓ и «Показать N» раскрывают нужные строки, соседняя строка не двигается, ханки сливаются', async () => {
      const page = await open(await fresh('mixed2'));
      const g0 = await gapTexts(page, COLLECT);
      assert(g0.length === 4 && g0[0].includes('30 строк') && g0[3].includes('257 строк до конца'), JSON.stringify(g0));
      const up = await clickGap(page, COLLECT, 0, 'up');
      assert(Math.abs(up.after - up.before) < 1, `↑ сдвинул строку: ${JSON.stringify(up)}`);
      assert(await page.$(num('new', 11)) && !(await page.$(num('new', 10))), '↑ раскрыл не строки 11–30');
      const down = await clickGap(page, COLLECT, 3, 'down');
      assert(Math.abs(down.after - down.before) < 1, `↓ сдвинул строку: ${JSON.stringify(down)}`);
      assert(await page.$(num('new', 94)) && !(await page.$(num('new', 95))), '↓ раскрыл не строки 75–94');
      const hunks0 = await page.evaluate((f) => document.querySelectorAll(`${f} tr.hunk`).length, COLLECT);
      const all = await clickGap(page, COLLECT, 2, 'all');
      assert(Math.abs(all.after - all.before) < 1, `«Показать» сдвинул строку: ${JSON.stringify(all)}`);
      const hunks1 = await page.evaluate((f) => document.querySelectorAll(`${f} tr.hunk`).length, COLLECT);
      assert(hunks1 === hunks0 - 1, `разделителей ${hunks0} → ${hunks1}, ожидалось слияние`);
      const g1 = await gapTexts(page, COLLECT);
      return `разделители: ${g0.length} → ${g1.length}: ${g1.join(' | ')}`;
    });

    await check('E2 курсор N/P и выделение формы переживают раскрытие над ними', async () => {
      const page = await open(await fresh('mixed2'));
      await toEl(page, COLLECT, 120);
      await page.keyboard.press('n'); await page.keyboard.press('n');
      const cur0 = await page.evaluate((f) => [...document.querySelectorAll(`${f} tr.ln.cursor td.num[data-no]`)].map((n) => `${n.dataset.side}${n.dataset.no}`).join(','), COLLECT);
      assert(cur0, 'курсор не встал в collect.py');
      await clickGap(page, COLLECT, 0, 'up');
      const cur1 = await page.evaluate((f) => [...document.querySelectorAll(`${f} tr.ln.cursor td.num[data-no]`)].map((n) => `${n.dataset.side}${n.dataset.no}`).join(','), COLLECT);
      assert(cur0 === cur1, `курсор: ${cur0} → ${cur1}`);
      await toEl(page, num('new', 56));
      await page.click(num('new', 56));
      await page.keyboard.type('про строку');
      await page.click(num('new', 58), { modifiers: ['Shift'] });
      await clickGap(page, COLLECT, 0, 'all'); // после первого ↑ осталось 10 строк — одна кнопка
      const st = await page.evaluate((f) => ({
        sel: [...document.querySelectorAll(`${f} td.num.sel[data-side=new]`)].map((n) => +n.dataset.no),
        text: (document.querySelector('.annot-form textarea') || {}).value,
        title: (document.querySelector('.annot-form .editor-title') || {}).textContent,
      }), COLLECT);
      assert(st.sel.join(',') === '56,57,58' && st.text === 'про строку' && /56–58/.test(st.title), JSON.stringify(st));
      await page.click(num('new', 59), { modifiers: ['Shift'] });
      const t2 = await page.evaluate(() => document.querySelector('.annot-form .editor-title').textContent);
      assert(/56–59/.test(t2), `Shift+клик после раскрытия: ${t2}`);
      return `курсор ${cur1}; форма ${t2}`;
    });

    await check('E3 «Весь файл» и E: все строки, обратно — исходное и раскрытое вручную; добавленный файл без кнопки', async () => {
      const fx = await fresh('mixed2');
      const page = await open(fx);
      const base = await lnCount(page, COLLECT);
      await clickGap(page, COLLECT, 1, 'all');
      const partial = await lnCount(page, COLLECT);
      await page.click(`${COLLECT} .whole-btn`);
      await page.waitForTimeout(200);
      const whole = await lnCount(page, COLLECT);
      const pressed = await page.$eval(`${COLLECT} .whole-btn`, (b) => b.getAttribute('aria-pressed'));
      assert(whole === 336 && pressed === 'true', `весь файл: ${whole} строк, aria-pressed=${pressed}`);
      await toEl(page, num('new', 200), 200);
      await page.mouse.move(5, 500);
      await page.keyboard.press('e');
      await page.waitForTimeout(200);
      const back = await lnCount(page, COLLECT);
      assert(back === partial, `после E: ${back}, ожидалось ${partial} (исходные ${base} + раскрытое)`);
      assert(!(await page.$(`${F('scripts/test_collect.py')} .whole-btn`)), 'у добавленного файла есть «Весь файл»');
      await waitSaved();
      const ex = fx.state().expanded['scripts/collect.py'];
      assert(ex && ex.full === false && ex.ranges.length === 1, JSON.stringify(ex));
      return `${base} → ${partial} → ${whole} → ${back}`;
    });

    await check('E4 комментарий на раскрытой строке: цитата в фидбеке, остаётся после «Весь файл» → выкл. и перезагрузки', async () => {
      const fx = await fresh('mixed2');
      let page = await open(fx);
      await page.click(`${COLLECT} .whole-btn`);
      await page.waitForTimeout(200);
      await toEl(page, num('new', 150));
      await page.click(num('new', 150));
      await page.keyboard.type('строка вне патча');
      await page.click(num('new', 152), { modifiers: ['Shift'] });
      await page.keyboard.press(`${MOD}+Enter`);
      await page.waitForTimeout(150);
      await page.click(`${COLLECT} .whole-btn`);
      await page.waitForTimeout(200);
      const visible = await page.evaluate((f) => [150, 151, 152, 153].map((n) => !!document.querySelector(`${f} td.num[data-side=new][data-no="${n}"]`)), COLLECT);
      assert(visible.join() === 'true,true,true,false', `после выключения «Весь файл»: ${visible}`);
      assert(await page.$(`${COLLECT} .note`), 'карточки комментария нет');
      await waitSaved();
      page = await open(fx);
      assert(await page.$(`${COLLECT} .note`), 'после перезагрузки карточки нет');
      const md = await page.evaluate(() => { document.getElementById('submit-btn').click(); return document.querySelector('dialog#submit .preview').textContent; });
      const line = (await page.evaluate(() => fetch(`/api/full?i=4`, { headers: { 'X-Review-Token': new URLSearchParams(location.search).get('t') } }).then((r) => r.text())))
        .split(/\n@@ [^\n]*\n/)[1].split('\n').filter((l) => /^[ +]/.test(l))[149].slice(1);
      assert(md.includes('строки 150–152') && md.includes(` ${line}`), `в фидбеке нет цитаты строки 150 «${line}»:\n${md.slice(0, 600)}`);
      return 'цитата есть';
    });

    await check('E5 файл в 10 тысяч строк: «Весь файл» быстрее 1 с, после перезагрузки не свёрнут как большой', async () => {
      const fx = await fresh('large');
      let page = await open(fx);
      const BIG = F('src/big.js');
      const ms = await page.evaluate(async (f) => {
        const t0 = performance.now();
        document.querySelector(`${f} .whole-btn`).click();
        while (document.querySelectorAll(`${f} tr.ln`).length < 10000) await new Promise((r) => setTimeout(r, 5));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t0;
      }, BIG);
      assert(ms < 1000, `«Весь файл» ${ms.toFixed(0)} мс`);
      await waitSaved();
      page = await open(fx);
      const st = await page.evaluate((f) => [document.querySelector(f).classList.contains('collapsed'), document.querySelectorAll(`${f} tr.ln`).length], BIG);
      assert(!st[0] && st[1] > 10000, JSON.stringify(st));
      return `${ms.toFixed(0)} мс, строк ${st[1]}`;
    });

    await check('E6 старое ревью без full.patch: кнопок раскрытия нет, «Весь файл» выключен с причиной, E — подсказка', async () => {
      const page = await open(await fresh('mixed'));
      const st = await page.evaluate((f) => ({
        gaps: document.querySelectorAll('tr.gap').length,
        btn: document.querySelector(`${f} .whole-btn`).disabled,
        title: document.querySelector(`${f} .whole-btn`).title,
      }), COLLECT);
      assert(st.gaps === 0 && st.btn && /старой версией/.test(st.title), JSON.stringify(st));
      await toEl(page, COLLECT, 120);
      await page.keyboard.press('j');
      await page.keyboard.press('e');
      const toast = await page.textContent('#toast');
      assert(/старой версией|Полный текст/.test(toast), `тост: ${toast}`);
      return st.title;
    });

    // ---------- режимы ----------

    await check('F1 G сохраняет файл и строку под шапкой; режим переживает перезагрузку; новое ревью — «Гайд»', async () => {
      const fx = await fresh('mixed2');
      let page = await open(fx);
      assert(!(await page.evaluate(() => document.documentElement.classList.contains('mode-files'))), 'новое ревью открылось не в «Гайде»');
      await toEl(page, num('new', 56), 400);
      // Режим держит первую строку под закреплёнными заголовками (шапка + глава + файл = 140px в «Гайде»).
      const pick = () => page.evaluate(() => {
        const y = 52 + 48 + 40;
        const row = [...document.querySelectorAll('tr.ln')].find((r) => r.getBoundingClientRect().top >= y);
        const n = row.querySelector('td.num[data-no]');
        return { key: `${row.closest('.file').dataset.path}:${n.dataset.side}${n.dataset.no}`, top: row.getBoundingClientRect().top };
      });
      const where = (key) => page.evaluate((k) => {
        const [path, sn] = [k.slice(0, k.lastIndexOf(':')), k.slice(k.lastIndexOf(':') + 1)];
        const n = document.querySelector(`.file[data-path="${path}"] td.num[data-side="${sn.startsWith('new') ? 'new' : 'old'}"][data-no="${sn.replace(/\D/g, '')}"]`);
        return n ? n.closest('tr').getBoundingClientRect().top : null;
      }, key);
      const a = await pick();
      await page.keyboard.press('g');
      await page.waitForTimeout(300);
      const b = await where(a.key);
      const files = await page.evaluate(() => document.documentElement.classList.contains('mode-files'));
      assert(files && b != null && Math.abs(b - a.top) < 2, `в «Файлах» строка ${a.key}: ${a.top} → ${b}`);
      await page.keyboard.press('g');
      await page.waitForTimeout(300);
      const c = await where(a.key);
      assert(c != null && Math.abs(c - a.top) < 2, `обратно в «Гайде»: ${a.top} → ${c}`);
      await page.keyboard.press('g');
      await waitSaved();
      page = await open(fx);
      assert(await page.evaluate(() => document.documentElement.classList.contains('mode-files') && !!document.querySelector('#toc .tree')), 'после перезагрузки не «Файлы»');
      return `${a.key}: ${a.top.toFixed(0)} → ${b.toFixed(0)} → ${c.toFixed(0)}`;
    });

    await check('F2 в «Файлах» работают V, J/K, N/P, O; клавиши глав дают подсказку и ничего не меняют', async () => {
      const fx = await fresh('mixed2', { mode: 'files' });
      const page = await open(fx);
      await page.keyboard.press('j');
      // У самого верха текущий — первый файл (как и в «Гайде»), J ведёт ко второму.
      const first = await page.evaluate(() => document.querySelector('.file-head.is-current').closest('.file').dataset.path);
      assert(first === 'assets/viewer.html', `J → ${first}`);
      await page.keyboard.press('j'); await page.keyboard.press('j');
      const cur = await page.evaluate(() => document.querySelector('.file-head.is-current').closest('.file').dataset.path);
      assert(cur === 'scripts/collect.py', `J×4 → ${cur}`);
      await page.keyboard.press('v');
      await page.waitForTimeout(150);
      const viewed = await page.evaluate(() => [document.querySelector('.file[data-path="scripts/collect.py"]').classList.contains('is-viewed'), document.querySelector('#toc .tree-file[data-path="scripts/collect.py"]').classList.contains('viewed'), document.querySelector('.tree-progress').textContent]);
      assert(viewed[0] && viewed[1] && viewed[2] === '1 / 7', JSON.stringify(viewed));
      await page.keyboard.press('Shift+V');
      const toast = await page.textContent('#toast');
      await waitSaved();
      const reviewed = Object.values(fx.state().reviewed || {}).filter(Boolean).length;
      assert(/режиме «Гайд»/.test(toast), `Shift+V: ${toast}`);
      await page.keyboard.press('n');
      const curN = await page.evaluate(() => { const r = document.querySelector('tr.ln.cursor'); return r && r.closest('.file').dataset.path; });
      assert(curN, 'N не поставил курсор');
      return `глав отмечено: ${reviewed}; N → ${curN}`;
    });

    // ---------- дерево ----------

    await check('T1 дерево: каталоги раньше файлов, сжатие цепочек, порядок с числами, счётчики', async () => {
      const page = await open(await fresh('tree', { mode: 'files' }));
      const rows = await page.evaluate(() => [...document.querySelectorAll('#toc .tree-row')].map((r) => `${r.getAttribute('aria-level')}:${r.classList.contains('tree-dir') ? r.querySelector('.tree-name').textContent : r.querySelector('.fr-base').textContent}`));
      const want = ['1:docs/guide/', '2:intro.md', '2:setup.md', '1:packages/app/src/main/', '2:index.js', '1:src/', '2:core/', '3:util/', '4:math.js', '4:text.js', '3:engine.js', '2:ui/', '3:button.js', '3:panel.js', '1:file2.txt', '1:file10.txt', '1:README.md'];
      assert(JSON.stringify(rows) === JSON.stringify(want), JSON.stringify(rows));
      const order = await page.evaluate(() => [...document.querySelectorAll('#main .sec.headless > .file')].map((f) => f.dataset.path.split('/').pop()));
      assert(order.join(',') === 'intro.md,setup.md,index.js,math.js,text.js,engine.js,button.js,panel.js,file2.txt,file10.txt,README.md', `порядок в колонке: ${order}`);
      return `${rows.length} строк`;
    });

    await check('T2 дерево с клавиатуры: стрелки, ←/→ сворачивают каталог, Enter открывает файл, состояние сохраняется', async () => {
      const fx = await fresh('tree', { mode: 'files' });
      const page = await open(fx);
      await page.focus('#tree-filter');
      await page.keyboard.press('ArrowDown');
      const f1 = await page.evaluate(() => document.activeElement.dataset.tkey);
      assert(f1 === 'd:docs/guide', `первый элемент: ${f1}`);
      await page.keyboard.press('ArrowLeft');
      const collapsed = await page.evaluate(() => [document.activeElement.getAttribute('aria-expanded'), document.querySelectorAll('#toc .tree-row').length]);
      assert(collapsed[0] === 'false' && collapsed[1] === 15, JSON.stringify(collapsed));
      for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowDown'); // packages/…, index.js, src/
      await page.keyboard.press('ArrowRight'); // src/ раскрыт — фокус на первого ребёнка
      const at = await page.evaluate(() => document.activeElement.dataset.tkey);
      assert(at === 'd:src/core', `→ на раскрытом каталоге ведёт внутрь: ${at}`);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      const cur = await page.evaluate(() => { const h = document.querySelector('.file-head.is-current'); return h && h.closest('.file').dataset.path; });
      assert(cur === 'README.md', `Enter на последнем: ${cur}`);
      await waitSaved();
      assert(fx.state().treeCollapsed['docs/guide'] === true, JSON.stringify(fx.state().treeCollapsed));
      return 'ok';
    });

    await check('T3 фильтр и «Скрыть просмотренные»: дерево и колонка, J/K по видимым, сброс, «/» из «Гайда»', async () => {
      const fx = await fresh('tree');
      const page = await open(fx);
      await page.keyboard.press('Slash');
      await page.waitForTimeout(200);
      const st0 = await page.evaluate(() => [document.documentElement.classList.contains('mode-files'), document.activeElement.id]);
      assert(st0[0] && st0[1] === 'tree-filter', `/ из «Гайда»: ${st0}`);
      await page.keyboard.type('src/ui');
      await page.waitForTimeout(150);
      const vis = await page.evaluate(() => [...document.querySelectorAll('#main .sec.headless > .file:not([hidden])')].map((f) => f.dataset.path));
      const tree = await page.evaluate(() => [...document.querySelectorAll('#toc .tree-file')].map((f) => f.dataset.path));
      assert(vis.join() === 'src/ui/button.js,src/ui/panel.js' && tree.join() === vis.join(), `${vis} / ${tree}`);
      await page.keyboard.press('Escape'); // очищает
      await page.keyboard.press('Escape'); // снимает фокус
      await page.keyboard.type('ui');      // не в поле — ничего
      assert((await page.inputValue('#tree-filter')) === '', 'Esc не очистил фильтр');
      await page.fill('#tree-filter', 'core');
      await page.waitForTimeout(150);
      await page.evaluate(() => document.activeElement.blur());
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.keyboard.press('j'); await page.keyboard.press('j'); await page.keyboard.press('j');
      const cur = await page.evaluate(() => document.querySelector('.file-head.is-current').closest('.file').dataset.path);
      assert(cur === 'src/core/engine.js', `J×3 по видимым: ${cur}`);
      await page.click('.filter-status button');
      await page.waitForTimeout(150);
      const all = await page.evaluate(() => document.querySelectorAll('#main .sec.headless > .file:not([hidden])').length);
      assert(all === 11, `после «Сбросить фильтр»: ${all}`);
      await page.keyboard.press('v');
      await page.check('#tree-hide-viewed');
      await page.waitForTimeout(150);
      const hidden = await page.evaluate(() => [document.querySelectorAll('#main .sec.headless > .file[hidden]').length, document.querySelector('.filter-status').textContent]);
      assert(hidden[0] === 1 && /10 из 11/.test(hidden[1]), JSON.stringify(hidden));
      await waitSaved();
      assert(fx.state().hideViewed === true, 'hideViewed не сохранён');
      return hidden[1];
    });

    await check('T4 ширина дерева: перетаскивание, клавиши, пределы, сохраняется', async () => {
      const fx = await fresh('tree', { mode: 'files' });
      let page = await open(fx);
      const box = await page.$eval('.tree-resize', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 }; });
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      await page.mouse.move(box.x + 80, box.y, { steps: 5 });
      await page.mouse.up();
      const w1 = await page.$eval('#toc', (t) => t.getBoundingClientRect().width);
      await page.focus('.tree-resize');
      for (let k = 0; k < 20; k++) await page.keyboard.press('ArrowRight');
      const w2 = await page.$eval('#toc', (t) => t.getBoundingClientRect().width);
      await waitSaved();
      page = await open(fx);
      const w3 = await page.$eval('#toc', (t) => t.getBoundingClientRect().width);
      assert(Math.abs(w1 - 380) < 3 && w2 === 480 && w3 === 480, `ширина ${w1} → ${w2} → ${w3}`);
      return `${w1} → ${w2} → ${w3}`;
    });

    await check('T5 Z / Shift+Z сворачивают и разворачивают все файлы (и в «Гайде»)', async () => {
      const fx = await fresh('tree', { mode: 'files' });
      const page = await open(fx);
      await page.keyboard.press('z');
      const c1 = await page.evaluate(() => document.querySelectorAll('#main .file.collapsed').length);
      await page.keyboard.press('Shift+Z');
      const c2 = await page.evaluate(() => document.querySelectorAll('#main .file.collapsed').length);
      await page.keyboard.press('g');
      await page.keyboard.press('z');
      const c3 = await page.evaluate(() => document.querySelectorAll('#main .file.collapsed').length);
      assert(c1 === 11 && c2 === 0 && c3 === 11, `${c1}/${c2}/${c3}`);
      return `${c1}/${c2}/${c3}`;
    });

    await check('T6 чип главы в «Файлах» открывает этот файл в «Гайде»; справка по режиму', async () => {
      const page = await open(await fresh('tree', { mode: 'files' }));
      await page.keyboard.press('Shift+Slash');
      const filesHelp = await page.evaluate(() => document.querySelector('dialog#help').textContent);
      await page.keyboard.press('Escape');
      assert(!filesHelp.includes('Отметить главу') && filesHelp.includes('Фильтр файлов'), 'справка «Файлов» показывает клавиши глав');
      await toEl(page, F('src/ui/panel.js'), 200);
      await page.click(`${F('src/ui/panel.js')} .sec-chip`);
      await page.waitForTimeout(400);
      const st = await page.evaluate(() => [document.documentElement.classList.contains('mode-files'), document.querySelector('.file-head.is-current').closest('.file').dataset.path, document.querySelector('.file-head.is-current').closest('.sec').dataset.key]);
      assert(!st[0] && st[1] === 'src/ui/panel.js' && st[2] === 's1', JSON.stringify(st));
      return st.join(' ');
    });
  } finally {
    for (const s of servers) s.stop();
    await browser.close();
  }
  const errors = allErrors.flat();
  await rawCheck('X0 ошибок в консоли нет', async () => { assert(!errors.length, errors.join('\n')); });
  summary();
})();

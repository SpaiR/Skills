// Критерии раздела 6 для шагов 7–10 (комментарии, «просмотрено», клавиатура, отправка):
// node harness/tests/stage7-10.test.js [фильтр по номеру критерия, например 24,25]
const fs = require('node:fs');
const path = require('node:path');
const { startFixture, launch, openPage, check: rawCheck, summary, assert, sleep, ROOT } = require('./lib');

const only = (process.argv[2] || '').split(',').filter(Boolean);
const check = (name, fn) => (only.length && !only.includes(name.split(' ')[0]) ? Promise.resolve() : rawCheck(name, fn));

const F = (p) => `.file[data-path="${p}"]`;
const COLLECT = F('scripts/collect.py');
const num = (side, no, file = COLLECT) => `${file} td.num[data-side=${side}][data-no="${no}"]`;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// Golden feedback.md: produced by the v1 buildMarkdown on the same fixture and state.
const GOLDEN = path.join(ROOT, 'tests/fixtures/mixed/feedback.golden.md');

(async () => {
  const browser = await launch();
  const shared = await startFixture('mixed');
  const big = await startFixture('big');
  const allErrors = [];
  const servers = [];
  const fresh = async (fx, state) => { const s = await startFixture(fx, state); servers.push(s); return s; };
  const track = (page) => { allErrors.push(page.errors); return page; };
  const open = async (fx, opts) => track(await openPage(browser, fx.url, opts));
  const formText = (page) => page.evaluate(() => { const t = document.querySelector('.annot-form textarea'); return t ? t.value : null; });
  const formTitle = (page) => page.evaluate(() => { const t = document.querySelector('.annot-form .editor-title'); return t ? t.textContent : null; });
  const toFile = (page, sel, dy = 100) => page.evaluate(([s, d]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - d), [sel, dy]);
  const current = (page) => page.evaluate(() => {
    const f = document.querySelector('#toc .file-row[aria-current="true"]');
    const s = document.querySelector('#toc .toc-sec[aria-current="true"]');
    return { file: f && f.dataset.path, sec: s && s.closest('.toc-group').dataset.key };
  });

  try {
    // ---------- комментарии ----------

    await check('24 текст формы переживает сворачивание файла, S×2 и отметку главы 2; черновик в state.json', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx);
      await toFile(page, COLLECT);
      await page.click(num('new', 54));
      await page.keyboard.type('тест');
      const steps = [];
      const ensure = async (label) => {
        await sleep(600);
        const inForm = await formText(page);
        const inRow = await page.evaluate(() => [...document.querySelectorAll('.draft-row')].map((r) => r.textContent).join('|'));
        const st = fx.state();
        const onDisk = Object.values(st.drafts || {}).some((d) => d.text === 'тест');
        assert(inForm === 'тест' || inRow.includes('тест'), `${label}: форма=${inForm}, черновики=${inRow}`);
        assert(onDisk, `${label}: в state.json нет черновика: ${JSON.stringify(st.drafts)}`);
        steps.push(`${label}: ${inForm === 'тест' ? 'форма' : 'черновик'}`);
      };
      await ensure('ввод');
      const other = `${F('scripts/validate.py')} .file-toggle`;
      await page.click(other);
      await ensure('свернуть другой');
      await page.click(other);
      await ensure('развернуть другой');
      await page.keyboard.press('s');
      await ensure('S');
      await page.keyboard.press('s');
      await ensure('S снова');
      await page.click('#toc .toc-group[data-key=s2] .toc-status');
      await ensure('отметить главу 2');
      await page.click('#toc .toc-group[data-key=s2] .toc-status');
      await ensure('снять главу 2');
      await page.close();
      return steps.join(', ');
    });

    await check('25 после перезагрузки есть .draft-row, «Продолжить» открывает форму с текстом', async () => {
      const fx = await fresh('mixed', { version: 1, drafts: { 'scripts/collect.py|new|54|54': { file: 'scripts/collect.py', side: 'new', start: 54, end: 54, text: 'тест', suggestion: '' } } });
      const page = await open(fx);
      // Сначала тот же путь, что в 24: черновик, созданный вводом, переживает перезагрузку.
      await toFile(page, COLLECT);
      await page.click(num('new', 56));
      await page.keyboard.type('второй');
      await sleep(600);
      await page.reload();
      await page.waitForFunction(() => performance.getEntriesByName('dr-ready').length > 0);
      const rows = await page.$$eval('.draft-row', (els) => els.map((e) => e.textContent));
      assert(rows.some((t) => t.includes('тест')) && rows.some((t) => t.includes('второй')), JSON.stringify(rows));
      await page.click(`${COLLECT} .draft-row[data-key="scripts/collect.py|new|54|54"] [data-act=draft-continue]`);
      const v = await formText(page);
      assert(v === 'тест', `в форме: ${v}`);
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.matches('.annot-form textarea'));
      assert(focused, 'фокус не в поле');
      await page.close();
      return rows.join(' | ');
    });

    await check('26 клик по другой строке: первый текст — черновик с .has-draft, новая форма пустая', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx);
      await toFile(page, COLLECT);
      await page.click(num('new', 54));
      await page.keyboard.type('первый');
      await page.click(num('new', 35));
      const r = await page.evaluate(() => {
        const f = document.querySelector('.file[data-path="scripts/collect.py"]');
        return {
          draft: [...f.querySelectorAll('.draft-row')].map((e) => e.textContent).join('|'),
          mark: f.querySelector('td.num[data-side=new][data-no="54"]').classList.contains('has-draft'),
          form: f.querySelector('.annot-form textarea').value,
          title: f.querySelector('.annot-form .editor-title').textContent,
          img: getComputedStyle(f.querySelector('td.num[data-side=new][data-no="54"]')).backgroundImage,
        };
      });
      assert(r.draft.includes('первый') && r.mark && r.form === '' && r.title.startsWith('Строка 35'), JSON.stringify(r));
      assert(/repeating-linear-gradient/.test(r.img), `пунктир: ${r.img}`);
      await page.close();
      return r.draft;
    });

    await check('27 клик по старому 53 (del), Shift-клик по новому 56: «Строки 53–55 · старая версия»', async () => {
      const page = await open(shared);
      await toFile(page, COLLECT);
      await page.click(num('old', 53));
      await page.click(num('new', 56), { modifiers: ['Shift'] });
      const title = await formTitle(page);
      const sel = await page.$$eval(`${COLLECT} td.num.sel`, (els) => els.map((e) => `${e.dataset.side}${e.dataset.no}`));
      assert(title === 'Строки 53–55 · старая версия', title);
      assert(sel.join() === 'old53,old54,old55', sel.join());
      // То же протягиванием: от старого 53 до нового 56.
      await page.keyboard.press('Escape');
      const a = await page.locator(num('old', 53)).boundingBox();
      const b = await page.locator(num('new', 56)).boundingBox();
      await page.mouse.move(a.x + 5, a.y + 5);
      await page.mouse.down();
      await page.mouse.move(b.x + 5, b.y + 5, { steps: 6 });
      const during = await page.$$eval(`${COLLECT} td.num.sel`, (els) => els.length);
      await page.mouse.up();
      const title2 = await formTitle(page);
      assert(during === 3 && title2 === 'Строки 53–55 · старая версия', `${during} ${title2}`);
      // В «Рядом» data-i — индекс пары, правило то же.
      await page.keyboard.press('Escape');
      await page.keyboard.press('s');
      await page.click(num('old', 53));
      await page.click(num('new', 56), { modifiers: ['Shift'] });
      const title3 = await formTitle(page);
      await page.keyboard.press('Escape');
      await page.keyboard.press('s');
      assert(title3 === 'Строки 53–55 · старая версия', `Рядом: ${title3}`);
      await page.close();
      return `${title}; протягивание: ${title2}; «Рядом»: ${title3}`;
    });

    await check('28 клик по старому номеру строки контекста — «новая версия»', async () => {
      const page = await open(shared);
      await toFile(page, COLLECT);
      await page.click(num('old', 56)); // ctx: старая 56 = новая 59
      const title = await formTitle(page);
      assert(title === 'Строка 59 · новая версия', title);
      await page.keyboard.press('Escape');
      await page.close();
      return title;
    });

    await check('29 после сохранения 54–58 — .has-note у новых 54–58; у выделенной add фон --add-line и оверлей', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx);
      await toFile(page, COLLECT);
      await page.click(num('new', 54));
      await page.click(num('new', 58), { modifiers: ['Shift'] });
      await page.keyboard.type('Почему так?');
      await page.keyboard.press(`${MOD}+Enter`);
      const marks = await page.$$eval(`${COLLECT} td.num.has-note`, (els) => els.map((e) => `${e.dataset.side}${e.dataset.no}`));
      assert(marks.join() === 'new54,new55,new56,new57,new58', marks.join());
      await page.click(num('new', 55));
      const r = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--add-line');
        document.body.append(probe);
        const want = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const tdc = document.querySelector('.file[data-path="scripts/collect.py"] tr.ln.sel td.code');
        const cs = getComputedStyle(tdc);
        return { want, bg: cs.backgroundColor, img: cs.backgroundImage, t: tdc.parentElement.dataset.t };
      });
      assert(r.t === 'add' && r.bg === r.want && /linear-gradient/.test(r.img), JSON.stringify(r));
      await page.keyboard.press('Escape');
      await page.close();
      return `${marks.join()}; ${r.bg}; ${r.img.slice(0, 40)}`;
    });

    await check('30 hover строки — .cmt-btn opacity 1; клик открывает форму на строке', async () => {
      const page = await open(shared);
      await toFile(page, COLLECT);
      const row = page.locator(`${COLLECT} tr.ln`).filter({ has: page.locator('td.num[data-side=new][data-no="57"]') });
      const btn = page.locator(`${num('new', 57)} .cmt-btn`);
      const before = await btn.evaluate((b) => getComputedStyle(b).opacity);
      await row.locator('td.code').hover();
      await sleep(200);
      const after = await btn.evaluate((b) => getComputedStyle(b).opacity);
      assert(before === '0' && after === '1', `${before} → ${after}`);
      await btn.click();
      const title = await formTitle(page);
      assert(title === 'Строка 57 · новая версия', title);
      const del = await page.$eval(`${num('old', 54)}`, (td) => !!td.querySelector('.cmt-btn'));
      const ctxOld = await page.$eval(`${num('old', 56)}`, (td) => !!td.querySelector('.cmt-btn'));
      assert(del && !ctxOld, `кнопка у del: ${del}, у старого номера контекста: ${ctxOld}`);
      await page.keyboard.press('Escape');
      await page.close();
      return title;
    });

    await check('31 «Удалить» — тост с «Вернуть»; нажатие восстанавливает тот же id на том же месте', async () => {
      const notes = [
        { id: 'aaa', file: 'scripts/collect.py', side: 'new', start: 34, end: 34, text: 'первый', suggestion: '' },
        { id: 'bbb', file: 'scripts/collect.py', side: 'new', start: 54, end: 55, text: 'второй', suggestion: '' },
        { id: 'ccc', file: 'scripts/validate.py', side: 'new', start: 16, end: 16, text: 'третий', suggestion: '' },
      ];
      const fx = await fresh('mixed', { version: 1, annotations: notes });
      const page = await open(fx);
      await toFile(page, COLLECT);
      const note = page.locator(`${COLLECT} .note[data-id=bbb]`);
      await note.hover();
      await note.locator('[data-act=note-delete]').click();
      const t = await page.evaluate(() => { const el = document.getElementById('toast'); return { cls: el.className, text: el.textContent, gone: !document.querySelector('.note[data-id=bbb]') }; });
      assert(t.cls.includes('show') && t.text.includes('Комментарий удалён') && t.text.includes('Вернуть') && t.gone, JSON.stringify(t));
      await sleep(600);
      assert(fx.state().annotations.map((a) => a.id).join() === 'aaa,ccc', 'не удалён в state');
      await page.click('#toast .toast-btn');
      await sleep(600);
      const ids = fx.state().annotations.map((a) => a.id).join();
      const back = await page.$$eval('.note[data-id]', (els) => els.map((e) => e.dataset.id).join());
      assert(ids === 'aaa,bbb,ccc' && back.includes('bbb'), `${ids} / ${back}`);
      await page.close();
      return ids;
    });

    await check('32 «Предложить правку» заполняет поле исходными строками; карточка — «Предложенная правка» с − и +', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx);
      await toFile(page, COLLECT);
      await page.click(num('new', 57));
      await page.click(num('new', 58), { modifiers: ['Shift'] });
      await page.keyboard.type('Можно короче');
      await page.click(`${COLLECT} .sug-toggle`);
      const filled = await page.$eval(`${COLLECT} .annot-form textarea.mono`, (t) => t.value);
      assert(filled === '        return None\n    return res.stdout.decode().strip() or None', JSON.stringify(filled));
      // Tab в поле правки вставляет два пробела, Shift+Tab убирает.
      await page.keyboard.press('End');
      await page.keyboard.press('Tab');
      const tabbed = await page.$eval(`${COLLECT} .annot-form textarea.mono`, (t) => t.value);
      await page.keyboard.press('Shift+Tab');
      const untabbed = await page.$eval(`${COLLECT} .annot-form textarea.mono`, (t) => t.value);
      assert(tabbed.endsWith('None  ') && untabbed === tabbed.replace(/\n {2}/, '\n'), JSON.stringify([tabbed, untabbed]));
      await page.$eval(`${COLLECT} .annot-form textarea.mono`, (t) => { t.value = '    return None'; t.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.click(`${COLLECT} .annot-form .btn.primary`);
      await page.locator(`${COLLECT} .note .suggestion`).scrollIntoViewIfNeeded();
      const card = await page.evaluate(() => {
        const s = document.querySelector('.file[data-path="scripts/collect.py"] .note .suggestion');
        return s && { head: s.querySelector('.suggestion-head').innerText, signs: [...s.querySelectorAll('.sg-sign')].map((x) => x.textContent).join('') };
      });
      assert(card && card.head === 'Предложенная правка' && card.signs === '−−+', JSON.stringify(card));
      await page.close();
      return JSON.stringify(card);
    });

    // ---------- просмотрено ----------

    await check('33 V на текущем файле: хеш в state, «Просмотрен», счётчик +1, строка оглавления opacity .6', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx);
      await page.keyboard.press('j');
      await sleep(300);
      const cur = await current(page);
      const before = await page.$eval('.progress-num', (e) => e.textContent);
      await page.keyboard.press('v');
      await sleep(600);
      const st = fx.state();
      const hash = st.filesViewed[cur.file];
      const r = await page.evaluate((p) => ({
        note: document.querySelector(`.file[data-path="${p}"] .collapsed-note`)?.textContent,
        progress: document.querySelector('.progress-num').textContent,
        opacity: getComputedStyle(document.querySelector(`#toc .file-row[data-path="${p}"]`)).opacity,
      }), cur.file);
      assert(/^[0-9a-f]{8}$/.test(hash || ''), `хеш: ${hash}`);
      assert(r.note && r.note.startsWith('Просмотрен'), JSON.stringify(r));
      assert(+before.split('/')[0] + 1 === +r.progress.split('/')[0], `${before} → ${r.progress}`);
      assert(r.opacity === '0.6', r.opacity);
      const after = await current(page);
      assert(after.file === cur.file, `текущий файл перескочил: ${cur.file} → ${after.file}`);
      await page.close();
      return `${cur.file}: ${hash}; ${before} → ${r.progress}`;
    });

    await check('34 глава 2: оба файла отмечены — reviewed.s2, глава свёрнута, статус залит; снятие одного — false', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx);
      for (const p of ['scripts/validate.py', 'scripts/test_collect.py']) await page.click(`.sec[data-key=s2] ${F(p)} input[data-act=file-viewed]`);
      await sleep(600);
      const r = await page.evaluate(() => ({
        collapsed: document.querySelector('.sec[data-key=s2]').classList.contains('collapsed'),
        status: document.querySelector('#toc .toc-group[data-key=s2] .toc-status').className,
      }));
      assert(fx.state().reviewed.s2 === true && r.collapsed && r.status.includes('full'), JSON.stringify([fx.state().reviewed, r]));
      await page.click('.sec[data-key=s2] .sec-toggle');
      await page.click(`.sec[data-key=s2] ${F('scripts/validate.py')} input[data-act=file-viewed]`);
      await sleep(600);
      const st = fx.state();
      const half = await page.$eval('#toc .toc-group[data-key=s2] .toc-status', (e) => e.className);
      assert(st.reviewed.s2 === false && half.includes('half'), JSON.stringify([st.reviewed, half]));
      await page.close();
      return `статус: ${r.status} → ${half}`;
    });

    await check('35 состояние без filesViewed, reviewed.s1 = true — файлы главы 1 просмотрены', async () => {
      const fx = await fresh('mixed', { version: 1, reviewed: { s1: true } });
      const page = await open(fx);
      const r = await page.evaluate(() => ({
        count: document.querySelector('#toc .toc-group[data-key=s1] .toc-count').textContent,
        progress: document.querySelector('.progress-num').textContent,
        status: document.querySelector('#toc .toc-group[data-key=s1] .toc-status').className,
      }));
      assert(r.count === '1/1' && r.progress.startsWith('1 /') && r.status.includes('full'), JSON.stringify(r));
      await page.close();
      return JSON.stringify(r);
    });

    // ---------- клавиатура ----------

    await check('20 keydown code=KeyJ, key=«о» (русская раскладка) — текущий файл следующий', async () => {
      const page = await open(shared);
      const before = await current(page);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'о', bubbles: true })));
      await sleep(300);
      const after = await current(page);
      const order = await page.$$eval('.sec:not(.collapsed) .file', (els) => els.map((e) => e.dataset.path));
      assert(order.indexOf(after.file) === order.indexOf(before.file) + 1, `${before.file} → ${after.file}`);
      await page.close();
      return `${before.file} → ${after.file}`;
    });

    await check('21 эффект каждой клавиши из таблицы 4.3', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx);
      const out = [];
      const press = async (k) => { await page.keyboard.press(k); await sleep(250); };
      // J/K
      const c0 = await current(page);
      await press('j'); const c1 = await current(page);
      await press('j'); const c2 = await current(page);
      await press('k'); const c3 = await current(page);
      assert(c1.file !== c0.file && c2.file !== c1.file && c3.file === c1.file, JSON.stringify([c0, c1, c2, c3]));
      out.push('J/K');
      // ]/[
      await press(']'); const s1 = await current(page);
      await press(']'); const s2 = await current(page);
      await press('['); const s3 = await current(page);
      assert(s2.sec !== s1.sec && s3.sec === s1.sec, JSON.stringify([s1, s2, s3]));
      out.push(']/[');
      // N/P
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(100);
      await press('n');
      const n1 = await page.$$eval('tr.ln.cursor', (els) => els.map((e) => e.closest('.file').dataset.path + ':' + e.dataset.i));
      await press('n');
      const n2 = await page.$$eval('tr.ln.cursor', (els) => els.map((e) => e.closest('.file').dataset.path + ':' + e.dataset.i));
      await press('p');
      const n3 = await page.$$eval('tr.ln.cursor', (els) => els.map((e) => e.closest('.file').dataset.path + ':' + e.dataset.i));
      assert(n1.length && n2.length && n1.join() !== n2.join() && n3.join() === n1.join(), JSON.stringify([n1, n2, n3]));
      const curTop = await page.$eval('tr.ln.cursor', (e) => e.getBoundingClientRect().top);
      out.push(`N/P (${n1.join()} → ${n2.join()}, верх ${Math.round(curTop)})`);
      // C
      await press('c');
      const ct = await formTitle(page);
      assert(ct && /новая версия|старая версия/.test(ct), `C: ${ct}`);
      await page.keyboard.press('Escape');
      out.push(`C (${ct})`);
      // Esc снимает курсор после формы
      await press('Escape');
      assert(await page.$$eval('tr.ln.cursor', (e) => e.length) === 0, 'курсор не снят');
      out.push('Esc');
      // V
      await page.evaluate(() => window.scrollTo(0, 0));
      await press('j');
      const cv = await current(page);
      await press('v');
      await sleep(500);
      assert(/^[0-9a-f]{8}$/.test(fx.state().filesViewed[cv.file] || ''), 'V: нет хеша');
      out.push('V');
      // Shift+V
      const secKey = (await current(page)).sec;
      const rv0 = !!fx.state().reviewed[secKey];
      await press('Shift+V');
      await sleep(500);
      assert(!!fx.state().reviewed[secKey] !== rv0, `Shift+V: ${secKey} ${rv0}`);
      await press('Shift+V');
      out.push('Shift+V');
      // O и Shift+O
      await page.evaluate(() => window.scrollTo(0, 0));
      await press('j');
      const co = await current(page);
      const exp = () => page.$eval(`.sec[data-key="${co.sec}"] ${F(co.file)} .file-toggle`, (b) => b.getAttribute('aria-expanded'));
      const e0 = await exp(); await press('o'); const e1 = await exp(); await press('o'); const e2 = await exp();
      assert(e0 !== e1 && e2 === e0, `O: ${e0} ${e1} ${e2}`);
      const sexp = () => page.$eval(`.sec[data-key="${co.sec}"] .sec-toggle`, (b) => b.getAttribute('aria-expanded'));
      const x0 = await sexp(); await press('Shift+O'); const x1 = await sexp(); await press('Shift+O'); const x2 = await sexp();
      assert(x0 !== x1 && x2 === x0, `Shift+O: ${x0} ${x1} ${x2}`);
      out.push('O, Shift+O');
      // Shift+C
      await press('Shift+C');
      const sc = await page.evaluate(() => document.activeElement && document.activeElement.closest('.sec-comment') && document.activeElement.tagName);
      assert(sc === 'TEXTAREA', `Shift+C: ${sc}`);
      await page.keyboard.press('Escape');
      out.push('Shift+C');
      // S, W, T
      const cls = () => page.evaluate(() => document.body.className);
      const b0 = await cls(); await press('s'); const b1 = await cls(); await press('s');
      assert(!b0.includes('view-split') && b1.includes('view-split'), `S: ${b0} / ${b1}`);
      await press('w'); const b2 = await cls(); await press('w');
      assert(b2.includes('nowrap'), `W: ${b2}`);
      await press('t'); const b3 = await cls(); await press('t'); const b4 = await cls();
      assert(b3.includes('toc-hidden') && !b4.includes('toc-hidden'), `T: ${b3} / ${b4}`);
      out.push('S, W, T');
      // ? и Esc
      await press('Shift+Slash');
      assert(await page.$('dialog#help[open]'), '? не открыл справку');
      await press('Escape');
      assert(!(await page.$('dialog#help[open]')), 'Esc не закрыл справку');
      out.push('?, Esc');
      // Mod+Enter вне формы — диалог отправки
      await page.locator('body').click({ position: { x: 5, y: 300 } });
      await press(`${MOD}+Enter`);
      assert(await page.$('dialog#submit[open]'), 'Mod+Enter не открыл отправку');
      await press('Escape');
      out.push('Mod+Enter');
      await page.close();
      return out.join('; ');
    });

    await check('22 фокус в textarea: j, v, s вводят текст и ничего не делают', async () => {
      const page = await open(shared);
      await toFile(page, COLLECT);
      await page.click(num('new', 54));
      const before = await page.evaluate(() => ({ body: document.body.className, cur: document.querySelector('#toc [aria-current=true].file-row')?.dataset.path }));
      await page.keyboard.type('jvs');
      await sleep(200);
      const after = await page.evaluate(() => ({ body: document.body.className, cur: document.querySelector('#toc [aria-current=true].file-row')?.dataset.path }));
      const v = await formText(page);
      assert(v === 'jvs' && before.body === after.body && before.cur === after.cur, JSON.stringify([v, before, after]));
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Escape');
      await page.close();
      return v;
    });

    await check('23 Tab доходит до кнопок главы и файла, чекбоксов и строк оглавления; outline solid цвета --focus', async () => {
      const page = await open(shared);
      const seen = new Set();
      const bad = [];
      for (let k = 0; k < 90; k++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const a = document.activeElement;
          const probe = document.createElement('div');
          probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--focus');
          document.body.append(probe);
          const focus = getComputedStyle(probe).color;
          probe.remove();
          const cs = getComputedStyle(a);
          const kind = a.matches('.sec-toggle') ? 'sec' : a.matches('.file-toggle') ? 'file' : a.matches('input.check') ? 'check' : a.matches('#toc .toc-sec-go, #toc .file-row, #toc .toc-status') ? 'toc' : null;
          return { kind, style: cs.outlineStyle, color: cs.outlineColor, focus, tag: a.tagName + '.' + a.className };
        });
        if (r.kind) seen.add(r.kind);
        // Фокус уходит в интерфейс браузера после последнего элемента страницы — тогда активен body.
        if (r.tag !== 'BODY.' && (r.style !== 'solid' || r.color !== r.focus)) bad.push(r.tag);
      }
      assert(['sec', 'file', 'check', 'toc'].every((k) => seen.has(k)), `дошли до: ${[...seen]}`);
      assert(!bad.length, `без кольца фокуса: ${[...new Set(bad)].join(', ')}`);
      await page.close();
      return [...seen].join(', ');
    });

    await check('47 reduced motion: J прокручивает мгновенно, у шеврона transition-duration 0s', async () => {
      const page = await open(big, { reducedMotion: 'reduce' });
      await page.keyboard.press('j');
      await page.keyboard.press('j');
      const r = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => {
        const cur = document.querySelector('#toc .file-row[aria-current=true]').dataset.path;
        const sec = document.querySelector('#toc .file-row[aria-current=true]').dataset.sec;
        const el = document.querySelector(`.sec[data-key="${sec}"] .file[data-path="${cur}"]`);
        res({ cur, top: el.getBoundingClientRect().top + el.clientTop, chev: getComputedStyle(document.querySelector('.chev')).transitionDuration });
      })));
      assert(Math.abs(r.top - 100) <= 1 && r.chev === '0s', JSON.stringify(r));
      await page.close();
      return JSON.stringify(r);
    });

    // ---------- отправка ----------

    await check('37 «Отправить фидбек» — dialog#submit :modal; 15 Tab внутри; Esc закрывает, фокус на кнопке', async () => {
      const page = await open(shared);
      await page.click('#submit-btn');
      const modal = await page.evaluate(() => document.querySelector('dialog#submit').matches(':modal'));
      const inside = [];
      for (let k = 0; k < 15; k++) {
        await page.keyboard.press('Tab');
        inside.push(await page.evaluate(() => !!document.activeElement.closest('dialog#submit')));
      }
      await page.keyboard.press('Escape');
      const r = await page.evaluate(() => ({ open: document.querySelector('dialog#submit').open, focus: document.activeElement.id }));
      assert(modal && inside.every(Boolean) && !r.open && r.focus === 'submit-btn', JSON.stringify({ modal, inside, r }));
      await page.close();
      return 'ok';
    });

    await check('38 «Одобрить» при 1 из 4 просмотренных глав — предупреждение со списком файлов', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx);
      await page.click('#toc .toc-group[data-key=s1] .toc-status');
      await page.click('#approve-btn');
      const r = await page.evaluate(() => {
        const w = document.querySelector('dialog#submit .dlg-warn');
        return w && { head: w.querySelector('.warn-head')?.textContent, paths: [...w.querySelectorAll('.dlg-paths li')].map((li) => li.textContent), more: w.querySelector('.dlg-more')?.textContent };
      });
      assert(r && r.head === 'Не все файлы просмотрены' && r.paths.length === 5 && r.more === 'и ещё 1' && !r.paths.includes('scripts/collect.py'), JSON.stringify(r));
      await page.close();
      return JSON.stringify(r);
    });

    await check('39 при черновике диалог показывает «Есть неотправленные черновики: 1»; «Перейти» ведёт к нему', async () => {
      const fx = await fresh('mixed', { version: 1, drafts: { 'scripts/validate.py|new|16|16': { file: 'scripts/validate.py', side: 'new', start: 16, end: 16, text: 'черновик', suggestion: '' } } });
      const page = await open(fx);
      await page.click('#submit-btn');
      const text = await page.$eval('dialog#submit .dlg-drafts', (e) => e.textContent);
      assert(text.includes('Есть неотправленные черновики: 1'), text);
      await page.click('dialog#submit .dlg-drafts .btn');
      await sleep(400);
      const r = await page.evaluate(() => {
        const d = document.querySelector('.draft-row[data-key="scripts/validate.py|new|16|16"]').getBoundingClientRect();
        return { open: document.querySelector('dialog#submit').open, top: d.top, vh: innerHeight };
      });
      assert(!r.open && r.top > 100 && r.top < r.vh, JSON.stringify(r));
      await page.close();
      return text;
    });

    await check('40 клик по комментарию в списке закрывает диалог и прокручивает к .note', async () => {
      const notes = [
        { id: 'n1', file: 'scripts/collect.py', side: 'new', start: 34, end: 34, text: 'первый', suggestion: '' },
        { id: 'n2', file: 'scripts/validate.py', side: 'new', start: 16, end: 16, text: 'второй\nвторая строка', suggestion: '' },
      ];
      const fx = await fresh('mixed', { version: 1, annotations: notes, fileOpen: { 'scripts/validate.py': false } });
      const page = await open(fx);
      await page.click('#submit-btn');
      const items = await page.$$eval('dialog#submit .dlg-item', (els) => els.map((e) => e.textContent));
      await page.click('dialog#submit .dlg-item >> nth=1');
      await sleep(500);
      const r = await page.evaluate(() => {
        const n = document.querySelector('.note[data-id=n2]');
        const rect = n && n.getBoundingClientRect();
        return { open: document.querySelector('dialog#submit').open, top: rect && rect.top, vh: innerHeight };
      });
      assert(!r.open && r.top > 140 && r.top < r.vh - 40, JSON.stringify({ items, r }));
      await page.close();
      return `${items.join(' | ')}; top ${Math.round(r.top)}`;
    });

    await check('41 сервер остановлен: «Не удалось отправить» в [role=alert] внутри диалога, без alert()', async () => {
      const fx = await fresh('mixed', { version: 1, globalComment: 'общий' });
      const page = await open(fx);
      let alerts = 0;
      page.on('dialog', (d) => { alerts++; d.dismiss(); });
      await page.click('#submit-btn');
      fx.stop();
      await sleep(300);
      const w0 = await page.$eval('dialog#submit .btn.primary', (b) => b.offsetWidth);
      await page.click('dialog#submit .btn.primary');
      await page.waitForSelector('dialog#submit [role=alert]:not([hidden])', { timeout: 5000 });
      const r = await page.evaluate(() => ({ text: document.querySelector('dialog#submit [role=alert]').textContent, btn: document.querySelector('dialog#submit .btn.primary').textContent }));
      const w1 = await page.$eval('dialog#submit .btn.primary', (b) => b.offsetWidth);
      assert(r.text.startsWith('Не удалось отправить') && alerts === 0 && r.btn === 'Отправить фидбек' && w0 === w1, JSON.stringify({ r, alerts, w0, w1 }));
      // Ошибки сети от остановленного сервера ожидаемы: их в общий счёт не берём.
      page.errors.length = 0;
      await page.close();
      return r.text;
    });

    await check('42 Markdown в POST /api/submit байт в байт равен golden feedback.golden.md', async () => {
      const state = {
        version: 1,
        annotations: [
          { id: 'a1', file: 'scripts/validate.py', side: 'new', start: 16, end: 16, text: 'Почему 12?', suggestion: '' },
          { id: 'a2', file: 'scripts/collect.py', side: 'new', start: 54, end: 58, text: 'Слишком сложно', suggestion: 'return verify_simple(root, ref)\n```inner```' },
        ],
        sectionComments: { s2: 'Глава про валидатор — ок.' },
        globalComment: 'В целом хорошо.\nНо есть вопросы.',
      };
      const fx = await fresh('mixed', state);
      const page = await open(fx);
      let body = null;
      await page.route('**/api/submit', async (route) => { body = JSON.parse(route.request().postData()); await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
      const R = await page.evaluate(async () => (await fetch('/api/review', { headers: { 'X-Review-Token': new URLSearchParams(location.search).get('t') } })).json());
      await page.click('#submit-btn');
      await page.click('dialog#submit .btn.primary');
      await page.waitForSelector('.finished');
      const want = fs.readFileSync(GOLDEN, 'utf8');
      assert(body && body.action === 'feedback' && body.markdown === want, `разница:\n${JSON.stringify(body && body.markdown)}\n${JSON.stringify(want)}`);
      const sub = await page.$eval('.finished-sub', (e) => e.textContent);
      await page.close();
      return `${want.length} символов; «${sub}»`;
    });

    await check('43 финальный экран: прежний заголовок и «Сервер остановлен, вкладку можно закрыть.» для трёх действий', async () => {
      const want = { feedback: 'Фидбек отправлен в сессию Claude Code.', approve: 'Одобрение отправлено в сессию Claude Code.', close: 'Ревью закрыто.' };
      const got = [];
      for (const action of ['feedback', 'approve', 'close']) {
        const fx = await fresh('mixed', { version: 1, globalComment: 'общий', annotations: [{ id: 'x', file: 'scripts/collect.py', side: 'new', start: 34, end: 34, text: 'т', suggestion: '' }] });
        const page = await open(fx);
        let body = null;
        await page.route('**/api/submit', async (route) => { body = JSON.parse(route.request().postData()); await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
        if (action === 'close') { await page.click('#more-btn'); await page.click('.menu-item:has-text("Закрыть без ответа")'); }
        else await page.click(action === 'approve' ? '#approve-btn' : '#submit-btn');
        await page.keyboard.press(`${MOD}+Enter`);
        await page.waitForSelector('.finished');
        const r = await page.evaluate(() => ({ h1: document.querySelector('.finished h1').textContent, p: [...document.querySelectorAll('.finished p')].map((p) => p.textContent) }));
        await page.screenshot({ path: path.join(require('node:os').tmpdir(), `dr-final-${action}.png`) });
        assert(r.h1 === want[action] && r.p[0] === 'Сервер остановлен, вкладку можно закрыть.' && body.action === action, JSON.stringify(r));
        if (action === 'close') assert(body.markdown === '', 'close: markdown не пуст');
        got.push(`${action}: ${r.p[1]}`);
        await page.close();
      }
      return got.join('; ');
    });

    await check('4.12 big: открытие формы и «Просмотрено» до следующего кадра ≤ 50 мс', async () => {
      const page = await open(big);
      await toFile(page, F('assets/viewer.js'));
      const ms = await page.evaluate(() => new Promise((res) => {
        const td = document.querySelector('.file[data-path="assets/viewer.js"] td.num[data-side=new][data-no="20"]');
        const t0 = performance.now();
        td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        requestAnimationFrame(() => res(Math.round(performance.now() - t0)));
      }));
      const ok = await page.evaluate(() => !!document.querySelector('.file[data-path="assets/viewer.js"] .annot-form'));
      assert(ok && ms <= 50, `${ms} мс, форма: ${ok}`);
      await page.keyboard.press('Escape');
      await page.close();
      return `${ms} мс`;
    });

    await check('1 ошибок консоли и исключений нет во всех сценариях', async () => {
      const errs = allErrors.flat();
      assert(!errs.length, errs.join('\n'));
    });
  } finally {
    shared.stop(); big.stop();
    for (const s of servers) s.stop();
    await browser.close();
    summary();
  }
})();

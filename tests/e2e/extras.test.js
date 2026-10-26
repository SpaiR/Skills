// Checks that used to live only in the harness accept.js: syntax highlighting (12), plurals (44), theme menu (45),
// primary button contrast (46), "More" menu (3.13), uncoloured code (50), dark theme tokens (51), final screens (43).
const { startFixture, launch, openPage, check, summary, assert, sleep } = require('./lib');

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// Склонение по правилу Intl.PluralRules('ru') — тот же источник истины, что и в diffcore.plural.
const PR = new Intl.PluralRules('ru');
const FORMS = [
  ['файл', 'файла', 'файлов'], ['строка', 'строки', 'строк'], ['комментарий', 'комментария', 'комментариев'],
  ['глава', 'главы', 'глав'], ['коммит', 'коммита', 'коммитов'],
];
// «N слово» с неверной формой. «из N …» пропускается: там родительный падеж («из 1 файла»).
function badPlurals(text) {
  const bad = [];
  const words = FORMS.flat().sort((a, b) => b.length - a.length).join('|');
  // Только пробел между числом и словом: перевод строки в innerText склеил бы номер строки диффа с соседним текстом.
  const re = new RegExp(`(из[ \\u00a0]+)?(?<![\\d.])(\\d+)[ \\u00a0]+(${words})(?![а-яё])`, 'gi');
  for (const m of text.matchAll(re)) {
    if (m[1]) continue;
    const n = +m[2];
    const forms = FORMS.find((f) => f.includes(m[3].toLowerCase()));
    const cat = PR.select(n);
    const want = cat === 'one' ? forms[0] : cat === 'few' ? forms[1] : forms[2];
    if (want !== m[3].toLowerCase()) bad.push(`${m[0]} (нужно «${n} ${want}»)`);
  }
  return bad;
}

async function ownChecks(browser) {
  const errors = [];
  const servers = [];
  const fresh = async (fx, state) => { const s = await startFixture(fx, state); servers.push(s); return s; };
  const open = async (fx, opts) => { const p = await openPage(browser, fx.url, opts); errors.push(p.errors); return p; };
  const own = (id, name, fn) => check(`${id} ${name}`, fn);

  try {
    await own('12', 'подсветка: collect.py — span.t-kw «def» и «import», span.t-com с «#»; SKILL.md — ни одного span.t-*', async () => {
      const fx = await fresh('big');
      const page = await open(fx);
      const r = await page.evaluate(() => {
        const f = document.querySelector('.file[data-path="scripts/collect.py"]');
        const kw = [...f.querySelectorAll('span.t-kw')].map((s) => s.textContent);
        const com = [...f.querySelectorAll('span.t-com')].map((s) => s.textContent);
        const skill = document.querySelector('.file[data-path="SKILL.md"]');
        return {
          def: kw.includes('def'), import: kw.includes('import'), com: com.filter((c) => c.startsWith('#')).length,
          skill: skill.querySelectorAll('span.t-kw, span.t-str, span.t-num, span.t-com').length, skillRows: skill.querySelectorAll('tr.ln').length,
          kinds: Object.fromEntries(['t-kw', 't-str', 't-num', 't-com'].map((c) => [c, document.querySelectorAll(`#main span.${c}`).length])),
        };
      });
      assert(r.def && r.import && r.com > 0 && r.skill === 0 && r.skillRows > 0, JSON.stringify(r));
      // Цвет токенов — из палитры --syn-*, у самой ячейки цвет остаётся --ink (критерий 5 не нарушен).
      const colors = await page.evaluate(() => {
        const probe = (v) => { const d = document.createElement('div'); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
        const f = document.querySelector('.file[data-path="scripts/collect.py"]');
        return {
          kw: getComputedStyle(f.querySelector('span.t-kw')).color === probe('--syn-kw'),
          com: getComputedStyle(f.querySelector('span.t-com')).color === probe('--syn-com'),
          cell: getComputedStyle(f.querySelector('td.code')).color === probe('--ink'),
        };
      });
      assert(colors.kw && colors.com && colors.cell, JSON.stringify(colors));
      await page.close();
      return `com с «#»: ${r.com}; по странице ${JSON.stringify(r.kinds)}`;
    });

    await own('12', 'подсветка сочетается с span.w (mixed, validate.py 16: «12» — и t-num, и w)', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx);
      const r = await page.evaluate(() => {
        const tr = document.querySelector('.file[data-path="scripts/validate.py"] td.num[data-side=new][data-no="16"]').closest('tr');
        return [...tr.querySelectorAll('td.code span')].map((s) => `${s.className}:${s.textContent}`);
      });
      assert(r.includes('w t-num:12'), JSON.stringify(r));
      await page.close();
      return r.join(' ');
    });

    await own('44', 'нет «(ов)» и «комм.»; склонения верны во всех состояниях; главы «1 файл», «2 файла», «3 файла»', async () => {
      const fx = await fresh('mixed', {
        version: 1,
        annotations: [{ id: 'a1', file: 'scripts/collect.py', side: 'new', start: 54, end: 55, text: 'Вопрос', suggestion: '' }],
        sectionComments: { s2: 'К главе' },
        drafts: { 'scripts/collect.py|new|71|71': { file: 'scripts/collect.py', side: 'new', start: 71, end: 71, text: 'черновик', suggestion: '' } },
      });
      const page = await open(fx);
      const texts = [];
      const grab = async (label) => {
        const t = await page.evaluate(() => {
          // innerText пропускает содержимое под content-visibility, поэтому UI вне таблиц диффа берётся ещё и textContent.
          const ui = [];
          const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('table.diff') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
          while (walk.nextNode()) ui.push(walk.currentNode.nodeValue);
          const titles = [...document.querySelectorAll('[title], [aria-label]')].map((el) => `${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''}`);
          return `${document.body.innerText}\n${ui.join(' ')}\n${titles.join('\n')}`;
        });
        texts.push([label, t]);
      };
      await grab('страница');
      await page.click('#more-btn');
      await grab('меню');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Shift+Slash');
      await grab('справка');
      await page.keyboard.press('Escape');
      await page.click('#submit-btn');
      await grab('отправка');
      await page.keyboard.press('Escape');
      await page.click('#approve-btn');
      await grab('одобрение');
      await page.keyboard.press('Escape');
      await page.click('#toc .toc-group[data-key=s2] .toc-status');
      await grab('глава 2 отмечена');
      const sums = await page.$$eval('.sec .sec-sum', (els) => els.map((e) => e.textContent));
      const bad = [];
      for (const [label, t] of texts) {
        if (/\(ов\)/.test(t)) bad.push(`${label}: «(ов)»`);
        if (/комм\./.test(t)) bad.push(`${label}: «комм.»`);
        for (const b of badPlurals(t)) bad.push(`${label}: ${b}`);
      }
      assert(!bad.length, [...new Set(bad)].join('; '));
      assert(sums[0].startsWith('1 файл ') && sums[1].startsWith('2 файла') && sums[2].startsWith('3 файла'), JSON.stringify(sums));
      await sleep(500);
      await page.close();
      return sums.join(' | ');
    });

    await own('45', 'меню «Ещё» → «Тёмная»: html[data-theme=dark], фон body rgb(13, 14, 16), theme в state.json, после перезагрузки сохраняется', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx, { colorScheme: 'light' });
      const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await page.click('#more-btn');
      await page.click('.menu [role=menuitemradio]:has-text("Тёмная")');
      const r = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
      assert(r.attr === 'dark' && r.bg === 'rgb(13, 14, 16)', JSON.stringify(r));
      const checked = await page.$$eval('.menu [role=menuitemradio]', (els) => els.map((e) => `${e.querySelector('.menu-label').textContent}:${e.getAttribute('aria-checked')}`));
      assert(checked.join() === 'Авто:false,Светлая:false,Тёмная:true', checked.join());
      await sleep(600);
      assert(fx.state().theme === 'dark', `state.theme = ${fx.state().theme}`);
      await page.reload();
      await page.waitForFunction(() => performance.getEntriesByName('dr-ready').length > 0);
      const r2 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
      assert(r2.attr === 'dark' && r2.bg === 'rgb(13, 14, 16)', 'после перезагрузки: ' + JSON.stringify(r2));
      // «Авто» снимает атрибут и возвращает системную (светлую) тему.
      await page.click('#more-btn');
      await page.click('.menu [role=menuitemradio]:has-text("Авто")');
      const r3 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
      assert(r3.attr === null && r3.bg === before, 'авто: ' + JSON.stringify(r3));
      await sleep(600);
      assert(fx.state().theme === 'auto', `state.theme после «Авто» = ${fx.state().theme}`);
      await page.close();
      return `${before} → ${r.bg}; после перезагрузки ${r2.attr}; «Авто» → ${r3.bg}`;
    });

    await own('46', 'тёмная тема: контраст текста .btn.primary к фону ≥ 4.5 (системная и явная)', async () => {
      const fx = await fresh('mixed');
      const out = [];
      for (const [scheme, attr] of [['dark', null], ['light', 'dark']]) {
        const page = await open(fx, { colorScheme: scheme });
        if (attr) await page.evaluate((a) => document.documentElement.setAttribute('data-theme', a), attr);
        await page.click('#submit-btn');
        const r = await page.evaluate(() => {
          const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
          const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
          const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
          const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
          return [...document.querySelectorAll('.btn.primary')].map((b) => {
            const cs = getComputedStyle(b);
            return { text: b.textContent.trim().slice(0, 20), ratio: +ratio(rgb(cs.color), rgb(cs.backgroundColor)).toFixed(2) };
          });
        });
        assert(r.length >= 2 && r.every((x) => x.ratio >= 4.5), JSON.stringify(r));
        out.push(`${attr ? 'data-theme' : 'система'}: ${r.map((x) => `${x.text} ${x.ratio}`).join(', ')}`);
        await page.keyboard.press('Escape');
        await page.close();
      }
      return out.join('; ');
    });

    await own('3.13', 'меню «Ещё»: порядок и роли пунктов, kbd, ↑/↓/Home/End, Enter/Space, Esc и клик вне возвращают фокус', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx);
      await page.click('#more-btn');
      const items = await page.$$eval('.menu .menu-item, .menu .menu-sep, .menu .menu-group-label', (els) => els.map((e) => (e.classList.contains('menu-sep') ? '—' : e.classList.contains('menu-group-label') ? `[${e.textContent}]` : `${e.getAttribute('role')}:${e.querySelector('.menu-label').textContent}${e.querySelector('kbd') ? `/${e.querySelector('kbd').textContent}` : ''}`)));
      const want = ['menuitemcheckbox:Перенос строк/W', '—', '[Тема]', 'menuitemradio:Авто', 'menuitemradio:Светлая', 'menuitemradio:Тёмная', '—', 'menuitemcheckbox:Оглавление/T', 'menuitem:Свернуть все файлы/Z', 'menuitem:Развернуть все файлы/⇧Z', 'menuitem:Горячие клавиши/?', '—', 'menuitem:Закрыть без ответа…'];
      assert(JSON.stringify(items) === JSON.stringify(want), JSON.stringify(items));
      const geo = await page.evaluate(() => { const m = document.querySelector('.menu').getBoundingClientRect(), b = document.getElementById('more-btn').getBoundingClientRect(); return { w: m.width, right: Math.round(m.right - b.right), below: m.top >= b.bottom }; });
      assert(geo.w === 240 && geo.right === 0 && geo.below, 'геометрия ' + JSON.stringify(geo));
      const focused = () => page.evaluate(() => document.activeElement.querySelector('.menu-label') ? document.activeElement.querySelector('.menu-label').textContent : document.activeElement.id);
      const seq = [await focused()];
      for (const k of ['ArrowDown', 'ArrowDown', 'End', 'ArrowDown', 'ArrowUp', 'Home', 'ArrowUp']) { await page.keyboard.press(k); seq.push(await focused()); }
      assert(seq.join(',') === 'Перенос строк,Авто,Светлая,Закрыть без ответа…,Перенос строк,Закрыть без ответа…,Перенос строк,Закрыть без ответа…', seq.join(','));
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      const wrapOff = await page.evaluate(() => document.body.classList.contains('nowrap'));
      await page.keyboard.press('Space');
      const wrapOn = await page.evaluate(() => !document.body.classList.contains('nowrap'));
      assert(wrapOff && wrapOn, `Enter/Space по «Перенос строк»: ${wrapOff}/${wrapOn}`);
      await page.keyboard.press('Escape');
      const esc = await page.evaluate(() => ({ menu: !!document.querySelector('.menu'), focus: document.activeElement.id, exp: document.getElementById('more-btn').getAttribute('aria-expanded') }));
      assert(!esc.menu && esc.focus === 'more-btn' && esc.exp === 'false', 'Esc: ' + JSON.stringify(esc));
      await page.click('#more-btn');
      await page.mouse.click(600, 150); // заголовок hero: клик ничего не открывает
      const outside = await page.evaluate(() => !!document.querySelector('.menu'));
      assert(!outside, 'клик вне меню не закрыл его');
      await page.click('#more-btn');
      await page.click('.menu-item:has-text("Оглавление")');
      const toc = await page.evaluate(() => document.body.classList.contains('toc-hidden'));
      await page.click('.menu-item:has-text("Оглавление")');
      assert(toc, 'пункт «Оглавление» не скрыл оглавление');
      await page.click('.menu-item:has-text("Горячие клавиши")');
      const help = await page.evaluate(() => !!document.querySelector('dialog#help[open]') && !document.querySelector('.menu'));
      assert(help, 'пункт «Горячие клавиши» не открыл справку');
      await page.keyboard.press('Escape');
      await sleep(500);
      await page.close();
      return `${items.length} строк меню, фокус: ${seq.join(' → ')}`;
    });

    await own('50', 'автоматическая часть: ни один текст кода не окрашен цветом знака/статуса add или del (обе темы, обе фикстуры)', async () => {
      const out = [];
      for (const fxName of ['mixed', 'big']) {
        const fx = await fresh(fxName);
        for (const scheme of ['light', 'dark']) {
          const page = await open(fx, { colorScheme: scheme });
          const r = await page.evaluate(() => {
            const probe = (v) => { const d = document.createElement('div'); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
            const banned = new Set(['--add-sign', '--del-sign', '--success', '--danger', '--add-bar', '--del-bar'].map(probe));
            const allowed = new Set(['--ink', '--syn-kw', '--syn-str', '--syn-com', '--syn-num'].map(probe));
            let n = 0, bad = 0, other = 0;
            for (const el of document.querySelectorAll('td.code, td.code span:not(.nonl)')) {
              const c = getComputedStyle(el).color;
              n++;
              if (banned.has(c)) bad++;
              else if (!allowed.has(c)) other++;
            }
            return { n, bad, other };
          });
          assert(r.bad === 0 && r.other === 0, `${fxName}/${scheme}: ${JSON.stringify(r)}`);
          out.push(`${fxName}/${scheme} ${r.n}`);
          await page.close();
        }
      }
      return `проверено элементов: ${out.join(', ')}`;
    });

    await own('51', 'автоматическая часть: в тёмной теме --bg, --surface, --tint различны; --add-word ≠ --add-line, --del-word ≠ --del-line', async () => {
      const fx = await fresh('mixed');
      const page = await open(fx, { colorScheme: 'dark' });
      const r = await page.evaluate(() => {
        const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        const card = getComputedStyle(document.querySelector('.sec')).backgroundColor;
        const files = getComputedStyle(document.querySelector('.sec-files')).backgroundColor;
        const w = document.querySelector('td.code.l-add span.w');
        return {
          bg: v('--bg'), surface: v('--surface'), tint: v('--tint'), bodyBg, card, files,
          addWord: w ? getComputedStyle(w).backgroundColor : null, addLine: w ? getComputedStyle(w.closest('td')).backgroundColor : null,
        };
      });
      assert(new Set([r.bodyBg, r.card, r.files]).size === 3, JSON.stringify(r));
      assert(r.addWord && r.addWord !== r.addLine, JSON.stringify(r));
      await page.close();
      return `body ${r.bodyBg}, глава ${r.card}, подложка ${r.files}; слово ${r.addWord} на строке ${r.addLine}`;
    });

    // Кадры для визуальной части 36 и 43.
    await own('43', 'финальные экраны трёх действий: текст «Сервер остановлен…»', async () => {
      const out = [];
      for (const action of ['feedback', 'approve', 'close']) {
        const fx = await fresh('mixed', { version: 1, annotations: [{ id: 'a1', file: 'scripts/collect.py', side: 'new', start: 54, end: 55, text: 'Вопрос', suggestion: '' }] });
        const page = await open(fx);
        if (action === 'close') { await page.click('#more-btn'); await page.click('.menu-item:has-text("Закрыть без ответа")'); }
        else await page.click(action === 'approve' ? '#approve-btn' : '#submit-btn');
        await page.keyboard.press(`${MOD}+Enter`);
        await page.waitForSelector('.finished');
        const t = await page.evaluate(() => document.querySelector('.finished').innerText.replace(/\n+/g, ' / '));
        assert(t.includes('Сервер остановлен, вкладку можно закрыть.'), t);
        out.push(t);
        await page.close();
      }
      return out.join(' || ');
    });

    await own('1', 'ошибок консоли и исключений нет в проверках accept.js', async () => {
      const errs = errors.flat();
      assert(!errs.length, errs.join(' | '));
    });
  } finally {
    for (const s of servers) s.stop();
  }
}

(async () => {
  const browser = await launch();
  try { await ownChecks(browser); } finally { await browser.close(); }
  summary();
})().catch((e) => { console.error(e); process.exit(1); });

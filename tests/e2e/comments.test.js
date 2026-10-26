// Line comments: drafts, selection by click and drag, saving, deleting with undo, and suggested edits.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { expectCleanSession, fileSel, MOD, numSel, sleep, useEnv } from './lib.js';

const COLLECT = fileSel('scripts/collect.py');
const num = (side, no) => numSel(COLLECT, side, no);

describe('line comments', () => {
  const env = useEnv();
  let shared;
  before(async () => {
    shared = await env.server('mixed');
  });

  const formText = (page) =>
    page.evaluate(() => {
      const t = document.querySelector('.annot-form textarea');
      return t ? t.value : null;
    });
  const formTitle = (page) =>
    page.evaluate(() => {
      const t = document.querySelector('.annot-form .editor-title');
      return t ? t.textContent : null;
    });
  const toFile = (page, sel, dy = 100) =>
    page.evaluate(
      ([s, d]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - d),
      [sel, dy],
    );

  it('keeps the form text through collapsing a file, S twice and marking chapter 2, and stores the draft in state.json', async (t) => {
    const fx = await env.server('mixed');
    const page = await env.open(fx);
    await toFile(page, COLLECT);
    await page.click(num('new', 54));
    await page.keyboard.type('тест');
    const steps = [];
    const ensure = async (label) => {
      await sleep(600);
      const inForm = await formText(page);
      const inRow = await page.evaluate(() =>
        [...document.querySelectorAll('.draft-row')].map((r) => r.textContent).join('|'),
      );
      const st = fx.state();
      const onDisk = Object.values(st.drafts || {}).some((d) => d.text === 'тест');
      assert.ok(inForm === 'тест' || inRow.includes('тест'), `${label}: form=${inForm}, drafts=${inRow}`);
      assert.ok(onDisk, `${label}: no draft in state.json: ${JSON.stringify(st.drafts)}`);
      steps.push(`${label}: ${inForm === 'тест' ? 'form' : 'draft'}`);
    };
    await ensure('typing');
    const other = `${fileSel('scripts/validate.py')} .file-toggle`;
    await page.click(other);
    await ensure('collapse another file');
    await page.click(other);
    await ensure('expand another file');
    await page.keyboard.press('s');
    await ensure('S');
    await page.keyboard.press('s');
    await ensure('S again');
    await page.click('#toc .toc-group[data-key=s2] .toc-status');
    await ensure('mark chapter 2');
    await page.click('#toc .toc-group[data-key=s2] .toc-status');
    await ensure('unmark chapter 2');
    t.diagnostic(steps.join(', '));
  });

  it('shows a .draft-row after reload and "Продолжить" opens the form with the text and focus', async (t) => {
    const fx = await env.server('mixed', {
      version: 1,
      drafts: {
        'scripts/collect.py|new|54|54': {
          file: 'scripts/collect.py',
          side: 'new',
          start: 54,
          end: 54,
          text: 'тест',
          suggestion: '',
        },
      },
    });
    const page = await env.open(fx);
    // First the same path as in the keep-the-text test: a draft created by typing survives a reload.
    await toFile(page, COLLECT);
    await page.click(num('new', 56));
    await page.keyboard.type('второй');
    await sleep(600);
    await page.reload();
    await page.waitForFunction(() => performance.getEntriesByName('dr-ready').length > 0);
    const rows = await page.$$eval('.draft-row', (els) => els.map((e) => e.textContent));
    assert.ok(
      rows.some((x) => x.includes('тест')),
      JSON.stringify(rows),
    );
    assert.ok(
      rows.some((x) => x.includes('второй')),
      JSON.stringify(rows),
    );
    await page.click(`${COLLECT} .draft-row[data-key="scripts/collect.py|new|54|54"] [data-act=draft-continue]`);
    const v = await formText(page);
    assert.equal(v, 'тест', `in the form: ${v}`);
    const focused = await page.evaluate(
      () => document.activeElement && document.activeElement.matches('.annot-form textarea'),
    );
    assert.ok(focused, 'focus is not in the field');
    t.diagnostic(rows.join(' | '));
  });

  it('turns the first text into a .has-draft draft when another line is clicked, and opens an empty form there', async (t) => {
    const fx = await env.server('mixed');
    const page = await env.open(fx);
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
    assert.ok(r.draft.includes('первый'), JSON.stringify(r));
    assert.ok(r.mark, JSON.stringify(r));
    assert.equal(r.form, '', JSON.stringify(r));
    assert.ok(r.title.startsWith('Строка 35'), JSON.stringify(r));
    assert.match(r.img, /repeating-linear-gradient/, `dashed marker: ${r.img}`);
    t.diagnostic(r.draft);
  });

  it('selects old line 53 (del) to new line 56 by Shift-click, by dragging and in side-by-side view: "Строки 53–55 · старая версия"', async (t) => {
    const page = await env.open(shared);
    await toFile(page, COLLECT);
    await page.click(num('old', 53));
    await page.click(num('new', 56), { modifiers: ['Shift'] });
    const title = await formTitle(page);
    const sel = await page.$$eval(`${COLLECT} td.num.sel`, (els) => els.map((e) => `${e.dataset.side}${e.dataset.no}`));
    assert.equal(title, 'Строки 53–55 · старая версия');
    assert.equal(sel.join(), 'old53,old54,old55');
    // The same by dragging from old 53 to new 56.
    await page.keyboard.press('Escape');
    const a = await page.locator(num('old', 53)).boundingBox();
    const b = await page.locator(num('new', 56)).boundingBox();
    await page.mouse.move(a.x + 5, a.y + 5);
    await page.mouse.down();
    await page.mouse.move(b.x + 5, b.y + 5, { steps: 6 });
    const during = await page.$$eval(`${COLLECT} td.num.sel`, (els) => els.length);
    await page.mouse.up();
    const title2 = await formTitle(page);
    assert.equal(during, 3, `selected during the drag: ${during}`);
    assert.equal(title2, 'Строки 53–55 · старая версия');
    // In side-by-side view data-i is the pair index; the rule is the same.
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    await page.click(num('old', 53));
    await page.click(num('new', 56), { modifiers: ['Shift'] });
    const title3 = await formTitle(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    assert.equal(title3, 'Строки 53–55 · старая версия', `side-by-side: ${title3}`);
    t.diagnostic(`${title}; drag: ${title2}; side-by-side: ${title3}`);
  });

  it('treats a click on the old number of a context line as the new version', async (t) => {
    const page = await env.open(shared);
    await toFile(page, COLLECT);
    await page.click(num('old', 56)); // ctx: old 56 = new 59
    const title = await formTitle(page);
    assert.equal(title, 'Строка 59 · новая версия');
    await page.keyboard.press('Escape');
    t.diagnostic(title);
  });

  it('marks new lines 54–58 with .has-note after saving, and paints the selected add line with --add-line plus an overlay', async (t) => {
    const fx = await env.server('mixed');
    const page = await env.open(fx);
    await toFile(page, COLLECT);
    await page.click(num('new', 54));
    await page.click(num('new', 58), { modifiers: ['Shift'] });
    await page.keyboard.type('Почему так?');
    await page.keyboard.press(`${MOD}+Enter`);
    const marks = await page.$$eval(`${COLLECT} td.num.has-note`, (els) =>
      els.map((e) => `${e.dataset.side}${e.dataset.no}`),
    );
    assert.equal(marks.join(), 'new54,new55,new56,new57,new58');
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
    assert.equal(r.t, 'add', JSON.stringify(r));
    assert.equal(r.bg, r.want, JSON.stringify(r));
    assert.match(r.img, /linear-gradient/, JSON.stringify(r));
    await page.keyboard.press('Escape');
    t.diagnostic(`${marks.join()}; ${r.bg}; ${r.img.slice(0, 40)}`);
  });

  it('reveals .cmt-btn on row hover, opens the form on click, and offers it on del lines but not on old numbers of context lines', async (t) => {
    const page = await env.open(shared);
    await toFile(page, COLLECT);
    const row = page.locator(`${COLLECT} tr.ln`).filter({ has: page.locator(`td.num[data-side=new][data-no="57"]`) });
    const btn = page.locator(`${num('new', 57)} .cmt-btn`);
    const before = await btn.evaluate((b) => getComputedStyle(b).opacity);
    await row.locator('td.code').hover();
    await sleep(200);
    const after = await btn.evaluate((b) => getComputedStyle(b).opacity);
    assert.equal(before, '0', `${before} -> ${after}`);
    assert.equal(after, '1', `${before} -> ${after}`);
    await btn.click();
    const title = await formTitle(page);
    assert.equal(title, 'Строка 57 · новая версия');
    const del = await page.$eval(`${num('old', 54)}`, (td) => !!td.querySelector('.cmt-btn'));
    const ctxOld = await page.$eval(`${num('old', 56)}`, (td) => !!td.querySelector('.cmt-btn'));
    assert.ok(del, `button on a del line: ${del}`);
    assert.ok(!ctxOld, `button on the old number of a context line: ${ctxOld}`);
    await page.keyboard.press('Escape');
    t.diagnostic(title);
  });

  it('removes a comment with a toast offering "Вернуть", and undo restores the same id in the same place', async (t) => {
    const notes = [
      { id: 'aaa', file: 'scripts/collect.py', side: 'new', start: 34, end: 34, text: 'первый', suggestion: '' },
      { id: 'bbb', file: 'scripts/collect.py', side: 'new', start: 54, end: 55, text: 'второй', suggestion: '' },
      { id: 'ccc', file: 'scripts/validate.py', side: 'new', start: 16, end: 16, text: 'третий', suggestion: '' },
    ];
    const fx = await env.server('mixed', { version: 1, annotations: notes });
    const page = await env.open(fx);
    await toFile(page, COLLECT);
    const note = page.locator(`${COLLECT} .note[data-id=bbb]`);
    await note.hover();
    await note.locator('[data-act=note-delete]').click();
    const toast = await page.evaluate(() => {
      const el = document.getElementById('toast');
      return { cls: el.className, text: el.textContent, gone: !document.querySelector('.note[data-id=bbb]') };
    });
    assert.ok(toast.cls.includes('show'), JSON.stringify(toast));
    assert.ok(toast.text.includes('Комментарий удалён'), JSON.stringify(toast));
    assert.ok(toast.text.includes('Вернуть'), JSON.stringify(toast));
    assert.ok(toast.gone, JSON.stringify(toast));
    await sleep(600);
    assert.equal(
      fx
        .state()
        .annotations.map((a) => a.id)
        .join(),
      'aaa,ccc',
      'not removed from state',
    );
    await page.click('#toast .toast-btn');
    await sleep(600);
    const ids = fx
      .state()
      .annotations.map((a) => a.id)
      .join();
    const back = await page.$$eval('.note[data-id]', (els) => els.map((e) => e.dataset.id).join());
    assert.equal(ids, 'aaa,bbb,ccc', `${ids} / ${back}`);
    assert.ok(back.includes('bbb'), `${ids} / ${back}`);
    t.diagnostic(ids);
  });

  it('fills the suggestion field with the original lines, indents with Tab, and renders a "Предложенная правка" card with − and +', async (t) => {
    const fx = await env.server('mixed');
    const page = await env.open(fx);
    await toFile(page, COLLECT);
    await page.click(num('new', 57));
    await page.click(num('new', 58), { modifiers: ['Shift'] });
    await page.keyboard.type('Можно короче');
    await page.click(`${COLLECT} .sug-toggle`);
    const filled = await page.$eval(`${COLLECT} .annot-form textarea.mono`, (e) => e.value);
    assert.equal(filled, '        return None\n    return res.stdout.decode().strip() or None');
    // Tab in the suggestion field inserts two spaces, Shift+Tab removes them.
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    const tabbed = await page.$eval(`${COLLECT} .annot-form textarea.mono`, (e) => e.value);
    await page.keyboard.press('Shift+Tab');
    const untabbed = await page.$eval(`${COLLECT} .annot-form textarea.mono`, (e) => e.value);
    assert.ok(tabbed.endsWith('None  '), JSON.stringify([tabbed, untabbed]));
    assert.equal(untabbed, tabbed.replace(/\n {2}/, '\n'), JSON.stringify([tabbed, untabbed]));
    await page.$eval(`${COLLECT} .annot-form textarea.mono`, (e) => {
      e.value = '    return None';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click(`${COLLECT} .annot-form .btn.primary`);
    await page.locator(`${COLLECT} .note .suggestion`).scrollIntoViewIfNeeded();
    const card = await page.evaluate(() => {
      const s = document.querySelector('.file[data-path="scripts/collect.py"] .note .suggestion');
      return (
        s && {
          head: s.querySelector('.suggestion-head').innerText,
          signs: [...s.querySelectorAll('.sg-sign')].map((x) => x.textContent).join(''),
        }
      );
    });
    assert.ok(card, 'no suggestion card');
    assert.equal(card.head, 'Предложенная правка', JSON.stringify(card));
    assert.equal(card.signs, '−−+', JSON.stringify(card));
    t.diagnostic(JSON.stringify(card));
  });

  expectCleanSession(env);
});

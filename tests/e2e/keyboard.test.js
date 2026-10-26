// Keyboard: shortcuts, layouts, typing in fields, Tab order and focus rings, reduced motion, the More menu.
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { expectCleanSession, fileSel, MOD, numSel, sleep, useEnv } from './lib.js';

const F = fileSel;
const COLLECT = F('scripts/collect.py');
const num = (side, no) => numSel(COLLECT, side, no);

describe('keyboard', () => {
  const env = useEnv();
  let shared, big;
  before(async () => {
    shared = await env.server('mixed');
    big = await env.server('big');
  });

  const formText = (page) => page.evaluate(() => { const t = document.querySelector('.annot-form textarea'); return t ? t.value : null; });
  const formTitle = (page) => page.evaluate(() => { const t = document.querySelector('.annot-form .editor-title'); return t ? t.textContent : null; });
  const toFile = (page, sel, dy = 100) => page.evaluate(([s, d]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - d), [sel, dy]);
  const current = (page) => page.evaluate(() => {
    const f = document.querySelector('#toc .file-row[aria-current="true"]');
    const s = document.querySelector('#toc .toc-sec[aria-current="true"]');
    return { file: f && f.dataset.path, sec: s && s.closest('.toc-group').dataset.key };
  });

  it('moves to the next file on keydown code=KeyJ even when key is "о" (Russian layout)', async (t) => { // was 20
    const page = await env.open(shared);
    const before = await current(page);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'о', bubbles: true })));
    await sleep(300);
    const after = await current(page);
    const order = await page.$$eval('.sec:not(.collapsed) .file', (els) => els.map((e) => e.dataset.path));
    assert.equal(order.indexOf(after.file), order.indexOf(before.file) + 1, `${before.file} -> ${after.file}`);
    t.diagnostic(`${before.file} -> ${after.file}`);
  });

  it('does what the shortcut table says for every key', async (t) => { // was 21
    const fx = await env.server('mixed');
    const page = await env.open(fx);
    const out = [];
    const press = async (k) => { await page.keyboard.press(k); await sleep(250); };
    // J/K
    const c0 = await current(page);
    await press('j'); const c1 = await current(page);
    await press('j'); const c2 = await current(page);
    await press('k'); const c3 = await current(page);
    assert.ok(c1.file !== c0.file && c2.file !== c1.file && c3.file === c1.file, JSON.stringify([c0, c1, c2, c3]));
    out.push('J/K');
    // ]/[
    await press(']'); const s1 = await current(page);
    await press(']'); const s2 = await current(page);
    await press('['); const s3 = await current(page);
    assert.ok(s2.sec !== s1.sec && s3.sec === s1.sec, JSON.stringify([s1, s2, s3]));
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
    assert.ok(n1.length && n2.length && n1.join() !== n2.join() && n3.join() === n1.join(), JSON.stringify([n1, n2, n3]));
    const curTop = await page.$eval('tr.ln.cursor', (e) => e.getBoundingClientRect().top);
    out.push(`N/P (${n1.join()} -> ${n2.join()}, top ${Math.round(curTop)})`);
    // C
    await press('c');
    const ct = await formTitle(page);
    assert.ok(ct && /новая версия|старая версия/.test(ct), `C: ${ct}`);
    await page.keyboard.press('Escape');
    out.push(`C (${ct})`);
    // Esc clears the cursor after the form
    await press('Escape');
    assert.equal(await page.$$eval('tr.ln.cursor', (e) => e.length), 0, 'the cursor was not cleared');
    out.push('Esc');
    // V
    await page.evaluate(() => window.scrollTo(0, 0));
    await press('j');
    const cv = await current(page);
    await press('v');
    await sleep(500);
    assert.match(fx.state().filesViewed[cv.file] || '', /^[0-9a-f]{8}$/, 'V: no hash');
    out.push('V');
    // Shift+V
    const secKey = (await current(page)).sec;
    const rv0 = !!fx.state().reviewed[secKey];
    await press('Shift+V');
    await sleep(500);
    assert.notEqual(!!fx.state().reviewed[secKey], rv0, `Shift+V: ${secKey} ${rv0}`);
    await press('Shift+V');
    out.push('Shift+V');
    // O and Shift+O
    await page.evaluate(() => window.scrollTo(0, 0));
    await press('j');
    const co = await current(page);
    const exp = () => page.$eval(`.sec[data-key="${co.sec}"] ${F(co.file)} .file-toggle`, (b) => b.getAttribute('aria-expanded'));
    const e0 = await exp(); await press('o'); const e1 = await exp(); await press('o'); const e2 = await exp();
    assert.ok(e0 !== e1 && e2 === e0, `O: ${e0} ${e1} ${e2}`);
    const sexp = () => page.$eval(`.sec[data-key="${co.sec}"] .sec-toggle`, (b) => b.getAttribute('aria-expanded'));
    const x0 = await sexp(); await press('Shift+O'); const x1 = await sexp(); await press('Shift+O'); const x2 = await sexp();
    assert.ok(x0 !== x1 && x2 === x0, `Shift+O: ${x0} ${x1} ${x2}`);
    out.push('O, Shift+O');
    // Shift+C
    await press('Shift+C');
    const sc = await page.evaluate(() => document.activeElement && document.activeElement.closest('.sec-comment') && document.activeElement.tagName);
    assert.equal(sc, 'TEXTAREA', `Shift+C: ${sc}`);
    await page.keyboard.press('Escape');
    out.push('Shift+C');
    // S, W, T
    const cls = () => page.evaluate(() => document.body.className);
    const b0 = await cls(); await press('s'); const b1 = await cls(); await press('s');
    assert.ok(!b0.includes('view-split') && b1.includes('view-split'), `S: ${b0} / ${b1}`);
    await press('w'); const b2 = await cls(); await press('w');
    assert.ok(b2.includes('nowrap'), `W: ${b2}`);
    await press('t'); const b3 = await cls(); await press('t'); const b4 = await cls();
    assert.ok(b3.includes('toc-hidden') && !b4.includes('toc-hidden'), `T: ${b3} / ${b4}`);
    out.push('S, W, T');
    // ? and Esc
    await press('Shift+Slash');
    assert.ok(await page.$('dialog#help[open]'), '? did not open the help');
    await press('Escape');
    assert.ok(!(await page.$('dialog#help[open]')), 'Esc did not close the help');
    out.push('?, Esc');
    // Mod+Enter outside a form opens the submit dialog
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await press(`${MOD}+Enter`);
    assert.ok(await page.$('dialog#submit[open]'), 'Mod+Enter did not open the submit dialog');
    await press('Escape');
    out.push('Mod+Enter');
    t.diagnostic(out.join('; '));
  });

  it('lets j, v and s be typed into a textarea without triggering shortcuts', async (t) => { // was 22
    const page = await env.open(shared);
    await toFile(page, COLLECT);
    await page.click(num('new', 54));
    const before = await page.evaluate(() => ({ body: document.body.className, cur: document.querySelector('#toc [aria-current=true].file-row')?.dataset.path }));
    await page.keyboard.type('jvs');
    await sleep(200);
    const after = await page.evaluate(() => ({ body: document.body.className, cur: document.querySelector('#toc [aria-current=true].file-row')?.dataset.path }));
    const v = await formText(page);
    assert.equal(v, 'jvs', JSON.stringify([v, before, after]));
    assert.equal(before.body, after.body, JSON.stringify([v, before, after]));
    assert.equal(before.cur, after.cur, JSON.stringify([v, before, after]));
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    t.diagnostic(v);
  });

  it('reaches chapter and file buttons, checkboxes and table of contents rows with Tab, each with a solid --focus outline', async (t) => { // was 23
    const page = await env.open(shared);
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
      // After the last element of the page focus moves to the browser UI, and body is active.
      if (r.tag !== 'BODY.' && (r.style !== 'solid' || r.color !== r.focus)) bad.push(r.tag);
    }
    assert.ok(['sec', 'file', 'check', 'toc'].every((k) => seen.has(k)), `reached: ${[...seen]}`);
    assert.ok(!bad.length, `no focus ring: ${[...new Set(bad)].join(', ')}`);
    t.diagnostic([...seen].join(', '));
  });

  it('scrolls instantly on J and gives the chevron transition-duration 0s under reduced motion', async (t) => { // was 47
    const page = await env.open(big, { reducedMotion: 'reduce' });
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    const r = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => {
      const cur = document.querySelector('#toc .file-row[aria-current=true]').dataset.path;
      const sec = document.querySelector('#toc .file-row[aria-current=true]').dataset.sec;
      const el = document.querySelector(`.sec[data-key="${sec}"] .file[data-path="${cur}"]`);
      res({ cur, top: el.getBoundingClientRect().top + el.clientTop, chev: getComputedStyle(document.querySelector('.chev')).transitionDuration });
    })));
    assert.ok(Math.abs(r.top - 100) <= 1, JSON.stringify(r));
    assert.equal(r.chev, '0s', JSON.stringify(r));
    t.diagnostic(JSON.stringify(r));
  });

  it('lays out the More menu in the specified order and roles, navigates it with arrows, Home, End, Enter and Space, and returns focus on Esc or an outside click', async (t) => { // was 3.13
    const fx = await env.server('mixed');
    const page = await env.open(fx);
    await page.click('#more-btn');
    const items = await page.$$eval('.menu .menu-item, .menu .menu-sep, .menu .menu-group-label', (els) => els.map((e) => (e.classList.contains('menu-sep') ? '—' : e.classList.contains('menu-group-label') ? `[${e.textContent}]` : `${e.getAttribute('role')}:${e.querySelector('.menu-label').textContent}${e.querySelector('kbd') ? `/${e.querySelector('kbd').textContent}` : ''}`)));
    const want = ['menuitemcheckbox:Перенос строк/W', '—', '[Тема]', 'menuitemradio:Авто', 'menuitemradio:Светлая', 'menuitemradio:Тёмная', '—', 'menuitemcheckbox:Оглавление/T', 'menuitem:Свернуть все файлы/Z', 'menuitem:Развернуть все файлы/⇧Z', 'menuitem:Горячие клавиши/?', '—', 'menuitem:Закрыть без ответа…'];
    assert.deepEqual(items, want);
    const geo = await page.evaluate(() => { const m = document.querySelector('.menu').getBoundingClientRect(), b = document.getElementById('more-btn').getBoundingClientRect(); return { w: m.width, right: Math.round(m.right - b.right), below: m.top >= b.bottom }; });
    assert.ok(geo.w === 240 && geo.right === 0 && geo.below, 'geometry ' + JSON.stringify(geo));
    const focused = () => page.evaluate(() => document.activeElement.querySelector('.menu-label') ? document.activeElement.querySelector('.menu-label').textContent : document.activeElement.id);
    const seq = [await focused()];
    for (const k of ['ArrowDown', 'ArrowDown', 'End', 'ArrowDown', 'ArrowUp', 'Home', 'ArrowUp']) { await page.keyboard.press(k); seq.push(await focused()); }
    assert.equal(seq.join(','), 'Перенос строк,Авто,Светлая,Закрыть без ответа…,Перенос строк,Закрыть без ответа…,Перенос строк,Закрыть без ответа…');
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    const wrapOff = await page.evaluate(() => document.body.classList.contains('nowrap'));
    await page.keyboard.press('Space');
    const wrapOn = await page.evaluate(() => !document.body.classList.contains('nowrap'));
    assert.ok(wrapOff && wrapOn, `Enter/Space on the line wrap item: ${wrapOff}/${wrapOn}`);
    await page.keyboard.press('Escape');
    const esc = await page.evaluate(() => ({ menu: !!document.querySelector('.menu'), focus: document.activeElement.id, exp: document.getElementById('more-btn').getAttribute('aria-expanded') }));
    assert.ok(!esc.menu && esc.focus === 'more-btn' && esc.exp === 'false', 'Esc: ' + JSON.stringify(esc));
    await page.click('#more-btn');
    await page.mouse.click(600, 150); // the hero heading: a click there opens nothing
    const outside = await page.evaluate(() => !!document.querySelector('.menu'));
    assert.ok(!outside, 'a click outside the menu did not close it');
    await page.click('#more-btn');
    await page.click('.menu-item:has-text("Оглавление")');
    const toc = await page.evaluate(() => document.body.classList.contains('toc-hidden'));
    await page.click('.menu-item:has-text("Оглавление")');
    assert.ok(toc, 'the table of contents item did not hide the table of contents');
    await page.click('.menu-item:has-text("Горячие клавиши")');
    const help = await page.evaluate(() => !!document.querySelector('dialog#help[open]') && !document.querySelector('.menu'));
    assert.ok(help, 'the keyboard shortcuts item did not open the help');
    await page.keyboard.press('Escape');
    await sleep(500);
    t.diagnostic(`${items.length} menu rows, focus: ${seq.join(' -> ')}`);
  });

  expectCleanSession(env);
});

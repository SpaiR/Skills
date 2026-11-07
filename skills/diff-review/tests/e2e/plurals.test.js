// Russian plural forms and leftover placeholders in every visible state of the page.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expectCleanSession, sleep, useEnv } from './lib.js';

// Plural categories follow Intl.PluralRules('ru'), the same source of truth as diffcore.plural.
const PR = new Intl.PluralRules('ru');
const FORMS = [
  ['файл', 'файла', 'файлов'],
  ['строка', 'строки', 'строк'],
  ['комментарий', 'комментария', 'комментариев'],
  ['глава', 'главы', 'глав'],
  ['коммит', 'коммита', 'коммитов'],
];

// Finds "N word" pairs with a wrong form. "из N ..." is skipped: it needs the genitive ("из 1 файла").
function badPlurals(text) {
  const bad = [];
  const words = FORMS.flat()
    .sort((a, b) => b.length - a.length)
    .join('|');
  // Only a plain space between the number and the word: a newline in innerText would glue a diff line number to neighbouring text.
  const re = new RegExp(`(из[ \\u00a0]+)?(?<![\\d.])(\\d+)[ \\u00a0]+(${words})(?![а-яё])`, 'gi');
  for (const m of text.matchAll(re)) {
    if (m[1]) continue;
    const n = +m[2];
    const forms = FORMS.find((f) => f.includes(m[3].toLowerCase()));
    const cat = PR.select(n);
    const want = cat === 'one' ? forms[0] : cat === 'few' ? forms[1] : forms[2];
    if (want !== m[3].toLowerCase()) bad.push(`${m[0]} (expected "${n} ${want}")`);
  }
  return bad;
}

describe('plural forms', () => {
  const env = useEnv();

  it('has no "(ов)" or "комм." and uses correct plural forms in every state; chapters read "1 файл", "2 файла", "3 файла"', async () => {
    const fx = await env.server('mixed', {
      version: 1,
      annotations: [
        { id: 'a1', file: 'scripts/collect.py', side: 'new', start: 54, end: 55, text: 'Вопрос', suggestion: '' },
      ],
      sectionComments: { s2: 'К главе' },
      drafts: {
        'scripts/collect.py|new|71|71': {
          file: 'scripts/collect.py',
          side: 'new',
          start: 71,
          end: 71,
          text: 'черновик',
          suggestion: '',
        },
      },
    });
    const page = await env.open(fx);
    const texts = [];
    const grab = async (label) => {
      const t = await page.evaluate(() => {
        // innerText skips content under content-visibility, so UI outside the diff tables is also read through textContent.
        const ui = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) =>
            n.parentElement.closest('table.diff') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
        });
        while (walk.nextNode()) ui.push(walk.currentNode.nodeValue);
        const titles = [...document.querySelectorAll('[title], [aria-label]')].map(
          (el) => `${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''}`,
        );
        return `${document.body.innerText}\n${ui.join(' ')}\n${titles.join('\n')}`;
      });
      texts.push([label, t]);
    };
    await grab('page');
    await page.click('#more-btn');
    await grab('menu');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Slash');
    await grab('help');
    await page.keyboard.press('Escape');
    await page.click('#submit-btn');
    await grab('submit');
    await page.keyboard.press('Escape');
    await page.click('#approve-btn');
    await grab('approve');
    await page.keyboard.press('Escape');
    await page.click('#toc .toc-group[data-key=s2] .toc-status');
    await grab('chapter 2 marked');
    const sums = await page.$$eval('.sec .sec-sum', (els) => els.map((e) => e.textContent));
    const bad = [];
    for (const [label, t] of texts) {
      if (/\(ов\)/.test(t)) bad.push(`${label}: "(ов)"`);
      if (/комм\./.test(t)) bad.push(`${label}: "комм."`);
      for (const b of badPlurals(t)) bad.push(`${label}: ${b}`);
    }
    assert.equal(bad.length, 0, [...new Set(bad)].join('; '));
    assert.ok(sums[0].startsWith('1 файл '), JSON.stringify(sums));
    assert.ok(sums[1].startsWith('2 файла'), JSON.stringify(sums));
    assert.ok(sums[2].startsWith('3 файла'), JSON.stringify(sums));
    await sleep(500);
  });

  expectCleanSession(env);
});

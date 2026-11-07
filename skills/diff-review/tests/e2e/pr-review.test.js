// Reviewing a GitHub PR / GitLab MR: the PR data on the page, its untrusted description, the publish dialog.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expectCleanSession, useEnv } from './lib.js';

describe('PR/MR review page', () => {
  const env = useEnv();

  it('shows the PR link, state badge and publish button in the header', async () => {
    const page = await env.open(await env.server('pr-github'));
    const r = await page.evaluate(() => {
      const a = document.querySelector('#top a.range-label');
      return {
        text: a?.textContent,
        href: a?.getAttribute('href'),
        target: a?.target,
        rel: a?.rel,
        state: document.querySelector('#top .pr-state')?.textContent,
        publish: document.getElementById('publish-btn')?.textContent,
      };
    });
    assert.deepEqual(r, {
      text: 'PR #42 · acme/mixed-repo',
      href: 'https://github.com/acme/mixed-repo/pull/42',
      target: '_blank',
      rel: 'noopener noreferrer',
      state: 'открыт',
      publish: 'Опубликовать',
    });
  });

  it('shows the PR title, author and branches in the hero, and the description only as escaped text', async () => {
    const page = await env.open(await env.server('pr-github'));
    await page.click('.pr-body summary');
    const r = await page.evaluate(() => {
      const md = document.querySelector('.pr-md');
      return {
        line: document.querySelector('.pr-line').textContent,
        xss: window.__xss ?? null,
        elements: md.querySelectorAll('img, script, iframe, [onerror]').length,
        links: [...md.querySelectorAll('a')].map((a) => a.getAttribute('href')),
        text: md.textContent,
      };
    });
    assert.ok(r.line.includes('PR #42: verify: kind + quiet, лимиты'), r.line);
    assert.ok(r.line.includes('автор @alice'), r.line);
    assert.ok(r.line.includes('feature/review-polish → main'), r.line);
    assert.equal(r.xss, null);
    assert.equal(r.elements, 0);
    assert.deepEqual(r.links, ['https://example.com/docs']);
    assert.ok(r.text.includes('<script>'), 'the HTML is shown as text');
    assert.ok(!r.text.includes('шаблон PR'), 'HTML comments are dropped');
  });

  it('labels a GitLab MR with "MR !N" and offers no "request changes" there', async () => {
    const page = await env.open(await env.server('pr-gitlab'));
    assert.equal(await page.textContent('#top .range-label'), 'MR !7 · acme/tools/mixed-repo');
    await page.click('#publish-btn');
    const events = await page.$$eval('dialog#publish .pub-event input', (xs) => xs.map((x) => x.value));
    assert.deepEqual(events, ['comment', 'approve']);
    assert.equal(await page.textContent('dialog#publish h2'), 'Опубликовать ревью в MR');
  });

  it("disables approve and request changes on the viewer's own GitHub PR", async () => {
    const page = await env.open(await env.server('pr-github', null, { meta: { pr: { viewer: 'alice' } } }));
    await page.click('#publish-btn');
    const r = await page.$$eval('dialog#publish .pub-event input', (xs) =>
      xs.map((x) => `${x.value}${x.disabled ? ':off' : ''}`),
    );
    assert.deepEqual(r, ['comment', 'approve:off', 'request_changes:off']);
    assert.ok((await page.textContent('dialog#publish')).includes('Свой PR нельзя одобрить'));
  });

  it('has no publish button for a merged PR and a draft badge for a draft', async () => {
    const merged = await env.open(await env.server('pr-github', null, { meta: { pr: { state: 'merged' } } }));
    assert.equal(await merged.$('#publish-btn'), null);
    assert.equal(await merged.textContent('#top .pr-state'), 'смержен');
    const draft = await env.open(await env.server('pr-github', null, { meta: { pr: { draft: true } } }));
    assert.equal(await draft.textContent('#top .pr-state'), 'черновик');
    assert.ok(await draft.$('#publish-btn'));
  });

  it('keeps the publish button disabled until there is something to publish, and asks for a body to request changes', async () => {
    const page = await env.open(await env.server('pr-github'));
    await page.click('#publish-btn');
    const send = 'dialog#publish .dlg-actions .btn.primary';
    assert.ok(await page.isDisabled(send));
    await page.check('dialog#publish input[value=approve]');
    assert.ok(!(await page.isDisabled(send)));
    await page.check('dialog#publish input[value=request_changes]');
    assert.ok(await page.isDisabled(send));
    assert.equal(await page.textContent('dialog#publish .dlg-empty'), 'Для запроса изменений нужен общий комментарий.');
    await page.fill('dialog#publish textarea.global', 'Поправь лимит');
    assert.ok(!(await page.isDisabled(send)));
  });

  expectCleanSession(env);
});

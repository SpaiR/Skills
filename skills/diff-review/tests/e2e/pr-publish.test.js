// Publishing a review to a PR/MR from the page, end to end: page -> serve.py -> publish.py -> fake gh/glab.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { expectCleanSession, ROOT, sleep, useEnv } from './lib.js';

const HEAD = 'd9562d415efea76e29feceff9b4dd4e21e006cf0';
const FILE = 'scripts/collect.py';
const SEND = 'dialog#publish .dlg-actions .btn.primary';

// Line comments on the fixture's collect.py hunk @@ -31,7 +31,7 @@ (34 is the changed line), plus one on line 10,
// which is outside every hunk and so has to go into the review body.
const STATE = {
  annotations: [
    { id: 'a1', file: FILE, side: 'new', start: 34, end: 34, text: 'Почему 100?', suggestion: 'LOG_LIMIT = 80' },
    { id: 'a2', file: FILE, side: 'old', start: 34, end: 34, text: 'Старое значение', suggestion: '' },
    { id: 'a3', file: FILE, side: 'new', start: 31, end: 33, text: 'Диапазон контекста', suggestion: '' },
    { id: 'a4', file: FILE, side: 'new', start: 10, end: 10, text: 'Вне диффа', suggestion: '' },
  ],
  globalComment: 'Общий комментарий',
};

// A temp dir with the rules for the fake CLIs and the environment that puts them first on PATH.
function fakeCli(rules) {
  const dir = fs.mkdtempSync('/tmp/dr-fakecli-');
  const rulesPath = path.join(dir, 'rules.json');
  const log = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  return {
    env: {
      PATH: `${path.join(ROOT, 'tests/fakecli')}:${process.env.PATH}`,
      FAKE_CLI_RULES: rulesPath,
      FAKE_CLI_LOG: log,
    },
    calls: () =>
      fs.existsSync(log)
        ? fs
            .readFileSync(log, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : [],
  };
}

const rule = (cli, match, stdout = '', extra = {}) => ({ cli, match, stdout, exit: 0, ...extra });
const ghHead = (sha = HEAD) => rule('gh', ['pr view 42', '--json headRefOid'], { headRefOid: sha });
const ghReview = rule('gh', ['--method POST', 'repos/acme/mixed-repo/pulls/42/reviews'], {
  id: 1,
  html_url: 'https://github.com/acme/mixed-repo/pull/42#pullrequestreview-1',
});
const glHead = rule('glab', ['merge_requests/7'], { diff_refs: { head_sha: HEAD }, sha: HEAD });

// The browser logs every non-2xx response; the expected 409/502 of /api/publish are not page errors.
function dropExpected(page, status) {
  const expected = (e) => e.includes(`status of ${status}`) && e.includes('/api/publish');
  const keep = page.errors.filter((e) => !expected(e));
  assert.equal(page.errors.length - keep.length, 1, page.errors.join(' | '));
  page.errors.splice(0, page.errors.length, ...keep);
}

async function waitFor(fn, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = fn();
    if (v) return v;
    await sleep(50);
  }
  return fn();
}

describe('publishing to a PR/MR', () => {
  const env = useEnv();

  it('posts one GitHub review with inline comments, folds the off-diff one into the body and finishes the server', async () => {
    const cli = fakeCli([ghHead(), ghReview]);
    const fx = await env.server('pr-github', STATE, { env: cli.env });
    const page = await env.open(fx);
    await page.click('#publish-btn');
    const summary = await page.$$eval('dialog#publish .sum-item', (xs) => xs.map((x) => x.textContent));
    assert.deepEqual(summary, ['К строкам3', 'В общий текстесть']);
    assert.ok(await page.isVisible('dialog#publish .pub-fold'));
    await page.check('dialog#publish input[value=approve]');
    await page.click(SEND);
    await page.waitForSelector('main.finished');
    assert.equal(await page.textContent('main.finished h1'), 'Ревью опубликовано.');
    assert.equal(await page.getAttribute('main.finished a', 'href'), 'https://github.com/acme/mixed-repo/pull/42');

    const post = cli.calls().find((c) => c.argv.includes('repos/acme/mixed-repo/pulls/42/reviews'));
    assert.ok(post, JSON.stringify(cli.calls()));
    const review = JSON.parse(post.stdin);
    assert.equal(review.commit_id, HEAD);
    assert.equal(review.event, 'APPROVE');
    const byLine = review.comments.map((c) => [c.side, c.line, c.start_line ?? null]);
    assert.deepEqual(byLine, [
      ['RIGHT', 33, 31],
      ['RIGHT', 34, null],
      ['LEFT', 34, null],
    ]);
    const right34 = review.comments.find((c) => c.side === 'RIGHT' && c.line === 34);
    assert.equal(right34.body, 'Почему 100?\n\n```suggestion\nLOG_LIMIT = 80\n```');
    assert.ok(review.body.startsWith('Общий комментарий'), review.body);
    assert.ok(review.body.includes('**`scripts/collect.py`, строка 10**'), review.body);
    assert.ok(review.body.includes('Вне диффа'), review.body);
    assert.ok(!review.body.includes('Почему 100?'), 'inline comments are not repeated in the body');

    const out = await waitFor(() => /DIFF_REVIEW_RESULT: published (\S+)/.exec(fx.output()));
    assert.ok(out, fx.output());
    const md = fs.readFileSync(out[1], 'utf8');
    assert.ok(md.startsWith('# Ревью опубликовано: '), md);
    assert.ok(md.includes('- Действие: Одобрить'), md);
    assert.ok(md.includes('- PR #42: https://github.com/acme/mixed-repo/pull/42'), md);
  });

  it('stops when the PR head moved and publishes after "Опубликовать всё равно"', async () => {
    const cli = fakeCli([ghHead('0'.repeat(40)), ghReview]);
    const fx = await env.server('pr-github', STATE, { env: cli.env });
    const page = await env.open(fx);
    await page.click('#publish-btn');
    await page.click(SEND);
    await page.waitForSelector('dialog#publish .dlg-error:not([hidden])');
    assert.ok((await page.textContent('dialog#publish .dlg-error')).includes('появились новые коммиты'));
    assert.equal(await page.textContent(SEND), 'Опубликовать всё равно');
    assert.equal(cli.calls().filter((c) => c.argv.includes('--method')).length, 0, 'nothing posted yet');
    await page.click(SEND);
    await page.waitForSelector('main.finished');
    assert.equal(cli.calls().filter((c) => c.argv.includes('--method')).length, 1);
    dropExpected(page, 409);
  });

  it('posts GitLab discussions with positions, then the note and the approval', async () => {
    const cli = fakeCli([
      rule('glab', ['--method POST', '/discussions'], { id: 'd' }),
      rule('glab', ['--method POST', '/notes'], { id: 1 }),
      rule('glab', ['--method POST', '/approve'], {}),
      glHead,
    ]);
    const fx = await env.server('pr-gitlab', STATE, { env: cli.env });
    const page = await env.open(fx);
    await page.click('#publish-btn');
    await page.check('dialog#publish input[value=approve]');
    await page.click(SEND);
    await page.waitForSelector('main.finished');
    const posts = cli.calls().filter((c) => c.argv.includes('POST'));
    const kinds = posts.map((c) =>
      c.argv
        .find((a) => a.startsWith('projects/'))
        .split('/')
        .pop(),
    );
    assert.deepEqual(kinds, ['discussions', 'discussions', 'discussions', 'notes', 'approve']);
    const positions = posts
      .slice(0, 3)
      .map((c) => JSON.parse(c.stdin).position)
      .map((p) => [p.old_line ?? null, p.new_line ?? null, !!p.line_range]);
    assert.deepEqual(positions, [
      [33, 33, true],
      [null, 34, false],
      [34, null, false],
    ]);
    const suggestion = JSON.parse(posts[1].stdin).body;
    assert.ok(suggestion.includes('```suggestion:-0+0\nLOG_LIMIT = 80\n```'), suggestion);
    assert.ok(/DIFF_REVIEW_RESULT: published/.test(await waitFor(() => fx.output().includes('RESULT') && fx.output())));
  });

  it('reports a partial GitLab failure and the retry posts only what is left', async () => {
    const cli = fakeCli([
      rule('glab', ['--method POST', '/discussions'], '', {
        nth: 2,
        exit: 1,
        stderr: 'HTTP 500 Internal Server Error',
      }),
      rule('glab', ['--method POST', '/discussions'], { id: 'd' }),
      rule('glab', ['--method POST', '/notes'], { id: 1 }),
      glHead,
    ]);
    const fx = await env.server('pr-gitlab', STATE, { env: cli.env });
    const page = await env.open(fx);
    await page.click('#publish-btn');
    await page.click(SEND);
    await page.waitForSelector('dialog#publish .dlg-error:not([hidden])');
    const err = await page.textContent('dialog#publish .dlg-error');
    assert.ok(err.includes('Не удалось опубликовать'), err);
    assert.ok(err.includes('Уже опубликовано шагов: 1'), err);
    await page.click(SEND);
    await page.waitForSelector('main.finished');
    const ids = cli
      .calls()
      .filter((c) => c.argv.includes('POST') && c.argv.some((a) => a.endsWith('/discussions')))
      .map((c) => JSON.parse(c.stdin).body);
    // 1st ok, 2nd failed, then the retry: the failed one and the third. The first is never posted twice.
    assert.equal(ids.length, 4, JSON.stringify(ids));
    assert.equal(new Set(ids).size, 3, JSON.stringify(ids));
    dropExpected(page, 502);
  });

  expectCleanSession(env);
});

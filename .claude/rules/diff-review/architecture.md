---
paths:
  - "skills/diff-review/**"
---

# diff-review architecture

A Claude Code user skill: a guided review of local git changes, a GitHub pull request or a GitLab merge request in a
local browser page. The main session collects
the diff, a Sonnet subagent writes a guide (in Russian) that splits the change into sections, and the user reads
the guide next to the diffs and leaves line comments that come back into the session as feedback or, for an open
PR/MR, are published to it from the page.

`SKILL.md` is the skill itself (instructions for the main session). Everything else is what it runs.

## Data flow

1. `scripts/collect.py --repo <repo> [--mode ...]` writes `guide.patch`, `full.patch` and `meta.json` into an outdir
   (default `$TMPDIR/diff-review/<repo>-<branch>-<stamp>`) and prints a JSON summary. Exit 0 ok, 2 error, 3 no changes.
   With `--pr <url|pr N|mr N|#N|!N|pr|mr>`, `scripts/remote.py` reads the PR/MR through `gh`/`glab`, fetches its
   commits into the matching local clone (or a cache clone under `$TMPDIR/diff-review/repos/`) and the usual range diff
   `mergeBase..head` runs on them.
2. A subagent reads `references/guide-method.md`, `guide.patch` and `meta.json` and writes `<outdir>/guide.json`.
3. `scripts/validate.py --guide ... --meta ...` checks `guide.json` against `meta.json` strictly (exit 0 ok, 1 errors).
4. `scripts/serve.py --dir <outdir> --open` validates leniently, serves the viewer on 127.0.0.1 and prints
   `DIFF_REVIEW_URL: <url>`.
5. The viewer (`assets/viewer.html` + `assets/js/*.js`) loads `/api/review` and opens in Overview mode (the brief and all
   chapter overviews), with Guide and Files as the other two modes. It keeps progress in `<outdir>/state.json`
   and posts the decision to `/api/submit`, or, for a PR/MR, the review to `/api/publish` (`scripts/publish.py`
   posts it through `gh`/`glab`).
6. `serve.py` writes `feedback.md` if there is text, prints `DIFF_REVIEW_RESULT: feedback|approved|published|closed|
   timeout [<path>]` as its last line and exits. `SKILL.md` step 6 tells the session what to do with it.

## Directory map

```
SKILL.md                    skill entry point (frontmatter + steps 1-6)
references/guide-method.md  methodology and guide.json format for the subagent
scripts/collect.py          git diff -> guide.patch, full.patch, meta.json
scripts/remote.py           PR/MR references, metadata via gh/glab, fetching PR commits
scripts/publish.py          posting a review to GitHub/GitLab via gh/glab (POST /api/publish)
scripts/validate.py         guide.json coverage and shape checks (strict CLI, lenient for serve.py)
scripts/serve.py            stdlib HTTP server for the viewer and its API
assets/viewer.html          page shell; loads css/index.css and js/main.js
assets/js/                  native ES modules of the viewer; strings.js holds all page text, overview.js Overview mode
assets/css/                 index.css @imports the parts in cascade order (overview.css for Overview mode)
tests/unit/                 node:test: diffcore, expand, strings, contrast
tests/python/               unittest: collect, serve, validate
tests/e2e/                  node:test + playwright-core against system Chrome; lib.js holds helpers
tests/fixtures/             recorded outdirs (mixed, mixed2, large, big, tree, pr-github, pr-gitlab) + feedback.golden.md
tests/fakecli/              fake gh and glab for tests (rules in $FAKE_CLI_RULES, call log in $FAKE_CLI_LOG)
tests/tools/                contrast.js (palette contrast CLI), shoot.js (manual screenshots)
```

## Commands

Run from `skills/diff-review/`. Requirements: Node (ESM, `node --test`), Python 3, `uv` (for `uvx ruff`), Google Chrome.

```bash
npm run setup       # npm install + git config core.hooksPath .githooks
npm run lint        # biome check + ruff check + ruff format --check
npm run format      # biome --write + ruff format + ruff --fix
npm run test:unit   # node --test tests/unit
npm run test:py     # python3 -m unittest discover -s tests/python
npm run test:e2e    # node --test --test-concurrency=1 tests/e2e (headless system Chrome)
npm test            # all three suites
node tests/tools/contrast.js                       # print every palette contrast check
python3 scripts/validate.py --guide G --meta M     # check one guide by hand (strict: a guide without `brief` fails)
```

## Data contracts

**meta.json, version 3** (written by `collect.py`, `META_VERSION`): `version`, `root`, `repoName`, `worktree`,
`branch`, `head`, `mode`, `label`, `range`, `base`, `mergeBase`, `newRev`, `untrackedIncluded`, `commits`, `notes`,
`createdAt`, `files[]`, `totals`.

- `range` is structured, by mode: `since-base {base}`, `uncommitted {hasCommits}`, `staged`, `commit {sha, subject}`,
  `range {from, dots, to}`, `branch {base, ref}`, `pr {provider, host, repo, number, url}`. The viewer builds the page label from it (`T.rangeLabel`).
- `notes[]` are `{code, text}`; codes: `no_commits`, `base_not_found`, `full_text_mismatch`. `text` is English for
  the session summary; the viewer shows its own Russian text for the code.
- `files[i]`: `path`, `oldPath`, `status`, `additions`, `deletions`, `binary`, `content`. `content` is
  `{available: true, lines}` or `{available: false, reason}` with reason codes `binary`, `unchanged`,
  `unreadable`, `too_large` (+ `limitKiB`), `total_limit`, `not_collected`, `in_diff`.
- `pr` (only for `mode: "pr"`): `provider` (`github`|`gitlab`), `host`, `repo`, `number`, `url`, `title`, `author`,
  `state` (`open`|`closed`|`merged`), `draft`, `baseRef`, `headRef`, `baseSha`, `headSha`, `startSha` (GitLab),
  `mergeBaseSha` (the diff base), `body` (truncated description, untrusted text), `viewer` (login of the CLI user).
  `/api/publish` reads the shas from here; the page shows the rest.
- `label` and note `text` are plain English for the session; the page uses them only as a fallback for an unknown
  `range.mode` or note code.
- Older outdirs: v1/v2 have no `range`, notes are Russian strings, `content` may be missing. The viewer falls back
  to `meta.label`, shows string notes verbatim and explains missing `content` (`assets/js/strings.js`,
  `assets/js/expand.js`). Keep these fallbacks.

`guide.patch` and `full.patch` are split per file by `collect.split_patch`; chunk `i` of `guide.patch` is
`files[i]`; `full.patch` has one chunk per file with `content.available`, in file order.

**guide.json**: `title`, `intent`, `brief[] {kind, text, section?}` (`kind` is `change`, `kept` or `risk`;
`section` is a 1-based chapter number), `sections[] {title, overview, diffs[] {file, summary}}`, `unplacedFiles[]`,
optional `generator`. The full shape and writing rules live in `references/guide-method.md`; `scripts/validate.py`
enforces it (every changed file exactly once, at most 10 sections). The CLI is strict, as the subagent and `SKILL.md`
step 4 run it: `brief` is required (2-10 points, at least one `change`, at most 40 words and no backticks per
point) and the first paragraph of every overview has no backticks. `serve.py` validates leniently
(`validate(..., strict=False)`): `brief` may be absent, but if present its shape is checked. It refuses to start
on a guide that fails that check, so older outdirs without `brief` still open.


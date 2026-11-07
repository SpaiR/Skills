# Contributing

## Repository

Each skill lives in `skills/<name>/`, and `npx skills add` copies that whole folder to the user. Keep repository
docs, rules and hooks at the root; see the layout in [CLAUDE.md](CLAUDE.md). Rules for Claude Code live in
[.claude/rules/](.claude/rules/) and apply to everyone.

Enable the commit message check once per clone:

```bash
git config core.hooksPath .githooks
```

To try a working copy as the installed skill, run from the repository root (it copies, so rerun after changes):

```bash
npx skills add ./ -g -a claude-code -s <name> -y
```

### Adding a skill

Create `skills/<name>/SKILL.md` with `name` and `description` in the frontmatter, add the skill to the table in
`README.md` and the layout in `CLAUDE.md`, add its scope to `.githooks/commit-msg` and `.claude/rules/git.md`, and
check that `npx skills add ./ --list` finds it. Conventions: [.claude/rules/skills.md](.claude/rules/skills.md).

## Language

Code, comments, docs, rules, test names and commits are English. diff-review speaks Russian to its user; where
Russian is allowed in it: [.claude/rules/diff-review/language.md](.claude/rules/diff-review/language.md).

## Branches and commits

Work on a topic branch (`refactor/...`, `fix/...`, `feat/...`) and merge it into `main` when it is green.

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), checked by
`.githooks/commit-msg`:

```
<type>(<scope>): <subject>
```

- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `build`, `chore`, `perf`.
- Scopes: `bigwork`; for diff-review `viewer`, `collect`, `remote`, `publish`, `serve`, `validate`, `skill`,
  `tests`; `repo` for the root. The scope is optional.
- Add `!` (and a `BREAKING CHANGE:` footer) for incompatible changes to diff-review's `meta.json`, `guide.json`,
  `state.json` or the `DIFF_REVIEW_*` output markers.

Examples:

```
feat(viewer): add a shortcut to jump to the next unviewed file
fix(collect): keep renamed files when the base branch is missing
docs(bigwork): clarify how agents are sized
feat(collect)!: emit meta v4 with per-file language
```

More in [.claude/rules/git.md](.claude/rules/git.md).

## diff-review

Run every command in this section from `skills/diff-review/`.

You need:

- Node (a current release with `node --test` and ES modules),
- Python 3 (the scripts target 3.9+, standard library only),
- [`uv`](https://docs.astral.sh/uv/) (the linter runs `uvx ruff`),
- Google Chrome (browser tests drive the installed Chrome through `playwright-core`; no browser is downloaded).

```bash
npm run setup   # npm install + git config core.hooksPath .githooks
```

Architecture, data flow and data contracts:
[.claude/rules/diff-review/architecture.md](.claude/rules/diff-review/architecture.md). Area rules next to it:
`viewer.md`, `css.md`, `scripts.md`, `skill.md`, `testing.md`.

### Before committing

```bash
npm run lint      # Biome (JS, CSS) + ruff check + ruff format --check
npm test          # npm run test:unit && npm run test:py && npm run test:e2e
```

`npm run format` applies Biome and ruff fixes. The browser suite takes about two minutes;
`tests/e2e/performance.test.js` measures milliseconds and can flake under load, so rerun it alone
(`node --test tests/e2e/performance.test.js`) before treating a failure as real.

### Changing the guide.json format

The format is defined in three places that must change together:

1. `references/guide-method.md`: the fields, rules and the sample the subagent follows.
2. `scripts/validate.py`: what is enforced. The CLI is strict: the subagent and `SKILL.md` run it on new guides, so
   it also checks the writing limits (`brief` required, its point count and length, no backticks in the brief and in
   the first paragraph of overviews; constants `BRIEF_MIN`, `BRIEF_MAX`, `BRIEF_MAX_WORDS`). `serve.py` calls
   `validate(guide, meta, strict=False)`, which checks only the shape, so recorded outdirs without `brief` still
   open; it refuses to start on a guide that fails even that.
3. The viewer code that reads it: `assets/js/main.js`, `section.js`, `overview.js` (the brief and Overview mode), `file.js`
   (summaries), `header.js`, `feedback.js`, and `markdown.js` (the Markdown subset and callouts the methodology
   allows).

A new required field goes into strict mode only; lenient mode must keep accepting older guides.

Then update `tests/python/test_validate.py`, the `guide.json` files of the fixtures if the shape changed, and the
affected e2e tests. See [.claude/rules/diff-review/skill.md](.claude/rules/diff-review/skill.md).

### Adding UI text

All page text, including the `feedback.md` template, lives in `assets/js/strings.js`. Add the string to `T` in the
group of the module that shows it, make it a function if it takes parameters, use `plural(n, WORDS.x)` for counted
nouns, and import `T` in the module. Do not put Russian text anywhere else. Steps:
[.claude/rules/diff-review/language.md](.claude/rules/diff-review/language.md).

### Fixtures and the golden feedback.md

- `tests/fixtures/<name>/` are recorded outdirs. To record one, run
  `python3 scripts/collect.py --repo <scratch repo> --out tests/fixtures/<name>` (add `--mode`/`--ref` as needed),
  write a `guide.json` there and check it with
  `python3 scripts/validate.py --guide tests/fixtures/<name>/guide.json --meta tests/fixtures/<name>/meta.json`.
  Absolute paths inside are recorded data; leave them as they are.
- `tests/fixtures/pr-github` and `pr-gitlab` are `mixed2` with a PR/MR `meta.json` (`mode: "pr"`, `meta.pr`); the
  description carries HTML and a `javascript:` link on purpose (escaping tests).
- Nothing in the test suites talks to GitHub or GitLab. `tests/fakecli/gh` and `tests/fakecli/glab` stand in for the
  CLIs: put `tests/fakecli` first on `PATH`, describe the answers in a JSON rules file named by `$FAKE_CLI_RULES`, and
  read the calls back from the JSONL log in `$FAKE_CLI_LOG` (format in the header of `tests/fakecli/gh`).
- `tests/fixtures/mixed/feedback.golden.md` is compared byte for byte with what the viewer submits in
  `tests/e2e/submit-and-final.test.js`. If you change the template on purpose, run
  `node --test --test-name-pattern 'byte for byte' tests/e2e/submit-and-final.test.js`. The failure message
  prints `difference:` followed by two JSON strings, the actual Markdown first; decode the first one into the
  golden file and review the diff. An unintended difference is a bug.

### Screenshots

`tests/tools/shoot.js` takes six screenshots (light and dark, three widths) of a running page and prints console
errors:

```bash
mkdir -p /tmp/run /tmp/shots && cp tests/fixtures/mixed/{guide.json,guide.patch,meta.json} /tmp/run/
python3 scripts/serve.py --dir /tmp/run            # prints DIFF_REVIEW_URL: <url>, keeps running
node tests/tools/shoot.js '<url>' /tmp/shots before-   # in a second terminal
```

Stop the server with Ctrl+C. For other scenarios write a separate script on top of `playwright-core`.

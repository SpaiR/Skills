# Contributing

## Setup

You need:

- Node (a current release with `node --test` and ES modules),
- Python 3 (the scripts target 3.9+, standard library only),
- [`uv`](https://docs.astral.sh/uv/) (the linter runs `uvx ruff`),
- Google Chrome (browser tests drive the installed Chrome through `playwright-core`; no browser is downloaded).

```bash
npm run setup   # npm install + git config core.hooksPath .githooks
```

To try your working copy as the live skill, clone or symlink it to `~/.claude/skills/diff-review`.

## Layout

See the directory map and data flow in [CLAUDE.md](CLAUDE.md). Area rules live in [.claude/rules/](.claude/rules/):
`viewer.md`, `css.md`, `scripts.md`, `skill.md`, `testing.md`. They are written for Claude Code but apply to
everyone.

## Language

Code, comments, docs, test names and commits are English. Russian is the product language: it appears only in
`assets/js/strings.js`, the static placeholders of `assets/viewer.html`, the guide content, page-text expectations
in tests, fixtures and labelled samples in `references/guide-method.md`. Details: [.claude/rules/language.md](.claude/rules/language.md).

## Branches and commits

Work on a topic branch (`refactor/...`, `fix/...`, `feat/...`) and merge it into `main` when it is green.

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), checked by
`.githooks/commit-msg` once `npm run setup` has run:

```
<type>(<scope>): <subject>
```

- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `build`, `chore`, `perf`.
- Scopes: `viewer`, `collect`, `serve`, `validate`, `skill`, `tests`, `repo`.
- Add `!` (and a `BREAKING CHANGE:` footer) for incompatible changes to `meta.json`, `guide.json`, `state.json` or
  the `DIFF_REVIEW_*` output markers.

Examples:

```
feat(viewer): add a shortcut to jump to the next unviewed file
fix(collect): keep renamed files when the base branch is missing
test(tests): cover gap expansion at the end of a file
docs(skill): clarify how to pick a worktree from free text
feat(collect)!: emit meta v4 with per-file language
```

More in [.claude/rules/git.md](.claude/rules/git.md).

## Before committing

```bash
npm run lint      # Biome (JS, CSS) + ruff check + ruff format --check
npm test          # npm run test:unit && npm run test:py && npm run test:e2e
```

`npm run format` applies Biome and ruff fixes. The browser suite takes about two minutes;
`tests/e2e/performance.test.js` measures milliseconds and can flake under load, so rerun it alone
(`node --test tests/e2e/performance.test.js`) before treating a failure as real.

## Changing the guide.json format

The format is defined in three places that must change together:

1. `references/guide-method.md`: the fields, rules and the sample the subagent follows.
2. `scripts/validate.py`: what is enforced (`serve.py` refuses to start on an invalid guide).
3. The viewer code that reads it: `assets/js/main.js`, `section.js`, `header.js`, `feedback.js`.

Then update `tests/python/test_validate.py`, the `guide.json` files of the fixtures if the shape changed, and the
affected e2e tests. See [.claude/rules/skill.md](.claude/rules/skill.md).

## Adding UI text

All page text, including the `feedback.md` template, lives in `assets/js/strings.js`. Add the string to `T` in the
group of the module that shows it, make it a function if it takes parameters, use `plural(n, WORDS.x)` for counted
nouns, and import `T` in the module. Do not put Russian text anywhere else. Steps:
[.claude/rules/language.md](.claude/rules/language.md).

## Fixtures and the golden feedback.md

- `tests/fixtures/<name>/` are recorded outdirs. To record one, run
  `python3 scripts/collect.py --repo <scratch repo> --out tests/fixtures/<name>` (add `--mode`/`--ref` as needed),
  write a `guide.json` there and check it with
  `python3 scripts/validate.py --guide tests/fixtures/<name>/guide.json --meta tests/fixtures/<name>/meta.json`.
  Absolute paths inside are recorded data; leave them as they are.
- `tests/fixtures/mixed/feedback.golden.md` is compared byte for byte with what the viewer submits in
  `tests/e2e/submit-and-final.test.js`. If you change the template on purpose, run
  `node --test --test-name-pattern 'byte for byte' tests/e2e/submit-and-final.test.js`. The failure message
  prints `difference:` followed by two JSON strings, the actual Markdown first; decode the first one into the
  golden file and review the diff. An unintended difference is a bug.

## Screenshots

`tests/tools/shoot.js` takes six screenshots (light and dark, three widths) of a running page and prints console
errors:

```bash
mkdir -p /tmp/run /tmp/shots && cp tests/fixtures/mixed/{guide.json,guide.patch,meta.json} /tmp/run/
python3 scripts/serve.py --dir /tmp/run            # prints DIFF_REVIEW_URL: <url>, keeps running
node tests/tools/shoot.js '<url>' /tmp/shots before-   # in a second terminal
```

Stop the server with Ctrl+C. For other scenarios write a separate script on top of `playwright-core`.

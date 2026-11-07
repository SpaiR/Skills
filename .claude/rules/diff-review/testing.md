---
paths:
  - "skills/diff-review/tests/**"
---

# Tests (tests/)

## Suites

| Command | What | Runner |
|---|---|---|
| `npm run test:unit` | `tests/unit/*.test.js`: diffcore, expand, strings formatters, palette contrast | `node --test` |
| `npm run test:py` | `tests/python/test_*.py`: collect, serve, validate | `python3 -m unittest` (no pytest) |
| `npm run test:e2e` | `tests/e2e/*.test.js`: the real viewer served by `serve.py` | `node --test --test-concurrency=1` |

`npm test` runs all three. One file: `node --test tests/e2e/keyboard.test.js`; one test: add
`--test-name-pattern '<regex>'`. Python: `python3 -m unittest discover -s tests/python -p test_serve.py`.

## E2E

- `playwright-core` drives the system Google Chrome (`channel: 'chrome'`, headless); no browser is downloaded.
  Chrome must be installed.
- `tests/e2e/lib.js` copies a fixture into a temp dir, starts `scripts/serve.py` on it and kills it afterwards
  (`startFixture`, `useEnv`). A new test file with pages calls `expectCleanSession(env)` last in its `describe()`:
  no console errors in any scenario, no requests outside `127.0.0.1` `/`, `/assets/*`, `/api/*`.
- `performance.test.js` compares milliseconds on the `big` fixture and can flake under CPU load. On a failure there,
  rerun that file alone before concluding anything; do not loosen its budgets to make it pass.

## Fixtures

- `tests/fixtures/<name>/` are recorded outdirs (`meta.json`, `guide.json`, `guide.patch`, optional `full.patch`).
  Absolute paths inside (`root`, temp dirs) are recorded data: do not "fix" or anonymize them.
- To record a new one, run `collect.py --out` on a scratch repo, write a valid `guide.json`
  (`validate.py` must pass, strict as the CLI runs it) and copy the files in. Keep fixtures on the current meta
  version unless the test is about old outdirs.
- `big`, `large`, `mixed` and `tree` were recorded before `guide.brief` and stand for older outdirs that `serve.py`
  must still open: `test_validate.py` (`PRE_BRIEF_FIXTURES`) checks them leniently and requires them to stay
  without `brief`. Every other fixture must pass strict validation.
- `mixed/feedback.golden.md` must stay byte-identical to what the viewer posts for the state in
  `submit-and-final.test.js`. Change it only when a change to `T.feedback`/`feedback.js` is intended: regenerate it
  from the actual output that the failing test prints, and review the diff line by line. The fixture `mixed` is
  meta v1; `tests/unit/strings.test.js` checks that the v3 range of `mixed2` renders the same range line.

## Rules

- Every behaviour change comes with a test that fails without it.
- Never weaken a test to make it pass: no removed assertions, wider tolerances, skips or `todo`s.
- Test names and comments are English; expectations of page text are Russian (see `language.md`).
- Palette values asserted in `theme-and-contrast.test.js` and `tests/tools/contrast.js` follow `css.md`.
- `tests/tools/` are not tests: `contrast.js` is a CLI (also used by the unit test), `shoot.js` takes manual
  screenshots (`node tests/tools/shoot.js <url> <shots-dir> [prefix]`).

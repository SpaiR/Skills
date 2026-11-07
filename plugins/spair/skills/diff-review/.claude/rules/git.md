# Git

## When to commit

Commit only when the user asks, or as a step of a plan the user approved. Never push, merge into `main`, rewrite
published history or change git config without being asked.

## Commit messages

Conventional Commits 1.0.0, enforced by `.githooks/commit-msg` (enabled by `npm run setup`). Subject line:

```
<type>(<scope>)?!?: <subject>
```

- Types: `feat` `fix` `refactor` `test` `docs` `style` `build` `chore` `perf`.
- Scopes: `viewer` (assets/), `collect`, `remote`, `publish`, `serve`, `validate` (scripts/), `skill` (SKILL.md,
  references/), `tests` (tests/), `repo` (configs, docs, tooling).
- Subject in English, imperative, lower case after the colon, no trailing period, at most ~100 characters.
- Body: what and why, wrapped at ~100 columns. One logical change per commit.
- The hook lets `Merge`, `Revert`, `fixup!`, `squash!` and `amend!` subjects through unchanged.

The type and scope lists above must match `types` and `scopes` in `.githooks/commit-msg`. Change both together
(and the list in `CONTRIBUTING.md`).

## Breaking changes

Mark a commit breaking (`!` after the scope, plus a `BREAKING CHANGE:` footer) when it changes a data contract in
an incompatible way:

- `meta.json` (fields, codes, `META_VERSION` bump in `scripts/collect.py`);
- `guide.json` (shape enforced by `scripts/validate.py`, described in `references/guide-method.md`);
- the `DIFF_REVIEW_URL` / `DIFF_REVIEW_RESULT` output markers or the `state.json` layout.

Example: `feat(collect)!: emit meta v4 with per-file language`.

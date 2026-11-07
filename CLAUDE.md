# Skills

Personal Claude Code skills, installed by users with `npx skills add SpaiR/Skills` (the
[`skills`](https://github.com/vercel-labs/skills) CLI). There is no build or release step: `main` is what users get.

## Layout

```
skills/<name>/          one skill per folder; npx skills copies the whole folder to ~/.claude/skills/<name>/
skills/diff-review/     guided review of a diff, PR or MR in a local browser page (Python scripts + static viewer)
skills/bigwork/         a large task run as a dynamic workflow (SKILL.md only)
.claude/rules/          rules for this repository; diff-review/ holds the rules of that skill
.githooks/commit-msg    Conventional Commits check
CONTRIBUTING.md         setup, commits, per-skill workflow
```

Only what a skill needs at runtime, its tests and its tooling go into `skills/<name>/`. Repository docs, rules and
hooks stay at the root so they don't ship to users.

## Rules

Topic rules in `.claude/rules/` load automatically; path-scoped ones when matching files are touched:

- `git.md`: when to commit, commit format, types and scopes, breaking changes
- `language.md`: English for everything a developer reads
- `skills.md`: conventions for every `skills/*/SKILL.md`
- `diff-review/`: architecture and data contracts (`architecture.md`), `language.md`, `viewer.md`, `css.md`,
  `scripts.md`, `skill.md`, `testing.md`. Paths inside these files are relative to `skills/diff-review/`.

## Commands

diff-review has the only code and tests; run its commands from `skills/diff-review/` (list in
`.claude/rules/diff-review/architecture.md`). To try a working copy as the installed skill:

```bash
npx skills add ./ -g -a claude-code -s <name> -y   # from the repository root; it copies, rerun after changes
```

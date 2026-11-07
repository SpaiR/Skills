---
paths:
  - "SKILL.md"
  - "references/**"
---

# Skill files (SKILL.md, references/)

- `SKILL.md` stays under 500 lines. Move detail into `references/` and link it; the subagent reads
  `references/guide-method.md` itself.
- Refer to files of the skill through `${CLAUDE_SKILL_DIR}` (scripts, references), never through absolute or
  home-relative paths. Keep `allowed-tools` in the frontmatter in step with the commands the steps run.
- The frontmatter `description` and `argument-hint` are what the user sees in the skill list; keep the argument
  table in step 1 consistent with `collect.py --help`.
- `disable-model-invocation: true` stays: the skill runs only when the user types `/diff-review`.

## Languages

- `guide.json` is always written in Russian, whatever the user's language; the subagent prompt says so.
- Every message the main session prints to the user is in the user's language.
- The instructions themselves are English; Russian appears only as labelled samples (see `language.md`).

## Subagent

- Launched with `subagent_type: "general-purpose"`, `model: "sonnet"`, `effort: "medium"`. Changing the model or
  effort changes cost and guide quality: do it deliberately and say why in the commit.
- The subagent may write only inside the outdir and must run `validate.py` until it passes. The main session does
  not read the diff and does not write the guide.

## The guide.json contract changes as one unit

`references/guide-method.md` (fields, rules, sample), `scripts/validate.py` (enforcement) and the viewer code that
reads the guide (`main.js`, `section.js`, `overview.js` for `brief` and Overview mode, `file.js` for summaries,
`header.js`, `feedback.js`, and `markdown.js` for the Markdown subset and callouts the methodology allows) describe
the same format. The contract includes `brief[] {kind, text, section?}` and the plain first paragraph of every
overview. When one changes:

1. Change the methodology, the validator and the viewer together. Writing limits (`brief` required, its point
   count, words per point, no backticks in the plain part) belong to strict mode, which the CLI runs; `serve.py`
   validates leniently so older outdirs still open. The thresholds in the methodology and the `BRIEF_*` constants
   in `validate.py` must agree.
2. Update `tests/python/test_validate.py`, the fixtures' `guide.json` files if the shape changed, and the e2e tests
   that depend on it.
3. An incompatible change is a breaking commit (see `git.md`).

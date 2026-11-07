---
paths:
  - "skills/*/SKILL.md"
  - "skills/*/references/**"
---

# Skill files

- Each skill is a folder `skills/<name>/` with `SKILL.md` at its root. The folder name is the skill name and the
  command (`/<name>`); `name` in the frontmatter matches it.
- `npx skills add` copies the whole folder into the user's `~/.claude/skills/<name>/`. Everything in it ships, so
  repository docs, rules and hooks live at the repository root, not in the skill folder.
- `SKILL.md` stays under 500 lines. Move detail into `references/` and link it.
- Refer to files of the skill through `${CLAUDE_SKILL_DIR}`, never through absolute or home-relative paths, in the
  body and in `allowed-tools`.
- The frontmatter `description` and `argument-hint` are what the user sees in the skill list; keep them accurate.
- Skills that act only on the user's request set `disable-model-invocation: true`; both current skills do.
- Instructions are English. A skill's product language (for example the Russian guide of diff-review) is described in
  that skill's own rules.

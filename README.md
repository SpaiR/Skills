# Skills

Personal Claude Code skills of SpaiR.

| Path | What it is |
| :- | :- |
| `skills/diff-review` | `/diff-review`: guided review of a diff, PR or MR in a local browser page. |
| `skills/bigwork` | `/bigwork`: a large task run as a dynamic workflow. |

## Install the skills

With the [`skills`](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add SpaiR/Skills
```

It asks which skills to install, for which agents, and whether globally or into the current project. To skip the
questions and install every skill globally for Claude Code:

```bash
npx skills add SpaiR/Skills -g -a claude-code -s '*' -y
```

The CLI copies each skill into `~/.claude/skills/<name>/`. `npx skills update -g` pulls newer versions.

# Skills

Personal Claude Code skills of SpaiR.

| Path | What it is |
| :- | :- |
| `skills/diff-review` | `/diff-review`: guided review of a diff, PR or MR in a local browser page. |
| `skills/bigwork` | `/bigwork`: a large task run as a dynamic workflow. |

## Install the skills

With the [`skills`](https://github.com/vercel-labs/skills) CLI, user-level, for Claude Code:

```bash
npx skills add <this repo> -g -a claude-code            # pick skills interactively
npx skills add <this repo> -g -a claude-code -s '*' -y  # all of them
```

The CLI copies each skill into `~/.claude/skills/<name>/`. `npx skills update -g` pulls newer versions.

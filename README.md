# Skills

Personal Claude Code skills and global instructions of SpaiR.

| Path | What it is |
| :- | :- |
| `skills/diff-review` | `/diff-review`: guided review of a diff, PR or MR in a local browser page. |
| `skills/bigwork` | `/bigwork`: a large task run as a dynamic workflow. |
| `global/CLAUDE.md` | Global instructions: voice, explaining, memory policy, execution rules. |

## Install the skills

With the [`skills`](https://github.com/vercel-labs/skills) CLI, user-level, for Claude Code:

```bash
npx skills add <this repo> -g -a claude-code            # pick skills interactively
npx skills add <this repo> -g -a claude-code -s '*' -y  # all of them
```

The CLI copies each skill into `~/.claude/skills/<name>/`. `npx skills update -g` pulls newer versions.

## Connect the global instructions

The `skills` CLI installs skills only, so `global/CLAUDE.md` is connected by an import from your user `CLAUDE.md`.
Clone the repository and add this line to `~/.claude/CLAUDE.md` (adjust the path to your clone):

```markdown
@~/Personal/Skills/global/CLAUDE.md
```

Remove the line to disconnect the instructions.

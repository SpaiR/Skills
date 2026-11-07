# Skills

Personal Claude Code skills and mods of SpaiR.

| Path | What it is |
| :- | :- |
| `skills/diff-review` | `/diff-review`: guided review of a diff, PR or MR in a local browser page. |
| `skills/bigwork` | `/bigwork`: a large task run as a dynamic workflow. |
| `mods/context-size` | Shows used context tokens next to the prompt footer's mode labels. |
| `mods/fork-title` | Renames a desktop fork titled "<parent> (fork)" after its first message. |

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

## Install the mods

The mods are Claude Code plugins in the `claude-mods` marketplace of this repository:

```bash
claude plugin marketplace add SpaiR/Skills
claude plugin install context-size@claude-mods
claude plugin install fork-title@claude-mods
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

# spair-skills

Claude Code plugin marketplace with two plugins:

| Plugin | What it adds |
| :- | :- |
| `spair` | Skills `/spair:diff-review` (guided review of a diff, PR or MR in a local browser page) and `/spair:bigwork` (a large task run as a dynamic workflow). |
| `spair-instructions` | Global instructions from `plugins/spair-instructions/context/CLAUDE.md`, loaded into every session by a `SessionStart` hook. Enable or disable it on its own. |

## Install

```bash
claude plugin marketplace add <this repo or a local path to it>
claude plugin install spair@spair-skills
claude plugin install spair-instructions@spair-skills
```

## Notes

- A plugin can't ship a `CLAUDE.md` that Claude Code loads as memory, so `spair-instructions` prints the file from a
  `SessionStart` hook instead. Hook output is capped at 10,000 characters; past that Claude gets only a file path and a
  2,000-character preview. Keep `context/CLAUDE.md` under the cap.
- `diff-review` keeps its own dev setup (tests, lint, commit hook) in `plugins/spair/skills/diff-review/`; see its
  `CONTRIBUTING.md`.

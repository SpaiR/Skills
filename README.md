# diff-review

A [Claude Code](https://claude.com/claude-code) skill for a guided review of local git changes. It collects the
diff of a working tree, branch, commit or range; a subagent writes a guide in Russian that splits the change into
sections (what changed, why, what it leads to); and a local web page shows the guide next to the diffs. You read,
mark files as viewed and leave line comments with suggestions; when you submit, the comments return to the Claude
Code session as feedback and Claude acts on them. Everything runs locally: a stdlib Python server on 127.0.0.1 and a
static page with no dependencies.

## Install

Put the repository into your Claude Code user skills directory:

```bash
git clone <this repo> ~/.claude/skills/diff-review
```

Requirements: `git`, Python 3.9+ and a browser. No packages to install for using the skill.

## Use

In a Claude Code session type `/diff-review` with optional arguments in any order:

```text
/diff-review                          # the change discussed in this session (since the base branch, incl. uncommitted)
/diff-review uncommitted              # HEAD vs. the working tree, incl. untracked files
/diff-review staged                   # the index only
/diff-review 3f2c1ab                  # a single commit
/diff-review main..feature            # a range (A..B or A...B)
/diff-review feature/login            # a branch from its merge-base with the base branch
/diff-review feature/login --base develop
/diff-review ~/work/app-wt uncommitted
/diff-review the worktree with the login fix
```

Claude prints a link to the local page. The page has two modes: «Гайд» (the guide) and «Файлы» (a file tree). Press
`?` on the page for keyboard shortcuts. Submit feedback, approve, or close; the session receives the result.

## Development

```bash
npm run setup     # dev dependencies + commit-msg hook
npm run lint
npm test          # unit, Python and browser tests
```

Development needs Node, Python 3, `uv` and Google Chrome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow
and [CLAUDE.md](CLAUDE.md) for the architecture, data contracts and project rules.

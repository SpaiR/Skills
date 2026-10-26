# diff-review

A [Claude Code](https://claude.com/claude-code) skill for a guided review of local git changes, GitHub pull requests
and GitLab merge requests. It collects the diff of a working tree, branch, commit, range or PR/MR; a subagent writes a guide in Russian that splits the change into
sections (what changed, why, what it leads to); and a local web page shows the guide next to the diffs. You read,
mark files as viewed and leave line comments with suggestions; when you submit, the comments return to the Claude
Code session as feedback and Claude acts on them. For an open PR/MR you can instead publish the review to GitHub or
GitLab from the page: line comments inside the diff go inline, the rest into the review text. Everything runs locally: a stdlib Python server on 127.0.0.1 and a
static page with no dependencies.

## Install

Put the repository into your Claude Code user skills directory:

```bash
git clone <this repo> ~/.claude/skills/diff-review
```

Requirements: `git`, Python 3.9+ and a browser. No packages to install for using the skill. For PRs/MRs: the
[GitHub CLI](https://cli.github.com) (`gh auth login`) and/or the [GitLab CLI](https://gitlab.com/gitlab-org/cli)
(`glab auth login --hostname <host>`, also for self-hosted GitLab).

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
/diff-review https://github.com/owner/repo/pull/123
/diff-review https://gitlab.example.com/group/project/-/merge_requests/45
/diff-review pr 123                   # also #123, mr 45, !45: resolved against the repository's origin
/diff-review pr                       # the PR/MR of the current branch
```

For a PR/MR, the commits are fetched into your local clone if one of its remotes is that repository (only objects and
`FETCH_HEAD` change), otherwise into a cache clone under `$TMPDIR/diff-review/repos/`.

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

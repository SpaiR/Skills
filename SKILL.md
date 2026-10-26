---
name: diff-review
description: Runs a guided review of local git changes, a GitHub pull request or a GitLab merge request in a local browser page. A subagent writes a guide in Russian that splits the changes into sections explaining what changed, why, and what it leads to, with the diffs alongside. Line comments made in the browser come back into the session as feedback, or are published to the PR/MR. With no argument, reviews the change discussed in the current session, including one made in a worktree. Free-text targets (for example "the worktree with the login fix") may be written in any language.
argument-hint: "[path] [uncommitted | staged | <sha> | <A>..<B> | <branch> | <PR/MR URL> | pr [N] | mr [N]] [--base <ref>] [free text]"
disable-model-invocation: true
allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/*), Bash(git -C * rev-parse *), Bash(git -C * status *), Bash(git -C * worktree list*), Bash(git -C * log *), Bash(git -C * branch *)
---

# diff-review

Guided review modelled on plannotator. You, the main session, decide what to review and collect the diff. A subagent
writes the guide. You validate the result, start the local page and handle the user's feedback.

Arguments: `$ARGUMENTS`

The scripts live in `${CLAUDE_SKILL_DIR}/scripts/`; each has `--help`. Do not read the diff yourself: the subagent needs
it, you do not.

**Languages.** The guide itself (`guide.json`) is always written in Russian; the subagent prompt below says so. Every
message you print to the user (status lines, errors, results) is written in the user's language, i.e. the language of the
conversation.

## 1. Determine the target

The target is a **repository** (a directory, often a worktree) plus a **mode** for `collect.py`, or a **PR/MR**.

Argument tokens, in any order:

| Token | Action |
|---|---|
| directory path | `--repo <path>` |
| `uncommitted` | `--mode uncommitted`: HEAD vs. the working tree, including untracked files |
| `staged` | `--mode staged`: the index only |
| `<sha>` | `--mode commit --ref <sha>` |
| `<A>..<B>`, `<A>...<B>` | `--mode range --ref <A>..<B>` |
| branch name | `--mode branch --ref <branch>`: from the merge-base with the base branch to the branch |
| PR/MR URL: `https://<host>/<owner>/<repo>/pull/<N>`, `https://<host>/<group>/<project>/-/merge_requests/<N>` | `--pr <url>` |
| `pr <N>`, `#<N>`, `mr <N>`, `!<N>` | `--pr "<token as given>"`: `gh`/`glab` resolve the number in the repository (as on their command line, e.g. upstream of a fork) |
| `pr`, `mr` alone | `--pr pr` / `--pr mr`: the PR/MR of the repository's current branch |
| `--base <ref>` | pass through as is (not with `--pr`) |
| none of the above | default mode `since-base`: from the merge-base with the base branch to the working tree, including untracked files |

Tell a branch from a sha with `git -C <repo> rev-parse --verify`. With `--pr`, still pass `--repo` (inferred as below):
`collect.py` fetches the PR commits into that repository if one of its remotes is the PR's repository (only objects and
`FETCH_HEAD` change, never refs, the working tree or the index), otherwise into a cache clone under `$TMPDIR`. GitHub and
GitLab are reached only through the `gh` and `glab` CLIs, inside the scripts. Match free text (e.g. "the worktree with the login
fix", possibly in Russian) against the session context using the rules below.

**If no repository is given**, infer it from this session, in priority order:

1. Where the discussed change was made: paths from Edit and Write, `EnterWorktree`, `git worktree add`, `cd` in Bash
   commands. Root: `git -C <dir> rev-parse --show-toplevel`. The session may have started on the main branch while the
   edits went into a worktree; then the target is the worktree.
2. A branch that was created or discussed. Find its worktree with `git -C <repo> worktree list`.
3. Otherwise, the repository of the current directory.

If several candidates fit and the choice is not obvious, ask with AskUserQuestion and list them. Do not guess.

## 2. Collect the diff

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/collect.py --repo <repo> [--mode <mode>] [--ref <ref>] [--base <ref>]
```

The script writes `guide.patch`, `full.patch` and `meta.json` into a new directory under `$TMPDIR/diff-review/...` and
prints a JSON summary that includes `outdir`. It does not touch the user's index.

- Exit code 3: no changes. Say so in one line and stop.
- Exit code 2: error, message on stderr. Show it to the user.
- If the summary has `notes` (e.g. the base branch was not found), pass them on to the user.
- With `--pr`, exit code 2 also covers a missing `gh`/`glab`, a missing login (the message names the `gh auth login` /
  `glab auth login` command to run; suggest the user runs it with the `!` prefix) and an inaccessible PR. Do not retry
  with other arguments on your own.

Before launching the subagent, tell the user in one line, in their language: the repository root (for a PR/MR: its URL
and title from the summary's `pr`), the label, the number of files and the line totals (+additions −deletions), and that a
subagent is writing the guide.

## 3. Launch the subagent

Call Agent with `subagent_type: "general-purpose"`, `model: "sonnet"`, `effort: "medium"`,
`description: "Guided review: <repo name>"`. Use the prompt below with the values filled in:

```
Write a guided review of a change set. Write all guide.json text in Russian.

Methodology and format (read this first): ${CLAUDE_SKILL_DIR}/references/guide-method.md
Diff: <outdir>/guide.patch
Metadata and the authoritative file list: <outdir>/meta.json
Repository (for targeted lookups only): <root>
<only if meta.json newRev is a commit sha, not "worktree" or "index":> The reviewed version is commit <newRev>; the working tree may be on another branch, so read files of that version with git -C <root> show <newRev>:<path>.
Write the result to: <outdir>/guide.json

Context from the author of the change: <1–3 sentences from this session on why the change was made; for a PR/MR: "see pr.title and pr.body in meta.json"; "none" if it was not discussed>

Rules:
- Change nothing in the repository: do not edit files, do not commit, do not touch the index. You may write only inside <outdir>.
- Before finishing, run the check and fix guide.json until it passes:
  python3 ${CLAUDE_SKILL_DIR}/scripts/validate.py --guide <outdir>/guide.json --meta <outdir>/meta.json
- Reply with one line: the number of sections and the validator output.
```

Wait for the completion notification. Do not write the guide yourself and do not read the diff while the subagent is
working.

## 4. Validate

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/validate.py --guide <outdir>/guide.json --meta <outdir>/meta.json
```

If it fails, send the validator output to the same subagent once via SendMessage and ask it to fix the guide. If it fails
again, show the user the errors and the `outdir` path, and stop.

## 5. Open the page

Run in the background (Bash with `run_in_background: true`):

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/serve.py --dir <outdir> --open
```

The first output line is `DIFF_REVIEW_URL: <url>`. Give the user the URL and tell them the session is free while they
read. The server waits up to 3 hours.

The page has two modes: «Гайд» (the guide, opened first) and «Файлы» (files, with a file tree). For an open PR/MR the page
also has «Опубликовать»: the user publishes the review to GitHub/GitLab from the page, after a confirmation dialog;
`serve.py` posts it through `gh`/`glab`. You never publish anything yourself. Both let the user expand
context between hunks and open a whole file: `collect.py` puts the full text of changed files into `full.patch`.

## 6. Handle the decision

When the background command finishes, its last output line is:

```
DIFF_REVIEW_RESULT: feedback|approved|published|closed|timeout [<path to feedback.md>]
```

- `feedback`: read `feedback.md` and treat it as a message from the user. It is their review of your or someone else's
  changes in the repository `<root>`. Answer questions. Make requested edits in `<root>`, i.e. in the worktree that was
  reviewed, not in the session's directory. Clarify anything ambiguous. Then offer to rerun `/diff-review` to check the
  result. For a PR/MR, edit only if its head branch is checked out in a local worktree (`git -C <repo> worktree list`);
  otherwise answer and ask where to make the changes.
- `approved`: confirm in one line. If `feedback.md` is attached, read it and take the comments into account. Do not
  commit anything unless asked separately.
- `published`: the review is already on GitHub/GitLab. Say so in one line with the PR/MR URL. Do not act on the comments
  unless asked separately.
- `closed` or `timeout`: say in one line that the review was closed without a response.

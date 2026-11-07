---
paths:
  - "skills/diff-review/scripts/**"
---

# Scripts (scripts/)

- External commands: `git`, and `gh`/`glab` only from `remote.py` and `publish.py`. Network access: the two CLIs
  (metadata, cache clones, publishing) and `git fetch` / lazy blob fetches of the PR commits. Credentials stay with
  `gh`, `glab` and git; the scripts never handle tokens.
- Python standard library only; target Python 3.9+ (`target-version` in `pyproject.toml`). No third-party
  imports, no `requirements.txt`. Ruff is a dev tool, run through `uvx`.
- Each script is a CLI with `--help` (argparse, module docstring as description). `serve.py` imports
  `split_patch` from `collect.py` and `validate` from `validate.py`; keep those importable without side effects.
- Output read by the session is English and stable; keep it short.

## Contracts with SKILL.md

- `collect.py` exit codes: `0` success (JSON summary with `outdir` on stdout), `2` argument or git error
  (`Error: ...` on stderr), `3` no changes (JSON with `"reason": "no-changes"` on stdout). `validate.py`: `0` ok,
  `1` errors. `SKILL.md` steps 2 and 4 branch on these.
- `serve.py` prints `DIFF_REVIEW_URL: <url>` as its first line and `DIFF_REVIEW_RESULT: <status> [<path>]` as its
  last line, statuses `feedback|approved|published|closed|timeout`. Nothing else goes to stdout. `SKILL.md` steps 5 and 6
  parse these markers: change both sides together.

## Never touch the user's repository state

- `collect.py` only reads. Untracked files are added with `git add -N` to a temporary copy of the index via
  `GIT_INDEX_FILE` (`untracked_index_env()`), deleted afterwards.
- The copy is made with `shutil.copy2` to keep the index mtime. With a fresh mtime git would no longer see entries
  as "racily clean", would not re-read a file edited right after `add`/`commit` without a size change, and that
  file would vanish from the diff. Do not replace it with `shutil.copy` or a fresh `read-tree`.
- No writes to the working tree, the real index, refs or config. The one exception is `collect.py --pr`: it may
  `git fetch --refmap=` the PR/MR commits into the user's matching clone, which adds objects and updates
  `FETCH_HEAD`, nothing else (no remote-tracking refs). Everything else goes to the cache clone under
  `$TMPDIR/diff-review/repos/`.
- Run git with `core.quotePath=false` and the fixed `DIFF_FLAGS` (no colour, no external diff, no textconv).

## meta.json versions

- `META_VERSION` in `collect.py` is the meta.json version (currently 3). Adding an optional field is compatible;
  renaming, removing or changing the meaning of a field or a code bumps the version (breaking, see `git.md`).
- The viewer must keep reading older outdirs; what v1/v2 lack and how the viewer falls back is in "Data contracts"
  in `architecture.md`. When you bump, add the fallback in `assets/js/strings.js`/`expand.js` and a test.
- New `notes[].code` or `content.reason` codes need Russian text in `strings.js` (`NOTES`, `FULL_TEXT_REASONS`).
- Machine data in meta is codes, not prose (field details in `architecture.md`).

## Publishing (publish.py)

- Only on an explicit `POST /api/publish` from the page; nothing is posted on startup, timeout or close.
- GitHub: one atomic review; GitLab: discussions, then the note, then approve, each recorded in `published.json`
  (keyed by the step's content, so an edited comment is posted, not skipped) so a retry never posts the same thing
  twice. A complete publish deletes `published.json`.
- Submits, publishes and the timeout share one lock in `serve.py`: whichever finishes first wins, and a publish in
  flight is never cut off by a close or a timeout. The request/response contract is in `publish.py`'s docstring; the page builds the
  payload in `assets/js/publish.js`; change both together.

## serve.py security

- Bind to `127.0.0.1` only.
- Every request checks the `Host` header (`127.0.0.1` or `localhost`) against DNS rebinding.
- Every `/api/*` call requires the per-run `X-Review-Token` (from `secrets.token_urlsafe`, compared with
  `secrets.compare_digest`).
- `asset_file()` serves only files under `assets/` with a known extension and rejects paths that resolve outside.
- Request bodies are capped at `MAX_BODY`; responses send `nosniff` and `no-store`. API errors are English codes
  that the viewer maps to text (`SERVER_ERRORS` in `strings.js`).

#!/usr/bin/env python3
"""Collect a git diff for diff-review: guide.patch, full.patch and meta.json in an output directory.

Modes:
  since-base   merge-base(base, HEAD) against the working tree, plus untracked files (default)
  uncommitted  HEAD against the working tree, plus untracked files
  staged       index against HEAD
  commit       a single commit (--ref <sha>)
  range        a revision range (--ref A..B or A...B)
  branch       merge-base(base, branch)..branch (--ref <branch>)

--pr <ref> collects a GitHub pull request or GitLab merge request instead (URL, #N, !N, `pr N`, `mr N`, or a bare
`pr` / `mr` for the PR of the current branch; see remote.py). The PR commits are fetched into the local clone of the
repository (or a cache clone) and diffed as merge-base..head; --mode, --ref and --base cannot be combined with it.

The user's index is never modified: untracked files are added with `git add -N`
to a temporary copy of the index (GIT_INDEX_FILE).

Exit codes: 0 - success, 2 - argument or git error, 3 - no changes.

meta.json (version 3) carries no prose for the viewer: `range` describes the diff range, `notes` are
{code, text} objects and `content.reason` of a file without full text is a code. The viewer turns
them into page text; `label` and the note `text` are plain English for the session summary.
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import remote

EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
DIFF_FLAGS = [
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
]
LOG_LIMIT = 50
# Full text (full.patch) for context expansion in the viewer: only for modified and renamed files.
FULL_CONTEXT = "-U100000000"
FULL_FILE_MAX = 1024 * 1024  # new side of a file larger than this gets no full text
FULL_TOTAL_MAX = 64 * 1024 * 1024  # total size limit for full.patch
META_VERSION = 3
# Notes about how the diff was collected: code for the viewer, English text for the session summary.
NOTE_TEXT = {
    "no_commits": "the repository has no commits, all working tree files are included",
    "base_not_found": "base branch not found, only uncommitted changes are included",
    "full_text_mismatch": "full file text not collected: git output did not match the file list, "
    "context expansion is unavailable",
}


def note(code):
    return {"code": code, "text": NOTE_TEXT[code]}


class CollectError(Exception):
    pass


def git(root, *args, env=None, check=True):
    cmd = ["git", "-c", "core.quotePath=false", "-C", str(root), *args]
    res = subprocess.run(cmd, capture_output=True, env=env)
    if check and res.returncode != 0:
        raise CollectError(f"git {' '.join(args)}: {res.stderr.decode(errors='replace').strip()}")
    return res


def out(root, *args, **kw):
    return git(root, *args, **kw).stdout.decode(errors="replace").strip()


def verify(root, ref):
    res = git(root, "rev-parse", "--verify", "-q", f"{ref}^{{commit}}", check=False)
    return res.stdout.decode().strip() if res.returncode == 0 else None


def resolve_base(root, explicit):
    if explicit:
        if not verify(root, explicit):
            raise CollectError(f"base `{explicit}` not found")
        return explicit
    res = git(root, "symbolic-ref", "-q", "refs/remotes/origin/HEAD", check=False)
    if res.returncode == 0:
        ref = res.stdout.decode().strip().removeprefix("refs/remotes/")
        if verify(root, ref):
            return ref
    for name in ("main", "master", "develop"):
        for ref in (f"origin/{name}", name):
            if verify(root, ref):
                return ref
    return None


def untracked_index_env(root):
    """Temporary index with untracked files added in intent-to-add mode."""
    files = [
        f
        for f in git(root, "ls-files", "--others", "--exclude-standard", "-z")
        .stdout.decode(errors="surrogateescape")
        .split("\0")
        if f
    ]
    if not files:
        return None, None, 0
    index = Path(out(root, "rev-parse", "--path-format=absolute", "--git-path", "index"))
    tmpdir = tempfile.mkdtemp(prefix="diff-review-index-")
    tmp_index = Path(tmpdir) / "index"
    if index.exists():
        # copy2 preserves the index mtime. With a fresh mtime git would not treat entries as "racily clean"
        # and would not re-read a file edited right after add/commit without a size change, so that file
        # would vanish from the diff.
        shutil.copy2(index, tmp_index)
    env = {**os.environ, "GIT_INDEX_FILE": str(tmp_index)}
    # Pass paths via stdin to stay clear of the command-line length limit.
    subprocess.run(
        ["git", "-C", str(root), "add", "-N", "--pathspec-from-file=-", "--pathspec-file-nul"],
        input="\0".join(files).encode(errors="surrogateescape"),
        env=env,
        check=True,
        capture_output=True,
    )
    return env, tmpdir, len(files)


def parse_name_status(raw):
    parts = raw.split("\0")
    entries, i = [], 0
    while i < len(parts) and parts[i]:
        code = parts[i]
        kind = code[0]
        if kind in "RC":
            entries.append({"status": kind, "oldPath": parts[i + 1], "path": parts[i + 2]})
            i += 3
        else:
            entries.append({"status": kind, "oldPath": None, "path": parts[i + 1]})
            i += 2
    return entries


def parse_numstat(raw):
    parts = raw.split("\0")
    stats, i = [], 0
    while i < len(parts) and parts[i]:
        adds, dels, path = parts[i].split("\t", 2)
        if path == "":  # rename: the old and new paths follow
            path = parts[i + 2]
            i += 3
        else:
            i += 1
        binary = adds == "-"
        stats.append(
            {
                "path": path,
                "additions": 0 if binary else int(adds),
                "deletions": 0 if binary else int(dels),
                "binary": binary,
            }
        )
    return stats


def split_patch(patch):
    """Split a patch into per-file chunks. Content lines always start with ' ', '+' or '-',
    so 'diff --git ' at the start of a line is always a file header."""
    chunks = re.split(r"(?m)^(?=diff --git )", patch)
    return [c for c in chunks if c.startswith("diff --git ")]


def log_lines(root, log_args):
    if not log_args:
        return []
    res = git(root, "log", "--oneline", "--no-decorate", f"-{LOG_LIMIT}", *log_args, check=False)
    return [ln for ln in res.stdout.decode(errors="replace").splitlines() if ln]


def new_side_sizes(root, new_rev, paths):
    """Size in bytes of the new side of each file; None if it could not be determined."""
    if new_rev == "worktree":
        sizes = []
        for p in paths:
            try:
                sizes.append(os.lstat(root / p).st_size)
            except OSError:
                sizes.append(None)
        return sizes
    prefix = ":" if new_rev == "index" else f"{new_rev}:"
    res = subprocess.run(
        ["git", "-C", str(root), "cat-file", "--batch-check"],
        input="".join(f"{prefix}{p}\n" for p in paths).encode(),
        capture_output=True,
    )
    lines = res.stdout.decode(errors="replace").splitlines()
    if res.returncode != 0 or len(lines) != len(paths):
        return [None] * len(paths)
    sizes = []
    for line in lines:
        parts = line.split()
        sizes.append(int(parts[2]) if len(parts) == 3 and parts[1] == "blob" else None)
    return sizes


def collect_full(root, diff_args, env, new_rev, name_status, numstat, notes):
    """Full diff (one hunk per file) for modified and renamed files.

    Returns {"chunks": {file index: patch chunk}, "lines": {index: line count of the new version},
    "reasons": {index: code of why there is no full text}}. Codes: binary, unchanged, unreadable,
    too_large (the file is over FULL_FILE_MAX), total_limit (FULL_TOTAL_MAX reached), not_collected.
    It is the same git diff as for guide.patch, only with a huge context: lines go through the same
    filters (eol, LFS), and the set of changes does not depend on the context length.
    """
    chunks, lines, reasons = {}, {}, {}
    mr = [i for i, ns in enumerate(name_status) if ns["status"] in "MR"]
    cand = []
    for i in mr:
        st = numstat[i]
        if st["binary"]:
            reasons[i] = "binary"
        elif not st["additions"] and not st["deletions"]:
            reasons[i] = "unchanged"
        else:
            cand.append(i)
    if not cand:
        return {"chunks": chunks, "lines": lines, "reasons": reasons}
    sizes = new_side_sizes(root, new_rev, [name_status[i]["path"] for i in cand])
    keep, excluded, total = [], set(), 0
    for i, size in zip(cand, sizes):
        if size is None:
            reasons[i] = "unreadable"
        elif size > FULL_FILE_MAX:
            reasons[i] = "too_large"
        elif total + size > FULL_TOTAL_MAX:
            reasons[i] = "total_limit"
        else:
            total += size
            keep.append(i)
            continue
        excluded.add(i)
    if not keep:
        return {"chunks": chunks, "lines": lines, "reasons": reasons}
    specs = ["."]
    for i in sorted(excluded):
        for p in {name_status[i]["path"], name_status[i]["oldPath"]} - {None}:
            specs.append(f":(exclude,literal){p}")
    raw = git(
        root, "diff", *DIFF_FLAGS, FULL_CONTEXT, "--diff-filter=MR", *diff_args, "--", *specs, env=env, check=False
    )
    got = split_patch(raw.stdout.decode(errors="replace")) if raw.returncode == 0 else []
    expected = [i for i in mr if i not in excluded]
    if len(got) != len(expected):
        notes.append(note("full_text_mismatch"))
        for i in keep:
            reasons[i] = "not_collected"
        return {"chunks": {}, "lines": {}, "reasons": reasons}
    keep_set = set(keep)
    for i, chunk in zip(expected, got):
        if i not in keep_set:
            continue
        # Git quotes paths with special characters; such a file simply stays without full text.
        same = chunk.split("\n", 1)[0].endswith(f" b/{name_status[i]['path']}")
        if not same or len(re.findall(r"(?m)^@@ ", chunk)) != 1:
            reasons[i] = "not_collected"
            continue
        chunks[i] = chunk
        body = chunk.split("\n@@ ", 1)[1].split("\n")[1:]
        lines[i] = sum(1 for ln in body if ln[:1] in (" ", "+"))
    return {"chunks": chunks, "lines": lines, "reasons": reasons}


def file_content(i, full):
    """meta "content" of file i: the line count of the full text or the code of why there is none.
    Files outside collect_full (added, deleted, copied) get in_diff: the diff already shows all of them."""
    if i in full["chunks"]:
        return {"available": True, "lines": full["lines"][i]}
    reason = full["reasons"].get(i, "in_diff")
    content = {"available": False, "reason": reason}
    if reason == "too_large":
        content["limitKiB"] = FULL_FILE_MAX // 1024
    return content


def open_repo(path):
    """(root, repo name) of the repository or worktree that contains `path`."""
    repo = Path(path).expanduser().resolve()
    if not repo.exists():
        raise CollectError(f"directory `{repo}` does not exist")
    res = git(repo, "rev-parse", "--show-toplevel", check=False)
    if res.returncode != 0:
        raise CollectError(f"`{repo}` is not inside a git repository")
    root = Path(res.stdout.decode().strip())
    # For a worktree, take the repository name from the common .git, not from the worktree directory.
    common = Path(out(root, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    return root, common.parent.name if common.name == ".git" else root.name


def prepare_pr(args):
    """Fetch the PR metadata and commits (remote.py); returns (root, pr)."""
    try:
        return remote.prepare(args.pr, Path(args.repo).expanduser())
    except remote.RemoteError as e:
        raise CollectError(str(e)) from e


def pr_label(pr):
    if pr["provider"] == "github":
        return f"GitHub PR {pr['repo']}#{pr['number']}"
    return f"GitLab MR {pr['repo']}!{pr['number']}"


def collect(args):
    pr = None
    if getattr(args, "pr", None):
        root, pr = prepare_pr(args)
        repo_name = pr["repo"].rsplit("/", 1)[-1]
        head, branch, mode = pr["headSha"], pr["headRef"], "pr"
    else:
        root, repo_name = open_repo(args.repo)
        head = verify(root, "HEAD")
        branch = (
            out(root, "rev-parse", "--abbrev-ref", "HEAD")
            if head
            else out(root, "symbolic-ref", "--short", "-q", "HEAD", check=False)
        )
        mode = args.mode or "since-base"
    notes = []
    base = merge_base = None
    use_untracked = False
    log_args = []

    if mode == "since-base":
        base = resolve_base(root, args.base)
        if not head:
            notes.append(note("no_commits"))
            mode = "uncommitted"
        elif not base:
            notes.append(note("base_not_found"))
            mode = "uncommitted"
        else:
            merge_base = out(root, "merge-base", base, "HEAD")
            diff_args, use_untracked, new_rev = [merge_base], True, "worktree"
            log_args = [f"{merge_base}..HEAD"]
            label = f"{base}...HEAD + uncommitted"
            rng = {"mode": "since-base", "base": base}

    if mode == "pr":
        base, merge_base = pr["baseRef"], pr["mergeBaseSha"]
        diff_args, log_args, new_rev = [merge_base, head], [f"{merge_base}..{head}"], head
        label = pr_label(pr)
        rng = {key: pr[key] for key in ("provider", "host", "repo", "number", "url")}
        rng = {"mode": "pr", **rng}
    elif mode == "uncommitted":
        diff_args, use_untracked, new_rev = ["HEAD" if head else EMPTY_TREE], True, "worktree"
        label = "HEAD + uncommitted" if head else "working tree (no commits)"
        rng = {"mode": "uncommitted", "hasCommits": bool(head)}
    elif mode == "staged":
        diff_args, new_rev = ["--cached", "HEAD" if head else EMPTY_TREE], "index"
        label = "index (staged)"
        rng = {"mode": "staged"}
    elif mode == "commit":
        if not args.ref:
            raise CollectError("commit mode requires --ref <sha>")
        sha = verify(root, args.ref)
        if not sha:
            raise CollectError(f"commit `{args.ref}` not found")
        parent = verify(root, f"{sha}^") or EMPTY_TREE
        diff_args, log_args, new_rev = [parent, sha], ["-1", sha], sha
        subject = out(root, "log", "-1", "--format=%s", sha)
        label = f"{sha[:10]} {subject}"
        rng = {"mode": "commit", "sha": sha, "subject": subject}
    elif mode == "range":
        m = re.fullmatch(r"(.*?)(\.\.\.?)(.*)", args.ref or "")
        if not m:
            raise CollectError("range mode requires --ref A..B or A...B")
        a, dots, b = m.group(1) or "HEAD", m.group(2), m.group(3) or "HEAD"
        for r in (a, b):
            if not verify(root, r):
                raise CollectError(f"revision `{r}` not found")
        if dots == "...":
            merge_base = out(root, "merge-base", a, b)
            diff_args, log_args = [merge_base, b], [f"{merge_base}..{b}"]
        else:
            diff_args, log_args = [a, b], [f"{a}..{b}"]
        new_rev = b
        label = f"{a}{dots}{b}"
        rng = {"mode": "range", "from": a, "dots": dots, "to": b}
    elif mode == "branch":
        if not args.ref or not verify(root, args.ref):
            raise CollectError(f"branch `{args.ref}` not found")
        base = resolve_base(root, args.base)
        if not base:
            raise CollectError("base branch not found, pass --base")
        merge_base = out(root, "merge-base", base, args.ref)
        diff_args, log_args, new_rev = [merge_base, args.ref], [f"{merge_base}..{args.ref}"], args.ref
        label = f"{base}...{args.ref}"
        rng = {"mode": "branch", "base": base, "ref": args.ref}

    env, tmpdir, untracked = (None, None, 0)
    try:
        if use_untracked:
            env, tmpdir, untracked = untracked_index_env(root)
        patch = git(root, "diff", *DIFF_FLAGS, "-U3", *diff_args, env=env).stdout.decode(errors="replace")
        name_status = parse_name_status(
            git(root, "diff", "--name-status", "-z", "--find-renames", *diff_args, env=env).stdout.decode(
                errors="replace"
            )
        )
        numstat = parse_numstat(
            git(root, "diff", "--numstat", "-z", "--find-renames", *diff_args, env=env).stdout.decode(errors="replace")
        )
        full = collect_full(root, diff_args, env, new_rev, name_status, numstat, notes)
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)

    chunks = split_patch(patch)
    if not chunks:
        return None, {"root": str(root), "label": label, "notes": notes}, None
    if not (len(chunks) == len(name_status) == len(numstat)):
        raise CollectError(
            f"out of sync: {len(chunks)} patch chunks, {len(name_status)} in name-status, {len(numstat)} in numstat"
        )

    status_names = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed", "C": "copied", "T": "typechange"}
    files = []
    for i, (ns, st, _chunk) in enumerate(zip(name_status, numstat, chunks)):
        if ns["path"] != st["path"]:
            raise CollectError(f"paths out of sync: `{ns['path']}` and `{st['path']}`")
        files.append(
            {
                "path": ns["path"],
                "oldPath": ns["oldPath"],
                "status": status_names.get(ns["status"], "modified"),
                "additions": st["additions"],
                "deletions": st["deletions"],
                "binary": st["binary"],
                "content": file_content(i, full),
            }
        )

    meta = {
        "version": META_VERSION,
        "root": str(root),
        "repoName": repo_name,
        "worktree": root.name if repo_name != root.name and not pr else None,
        "branch": branch or None,
        "head": head,
        "mode": mode,
        "label": label,
        "range": rng,
        "base": base,
        "mergeBase": merge_base,
        "newRev": new_rev,
        "untrackedIncluded": untracked,
        "commits": log_lines(root, log_args),
        "notes": notes,
        "createdAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "files": files,
        "totals": {
            "files": len(files),
            "additions": sum(f["additions"] for f in files),
            "deletions": sum(f["deletions"] for f in files),
        },
    }
    if pr:
        meta["pr"] = pr
    return patch, meta, "".join(full["chunks"][i] for i in sorted(full["chunks"]))


def default_outdir(meta):
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    pr = meta.get("pr")
    if pr:
        branch = ("mr" if pr["provider"] == "gitlab" else "pr") + str(pr["number"])
    else:
        branch = re.sub(r"[^A-Za-z0-9._-]+", "-", meta.get("branch") or "detached")
    return Path(tempfile.gettempdir()) / "diff-review" / f"{meta['repoName']}-{branch}-{stamp}"


def note_texts(meta):
    """Notes for the JSON summary the session reads: English text only."""
    return [n["text"] for n in meta["notes"]]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--repo", default=".", help="repository or worktree directory")
    p.add_argument(
        "--mode",
        choices=["since-base", "uncommitted", "staged", "commit", "range", "branch"],
        help="what to diff (default: since-base)",
    )
    p.add_argument("--ref", help="sha, A..B / A...B or a branch name, depending on the mode")
    p.add_argument("--base", help="base for since-base and branch")
    p.add_argument("--pr", help="GitHub PR / GitLab MR: URL, #N, !N, `pr N`, `mr N`, or bare `pr` / `mr`")
    p.add_argument("--out", help="output directory (default: $TMPDIR/diff-review/...)")
    args = p.parse_args()
    if args.pr and (args.mode or args.ref or args.base):
        p.error("--pr cannot be combined with --mode, --ref or --base")

    try:
        patch, meta, full_patch = collect(args)
    except CollectError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(2)

    if patch is None:
        print(json.dumps({"ok": False, "reason": "no-changes", **meta, "notes": note_texts(meta)}, ensure_ascii=False))
        print(f"No changes: `{meta['root']}`, {meta['label']}.", file=sys.stderr)
        sys.exit(3)

    outdir = Path(args.out).expanduser() if args.out else default_outdir(meta)
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "guide.patch").write_text(patch, encoding="utf-8")
    (outdir / "full.patch").write_text(full_patch, encoding="utf-8")
    (outdir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    t = meta["totals"]
    summary = {
        "ok": True,
        "outdir": str(outdir),
        "root": meta["root"],
        "branch": meta["branch"],
        "mode": meta["mode"],
        "label": meta["label"],
        "files": t["files"],
        "additions": t["additions"],
        "deletions": t["deletions"],
        "untrackedIncluded": meta["untrackedIncluded"],
        "commits": len(meta["commits"]),
        "notes": note_texts(meta),
    }
    if "pr" in meta:
        summary["pr"] = {"url": meta["pr"]["url"], "title": meta["pr"]["title"]}
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

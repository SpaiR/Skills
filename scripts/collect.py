#!/usr/bin/env python3
"""Собирает дифф для diff-review: guide.patch + meta.json в выходной каталог.

Режимы:
  since-base   merge-base(base, HEAD) против рабочего дерева, плюс untracked (по умолчанию)
  uncommitted  HEAD против рабочего дерева, плюс untracked
  staged       индекс против HEAD
  commit       один коммит (--ref <sha>)
  range        диапазон (--ref A..B или A...B)
  branch       merge-base(base, ветка)..ветка (--ref <ветка>)

Индекс пользователя не меняется: untracked-файлы добавляются через `git add -N`
во временную копию индекса (GIT_INDEX_FILE).

Код выхода: 0 — успех, 2 — ошибка аргументов/git, 3 — изменений нет.
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

EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
DIFF_FLAGS = [
    "--no-color", "--no-ext-diff", "--no-textconv", "--find-renames",
    "--src-prefix=a/", "--dst-prefix=b/",
]
LOG_LIMIT = 50
# Полный текст (full.patch) для раскрытия контекста во вьюере: только у изменённых и переименованных файлов.
FULL_CONTEXT = "-U100000000"
FULL_FILE_MAX = 1024 * 1024        # новая сторона файла больше этого — без полного текста
FULL_TOTAL_MAX = 64 * 1024 * 1024  # общий лимит full.patch


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
            raise CollectError(f"база `{explicit}` не найдена")
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
    """Временный индекс с untracked-файлами в режиме intent-to-add."""
    files = [f for f in git(root, "ls-files", "--others", "--exclude-standard", "-z")
             .stdout.decode(errors="surrogateescape").split("\0") if f]
    if not files:
        return None, None, 0
    index = Path(out(root, "rev-parse", "--path-format=absolute", "--git-path", "index"))
    tmpdir = tempfile.mkdtemp(prefix="diff-review-index-")
    tmp_index = Path(tmpdir) / "index"
    if index.exists():
        # copy2 сохраняет mtime индекса. С новым mtime git счёл бы записи не «racily clean» и не перечитал бы
        # файл, правленный сразу после add/commit без смены размера: такой файл пропал бы из диффа.
        shutil.copy2(index, tmp_index)
    env = {**os.environ, "GIT_INDEX_FILE": str(tmp_index)}
    # Через stdin, чтобы не упереться в лимит длины командной строки.
    subprocess.run(
        ["git", "-C", str(root), "add", "-N", "--pathspec-from-file=-", "--pathspec-file-nul"],
        input="\0".join(files).encode(errors="surrogateescape"), env=env, check=True,
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
        if path == "":  # переименование: дальше идут старый и новый путь
            path = parts[i + 2]
            i += 3
        else:
            i += 1
        binary = adds == "-"
        stats.append({"path": path, "additions": 0 if binary else int(adds),
                      "deletions": 0 if binary else int(dels), "binary": binary})
    return stats


def split_patch(patch):
    """Режет патч на куски по файлам. Строки контента всегда начинаются с ' ', '+', '-',
    поэтому 'diff --git ' в начале строки — только заголовок файла."""
    chunks = re.split(r"(?m)^(?=diff --git )", patch)
    return [c for c in chunks if c.startswith("diff --git ")]


def log_lines(root, log_args):
    if not log_args:
        return []
    res = git(root, "log", "--oneline", "--no-decorate", f"-{LOG_LIMIT}", *log_args, check=False)
    return [l for l in res.stdout.decode(errors="replace").splitlines() if l]


def new_side_sizes(root, new_rev, paths):
    """Размер новой стороны каждого файла в байтах; None — не удалось узнать."""
    if new_rev == "worktree":
        sizes = []
        for p in paths:
            try:
                sizes.append(os.lstat(root / p).st_size)
            except OSError:
                sizes.append(None)
        return sizes
    prefix = ":" if new_rev == "index" else f"{new_rev}:"
    res = subprocess.run(["git", "-C", str(root), "cat-file", "--batch-check"],
                         input="".join(f"{prefix}{p}\n" for p in paths).encode(), capture_output=True)
    lines = res.stdout.decode(errors="replace").splitlines()
    if res.returncode != 0 or len(lines) != len(paths):
        return [None] * len(paths)
    sizes = []
    for line in lines:
        parts = line.split()
        sizes.append(int(parts[2]) if len(parts) == 3 and parts[1] == "blob" else None)
    return sizes


def collect_full(root, diff_args, env, new_rev, name_status, numstat, notes):
    """Полный дифф (один ханк на файл) для изменённых и переименованных файлов.

    Возвращает {"chunks": {индекс файла: кусок патча}, "lines": {индекс: строк в новой версии},
    "reasons": {индекс: почему нет}}.
    Тот же git diff, что и для guide.patch, только с огромным контекстом: строки проходят те же
    фильтры (eol, LFS), а набор правок от длины контекста не зависит.
    """
    chunks, lines, reasons = {}, {}, {}
    mr = [i for i, ns in enumerate(name_status) if ns["status"] in "MR"]
    cand = []
    for i in mr:
        st = numstat[i]
        if st["binary"]:
            reasons[i] = "бинарный файл"
        elif not st["additions"] and not st["deletions"]:
            reasons[i] = "содержимое не менялось"
        else:
            cand.append(i)
    if not cand:
        return {"chunks": chunks, "lines": lines, "reasons": reasons}
    sizes = new_side_sizes(root, new_rev, [name_status[i]["path"] for i in cand])
    keep, excluded, total = [], set(), 0
    for i, size in zip(cand, sizes):
        if size is None:
            reasons[i] = "не удалось прочитать файл"
        elif size > FULL_FILE_MAX:
            reasons[i] = f"файл больше {FULL_FILE_MAX // 1024} КиБ"
        elif total + size > FULL_TOTAL_MAX:
            reasons[i] = "превышен общий лимит полного текста"
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
    raw = git(root, "diff", *DIFF_FLAGS, FULL_CONTEXT, "--diff-filter=MR", *diff_args, "--", *specs,
              env=env, check=False)
    got = split_patch(raw.stdout.decode(errors="replace")) if raw.returncode == 0 else []
    expected = [i for i in mr if i not in excluded]
    if len(got) != len(expected):
        notes.append("полный текст файлов не собран: вывод git не сошёлся со списком файлов, "
                     "раскрытие контекста недоступно")
        for i in keep:
            reasons[i] = "не собран"
        return {"chunks": {}, "lines": {}, "reasons": reasons}
    keep_set = set(keep)
    for i, chunk in zip(expected, got):
        if i not in keep_set:
            continue
        # Путь со спецсимволами git пишет в кавычках — такой файл просто остаётся без полного текста.
        same = chunk.split("\n", 1)[0].endswith(f" b/{name_status[i]['path']}")
        if not same or len(re.findall(r"(?m)^@@ ", chunk)) != 1:
            reasons[i] = "не собран"
            continue
        chunks[i] = chunk
        body = chunk.split("\n@@ ", 1)[1].split("\n")[1:]
        lines[i] = sum(1 for l in body if l[:1] in (" ", "+"))
    return {"chunks": chunks, "lines": lines, "reasons": reasons}


def collect(args):
    repo = Path(args.repo).expanduser().resolve()
    if not repo.exists():
        raise CollectError(f"каталог `{repo}` не существует")
    res = git(repo, "rev-parse", "--show-toplevel", check=False)
    if res.returncode != 0:
        raise CollectError(f"`{repo}` не внутри git-репозитория")
    root = Path(res.stdout.decode().strip())
    # Для worktree имя репозитория берём у общего .git, а не у каталога worktree.
    common = Path(out(root, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    repo_name = common.parent.name if common.name == ".git" else root.name

    head = verify(root, "HEAD")
    branch = out(root, "rev-parse", "--abbrev-ref", "HEAD") if head else out(
        root, "symbolic-ref", "--short", "-q", "HEAD", check=False)
    mode = args.mode
    notes = []
    base = merge_base = None
    use_untracked = False
    log_args = []

    if mode == "since-base":
        base = resolve_base(root, args.base)
        if not head:
            notes.append("в репозитории нет коммитов, взяты все файлы рабочего дерева")
            mode = "uncommitted"
        elif not base:
            notes.append("базовая ветка не найдена, взяты только незакоммиченные изменения")
            mode = "uncommitted"
        else:
            merge_base = out(root, "merge-base", base, "HEAD")
            diff_args, use_untracked, new_rev = [merge_base], True, "worktree"
            log_args = [f"{merge_base}..HEAD"]
            label = f"{base}...HEAD + незакоммиченное"

    if mode == "uncommitted":
        diff_args, use_untracked, new_rev = ["HEAD" if head else EMPTY_TREE], True, "worktree"
        label = "HEAD + незакоммиченное" if head else "рабочее дерево (коммитов нет)"
    elif mode == "staged":
        diff_args, new_rev = ["--cached", "HEAD" if head else EMPTY_TREE], "index"
        label = "индекс (staged)"
    elif mode == "commit":
        if not args.ref:
            raise CollectError("для режима commit нужен --ref <sha>")
        sha = verify(root, args.ref)
        if not sha:
            raise CollectError(f"коммит `{args.ref}` не найден")
        parent = verify(root, f"{sha}^") or EMPTY_TREE
        diff_args, log_args, new_rev = [parent, sha], ["-1", sha], sha
        label = f"{sha[:10]} {out(root, 'log', '-1', '--format=%s', sha)}"
    elif mode == "range":
        m = re.fullmatch(r"(.*?)(\.\.\.?)(.*)", args.ref or "")
        if not m:
            raise CollectError("для режима range нужен --ref A..B или A...B")
        a, dots, b = m.group(1) or "HEAD", m.group(2), m.group(3) or "HEAD"
        for r in (a, b):
            if not verify(root, r):
                raise CollectError(f"ревизия `{r}` не найдена")
        if dots == "...":
            merge_base = out(root, "merge-base", a, b)
            diff_args, log_args = [merge_base, b], [f"{merge_base}..{b}"]
        else:
            diff_args, log_args = [a, b], [f"{a}..{b}"]
        new_rev = b
        label = f"{a}{dots}{b}"
    elif mode == "branch":
        if not args.ref or not verify(root, args.ref):
            raise CollectError(f"ветка `{args.ref}` не найдена")
        base = resolve_base(root, args.base)
        if not base:
            raise CollectError("базовая ветка не найдена, укажите --base")
        merge_base = out(root, "merge-base", base, args.ref)
        diff_args, log_args, new_rev = [merge_base, args.ref], [f"{merge_base}..{args.ref}"], args.ref
        label = f"{base}...{args.ref}"

    env, tmpdir, untracked = (None, None, 0)
    try:
        if use_untracked:
            env, tmpdir, untracked = untracked_index_env(root)
        patch = git(root, "diff", *DIFF_FLAGS, "-U3", *diff_args, env=env).stdout.decode(errors="replace")
        name_status = parse_name_status(
            git(root, "diff", "--name-status", "-z", "--find-renames", *diff_args, env=env)
            .stdout.decode(errors="replace"))
        numstat = parse_numstat(
            git(root, "diff", "--numstat", "-z", "--find-renames", *diff_args, env=env)
            .stdout.decode(errors="replace"))
        full = collect_full(root, diff_args, env, new_rev, name_status, numstat, notes)
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)

    chunks = split_patch(patch)
    if not chunks:
        return None, {"root": str(root), "label": label, "notes": notes}, None
    if not (len(chunks) == len(name_status) == len(numstat)):
        raise CollectError(
            f"рассинхрон: {len(chunks)} кусков патча, {len(name_status)} в name-status, "
            f"{len(numstat)} в numstat")

    status_names = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed",
                    "C": "copied", "T": "typechange"}
    files = []
    for i, (ns, st, chunk) in enumerate(zip(name_status, numstat, chunks)):
        if ns["path"] != st["path"]:
            raise CollectError(f"рассинхрон путей: `{ns['path']}` и `{st['path']}`")
        files.append({
            "path": ns["path"],
            "oldPath": ns["oldPath"],
            "status": status_names.get(ns["status"], "modified"),
            "additions": st["additions"],
            "deletions": st["deletions"],
            "binary": st["binary"],
            "content": {"available": True, "lines": full["lines"][i]} if i in full["chunks"] else
                       {"available": False, "reason": full["reasons"].get(i, "весь файл уже в диффе")},
        })

    meta = {
        "version": 2,
        "root": str(root),
        "repoName": repo_name,
        "worktree": root.name if repo_name != root.name else None,
        "branch": branch or None,
        "head": head,
        "mode": mode,
        "label": label,
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
    return patch, meta, "".join(full["chunks"][i] for i in sorted(full["chunks"]))


def default_outdir(meta):
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    branch = re.sub(r"[^A-Za-z0-9._-]+", "-", meta.get("branch") or "detached")
    return Path(tempfile.gettempdir()) / "diff-review" / f"{meta['repoName']}-{branch}-{stamp}"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--repo", default=".", help="каталог репозитория или worktree")
    p.add_argument("--mode", default="since-base",
                   choices=["since-base", "uncommitted", "staged", "commit", "range", "branch"])
    p.add_argument("--ref", help="sha, A..B / A...B или имя ветки — в зависимости от режима")
    p.add_argument("--base", help="база для since-base и branch")
    p.add_argument("--out", help="выходной каталог (по умолчанию $TMPDIR/diff-review/...)")
    args = p.parse_args()

    try:
        patch, meta, full_patch = collect(args)
    except CollectError as e:
        print(f"Ошибка: {e}", file=sys.stderr)
        sys.exit(2)

    if patch is None:
        print(json.dumps({"ok": False, "reason": "no-changes", **meta}, ensure_ascii=False))
        print(f"Изменений нет: `{meta['root']}`, {meta['label']}.", file=sys.stderr)
        sys.exit(3)

    outdir = Path(args.out).expanduser() if args.out else default_outdir(meta)
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "guide.patch").write_text(patch, encoding="utf-8")
    (outdir / "full.patch").write_text(full_patch, encoding="utf-8")
    (outdir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    t = meta["totals"]
    print(json.dumps({
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
        "notes": meta["notes"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

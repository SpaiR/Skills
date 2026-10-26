"""Tests for diff-review collect.py full.patch (plain unittest; pytest is not installed)."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
COLLECT = SCRIPTS / "collect.py"
sys.path.insert(0, str(SCRIPTS))
import collect  # noqa: E402
import serve  # noqa: E402

ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
       "GIT_COMMITTER_EMAIL": "t@t", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null"}
WHOLE = "in_diff"


def git(repo, *a, check=True):
    r = subprocess.run(["git", "-C", str(repo), *a], capture_output=True, env=ENV)
    if check and r.returncode:
        raise RuntimeError(r.stderr.decode())
    return r.stdout


def write(repo, name, text, binary=False):
    p = Path(repo) / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(text if isinstance(text, bytes) else text.encode())


def commit(repo, msg="c"):
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", msg)
    return git(repo, "rev-parse", "HEAD").decode().strip()


def lines(n, tag="x"):
    return "".join(f"{tag}{i}\n" for i in range(n))


def run_collect(repo, out, *extra, expect=0):
    r = subprocess.run([sys.executable, str(COLLECT), "--repo", str(repo), "--out", str(out), *extra],
                       capture_output=True, env=ENV)
    assert r.returncode == expect, (r.returncode, r.stdout.decode(), r.stderr.decode())
    return r


def split(patch):
    import re
    return [c for c in re.split(r"(?m)^(?=diff --git )", patch) if c.startswith("diff --git ")]


class Base(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.tmp = Path(self._td.name)
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q", "-b", "main")

    def collect(self, *extra, name="out"):
        out = self.tmp / name
        run_collect(self.repo, out, *extra)
        meta = json.loads((out / "meta.json").read_text())
        return out, meta

    def by_path(self, meta):
        return {f["path"]: f for f in meta["files"]}

    def full_chunks(self, out, meta):
        got = split((out / "full.patch").read_text())
        want = [f for f in meta["files"] if f["content"]["available"]]
        self.assertEqual(len(got), len(want))
        return {f["path"]: c for f, c in zip(want, got)}

    def check_invariants(self, out, meta, reader, count=True):
        """reader(path) -> bytes of new side. Returns {path: full_chunk}."""
        guide = split((out / "guide.patch").read_text())
        self.assertEqual(len(guide), len(meta["files"]))
        full = self.full_chunks(out, meta)
        for f, g in zip(meta["files"], guide):
            if not f["content"]["available"]:
                self.assertIn("reason", f["content"])
                continue
            c = full[f["path"]]
            self.assertEqual(c.count("\n@@ ") + (1 if c.startswith("@@ ") else 0), 1, f["path"])
            gl = [l for l in g.split("\n@@ ", 1)[1].split("\n")[1:] if l[:1] in "+-" and l]
            fl = c.split("\n@@ ", 1)[1].split("\n")[1:]
            it = iter(fl)
            for l in gl:  # in-order subsequence with identical text
                self.assertTrue(any(l == x for x in it), f"{f['path']}: {l!r} missing in full")
            if count:
                body = reader(f["path"])
                n = body.count(b"\n") + (1 if body and not body.endswith(b"\n") else 0)
                ca = sum(1 for l in fl if l and l[:1] in " +")
                # trailing empty string after final newline is not a line
                if fl and fl[-1] == "":
                    ca -= 0
                self.assertEqual(ca, n, f"{f['path']}: ctx+add != file lines")
        return full

    def check_serve(self, out, meta):
        write_guide(out, meta)
        review, full = serve.load_review(out)
        avail = [i for i, f in enumerate(meta["files"]) if f["content"]["available"]]
        self.assertEqual([i for i, f in enumerate(review["files"]) if f["full"]], avail)
        self.assertEqual(sorted(full), avail)
        for i in avail:  # mapping: chunk belongs to file i
            self.assertTrue(full[i].split("\n", 1)[0].endswith(" b/" + meta["files"][i]["path"]))
        return review


def write_guide(out, meta):
    g = {"title": "t", "intent": "i",
         "sections": [{"title": "A", "overview": "o",
                       "diffs": [{"file": f["path"], "summary": "s"} for f in meta["files"]]}],
         "unplacedFiles": []}
    (out / "guide.json").write_text(json.dumps(g))


class Modes(Base):
    def build(self):
        r = self.repo
        write(r, "a.txt", lines(30, "a"))
        write(r, "b.txt", lines(30, "b"))
        write(r, "c.txt", lines(30, "c"))
        write(r, "del.txt", lines(5, "d"))
        write(r, "old.txt", lines(10, "o"))
        write(r, "bin.dat", b"\x00\x01\x02" * 100)
        self.base = commit(r, "base")
        git(r, "checkout", "-q", "-b", "feature")
        a = lines(30, "a").replace("a15\n", "A15\n")
        write(r, "a.txt", a + "tail\n")
        write(r, "new.txt", lines(4, "n"))
        (r / "del.txt").unlink()
        git(r, "mv", "old.txt", "renamed.txt")
        write(r, "bin.dat", b"\x00\x09\x02" * 100)
        self.f1 = commit(r, "f1")
        write(r, "c.txt", lines(30, "c").replace("c3\n", "C3\nextra\n"))
        self.f2 = commit(r, "f2")

    def common_flags(self, meta, avail, unavail=()):
        d = self.by_path(meta)
        for p in avail:
            self.assertTrue(d[p]["content"]["available"], p)
        for p in unavail:
            self.assertFalse(d[p]["content"]["available"], p)

    def wt(self, p):
        return (self.repo / p).read_bytes()

    def test_since_base(self):
        self.build()
        write(self.repo, "b.txt", lines(30, "b").replace("b29\n", "B29x\n"))  # uncommitted (size changes: avoid racy-git flake)
        write(self.repo, "u.txt", "untracked\n")
        out, meta = self.collect("--mode", "since-base", "--base", "main")
        self.assertEqual(meta["mode"], "since-base")
        self.common_flags(meta, ["a.txt", "b.txt", "c.txt"], ["new.txt", "del.txt", "u.txt", "bin.dat", "renamed.txt"])
        d = self.by_path(meta)
        for p in ("new.txt", "del.txt", "u.txt"):
            self.assertEqual(d[p]["content"]["reason"], WHOLE)
        self.assertEqual(d["bin.dat"]["content"]["reason"], "binary")
        self.assertEqual(d["renamed.txt"]["content"]["reason"], "unchanged")
        self.check_invariants(out, meta, self.wt)
        self.check_serve(out, meta)

    def test_uncommitted(self):
        self.build()
        write(self.repo, "b.txt", lines(30, "b").replace("b0\n", "B0xx\n"))
        write(self.repo, "u.txt", "untracked\n")
        out, meta = self.collect("--mode", "uncommitted")
        self.common_flags(meta, ["b.txt"], ["u.txt"])
        self.assertEqual(len(meta["files"]), 2)
        self.check_invariants(out, meta, self.wt)
        self.check_serve(out, meta)

    def test_staged(self):
        self.build()
        write(self.repo, "b.txt", lines(30, "b").replace("b10\n", "B10xx\n"))
        git(self.repo, "add", "b.txt")
        write(self.repo, "b.txt", "unstaged worktree junk\n")  # index and worktree differ
        write(self.repo, "c.txt", "also unstaged\n")
        out, meta = self.collect("--mode", "staged")
        self.assertEqual([f["path"] for f in meta["files"]], ["b.txt"])
        self.common_flags(meta, ["b.txt"])
        self.check_invariants(out, meta, lambda p: git(self.repo, "show", ":" + p))
        self.check_serve(out, meta)

    def test_commit(self):
        self.build()
        out, meta = self.collect("--mode", "commit", "--ref", self.f1)
        self.common_flags(meta, ["a.txt"], ["new.txt", "del.txt", "bin.dat", "renamed.txt"])
        self.check_invariants(out, meta, lambda p: git(self.repo, "show", f"{self.f1}:{p}"))
        self.check_serve(out, meta)

    def test_range_two_and_three_dots(self):
        self.build()
        git(self.repo, "checkout", "-q", "main")
        write(self.repo, "m.txt", "main only\n")
        commit(self.repo, "main2")
        for rng, tip in (("main..feature", "feature"), ("main...feature", "feature")):
            with self.subTest(rng=rng):
                out, meta = self.collect("--mode", "range", "--ref", rng, name="o" + str(len(rng)))
                paths = self.by_path(meta)
                self.assertIn("a.txt", paths)
                self.assertTrue(paths["a.txt"]["content"]["available"])
                self.assertTrue(paths["c.txt"]["content"]["available"])
                if rng.endswith("feature") and "..." in rng:
                    self.assertNotIn("m.txt", paths)
                else:
                    self.assertIn("m.txt", paths)  # two-dot compares tips
                self.check_invariants(out, meta, lambda p: git(self.repo, "show", f"{tip}:{p}"))
                self.check_serve(out, meta)

    def test_branch(self):
        self.build()
        git(self.repo, "checkout", "-q", "main")
        write(self.repo, "m.txt", "main only\n")
        commit(self.repo, "main2")
        out, meta = self.collect("--mode", "branch", "--ref", "feature", "--base", "main")
        paths = self.by_path(meta)
        self.assertNotIn("m.txt", paths)
        self.common_flags(meta, ["a.txt", "c.txt"], ["new.txt"])
        self.check_invariants(out, meta, lambda p: git(self.repo, "show", f"feature:{p}"))
        self.check_serve(out, meta)


class FileKinds(Base):
    def test_rename_with_edits(self):
        write(self.repo, "old.txt", lines(20, "o"))
        commit(self.repo)
        git(self.repo, "mv", "old.txt", "dir/new name.txt") if False else None
        (self.repo / "dir").mkdir()
        git(self.repo, "mv", "old.txt", "dir/new.txt")
        write(self.repo, "dir/new.txt", lines(20, "o").replace("o5\n", "O5\n"))
        out, meta = self.collect("--mode", "uncommitted")
        f = meta["files"][0]
        self.assertEqual(f["status"], "renamed")
        self.assertTrue(f["content"]["available"])
        full = self.full_chunks(out, meta)
        self.assertTrue(full["dir/new.txt"].split("\n", 1)[0].endswith(" b/dir/new.txt"))
        self.check_invariants(out, meta, lambda p: (self.repo / p).read_bytes())
        self.check_serve(out, meta)

    def test_large_file_excluded_order_kept(self):
        write(self.repo, "a.txt", lines(10, "a"))
        write(self.repo, "big.txt", "x" * 100 + "\n" + "y\n" * 10)
        write(self.repo, "z.txt", lines(10, "z"))
        commit(self.repo)
        write(self.repo, "a.txt", lines(10, "a").replace("a1\n", "A1\n"))
        write(self.repo, "big.txt", "X" * 100 + "\n" + "y\n" * (600 * 1024))
        write(self.repo, "z.txt", lines(10, "z").replace("z9\n", "Z9\n"))
        out, meta = self.collect("--mode", "uncommitted")
        d = self.by_path(meta)
        self.assertFalse(d["big.txt"]["content"]["available"])
        self.assertEqual(d["big.txt"]["content"], {"available": False, "reason": "too_large", "limitKiB": 1024})
        self.assertTrue(d["a.txt"]["content"]["available"])
        self.assertTrue(d["z.txt"]["content"]["available"])
        self.check_invariants(out, meta, lambda p: (self.repo / p).read_bytes())
        self.check_serve(out, meta)

    def test_no_trailing_newline(self):
        write(self.repo, "n.txt", lines(10, "n").rstrip("\n"))
        commit(self.repo)
        write(self.repo, "n.txt", lines(10, "n").rstrip("\n").replace("n9", "N9"))
        out, meta = self.collect("--mode", "uncommitted")
        full = self.full_chunks(out, meta)["n.txt"]
        self.assertIn("\\ No newline at end of file", full)
        self.check_invariants(out, meta, lambda p: (self.repo / p).read_bytes())

    def test_eol_crlf_gitattributes(self):
        write(self.repo, ".gitattributes", "* text eol=crlf\n")
        write(self.repo, "w.txt", lines(15, "w"))
        commit(self.repo)
        write(self.repo, "w.txt", lines(15, "w").replace("w7\n", "W7\n").replace("\n", "\r\n"))
        out, meta = self.collect("--mode", "uncommitted")
        self.assertTrue(self.by_path(meta)["w.txt"]["content"]["available"])
        self.check_invariants(out, meta, lambda p: (self.repo / p).read_bytes())

    def test_autocrlf_true(self):
        git(self.repo, "config", "core.autocrlf", "true")
        write(self.repo, "w.txt", lines(15, "w").replace("\n", "\r\n"))
        commit(self.repo)
        write(self.repo, "w.txt", lines(15, "w").replace("w7\n", "W7\n").replace("\n", "\r\n"))
        out, meta = self.collect("--mode", "uncommitted")
        self.assertTrue(self.by_path(meta)["w.txt"]["content"]["available"])
        self.check_invariants(out, meta, lambda p: (self.repo / p).read_bytes())

    def test_symlink_retarget(self):
        write(self.repo, "t1.txt", "1\n")
        os.symlink("t1.txt", self.repo / "ln")
        commit(self.repo)
        (self.repo / "ln").unlink()
        os.symlink("other-target.txt", self.repo / "ln")
        out, meta = self.collect("--mode", "uncommitted")
        f = self.by_path(meta)["ln"]
        print("\nSYMLINK RESULT:", f["status"], f["content"], file=sys.stderr)
        if f["content"]["available"]:
            c = self.full_chunks(out, meta)["ln"]
            self.assertIn("+other-target.txt", c)
        self.check_serve(out, meta)


class Safety(Base):
    def snap(self):
        return (git(self.repo, "diff", "--cached", "--name-only"), git(self.repo, "status", "--porcelain"))

    def test_index_untouched(self):
        write(self.repo, "a.txt", lines(10, "a"))
        write(self.repo, "b.txt", lines(10, "b"))
        commit(self.repo)
        write(self.repo, "a.txt", lines(10, "a").replace("a1\n", "A1\n"))
        git(self.repo, "add", "a.txt")
        write(self.repo, "b.txt", "changed\n")
        write(self.repo, "u1.txt", "u\n")
        write(self.repo, "sub/u2.txt", "u\n")
        before = self.snap()
        idx_before = (self.repo / ".git" / "index").read_bytes()
        for mode in ("since-base", "uncommitted", "staged"):
            self.collect("--mode", mode, name="o" + mode)
        self.assertEqual(before, self.snap())
        self.assertEqual(idx_before, (self.repo / ".git" / "index").read_bytes())
        self.assertIn(b"?? u1.txt", before[1])


class RacyIndex(Base):
    def test_same_size_edit_with_untracked_file_is_not_missed(self):
        """Racy-git: entry mtime == index mtime, so plain git re-reads content; the temp
        index copy gets a fresh mtime and git then trusts the (identical) stat data."""
        write(self.repo, "b.txt", lines(5, "b"))
        t = 1_600_000_000
        os.utime(self.repo / "b.txt", (t, t))
        commit(self.repo)
        write(self.repo, "b.txt", lines(5, "b").replace("b1\n", "B1\n"))  # same size
        os.utime(self.repo / "b.txt", (t, t))
        os.utime(self.repo / ".git" / "index", (t, t))
        write(self.repo, "u.txt", "u\n")
        plain = git(self.repo, "diff", "HEAD", "--name-only").decode().split()
        self.assertEqual(plain, ["b.txt"])  # plain git sees the edit
        _, meta = self.collect("--mode", "uncommitted")
        self.assertIn("b.txt", [f["path"] for f in meta["files"]])


class Compat(Base):
    def test_load_review_without_full_patch(self):
        write(self.repo, "a.txt", lines(10, "a"))
        write(self.repo, "b.txt", lines(10, "b"))
        commit(self.repo)
        write(self.repo, "a.txt", lines(10, "a").replace("a1\n", "A1\n"))
        write(self.repo, "b.txt", lines(10, "b").replace("b1\n", "B1\n"))
        out, meta = self.collect("--mode", "uncommitted")
        self.check_serve(out, meta)
        (out / "full.patch").unlink()
        review, full = serve.load_review(out)
        self.assertEqual(full, {})
        self.assertTrue(all(f["full"] is False for f in review["files"]))
        self.assertEqual(len(review["files"]), 2)

    def test_no_changes_exit3(self):
        write(self.repo, "a.txt", "x\n")
        commit(self.repo)
        run_collect(self.repo, self.tmp / "o", "--mode", "uncommitted", expect=3)


class MetaV3(Base):
    """meta v3 carries no prose for the viewer: range is structured, notes and reasons are codes."""

    def build(self):
        write(self.repo, "a.txt", lines(10, "a"))
        commit(self.repo, "base")
        git(self.repo, "checkout", "-q", "-b", "feature")
        write(self.repo, "a.txt", lines(10, "a").replace("a3\n", "A3\n"))
        self.f1 = commit(self.repo, "feature: change a")
        write(self.repo, "a.txt", lines(10, "a").replace("a3\n", "A3\n").replace("a7\n", "A7x\n"))

    def summary(self, *extra, name="out"):
        r = run_collect(self.repo, self.tmp / name, *extra)
        return json.loads(r.stdout), json.loads((self.tmp / name / "meta.json").read_text())

    def args(self):
        return argparse.Namespace(repo=str(self.repo), mode="uncommitted", ref=None, base=None)

    def test_range_and_label_per_mode(self):
        self.build()
        git(self.repo, "add", "a.txt")  # gives staged mode something to show
        cases = [
            (["--mode", "since-base", "--base", "main"], {"mode": "since-base", "base": "main"},
             "main...HEAD + uncommitted"),
            (["--mode", "uncommitted"], {"mode": "uncommitted", "hasCommits": True}, "HEAD + uncommitted"),
            (["--mode", "staged"], {"mode": "staged"}, "index (staged)"),
            (["--mode", "commit", "--ref", self.f1], {"mode": "commit", "sha": self.f1, "subject": "feature: change a"},
             f"{self.f1[:10]} feature: change a"),
            (["--mode", "range", "--ref", "main..feature"], {"mode": "range", "from": "main", "dots": "..", "to": "feature"},
             "main..feature"),
            (["--mode", "range", "--ref", "main...feature"],
             {"mode": "range", "from": "main", "dots": "...", "to": "feature"}, "main...feature"),
            (["--mode", "branch", "--ref", "feature", "--base", "main"], {"mode": "branch", "base": "main", "ref": "feature"},
             "main...feature"),
        ]
        for i, (extra, rng, label) in enumerate(cases):
            with self.subTest(args=extra):
                summary, meta = self.summary(*extra, name=f"o{i}")
                self.assertEqual(meta["version"], 3)
                self.assertEqual(meta["range"], rng)
                self.assertEqual(meta["label"], label)
                self.assertEqual(summary["label"], label)
                self.assertEqual(meta["notes"], [])
                self.assertEqual(summary["notes"], [])

    def test_no_commits_note(self):
        write(self.repo, "a.txt", "x\n")
        summary, meta = self.summary()
        self.assertEqual(meta["mode"], "uncommitted")
        self.assertEqual(meta["range"], {"mode": "uncommitted", "hasCommits": False})
        self.assertEqual(meta["label"], "working tree (no commits)")
        self.assertEqual(meta["notes"], [{"code": "no_commits", "text": collect.NOTE_TEXT["no_commits"]}])
        self.assertEqual(summary["notes"], [collect.NOTE_TEXT["no_commits"]])

    def test_base_not_found_note(self):
        write(self.repo, "a.txt", lines(5, "a"))
        commit(self.repo)
        git(self.repo, "branch", "-m", "main", "trunk")  # no main/master/develop and no origin
        write(self.repo, "a.txt", lines(5, "a").replace("a1\n", "A1\n"))
        summary, meta = self.summary()
        self.assertEqual(meta["mode"], "uncommitted")
        self.assertEqual(meta["range"], {"mode": "uncommitted", "hasCommits": True})
        self.assertEqual([n["code"] for n in meta["notes"]], ["base_not_found"])
        self.assertEqual(summary["notes"], [collect.NOTE_TEXT["base_not_found"]])

    def test_session_texts_are_english(self):
        for code, text in collect.NOTE_TEXT.items():
            with self.subTest(code=code):
                self.assertTrue(text.isascii(), text)

    def test_total_limit_reason(self):
        write(self.repo, "a.txt", lines(10, "a"))
        write(self.repo, "b.txt", lines(10, "b"))
        commit(self.repo)
        write(self.repo, "a.txt", lines(10, "a").replace("a1\n", "A1\n"))
        write(self.repo, "b.txt", lines(10, "b").replace("b1\n", "B1\n"))
        size = (self.repo / "a.txt").stat().st_size
        with mock.patch.object(collect, "FULL_TOTAL_MAX", size + 1):
            _, meta, _ = collect.collect(self.args())
        d = self.by_path(meta)
        self.assertTrue(d["a.txt"]["content"]["available"])
        self.assertEqual(d["b.txt"]["content"], {"available": False, "reason": "total_limit"})

    def test_git_output_mismatch_and_unreadable(self):
        write(self.repo, "a.txt", lines(10, "a"))
        write(self.repo, "ghost.txt", lines(10, "g"))
        commit(self.repo)
        write(self.repo, "a.txt", lines(10, "a").replace("a1\n", "A1\n"))
        # ghost.txt is listed as modified but git shows no diff for it; missing.txt cannot be read.
        paths = ["a.txt", "ghost.txt", "missing.txt"]
        name_status = [{"status": "M", "oldPath": None, "path": p} for p in paths]
        numstat = [{"path": p, "additions": 1, "deletions": 1, "binary": False} for p in paths]
        notes = []
        full = collect.collect_full(self.repo, ["HEAD"], None, "worktree", name_status, numstat, notes)
        self.assertEqual(notes, [{"code": "full_text_mismatch", "text": collect.NOTE_TEXT["full_text_mismatch"]}])
        self.assertEqual(full["chunks"], {})
        self.assertEqual(full["reasons"], {0: "not_collected", 1: "not_collected", 2: "unreadable"})

    def test_file_content(self):
        full = {"chunks": {0: "diff"}, "lines": {0: 12}, "reasons": {1: "too_large", 2: "binary"}}
        self.assertEqual(collect.file_content(0, full), {"available": True, "lines": 12})
        self.assertEqual(collect.file_content(1, full),
                         {"available": False, "reason": "too_large", "limitKiB": collect.FULL_FILE_MAX // 1024})
        self.assertEqual(collect.file_content(2, full), {"available": False, "reason": "binary"})
        self.assertEqual(collect.file_content(3, full), {"available": False, "reason": "in_diff"})


if __name__ == "__main__":
    unittest.main()

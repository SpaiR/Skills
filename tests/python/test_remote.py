"""Tests for diff-review remote.py and `collect.py --pr`: reference parsing, metadata, commits, errors.

No network: gh / glab are the fakes from tests/fakecli and the "remote" is a local bare repository.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import test_collect
from fakecli_support import FakeCliMixin
from test_collect import ENV, commit, git, lines, write

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import remote  # noqa: E402


class ParseRefTest(unittest.TestCase):
    def parse(self, text):
        r = remote.parse_ref(text)
        return r.provider, r.host, r.repo, r.number

    def test_github_urls(self):
        gh = "github", "github.com", "o/r", 12
        for url in (
            "https://github.com/o/r/pull/12",
            "https://github.com/o/r/pull/12/files",
            "https://github.com/o/r/pull/12/commits/abc123",
            "https://github.com/o/r/pull/12?diff=split#discussion_r1",
            "http://github.com/o/r/pull/12/",
            "  https://github.com/o/r/pull/12  ",
        ):
            with self.subTest(url=url):
                self.assertEqual(self.parse(url), gh)

    def test_github_enterprise_url(self):
        self.assertEqual(
            self.parse("https://ghe.corp.example/team/svc/pull/7/files"), ("github", "ghe.corp.example", "team/svc", 7)
        )

    def test_gitlab_urls(self):
        for url, want in (
            ("https://gitlab.com/g/p/-/merge_requests/45", ("gitlab", "gitlab.com", "g/p", 45)),
            ("https://gitlab.com/g/p/-/merge_requests/45/diffs", ("gitlab", "gitlab.com", "g/p", 45)),
            ("https://gitlab.com/g/p/-/merge_requests/45/commits?x=1#note_9", ("gitlab", "gitlab.com", "g/p", 45)),
            (
                "https://git.corp.example/a/b/c/proj/-/merge_requests/3",
                ("gitlab", "git.corp.example", "a/b/c/proj", 3),
            ),
            ("https://git.corp.example:8443/a/p/-/merge_requests/3", ("gitlab", "git.corp.example:8443", "a/p", 3)),
            ("https://u:pw@gitlab.com/g/p/-/merge_requests/1", ("gitlab", "gitlab.com", "g/p", 1)),
        ):
            with self.subTest(url=url):
                self.assertEqual(self.parse(url), want)

    def test_shorthands(self):
        for text, want in (
            ("#12", (None, None, None, 12)),
            ("!12", ("gitlab", None, None, 12)),
            ("pr 12", (None, None, None, 12)),
            ("PR 12", (None, None, None, 12)),
            ("pr #12", (None, None, None, 12)),
            ("mr 12", ("gitlab", None, None, 12)),
            ("mr !12", ("gitlab", None, None, 12)),
            ("pr", (None, None, None, None)),
            ("mr", ("gitlab", None, None, None)),
        ):
            with self.subTest(text=text):
                self.assertEqual(self.parse(text), want)

    def test_garbage_is_rejected(self):
        for text in ("", "12", "pr x", "https://github.com/o/r", "https://github.com/o/r/issues/3", "feature-branch"):
            with self.subTest(text=text), self.assertRaises(remote.RemoteError):
                remote.parse_ref(text)


class RemoteUrlTest(unittest.TestCase):
    def test_normalisation(self):
        for url, want in (
            ("git@github.com:o/r.git", ("github.com", "o/r")),
            ("git@github.com:o/r", ("github.com", "o/r")),
            ("github.com:o/r.git", ("github.com", "o/r")),
            ("ssh://git@github.com/o/r.git", ("github.com", "o/r")),
            ("ssh://git@git.corp.example:2222/a/b/proj.git", ("git.corp.example", "a/b/proj")),
            ("https://github.com/o/r.git", ("github.com", "o/r")),
            ("https://github.com/o/r", ("github.com", "o/r")),
            ("https://github.com/o/r/", ("github.com", "o/r")),
            ("https://user:token@gitlab.com/g/s/p.git", ("gitlab.com", "g/s/p")),
            ("https://GitLab.COM/g/p.git", ("gitlab.com", "g/p")),
            ("https://git.corp.example:8443/g/p.git", ("git.corp.example:8443", "g/p")),
        ):
            with self.subTest(url=url):
                self.assertEqual(remote.split_remote_url(url), want)

    def test_local_paths_have_no_host(self):
        for url in ("/srv/git/r.git", "../r", "file:///srv/git/r.git", "", "C"):
            with self.subTest(url=url):
                self.assertIsNone(remote.split_remote_url(url))

    def test_same_repo_ignores_case(self):
        self.assertTrue(remote.same_repo(("GitHub.com", "Org/Repo"), ("github.com", "org/repo")))
        self.assertFalse(remote.same_repo(("github.com", "o/r"), ("github.com", "o/r2")))
        self.assertFalse(remote.same_repo(None, ("github.com", "o/r")))


def gh_json(**over):
    d = {
        "number": 1,
        "title": "Add things",
        "author": {"login": "alice"},
        "state": "OPEN",
        "isDraft": False,
        "baseRefName": "main",
        "headRefName": "feature",
        "baseRefOid": "b" * 40,
        "headRefOid": "h" * 40,
        "url": "https://github.com/o/r/pull/1",
        "body": "Why\n",
    }
    return {**d, **over}


def glab_json(**over):
    d = {
        "iid": 1,
        "title": "Add things",
        "author": {"username": "alice"},
        "state": "opened",
        "draft": False,
        "source_branch": "feature",
        "target_branch": "main",
        "diff_refs": {"base_sha": "b" * 40, "start_sha": "s" * 40, "head_sha": "h" * 40},
        "web_url": "https://gitlab.com/g/s/p/-/merge_requests/1",
        "description": "Why\n",
    }
    return {**d, **over}


def rule(cli, match, stdout="", exit=0, stderr="", **extra):
    return {"cli": cli, "match": match, "stdout": stdout, "exit": exit, "stderr": stderr, **extra}


class MetadataTest(FakeCliMixin, unittest.TestCase):
    def setUp(self):
        self.setup_fakecli()

    def github(self, **over):
        self.set_rules(
            [
                rule("gh", ["pr view 1 -R github.com/o/r", "--json number,title,author"], gh_json(**over)),
                rule("gh", ["api --hostname github.com user"], "alice-viewer\n"),
            ]
        )
        return remote.fetch_metadata(remote.Target("github", "github.com", "o/r", 1))

    def gitlab(self, **over):
        self.set_rules(
            [
                rule("glab", ["api --hostname gitlab.com projects/g%2Fs%2Fp/merge_requests/1"], glab_json(**over)),
                rule("glab", ["api --hostname gitlab.com user"], {"username": "bob"}),
            ]
        )
        return remote.fetch_metadata(remote.Target("gitlab", "gitlab.com", "g/s/p", 1))

    def test_github_fields(self):
        pr = self.github()
        self.assertEqual(
            pr,
            {
                "provider": "github",
                "host": "github.com",
                "repo": "o/r",
                "number": 1,
                "url": "https://github.com/o/r/pull/1",
                "title": "Add things",
                "author": "alice",
                "state": "open",
                "draft": False,
                "baseRef": "main",
                "headRef": "feature",
                "baseSha": "b" * 40,
                "headSha": "h" * 40,
                "startSha": None,
                "mergeBaseSha": None,
                "body": "Why\n",
                "viewer": "alice-viewer",
            },
        )

    def test_github_states_and_draft(self):
        for raw, want in (("OPEN", "open"), ("CLOSED", "closed"), ("MERGED", "merged")):
            with self.subTest(state=raw):
                self.assertEqual(self.github(state=raw)["state"], want)
        self.assertTrue(self.github(isDraft=True)["draft"])

    def test_gitlab_fields(self):
        pr = self.gitlab()
        self.assertEqual(
            (pr["provider"], pr["repo"], pr["author"], pr["state"], pr["viewer"]),
            ("gitlab", "g/s/p", "alice", "open", "bob"),
        )
        self.assertEqual((pr["baseRef"], pr["headRef"]), ("main", "feature"))
        self.assertEqual((pr["baseSha"], pr["startSha"], pr["headSha"]), ("b" * 40, "s" * 40, "h" * 40))
        self.assertEqual(pr["mergeBaseSha"], "b" * 40)
        self.assertEqual(pr["url"], "https://gitlab.com/g/s/p/-/merge_requests/1")

    def test_gitlab_states_and_draft(self):
        for raw, want in (("opened", "open"), ("closed", "closed"), ("merged", "merged"), ("locked", "open")):
            with self.subTest(state=raw):
                self.assertEqual(self.gitlab(state=raw)["state"], want)
        self.assertTrue(self.gitlab(draft=True)["draft"])
        self.assertTrue(self.gitlab(draft=False, work_in_progress=True)["draft"])

    def test_gitlab_without_diff_refs_is_an_error(self):
        with self.assertRaisesRegex(remote.RemoteError, "no diff refs"):
            self.gitlab(diff_refs=None)

    def test_body_is_truncated(self):
        pr = self.github(body="x" * 30000)
        self.assertEqual(pr["body"], "x" * 20000 + "\n\n…")
        self.assertEqual(self.github(body="x" * 20000)["body"], "x" * 20000)
        self.assertEqual(self.github(body=None)["body"], "")

    def test_unknown_viewer_is_null(self):
        self.set_rules([rule("gh", ["pr view"], gh_json()), rule("gh", ["api"], "", exit=1, stderr="boom")])
        pr = remote.fetch_metadata(remote.Target("github", "github.com", "o/r", 1))
        self.assertIsNone(pr["viewer"])

    def test_enterprise_host_is_passed_to_the_cli(self):
        self.set_rules([rule("gh", ["pr view 3 -R ghe.corp/t/s"], gh_json(number=3)), rule("gh", ["api"], "me")])
        remote.fetch_metadata(remote.Target("github", "ghe.corp", "t/s", 3))
        self.assertTrue(self.calls("gh", "api --hostname ghe.corp user --jq .login"))


class ErrorsTest(FakeCliMixin, unittest.TestCase):
    def setUp(self):
        self.setup_fakecli()

    def fetch(self, provider="github", host="github.com"):
        return remote.fetch_metadata(remote.Target(provider, host, "o/r", 1))

    def test_missing_cli_names_the_install_page(self):
        empty = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, empty)
        with mock.patch.dict(os.environ, {"PATH": empty}):
            with self.assertRaisesRegex(remote.RemoteError, r"`gh` is not installed.*https://cli\.github\.com"):
                self.fetch("github")
            with self.assertRaisesRegex(remote.RemoteError, r"`glab` is not installed.*gitlab-org/cli"):
                self.fetch("gitlab", "gitlab.com")

    def test_not_authenticated_hints_the_login_command(self):
        self.set_rules(
            [
                rule("gh", [], exit=4, stderr="To get started with GitHub CLI, please run:  gh auth login\n"),
                rule("glab", [], exit=1, stderr="401 Unauthorized\n"),
            ]
        )
        with self.assertRaisesRegex(remote.RemoteError, r"gh auth login --hostname ghe\.example\.com"):
            self.fetch("github", "ghe.example.com")
        with self.assertRaisesRegex(remote.RemoteError, r"glab auth login --hostname git\.example\.com"):
            self.fetch("gitlab", "git.example.com")

    def test_not_found(self):
        self.set_rules(
            [
                rule("gh", [], exit=1, stderr="GraphQL: Could not resolve to a PullRequest with the number of 1.\n"),
                rule("glab", [], exit=1, stderr="404 Not Found\n"),
            ]
        )
        for provider in ("github", "gitlab"):
            with self.subTest(provider=provider), self.assertRaisesRegex(remote.RemoteError, "not found.*no access"):
                self.fetch(provider)

    def test_other_failures_carry_the_cli_message(self):
        self.set_rules([rule("gh", [], exit=1, stderr="HTTP 500: server exploded\n")])
        with self.assertRaisesRegex(remote.RemoteError, "server exploded"):
            self.fetch()

    def test_non_json_output(self):
        self.set_rules([rule("gh", [], "<html>")])
        with self.assertRaisesRegex(remote.RemoteError, "unexpected output"):
            self.fetch()


class ResolveTest(FakeCliMixin, unittest.TestCase):
    """Shorthands against the origin remote, provider choice, the current-branch lookup."""

    def setUp(self):
        self.setup_fakecli()
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.repo = Path(td.name) / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q", "-b", "main")

    def origin(self, url, name="origin"):
        git(self.repo, "remote", "add", name, url)

    def target(self, text):
        t = remote.resolve(text, self.repo)
        return t.provider, t.host, t.repo, t.number

    def test_github_com_is_github_without_asking_glab(self):
        self.origin("git@github.com:o/r.git")
        self.assertEqual(self.target("#7"), ("github", "github.com", "o/r", 7))
        self.assertEqual(self.target("pr 7"), ("github", "github.com", "o/r", 7))
        self.assertEqual(self.calls(), [])

    def test_known_glab_host_is_gitlab(self):
        self.origin("https://git.corp.example/a/b/p.git")
        self.set_rules([rule("glab", ["auth status --hostname git.corp.example"])])
        self.assertEqual(self.target("#7"), ("gitlab", "git.corp.example", "a/b/p", 7))

    def test_unknown_host_is_github_enterprise(self):
        self.origin("https://ghe.corp.example/team/svc")
        self.set_rules([rule("glab", ["auth status"], exit=1, stderr="x not authenticated")])
        self.assertEqual(self.target("#7"), ("github", "ghe.corp.example", "team/svc", 7))

    def test_unknown_host_without_glab_is_github_enterprise(self):
        self.origin("https://ghe.corp.example/team/svc")
        bin_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, bin_dir)
        (bin_dir / "git").symlink_to(shutil.which("git"))  # a PATH with git but neither gh nor glab
        with mock.patch.dict(os.environ, {"PATH": str(bin_dir)}):
            self.assertEqual(self.target("#7"), ("github", "ghe.corp.example", "team/svc", 7))

    def test_bang_and_mr_imply_gitlab_without_asking(self):
        self.origin("https://git.corp.example/a/p.git")
        self.assertEqual(self.target("!9"), ("gitlab", "git.corp.example", "a/p", 9))
        self.assertEqual(self.target("mr 9"), ("gitlab", "git.corp.example", "a/p", 9))
        self.assertEqual(self.calls(), [])

    def test_first_remote_when_there_is_no_origin(self):
        self.origin("https://github.com/o/zeta.git", "zeta")
        self.origin("https://github.com/o/alpha.git", "alpha")
        self.assertEqual(self.target("#1")[2], "o/alpha")  # git lists remotes alphabetically

    def test_origin_wins_over_other_remotes(self):
        self.origin("https://github.com/o/fork.git", "aaa")
        self.origin("https://github.com/o/main-repo.git", "origin")
        self.assertEqual(self.target("#1")[2], "o/main-repo")

    def test_url_ignores_the_repository(self):
        t = remote.resolve("https://github.com/x/y/pull/4", self.repo / "does-not-exist")
        self.assertEqual((t.provider, t.host, t.repo, t.number), ("github", "github.com", "x/y", 4))

    def test_shorthand_needs_a_remote(self):
        with self.assertRaisesRegex(remote.RemoteError, "needs a git repository with a remote"):
            remote.resolve("#1", self.repo)
        with self.assertRaisesRegex(remote.RemoteError, "needs a git repository with a remote"):
            remote.resolve("#1", self.repo / "nope")

    def test_current_branch_github(self):
        self.origin("https://github.com/o/r.git")
        self.set_rules([rule("gh", ["pr view --json number"], {"number": 31})])
        self.assertEqual(self.target("pr"), ("github", "github.com", "o/r", 31))

    def test_current_branch_gitlab(self):
        self.origin("https://git.corp.example/a/p.git")
        self.set_rules([rule("glab", ["mr view -F json"], {"iid": 8, "title": "t"})])
        self.assertEqual(self.target("mr"), ("gitlab", "git.corp.example", "a/p", 8))

    def test_current_branch_without_a_pr(self):
        self.origin("https://github.com/o/r.git")
        self.set_rules([rule("gh", ["pr view"], exit=1, stderr='no pull requests found for branch "x"')])
        with self.assertRaisesRegex(remote.RemoteError, "not found"):
            self.target("pr")


# --- collect.py --pr end to end ---------------------------------------------------------------------------------


def make_origin(tmp):
    """A bare "origin" with refs/pull/1/head and refs/merge-requests/1/head on a two-commit feature branch whose
    base branch moved on after the fork. Returns the facts the tests assert against."""
    work = tmp / "work"
    work.mkdir()
    git(work, "init", "-q", "-b", "main")
    write(work, "a.txt", lines(30, "a"))
    write(work, "b.txt", lines(30, "b"))
    write(work, "old.txt", lines(10, "o"))
    fork = commit(work, "base")
    git(work, "checkout", "-q", "-b", "feature")
    write(work, "a.txt", lines(30, "a").replace("a15\n", "A15\n") + "tail\n")
    write(work, "new.txt", lines(4, "n"))
    git(work, "mv", "old.txt", "renamed.txt")
    commit(work, "feature 1")
    write(work, "b.txt", lines(30, "b").replace("b3\n", "B3\nextra\n"))
    head = commit(work, "feature 2")
    git(work, "checkout", "-q", "main")
    write(work, "main-only.txt", "main moved on\n")
    base = commit(work, "main moves on")
    bare = tmp / "origin.git"
    subprocess.run(["git", "clone", "-q", "--bare", str(work), str(bare)], check=True, env=ENV)
    git(bare, "update-ref", "refs/pull/1/head", head)
    git(bare, "update-ref", "refs/merge-requests/1/head", head)
    return {"bare": bare, "fork": fork, "head": head, "base": base}


def github_rules(origin, **over):
    pr = gh_json(**{"baseRefOid": origin["base"], "headRefOid": origin["head"], **over})
    return [
        rule("gh", ["pr view 1 -R github.com/o/r"], pr),
        rule("gh", ["api --hostname github.com user"], "me\n"),
        rule("gh", ["repo clone github.com/o/r"], clone_from=str(origin["bare"])),
    ]


def gitlab_rules(origin, **over):
    refs = {"base_sha": origin["fork"], "start_sha": origin["base"], "head_sha": origin["head"]}
    mr = glab_json(diff_refs=refs, **over)
    return [
        rule("glab", ["api --hostname gitlab.example.com projects/g%2Fsub%2Fproj/merge_requests/1"], mr),
        rule("glab", ["api --hostname gitlab.example.com user"], {"username": "me"}),
        rule("glab", ["repo clone g/sub/proj"], clone_from=str(origin["bare"])),
        rule("glab", ["auth status --hostname gitlab.example.com"]),
    ]


class CollectPrTest(FakeCliMixin, test_collect.Base):
    def setUp(self):
        super().setUp()
        self.origin = make_origin(self.tmp)
        self.setup_fakecli(github_rules(self.origin))
        self.cache = self.tmp / "tmpdir"
        self.cache.mkdir()
        self.env = {**ENV, **self.fake_env, "TMPDIR": str(self.cache)}

    def collect_pr(self, ref, *extra, repo=None, expect=0, name="out"):
        out = self.tmp / name
        cmd = [sys.executable, str(test_collect.COLLECT), "--repo", str(repo or self.repo), "--out", str(out)]
        r = subprocess.run([*cmd, "--pr", ref, *extra], capture_output=True, env=self.env)
        self.assertEqual(r.returncode, expect, (r.stdout.decode(), r.stderr.decode()))
        meta = json.loads((out / "meta.json").read_text()) if expect == 0 else None
        return r, out, meta

    def user_repo(self, url, prefix=None):
        """The user's own clone: dirty tree, remote `origin` = url, redirected to the local bare repository."""
        write(self.repo, "mine.txt", "mine\n")
        commit(self.repo, "mine")
        git(self.repo, "remote", "add", "origin", url)
        git(self.repo, "config", f"url.{self.origin['bare']}.insteadOf", prefix or url)
        write(self.repo, "mine.txt", "mine, edited\n")
        write(self.repo, "untracked.txt", "u\n")

    def snapshot(self):
        names = ("status --porcelain", "rev-parse HEAD", "for-each-ref", "ls-files -s", "config --list --local")
        return [git(self.repo, *n.split()) for n in names]

    def reader(self, sha):
        return lambda p: (
            subprocess.run(
                ["git", "-C", str(self.root), "show", f"{sha}:{p}"], capture_output=True, check=True, env=ENV
            ).stdout
        )

    def check_github_meta(self, meta, out):
        o = self.origin
        self.assertEqual(meta["version"], 3)
        self.assertEqual(meta["mode"], "pr")
        self.assertEqual(
            meta["range"],
            {
                "mode": "pr",
                "provider": "github",
                "host": "github.com",
                "repo": "o/r",
                "number": 1,
                "url": "https://github.com/o/r/pull/1",
            },
        )
        self.assertEqual(meta["label"], "GitHub PR o/r#1")
        self.assertEqual((meta["branch"], meta["repoName"], meta["worktree"]), ("feature", "r", None))
        self.assertEqual(
            (meta["head"], meta["newRev"], meta["base"], meta["mergeBase"]), (o["head"], o["head"], "main", o["fork"])
        )
        self.assertEqual(len(meta["commits"]), 2)
        self.assertTrue(meta["commits"][0].endswith("feature 2"))
        self.assertEqual(meta["untrackedIncluded"], 0)
        pr = meta["pr"]
        self.assertEqual((pr["baseSha"], pr["headSha"], pr["mergeBaseSha"]), (o["base"], o["head"], o["fork"]))
        self.assertEqual((pr["startSha"], pr["viewer"], pr["author"], pr["state"]), (None, "me", "alice", "open"))
        by = self.by_path(meta)
        self.assertEqual(set(by), {"a.txt", "b.txt", "new.txt", "renamed.txt"})
        self.assertEqual((by["renamed.txt"]["status"], by["renamed.txt"]["oldPath"]), ("renamed", "old.txt"))
        self.assertNotIn("main-only.txt", by)  # the moved base branch is not part of the PR diff
        self.root = Path(meta["root"])
        self.check_invariants(out, meta, self.reader(o["head"]))
        self.assertTrue(all(f["content"]["available"] for f in meta["files"] if f["path"] in ("a.txt", "b.txt")))

    def test_github_local_clone(self):
        self.user_repo("https://github.com/o/r.git")
        before = self.snapshot()
        r, out, meta = self.collect_pr("https://github.com/o/r/pull/1/files")
        self.check_github_meta(meta, out)
        self.assertEqual(Path(meta["root"]).resolve(), self.repo.resolve())
        self.assertEqual(self.snapshot(), before, "the user's repository state changed")
        self.assertEqual((self.repo / "untracked.txt").read_text(), "u\n")
        self.assertEqual((self.repo / "mine.txt").read_text(), "mine, edited\n")
        self.assertFalse(self.calls("gh", "repo clone"))
        self.assertEqual(list(self.cache.iterdir()), [])  # no cache clone was made
        summary = json.loads(r.stdout)
        self.assertEqual(summary["pr"], {"url": "https://github.com/o/r/pull/1", "title": "Add things"})
        self.assertEqual((summary["mode"], summary["label"], summary["branch"]), ("pr", "GitHub PR o/r#1", "feature"))

    def test_shorthand_uses_origin_and_needs_no_fetch_when_commits_are_local(self):
        self.user_repo("git@github.com:o/r.git")
        _, out, meta = self.collect_pr("#1")
        self.check_github_meta(meta, out)
        # Everything is local now: with the "remote" gone a second run still works, so it did not fetch.
        self.origin["bare"].rename(self.tmp / "gone.git")
        _, out, meta = self.collect_pr("pr 1", name="out2")
        self.check_github_meta(meta, out)

    def test_github_cache_clone(self):
        empty = self.tmp / "not-a-repo"
        empty.mkdir()
        _, out, meta = self.collect_pr("https://github.com/o/r/pull/1", repo=empty)
        self.check_github_meta(meta, out)
        cached = self.cache / "diff-review" / "repos" / "github.com" / "o" / "r"
        self.assertEqual(Path(meta["root"]).resolve(), cached.resolve())
        clone = self.calls("gh", "repo clone")
        self.assertEqual(len(clone), 1)
        self.assertEqual(clone[0]["argv"][-3:], ["--", "--no-checkout", "--filter=blob:none"])
        self.assertEqual(clone[0]["argv"][2], "github.com/o/r")
        self.assertEqual(git(cached, "ls-files").decode(), "")  # nothing checked out
        # the cache clone is reused the next time: no second clone
        self.collect_pr("https://github.com/o/r/pull/1", repo=empty, name="out2")
        self.assertEqual(len(self.calls("gh", "repo clone")), 1)

    def test_local_repo_with_another_remote_falls_back_to_cache_clone(self):
        self.user_repo("https://github.com/someone/else.git", prefix="https://github.com/someone/else.git")
        before = self.snapshot()
        _, out, meta = self.collect_pr("https://github.com/o/r/pull/1")
        self.check_github_meta(meta, out)
        self.assertNotEqual(Path(meta["root"]).resolve(), self.repo.resolve())
        self.assertEqual(self.snapshot(), before)

    def test_github_enterprise_cache_clone(self):
        rules = github_rules(self.origin)
        rules = [{**r, "match": [m.replace("github.com", "ghe.corp.example") for m in r["match"]]} for r in rules]
        self.set_rules(rules)
        empty = self.tmp / "not-a-repo"
        empty.mkdir()
        _, _, meta = self.collect_pr("https://ghe.corp.example/o/r/pull/1", repo=empty)
        self.assertEqual(meta["pr"]["host"], "ghe.corp.example")
        self.assertEqual(self.calls("gh", "repo clone")[0]["argv"][2], "ghe.corp.example/o/r")
        self.assertTrue((self.cache / "diff-review" / "repos" / "ghe.corp.example" / "o" / "r").is_dir())

    def check_gitlab_meta(self, meta, out):
        o = self.origin
        self.assertEqual(meta["mode"], "pr")
        self.assertEqual(
            meta["range"],
            {
                "mode": "pr",
                "provider": "gitlab",
                "host": "gitlab.example.com",
                "repo": "g/sub/proj",
                "number": 1,
                "url": "https://gitlab.com/g/s/p/-/merge_requests/1",
            },
        )
        self.assertEqual(meta["label"], "GitLab MR g/sub/proj!1")
        self.assertEqual((meta["repoName"], meta["branch"], meta["base"]), ("proj", "feature", "main"))
        self.assertEqual((meta["mergeBase"], meta["head"], meta["newRev"]), (o["fork"], o["head"], o["head"]))
        pr = meta["pr"]
        self.assertEqual((pr["baseSha"], pr["startSha"], pr["mergeBaseSha"]), (o["fork"], o["base"], o["fork"]))
        self.assertEqual((pr["viewer"], pr["state"]), ("me", "open"))
        self.assertEqual(set(self.by_path(meta)), {"a.txt", "b.txt", "new.txt", "renamed.txt"})
        self.root = Path(meta["root"])
        self.check_invariants(out, meta, self.reader(o["head"]))

    def test_gitlab_cache_clone_nested_group(self):
        self.set_rules(gitlab_rules(self.origin))
        empty = self.tmp / "not-a-repo"
        empty.mkdir()
        url = "https://gitlab.example.com/g/sub/proj/-/merge_requests/1/diffs#note_1"
        _, out, meta = self.collect_pr(url, repo=empty)
        self.check_gitlab_meta(meta, out)
        clone = self.calls("glab", "repo clone")
        self.assertEqual(len(clone), 1)
        self.assertEqual(clone[0]["argv"][2], "g/sub/proj")
        self.assertEqual(clone[0]["env"]["GITLAB_HOST"], "gitlab.example.com")
        self.assertEqual(clone[0]["argv"][-3:], ["--", "--no-checkout", "--filter=blob:none"])
        cached = self.cache / "diff-review" / "repos" / "gitlab.example.com" / "g" / "sub" / "proj"
        self.assertEqual(Path(meta["root"]).resolve(), cached.resolve())

    def test_gitlab_local_clone_with_shorthand(self):
        self.set_rules(gitlab_rules(self.origin))
        self.user_repo("git@gitlab.example.com:g/sub/proj.git")
        before = self.snapshot()
        _, out, meta = self.collect_pr("!1")
        self.check_gitlab_meta(meta, out)
        self.assertEqual(Path(meta["root"]).resolve(), self.repo.resolve())
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.calls("glab", "repo clone"))

    def test_current_branch_shorthand(self):
        self.set_rules([*github_rules(self.origin), rule("gh", ["pr view --json number"], {"number": 1})])
        self.user_repo("https://github.com/o/r.git")
        _, out, meta = self.collect_pr("pr")
        self.check_github_meta(meta, out)

    def test_empty_pr_diff_exits_3(self):
        o = self.origin
        self.set_rules(github_rules(o, baseRefOid=o["fork"], headRefOid=o["fork"]))
        empty = self.tmp / "not-a-repo"
        empty.mkdir()
        r, _, _ = self.collect_pr("https://github.com/o/r/pull/1", repo=empty, expect=3)
        self.assertEqual(json.loads(r.stdout)["reason"], "no-changes")

    def test_missing_commit_after_fetch_is_an_error(self):
        o = self.origin
        self.set_rules(github_rules(o, headRefOid="0" * 40))
        empty = self.tmp / "not-a-repo"
        empty.mkdir()
        r, _, _ = self.collect_pr("https://github.com/o/r/pull/1", repo=empty, expect=2)
        self.assertRegex(r.stderr.decode(), r"^Error: .*head commit 0{40} is not available")

    def test_default_outdir_name_uses_repo_and_number(self):
        for rules, ref, name in (
            (github_rules(self.origin), "https://github.com/o/r/pull/1", r"^r-pr1-\d{8}-\d{6}$"),
            (gitlab_rules(self.origin), "https://gitlab.example.com/g/sub/proj/-/merge_requests/1", r"^proj-mr1-"),
        ):
            with self.subTest(ref=ref):
                self.set_rules(rules)
                cmd = [sys.executable, str(test_collect.COLLECT), "--repo", str(self.tmp), "--pr", ref]
                r = subprocess.run(cmd, capture_output=True, env=self.env)
                self.assertEqual(r.returncode, 0, r.stderr.decode())
                outdir = Path(json.loads(r.stdout)["outdir"])
                self.assertRegex(outdir.name, name)
                self.assertEqual(outdir.parent.resolve(), (self.cache / "diff-review").resolve())

    def test_pr_cannot_be_combined_with_local_options(self):
        for extra in (["--mode", "staged"], ["--ref", "HEAD"], ["--base", "main"]):
            with self.subTest(extra=extra):
                r, _, _ = self.collect_pr("#1", *extra, expect=2)
                self.assertIn("--pr cannot be combined", r.stderr.decode())

    def test_cli_errors_exit_2(self):
        self.set_rules([rule("gh", [], exit=1, stderr="To get started with GitHub CLI, please run:  gh auth login")])
        r, _, _ = self.collect_pr("https://ghe.corp.example/o/r/pull/1", expect=2)
        self.assertIn("gh auth login --hostname ghe.corp.example", r.stderr.decode())
        self.set_rules([])
        r, _, _ = self.collect_pr("not a pr", expect=2)
        self.assertIn("cannot parse the PR reference", r.stderr.decode())

    def test_local_modes_never_write_pr(self):
        write(self.repo, "x.txt", "x\n")
        commit(self.repo, "x")
        write(self.repo, "x.txt", "y\n")
        _, meta = self.collect("--mode", "uncommitted")
        self.assertNotIn("pr", meta)


class EnsureCommitsTest(FakeCliMixin, test_collect.Base):
    """The fetch is skipped for commits that are already there and never updates remote-tracking branches."""

    def test_fetch_only_what_is_missing(self):
        self.setup_fakecli()
        origin = make_origin(self.tmp)
        git(self.repo, "remote", "add", "origin", "https://github.com/o/r.git")
        git(self.repo, "config", f"url.{origin['bare']}.insteadOf", "https://github.com/o/r.git")
        pr = {
            "provider": "github",
            "host": "github.com",
            "repo": "o/r",
            "number": 1,
            "baseRef": "main",
            "baseSha": origin["base"],
            "headSha": origin["head"],
        }
        root = remote.ensure_commits(pr, self.repo)
        self.assertEqual(Path(root).resolve(), self.repo.resolve())
        self.assertEqual(pr["mergeBaseSha"], origin["fork"])
        self.assertEqual(git(self.repo, "for-each-ref").decode(), "")  # no branches, tags or tracking refs added
        with mock.patch.object(remote, "git_fetch", side_effect=AssertionError("fetched again")):
            remote.ensure_commits(pr, self.repo)

    def test_base_branch_name_is_the_fallback_when_the_sha_cannot_be_fetched(self):
        self.setup_fakecli()
        origin = make_origin(self.tmp)
        git(self.repo, "remote", "add", "origin", str(origin["bare"]))
        calls = []
        real = remote.git_fetch

        def fetch(root, name, refs):
            calls.append(refs)
            return (1, "", "not our ref") if origin["base"] in refs else real(root, name, refs)

        pr = {
            "provider": "github",
            "host": "x",
            "repo": "o/r",
            "number": 1,
            "baseRef": "main",
            "baseSha": origin["base"],
            "headSha": origin["head"],
        }
        with (
            mock.patch.object(remote, "local_clone", return_value=(self.repo, "origin")),
            mock.patch.object(remote, "git_fetch", fetch),
        ):
            remote.ensure_commits(pr, self.repo)
        self.assertEqual(calls, [[origin["base"], "refs/pull/1/head"], ["main", "refs/pull/1/head"]])
        self.assertEqual(git(self.repo, "for-each-ref").decode(), "")  # fetching `main` made no tracking branch
        self.assertEqual(pr["mergeBaseSha"], origin["fork"])


if __name__ == "__main__":
    unittest.main()

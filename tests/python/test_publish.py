"""Tests for diff-review publish.py and `POST /api/publish` in serve.py.

serve.py runs as a real process with the fake gh / glab from tests/fakecli on PATH; no network.
"""

import hashlib
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import test_serve
from fakecli_support import FakeCliMixin

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import publish  # noqa: E402

HEAD = "h" * 40
MOVED = "m" * 40
GH_PR = {
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
    "headSha": HEAD,
    "startSha": None,
    "mergeBaseSha": "f" * 40,
    "body": "",
    "viewer": "me",
}
GL_PR = {
    **GH_PR,
    "provider": "gitlab",
    "host": "gitlab.example.com",
    "repo": "g/sub/proj",
    "url": "https://gitlab.example.com/g/sub/proj/-/merge_requests/1",
    "baseSha": "f" * 40,
    "startSha": "s" * 40,
}
GL_MR = "api --hostname gitlab.example.com projects/g%2Fsub%2Fproj/merge_requests/1"
GL_BASE = "api --hostname gitlab.example.com --method POST projects/g%2Fsub%2Fproj/merge_requests/1"
GH_REVIEW = "api --hostname github.com --method POST repos/o/r/pulls/1/reviews"
REVIEW_URL = "https://github.com/o/r/pull/1#pullrequestreview-9"


def pt(kind, old, new):
    return {"type": kind, "old": old, "new": new}


def comment(cid="c1", path="scripts/collect.py", side="new", start=None, end=None, old_path=None, body=None):
    end = end or pt("add", 10, 12)
    return {
        "id": cid,
        "path": path,
        "oldPath": old_path,
        "side": side,
        "start": start or end,
        "end": end,
        "body": body or f"body of {cid}",
        "fallback": f"fallback of {cid}",
    }


def rule(cli, match, stdout="", exit=0, stderr="", **extra):
    return {"cli": cli, "match": match, "stdout": stdout, "exit": exit, "stderr": stderr, **extra}


class MappingTest(unittest.TestCase):
    """The pure payload builders."""

    def test_github_new_side_single_line(self):
        c = comment(end=pt("add", 10, 12))
        self.assertEqual(
            publish.github_comment(c), {"path": "scripts/collect.py", "body": "body of c1", "side": "RIGHT", "line": 12}
        )

    def test_github_new_side_range(self):
        c = comment(start=pt("ctx", 7, 7), end=pt("add", 9, 11))
        got = publish.github_comment(c)
        self.assertEqual((got["side"], got["line"], got["start_line"], got["start_side"]), ("RIGHT", 11, 7, "RIGHT"))

    def test_github_old_side_uses_old_numbers_and_left(self):
        c = comment(side="old", start=pt("del", 4, 3), end=pt("del", 6, 3))
        got = publish.github_comment(c)
        self.assertEqual((got["side"], got["line"], got["start_line"], got["start_side"]), ("LEFT", 6, 4, "LEFT"))

    def test_github_no_start_line_when_both_ends_have_the_same_number(self):
        # start and end differ in the other side's counter only: still a single line on the selected side
        c = comment(side="new", start=pt("add", 5, 9), end=pt("add", 6, 9))
        self.assertNotIn("start_line", publish.github_comment(c))

    def test_gitlab_positions_by_line_type(self):
        for kind, old, new, want in (
            ("add", 5, 8, {"new_line": 8}),
            ("del", 5, 8, {"old_line": 5}),
            ("ctx", 5, 8, {"old_line": 5, "new_line": 8}),
        ):
            with self.subTest(kind=kind):
                pos = publish.gitlab_position(GL_PR, comment(end=pt(kind, old, new)))
                lines = {k: v for k, v in pos.items() if k in ("old_line", "new_line")}
                self.assertEqual(lines, want)
                self.assertNotIn("line_range", pos)
                self.assertEqual(
                    (pos["position_type"], pos["base_sha"], pos["start_sha"], pos["head_sha"]),
                    ("text", "f" * 40, "s" * 40, HEAD),
                )

    def test_gitlab_paths_for_a_rename(self):
        pos = publish.gitlab_position(GL_PR, comment(path="b.txt", old_path="a.txt"))
        self.assertEqual((pos["old_path"], pos["new_path"]), ("a.txt", "b.txt"))
        pos = publish.gitlab_position(GL_PR, comment(path="b.txt"))
        self.assertEqual((pos["old_path"], pos["new_path"]), ("b.txt", "b.txt"))

    def test_gitlab_line_range_and_line_codes(self):
        c = comment(start=pt("ctx", 3, 3), end=pt("add", 6, 7))
        pos = publish.gitlab_position(GL_PR, c)
        sha = hashlib.sha1(b"scripts/collect.py").hexdigest()
        self.assertEqual(pos["new_line"], 7)
        self.assertEqual(
            pos["line_range"],
            {
                "start": {"line_code": f"{sha}_3_3", "type": None},
                "end": {"line_code": f"{sha}_6_7", "type": "new"},
            },
        )
        c = comment(side="old", start=pt("del", 4, 9), end=pt("del", 6, 9))
        pos = publish.gitlab_position(GL_PR, c)
        self.assertEqual(
            (pos["old_line"], pos["line_range"]["start"]["type"], pos["line_range"]["end"]["type"]), (6, "old", "old")
        )


class PublishCase(FakeCliMixin, test_serve.ServerCase):
    """Server on a PR outdir. `pr` is the meta.json pr object (None: a local review)."""

    pr = GH_PR

    def setUp(self):
        self.setup_fakecli()
        super().setUp()

    def prepare_outdir(self):
        meta_path = self.outdir / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if self.pr:
            meta["pr"] = self.pr
        meta_path.write_text(json.dumps(meta), encoding="utf-8")

    def publish(self, **over):
        body = {"event": "comment", "body": "overall", "comments": [], "markdown": "# feedback", "force": False}
        status, raw = self.request("POST", "/api/publish", {**body, **over})
        return status, json.loads(raw)

    def alive(self):
        return self.proc.poll() is None

    def finish(self):
        out, _ = self.proc.communicate(timeout=15)
        return out.strip().splitlines()[-1]

    def payloads(self, containing):
        return [json.loads(e["stdin"]) for e in self.calls(containing=containing)]


class GithubPublishTest(PublishCase):
    def setUp(self):
        super().setUp()
        self.set_rules(
            [
                rule("gh", ["pr view 1 -R github.com/o/r --json headRefOid"], {"headRefOid": HEAD}),
                rule("gh", [GH_REVIEW], {"html_url": REVIEW_URL}),
            ]
        )

    def test_review_is_exposed_with_pr_meta(self):
        data = json.loads(self.request("GET", "/api/review")[1])
        self.assertEqual(data["meta"]["pr"], GH_PR)

    def test_single_review_with_inline_comments(self):
        comments = [
            comment("c1", end=pt("add", 10, 12)),
            comment("c2", path="a.txt", start=pt("ctx", 7, 7), end=pt("add", 9, 11)),
            comment("c3", path="b.txt", side="old", start=pt("del", 4, 3), end=pt("del", 6, 3)),
        ]
        status, body = self.publish(event="approve", comments=comments, markdown="# done\n")
        self.assertEqual((status, body), (200, {"ok": True, "url": REVIEW_URL, "inline": 3, "folded": False}))
        self.assertEqual(self.finish(), f"DIFF_REVIEW_RESULT: published {self.outdir.resolve() / 'feedback.md'}")
        self.assertEqual((self.outdir / "feedback.md").read_text(encoding="utf-8"), "# done\n")
        review = self.calls("gh", "repos/o/r/pulls/1/reviews")
        self.assertEqual(len(review), 1)
        self.assertEqual(review[0]["argv"][-2:], ["--input", "-"])
        self.assertEqual(
            json.loads(review[0]["stdin"]),
            {
                "commit_id": HEAD,
                "event": "APPROVE",
                "body": "overall",
                "comments": [
                    {"path": "scripts/collect.py", "body": "body of c1", "side": "RIGHT", "line": 12},
                    {
                        "path": "a.txt",
                        "body": "body of c2",
                        "side": "RIGHT",
                        "line": 11,
                        "start_line": 7,
                        "start_side": "RIGHT",
                    },
                    {
                        "path": "b.txt",
                        "body": "body of c3",
                        "side": "LEFT",
                        "line": 6,
                        "start_line": 4,
                        "start_side": "LEFT",
                    },
                ],
            },
        )

    def test_events(self):
        # A failing review keeps the server running, so every event can be tried on the same server.
        self.set_rules([rule("gh", [GH_REVIEW], "", exit=1, stderr="stop")])
        for event, want in (("comment", "COMMENT"), ("approve", "APPROVE"), ("request_changes", "REQUEST_CHANGES")):
            with self.subTest(event=event):
                status, body = self.publish(event=event, force=True)
                self.assertEqual((status, body["error"]), (502, "publish_failed"))
                self.assertEqual(self.payloads(GH_REVIEW)[-1]["event"], want)

    def test_approve_without_text_sends_an_empty_body(self):
        status, _ = self.publish(event="approve", body="", markdown="")
        self.assertEqual(status, 200)
        sent = self.payloads(GH_REVIEW)[0]
        self.assertEqual((sent["event"], sent["body"], sent["comments"]), ("APPROVE", "", []))
        self.assertEqual(self.finish(), "DIFF_REVIEW_RESULT: published")
        self.assertFalse((self.outdir / "feedback.md").exists())

    def test_head_check_comes_first(self):
        self.set_rules([rule("gh", ["--json headRefOid"], {"headRefOid": MOVED}), rule("gh", [GH_REVIEW], {})])
        status, body = self.publish()
        self.assertEqual((status, body), (409, {"error": "head_moved", "head": MOVED}))
        self.assertEqual(self.calls("gh", GH_REVIEW), [])
        self.assertTrue(self.alive())

    def test_force_skips_the_head_check(self):
        self.set_rules([rule("gh", ["--json headRefOid"], {"headRefOid": MOVED}), rule("gh", [GH_REVIEW], {})])
        status, body = self.publish(force=True)
        self.assertEqual((status, body["ok"], body["url"]), (200, True, GH_PR["url"]))
        self.assertEqual(self.calls("gh", "headRefOid"), [])
        self.assertEqual(self.payloads(GH_REVIEW)[0]["commit_id"], HEAD)  # the reviewed commit, not the new head

    def test_422_on_a_comment_position_is_folded_into_the_body(self):
        unresolved = {"message": "Unprocessable Entity", "errors": ["Pull request review thread line is invalid"]}
        self.set_rules(
            [
                rule("gh", ["--json headRefOid"], {"headRefOid": HEAD}),
                rule("gh", [GH_REVIEW], unresolved, exit=1, stderr="gh: Unprocessable Entity (HTTP 422)\n", nth=1),
                rule("gh", [GH_REVIEW], {"html_url": REVIEW_URL}, nth=2),
            ]
        )
        comments = [comment("c1"), comment("c2")]
        status, body = self.publish(comments=comments)
        self.assertEqual((status, body), (200, {"ok": True, "url": REVIEW_URL, "inline": 0, "folded": True}))
        first, second = self.payloads(GH_REVIEW)
        self.assertEqual(len(first["comments"]), 2)
        self.assertEqual(second["comments"], [])
        self.assertEqual(second["body"], "overall\n\nfallback of c1\n\nfallback of c2")
        self.assertEqual(second["commit_id"], HEAD)

    def test_folded_body_without_a_general_text(self):
        self.set_rules(
            [
                rule("gh", ["--json headRefOid"], {"headRefOid": HEAD}),
                rule("gh", [GH_REVIEW], "", exit=1, stderr="HTTP 422: path could not be resolved", nth=1),
                rule("gh", [GH_REVIEW], {"html_url": REVIEW_URL}, nth=2),
            ]
        )
        self.assertEqual(self.publish(body="", comments=[comment("c1")])[0], 200)
        self.assertEqual(self.payloads(GH_REVIEW)[1]["body"], "fallback of c1")

    def test_422_is_retried_only_once(self):
        self.set_rules(
            [
                rule("gh", ["--json headRefOid"], {"headRefOid": HEAD}),
                rule("gh", [GH_REVIEW], "", exit=1, stderr="HTTP 422: line must be part of the diff"),
            ]
        )
        status, body = self.publish(comments=[comment("c1")])
        self.assertEqual((status, body["error"]), (502, "publish_failed"))
        self.assertEqual(len(self.calls("gh", GH_REVIEW)), 2)
        self.assertTrue(self.alive())

    def test_unrelated_422_is_not_retried(self):
        self.set_rules(
            [
                rule("gh", ["--json headRefOid"], {"headRefOid": HEAD}),
                rule(
                    "gh",
                    [GH_REVIEW],
                    "",
                    exit=1,
                    stderr="gh: Unprocessable Entity (HTTP 422)\nCan not approve your own",
                ),
            ]
        )
        status, body = self.publish(event="approve", comments=[comment("c1")])
        self.assertEqual(status, 502)
        self.assertIn("Can not approve your own", body["detail"])
        self.assertEqual(len(self.calls("gh", GH_REVIEW)), 1)

    def test_failure_keeps_the_server_running_and_allows_a_retry(self):
        self.set_rules(
            [
                rule("gh", ["--json headRefOid"], {"headRefOid": HEAD}),
                rule("gh", [GH_REVIEW], "", exit=1, stderr="x" * 5000, nth=1),
                rule("gh", [GH_REVIEW], {"html_url": REVIEW_URL}, nth=2),
            ]
        )
        status, body = self.publish()
        self.assertEqual((status, body["error"], body["done"]), (502, "publish_failed", []))
        self.assertLessEqual(len(body["detail"]), 2001)
        self.assertTrue(self.alive())
        self.assertEqual(self.request("GET", "/api/review")[0], 200)
        self.assertFalse((self.outdir / "feedback.md").exists())
        self.assertEqual(self.publish()[0], 200)
        self.assertTrue(self.finish().startswith("DIFF_REVIEW_RESULT: published"))

    def test_already_submitted(self):
        self.set_rules(
            [
                rule("gh", ["--json headRefOid"], {"headRefOid": HEAD}),
                rule("gh", [GH_REVIEW], {"html_url": REVIEW_URL}, sleep=1.5),
            ]
        )
        results = {}

        def first():
            results["first"] = self.publish()

        t = threading.Thread(target=first)
        t.start()
        time.sleep(0.5)
        results["second"] = self.publish()
        t.join()
        self.assertEqual(results["first"][0], 200)
        self.assertEqual(results["second"], (409, {"error": "already_submitted"}))
        self.assertEqual(len(self.calls("gh", GH_REVIEW)), 1)

    def test_bad_requests(self):
        for over, code in (
            ({"event": "bogus"}, "event"),
            ({"event": None}, "event"),
            ({"comments": [{"id": "x"}]}, "comments"),
            ({"comments": "nope"}, "comments"),
            ({"comments": [comment("c1", end={"type": "add", "old": "1", "new": 2})]}, "comments"),
            ({"comments": [comment("c1", side="middle")]}, "comments"),
        ):
            with self.subTest(over=over):
                status, body = self.publish(**over)
                self.assertEqual((status, body), (400, {"error": code}))
        self.assertEqual(self.calls(), [])
        self.assertTrue(self.alive())

    def test_token_is_required(self):
        status, _ = self.request("POST", "/api/publish", {"event": "comment"}, token=False)
        self.assertEqual(status, 403)
        self.assertEqual(self.calls(), [])

    def test_submit_after_a_failed_publish_still_works(self):
        self.set_rules([rule("gh", ["--json headRefOid"], "", exit=1, stderr="network down")])
        self.assertEqual(self.publish()[0], 502)
        self.assertEqual(self.request("POST", "/api/submit", {"action": "approve"})[0], 200)
        self.assertEqual(self.finish(), "DIFF_REVIEW_RESULT: approved")


class LocalReviewPublishTest(PublishCase):
    pr = None

    def test_not_a_pr(self):
        status, body = self.publish()
        self.assertEqual((status, body), (400, {"error": "not_a_pr"}))
        self.assertTrue(self.alive())
        self.assertEqual(self.calls(), [])
        self.assertNotIn("pr", json.loads(self.request("GET", "/api/review")[1])["meta"])


class GitlabPublishTest(PublishCase):
    pr = GL_PR

    def setUp(self):
        super().setUp()
        self.set_rules(
            [
                rule("glab", [f"{GL_BASE}/discussions"], {"id": "d1"}),
                rule("glab", [f"{GL_BASE}/notes"], {"id": 1}),
                rule("glab", [f"{GL_BASE}/approve"], {}),
                rule("glab", [GL_MR], {"diff_refs": {"head_sha": HEAD}, "sha": HEAD}),  # the head check: no --method
            ]
        )

    def steps(self):
        return [e["argv"][5].rsplit("/", 1)[-1] for e in self.calls("glab", "--method POST")]

    def test_discussions_note_then_approve(self):
        comments = [
            comment("c1", end=pt("add", 5, 8)),
            comment("c2", path="a.txt", old_path="z.txt", end=pt("del", 3, 8)),
            comment("c3", path="b.txt", end=pt("ctx", 4, 4)),
        ]
        status, body = self.publish(event="approve", comments=comments)
        self.assertEqual((status, body), (200, {"ok": True, "url": GL_PR["url"], "inline": 3, "folded": False}))
        self.assertEqual(self.steps(), ["discussions"] * 3 + ["notes", "approve"])
        discussions = self.payloads("/discussions")
        self.assertEqual(discussions[0]["body"], "body of c1")
        self.assertEqual(
            discussions[0]["position"],
            {
                "position_type": "text",
                "base_sha": "f" * 40,
                "start_sha": "s" * 40,
                "head_sha": HEAD,
                "old_path": "scripts/collect.py",
                "new_path": "scripts/collect.py",
                "new_line": 8,
            },
        )
        self.assertEqual(
            {k: v for k, v in discussions[1]["position"].items() if k.endswith(("_path", "_line"))},
            {"old_path": "z.txt", "new_path": "a.txt", "old_line": 3},
        )
        self.assertEqual(
            {k: v for k, v in discussions[2]["position"].items() if k.endswith("_line")}, {"old_line": 4, "new_line": 4}
        )
        self.assertEqual(self.payloads("/notes"), [{"body": "overall"}])
        approve = self.calls("glab", "/approve")[0]
        self.assertEqual(approve["argv"][-2:], ["--input", "-"])
        self.assertEqual(json.loads(approve["stdin"]), {})
        self.assertEqual(
            json.loads((self.outdir / "published.json").read_text()),
            {"done": ["c:c1", "c:c2", "c:c3", "body", "approve"]},
        )
        self.assertEqual(self.finish(), f"DIFF_REVIEW_RESULT: published {self.outdir.resolve() / 'feedback.md'}")

    def test_range_comment_carries_line_codes(self):
        c = comment("c1", start=pt("ctx", 3, 3), end=pt("add", 6, 7))
        self.assertEqual(self.publish(comments=[c])[0], 200)
        pos = self.payloads("/discussions")[0]["position"]
        sha = hashlib.sha1(b"scripts/collect.py").hexdigest()
        self.assertEqual(pos["line_range"]["start"], {"line_code": f"{sha}_3_3", "type": None})
        self.assertEqual(pos["line_range"]["end"], {"line_code": f"{sha}_6_7", "type": "new"})

    def test_comment_only_event_posts_no_approval(self):
        self.assertEqual(self.publish(comments=[comment("c1")], body="")[0], 200)
        self.assertEqual(self.steps(), ["discussions"])

    def test_partial_failure_then_retry_posts_only_the_rest(self):
        discussions = f"{GL_BASE}/discussions"
        self.set_rules(
            [
                rule("glab", [discussions], {"id": "ok"}, nth=1),
                rule("glab", [discussions], "", exit=1, stderr="400 Bad request: line_code is invalid", nth=2),
                rule("glab", [discussions], {"id": "ok"}),
                rule("glab", [f"{GL_BASE}/notes"], {}),
                rule("glab", [f"{GL_BASE}/approve"], {}),
                rule("glab", [GL_MR], {"diff_refs": {"head_sha": HEAD}}),
            ]
        )
        comments = [comment("c1"), comment("c2"), comment("c3")]
        status, body = self.publish(event="approve", comments=comments)
        self.assertEqual(status, 502)
        self.assertEqual((body["error"], body["done"]), ("publish_failed", ["c:c1"]))
        self.assertIn("line_code is invalid", body["detail"])
        self.assertTrue(self.alive())
        self.assertEqual(json.loads((self.outdir / "published.json").read_text()), {"done": ["c:c1"]})
        self.assertFalse((self.outdir / "feedback.md").exists())

        status, body = self.publish(event="approve", comments=comments)
        self.assertEqual((status, body["inline"]), (200, 3))
        sent = [p["body"] for p in self.payloads("/discussions")]
        self.assertEqual(sent, ["body of c1", "body of c2", "body of c2", "body of c3"])  # c1 only once
        self.assertEqual(self.steps().count("notes"), 1)
        self.assertEqual(self.steps().count("approve"), 1)
        self.assertTrue(self.finish().startswith("DIFF_REVIEW_RESULT: published"))

    def test_failure_at_the_note_keeps_finished_discussions(self):
        self.set_rules(
            [
                rule("glab", [f"{GL_BASE}/discussions"], {}),
                rule("glab", [f"{GL_BASE}/notes"], "", exit=1, stderr="500 oops", nth=1),
                rule("glab", [f"{GL_BASE}/notes"], {}),
                rule("glab", [f"{GL_BASE}/approve"], {}),
                rule("glab", [GL_MR], {"diff_refs": {"head_sha": HEAD}}),
            ]
        )
        status, body = self.publish(event="approve", comments=[comment("c1")])
        self.assertEqual((status, body["done"]), (502, ["c:c1"]))
        self.assertEqual(self.publish(event="approve", comments=[comment("c1")])[0], 200)
        self.assertEqual(self.steps(), ["discussions", "notes", "notes", "approve"])
        self.assertEqual(json.loads((self.outdir / "published.json").read_text())["done"], ["c:c1", "body", "approve"])

    def test_head_moved_uses_diff_refs_head_sha(self):
        self.set_rules([rule("glab", [GL_MR], {"diff_refs": {"head_sha": MOVED}, "sha": HEAD})])
        status, body = self.publish()
        self.assertEqual((status, body), (409, {"error": "head_moved", "head": MOVED}))
        self.assertEqual(self.steps(), [])
        self.set_rules([rule("glab", [f"{GL_BASE}/notes"], {})])
        self.assertEqual(self.publish(force=True)[0], 200)

    def test_request_changes_is_github_only(self):
        status, body = self.publish(event="request_changes")
        self.assertEqual((status, body), (400, {"error": "event"}))
        self.assertEqual(self.calls(), [])


class CurrentHeadTest(FakeCliMixin, unittest.TestCase):
    def setUp(self):
        self.setup_fakecli()

    def test_gitlab_falls_back_to_sha(self):
        self.set_rules([rule("glab", [GL_MR], {"diff_refs": None, "sha": MOVED})])
        self.assertEqual(publish.current_head(GL_PR), MOVED)

    def test_cli_failure_is_a_publish_failure(self):
        self.set_rules([rule("gh", [], exit=1, stderr="gh: not logged in")])
        with self.assertRaisesRegex(publish.PublishFailed, "not logged in"):
            publish.current_head(GH_PR)

    def test_missing_cli_is_a_publish_failure(self):
        with tempfile.TemporaryDirectory() as empty, mock.patch.dict(os.environ, {"PATH": empty}):
            with self.assertRaises(publish.PublishFailed) as ctx:
                publish.publish(empty, GH_PR, {"event": "comment", "body": "x", "comments": []})
            self.assertIn("`gh` is not installed", ctx.exception.detail)


if __name__ == "__main__":
    unittest.main()

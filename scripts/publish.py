#!/usr/bin/env python3
"""Publish a diff-review result to a GitHub pull request or GitLab merge request.

Used by serve.py for `POST /api/publish`. The request (event, general body, inline comments) is turned into
API calls made through `gh api` / `glab api`, with the JSON payload on stdin:

  GitHub  one review (`pulls/N/reviews`) with all inline comments; if GitHub rejects a comment position (HTTP 422)
          the review is sent once more with the comments folded into its body.
  GitLab  one discussion per inline comment, then a note with the general body, then the approval. Every finished
          step is recorded in `<outdir>/published.json`, so a retry after a failure only repeats the rest.

Before anything is sent the PR head is compared with the one the review was collected from (unless forced).
Standard library only; the CLIs are the only network path.
"""

import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import quote

import remote

EVENTS = {"comment": "COMMENT", "approve": "APPROVE", "request_changes": "REQUEST_CHANGES"}
LINE_TYPES = ("add", "del", "ctx")
UNRESOLVED = re.compile(r"\b(line|position|path)\b|could not be resolved", re.I)


class BadRequest(Exception):
    """The request is malformed; `code` is the API error code."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


class HeadMoved(Exception):
    def __init__(self, head):
        super().__init__(head)
        self.head = head


class PublishFailed(Exception):
    """A CLI call failed. `done` lists the steps that already went through."""

    def __init__(self, detail, done=()):
        super().__init__(detail)
        self.detail = remote.trim(detail)
        self.done = list(done)


# --- request checks ---------------------------------------------------------------------------------------------


def valid_point(p):
    return (
        isinstance(p, dict)
        and p.get("type") in LINE_TYPES
        and all(isinstance(p.get(k), int) and not isinstance(p.get(k), bool) for k in ("old", "new"))
    )


def valid_comment(c):
    return (
        isinstance(c, dict)
        and isinstance(c.get("id"), str)
        and isinstance(c.get("path"), str)
        and isinstance(c.get("body"), str)
        and c.get("side") in ("new", "old")
        and (c.get("oldPath") is None or isinstance(c.get("oldPath"), str))
        and valid_point(c.get("start"))
        and valid_point(c.get("end"))
    )


def check_request(pr, req):
    """Raises BadRequest(code) for a request that cannot be published."""
    if not pr:
        raise BadRequest("not_a_pr")
    event = req.get("event")
    if event not in EVENTS or (event == "request_changes" and pr["provider"] != remote.GITHUB):
        raise BadRequest("event")
    comments = req.get("comments") or []
    if not isinstance(comments, list) or not all(valid_comment(c) for c in comments):
        raise BadRequest("comments")
    if not isinstance(req.get("body") or "", str):
        raise BadRequest("body")


# --- talking to the CLIs ----------------------------------------------------------------------------------------


def api(pr, path, payload, method="POST"):
    """Call the provider API through gh / glab with a JSON body on stdin; returns (rc, parsed JSON or None, text)."""
    cli = remote.CLI_BY_PROVIDER[pr["provider"]]
    argv = [cli, "api", "--hostname", pr["host"], "--method", method, path, "--input", "-"]
    rc, stdout, stderr = remote.run(argv, input_text=json.dumps(payload, ensure_ascii=False))
    try:
        data = json.loads(stdout)
    except ValueError:
        data = None
    return rc, data, "\n".join(s.strip() for s in (stderr, stdout) if s.strip())


def current_head(pr):
    """Head sha of the PR as it is on the server now."""
    host, repo, number = pr["host"], pr["repo"], pr["number"]
    if pr["provider"] == remote.GITHUB:
        argv = ["gh", "pr", "view", str(number), "-R", f"{host}/{repo}", "--json", "headRefOid"]
    else:
        argv = ["glab", "api", "--hostname", host, f"projects/{quote(repo, safe='')}/merge_requests/{number}"]
    rc, stdout, stderr = remote.run(argv)
    try:
        data = json.loads(stdout)
    except ValueError:
        data = None
    if rc != 0 or not isinstance(data, dict):
        raise PublishFailed(stderr or stdout or "could not read the current PR head")
    if pr["provider"] == remote.GITHUB:
        head = data.get("headRefOid")
    else:
        head = (data.get("diff_refs") or {}).get("head_sha") or data.get("sha")
    if not head:
        raise PublishFailed("the server did not report the current PR head")
    return head


# --- GitHub -----------------------------------------------------------------------------------------------------


def github_comment(c):
    """One entry of the review `comments` array. side new -> RIGHT with the new line numbers, old -> LEFT."""
    new_side = c["side"] == "new"
    key = "new" if new_side else "old"
    side = "RIGHT" if new_side else "LEFT"
    out = {"path": c["path"], "body": c["body"], "side": side, "line": c["end"][key]}
    if c["start"][key] != c["end"][key]:
        out["start_line"] = c["start"][key]
        out["start_side"] = side
    return out


def publish_github(pr, req):
    comments = req.get("comments") or []
    body = req.get("body") or ""
    path = f"repos/{pr['repo']}/pulls/{pr['number']}/reviews"
    payload = {
        "commit_id": pr["headSha"],
        "event": EVENTS[req["event"]],
        "body": body,
        "comments": [github_comment(c) for c in comments],
    }
    rc, data, text = api(pr, path, payload)
    folded = False
    if rc != 0 and comments and "422" in text and UNRESOLVED.search(text):
        # GitHub could not place at least one inline comment: send everything once more as one review body.
        extra = "\n\n".join(c["fallback"] for c in comments)
        payload = {**payload, "comments": [], "body": f"{body}\n\n{extra}" if body else extra}
        rc, data, text = api(pr, path, payload)
        folded = rc == 0
    if rc != 0:
        raise PublishFailed(text)
    url = (data or {}).get("html_url") or pr["url"]
    return {"url": url, "inline": 0 if folded else len(comments), "folded": folded}


# --- GitLab -----------------------------------------------------------------------------------------------------


def line_code(path, point):
    return f"{hashlib.sha1(path.encode()).hexdigest()}_{point['old']}_{point['new']}"


def gitlab_position(pr, c):
    start, end = c["start"], c["end"]
    pos = {
        "position_type": "text",
        "base_sha": pr["mergeBaseSha"],
        "start_sha": pr["startSha"],
        "head_sha": pr["headSha"],
        "old_path": c.get("oldPath") or c["path"],
        "new_path": c["path"],
    }
    if end["type"] in ("add", "ctx"):
        pos["new_line"] = end["new"]
    if end["type"] in ("del", "ctx"):
        pos["old_line"] = end["old"]
    if (start["type"], start["old"], start["new"]) != (end["type"], end["old"], end["new"]):
        kind = {"add": "new", "del": "old", "ctx": None}
        pos["line_range"] = {
            "start": {"line_code": line_code(c["path"], start), "type": kind[start["type"]]},
            "end": {"line_code": line_code(c["path"], end), "type": kind[end["type"]]},
        }
    return pos


class Progress:
    """The `done` steps of a GitLab publish, persisted in published.json after every step."""

    def __init__(self, outdir):
        self.path = Path(outdir) / "published.json"
        try:
            self.done = list(json.loads(self.path.read_text(encoding="utf-8")).get("done", []))
        except (OSError, ValueError, AttributeError):
            self.done = []

    def add(self, step):
        self.done.append(step)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"done": self.done}, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)


def publish_gitlab(pr, req, outdir):
    comments = req.get("comments") or []
    body = req.get("body") or ""
    base = f"projects/{quote(pr['repo'], safe='')}/merge_requests/{pr['number']}"
    progress = Progress(outdir)

    def step(name, path, payload):
        if name in progress.done:
            return
        rc, _, text = api(pr, path, payload)
        if rc != 0:
            raise PublishFailed(text, progress.done)
        progress.add(name)

    for c in comments:
        step(f"c:{c['id']}", f"{base}/discussions", {"body": c["body"], "position": gitlab_position(pr, c)})
    if body.strip():
        step("body", f"{base}/notes", {"body": body})
    if req["event"] == "approve":
        step("approve", f"{base}/approve", {})
    inline = sum(1 for c in comments if f"c:{c['id']}" in progress.done)
    return {"url": pr["url"], "inline": inline, "folded": False}


# --- entry point ------------------------------------------------------------------------------------------------


def publish(outdir, pr, req):
    """Publish the request. Returns {url, inline, folded}.

    Raises BadRequest (malformed request), HeadMoved (the PR changed since collection and not forced) or
    PublishFailed (a CLI call failed; calling again continues where it stopped on GitLab).
    """
    check_request(pr, req)
    try:
        if not req.get("force"):
            head = current_head(pr)
            if head != pr["headSha"]:
                raise HeadMoved(head)
        if pr["provider"] == remote.GITHUB:
            return publish_github(pr, req)
        return publish_gitlab(pr, req, outdir)
    except remote.RemoteError as e:  # the CLI is not installed
        raise PublishFailed(str(e)) from e

#!/usr/bin/env python3
"""Local review server for diff-review.

Serves the viewer and the review data from the --dir directory (guide.json, guide.patch, meta.json;
full.patch with the full text of changed files, if present, is served by /api/full?i=N),
keeps progress in state.json and waits for the user's decision. After "Submit", "Approve"
or "Close" it writes feedback.md (if there is anything to write), prints a marker as the
last line and exits:

  DIFF_REVIEW_RESULT: feedback|approved|closed|timeout [<path to feedback.md>]

Listens on 127.0.0.1 only. The API requires the token from the URL (X-Review-Token header),
so that third-party pages in the browser cannot inject feedback.

Usage: serve.py --dir <outdir> [--open] [--port N] [--timeout-min N]
"""

import argparse
import json
import os
import secrets
import subprocess
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
from collect import split_patch  # noqa: E402
from validate import validate  # noqa: E402

ASSETS = SCRIPTS.parent / "assets"
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
}


def asset_file(path):
    """File under assets/ for a request path, or None: known extensions only, no escaping assets/."""
    if path == "/":
        path = "/assets/viewer.html"
    if not path.startswith("/assets/"):
        return None
    target = (ASSETS / path[len("/assets/") :]).resolve()
    if not target.is_relative_to(ASSETS.resolve()) or target.suffix not in MIME or not target.is_file():
        return None
    return target


MAX_BODY = 20 * 1024 * 1024
# API error codes the viewer may show; it maps them to page text (assets/js/strings.js).
ERR_TOO_LARGE = "request_too_large"
ERR_EMPTY_FEEDBACK = "empty_feedback"
ERR_ALREADY_SUBMITTED = "already_submitted"
SUBMIT_ACTIONS = ("feedback", "approve", "close")


def submit_error(action, markdown, submitted):
    """Why a submit request is rejected, as (HTTP status, error code); None if it is accepted."""
    if action not in SUBMIT_ACTIONS:
        return HTTPStatus.BAD_REQUEST, "action"
    if action == "feedback" and not markdown:
        return HTTPStatus.BAD_REQUEST, ERR_EMPTY_FEEDBACK
    if submitted:
        return HTTPStatus.CONFLICT, ERR_ALREADY_SUBMITTED
    return None


def load_review(outdir):
    meta = json.loads((outdir / "meta.json").read_text(encoding="utf-8"))
    guide = json.loads((outdir / "guide.json").read_text(encoding="utf-8"))
    errors = validate(guide, meta)
    if errors:
        raise SystemExit("guide.json failed validation:\n" + "\n".join(f"- {e}" for e in errors))
    chunks = split_patch((outdir / "guide.patch").read_text(encoding="utf-8"))
    if len(chunks) != len(meta["files"]):
        raise SystemExit(f"guide.patch ({len(chunks)} files) does not match meta.json ({len(meta['files'])})")
    files = [{**f, "patch": c} for f, c in zip(meta["files"], chunks)]
    # full.patch: chunks in order for files with content.available.
    # If the file is missing or does not match, there is no expansion.
    full = {}
    want = [i for i, f in enumerate(meta["files"]) if (f.get("content") or {}).get("available")]
    full_path = outdir / "full.patch"
    if want and full_path.exists():
        got = split_patch(full_path.read_text(encoding="utf-8"))
        if len(got) == len(want):
            full = dict(zip(want, got))
    for i, f in enumerate(files):
        f["full"] = i in full
    return {"guide": guide, "meta": {k: v for k, v in meta.items() if k != "files"}, "files": files}, full


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dir", required=True, help="directory with guide.json, guide.patch, meta.json")
    p.add_argument("--port", type=int, default=0, help="port (0 picks a free one)")
    p.add_argument("--open", action="store_true", help="open the page in the browser")
    p.add_argument("--timeout-min", type=float, default=180, help="exit after N minutes without a decision")
    args = p.parse_args()

    outdir = Path(args.dir).expanduser().resolve()
    review, full = load_review(outdir)
    state_path = outdir / "state.json"
    feedback_path = outdir / "feedback.md"
    token = secrets.token_urlsafe(16)
    done = threading.Event()
    result = {}
    state_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "diff-review"

        def log_message(self, *a):  # the session reads stdout, stay quiet
            pass

        def _host_ok(self):
            host = (self.headers.get("Host") or "").split(":")[0]
            return host in ("127.0.0.1", "localhost")

        def _api_ok(self):
            return self._host_ok() and secrets.compare_digest(self.headers.get("X-Review-Token", ""), token)

        def _send(self, code, body, ctype="application/json; charset=utf-8"):
            data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def _body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise ValueError(ERR_TOO_LARGE)
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            path = self.path.split("?")[0]
            if not self._host_ok():
                return self._send(HTTPStatus.FORBIDDEN, {"error": "host"})
            asset = asset_file(path)
            if asset:
                return self._send(HTTPStatus.OK, asset.read_bytes(), MIME[asset.suffix])
            if path == "/api/full":
                if not self._api_ok():
                    return self._send(HTTPStatus.FORBIDDEN, {"error": "token"})
                q = self.path.partition("?")[2]
                i = dict(p.partition("=")[::2] for p in q.split("&") if p).get("i", "")
                if not i.isdigit() or int(i) not in full:
                    return self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return self._send(HTTPStatus.OK, full[int(i)].encode("utf-8"), "text/plain; charset=utf-8")
            if path == "/api/review":
                if not self._api_ok():
                    return self._send(HTTPStatus.FORBIDDEN, {"error": "token"})
                with state_lock:
                    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else None
                return self._send(HTTPStatus.OK, {**review, "state": state})
            return self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})

        def do_PUT(self):
            if self.path != "/api/state" or not self._api_ok():
                return self._send(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
            try:
                state = self._body()
            except ValueError as e:
                return self._send(HTTPStatus.BAD_REQUEST, {"error": str(e)})
            with state_lock:
                tmp = state_path.with_suffix(".tmp")
                tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
                os.replace(tmp, state_path)
            return self._send(HTTPStatus.OK, {"ok": True})

        def do_POST(self):
            if self.path != "/api/submit" or not self._api_ok():
                return self._send(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
            try:
                body = self._body()
            except ValueError as e:
                return self._send(HTTPStatus.BAD_REQUEST, {"error": str(e)})
            action = body.get("action")
            markdown = (body.get("markdown") or "").strip()
            rejected = submit_error(action, markdown, done.is_set())
            if rejected:
                return self._send(rejected[0], {"error": rejected[1]})
            if markdown and action != "close":
                feedback_path.write_text(markdown + "\n", encoding="utf-8")
            result["status"] = {"feedback": "feedback", "approve": "approved", "close": "closed"}[action]
            result["file"] = str(feedback_path) if markdown and action != "close" else ""
            self._send(HTTPStatus.OK, {"ok": True})
            done.set()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{server.server_address[1]}/?t={token}"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"DIFF_REVIEW_URL: {url}", flush=True)
    if args.open:
        opener = "open" if sys.platform == "darwin" else "xdg-open"
        subprocess.run([opener, url], check=False, capture_output=True)

    if not done.wait(timeout=args.timeout_min * 60):
        result["status"], result["file"] = "timeout", ""
    server.shutdown()
    print(f"DIFF_REVIEW_RESULT: {result['status']} {result['file']}".rstrip(), flush=True)


if __name__ == "__main__":
    main()

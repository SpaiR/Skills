"""Tests for diff-review serve.py: asset_file() path handling and the HTTP API (plain unittest)."""

import http.client
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "tests" / "fixtures"
sys.path.insert(0, str(SCRIPTS))
import serve  # noqa: E402


class AssetFileTest(unittest.TestCase):
    def test_root_maps_to_viewer_html(self):
        self.assertEqual(serve.asset_file("/"), (serve.ASSETS / "viewer.html").resolve())

    def test_known_files(self):
        for name in ("viewer.html", "js/main.js", "js/diffcore.js", "css/index.css"):
            with self.subTest(name=name):
                self.assertEqual(serve.asset_file(f"/assets/{name}"), (serve.ASSETS / name).resolve())

    def test_nested_files_are_served(self):
        # Files in subdirectories (assets/js, assets/css) are reachable when they exist.
        with tempfile.TemporaryDirectory(dir=serve.ASSETS) as td:
            nested = Path(td) / "x.js"
            nested.write_text("//\n")
            self.assertEqual(serve.asset_file(f"/assets/{Path(td).name}/x.js"), nested.resolve())

    def test_path_traversal_rejected(self):
        for path in (
            "/assets/../scripts/serve.py",
            "/assets/../SKILL.md",
            "/assets/../../etc/passwd",
            "/assets/../assets/../package.json",
            "/assets/..%2fscripts/serve.py",
        ):
            with self.subTest(path=path):
                self.assertIsNone(serve.asset_file(path))

    def test_traversal_to_file_with_allowed_extension_rejected(self):
        outside = ROOT / "tests" / "e2e"
        js = next(outside.glob("*.js"))
        self.assertIsNone(serve.asset_file(f"/assets/../tests/e2e/{js.name}"))

    def test_encoded_dots_are_not_decoded(self):
        # serve.py does not URL-decode, so %2e%2e stays a literal (nonexistent) directory name.
        self.assertIsNone(serve.asset_file("/assets/%2e%2e/scripts/serve.py"))
        self.assertIsNone(serve.asset_file("/assets/%2e%2e/%2e%2e/etc/passwd"))

    def test_unknown_extension_rejected(self):
        self.assertIsNone(serve.asset_file("/assets/viewer.py"))
        self.assertIsNone(serve.asset_file("/assets/viewer.json"))
        self.assertIsNone(serve.asset_file("/assets/viewer"))

    def test_missing_file_rejected(self):
        self.assertIsNone(serve.asset_file("/assets/nope.js"))

    def test_directories_rejected(self):
        self.assertIsNone(serve.asset_file("/assets/"))
        self.assertIsNone(serve.asset_file("/assets"))
        with tempfile.TemporaryDirectory(dir=serve.ASSETS) as td:
            (Path(td) / "d.js").mkdir()  # a directory with an allowed extension
            self.assertIsNone(serve.asset_file(f"/assets/{Path(td).name}/d.js"))

    def test_nul_byte_rejected(self):
        # Path.resolve() raises ValueError on an embedded NUL; the server must answer 404, not crash the request.
        self.assertIsNone(serve.asset_file("/assets/js/main.js\x00"))
        self.assertIsNone(serve.asset_file("/assets/a\x00.js"))

    def test_paths_outside_assets_rejected(self):
        for path in ("/api/review", "/viewer.html", "/etc/passwd", "", "assets/viewer.js"):
            with self.subTest(path=path):
                self.assertIsNone(serve.asset_file(path))


class ServerCase(unittest.TestCase):
    """Starts serve.py on a copy of a fixture; the process is always killed."""

    fixture = "mixed2"

    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.outdir = Path(td.name) / "out"
        shutil.copytree(FIXTURES / self.fixture, self.outdir)
        self.proc = subprocess.Popen(
            [sys.executable, str(SCRIPTS / "serve.py"), "--dir", str(self.outdir), "--timeout-min", "5"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(self._stop)
        line = self.proc.stdout.readline()
        if not line.startswith("DIFF_REVIEW_URL: "):
            self._stop()
            self.fail(f"no URL marker, got {line!r}")
        url = urlparse(line.split(": ", 1)[1].strip())
        self.port = url.port
        self.token = parse_qs(url.query)["t"][0]

    def _stop(self):
        if self.proc.poll() is None:
            self.proc.kill()
        self.proc.wait()
        for pipe in (self.proc.stdout, self.proc.stderr):
            if pipe:
                pipe.close()

    def request(self, method, path, body=None, token=True, host=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            headers = {}
            if token:
                headers["X-Review-Token"] = self.token
            if host:
                headers["Host"] = host
            data = None
            if body is not None:
                data = json.dumps(body).encode()
                headers["Content-Type"] = "application/json"
            conn.request(method, path, body=data, headers=headers)
            resp = conn.getresponse()
            return resp.status, resp.read()
        finally:
            conn.close()


class ServerHttpTest(ServerCase):
    def test_viewer_page_served_without_token(self):
        status, body = self.request("GET", "/", token=False)
        self.assertEqual(status, 200)
        self.assertIn(b"<html", body.lower())

    def test_nul_byte_in_asset_path_answers_404(self):
        # http.client refuses such a path, so the request goes over a raw socket.
        with socket.create_connection(("127.0.0.1", self.port), timeout=10) as sock:
            sock.sendall(b"GET /assets/a\x00.js HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
            reply = sock.makefile("rb").read()
        self.assertTrue(reply.startswith(b"HTTP/1.0 404"), reply[:80])

    def test_api_review_requires_token(self):
        self.assertEqual(self.request("GET", "/api/review", token=False)[0], 403)
        self.assertEqual(self.request("GET", "/api/review")[0], 200)

    def test_api_review_rejects_wrong_token(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("GET", "/api/review", headers={"X-Review-Token": "wrong"})
        self.assertEqual(conn.getresponse().status, 403)
        conn.close()

    def test_api_full_requires_token(self):
        self.assertEqual(self.request("GET", "/api/full?i=3", token=False)[0], 403)

    def test_wrong_host_rejected(self):
        self.assertEqual(self.request("GET", "/api/review", host="evil.example")[0], 403)
        self.assertEqual(self.request("GET", "/", token=False, host="evil.example")[0], 403)
        self.assertEqual(self.request("GET", "/api/review", host="localhost")[0], 200)

    def test_review_payload_shape(self):
        status, body = self.request("GET", "/api/review")
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(set(data), {"guide", "meta", "files", "state"})
        self.assertIsNone(data["state"])
        self.assertNotIn("files", data["meta"])
        # mixed2: files 3, 4 and 6 have full text
        self.assertEqual([i for i, f in enumerate(data["files"]) if f["full"]], [3, 4, 6])

    def test_api_full_returns_text_for_available_file(self):
        status, body = self.request("GET", "/api/full?i=3")
        self.assertEqual(status, 200)
        self.assertTrue(body.decode("utf-8").startswith("diff --git "))

    def test_api_full_404_for_unavailable_or_bad_index(self):
        for q in ("i=0", "i=99", "i=-1", "i=abc", "i=", ""):
            with self.subTest(q=q):
                self.assertEqual(self.request("GET", "/api/full?" + q)[0], 404)

    def test_unknown_path_404(self):
        self.assertEqual(self.request("GET", "/nope", token=False)[0], 404)

    def test_state_round_trip(self):
        state = {"viewed": {"a": True}, "comment": "привет"}
        status, body = self.request("PUT", "/api/state", state)
        self.assertEqual((status, json.loads(body)), (200, {"ok": True}))
        self.assertEqual(json.loads((self.outdir / "state.json").read_text(encoding="utf-8")), state)
        self.assertEqual(json.loads(self.request("GET", "/api/review")[1])["state"], state)

    def test_state_requires_token(self):
        self.assertEqual(self.request("PUT", "/api/state", {}, token=False)[0], 403)
        self.assertFalse((self.outdir / "state.json").exists())

    def test_submit_approve_ends_process(self):
        status, _ = self.request("POST", "/api/submit", {"action": "approve"})
        self.assertEqual(status, 200)
        out, _ = self.proc.communicate(timeout=15)
        self.assertEqual(out.strip().splitlines()[-1], "DIFF_REVIEW_RESULT: approved")
        self.assertEqual(self.proc.returncode, 0)

    def test_error_bodies_are_codes(self):
        cases = [({"action": "feedback", "markdown": "  "}, "empty_feedback"), ({"action": "bogus"}, "action")]
        for body, code in cases:
            with self.subTest(body=body):
                status, raw = self.request("POST", "/api/submit", body)
                self.assertEqual((status, json.loads(raw)), (400, {"error": code}))

    def test_too_large_request_rejected(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            # Only the header claims a huge body: the server must refuse before reading it.
            conn.putrequest("PUT", "/api/state")
            conn.putheader("X-Review-Token", self.token)
            conn.putheader("Content-Length", str(serve.MAX_BODY + 1))
            conn.endheaders()
            resp = conn.getresponse()
            self.assertEqual((resp.status, json.loads(resp.read())), (400, {"error": "request_too_large"}))
        finally:
            conn.close()
        self.assertFalse((self.outdir / "state.json").exists())

    def test_submit_feedback_writes_file(self):
        self.assertEqual(self.request("POST", "/api/submit", {"action": "feedback", "markdown": ""})[0], 400)
        self.assertEqual(self.request("POST", "/api/submit", {"action": "bogus"})[0], 400)
        self.assertEqual(self.request("POST", "/api/submit", {"action": "feedback", "markdown": "fix"})[0], 200)
        out, _ = self.proc.communicate(timeout=15)
        self.assertEqual(
            out.strip().splitlines()[-1], f"DIFF_REVIEW_RESULT: feedback {self.outdir.resolve() / 'feedback.md'}"
        )
        self.assertEqual((self.outdir / "feedback.md").read_text(encoding="utf-8"), "fix\n")


class SubmitErrorTest(unittest.TestCase):
    def test_rejections(self):
        self.assertEqual(serve.submit_error("bogus", "x", False), (400, "action"))
        self.assertEqual(serve.submit_error(None, "", False), (400, "action"))
        self.assertEqual(serve.submit_error("feedback", "", False), (400, "empty_feedback"))
        for action in ("feedback", "approve", "close"):
            with self.subTest(action=action):
                self.assertEqual(serve.submit_error(action, "x", True), (409, "already_submitted"))

    def test_accepted(self):
        for action, markdown in (("feedback", "fix"), ("approve", ""), ("approve", "ok"), ("close", "")):
            with self.subTest(action=action, markdown=markdown):
                self.assertIsNone(serve.submit_error(action, markdown, False))


class ServerV1OutdirTest(ServerCase):
    fixture = "mixed"  # version 1: no full.patch, no content in meta

    def test_v1_outdir_loads(self):
        status, body = self.request("GET", "/api/review")
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(len(data["files"]), 7)
        self.assertTrue(all(f["full"] is False for f in data["files"]))
        self.assertEqual(self.request("GET", "/api/full?i=3")[0], 404)


if __name__ == "__main__":
    unittest.main()

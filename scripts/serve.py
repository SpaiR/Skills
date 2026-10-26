#!/usr/bin/env python3
"""Локальный сервер просмотра diff-review.

Отдаёт вьюер и данные ревью из каталога --dir (guide.json, guide.patch, meta.json;
full.patch с полным текстом изменённых файлов — если есть, его отдаёт /api/full?i=N),
хранит прогресс в state.json и ждёт решения пользователя. После «Отправить»,
«Одобрить» или «Закрыть» пишет feedback.md (если есть что писать), печатает
последней строкой маркер и завершается:

  DIFF_REVIEW_RESULT: feedback|approved|closed|timeout [<путь к feedback.md>]

Слушает только 127.0.0.1. API требует токен из URL (заголовок X-Review-Token),
чтобы сторонние страницы в браузере не могли подсунуть фидбек.

Использование: serve.py --dir <outdir> [--open] [--port N] [--timeout-min N]
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
    """Файл из assets/ для пути запроса или None: только известные расширения, без выхода за assets/."""
    if path == "/":
        path = "/assets/viewer.html"
    if not path.startswith("/assets/"):
        return None
    target = (ASSETS / path[len("/assets/"):]).resolve()
    if not target.is_relative_to(ASSETS.resolve()) or target.suffix not in MIME or not target.is_file():
        return None
    return target
MAX_BODY = 20 * 1024 * 1024


def load_review(outdir):
    meta = json.loads((outdir / "meta.json").read_text(encoding="utf-8"))
    guide = json.loads((outdir / "guide.json").read_text(encoding="utf-8"))
    errors = validate(guide, meta)
    if errors:
        raise SystemExit("guide.json не прошёл проверку:\n" + "\n".join(f"- {e}" for e in errors))
    chunks = split_patch((outdir / "guide.patch").read_text(encoding="utf-8"))
    if len(chunks) != len(meta["files"]):
        raise SystemExit(f"guide.patch ({len(chunks)} файлов) не совпадает с meta.json ({len(meta['files'])})")
    files = [{**f, "patch": c} for f, c in zip(meta["files"], chunks)]
    # full.patch: куски по порядку у файлов с content.available. Нет файла или не сошлось — раскрытия нет.
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
    p.add_argument("--dir", required=True, help="каталог с guide.json, guide.patch, meta.json")
    p.add_argument("--port", type=int, default=0, help="порт (0 — выбрать свободный)")
    p.add_argument("--open", action="store_true", help="открыть страницу в браузере")
    p.add_argument("--timeout-min", type=float, default=180, help="завершиться через N минут без решения")
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

        def log_message(self, *a):  # stdout читает сессия, не шумим
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
                raise ValueError("слишком большой запрос")
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
            if action not in ("feedback", "approve", "close"):
                return self._send(HTTPStatus.BAD_REQUEST, {"error": "action"})
            if action == "feedback" and not markdown:
                return self._send(HTTPStatus.BAD_REQUEST, {"error": "пустой фидбек"})
            if done.is_set():
                return self._send(HTTPStatus.CONFLICT, {"error": "уже отправлено"})
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

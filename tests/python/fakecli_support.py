"""Shared helpers for tests that run gh / glab: the fake CLIs from tests/fakecli, rules and call log."""

import json
import os
import tempfile
from pathlib import Path
from unittest import mock

FAKECLI = Path(__file__).resolve().parents[1] / "fakecli"


class FakeCliMixin:
    """Put the fake gh / glab first on PATH for this process and its children; rules go in `self.set_rules`."""

    def setup_fakecli(self, rules=()):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.fake_dir = Path(td.name)
        self.rules_path = self.fake_dir / "rules.json"
        self.log_path = self.fake_dir / "calls.jsonl"
        self.set_rules(rules)
        self.fake_env = {
            "PATH": f"{FAKECLI}{os.pathsep}{os.environ['PATH']}",
            "FAKE_CLI_RULES": str(self.rules_path),
            "FAKE_CLI_LOG": str(self.log_path),
        }
        patcher = mock.patch.dict(os.environ, self.fake_env)
        patcher.start()
        self.addCleanup(patcher.stop)

    def set_rules(self, rules):
        self.rules_path.write_text(json.dumps(list(rules)), encoding="utf-8")

    def calls(self, cli=None, containing=""):
        if not self.log_path.exists():
            return []
        entries = [json.loads(ln) for ln in self.log_path.read_text(encoding="utf-8").splitlines() if ln]
        return [e for e in entries if (cli is None or e["cli"] == cli) and containing in " ".join(e["argv"])]

    def clear_calls(self):
        self.log_path.unlink(missing_ok=True)

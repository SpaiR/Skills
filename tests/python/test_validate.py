"""Tests for diff-review validate.py (plain unittest)."""

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "validate.py"
FIXTURES = ROOT / "tests" / "fixtures"
sys.path.insert(0, str(ROOT / "scripts"))
from validate import MAX_SECTIONS, validate  # noqa: E402


def load(name, what):
    return json.loads((FIXTURES / name / f"{what}.json").read_text(encoding="utf-8"))


class FixtureGuidesTest(unittest.TestCase):
    def test_fixture_guides_pass(self):
        names = sorted(p.name for p in FIXTURES.iterdir() if (p / "guide.json").exists())
        self.assertTrue(names)
        for name in names:
            with self.subTest(fixture=name):
                self.assertEqual(validate(load(name, "guide"), load(name, "meta")), [])


class FailureTest(unittest.TestCase):
    def setUp(self):
        self.meta = load("mixed2", "meta")
        self.guide = load("mixed2", "guide")

    def errors(self):
        return validate(self.guide, self.meta)

    def assertError(self, fragment):
        errs = self.errors()
        self.assertTrue(any(fragment in e for e in errs), (fragment, errs))

    def test_baseline_valid(self):
        self.assertEqual(self.errors(), [])

    def test_missing_file_coverage(self):
        victim = self.meta["files"][0]["path"]
        for s in self.guide["sections"]:
            s["diffs"] = [d for d in s["diffs"] if d["file"] != victim]
        self.guide["unplacedFiles"] = [f for f in self.guide["unplacedFiles"] if f != victim]
        self.assertError(f"`{victim}` is not placed")

    def test_unknown_file(self):
        self.guide["unplacedFiles"].append("does/not/exist.py")
        self.assertError("`does/not/exist.py` is not among the changed files")
        self.assertError("Valid paths")

    def test_file_placed_twice(self):
        path = self.guide["sections"][0]["diffs"][0]["file"]
        self.guide["unplacedFiles"].append(path)
        self.assertError("is placed several times")

    def test_not_an_object(self):
        self.assertEqual(validate([], self.meta), ["guide.json must be a JSON object"])

    def test_empty_title_and_intent(self):
        self.guide["title"] = " "
        del self.guide["intent"]
        self.assertError("field `title` must be a non-empty string")
        self.assertError("field `intent` must be a non-empty string")

    def test_multiline_title(self):
        self.guide["title"] = "a\nb"
        self.assertError("`title` must be a single line")

    def test_sections_wrong_shape(self):
        self.guide["sections"] = {}
        self.assertError("`sections` must be a non-empty array")

    def test_too_many_sections(self):
        base = copy.deepcopy(self.guide["sections"][0])
        self.guide["sections"] = [copy.deepcopy(base) for _ in range(MAX_SECTIONS + 1)]
        self.assertError("maximum is")

    def test_bad_section_shape(self):
        self.guide["sections"][0] = "not an object"
        self.assertError("section 1: must be an object")

    def test_section_fields(self):
        s = self.guide["sections"][0]
        s["title"] = ""
        s["overview"] = ""
        s["diffs"] = "nope"
        self.assertError("empty `title`")
        self.assertError("empty `overview`")
        self.assertError("`diffs` must be an array")

    def test_bad_diff_item(self):
        self.guide["sections"][0]["diffs"].append({"summary": "no file"})
        self.assertError("every `diffs` item must be an object with a `file` field")

    def test_empty_summary(self):
        d = self.guide["sections"][0]["diffs"][0]
        d["summary"] = ""
        self.assertError(f"`{d['file']}` has an empty `summary`")

    def test_unplaced_files_wrong_shape(self):
        self.guide["unplacedFiles"] = "x"
        self.assertError("`unplacedFiles` must be an array of strings")


class CliTest(unittest.TestCase):
    def run_cli(self, guide_text):
        with tempfile.TemporaryDirectory() as td:
            guide = Path(td) / "guide.json"
            if guide_text is not None:
                guide.write_text(guide_text, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(SCRIPT), "--guide", str(guide), "--meta", str(FIXTURES / "mixed2" / "meta.json")],
                capture_output=True,
                text=True,
            )

    def test_ok_exit_0(self):
        r = self.run_cli((FIXTURES / "mixed2" / "guide.json").read_text(encoding="utf-8"))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("OK: "))

    def test_invalid_guide_exit_1(self):
        r = self.run_cli("{}")
        self.assertEqual(r.returncode, 1)
        self.assertIn("guide.json failed validation", r.stderr)

    def test_bad_json_exit_1(self):
        r = self.run_cli("{")
        self.assertEqual(r.returncode, 1)
        self.assertIn("not valid JSON", r.stderr)

    def test_missing_guide_exit_1(self):
        r = self.run_cli(None)
        self.assertEqual(r.returncode, 1)
        self.assertIn("does not exist", r.stderr)


if __name__ == "__main__":
    unittest.main()

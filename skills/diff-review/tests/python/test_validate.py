"""Tests for diff-review validate.py (plain unittest)."""

# The brief and overview samples are Russian input data (see .claude/rules/diff-review/language.md at the repo root).
# ruff: noqa: RUF001

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
from validate import BRIEF_MAX, BRIEF_MAX_WORDS, BRIEF_MIN, MAX_SECTIONS, validate  # noqa: E402


def load(name, what):
    return json.loads((FIXTURES / name / f"{what}.json").read_text(encoding="utf-8"))


def strict_guide():
    """A mixed2 guide that passes strict mode: a valid brief and plain first paragraphs."""
    guide = load("mixed2", "guide")
    for s in guide["sections"]:
        _, sep, rest = s["overview"].partition("\n\n")
        s["overview"] = "Простое описание без кода." + sep + rest
    guide["brief"] = [
        {"kind": "change", "text": "Обзор теперь собирается быстрее.", "section": 1},
        {"kind": "kept", "text": "Старые сохранённые ревью открываются как раньше."},
        {"kind": "risk", "text": "Стоит прочитать сбор диффа самому.", "section": 2},
    ]
    return guide


# Fixtures recorded before `brief`: they stand for older outdirs that serve.py must still open.
PRE_BRIEF_FIXTURES = {"big", "large", "mixed", "tree"}


class FixtureGuidesTest(unittest.TestCase):
    def test_fixture_guides_pass(self):
        names = sorted(p.name for p in FIXTURES.iterdir() if (p / "guide.json").exists())
        self.assertTrue(names)
        for name in names:
            guide, meta = load(name, "guide"), load(name, "meta")
            with self.subTest(fixture=name):
                if name in PRE_BRIEF_FIXTURES:
                    self.assertNotIn("brief", guide)
                    self.assertEqual(validate(guide, meta, strict=False), [])
                else:
                    self.assertEqual(validate(guide, meta), [])

    def test_fixture_guides_pass_the_cli(self):
        for name in sorted(p.name for p in FIXTURES.iterdir() if (p / "guide.json").exists()):
            if name in PRE_BRIEF_FIXTURES:
                continue
            with self.subTest(fixture=name):
                d = FIXTURES / name
                r = subprocess.run(
                    [sys.executable, str(SCRIPT), "--guide", str(d / "guide.json"), "--meta", str(d / "meta.json")],
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(r.returncode, 0, r.stderr)


class FailureTest(unittest.TestCase):
    def setUp(self):
        self.meta = load("mixed2", "meta")
        self.guide = load("mixed2", "guide")

    def errors(self):
        return validate(self.guide, self.meta, strict=False)

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


class BriefTest(unittest.TestCase):
    def setUp(self):
        self.meta = load("mixed2", "meta")
        self.guide = strict_guide()

    def errors(self, strict=True):
        return validate(self.guide, self.meta, strict=strict)

    def assertError(self, fragment, strict=True):
        errs = self.errors(strict)
        self.assertTrue(any(fragment in e for e in errs), (fragment, errs))

    def assertValid(self, strict=True):
        self.assertEqual(self.errors(strict), [])

    def test_baseline_valid_in_both_modes(self):
        self.assertValid(strict=True)
        self.assertValid(strict=False)

    def test_missing_brief(self):
        del self.guide["brief"]
        self.assertError("field `brief` is required")
        self.assertValid(strict=False)

    def test_brief_not_an_array(self):
        for bad in ({}, "text", None):
            with self.subTest(bad=bad):
                self.guide["brief"] = bad
                for strict in (True, False):
                    self.assertError("`brief` must be an array", strict)

    def test_item_not_an_object(self):
        self.guide["brief"].append("not an object")
        self.assertError("brief point 4: must be an object", strict=False)

    def test_bad_kind(self):
        for bad in ("oops", None, 1):
            with self.subTest(kind=bad):
                self.guide["brief"][1]["kind"] = bad
                self.assertError("brief point 2: `kind` must be one of change, kept, risk", strict=False)
        del self.guide["brief"][1]["kind"]
        self.assertError("brief point 2: `kind`", strict=False)

    def test_empty_text(self):
        for bad in ("", "  ", None, 5):
            with self.subTest(text=bad):
                self.guide["brief"][0]["text"] = bad
                self.assertError("brief point 1: empty `text`", strict=False)

    def test_multiline_text(self):
        self.guide["brief"][0]["text"] = "Первая строка.\nВторая строка."
        self.assertError("brief point 1: `text` must be a single line", strict=False)

    def test_trailing_newline_is_not_multiline(self):
        self.guide["brief"][0]["text"] = "Одна строка.\n"
        self.assertValid()

    def test_section_not_int(self):
        for bad in ("1", 1.0, True, False, None):
            with self.subTest(section=bad):
                self.guide["brief"][0]["section"] = bad
                self.assertError("brief point 1: `section` must be an integer", strict=False)

    def test_section_out_of_range(self):
        n = len(self.guide["sections"])
        for bad in (0, -1, n + 1):
            with self.subTest(section=bad):
                self.guide["brief"][0]["section"] = bad
                self.assertError("brief point 1: `section`", strict=False)
                self.assertError("out of range", strict=False)

    def test_section_not_checked_without_valid_sections(self):
        # The broken `sections` is the error to fix; a range of 1..0 for every point would only add noise.
        self.guide["brief"][0]["section"] = 1
        self.guide["sections"] = "oops"
        errs = self.errors(strict=False)
        self.assertTrue(any("`sections` must be a non-empty array" in e for e in errs), errs)
        self.assertFalse(any("out of range" in e for e in errs), errs)

    def test_section_bounds_are_valid(self):
        self.guide["brief"][0]["section"] = len(self.guide["sections"])
        self.assertValid()
        self.guide["brief"][0]["section"] = 1
        self.assertValid()

    def test_section_is_optional(self):
        del self.guide["brief"][0]["section"]
        self.assertValid()

    def test_too_few_points(self):
        self.guide["brief"] = self.guide["brief"][: BRIEF_MIN - 1]
        self.assertError("at least")
        self.assertValid(strict=False)

    def test_too_many_points(self):
        self.guide["brief"] = [dict(self.guide["brief"][0]) for _ in range(BRIEF_MAX + 1)]
        self.assertError("maximum is")
        self.assertValid(strict=False)

    def test_limits_are_inclusive(self):
        self.guide["brief"] = [dict(self.guide["brief"][0]) for _ in range(BRIEF_MAX)]
        self.assertValid()
        self.guide["brief"] = self.guide["brief"][:BRIEF_MIN]
        self.assertValid()

    def test_no_change_point(self):
        self.guide["brief"] = [{"kind": "kept", "text": "Один."}, {"kind": "risk", "text": "Два."}]
        self.assertError('at least one point with kind "change"')
        self.assertValid(strict=False)

    def test_backtick_in_text(self):
        self.guide["brief"][0]["text"] = "Функция `verify` изменилась."
        self.assertError("brief point 1: `text` must not contain backticks")
        self.assertValid(strict=False)

    def test_too_many_words(self):
        self.guide["brief"][0]["text"] = " ".join(["слово"] * (BRIEF_MAX_WORDS + 1))
        self.assertError(f"brief point 1: `text` has {BRIEF_MAX_WORDS + 1} words")
        self.assertValid(strict=False)

    def test_word_limit_is_inclusive(self):
        self.guide["brief"][0]["text"] = " ".join(["слово"] * BRIEF_MAX_WORDS)
        self.assertValid()

    def test_backtick_in_first_paragraph(self):
        s = self.guide["sections"][0]
        s["overview"] = "Функция `verify` теперь умнее.\n\nВторой абзац."
        self.assertError(f'section 1 "{s["title"]}": the first paragraph of `overview` must not contain backticks')
        self.assertValid(strict=False)

    def test_backtick_in_single_paragraph_overview(self):
        self.guide["sections"][0]["overview"] = "Один абзац с `кодом`."
        self.assertError("first paragraph of `overview`")

    def test_backtick_in_later_paragraphs_is_fine(self):
        self.guide["sections"][0]["overview"] = "Простое описание.\n\nМеханизм: `verify` и `kind`.\n\nЕщё `код`."
        self.assertValid()

    def test_blank_line_with_spaces_ends_first_paragraph(self):
        self.guide["sections"][0]["overview"] = "Простое описание.\n  \nМеханизм: `verify`."
        self.assertValid()

    def test_crlf_blank_line_ends_first_paragraph(self):
        self.guide["sections"][0]["overview"] = "Простое описание.\r\n\r\nМеханизм: `verify`."
        self.assertValid()


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
        r = self.run_cli(json.dumps(strict_guide()))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("OK: "))
        self.assertIn("3 brief points", r.stdout)

    def test_guide_without_brief_exit_1(self):
        guide = strict_guide()
        del guide["brief"]
        r = self.run_cli(json.dumps(guide))
        self.assertEqual(r.returncode, 1)
        self.assertIn("field `brief` is required", r.stderr)
        self.assertEqual(r.stdout, "")

    def test_lenient_accepts_guide_without_brief(self):
        guide = strict_guide()
        del guide["brief"]
        self.assertEqual(validate(guide, load("mixed2", "meta"), strict=False), [])

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

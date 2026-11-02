#!/usr/bin/env python3
"""Validate guide.json against meta.json (the coverage rule of the guided review).

Every changed file from meta.json must appear exactly once: in the diffs of one
section or in unplacedFiles. Fixes nothing silently: prints all errors and exits
with code 1. On success prints a short summary and exits with code 0.

The CLI is strict: it also requires the `brief` list and plain-language first paragraphs of the
section overviews. serve.py validates leniently, so older outdirs without `brief` still open.

Usage: validate.py --guide guide.json --meta meta.json
"""

import argparse
import json
import re
import sys
from pathlib import Path

MAX_SECTIONS = 10
BRIEF_KINDS = ("change", "kept", "risk")
BRIEF_MIN = 2
BRIEF_MAX = 10
BRIEF_MAX_WORDS = 40


def first_paragraph(text):
    """Text up to the first blank line. Carriage returns are dropped, as markdown.js does."""
    return re.split(r"\n[ \t]*\n", text.replace("\r", "").strip(), maxsplit=1)[0]


def check_brief(brief, n_sections, strict):
    """Return the errors of the `brief` field (shape in both modes, limits only when strict)."""
    if not isinstance(brief, list):
        return ["`brief` must be an array of points"]
    errors = []
    if strict:
        if len(brief) < BRIEF_MIN:
            errors.append(f"`brief` has {len(brief)} points, at least {BRIEF_MIN} are required")
        elif len(brief) > BRIEF_MAX:
            errors.append(f"`brief` has {len(brief)} points, maximum is {BRIEF_MAX}: keep only the main ones")
        if not any(isinstance(b, dict) and b.get("kind") == "change" for b in brief):
            errors.append('`brief` needs at least one point with kind "change"')
    for i, b in enumerate(brief, 1):
        where = f"brief point {i}"
        if not isinstance(b, dict):
            errors.append(f"{where}: must be an object")
            continue
        if b.get("kind") not in BRIEF_KINDS:
            errors.append(f"{where}: `kind` must be one of {', '.join(BRIEF_KINDS)}")
        text = b.get("text")
        if not isinstance(text, str) or not text.strip():
            errors.append(f"{where}: empty `text`")
        elif "\n" in text.strip():
            errors.append(f"{where}: `text` must be a single line")
        elif strict:
            if "`" in text:
                errors.append(f"{where}: `text` must not contain backticks, write plain language")
            words = len(text.split())
            if words > BRIEF_MAX_WORDS:
                errors.append(f"{where}: `text` has {words} words, maximum is {BRIEF_MAX_WORDS}")
        if "section" in b:
            n = b["section"]
            if isinstance(n, bool) or not isinstance(n, int):
                errors.append(f"{where}: `section` must be an integer")
            elif not 1 <= n <= n_sections:
                errors.append(f"{where}: `section` {n} is out of range 1..{n_sections}")
    return errors


def validate(guide, meta, strict=True):
    """Return a list of errors (empty means the guide is valid).

    strict=False skips the rules that older guides do not meet: `brief` may be absent and the
    limits on its points and on the first paragraph of the overviews are not checked.
    """
    errors = []
    changed = [f["path"] for f in meta["files"]]
    changed_set = set(changed)

    if not isinstance(guide, dict):
        return ["guide.json must be a JSON object"]

    for key in ("title", "intent"):
        if not isinstance(guide.get(key), str) or not guide[key].strip():
            errors.append(f"field `{key}` must be a non-empty string")
    if isinstance(guide.get("title"), str) and "\n" in guide["title"].strip():
        errors.append("`title` must be a single line")

    sections = guide.get("sections")
    if not isinstance(sections, list) or not sections:
        errors.append("`sections` must be a non-empty array")
        sections = []
    elif len(sections) > MAX_SECTIONS:
        errors.append(f"{len(sections)} sections, maximum is {MAX_SECTIONS}: merge related ones")

    unplaced = guide.get("unplacedFiles")
    if not isinstance(unplaced, list) or not all(isinstance(f, str) for f in unplaced):
        errors.append("`unplacedFiles` must be an array of strings (empty if everything is placed)")
        unplaced = []

    if "brief" in guide:
        errors.extend(check_brief(guide["brief"], len(sections), strict))
    elif strict:
        errors.append("field `brief` is required: an array of 2-10 points {kind, text, section?}")

    placements = {}  # path -> list of places
    unknown = []

    for i, s in enumerate(sections, 1):
        where = f"section {i}"
        if not isinstance(s, dict):
            errors.append(f"{where}: must be an object")
            continue
        if not isinstance(s.get("title"), str) or not s["title"].strip():
            errors.append(f"{where}: empty `title`")
        else:
            where = f'section {i} "{s["title"].strip()}"'
        if not isinstance(s.get("overview"), str) or not s["overview"].strip():
            errors.append(f"{where}: empty `overview`")
        elif strict and "`" in first_paragraph(s["overview"]):
            errors.append(
                f"{where}: the first paragraph of `overview` must not contain backticks, "
                "write plain language there and put identifiers in the next paragraphs"
            )
        diffs = s.get("diffs")
        if not isinstance(diffs, list):
            errors.append(f"{where}: `diffs` must be an array")
            continue
        for d in diffs:
            if not isinstance(d, dict) or not isinstance(d.get("file"), str):
                errors.append(f"{where}: every `diffs` item must be an object with a `file` field")
                continue
            if not isinstance(d.get("summary"), str) or not d["summary"].strip():
                errors.append(f"{where}: `{d['file']}` has an empty `summary`")
            if d["file"] not in changed_set:
                unknown.append((where, d["file"]))
            else:
                placements.setdefault(d["file"], []).append(where)

    for f in unplaced:
        if f not in changed_set:
            unknown.append(("unplacedFiles", f))
        else:
            placements.setdefault(f, []).append("unplacedFiles")

    for where, f in unknown:
        errors.append(f"{where}: `{f}` is not among the changed files")
    for f, places in placements.items():
        if len(places) > 1:
            errors.append(f"`{f}` is placed several times ({', '.join(places)}), it needs exactly one place")
    missing = [f for f in changed if f not in placements]
    for f in missing:
        errors.append(f"`{f}` is not placed: add it to a section or to `unplacedFiles`")

    if unknown:
        errors.append("Valid paths (copy verbatim):\n" + "\n".join(f"  {p}" for p in changed))
    return errors


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--guide", required=True)
    p.add_argument("--meta", required=True)
    args = p.parse_args()

    meta = json.loads(Path(args.meta).read_text(encoding="utf-8"))
    try:
        guide = json.loads(Path(args.guide).read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"Error: file {args.guide} does not exist", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: guide.json is not valid JSON: {e}", file=sys.stderr)
        sys.exit(1)

    errors = validate(guide, meta)
    if errors:
        print(f"guide.json failed validation ({len(errors)}):", file=sys.stderr)
        for e in errors:
            print(f"- {e}", file=sys.stderr)
        sys.exit(1)

    n_placed = sum(len(s["diffs"]) for s in guide["sections"])
    print(
        f"OK: {len(guide['sections'])} sections, {n_placed} files in sections, "
        f"{len(guide['unplacedFiles'])} in unplacedFiles, {len(guide['brief'])} brief points"
    )


if __name__ == "__main__":
    main()

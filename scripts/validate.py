#!/usr/bin/env python3
"""Validate guide.json against meta.json (the coverage rule of the guided review).

Every changed file from meta.json must appear exactly once: in the diffs of one
section or in unplacedFiles. Fixes nothing silently: prints all errors and exits
with code 1. On success prints a short summary and exits with code 0.

Usage: validate.py --guide guide.json --meta meta.json
"""

import argparse
import json
import sys
from pathlib import Path

MAX_SECTIONS = 10


def validate(guide, meta):
    """Return a list of errors (empty means the guide is valid)."""
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
            where = f"section {i} \"{s['title'].strip()}\""
        if not isinstance(s.get("overview"), str) or not s["overview"].strip():
            errors.append(f"{where}: empty `overview`")
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
    print(f"OK: {len(guide['sections'])} sections, {n_placed} files in sections, "
          f"{len(guide['unplacedFiles'])} in unplacedFiles")


if __name__ == "__main__":
    main()

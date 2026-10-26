#!/usr/bin/env python3
"""Проверяет guide.json против meta.json (правило покрытия guided review).

Каждый изменённый файл из meta.json должен встретиться ровно один раз:
в diffs одной главы или в unplacedFiles. Ничего не чинит молча — печатает
все ошибки и выходит с кодом 1. При успехе печатает краткую сводку, код 0.

Использование: validate.py --guide guide.json --meta meta.json
"""

import argparse
import json
import sys
from pathlib import Path

MAX_SECTIONS = 10


def validate(guide, meta):
    """Возвращает список ошибок (пустой — гайд корректен)."""
    errors = []
    changed = [f["path"] for f in meta["files"]]
    changed_set = set(changed)

    if not isinstance(guide, dict):
        return ["guide.json должен быть JSON-объектом"]

    for key in ("title", "intent"):
        if not isinstance(guide.get(key), str) or not guide[key].strip():
            errors.append(f"поле `{key}` должно быть непустой строкой")
    if isinstance(guide.get("title"), str) and "\n" in guide["title"].strip():
        errors.append("`title` должен быть одной строкой")

    sections = guide.get("sections")
    if not isinstance(sections, list) or not sections:
        errors.append("`sections` должен быть непустым массивом")
        sections = []
    elif len(sections) > MAX_SECTIONS:
        errors.append(f"глав {len(sections)}, максимум {MAX_SECTIONS}: объедините близкие")

    unplaced = guide.get("unplacedFiles")
    if not isinstance(unplaced, list) or not all(isinstance(f, str) for f in unplaced):
        errors.append("`unplacedFiles` должен быть массивом строк (пустым, если всё размещено)")
        unplaced = []

    placements = {}  # путь -> список мест
    unknown = []

    for i, s in enumerate(sections, 1):
        where = f"глава {i}"
        if not isinstance(s, dict):
            errors.append(f"{where}: должна быть объектом")
            continue
        if not isinstance(s.get("title"), str) or not s["title"].strip():
            errors.append(f"{where}: пустой `title`")
        else:
            where = f"глава {i} «{s['title'].strip()}»"
        if not isinstance(s.get("overview"), str) or not s["overview"].strip():
            errors.append(f"{where}: пустой `overview`")
        diffs = s.get("diffs")
        if not isinstance(diffs, list):
            errors.append(f"{where}: `diffs` должен быть массивом")
            continue
        for d in diffs:
            if not isinstance(d, dict) or not isinstance(d.get("file"), str):
                errors.append(f"{where}: каждый элемент `diffs` — объект с полем `file`")
                continue
            if not isinstance(d.get("summary"), str) or not d["summary"].strip():
                errors.append(f"{where}: у `{d['file']}` пустой `summary`")
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
        errors.append(f"{where}: `{f}` нет среди изменённых файлов")
    for f, places in placements.items():
        if len(places) > 1:
            errors.append(f"`{f}` размещён несколько раз ({', '.join(places)}), нужно ровно одно место")
    missing = [f for f in changed if f not in placements]
    for f in missing:
        errors.append(f"`{f}` не размещён: добавьте в главу или в `unplacedFiles`")

    if unknown:
        errors.append("Допустимые пути (копируйте дословно):\n" + "\n".join(f"  {p}" for p in changed))
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
        print(f"Ошибка: файла {args.guide} нет", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Ошибка: guide.json не парсится как JSON: {e}", file=sys.stderr)
        sys.exit(1)

    errors = validate(guide, meta)
    if errors:
        print(f"guide.json не прошёл проверку ({len(errors)}):", file=sys.stderr)
        for e in errors:
            print(f"- {e}", file=sys.stderr)
        sys.exit(1)

    n_placed = sum(len(s["diffs"]) for s in guide["sections"])
    print(f"OK: {len(guide['sections'])} глав, {n_placed} файлов в главах, "
          f"{len(guide['unplacedFiles'])} в unplacedFiles")


if __name__ == "__main__":
    main()

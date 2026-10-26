# Guided review methodology

Adapted from plannotator's Guided Review (github.com/plannotator/guides).

> **Output language: write all `guide.json` text in Russian** — `title`, `intent`, every section `title` and
> `overview`, every `summary`. Identifiers, paths, file names and flags stay exactly as in the code. These instructions
> are in English; the guide you produce is not.

## Contents

- [Task](#task)
- [Voice](#voice)
- [Speed](#speed)
- [guide.json fields](#guidejson-fields)
- [Coverage rule (hard)](#coverage-rule-hard)
- [Hard constraints](#hard-constraints)
- [Workflow](#workflow)
- [guide.json shape](#guidejson-shape)

Quoted Russian phrases below are samples of guide text — the kind of wording to use or to avoid in your output.

## Task

You are an experienced engineer who understands this change set well. Split it into sections so that a reviewer can
grasp a large change in one pass. Each section explains what changed, why, and what it leads to. The diffs are shown next
to your text, so the text carries the meaning and shape of the change, not a retelling of the code.

You are **not hunting for bugs** and **not writing a findings report**. If, while reading the diff, you notice something
that looks like a real bug, mention it briefly in the overview of the relevant section. Do not go looking for problems.
Most reviews have no bugs, and that is fine.

## Voice

Write as if explaining the change to a capable colleague who has not seen this code.

- Short sentences, one thought each. Hard limit 25 words, usually fewer.
- Plain words: файл, функция, модуль, запрос, сервер. Avoid jargon such as «артефакт», «поверхность», «примитив». Once
  you name a thing, keep calling it the same name.
- Code names in backticks, at most two per sentence. The sentence must still read if the backticked parts are hidden.
- No judgement or marketing words: «элегантно», «надёжно», «бесшовно», «критически важно», «просто». Facts only.
- No emoji.

## Speed

You already have the diff. Reading it carefully once is 90% of the job. You are arranging a ready diff into sections, not
auditing the codebase.

- The main and usually the only source is `guide.patch`. The file list in `meta.json` is the authoritative set of paths.
- A few **targeted** lookups are fine when a section's story is missing one fact: a definition the diff refers to, one
  call site. Each lookup answers a question you can state. "Understand the codebase" is not a question.
- Do not explore the repository, do not read unchanged files "for context", do not run broad searches. If you catch
  yourself making a third exploratory call, stop and write with what you have.

A slow, exhaustive guide is a failure: the reviewer is sitting and waiting.

## guide.json fields

### title

One line. What the change essentially does, not a placeholder like «Изменения в коде».

### intent

1–2 sentences: why this change exists. Sources, in order:

1. Context from the main session, if the task includes it.
2. Commit messages from `meta.json` (`commits`) and the branch name.
3. The nature of the changes themselves.

Do not search for tasks or tickets that are not explicitly referenced.

### sections

Each section has a `title`, an `overview`, and one or more file references in `diffs`.

**Order by importance**, not by file path, diff size or chronology. The reviewer must be able to stop after any section
and already have seen what matters most.

1. The first section is the heart of the implementation: the part that, once understood, explains the rest. The reviewer
   should not have to hunt for the entry point.
2. Then the consequences, in decreasing significance: updated callers, adjusted downstream logic, tests of the new
   behaviour. Non-trivial tests go together with the code they test.
3. Wiring and minor changes go last, as one group: hookup, imports, renames, configs, generated files. Give it an honest
   title (samples: «Обвязка и конфиги», «Уборка») and a one- or two-sentence overview.

**Split by logic.** A section is a logical unit of change, not a file and not a folder. Three files changed for one reason
are one section with three files. If one file holds two unrelated changes, pick the section by the file's main purpose: a
file can appear in only one place. Do not default to one section per file. If the set contains two independent pieces of
work (two features, or a feature plus an unrelated refactor), each gets its own sections.

**Section `title`** names a concept (sample: «Локализация платежей»). Never a restated file name (bad sample:
«Изменения в payments/locale.ts»).

**`overview`** is Markdown, 2–6 sentences. Three jobs, in order:

1. What exactly changed.
2. Why: the motivation and non-obvious decisions. "Did X rather than Y because Z" is exactly what the reviewer cannot
   get from the diff.
3. Consequences: what changes in system behaviour, user experience, API and data contracts, performance or operations.
   This is not only about UI: a schema migration, a retry policy or an infrastructure swap also deserves one plain
   sentence.

If the main risk rests on one section, **say so directly** (sample: «вот место, где стоит читать медленно, остальное
следует из него»). For a genuinely risky change in behaviour or contract, use a separate callout (sample):

```markdown
> [!WARNING]
> Сигнатура `login` изменилась: вызовы с одним аргументом сломаются.
```

`> [!IMPORTANT]` is also available. Most sections have no such callouts.

Use Markdown only when it makes the text more precise:

- backticks around every file name, symbol, function, type, config key and flag;
- **bold** for the one phrase that must not be missed when skimming, at most one per overview;
- a short list when the section changes three or more things in parallel, prose otherwise;
- a small code block (2–5 lines) only when code says it better than a sentence, e.g. a new API shape. Never paste diff
  fragments: they are already right there.

**`diffs`** are file references, each with two fields:

- `file` — the path **verbatim** from `meta.json` (`files[].path`). Copy it; do not invent, shorten, or change case or
  slashes. For renamed files use the new path.
- `summary` — 1–2 sentences on the meaningful change in this file, based on the hunks you have already seen. Say what
  the change does (sample: «выносит логику индексации в карту переопределений»), not where it is (bad sample: «меняет
  строки 30–80»). Do not open the file or search the code for a summary. Do not repeat the section overview. A trivial
  edit needs only a short phrase.

A section without files is allowed only as a pure text context section with a non-empty overview; it still has
`"diffs": []`. It is rarely needed.

### unplacedFiles

Always present; an empty array if everything is placed. It holds changed files that have no place in any section: pure
noise, or leftovers so small that they would blur a section. This is rare. Do not use it as a dumping ground to avoid
writing an overview. Wiring files usually go into the final group section, not here.

## Coverage rule (hard)

Every file in `meta.json` appears in **exactly one place**: in the `diffs` of one section or in `unplacedFiles`. Not in
two places, not twice, not nowhere.

## Hard constraints

`validate.py` rejects the guide if any of these fail:

- `title` and `intent` are non-empty strings; `title` is a single line.
- `sections` is a non-empty array of at most 10 sections.
- Every section has a non-empty `title`, a non-empty `overview`, and a `diffs` array.
- Every `diffs` item is an object with a `file` string and a non-empty `summary`.
- `diffs[].file` and `unplacedFiles` entries are exact paths from `meta.json`, and the coverage rule above holds.
- `unplacedFiles` is an array of strings.

Also required, though the validator does not check them:

- Usually 2–6 sections. If the change fits in one section, use one; do not pad.
- `intent` is 1–2 sentences; a section overview is 2–6 sentences.
- All guide text is in Russian.
- No emoji.

## Workflow

1. Read `meta.json` and `guide.patch` in full. If the patch is very large, read it in chunks, but read all of it.
2. Commit messages are already in `meta.json`. No separate `git log` is needed.
3. Optional: look at `CLAUDE.md`, `AGENTS.md` or `README.md` only if the project is unfamiliar and the "why" of some
   section depends on it.
4. Find the logical groups of changes, including groups spanning several files. These are the sections. This is
   thinking work, not tool calls.
5. Order them: the heart of the implementation first (entry point before the rest, definitions before consumers, cause
   before effect), then consequences, then one shared section for wiring.
6. Write the `title`, the `intent` and each section's overview — in Russian.
7. Write `guide.json` and run the validator. Fix and rerun until it passes.

## guide.json shape

A sample output. Note the Russian text in every human-readable field:

```json
{
  "title": "Токены обновляются до истечения срока",
  "intent": "Пользователей выкидывало из сессии посреди работы. Теперь токен обновляется в фоне, а каждый запрос к API ждёт свежий.",
  "sections": [
    {
      "title": "Цикл обновления",
      "overview": "Всё остальное держится на `refresh.ts`. Он планирует обновление за минуту до истечения и даёт `waitForToken()`, чтобы вызывающий код не гонялся с обновлением.\n\nЭто место стоит читать медленно: ошибка здесь снова начнёт разлогинивать пользователей.",
      "diffs": [
        { "file": "src/auth/refresh.ts", "summary": "Новый планировщик и `waitForToken()`." },
        { "file": "src/auth/session.ts", "summary": "Хранит время истечения рядом с токеном." }
      ]
    },
    {
      "title": "Запросы ждут свежий токен",
      "overview": "Клиент API перед каждым запросом ждёт `waitForToken()`, а не читает токен синхронно. Правка маленькая, но защита работает именно из-за неё.",
      "diffs": [
        { "file": "src/api/client.ts", "summary": "Ждёт токен перед отправкой." }
      ]
    },
    {
      "title": "Тесты",
      "overview": "Тесты на поддельных часах. Проверяют, что обновление срабатывает до истечения, а запрос из очереди получает новый токен.",
      "diffs": [
        { "file": "src/auth/refresh.test.ts", "summary": "Покрывают таймер и гонку." }
      ]
    }
  ],
  "unplacedFiles": [],
  "generator": { "engine": "claude-code", "model": "<model id, if known>" }
}
```

`generator` is optional. Fill in `model` only if you know for certain which model you are.

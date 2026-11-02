# Guided review methodology

Adapted from plannotator's Guided Review (github.com/plannotator/guides).

> **Output language: write all `guide.json` text in Russian**: `title`, `intent`, every `brief` point, every section
> `title` and `overview`, every `summary`. Identifiers, paths, file names and flags stay exactly as in the code. These
> instructions are in English; the guide you produce is not.

Contents: Task, Readers, Voice, Accuracy, Speed, guide.json fields (title, intent, brief, sections, unplacedFiles),
Coverage rule, Examples, Hard constraints, Workflow, guide.json shape.

Quoted Russian phrases below are samples of guide text: the kind of wording to use or to avoid. The longer samples in
`<example>` tags are fictional. Take the approach from them, not the phrases: every change needs its own words.

## Task

You are an experienced engineer who understands this change set well. You write a guide that lets a reviewer grasp a
large change in one pass: a short brief of the whole change, then chapters (`sections`) that explain what changed, why,
and what it leads to. The diffs are shown next to the chapters, so the text carries the meaning and shape of the
change, not a retelling of the code.

You are **not hunting for bugs** and **not writing a findings report**. If, while reading the diff, you notice something
that looks like a real bug, mention it briefly where it belongs. Do not go looking for problems. Most reviews have no
bugs, and that is fine.

## Readers

The page opens in Overview mode: the brief and the overviews of all chapters as one text. Guide mode shows each
chapter next to its diffs. Two different people read this.

**The first reader** reads the brief and the first paragraph of each chapter, and stops there. They will not open the
code. For a large change this is the main reader: a lead deciding whether it is safe to merge, a teammate catching up,
a product owner checking what users will see. They know the product and everyday development words (сервер, запрос,
база данных, тест), but not this code base: its class names, internal terms and file layout. To them an identifier is
noise, and a sentence built around identifiers says nothing.

**The second reader** reads the code next to the guide. They need the mechanism: which part does what, which decision
was made and why, where to read slowly. Identifiers help them find things in the diff.

One text cannot serve both: a paragraph written for the second reader is opaque to the first, and one written for the
first is too thin for the second. So each gets a place. The title, the intent, the brief and the first paragraph of
every chapter are for the first reader; everything after the first paragraph is for the second. The second reader
reads the plain part too, so it must be exact enough to check against the code.

## Voice

Write as if explaining the change aloud to a capable colleague who has not seen this code. The rules hold everywhere and
are strictest in the plain part.

- **Most important thing first**: in the brief, in each paragraph, in each sentence. Readers skim and stop early, and
  the first words decide whether they read on. Start with the effect, then the condition: «Заказ отмечается оплаченным
  один раз, даже если уведомление пришло дважды», not «В случае повторного получения уведомления…».
- **One idea per sentence, 15–20 words on average, 25 at most.** A Russian sentence with two participle clauses and a
  chain of genitives («изменение логики обработки ошибок загрузки») loses the reader by the middle. Split it and give
  each part its own verb.
- **Concrete numbers and observable behaviour instead of judgement.** «Список из 500 строк открывается за полсекунды,
  раньше за четыре» tells the reader something; «работает заметно быстрее» does not. If the diff gives no number,
  describe what the user or the system now does differently.
- **Active voice with a real subject.** Say who does what: «Сервер отклоняет запрос без подписи», «Игрок видит…»,
  «Вызывающий код получает ошибку». Prefer a verb to a verbal noun: «сервер проверяет», not «осуществляется проверка».
- **Name things by what they do, the way the reader would, and keep one name per thing.** In the plain part write
  «окно выбора размера», not `SizePicker`. After the first paragraph, link the plain name to the code name once in a
  full sentence («Окно выбора живёт в `SizePicker`») and use the two consistently. A second name for the same thing
  makes the reader think there are two things.
- **Plain words**: файл, функция, модуль, запрос, сервер. Replace jargon such as «артефакт», «поверхность», «примитив»
  with what it means here. A unit or term the code base invented is jargon too, even when it is an ordinary word. A
  term that cannot be avoided is explained once, in a plain clause: «миграция, то есть скрипт, который меняет таблицы
  базы».
- **Code names go in backticks, at most two per sentence, never in the plain part.** The sentence must still read if
  the backticked parts are hidden.

Habits to replace, and what to write instead:

- An arrow chain («запрос → кэш → база») becomes a sentence with verbs: «Запрос сначала идёт в кэш, а если там пусто,
  в базу».
- Identifiers packed into parentheses or a slash list («(`_fit`/`_seat`/`_take`)») become the one name that matters,
  or a short list in the mechanism part where each item says what it does.
- Abbreviations and labels you invented while reading («шаг 3», «вариант Б», «ПЛ» for «правила лент») become the full
  plain name. The reader never saw your notes.
- Impersonal filler («были внесены изменения», «произведён рефакторинг», «улучшена логика») becomes what concretely
  happens now, and who does it.
- Judgement and marketing words («элегантно», «надёжно», «бесшовно», «критически важно», «просто») become the fact that
  made you want the word.
- No emoji.

## Accuracy

Plain does not mean vague or invented. A plain sentence that is wrong is worse than a technical one that is right,
because the first reader cannot check it.

- Every statement must be traceable to the diff, to `meta.json` (commit messages, PR title and description) or to the
  author's context in your task. When you turn a mechanism into an effect, keep its conditions: for whom, when, within
  which limits («только для новых сохранений», «если включена настройка»).
- Describe the effect the diff produces, not one it might lead to. A diff that raises a timeout from 5 to 30 seconds
  lets slow requests finish; it does not «убирает ошибки у пользователей».
- If none of those sources gives the reason for a change, do not make one up. Say what changed and leave the why out;
  if a reader will certainly ask, say plainly that the change does not explain it.
- Count every number and quantity in the plain part («три варианта», «на пять записей меньше», «десятки», «сотни»)
  from the diff: deleted files, removed entries, a constant. Or copy it from `meta.json`. A sample value in a comment,
  a docstring or a test is not a fact about real data. A rounded word like «сотни» is still a number. For a
  before/after count (entries in a menu, variants of a part), list the removed and the added items by name and count
  each side before writing either number.
- For a change in controls or UI, first match each user action to the control that does it, and keep them apart in
  the text. If a menu picks the font and the cursor position picks where the text goes, a sentence that has the menu
  doing both is wrong.
- Describe a test scene, fixture or demo by what its content shows, not by its name. A scene called `broken` may hold
  nothing broken. If you did not read its content, do not describe it.
- Say which tests the diff adds, or that it adds none: the file list shows it. Never say what the author checked by
  hand unless `meta.json` or your task says so.
- When unsure, say less. A shorter brief that is all true beats a longer one with a guess in it.

## Speed

You already have the diff. Reading it carefully once is 90% of the job. You are arranging a ready diff into chapters,
not auditing the codebase.

- The main and usually the only source is `guide.patch`. The file list in `meta.json` is the authoritative set of paths.
- A few **targeted** lookups are fine when a chapter's story is missing one fact: a definition the diff refers to, one
  call site. Each lookup answers a question you can state. "Understand the codebase" is not a question.
- Do not explore the repository, do not read unchanged files "for context", do not run broad searches. If you catch
  yourself making a third exploratory call, stop and write with what you have.

A slow, exhaustive guide is a failure: the reviewer is sitting and waiting.

## guide.json fields

### title

One line, in the first reader's words: what the change does, not a placeholder like «Изменения в коде». No code names.

### intent

1–2 plain sentences, no code names: why this change exists, what problem it solves. The brief then says what changes;
do not repeat the intent there. Sources, in order:

1. Context from the main session, if the task includes it.
2. For a pull/merge request (`meta.json` has `pr`): its title and description (`pr.title`, `pr.body`). They state what
   the author claims; check the claim against the diff, and if the diff does more, less or something else, say so in
   the brief or a chapter instead of repeating the description.
3. Commit messages from `meta.json` (`commits`) and the branch name.
4. The nature of the changes themselves.

Do not search for tasks or tickets that are not explicitly referenced.

### brief

The whole change in 3–7 points, about 100–200 words in total; a small change needs fewer. It is what the first reader
takes away, and often all they read. Each point is an object:

- `kind`:
  - `change`: what now works differently. Every brief has at least one.
  - `kept`: what was deliberately left as it was, only where a reader could reasonably worry: old clients and versions,
    saved data and files, a public API or config, behaviour one would expect to change. «Остальное не изменилось»
    tells the reader nothing; leave it out. For a refactor with no behaviour change, `kept` points carry the main news.
    The thing a `kept` point names is untouched by the diff. If the diff rebuilt, moved or updated it
    («пересобраны», «переведены», «обновлены»), it is a `change` point or no point.
  - `risk`: where it is worth reading the code yourself, and why: dense new logic, behaviour that shows only at
    runtime, concurrency, data migration, a case no test covers, or a real bug you noticed. Name the failure and the
    symptom a user or operator would see; «логика сложная» or «стоит прочитать» alone is not a risk, because the
    reader cannot tell what to look for. Describe the symptom, not how the code computes it. Before a compatibility
    or migration risk, name what still depends on the old thing: a save format, a stored file, a caller outside the
    diff. If you cannot name it, drop the point; a point that admits the diff does not show what depends on the old
    thing is such a case, not one to keep with a disclaimer. Most briefs have zero to two; do not invent one to fill the kind.
- `text`: one line, one or two sentences of plain Russian, at most 40 words, no code names and no backticks. The page
  shows it as plain text, so no Markdown either.
- `section`: the number of the chapter that explains the point, counting from 1. Omit it when the point spans the whole
  change.

How to write a point:

- Order points by importance, so the reader can stop after any one and has seen what matters most. The page groups
  them under one heading per kind, keeping your order inside each group.
- The subject is who or what is affected: the user, the player, the calling code, saved data, the operator who deploys
  it, the developer who edits this module. «Игрок может…», «Старые сохранения…», «Вызывающий код должен…».
- Describe the effect, not the mechanism: «Счёт больше не создаётся дважды при повторном нажатии», not «добавлена
  проверка идемпотентности в обработчик».
- One point, one fact. Two unrelated changes are two points.
- Tests and docs earn a point only with a fact the reader needs: which case is or is not covered. «Документация
  описывает новое поведение» is not a point.

### sections

Each section (a chapter on the page) has a `title`, an `overview`, and one or more file references in `diffs`.

**Order by importance**, not by file path, diff size or chronology. The reviewer must be able to stop after any chapter
and already have seen what matters most.

1. The first chapter is the heart of the implementation: the part that, once understood, explains the rest. The
   reviewer should not have to hunt for the entry point.
2. Then the consequences, in decreasing significance: updated callers, adjusted downstream logic, tests of the new
   behaviour. Non-trivial tests go together with the code they test.
3. Wiring and minor changes go last, as one group: hookup, imports, renames, configs, generated files. Give it an honest
   title (samples: «Обвязка и конфиги», «Уборка») and a one- or two-sentence overview.

**Split by logic.** A chapter is a logical unit of change, not a file and not a folder. Three files changed for one
reason are one chapter with three files. If one file holds two unrelated changes, pick the chapter by the file's main
purpose: a file can appear in only one place. Do not default to one chapter per file. If the set contains two
independent pieces of work (two features, or a feature plus an unrelated refactor), each gets its own chapters.

**Section `title`** names a concept in the reader's words (sample: «Локализация платежей»), never a restated file name
(bad sample: «Изменения в payments/locale.ts»). It appears in Overview mode, so no code names.

**`overview`** is Markdown in two parts.

The **first paragraph** (the text up to the first blank line) is for the first reader: 1–3 sentences and at most about
45 words of plain prose on what changes for the user or the system in this chapter. No code names, no backticks, no
list, callout or code block. It says what the user can now do; the controls, timings and modifier keys that do it
(which button, how long to hold, which key changes the action) go in the next paragraph, where a manual can be read
slowly. Overview mode shows it right after the brief, so do not restate the brief point: add the condition, the scope or the
visible detail the point left out. An overview of a single paragraph is all first paragraph, which is often right for
the wiring chapter (sample: «Подключение нового экрана к меню и правки настроек сборки.»). If you need a code name,
start a second paragraph. For a chapter of data or scene edits, the first paragraph says what the edit changes in
behaviour, often nothing, never the raw field values.

The **next paragraphs** are for the second reader, usually 2–5 sentences in total:

1. How it works: the mechanism, with code names in backticks.
2. Why: the motivation and non-obvious decisions. "Did X rather than Y because Z" is exactly what the reviewer cannot
   get from the diff.
3. Consequences the first paragraph did not cover: API and data contracts, performance, operations. A schema
   migration, a retry policy or an infrastructure swap deserves one plain sentence.

If the main risk rests on one chapter, **say so directly** (sample: «вот место, где стоит читать медленно, остальное
следует из него»), and give it a `risk` point in the brief. For a genuinely risky change in behaviour or contract, add
a callout after the first paragraph; `> [!IMPORTANT]` is also available. Most chapters have none. Sample:

```markdown
> [!WARNING]
> Сигнатура `login` изменилась: вызовы с одним аргументом сломаются.
```

After the first paragraph, use Markdown only when it makes the text more precise: backticks around every file name,
symbol, function, type, config key and flag; **bold** for the one phrase that must not be missed, at most one per
overview; a short list when the chapter changes three or more things in parallel; a small code block (2–5 lines) only
when code says it better than a sentence, e.g. a new API shape. Never paste diff fragments: they are already there.

**`diffs`** are file references, each with two fields:

- `file`: the path **verbatim** from `meta.json` (`files[].path`). Copy it; do not invent, shorten, or change case or
  slashes. For renamed files use the new path.
- `summary`: 1–2 sentences for the second reader on the meaningful change in this file, based on the hunks you have
  already seen; code names in backticks are fine. Say what the change does (sample: «выносит логику индексации в карту
  переопределений»), not where it is (bad sample: «меняет строки 30–80»). Do not open the file or search the code for
  a summary. Do not repeat the overview. A trivial edit needs only a short phrase.

A chapter without files is allowed only as a pure text context chapter with a non-empty overview; it still has
`"diffs": []`. It is rarely needed.

### unplacedFiles

Always present; an empty array if everything is placed. It holds changed files that have no place in any chapter: pure
noise, or leftovers so small that they would blur a chapter. This is rare. Do not use it as a dumping ground to avoid
writing an overview. Wiring files usually go into the final group chapter, not here.

## Coverage rule (hard)

Every file in `meta.json` appears in **exactly one place**: in the `diffs` of one section or in `unplacedFiles`. Not in
two places, not twice, not nowhere.

## Examples

Three briefs for different kinds of change, each with the overview of its first chapter, then a bad and a good first
paragraph. Each example opens with an English line on the diff it was written for.

<example>
A web calendar. Editing or deleting a repeating meeting now asks whether to apply it to this meeting only or to this
and all following ones. The server splits the series; old mobile apps send no choice and keep editing the whole series.

```json
"brief": [
  { "kind": "change", "text": "Когда пользователь меняет повторяющуюся встречу, календарь спрашивает, к чему применить правку: только к этой встрече или к этой и всем следующим.", "section": 1 },
  { "kind": "change", "text": "Удаление спрашивает о том же, так что можно убрать одну встречу и оставить остальные встречи серии.", "section": 1 },
  { "kind": "change", "text": "Правка всех следующих встреч делит серию на две: прежняя заканчивается накануне, новая начинается с выбранной встречи.", "section": 2 },
  { "kind": "change", "text": "Встреча, изменённая отдельно, выходит из серии. Последующие правки всей серии её не трогают.", "section": 2 },
  { "kind": "kept", "text": "Мобильные приложения старых версий о выборе не знают. Их правка по-прежнему меняет всю серию.", "section": 2 },
  { "kind": "risk", "text": "При делении серии сервер пересчитывает дату её окончания. Ошибка на день добавит лишнюю встречу или потеряет последнюю, поэтому этот расчёт стоит прочитать.", "section": 2 }
],
"sections": [
  {
    "title": "Выбор при правке серии",
    "overview": "Перед сохранением или удалением повторяющейся встречи появляется окно с двумя вариантами. Одиночные встречи сохраняются сразу, как раньше.\n\nОкно выбора живёт в `RecurrenceScopeDialog`. Форма встречи открывает его перед отправкой и передаёт ответ серверу в поле `scope`. Отмена в окне отменяет и сохранение."
  }
]
```
</example>

<example>
A billing service, refactor only. The 1,400-line module that builds invoice PDFs, most of it one 600-line function, is
split into three modules: amounts, page layout, file storage. A config key is renamed and the old name is still read.
New tests compare the PDFs of the new and the old code byte for byte on 40 stored invoices, all in whole roubles.

```json
"brief": [
  { "kind": "change", "text": "Код, который собирает счёт в PDF, теперь состоит из трёх шагов: подсчёт сумм, вёрстка страницы и сохранение файла. Каждый шаг можно менять и тестировать отдельно.", "section": 1 },
  { "kind": "kept", "text": "Клиенты получают те же счета: тесты сравнивают байт в байт PDF нового и старого кода на 40 образцах.", "section": 3 },
  { "kind": "kept", "text": "Адреса сервиса, параметры запросов и формат ответов не изменились, поэтому сервисы, которые запрашивают счета, ничего не заметят." },
  { "kind": "kept", "text": "Старое имя настройки шрифта по-прежнему читается, поэтому конфиги на серверах менять не нужно.", "section": 2 },
  { "kind": "risk", "text": "Округление сумм переехало из вёрстки в подсчёт. Двойное округление сдвинет итог на копейку, а все образцы в тестах в целых рублях и этот случай не ловят.", "section": 1 }
],
"sections": [
  {
    "title": "Три шага сборки счёта",
    "overview": "Для клиентов и вызывающего кода ничего не меняется: это перестройка кода, а не новая функция. Сборка счёта теперь идёт тремя шагами, у каждого свой модуль и свои тесты.\n\nШаги связаны одним объектом `InvoiceDraft`: подсчёт его заполняет, вёрстка читает, сохранение получает готовый файл. Раньше всё это делала одна функция `render_invoice` на 600 строк."
  }
]
```
</example>

<example>
A shop backend, bug fix. The payment provider sometimes sends the same "payment succeeded" notification twice, and
both copies were processed. The diff stores the ids of processed notifications in a new table with a unique index,
skips repeats with a normal success response, and adds a nightly job that deletes records older than 30 days. One new
test sends two copies at the same moment.

```json
"brief": [
  { "kind": "change", "text": "Если платёжная система присылает уведомление об оплате дважды, заказ отмечается оплаченным один раз, а клиент получает одно письмо вместо двух.", "section": 1 },
  { "kind": "change", "text": "Перед выкаткой нужно применить миграцию, то есть скрипт, который создаёт в базе таблицу полученных уведомлений.", "section": 2 },
  { "kind": "change", "text": "Ночная задача удаляет из этой таблицы записи старше 30 дней, так что таблица хранит уведомления только за последний месяц и не разрастается.", "section": 2 },
  { "kind": "kept", "text": "Адрес для уведомлений и ответы платёжной системе остались прежними, поэтому в её личном кабинете ничего менять не нужно." },
  { "kind": "risk", "text": "Две копии уведомления, пришедшие одновременно, отсекает только сама база: она не хранит два уведомления с одним номером. Ошибка здесь снова даст клиенту два письма, а проверяет этот случай один тест.", "section": 1 }
],
"sections": [
  {
    "title": "Повторные уведомления об оплате",
    "overview": "Повторное уведомление об оплате теперь ничего не делает: заказ не меняется, письмо не уходит. Платёжная система при этом получает обычный успешный ответ и больше его не присылает.\n\nОбработчик сначала записывает номер уведомления в `processed_events` и только потом меняет заказ. Если запись не прошла из-за уникального индекса, это повтор, и обработчик сразу отвечает успехом."
  }
]
```
</example>

<example>
A factory game. Belts get four speeds, and a new splitter hands items from one belt to several in turn. The first
paragraph of the main chapter, written badly and then well.

Bad: built from code names (the validator rejects backticks here), mechanism before effect, packed identifiers and an
arrow. The first reader learns nothing.

```text
`Belt.speed` (1–4) задаёт шаг так, что `tick()` сдвигает предмет на `speed` клеток; `Splitter` раздаёт по кругу (`Belt[]` → `next_index`).
```

Good: what the player sees, with the one number that matters. The code names move to the second paragraph.

```text
Конвейеры теперь бывают четырёх скоростей: самый быстрый везёт предметы вчетверо быстрее самого медленного. Новый разделитель раздаёт предметы с одного конвейера на несколько по очереди.
```

Removing the backticks is not the fix: «Belt.speed задаёт шаг» is just as opaque without them. Replace the name with
what it does.
</example>

## Hard constraints

`validate.py` rejects the guide if any of these fail:

- `title` and `intent` are non-empty strings; `title` is a single line.
- `brief` is an array of 2–10 points with at least one `change`. Each point is an object with `kind` set to `change`,
  `kept` or `risk`; a non-empty single-line `text` of at most 40 words with no backtick; and, if present, an integer
  `section` from 1 to the number of sections.
- `sections` is a non-empty array of at most 10 sections. Every section has a non-empty `title`, a non-empty
  `overview` whose first paragraph has no backtick, and a `diffs` array.
- Every `diffs` item is an object with a `file` string and a non-empty `summary`.
- `diffs[].file` and `unplacedFiles` entries are exact paths from `meta.json`, and the coverage rule above holds.
- `unplacedFiles` is an array of strings.

Also required. The validator's limits are wider so that a small or unusual change still passes; these are the ones to
write to:

- Usually 2–6 sections. If the change fits in one section, use one; do not pad.
- The brief has 3–7 points and at most about 200 words. Past seven points the first reader stops telling the main news
  from the rest; merge or drop the minor ones.
- `intent` is 1–2 sentences; the first paragraph of an overview is 1–3 sentences and at most about 45 words.
- No code names in the title, the intent, section titles, the brief or first paragraphs, with or without backticks.
- All guide text is in Russian. No emoji.

## Workflow

1. Read `meta.json` and `guide.patch` in full; read a very large patch in chunks, but all of it. Commit messages are
   already in `meta.json`, so no `git log` is needed. Look at `CLAUDE.md`, `AGENTS.md` or `README.md` only if the
   project is unfamiliar and the "why" of some chapter depends on it.
2. Find the logical groups of changes, including groups spanning several files. These are the chapters. This is
   thinking work, not tool calls.
3. Order them: the heart of the implementation first (entry point before the rest, definitions before consumers, cause
   before effect), then consequences, then one shared chapter for wiring.
4. Write each chapter: the title, the plain first paragraph, the mechanism paragraphs, the `diffs` summaries.
5. Write the `title`, the `intent` and the brief last, when you see the whole change and the chapter numbers are fixed.
6. Check the plain part (title, intent, brief, section titles, first paragraphs) before writing the file:
   - Reread it as someone who never saw the code. Can they say what changed for them and where the risk is? If not,
     rewrite.
   - Replace every code name, file name and internal term in it with what the thing does.
   - Check each claim against the diff and the other sources, and recount each number. Remove what you cannot point
     to.
   - Put each chapter's first paragraph next to the brief points that cite it. If the paragraph restates a point,
     replace it with the condition, scope or detail the point left out. If there is none, write one sentence on what
     else the chapter covers, named concretely: «документация описывает новое поведение» names nothing.
   - List the plain name you used for each thing across the title, the brief, section titles and first paragraphs.
     Keep one per thing.
   - List the effects a player, user or operator will notice: new costs, limits, numbers, keys, modes. Each one is in
     the brief or a first paragraph, or you decided it is minor.
   - Move controls out of first paragraphs: keys, mouse buttons, hold times and modifier keys go to the next
     paragraph, unless the chapter is about the key bindings themselves. A colon followed by a list of controls is
     still one sentence and counts against the 25-word limit.
   - Look for sentences over 25 words, arrows, packed identifiers, invented labels and filler.
7. Write `guide.json` and run the validator command from your task. Fix and rerun until it passes.

## guide.json shape

A sample output. Note the Russian text in every human-readable field:

```json
{
  "title": "Сессия больше не обрывается посреди работы",
  "intent": "Пользователей выкидывало из сессии посреди работы, когда истекал срок токена входа.",
  "brief": [
    { "kind": "change", "text": "Пользователь остаётся в сессии, пока работает: клиент сам продлевает вход в фоне за минуту до истечения срока.", "section": 1 },
    { "kind": "change", "text": "Запрос, отправленный в момент продления, ждёт новый токен и больше не получает отказ из-за старого.", "section": 2 },
    { "kind": "kept", "text": "Сервер и формат токена не менялись: правка целиком на стороне клиента, и сервер выкатывать заново не нужно." },
    { "kind": "risk", "text": "Ошибка в планировщике продления снова начнёт разлогинивать пользователей, но проявится только когда истечёт срок токена. Этот код стоит прочитать.", "section": 1 }
  ],
  "sections": [
    {
      "title": "Продление входа в фоне",
      "overview": "Продление повторяется, пока пользователь работает в приложении. Если сервер всё же отказал в продлении, клиент показывает экран входа, как и раньше.\n\nВсё остальное держится на `refresh.ts`. Он планирует продление и даёт `waitForToken()`, чтобы вызывающий код не гонялся с продлением.\n\nЭто место стоит читать медленно: ошибка здесь снова начнёт разлогинивать пользователей.",
      "diffs": [
        { "file": "src/auth/refresh.ts", "summary": "Новый планировщик и `waitForToken()`." },
        { "file": "src/auth/session.ts", "summary": "Хранит время истечения рядом с токеном." }
      ]
    },
    {
      "title": "Запросы ждут свежий токен",
      "overview": "Так ведут себя все запросы приложения к серверу: они идут через один общий модуль. В остальное время запросы уходят сразу, без ожидания.\n\nКлиент API перед каждым запросом ждёт `waitForToken()`, а не читает токен синхронно. Правка маленькая, но защита работает именно из-за неё.",
      "diffs": [
        { "file": "src/api/client.ts", "summary": "Ждёт токен перед отправкой." }
      ]
    },
    {
      "title": "Тесты",
      "overview": "Тесты проверяют, что продление срабатывает до истечения срока и что запрос из очереди получает новый токен.\n\nОни идут на поддельных часах, поэтому не ждут реального времени.",
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

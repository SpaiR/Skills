# Language policy

The project is written in English; the product speaks Russian. The guide and the page are for a Russian-speaking
reader, so their text is Russian. Everything a developer reads is English.

## English

Code, identifiers, comments, docs (`*.md` outside the exceptions below), test names, commit messages, script output
for the session (`collect.py` summary and notes text, `validate.py` errors, `serve.py` messages and API error codes).

## Russian is allowed only in

- `assets/js/strings.js`: every user-visible string of the viewer and the `feedback.md` template.
- `assets/viewer.html`: the static placeholders shown before the scripts run (`Оглавление`, `Загружаю ревью…`).
- `guide.json` content written by the subagent (always Russian, whatever the user's language).
- `references/guide-method.md`: only the labelled Russian output samples; the instructions around them are English.
- Tests: expectations of UI text (assertions on what the page shows), and recorded fixtures in `tests/fixtures/`.

Messages the main session prints to the user follow the user's language (see `SKILL.md`), not this policy.

## Page text lives in strings.js only

No other module under `assets/js/` may hold page text, labels, `aria-label`s, titles or toast messages. Modules
import `T` (and `WORDS` for plurals) from `./strings.js`.

To add a UI string:

1. Add it to `T` in `assets/js/strings.js`, in the group of the module that shows it (`header`, `toc`, `file`,
   `diff`, `comments`, `submit`, ...). Top-level keys are for strings shared by several modules.
2. A string with parameters is a function: `lineRange: (start, end) => ...`. Counted nouns use
   `plural(n, WORDS.x)` (forms `[one, few, many]`); add new word forms to `WORDS`.
3. Text that comes from data as a code (meta `notes[].code`, `content.reason`, server error codes) goes into the
   matching code table (`NOTES`, `FULL_TEXT_REASONS`, `SERVER_ERRORS`), looked up with `byCode`.
4. Use it as `T.group.key` in the module. Do not build Russian text by concatenating fragments elsewhere.
5. If it changes visible text, update the e2e expectations; if it changes `T.feedback`, see the golden file rule in
   `testing.md`.

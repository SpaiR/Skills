---
paths:
  - "assets/**"
---

# Viewer (assets/)

No build step, no bundler, no runtime dependencies. `viewer.html` loads `css/index.css` and `js/main.js` as a
native ES module; `serve.py` serves the files as they are. Do not add npm packages to the page or syntax that
needs transpiling.

## Module ownership (assets/js)

- `main.js` entry: loads the review, builds the model, renders, wires global listeners
- `state.js` all shared mutable state and its setters
- `strings.js` all page text and the feedback.md template
- `constants.js` constants, status codes, platform and media queries
- `diffcore.js` pure functions, no DOM: patch parsing, side-by-side pairs, intraline diff, highlighting, `buildView`
- `dom.js` `h()` element builder, string/path utils, SVG icons
- `model.js` derived queries: groups, viewed/open flags, counters
- `persist.js` server API, state normalization and migration, debounced saves
- `lines.js` per-file line helpers: quotes, pairs, ranges, change blocks, highlight caches, `lineKey`
- `expand.js` context expansion: full text loading, gap buttons, whole-file mode, `applyView`/`reshapeFile`
- `rerender.js` targeted re-rendering with `withAnchor` and focus keeping
- `section.js` main column: hero, chapter cards, Files group, chapter comments
- `overview.js` the guide brief in the hero (`renderBrief`), Overview mode chapter cards (`renderOverview`), jumps
  from them (`goToChapter`, `readInGuide`)
- `file.js` file card: header, summary, collapsed note, diff body
- `markdown.js` mini-Markdown for guide intent, overviews and summaries: inline code, bold, links, lists, headings,
  code blocks, quotes, GitHub callouts; applies `typography()`
- `diff.js` diff tables (unified, side-by-side), hunk and gap rows, selection painting
- `comments.js` note cards, suggestions, draft rows, comment editor
- `forms.js` line comment form lifecycle, drafts, delete with undo
- `selection.js` mouse selection on line numbers (click, Shift+click, drag)
- `events.js` delegated click/change handlers of `#main`
- `keyboard.js` global shortcuts and their actions
- `nav.js` scrolling, jumps, current chapter/file tracking
- `modes.js` Overview/Guide/Files switching, layout variables from CSS, collapse all
- `header.js` top bar; `menu.js` "More" menu; `toc.js` Overview/Guide sidebar and drawer; `tree.js` Files tree
- `viewed.js` viewed marks for files and chapters; `view.js` diff view, wrap, theme
- `dialogs.js` modal scaffold; `help.js` shortcuts dialog; `submit.js` submit dialog and finished screen
- `publish.js` PR/MR publish dialog and the `/api/publish` payload (inline vs. body via `D.prPosition`)
- `toast.js` toasts with undo; `feedback.js` builds the feedback Markdown

## State

- Shared state lives in `state.js`. Reassigned bindings (`R`, `S`, `sections`, `filesGroup`, `treeRoot`,
  `selection`, `finished`) change only through their setters; imported bindings are read-only.
- `S` is persisted to `state.json` (`save()` debounced, `flushSave()` on unload). Every field must get a default in
  `normalizeState()` (`persist.js`); old states must keep loading. `ui` is ephemeral page state, never saved.

## Modes

`S.mode` is `overview` | `guide` | `files` (`overviewMode()`, `guideMode()`, `filesMode()` in `model.js`).
`normalizeState()` turns a missing or unknown value into `overview`, so a new review opens in Overview; a saved
`guide` or `files` is kept. `html` gets `mode-overview` or `mode-files`. G toggles Guide and Files and goes from
Overview to Guide; there is no key for Overview.

- Overview shows the hero (intent, PR block, brief) and one `.ov-sec` card per chapter, no files. `groups()` is
  empty and `groupFor()` is `null` there, so file keys, re-renders and Z find nothing to act on.
- `.ov-sec` is deliberately not `.sec`: chapter keys, `withAnchor()` and `rerenderSection()` look for `.sec` and
  must not treat the cards as chapters. In Overview `trackCurrent()` only marks the sidebar row of the card under
  the top bar (`trackCard()`, `nav.js`), and `jumpToCard()` pins it. Chapter-only keys (`guideOnly`) show a hint
  outside Guide mode.
- Entering Overview remembers the file and row of Guide or Files (`ui.modeReturn`); leaving it without a target
  goes back there, so a look at Overview keeps the reading place.
- The brief (`guide.brief`, optional) is shown in Overview and Guide, not in Files; a guide without it shows no
  block. Point text goes in as a text node (`typography()` applied), never through `md()`.
- Jumps that need files (notes and drafts from the submit dialog, chapter comments) switch to Guide first when the
  page is in Overview; chapter comments also leave Files. The diff view switch is hidden in Overview, and S there
  shows a hint instead of changing it.

## Invariants tests rely on

- `file.lines[k].i === k` after every reshape: `D.parsePatch` and `D.buildView` number lines per file, `applyView`
  (`expand.js`) flattens them. Never splice `file.lines` by hand.
- Rows are keyed by line number, not index: `lineKey()` gives `o<no>` for `del`, `n<no>` otherwise; diff rows carry
  `data-anchor` `r:<path>:<lineKey>` / `p:<path>:<lineKey>`. `reshapeFile()` carries `ui.cursor` and
  `selection.anchor` across a reshape by `lineKey`.
- Re-renders that can move content run inside `withAnchor()` (`rerender.js`), as `reshapeFile()` and
  `rerenderAllFiles()` do, so the reading position does not jump; `keepFocus()` keeps focus and caret.
- `file.hash` is `D.fnv1a` of the base patch (set in `init()`, `main.js`); `isViewed()` compares it. Expansion
  changes `hunks`/`lines`, never `hash`, so it never resets "viewed".
- Modules import each other in cycles (e.g. `comments.js` <-> `diff.js`). Top-level code must not call or read an
  imported binding; use imports only inside functions (see the `KEYS` table in `keyboard.js`). `main.js` calls
  `init()` last.

## Text and accessibility

- All text comes from `strings.js` (see `language.md`); `T` is frozen.
- Keep ARIA roles (`tree`/`treeitem`, `menu`, `status`, `alert`, `group`) and labels when changing markup.
- The file tree uses a roving tabindex: exactly one `.tree-row` has `tabindex="0"` (`renderTree()`,
  `focusTreeRow()` in `tree.js`).
- Dialogs are built with `dialogEl()`: focus trap on Tab, focus returns to `d.opener` on close; record the opener
  with `dialogOpener()` before opening.

## Untrusted text

- Diff lines, file paths, guide text and, for a PR/MR, `meta.pr` fields (title, author, body) come from other
  people. Insert them as text nodes via `h()`; the only HTML path is `md()`/`inline()` (`markdown.js`), which
  escapes first and links only `http(s)` URLs. Never pass such text to `html:` any other way.
- The page makes no requests outside 127.0.0.1 (tests check it): no images or other remote resources from
  descriptions. Links to the PR open in a new tab with `rel="noopener noreferrer"`.

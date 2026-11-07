---
paths:
  - "skills/diff-review/assets/css/**"
---

# CSS (assets/css)

- `index.css` is the only stylesheet the page loads. Its `@import` order is the cascade order: never reorder the
  imports. A new part goes in at the position where its rules must win, usually next to the part it extends.
- One part per area; the first line of each file says what it owns. Keep rules in the part of the component.
- Biome's `noDescendingSpecificity` and `noImportantStyles` are off on purpose: reordering selectors would change
  rendering, and the few `!important`s (`[hidden]`, reduced motion, drag state) are deliberate. Do not "fix" them.
- No preprocessor, no build: plain CSS that Chrome supports natively.

## Tokens and themes

- Colours, typography, spacing, radii, z-layers, layout sizes and motion are custom properties in `tokens.css`
  (light theme). Components use tokens, not literal colours.
- `themes.css` holds the dark theme twice: under `@media (prefers-color-scheme: dark)` for
  `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]`. The two blocks must stay identical.
- `--header-h`, `--sec-head-h` and `--file-head-h` are read by `modes.js` (`L` in `state.js`) for scroll offsets.
  Change them in CSS only; the JS defaults are fallbacks.
- `motion.css` and `a11y.css` override motion and colours for `prefers-reduced-motion` and `forced-colors`.

## Contrast checks

`tests/tools/contrast.js` holds a hand copy of the palette (`PALETTE`, light and dark) and checks WCAG ratios
(text 4.5:1, control borders 3:1). `tests/e2e/theme-and-contrast.test.js` also hard-codes some token values and
compares them with computed styles.

When a palette token changes:

1. Update the value in `tokens.css` and both blocks of `themes.css`.
2. Update the copy in `PALETTE` in `tests/tools/contrast.js` and any value asserted in the theme e2e test.
3. Run `node tests/tools/contrast.js` and `npm run test:unit`; every check must pass. Do not lower thresholds.

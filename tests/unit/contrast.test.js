// Contrast of the viewer palette (WCAG 2.x). One test per check printed by tests/tools/contrast.js:
// text on its backgrounds needs 4.5:1, control borders 3:1. Palette and thresholds live in the tool.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contrastChecks } from '../tools/contrast.js';

const checks = contrastChecks();

describe('palette contrast', () => {
  it('runs the full set of checks (66 per theme, light and dark)', () => {
    assert.equal(checks.length, 132);
    assert.deepEqual([...new Set(checks.map((c) => c.theme))], ['light', 'dark']);
  });
  for (const theme of ['light', 'dark']) {
    describe(theme, () => {
      for (const c of checks.filter((x) => x.theme === theme)) {
        it(`${c.label} is at least ${c.min}:1`, () => {
          assert.ok(c.ratio >= c.min, `${theme} ${c.label}: ${c.ratio.toFixed(2)} (>= ${c.min})`);
        });
      }
    });
  }
});

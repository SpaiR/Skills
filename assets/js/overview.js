// Overview mode and the guide brief: the brief block of the hero, the chapter cards of Overview mode
// and the jumps from them to a chapter (a card in Overview, the chapter itself in Guide).

import { $main, h, icon, pad2, plural } from './dom.js';
import { updateChrome } from './header.js';
import { md } from './markdown.js';
import { overviewMode, secStats, sectionOpen } from './model.js';
import { setMode } from './modes.js';
import { applyCurrent, jumpToSection, scrollToElement } from './nav.js';
import { save } from './persist.js';
import { rerenderSection, secQ, withAnchor } from './rerender.js';
import { L, R, S, secByKey, sections, ui } from './state.js';
import { T, typography, WORDS } from './strings.js';
import { statPair } from './toc.js';

// Display order of the brief groups.
const KINDS = ['change', 'kept', 'risk'];

export const cardQ = (key) => `.ov-sec[data-key="${CSS.escape(key)}"]`;

// The chapter a brief point refers to: guide chapters are numbered from 1, the synthetic "other files" one has no number.
function pointSection(n) {
  const sec = Number.isInteger(n) ? secByKey.get(`s${n}`) : null;
  return sec && !sec.synthetic ? sec : null;
}

// The brief of the guide (guide.brief), grouped by kind. Old guides have none: then there is no block at all.
// Point text is someone else's text: it goes in as a text node.
export function renderBrief() {
  const brief = Array.isArray(R.guide.brief) ? R.guide.brief : [];
  const groups = KINDS.map((kind) => ({
    kind,
    points: brief.filter((p) => p && p.kind === kind && typeof p.text === 'string' && p.text.trim()),
  })).filter((g) => g.points.length);
  if (!groups.length) return null;
  return h(
    'section',
    { class: 'brief', 'aria-label': T.overview.briefAria },
    groups.map((g) =>
      h(
        'div',
        { class: `brief-group is-${g.kind}` },
        h('h2', { class: 'brief-title' }, T.overview.kinds[g.kind]),
        h(
          'ul',
          { class: 'brief-list' },
          g.points.map((p) => {
            const sec = pointSection(p.section);
            return h(
              'li',
              { class: 'brief-item' },
              h('span', { class: 'brief-text' }, typography(p.text.trim())),
              sec &&
                h(
                  'button',
                  {
                    class: 'brief-ch',
                    type: 'button',
                    title: T.overview.chapterLinkTitle(sec.title),
                    dataset: { act: 'brief-sec', key: sec.key },
                  },
                  T.overview.chapterLink(sec.idx + 1),
                ),
            );
          }),
        ),
      ),
    ),
  );
}

// Chapter cards of Overview mode: number, title, the full overview, file count and the way into the guide.
// They are .ov-sec, not .sec: chapter keys and re-rendering do not treat them as chapters; trackCurrent
// only uses them to mark the current chapter in the sidebar.
export function renderOverview() {
  return sections.map((sec) => {
    const st = secStats(sec);
    const titleId = `ov-${sec.key}-title`;
    return h(
      'section',
      { class: 'ov-sec', dataset: { key: sec.key }, 'aria-labelledby': titleId },
      h(
        'div',
        { class: 'ov-head' },
        h('span', { class: 'ov-num' }, sec.synthetic ? '—' : `${pad2(sec.idx + 1)} / ${pad2(sec.total)}`),
        h('h2', { id: titleId }, sec.title),
      ),
      sec.overview && h('div', { class: 'overview md', html: md(sec.overview) }),
      h(
        'div',
        { class: 'ov-foot' },
        h(
          'span',
          { class: 'ov-stats' },
          plural(st.files, WORDS.files),
          st.files > 0 && [' · ', statPair(st.add, st.del)],
        ),
        h(
          'button',
          {
            class: 'btn sm ov-read',
            type: 'button',
            'aria-label': T.overview.readAria(sec.title),
            dataset: { act: 'read-in-guide', key: sec.key },
          },
          T.overview.readInGuide,
          icon('arrow-right'),
        ),
      ),
    );
  });
}

// The card stays current in the sidebar while it is on screen: the last cards cannot reach the top.
export function jumpToCard(key) {
  ui.curSec = key;
  ui.curFile = null;
  ui.pin = { sec: key, path: null };
  applyCurrent(true);
  scrollToElement(() => $main().querySelector(cardQ(key)), L.header + 16);
}

// Guide mode: expand the chapter if collapsed, make it current and scroll to it.
function showChapter(key, focus) {
  const sec = secByKey.get(key);
  if (!sec) return;
  if (!sectionOpen(sec)) {
    S.sectionOpen[key] = true;
    save();
    withAnchor(() => rerenderSection(key));
    updateChrome();
  }
  ui.curSec = key;
  ui.curFile = null;
  ui.pin = { sec: key, path: null };
  applyCurrent(true);
  jumpToSection(key);
  if (focus) {
    const t = $main().querySelector(`${secQ(key)} .sec-toggle`);
    if (t) t.focus({ preventScroll: true });
  }
}

// The chapter link of a brief point: the chapter card in Overview mode, the chapter itself in Guide mode.
export function goToChapter(key, focus) {
  if (!secByKey.has(key)) return;
  if (!overviewMode()) {
    showChapter(key, focus);
    return;
  }
  jumpToCard(key);
  if (focus) {
    const b = $main().querySelector(`${cardQ(key)} .ov-read`);
    if (b) b.focus({ preventScroll: true });
  }
}

// The "read in the guide" button of a card: switch to Guide mode with the chapter expanded and scrolled into
// view. The clicked button is gone after the switch, so focus goes to the chapter header.
export function readInGuide(key) {
  const sec = secByKey.get(key);
  if (!sec) return;
  if (!sectionOpen(sec)) {
    S.sectionOpen[key] = true;
    save();
  }
  // The chapter is the target: the place remembered for Overview is not restored (setMode would reopen
  // and scroll to it first).
  ui.modeReturn = null;
  setMode('guide');
  showChapter(key, true);
}

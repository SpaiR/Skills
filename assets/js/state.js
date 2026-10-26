// All shared mutable state of the viewer. Reassigned bindings are exported as live `let`s and changed only
// through the setters below (importers cannot assign to them); objects with a fixed identity are exported as is.

export let R = null;          // review data from the server
export let S = null;          // user state (persisted to state.json)
export let sections = [];     // guide chapters + the synthetic "other files" chapter
// Files mode: all files in tree order in a single headless group. It is in secByKey but not in sections:
// sections are the guide chapters (viewed marks, chapter comments, feedback).
export let filesGroup = null;
export let treeRoot = null;
export const guideOf = new Map(); // path -> {sec, summary}: the guide chapter of a file
export const fileByPath = new Map();
export const secByKey = new Map();
// Selected lines: {path, sec, side, start, end, anchor: {li, side} | null}. anchor.li is the line index in the file.
export let selection = null;
export let finished = false;
// Page state that is not persisted.
export const ui = {
  mainW: 0, curFile: null, curSec: null, drawer: false, menu: null,
  // The open comment form (one per page): {key, path, sec, side, start, end, editId, sugOpen}.
  // Its text lives in S.drafts[key], so it survives a file re-render.
  form: null,
  secForm: null,       // key of the chapter whose chapter comment editor is open
  drag: null,          // drag across line numbers: {file, sec, fileEl, anchor, extend, range}
  cursor: null,        // change block under the N/P cursor: {path, sec, from, to} (file line indices)
  pin: null,           // current item after J/K/]/[/V: {sec, path}; held until the user scrolls manually
  tocHover: false, heroHidden: false, opener: null,
  filter: '',          // file tree filter text
  visible: null,       // Set of paths that pass the filter and "hide viewed"; null means all are visible
  titleObs: null,
  ready: false,        // the first page render has finished
};
// Read from CSS at startup and on mode change. secHeadGuide is the chapter header height in Guide mode (in Files mode secHead = 0).
export const L = { header: 52, secHead: 48, fileHead: 40, secHeadGuide: 48 };

export function setR(value) { R = value; }
export function setS(value) { S = value; }
export function setSections(value) { sections = value; }
export function setFilesGroup(value) { filesGroup = value; }
export function setTreeRoot(value) { treeRoot = value; }
export function setSelection(value) { selection = value; }
export function setFinished(value) { finished = value; }

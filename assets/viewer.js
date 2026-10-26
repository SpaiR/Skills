/* diff-review viewer: главы гайда, диффы, аннотации к строкам, отправка фидбека. Без зависимостей.
   Чистые функции (разбор патча, внутристрочный дифф, склонения) — в diffcore.js. */
(() => {
  'use strict';

  const D = window.DiffCore;
  const TOKEN = new URLSearchParams(location.search).get('t') || '';
  const BIG_FILE_LINES = 1500;
  const CLOSE_AFTER_S = 3;       // через сколько секунд после отправки закрыть вкладку
  const EXPAND_STEP = 20;       // строк за одно нажатие «↑» / «↓» в промежутке
  const TREE_MIN = 220, TREE_MAX = 480, TREE_DEFAULT = 300; // ширина дерева файлов, px
  const SPLIT_MIN_MAIN = 900;   // уже — «Рядом» не применяется
  const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum|packages\.lock\.json)$/;
  const STATUS = {
    added: ['A', 'новый'], modified: ['M', 'изменён'], deleted: ['D', 'удалён'],
    renamed: ['R', 'переименован'], copied: ['C', 'скопирован'], typechange: ['T', 'тип изменён'],
  };
  const FILES = ['файл', 'файла', 'файлов'];
  const LINES = ['строка', 'строки', 'строк'];

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const narrowScreen = matchMedia('(max-width: 1099.98px)');
  const isMac = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
  const isMod = (e) => (isMac ? e.metaKey : e.ctrlKey);
  const MOD_ENTER = isMac ? '⌘Enter' : 'Ctrl+Enter';
  const NOTES = ['комментарий', 'комментария', 'комментариев'];

  let R = null;          // данные ревью с сервера
  let S = null;          // состояние пользователя (сохраняется в state.json)
  let sections = [];     // главы + «Остальные файлы»
  // Режим «Файлы»: все файлы в порядке дерева в одной безголовой группе. Она есть в secByKey, но не в sections:
  // sections — это главы гайда (отметки, комментарии к главам, фидбек).
  let filesGroup = null;
  let treeRoot = null;
  const guideOf = new Map(); // путь → {sec, summary}: глава гайда файла
  const fileByPath = new Map();
  const secByKey = new Map();
  // Выделенные строки: {path, sec, side, start, end, anchor: {li, side} | null}. anchor.li — индекс строки в файле.
  let selection = null;
  let finished = false;
  // Состояние страницы, которое не сохраняется.
  const ui = {
    mainW: 0, curFile: null, curSec: null, drawer: false, menu: null,
    // Открытая форма комментария (одна на страницу): {key, path, sec, side, start, end, editId, sugOpen}.
    // Текст живёт в S.drafts[key], поэтому переживает перерисовку файла.
    form: null,
    secForm: null,       // ключ главы с открытым комментарием к главе
    drag: null,          // протягивание по номерам: {file, sec, fileEl, anchor, extend, range}
    cursor: null,        // блок изменений под курсором N/P: {path, sec, from, to} (индексы строк файла)
    pin: null,           // текущий элемент после J/K/]/[/V: {sec, path} — держится, пока пользователь не прокрутит сам
    tocHover: false, heroHidden: false, opener: null,
    filter: '',          // текст фильтра дерева
    visible: null,       // Set путей, прошедших фильтр и «Скрыть просмотренные»; null — видны все
    titleObs: null,
    ready: false,        // первый рендер страницы закончен
  };
  // Читаются из CSS при старте и смене режима. secHeadGuide — высота заголовка главы в «Гайде» (в «Файлах» secHead = 0).
  const L = { header: 52, secHead: 48, fileHead: 40, secHeadGuide: 48 };

  // ---------- утилиты ----------

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v; // только для результата md() и inline()
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const basename = (p) => p.split('/').pop();
  const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
  const pad2 = (n) => String(n).padStart(2, '0');
  const plural = (n, forms) => `${n} ${D.plural(n, forms)}`;
  const rangeLabel = (a) => (a.start === a.end ? `строка ${a.start}` : `строки ${a.start}–${a.end}`);
  const sideLabel = (side) => (side === 'new' ? 'новая версия' : 'старая версия');
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const fileDomId = (path) => 'f-' + Array.from(path).map((c) => c.charCodeAt(0).toString(36)).join('');
  const $main = () => document.getElementById('main');

  // Иконки 16×16: статические фигуры, без пользовательских данных.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    chevron: [['path', { d: 'M4 6l4 4 4-4' }]],
    check: [['path', { d: 'M3.5 8.5l3 3 6-7' }]],
    comment: [['path', { d: 'M3 3h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' }]],
    plus: [['path', { d: 'M8 3.5v9M3.5 8h9' }]],
    sidebar: [['rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.5 }], ['path', { d: 'M6.5 3v10' }]],
    more: [['circle', { cx: 3.5, cy: 8, r: 1, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 8, cy: 8, r: 1, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 12.5, cy: 8, r: 1, fill: 'currentColor', stroke: 'none' }]],
    sun: [['circle', { cx: 8, cy: 8, r: 3 }], ['path', { d: 'M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1' }]],
    moon: [['path', { d: 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z' }]],
    'arrow-right': [['path', { d: 'M3 8h10M9 4l4 4-4 4' }]],
    x: [['path', { d: 'M4 4l8 8M12 4l-8 8' }]],
    search: [['circle', { cx: 7, cy: 7, r: 4.5 }], ['path', { d: 'M10.5 10.5L14 14' }]],
    'expand-up': [['path', { d: 'M8 12.5v-9M4.5 7L8 3.5 11.5 7' }]],
    'expand-down': [['path', { d: 'M8 3.5v9M4.5 9L8 12.5 11.5 9' }]],
    'expand-all': [['path', { d: 'M8 1.5v4.5M5.5 4L8 1.5 10.5 4M8 14.5V10M5.5 12L8 14.5 10.5 12M3 8h10' }]],
  };
  function icon(name, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const attrs = { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: `icon${cls ? ' ' + cls : ''}` };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    for (const [tag, a] of ICONS[name]) {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
      svg.append(el);
    }
    return svg;
  }

  async function api(method, path, body, keepalive) {
    const res = await fetch(path, {
      method,
      keepalive: !!keepalive,
      headers: { 'X-Review-Token': TOKEN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  // ---------- мини-Markdown для intent/overview ----------

  // Русская типографика для текста гайда: короткие предлоги и союзы не висят в конце строки,
  // частицы и тире не начинают строку. Только для показа: feedback.md собирается не отсюда.
  function typo(text) {
    return text
      .replace(/(?<=^|[\s(«„"])([А-Яа-яЁё]{1,2}|для|при|без|над|под|про|что|как) /gu, '$1 ')
      .replace(/ (же|ли|бы)(?=[\s.,;:!?)»]|$)/gu, ' $1')
      .replace(/ —/g, ' —');
  }

  function inline(src) {
    return src.split(/(`[^`]+`)/).map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
      return typo(esc(part))
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    }).join('');
  }

  function md(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    const isBlockStart = (l) => /^```/.test(l) || /^>/.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l) || /^#{1,6}\s/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const body = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
        i++;
        out.push(`<pre class="md-code"><code>${esc(body.join('\n'))}</code></pre>`);
      } else if (/^>/.test(line)) {
        const body = [];
        while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
        const m = /^\[!(IMPORTANT|WARNING|NOTE|TIP|CAUTION)\]\s*$/i.exec(body[0] || '');
        if (m) {
          const kind = m[1].toLowerCase();
          const title = { important: 'Важно', warning: 'Внимание', note: 'Заметка', tip: 'Совет', caution: 'Осторожно' }[kind];
          out.push(`<div class="callout callout-${kind}"><div class="callout-title">${title}</div>${md(body.slice(1).join('\n'))}</div>`);
        } else {
          out.push(`<blockquote>${md(body.join('\n'))}</blockquote>`);
        }
      } else if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
        const items = [];
        while (i < lines.length && re.test(lines[i])) {
          let item = lines[i++].replace(re, '');
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i])) item += ' ' + lines[i++].trim();
          items.push(`<li>${inline(item)}</li>`);
        }
        out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      } else if (/^#{1,6}\s/.test(line)) {
        out.push(`<h4>${inline(line.replace(/^#+\s/, ''))}</h4>`);
        i++;
      } else if (!line.trim()) {
        i++;
      } else {
        const para = [];
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++].trim());
        out.push(`<p>${inline(para.join(' '))}</p>`);
      }
    }
    return out.join('');
  }

  // ---------- строки патча ----------

  // Строки диапазона для цитаты: из полного текста, если он загружен, иначе из того, что видно в диффе.
  const quote = (file, side, start, end) => D.quoteLines(file.full && !file.fullBad ? file.full : file.lines, side, start, end);

  const lineAt = (file, side, no) => file.lines.find((l) => (side === 'new' ? l.n : l.o) === no) || null;
  const otherSide = (side) => (side === 'new' ? 'old' : 'new');

  // Пары «Рядом» по ханкам и индекс строки файла → номер пары (это data-i строки в «Рядом»).
  function splitIndex(file) {
    if (!file.split) {
      const pairs = [], at = new Int32Array(file.lines.length);
      for (const hk of file.hunks) {
        hk.pairs = D.splitPairs(hk.lines);
        for (const [l, r] of hk.pairs) {
          if (l) at[l.i] = pairs.length;
          if (r) at[r.i] = pairs.length;
          pairs.push([l, r]);
        }
      }
      file.split = { pairs, at };
    }
    return file.split;
  }

  // Строка таблицы, в которой стоит строка файла li, в текущем виде файла.
  const rowIndex = (file, li) => (fileView(file) === 'split' ? splitIndex(file).at[li] : li);

  // Диапазон от опоры до строки line по правилу 4.4: строки таблицы между ними, сторона опоры,
  // если у неё есть номера в диапазоне, иначе противоположная.
  function rangeOf(file, anchor, line) {
    const split = fileView(file) === 'split';
    const a = rowIndex(file, anchor.li), b = rowIndex(file, line.i);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const rows = split ? splitIndex(file).pairs.slice(lo, hi + 1).flat().filter(Boolean) : file.lines.slice(lo, hi + 1);
    const pick = (s) => rows.map((l) => (s === 'new' ? l.n : l.o)).filter((x) => x != null);
    let side = anchor.side, nos = pick(side);
    if (!nos.length) { side = otherSide(side); nos = pick(side); }
    return { side, start: Math.min(...nos), end: Math.max(...nos) };
  }

  // Блоки изменений файла (подряд идущие add/del внутри ханка) в индексах строк файла.
  function fileBlocks(file) {
    if (!file.blocks) {
      file.blocks = [];
      for (const hk of file.hunks) {
        for (const b of D.changeBlocks(hk.lines)) file.blocks.push({ from: hk.lines[b.from].i, to: hk.lines[b.to].i });
      }
    }
    return file.blocks;
  }

  // Внутристрочный дифф считается один раз на файл: результат одинаков для обоих видов.
  function wordRangesOf(file) {
    if (!file.wd) {
      file.wd = new Array(file.lines.length).fill(null);
      for (const hk of file.hunks) {
        const r = D.intraline(hk.lines);
        hk.lines.forEach((l, k) => { file.wd[l.i] = r[k]; });
      }
    }
    return file.wd;
  }

  // Подсветка синтаксиса (4.8) тоже считается один раз на файл. Пустой массив — у файла подсветки нет.
  function synTokensOf(file) {
    if (!file.syn) file.syn = D.highlightFile(file.hunks, file.path) || [];
    return file.syn;
  }

  // ---------- раскрытие контекста ----------

  // Раскрывать можно, если collect.py собрал полный текст файла и он сошёлся с патчем.
  const canExpand = (file) => file.fullAvail && !file.fullBad && file.newLines != null;
  const expandedOf = (file) => S.expanded[file.path] || (S.expanded[file.path] = { ranges: [], full: false });
  const isWhole = (file) => !!(S.expanded[file.path] && S.expanded[file.path].full);

  function expandReason(file) {
    if (file.fullBad) return 'Файл изменился после сбора диффа — раскрытие недоступно';
    const c = file.content;
    if (!c) return 'Полный текст не собран: ревью создано старой версией скилла';
    return c.reason ? `Полный текст не собран: ${c.reason}` : 'Полный текст недоступен';
  }

  // Полный текст файла (один ханк из full.patch) грузится один раз, при первом раскрытии.
  // Строки исходного патча сверяются с ним: не сошлись — раскрытие у файла выключается.
  const fullLoads = new Map();
  function ensureFull(file) {
    if (file.full) return Promise.resolve(!file.fullBad);
    if (!canExpand(file)) return Promise.resolve(false);
    if (!fullLoads.has(file.path)) {
      fullLoads.set(file.path, fetch(`/api/full?i=${file.idx}`, { headers: { 'X-Review-Token': TOKEN } })
        .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.text(); })
        .then((text) => {
          const hunks = D.parsePatch(text);
          file.full = hunks.length === 1 ? hunks[0].lines : [];
          if (!D.buildView(file.full, file.baseHunks, [], false)) {
            file.fullBad = true;
            toast('Файл изменился после сбора диффа — раскрытие недоступно');
          }
          return !file.fullBad;
        })
        .catch(() => {
          fullLoads.delete(file.path);
          toast('Не удалось загрузить полный текст файла');
          return false;
        }));
    }
    return fullLoads.get(file.path);
  }

  // Ханки по текущему раскрытию. Индексы строк i пересчитываются, кэши файла сбрасываются.
  function applyView(file) {
    const ex = S.expanded[file.path];
    let hunks = file.baseHunks;
    if (file.full && !file.fullBad && ex && (ex.full || ex.ranges.length)) {
      const v = D.buildView(file.full, file.baseHunks, ex.ranges, ex.full);
      if (v) hunks = v.hunks;
      else file.fullBad = true;
    }
    file.hunks = hunks;
    file.lines = hunks.flatMap((hk) => hk.lines);
    file.split = file.blocks = file.wd = file.syn = null;
  }

  const lineKey = (l) => (l.t === 'del' ? `o${l.o}` : `n${l.n}`);

  // Пересобрать вид файла. Курсор N/P и опора выделения держатся за индексы строк: они переносятся
  // по номерам строк (строки изменений видны всегда, так что находятся). keep — строка, которая не сдвигается.
  function reshapeFile(file, keep) {
    if (ui.drag && ui.drag.file === file) cancelDrag();
    const at = (li) => (li != null && file.lines[li] ? lineKey(file.lines[li]) : null);
    const cur = ui.cursor && ui.cursor.path === file.path ? [at(ui.cursor.from), at(ui.cursor.to)] : null;
    const anc = selection && selection.path === file.path && selection.anchor ? at(selection.anchor.li) : null;
    applyView(file);
    const find = (k) => { const i = k ? file.lines.findIndex((l) => lineKey(l) === k) : -1; return i < 0 ? null : i; };
    if (cur) {
      const a = find(cur[0]), b = find(cur[1]);
      ui.cursor = a == null || b == null ? null : { ...ui.cursor, from: a, to: b };
    }
    if (selection && selection.path === file.path && selection.anchor) {
      const a = find(anc);
      selection.anchor = a == null ? null : { ...selection.anchor, li: a };
    }
    withAnchor(() => rerenderFile(file.path), keep);
  }

  function dropEmptyExpanded(file) {
    const ex = S.expanded[file.path];
    if (ex && !ex.full && !ex.ranges.length) delete S.expanded[file.path];
  }

  // Кнопка промежутка: «↑» раскрывает строки над следующим ханком, «↓» — под предыдущим. Строка рядом
  // с кнопкой остаётся на месте экрана, новые строки встают с другой стороны от неё.
  async function expandGap(btn, byKeyboard) {
    const fileEl = btn.closest('.file');
    const file = fileEl && fileByPath.get(fileEl.dataset.path);
    if (!file) return;
    const dir = btn.dataset.dir;
    const gap = { newFrom: +btn.dataset.from, newTo: +btn.dataset.to };
    gap.n = gap.newTo - gap.newFrom + 1;
    const sep = btn.closest('tr');
    const near = (el, step) => { let tr = el && el[step]; while (tr && !tr.matches('tr.ln')) tr = tr[step]; return tr; };
    const below = near(sep, 'nextElementSibling'), above = near(sep, 'previousElementSibling');
    const keep = dir === 'up' ? below || above : above || below;
    const keepKey = keep && keep.dataset.anchor;
    if (!(await ensureFull(file))) { rerenderFile(file.path); return; }
    const ex = expandedOf(file);
    ex.ranges = D.mergeRanges([...ex.ranges, D.expandRange(gap, dir, EXPAND_STEP)]);
    save();
    const again = keepKey && $main().querySelector(`[data-anchor="${CSS.escape(keepKey)}"]`);
    reshapeFile(file, again || null);
    if (byKeyboard) {
      // Фокус — на кнопку того же направления у той же строки, если промежуток ещё остался, иначе на заголовок файла.
      const row = keepKey && $main().querySelector(`[data-anchor="${CSS.escape(keepKey)}"]`);
      const sepNow = row && (dir === 'up' ? row.previousElementSibling : row.nextElementSibling);
      const b = sepNow && sepNow.matches('tr.gap') ? sepNow.querySelector(`.gap-btn[data-dir="${dir}"], .gap-btn[data-dir="all"]`) : null;
      const t = b || $main().querySelector(`${fileQ(fileEl.closest('.sec').dataset.key, file.path)} .file-toggle`);
      if (t) t.focus({ preventScroll: true });
    }
  }

  // «Весь файл»: все промежутки раскрыты. Выключение возвращает раскрытое вручную и строки с комментариями.
  async function setWholeFile(file, on) {
    if (!canExpand(file)) { toast(expandReason(file)); return; }
    if (!(await ensureFull(file))) { rerenderFile(file.path); return; }
    expandedOf(file).full = on;
    dropEmptyExpanded(file);
    save();
    reshapeFile(file, null);
  }

  // Строки формы комментария остаются раскрытыми: иначе после «Весь файл» → выкл. комментарий
  // на раскрытой строке пропал бы со страницы. Номера старой стороны переводятся в новые по полному тексту.
  function pinRange(file, r) {
    if (!file.full || file.fullBad) return;
    let range = null;
    if (r.side === 'new') range = [r.start, r.end];
    else {
      const ns = file.full.filter((l) => l.t === 'ctx' && l.o >= r.start && l.o <= r.end).map((l) => l.n);
      if (ns.length) range = [Math.min(...ns), Math.max(...ns)];
    }
    if (!range) return;
    const ex = expandedOf(file);
    ex.ranges = D.mergeRanges([...ex.ranges, range]);
    dropEmptyExpanded(file);
  }

  // ---------- состояние ----------

  function normalizeState(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    return {
      version: 1,
      reviewed: obj(s.reviewed),
      sectionOpen: obj(s.sectionOpen),
      fileOpen: obj(s.fileOpen),
      annotations: Array.isArray(s.annotations) ? s.annotations : [],
      sectionComments: obj(s.sectionComments),
      globalComment: typeof s.globalComment === 'string' ? s.globalComment : '',
      viewMode: s.viewMode === 'split' ? 'split' : 'unified',
      filesViewed: s.filesViewed && typeof s.filesViewed === 'object' ? s.filesViewed : null, // null — заполнит миграция
      drafts: obj(s.drafts),
      wrap: s.wrap !== false,
      theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'auto',
      tocOpen: typeof s.tocOpen === 'boolean' ? s.tocOpen : null,
      mode: s.mode === 'files' ? 'files' : 'guide',
      treeCollapsed: obj(s.treeCollapsed),
      treeW: Number.isFinite(s.treeW) ? Math.min(TREE_MAX, Math.max(TREE_MIN, s.treeW)) : null,
      hideViewed: !!s.hideViewed,
      // Раскрытый контекст по файлам: {ranges: [[from, to]] в новых номерах строк, full: весь файл}.
      expanded: Object.fromEntries(Object.entries(obj(s.expanded))
        .map(([p, e]) => [p, { ranges: D.mergeRanges(Array.isArray(e && e.ranges) ? e.ranges : []), full: !!(e && e.full) }])
        .filter(([, e]) => e.full || e.ranges.length)),
    };
  }

  // Состояние старой версии: файлы уже отмеченных глав считаются просмотренными.
  function migrateFilesViewed() {
    if (S.filesViewed) return;
    S.filesViewed = {};
    for (const sec of sections) {
      if (!S.reviewed[sec.key]) continue;
      for (const f of secFiles(sec)) S.filesViewed[f.path] = f.hash;
    }
  }

  let saveTimer = null;
  function save() {
    if (finished) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      api('PUT', '/api/state', S).then(hideSaveError, showSaveError);
    }, 400);
  }
  function flushSave() {
    if (finished || !saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    api('PUT', '/api/state', S, true).catch(() => {});
  }
  function showSaveError() {
    const bar = document.getElementById('save-error');
    if (bar) bar.hidden = false;
  }
  function hideSaveError() {
    const bar = document.getElementById('save-error');
    if (bar) bar.hidden = true;
  }

  // ---------- модель ----------

  const secFiles = (sec) => sec.diffs.map((d) => fileByPath.get(d.file)).filter(Boolean);
  const filesMode = () => S.mode === 'files';
  // Группы основной колонки в текущем режиме: главы гайда или одна безголовая группа «Файлы».
  const groups = () => (filesMode() ? [filesGroup] : sections);
  const groupFor = (path) => (filesMode() ? filesGroup : sections.find((s) => s.diffs.some((d) => d.file === path)) || null);
  const isViewed = (file) => !!S.filesViewed && S.filesViewed[file.path] === file.hash;
  const sectionOpen = (sec) => (sec.headless ? true : sec.key in S.sectionOpen ? !!S.sectionOpen[sec.key] : !S.reviewed[sec.key]);
  // Размер исходного диффа: раскрытый контекст не делает файл «большим» и не сворачивает его.
  const lineCount = (file) => file.baseCount;

  function fileOpen(file) {
    if (file.path in S.fileOpen) return !!S.fileOpen[file.path];
    return !collapseReason(file);
  }

  // Причина сворачивания по умолчанию — первое сработавшее условие (3.6).
  function collapseReason(file) {
    if (isViewed(file)) return { text: 'Просмотрен' };
    if (file.binary) return { text: 'Бинарный файл — содержимое не показывается', noShow: true };
    if (file.status === 'deleted') return { text: `Удалён, ${plural(file.deletions, LINES)}` };
    if (LOCKFILE.test(file.path)) return { text: 'Lock-файл — обычно не читают' };
    if (lineCount(file) > BIG_FILE_LINES) return { text: `Большой дифф: ${plural(lineCount(file), LINES)}` };
    return null;
  }

  function secStats(sec) {
    const files = secFiles(sec);
    return {
      files: files.length,
      viewed: files.filter(isViewed).length,
      add: files.reduce((a, f) => a + f.additions, 0),
      del: files.reduce((a, f) => a + f.deletions, 0),
    };
  }

  // Комментарии к главам считаются только у глав из гайда: комментарий к главе, которой больше нет,
  // в Markdown не попадает (buildMarkdown идёт по sections) и на странице не виден.
  function commentCount() {
    return S.annotations.length + secComments().length + (S.globalComment.trim() ? 1 : 0);
  }

  const fileComments = (path) => S.annotations.filter((a) => a.file === path).length;
  const splitAvailable = () => ui.mainW >= SPLIT_MIN_MAIN;
  const fileView = (file) => (S.viewMode === 'split' && splitAvailable() && file.status !== 'added' && file.status !== 'deleted' ? 'split' : 'unified');

  // ---------- «Просмотрено» (4.6) ----------

  // Пересчитать отметки глав, где стоят файлы paths. except — глава, которую отметили вручную.
  function syncSections(paths, except) {
    const changed = [];
    for (const sec of sections) {
      if (sec.key === except || !sec.diffs.some((d) => paths.has(d.file))) continue;
      const files = secFiles(sec);
      const all = files.length > 0 && files.every(isViewed);
      if (all && !S.reviewed[sec.key]) {
        S.reviewed[sec.key] = true;
        delete S.sectionOpen[sec.key];
        changed.push(sec.key);
      } else if (!all && S.reviewed[sec.key]) {
        S.reviewed[sec.key] = false;
        changed.push(sec.key);
      }
    }
    return changed;
  }

  function setFileViewed(file, value, keep) {
    if (value) {
      S.filesViewed[file.path] = file.hash;
      delete S.fileOpen[file.path];
    } else {
      delete S.filesViewed[file.path];
    }
    const changed = syncSections(new Set([file.path]));
    // Отметка закрыла главу (это был её последний файл): на месте остаётся заголовок свёрнутой главы,
    // и текущей становится она, а не файл соседней главы, который поднялся бы под шапку.
    const secEl = keep && keep.closest('.sec');
    const closed = secEl && changed.includes(secEl.dataset.key) && !sectionOpen(secByKey.get(secEl.dataset.key)) ? secEl.dataset.key : null;
    if (closed) {
      keep = secEl.querySelector('.sec-head');
      ui.pin = { sec: closed, path: null };
      ui.curSec = closed;
      ui.curFile = null;
    }
    save();
    withAnchor(() => {
      for (const key of changed) rerenderSection(key);
      rerenderFile(file.path, changed);
    }, keep);
    updateChrome();
    if (closed) applyCurrent(false);
    return closed;
  }

  function setSectionViewed(sec, value, keep) {
    S.reviewed[sec.key] = value;
    delete S.sectionOpen[sec.key];
    const paths = new Set();
    for (const f of secFiles(sec)) {
      paths.add(f.path);
      if (value) { S.filesViewed[f.path] = f.hash; delete S.fileOpen[f.path]; }
      else delete S.filesViewed[f.path];
    }
    const changed = [sec.key, ...syncSections(paths, sec.key)];
    save();
    withAnchor(() => {
      for (const key of changed) rerenderSection(key);
      for (const p of paths) rerenderFile(p, changed);
    }, keep);
    updateChrome();
  }

  // ---------- точечная перерисовка и якорь прокрутки (4.1) ----------

  const stickyOffset = () => L.header + L.secHead + L.fileHead;

  const secQ = (key) => `.sec[data-key="${CSS.escape(key)}"]`;
  const fileQ = (key, path) => `${secQ(key)} .file[data-path="${CSS.escape(path)}"]`;
  // Верх заголовка в потоке: верх карточки плюс её рамка. У закреплённого заголовка rect показывает не это место.
  const headTop = (box) => box.getBoundingClientRect().top + box.clientTop;
  const topOf = (sel) => { const el = $main().querySelector(sel); return el ? headTop(el) : null; };

  // Держит на месте точку опоры, пока fn() перерисовывает узлы. Опоры перебираются по порядку:
  // первая, что нашлась после перерисовки, определяет прокрутку. keep — заголовок, с которым работал
  // пользователь (клик по нему, V, O): он остаётся там, где был, даже если был закреплён. Или строка
  // диффа, по номеру которой кликнули: форма открывается под ней, а форма выше схлопывается в черновик.
  function withAnchor(fn, keep) {
    const anchors = collectAnchors(keep);
    fn();
    for (const a of anchors) {
      const now = a.find();
      if (now == null) continue;
      const delta = now - a.top;
      if (Math.abs(delta) >= 0.5) window.scrollBy({ top: delta, behavior: 'instant' });
      return;
    }
  }

  // Заголовок файла или главы. После перерисовки его место — верх контейнера: в потоке заголовок первый.
  function headAnchor(head, top) {
    const box = head.parentElement;
    const key = head.closest('.sec').dataset.key;
    const sel = box.classList.contains('file') ? fileQ(key, box.dataset.path) : secQ(key);
    return { top: top == null ? headTop(box) : top, find: () => topOf(sel) };
  }

  // Строка диффа или карточка комментария. Если вид сменился, строка ищется по номеру своей стороны.
  function rowAnchor(el) {
    const file = el.closest('.file'), sec = el.closest('.sec');
    const key = el.dataset.anchor;
    const num = el.matches('tr.ln') ? el.querySelector('td.num[data-no]') : null;
    const fsel = file && sec ? fileQ(sec.dataset.key, file.dataset.path) : null;
    return {
      top: el.getBoundingClientRect().top,
      find: () => {
        const same = $main().querySelector(`[data-anchor="${CSS.escape(key)}"]`);
        if (same) return same.getBoundingClientRect().top;
        const f = num && fsel && $main().querySelector(fsel);
        const n = f && f.querySelector(`td.num[data-side="${num.dataset.side}"][data-no="${num.dataset.no}"]`);
        return n ? n.closest('tr').getBoundingClientRect().top : null;
      },
    };
  }

  function collectAnchors(keep) {
    const main = $main();
    const vh = window.innerHeight;
    const out = [];
    if (keep && keep.isConnected) {
      const r = keep.getBoundingClientRect();
      if (keep.matches('tr.ln')) {
        if (r.bottom > L.header && r.top < vh) out.push(rowAnchor(keep));
      // Заголовок, спрятанный под шапкой, не в счёт: пользователь его уже не видит.
      } else if (r.top >= L.header - 1 && r.top < vh) out.push(headAnchor(keep, r.top));
    }
    // Первый элемент под закреплёнными заголовками (по центру #main).
    const y = stickyOffset() + 2;
    if (y >= vh) return out;
    const mr = main.getBoundingClientRect();
    const hit = document.elementFromPoint(mr.left + mr.width / 2, y);
    const el = hit && main.contains(hit) ? hit.closest('[data-anchor]') : null;
    if (el && el.matches('tr.ln, .note, .draft-row, .annot-form')) out.push(rowAnchor(el));
    // Видимые заголовки ниже: если строка под точкой исчезла (свернули главу или файл выше), на месте остаются они.
    for (const head of main.querySelectorAll('.sec-head, .file-head')) {
      const top = head.getBoundingClientRect().top;
      if (top < y - 2) continue;
      if (top >= vh) break;
      out.push(headAnchor(head));
    }
    // Последний вариант — предки: файл, затем глава.
    const file = el && el.closest('.file'), sec = el && el.closest('.sec');
    if (file) out.push(headAnchor(file.querySelector('.file-head')));
    const secHead = sec && sec.querySelector(':scope > .sec-head');
    if (secHead) out.push(headAnchor(secHead));
    return out;
  }

  function rerenderSection(key) {
    const sec = secByKey.get(key);
    const old = $main().querySelector(`.sec[data-key="${CSS.escape(key)}"]`);
    if (!sec || !old) return;
    const card = renderSection(sec);
    keepFocus(old, card, () => old.replaceWith(card));
  }

  // skip — главы, которые уже перерисованы целиком.
  function rerenderFile(path, skip) {
    const file = fileByPath.get(path);
    if (!file) return;
    for (const old of $main().querySelectorAll(`.file[data-path="${CSS.escape(path)}"]`)) {
      const secEl = old.closest('.sec');
      if (skip && skip.includes(secEl.dataset.key)) continue;
      const sec = secByKey.get(secEl.dataset.key);
      const box = renderFile(file, sec);
      keepFocus(old, box, () => old.replaceWith(box));
      if (!FIELD_SIZING) for (const t of box.querySelectorAll('textarea.grow')) fitTextarea(t);
      // Строка файла в списке «Файлы главы» показывает отметку и счётчик комментариев.
      const row = secEl.querySelector(`.aside-files .file-row[data-path="${CSS.escape(path)}"]`);
      if (row) row.replaceWith(fileRow(file, sec, false));
    }
  }

  // Перерисовка не должна выбивать фокус и курсор из поля ввода внутри узла.
  function keepFocus(oldNode, newNode, replace) {
    const active = document.activeElement;
    const inside = active && oldNode.contains(active) && active.dataset.focusKey;
    const sel = inside && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    replace();
    if (!inside) return;
    const again = newNode.querySelector(`[data-focus-key="${CSS.escape(active.dataset.focusKey)}"]`);
    if (!again) return;
    again.focus({ preventScroll: true });
    if (sel) again.setSelectionRange(sel[0], sel[1]);
  }

  // before — смена классов раскладки. Она идёт внутри withAnchor: иначе опора запоминается
  // уже в перестроенной главе (в «Рядом» обзор встаёт над диффами) и место чтения уезжает.
  function rerenderAllFiles(before) {
    withAnchor(() => {
      if (before) before();
      for (const sec of groups()) if (sectionOpen(sec)) rerenderSection(sec.key);
    });
  }

  // ---------- шапка ----------

  function renderHeader() {
    const m = R.meta;
    const ctx = m.worktree ? `${m.repoName} (worktree ${m.worktree})` : `${m.repoName}${m.branch ? ` · ветка ${m.branch}` : ''}`;
    const top = document.getElementById('top');
    top.replaceChildren(
      h('div', { class: 'top-left' },
        h('button', { class: 'icon-btn', id: 'toc-btn', type: 'button', 'aria-label': 'Боковая панель', title: 'Боковая панель (T)', 'aria-keyshortcuts': 'T', 'aria-controls': 'toc', onclick: toggleToc }, icon('sidebar')),
        h('div', { class: 'seg mode-seg', role: 'group', 'aria-label': 'Режим', 'aria-keyshortcuts': 'G' },
          [['guide', 'Гайд'], ['files', 'Файлы']].map(([mode, label]) => h('button', {
            type: 'button', dataset: { mode }, title: `${label} (G)`, onclick: () => setMode(mode),
          }, label))),
        h('span', { class: 'range-label', title: m.label }, m.label),
        h('div', { class: 'top-ctx' },
          h('span', { class: 'ctx-repo', title: m.root }, ctx),
          h('span', { class: 'ctx-title', 'aria-hidden': 'true' }, R.guide.title))),
      h('div', { class: 'top-right' },
        h('div', { class: 'progress', id: 'progress', role: 'status' },
          h('div', { class: 'progress-text' }, h('span', { class: 'progress-num' }), ' ', h('span', { class: 'progress-cap' })),
          h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill' }))),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Вид диффа', 'aria-keyshortcuts': 'S' },
          ['unified', 'split'].map((mode) => h('button', {
            type: 'button', dataset: { mode },
            onclick: () => setViewMode(mode),
          }, mode === 'unified' ? 'Единый' : 'Рядом'))),
        h('button', { class: 'icon-btn', id: 'more-btn', type: 'button', 'aria-label': 'Ещё', title: 'Ещё', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: toggleMenu }, icon('more')),
        h('button', { class: 'btn', id: 'approve-btn', type: 'button', 'aria-label': 'Одобрить', onclick: () => openSubmit('approve') }, icon('check'), h('span', { class: 'btn-text' }, 'Одобрить')),
        h('button', { class: 'btn primary', id: 'submit-btn', type: 'button', 'aria-keyshortcuts': isMac ? 'Meta+Enter' : 'Control+Enter', title: `Отправить фидбек (${MOD_ENTER})`, onclick: () => openSubmit('feedback') },
          'Отправить фидбек', h('span', { class: 'badge', id: 'comment-count' }, '0'))),
      h('div', { id: 'save-error', role: 'alert', hidden: true },
        'Не удалось сохранить прогресс: сервер недоступен. Комментарии на странице пока целы, но отправить их не получится.'),
    );
  }

  function updateHeader() {
    const total = R.files.length;
    const viewed = R.files.filter((f) => isViewed(fileByPath.get(f.path))).length;
    const secDone = sections.filter((s) => S.reviewed[s.key]).length;
    const all = total > 0 && viewed === total;
    const p = document.getElementById('progress');
    p.classList.toggle('done', all);
    p.title = `Просмотрено файлов: ${viewed} из ${total}, глав: ${secDone} из ${sections.length}`;
    p.querySelector('.progress-num').textContent = all ? 'Всё просмотрено' : `${viewed} / ${total}`;
    p.querySelector('.progress-cap').textContent = all ? '' : D.plural(total, FILES);
    p.querySelector('.progress-fill').style.width = `${total ? (100 * viewed) / total : 0}%`;
    for (const b of document.querySelectorAll('#top .mode-seg button')) b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode));
    for (const b of document.querySelectorAll('#top .seg:not(.mode-seg) button')) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === (S.viewMode === 'split' && splitAvailable() ? 'split' : 'unified')));
      if (b.dataset.mode === 'split') {
        b.disabled = !splitAvailable();
        b.title = splitAvailable() ? 'Рядом (S)' : 'Недостаточно ширины';
      } else b.title = 'Единый (S)';
    }
    document.getElementById('comment-count').textContent = String(commentCount());
    document.getElementById('toc-btn').setAttribute('aria-expanded', String(tocVisible()));
  }

  function updateChrome() {
    updateHeader();
    renderToc();
  }

  // ---------- оглавление ----------

  const tocVisible = () => (narrowScreen.matches ? ui.drawer : S.tocOpen !== false);

  function applyTocState() {
    document.body.classList.toggle('toc-hidden', !narrowScreen.matches && S.tocOpen === false);
    document.body.classList.toggle('toc-drawer-open', narrowScreen.matches && ui.drawer);
    const btn = document.getElementById('toc-btn');
    if (btn) btn.setAttribute('aria-expanded', String(tocVisible()));
  }

  function toggleToc() {
    if (narrowScreen.matches) { setDrawer(!ui.drawer); return; }
    S.tocOpen = S.tocOpen === false;
    save();
    applyTocState();
  }

  // Выезжающее оглавление (окно уже 1100px). При открытии фокус встаёт на строку текущей главы,
  // при закрытии возвращается на кнопку «Оглавление», если был внутри панели.
  function setDrawer(open) {
    const toc = document.getElementById('toc');
    const inside = toc.contains(document.activeElement);
    ui.drawer = open;
    applyTocState();
    if (open) {
      const row = filesMode()
        ? toc.querySelector('.tree-row[aria-current]') || toc.querySelector('.tree-row')
        : toc.querySelector('.toc-sec[aria-current] .toc-sec-go') || toc.querySelector('.toc-sec-go');
      if (!row) return;
      row.focus({ preventScroll: true });
      const r = row.getBoundingClientRect(), box = toc.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) toc.scrollTop += r.top - box.top - box.height / 3;
    } else if (inside) {
      document.getElementById('toc-btn').focus({ preventScroll: true });
    }
  }

  // Tab в открытой панели ходит по кругу, Shift+Tab с первой строки — на кнопку «Оглавление»,
  // а Tab с неё — в панель: панель идёт сразу за кнопкой, а не после всей шапки.
  function onDrawerTab(e) {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey || !(narrowScreen.matches && ui.drawer)) return;
    const toc = document.getElementById('toc');
    const items = [...toc.querySelectorAll('button, input, .tree-row[tabindex="0"]')].filter((el) => el.getClientRects().length);
    if (!items.length) return;
    const a = document.activeElement, first = items[0], last = items[items.length - 1];
    const btn = document.getElementById('toc-btn');
    let to = null;
    if (a === btn && !e.shiftKey) to = first;
    else if (a === first && e.shiftKey) to = btn;
    else if (a === last && !e.shiftKey) to = first;
    if (to) { e.preventDefault(); to.focus(); }
  }

  // «+N −M»: нулевая часть серым — красный «−0» у новых файлов ничего не сообщает. У бинарного файла строк нет.
  function statPair(add, del, binary) {
    if (binary) return h('span', { class: 'stat-bin' }, 'бинарный');
    return [
      h('span', { class: add ? 'stat-add' : 'stat-zero' }, `+${add}`), ' ',
      h('span', { class: del ? 'stat-del' : 'stat-zero' }, `−${del}`),
    ];
  }

  function statusBadge(file, small) {
    const [code, word] = STATUS[file.status] || STATUS.modified;
    return h('span', { class: `status st-${file.status}${small ? ' sm' : ''}`, title: word }, code);
  }

  // Строка файла: в оглавлении и в списке «Файлы главы».
  function fileRow(file, sec, inToc) {
    const comments = fileComments(file.path);
    const viewed = isViewed(file);
    const current = ui.curFile && ui.curFile.path === file.path && ui.curFile.sec === sec.key;
    return h('button', {
      class: `file-row${viewed ? ' viewed' : ''}`, type: 'button', title: file.path,
      dataset: { act: 'goto-file', path: file.path, sec: sec.key },
      'aria-current': inToc && current ? 'true' : null,
    },
    statusBadge(file, true),
    h('span', { class: 'fr-name' }, h('span', { class: 'fr-base' }, basename(file.path)), h('span', { class: 'fr-dir' }, dirname(file.path))),
    h('span', { class: 'fr-meta' },
      comments > 0 && h('span', { class: 'fr-comments', title: plural(comments, ['комментарий', 'комментария', 'комментариев']) }, icon('comment'), String(comments)),
      statPair(file.additions, file.deletions, file.binary),
      viewed && h('span', { class: 'fr-check', title: 'Просмотрен' }, icon('check'))));
  }

  function renderToc() {
    if (filesMode()) { renderTree(); return; }
    const toc = document.getElementById('toc');
    const scroll = toc.scrollTop;
    toc.replaceChildren(
      h('div', { class: 'toc-label' }, 'Главы'),
      h('div', { class: 'toc-list' }, sections.map((sec) => {
        const st = secStats(sec);
        const done = !!S.reviewed[sec.key];
        const state = done ? 'full' : st.viewed > 0 ? 'half' : 'empty';
        const current = ui.curSec === sec.key;
        return h('div', { class: `toc-group${done ? ' reviewed' : ''}`, dataset: { key: sec.key } },
          h('div', { class: 'toc-sec', 'aria-current': current ? 'true' : null },
            h('button', {
              class: `toc-status ${state}`, type: 'button', dataset: { act: 'toc-sec-viewed', key: sec.key },
              'aria-label': `Отметить главу «${sec.title}» просмотренной`, 'aria-pressed': String(done),
              title: done ? 'Глава просмотрена' : 'Отметить главу просмотренной',
            }, state === 'full' && icon('check')),
            h('button', { class: 'toc-sec-go', type: 'button', dataset: { act: 'goto-sec', key: sec.key } },
              h('span', { class: 'toc-num' }, sec.synthetic ? '—' : pad2(sec.idx + 1)),
              h('span', { class: 'toc-title' }, sec.title),
              h('span', { class: 'toc-count', title: 'Просмотрено файлов' }, `${st.viewed}/${st.files}`))),
          !done && st.files > 0 && h('div', { class: 'toc-files' }, secFiles(sec).map((f) => fileRow(f, sec, true))));
      })),
      h('button', { class: 'toc-help', type: 'button', dataset: { act: 'help' }, 'aria-keyshortcuts': '?' }, h('kbd', {}, '?'), ' — горячие клавиши'));
    toc.scrollTop = scroll;
  }

  function onTocClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'toc-sec-viewed') {
      const sec = secByKey.get(btn.dataset.key);
      setSectionViewed(sec, !S.reviewed[sec.key]);
      return;
    }
    if (act === 'help') { openHelp(); return; }
    if (act === 'tree-dir') { toggleTreeDir(btn.dataset.dir); return; }
    if (act === 'goto-sec') jumpToSection(btn.dataset.key);
    if (act === 'goto-file') jumpToFile(btn.dataset.path, btn.dataset.sec);
    if (narrowScreen.matches && ui.drawer) {
      setDrawer(false);
      // С клавиатуры фокус идёт туда, куда перешли, а не на кнопку «Оглавление».
      if (e.detail === 0) {
        const q = act === 'goto-file' ? `${fileQ(btn.dataset.sec, btn.dataset.path)} .file-toggle` : `${secQ(btn.dataset.key)} .sec-toggle`;
        const t = $main().querySelector(q);
        if (t) t.focus({ preventScroll: true });
      }
    }
  }

  // ---------- дерево файлов (режим «Файлы») ----------

  // Каталоги раньше файлов, всё по алфавиту с учётом чисел. Каталог без файлов с единственным
  // подкаталогом сливается с ним в одну строку: src/core/.
  function buildTree(paths) {
    const coll = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
    const root = { name: '', path: '', dirs: new Map(), files: [] };
    for (const p of paths) {
      const parts = p.split('/');
      let node = root;
      for (let k = 0; k < parts.length - 1; k++) {
        if (!node.dirs.has(parts[k])) node.dirs.set(parts[k], { name: parts[k], path: parts.slice(0, k + 1).join('/'), dirs: new Map(), files: [] });
        node = node.dirs.get(parts[k]);
      }
      node.files.push(p);
    }
    const finish = (node) => {
      node.dirs = [...node.dirs.values()].map((d) => {
        let dir = finish(d);
        while (!dir.files.length && dir.dirs.length === 1) {
          const only = dir.dirs[0];
          dir = { ...only, name: `${dir.name}/${only.name}` };
        }
        return dir;
      }).sort((a, b) => coll.compare(a.name, b.name));
      node.files.sort((a, b) => coll.compare(basename(a), basename(b)));
      node.all = [...node.dirs.flatMap((d) => d.all), ...node.files];
      return node;
    };
    return finish(root);
  }

  function computeVisible() {
    const terms = ui.filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length && !S.hideViewed) { ui.visible = null; return; }
    ui.visible = new Set(R.files.map((f) => f.path).filter((p) =>
      terms.every((t) => p.toLowerCase().includes(t)) && !(S.hideViewed && isViewed(fileByPath.get(p)))));
  }

  // Фильтр меняет только видимость карточек: перерисовки нет, место чтения держит withAnchor.
  function applyVisible() {
    computeVisible();
    withAnchor(() => {
      for (const el of $main().querySelectorAll('.sec.headless > .file')) el.hidden = !!ui.visible && !ui.visible.has(el.dataset.path);
      const st = $main().querySelector('.sec.headless > .filter-status');
      if (st) st.replaceWith(filterStatus());
    });
    renderTree();
    queueTrack();
  }

  function resetFilter() {
    ui.filter = '';
    S.hideViewed = false;
    save();
    const input = document.getElementById('tree-filter');
    if (input) input.value = '';
    const hide = document.getElementById('tree-hide-viewed');
    if (hide) hide.checked = false;
    applyVisible();
  }

  function treeHead() {
    const input = h('input', {
      id: 'tree-filter', type: 'search', class: 'tree-input', placeholder: 'Фильтр по пути', autocomplete: 'off', spellcheck: 'false',
      'aria-label': 'Фильтр файлов по пути', 'aria-keyshortcuts': '/',
    });
    input.value = ui.filter;
    input.addEventListener('input', () => { ui.filter = input.value; applyVisible(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (input.value) { input.value = ''; ui.filter = ''; applyVisible(); } else input.blur();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const first = document.querySelector('#toc .tree-row');
        if (first) focusTreeRow(first);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const first = document.querySelector('#toc .tree-file');
        if (first) jumpToFile(first.dataset.path, first.dataset.sec);
      }
    });
    const hide = h('input', { id: 'tree-hide-viewed', type: 'checkbox', class: 'check', checked: S.hideViewed });
    hide.addEventListener('change', () => { S.hideViewed = hide.checked; save(); applyVisible(); });
    return h('div', { class: 'tree-head' },
      h('div', { class: 'tree-title' }, h('span', { class: 'toc-label' }, 'Файлы'), h('span', { class: 'tree-progress', title: 'Просмотрено файлов' })),
      h('div', { class: 'tree-filter' }, icon('search'), input),
      h('label', { class: 'tree-opt' }, hide, h('span', {}, 'Скрыть просмотренные')));
  }

  function treeResizer() {
    const bar = h('div', {
      class: 'tree-resize', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Ширина панели файлов',
      'aria-valuemin': String(TREE_MIN), 'aria-valuemax': String(TREE_MAX), 'aria-valuenow': String(S.treeW || TREE_DEFAULT),
      title: 'Потяни, чтобы изменить ширину',
    });
    const set = (w) => {
      S.treeW = Math.round(Math.min(TREE_MAX, Math.max(TREE_MIN, w)));
      bar.setAttribute('aria-valuenow', String(S.treeW));
      applyModeLayout();
    };
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      const left = document.getElementById('toc').getBoundingClientRect().left;
      document.body.classList.add('resizing');
      const move = (ev) => set(ev.clientX - left);
      const up = () => {
        bar.removeEventListener('pointermove', move);
        document.body.classList.remove('resizing');
        save();
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up, { once: true });
      bar.addEventListener('pointercancel', up, { once: true });
    });
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      set((S.treeW || TREE_DEFAULT) + (e.key === 'ArrowRight' ? 16 : -16));
      save();
    });
    return bar;
  }

  function treeDirRow(d, level, open, viewed) {
    const total = d.all.length;
    return h('div', {
      class: `tree-row tree-dir${viewed === total ? ' done' : ''}`, role: 'treeitem', tabindex: '-1',
      'aria-level': String(level), 'aria-expanded': String(open), style: `--lvl: ${level}`, title: d.path,
      dataset: { act: 'tree-dir', dir: d.path, tkey: `d:${d.path}` },
    },
    icon('chevron', 'chev'),
    h('span', { class: 'tree-name' }, `${d.name}/`),
    h('span', { class: 'tree-count', title: 'Просмотрено файлов' }, `${viewed}/${total}`));
  }

  function treeFileRow(file, level) {
    const comments = fileComments(file.path);
    const viewed = isViewed(file);
    const current = ui.curFile && ui.curFile.path === file.path && ui.curFile.sec === filesGroup.key;
    return h('div', {
      class: `tree-row tree-file file-row${viewed ? ' viewed' : ''}`, role: 'treeitem', tabindex: '-1',
      'aria-level': String(level), style: `--lvl: ${level}`, title: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path,
      'aria-current': current ? 'true' : null,
      dataset: { act: 'goto-file', path: file.path, sec: filesGroup.key, tkey: `f:${file.path}` },
    },
    statusBadge(file, true),
    h('span', { class: 'fr-name' }, h('span', { class: 'fr-base' }, basename(file.path))),
    h('span', { class: 'fr-meta' },
      comments > 0 && h('span', { class: 'fr-comments', title: plural(comments, NOTES) }, icon('comment'), String(comments)),
      statPair(file.additions, file.deletions, file.binary),
      viewed && h('span', { class: 'fr-check', title: 'Просмотрен' }, icon('check'))));
  }

  function renderTree() {
    const toc = document.getElementById('toc');
    let list = toc.querySelector(':scope > .tree');
    if (!list) {
      list = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Файлы' });
      list.addEventListener('keydown', onTreeKey);
      toc.replaceChildren(treeHead(), list,
        h('button', { class: 'toc-help', type: 'button', dataset: { act: 'help' }, 'aria-keyshortcuts': '?' }, h('kbd', {}, '?'), ' — горячие клавиши'),
        treeResizer());
    }
    const total = R.files.length;
    const viewedAll = R.files.filter((f) => isViewed(fileByPath.get(f.path))).length;
    toc.querySelector('.tree-progress').textContent = `${viewedAll} / ${total}`;
    const active = document.activeElement;
    const focusKey = active && list.contains(active) ? active.dataset.tkey : null;
    const scroll = toc.scrollTop;
    const filtering = !!ui.visible;
    const rows = [];
    const walk = (node, level) => {
      for (const d of node.dirs) {
        if (filtering && !d.all.some((p) => ui.visible.has(p))) continue;
        const open = filtering || !S.treeCollapsed[d.path];
        rows.push(treeDirRow(d, level, open, d.all.filter((p) => isViewed(fileByPath.get(p))).length));
        if (open) walk(d, level + 1);
      }
      for (const p of node.files) if (!filtering || ui.visible.has(p)) rows.push(treeFileRow(fileByPath.get(p), level));
    };
    walk(treeRoot, 1);
    list.replaceChildren(...(rows.length ? rows : [h('div', { class: 'tree-empty' }, 'Ни один файл не подходит под фильтр')]));
    // Один элемент дерева в порядке Tab (roving tabindex): тот, что был в фокусе, текущий файл или первый.
    const pick = (focusKey && list.querySelector(`[data-tkey="${CSS.escape(focusKey)}"]`))
      || list.querySelector('.tree-row[aria-current]') || list.querySelector('.tree-row');
    if (pick) pick.tabIndex = 0;
    if (focusKey && pick) pick.focus({ preventScroll: true });
    toc.scrollTop = scroll;
  }

  function focusTreeRow(row) {
    for (const r of document.querySelectorAll('#toc .tree-row[tabindex="0"]')) r.tabIndex = -1;
    row.tabIndex = 0;
    row.focus();
  }

  function toggleTreeDir(dir, open) {
    const now = !S.treeCollapsed[dir];
    const want = open == null ? !now : open;
    if (want === now) return;
    if (want) delete S.treeCollapsed[dir];
    else S.treeCollapsed[dir] = true;
    save();
    renderTree();
  }

  // Клавиатура дерева по образцу ARIA tree: стрелки, Home/End, Enter/Space. Буквы уходят глобальным клавишам.
  function onTreeKey(e) {
    const row = e.target.closest('.tree-row');
    if (!row || e.altKey || e.ctrlKey || e.metaKey) return;
    const rows = [...document.querySelectorAll('#toc .tree-row')];
    const i = rows.indexOf(row);
    const isDir = row.classList.contains('tree-dir');
    const open = row.getAttribute('aria-expanded') === 'true';
    const level = +row.getAttribute('aria-level');
    let to = null;
    switch (e.key) {
      case 'ArrowDown': to = rows[i + 1]; break;
      case 'ArrowUp': to = rows[i - 1] || null; if (!to) { e.preventDefault(); document.getElementById('tree-filter').focus(); return; } break;
      case 'Home': to = rows[0]; break;
      case 'End': to = rows[rows.length - 1]; break;
      case 'ArrowRight':
        if (isDir && !open && !ui.visible) { toggleTreeDir(row.dataset.dir, true); break; }
        if (isDir && open) to = rows[i + 1];
        break;
      case 'ArrowLeft':
        if (isDir && open && !ui.visible) { toggleTreeDir(row.dataset.dir, false); break; }
        for (let k = i - 1; k >= 0; k--) if (+rows[k].getAttribute('aria-level') < level) { to = rows[k]; break; }
        break;
      case 'Enter': case ' ':
        row.click();
        break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (to) focusTreeRow(to);
  }

  // ---------- режимы «Гайд» и «Файлы» ----------

  // Класс режима и ширина панели. --sec-head-h: 0 в «Файлах» — закреплённых заголовков глав там нет,
  // и все отступы под шапкой (L.secHead) пересчитываются сами.
  function applyModeLayout() {
    const root = document.documentElement;
    root.classList.toggle('mode-files', filesMode());
    if (filesMode()) root.style.setProperty('--sidebar-w', `${S.treeW || TREE_DEFAULT}px`);
    else root.style.removeProperty('--sidebar-w');
    readLayoutVars();
  }

  function observeTitle() {
    if (ui.titleObs) ui.titleObs.disconnect();
    const title = document.getElementById('review-title');
    if (!title) return;
    ui.titleObs = new IntersectionObserver(([entry]) => {
      if (finished) return;
      ui.heroHidden = !entry.isIntersecting && entry.boundingClientRect.top < L.header;
      document.getElementById('top').classList.toggle('show-title', ui.heroHidden);
    }, { rootMargin: `-${L.header}px 0px 0px 0px` });
    ui.titleObs.observe(title);
  }

  // Переключение режима: текущий файл и строка под закреплёнными заголовками остаются на месте экрана.
  // toPath — файл, к которому перейти (чип главы), вместо текущего по прокрутке.
  function setMode(mode, toPath) {
    if (finished || S.mode === mode) return;
    closeMenu(false);
    if (ui.drag) cancelDrag();
    if (!toPath) trackCurrent();
    const path = toPath || (ui.curFile && ui.curFile.path);
    let ref = null;
    const oldGroup = path && groupFor(path);
    const fileEl = oldGroup && $main().querySelector(fileQ(oldGroup.key, path));
    if (fileEl) {
      // Опора — первая строка, целиком видная в обоих режимах: ниже закреплённых заголовков «Гайда».
      // Иначе туда-обратно опорой каждый раз была бы другая строка, и текст уезжал бы на высоту заголовка главы.
      const y = L.header + L.secHeadGuide + L.fileHead;
      for (const tr of fileEl.querySelectorAll('tr.ln')) {
        const r = tr.getBoundingClientRect();
        if (r.top < y - 0.5) continue;
        const num = r.top < window.innerHeight && tr.querySelector('td.num[data-no]');
        if (num) ref = { side: num.dataset.side, no: num.dataset.no, top: r.top };
        break;
      }
    }
    S.mode = mode;
    save();
    applyModeLayout();
    const key = (p) => { const g = p && groupFor(p); return g ? g.key : null; };
    if (path && key(path)) {
      ui.curFile = { path, sec: key(path) };
      ui.curSec = ui.curFile.sec;
      const sec = secByKey.get(ui.curSec);
      if (!sec.headless && !sectionOpen(sec)) S.sectionOpen[sec.key] = true;
    } else { ui.curFile = null; ui.curSec = null; }
    if (ui.cursor) ui.cursor = { ...ui.cursor, sec: key(ui.cursor.path) };
    if (selection) selection.sec = key(selection.path);
    if (ui.form) ui.form.sec = key(ui.form.path);
    ui.secForm = null;
    ui.pin = ui.curFile ? { sec: ui.curFile.sec, path } : null;
    if (filesMode()) computeVisible();
    document.getElementById('toc').replaceChildren();
    renderMain();
    updateChrome();
    observeTitle();
    if (ui.curFile) {
      const q = fileQ(ui.curFile.sec, path);
      const find = () => {
        const f = $main().querySelector(q);
        const n = f && ref && f.querySelector(`td.num[data-side="${ref.side}"][data-no="${ref.no}"]`);
        return n ? n.closest('tr') : f;
      };
      const el = find();
      scrollToElement(find, el && el.matches('tr') ? Math.max(ref.top, stickyOffset()) : L.header + L.secHead, true);
    } else window.scrollTo({ top: 0, behavior: 'instant' });
    applyCurrent(true);
  }

  // Z / Shift+Z: свернуть или развернуть все файлы видимых групп.
  function setAllFilesOpen(open) {
    const files = groups().filter(sectionOpen).flatMap(secFiles)
      .filter((f) => !f.binary && !(ui.visible && filesMode() && !ui.visible.has(f.path)));
    if (!files.length) return;
    for (const f of files) S.fileOpen[f.path] = open;
    save();
    rerenderAllFiles();
    updateChrome();
    toast(open ? 'Все файлы развёрнуты' : 'Все файлы свёрнуты');
  }

  // ---------- переходы ----------

  const scrollBehavior = () => (reducedMotion.matches ? 'instant' : 'smooth');

  // Прокрутка к элементу с поправкой: размеры ещё не отрисованных блоков (content-visibility) оцениваются
  // и уточняются по мере прокрутки, поэтому после неё позиция проверяется, пока не простоит три кадра.
  let jumpSeq = 0;
  function scrollToElement(getEl, offset, instant) {
    const seq = ++jumpSeq;
    const behavior = instant ? 'instant' : scrollBehavior();
    const target = () => {
      const el = getEl();
      if (!el) return null;
      const y = (el.matches('.sec, .file') ? headTop(el) : el.getBoundingClientRect().top) + window.scrollY - offset;
      return Math.max(0, Math.min(y, document.documentElement.scrollHeight - window.innerHeight));
    };
    const y = target();
    if (y == null) return;
    // Далёкий переход: плавная анимация через десятки экранов идёт секунды. Переносимся почти к цели
    // мгновенно и доезжаем плавно последние полэкрана — направление движения остаётся видно.
    const far = window.innerHeight * 2;
    if (behavior === 'smooth' && Math.abs(y - window.scrollY) > far) {
      window.scrollTo({ top: y - Math.sign(y - window.scrollY) * window.innerHeight / 2, behavior: 'instant' });
    }
    window.scrollTo({ top: target(), behavior });
    let tries = 0, stable = 0;
    const fix = () => {
      if (seq !== jumpSeq) return;
      const y2 = target();
      if (y2 == null) return;
      if (Math.abs(y2 - window.scrollY) > 0.5) {
        if (tries++ > 10) return;
        stable = 0;
        window.scrollTo({ top: y2, behavior: 'instant' });
      } else if (++stable >= 3) return;
      requestAnimationFrame(fix);
    };
    if (behavior === 'instant') requestAnimationFrame(fix);
    else waitScrollEnd(fix);
  }

  function waitScrollEnd(fn) {
    let done = false, timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('scrollend', finish);
      window.removeEventListener('scroll', onScroll);
      fn();
    };
    const onScroll = () => { clearTimeout(timer); timer = setTimeout(finish, 150); };
    window.addEventListener('scrollend', finish, { once: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    timer = setTimeout(finish, 150);
  }

  function jumpToSection(key) {
    scrollToElement(() => $main().querySelector(`.sec[data-key="${CSS.escape(key)}"]`), L.header);
  }

  function jumpToFile(path, key) {
    const sec = secByKey.get(key);
    // В «Файлах» клик по файлу в дереве раскрывает свёрнутый файл, как в GitHub.
    const file = fileByPath.get(path);
    if (sec && sec.headless && file && !file.binary && !fileOpen(file)) {
      S.fileOpen[path] = true;
      save();
      withAnchor(() => rerenderFile(path));
    }
    if (sec && !sectionOpen(sec)) {
      S.sectionOpen[key] = true;
      save();
      withAnchor(() => rerenderSection(key));
      updateChrome();
    }
    ui.curFile = { path, sec: key };
    // Файл остаётся текущим, пока он на экране: у конца страницы прокрутка не доводит его до верха.
    ui.pin = { sec: key, path };
    scrollToElement(() => $main().querySelector(`.sec[data-key="${CSS.escape(key)}"] .file[data-path="${CSS.escape(path)}"]`), L.header + L.secHead);
  }

  // ---------- текущая глава и файл (4.2) ----------

  let trackQueued = false;
  function queueTrack() {
    if (trackQueued) return;
    trackQueued = true;
    requestAnimationFrame(() => { trackQueued = false; trackCurrent(); });
  }

  function trackCurrent() {
    if (finished) return;
    const main = $main();
    const line = L.header + L.secHead;
    let cur = null, firstVisible = null;
    for (const f of main.querySelectorAll('.file')) {
      const r = f.getBoundingClientRect();
      if (r.top <= line + 1 && r.bottom > line + L.fileHead) cur = f;
      if (!firstVisible && r.top > line && r.top < window.innerHeight) firstVisible = f;
      if (r.top > window.innerHeight) break;
    }
    cur = cur || firstVisible;
    let secEl = cur && cur.closest('.sec');
    if (!secEl) {
      const secs = [...main.querySelectorAll('.sec')];
      secEl = secs.filter((s) => s.getBoundingClientRect().top <= L.header + 1).pop() || secs[0] || null;
    }
    let fileKey = cur ? { path: cur.dataset.path, sec: secEl.dataset.key } : null;
    let secKey = secEl ? secEl.dataset.key : null;
    // После J/K/]/[/V текущим остаётся выбранный элемент, пока он на экране: у конца страницы
    // заголовок не доезжает до закреплённой позиции, и расчёт по прокрутке выбрал бы соседний.
    if (ui.pin) {
      const el = main.querySelector(ui.pin.path ? fileQ(ui.pin.sec, ui.pin.path) : secQ(ui.pin.sec));
      const r = el && el.getBoundingClientRect();
      if (r && r.bottom > L.header && r.top < window.innerHeight) {
        secKey = ui.pin.sec;
        if (ui.pin.path) fileKey = { path: ui.pin.path, sec: ui.pin.sec };
        else if (fileKey && fileKey.sec !== secKey) fileKey = null;
      } else ui.pin = null;
    }
    const same = ui.curSec === secKey && (ui.curFile && fileKey ? ui.curFile.path === fileKey.path && ui.curFile.sec === fileKey.sec : ui.curFile === fileKey);
    ui.curFile = fileKey;
    ui.curSec = secKey;
    applyCurrent(!same);
  }

  function applyCurrent(scrollToc) {
    const main = $main(), toc = document.getElementById('toc');
    for (const el of main.querySelectorAll('.is-current')) el.classList.remove('is-current');
    for (const el of toc.querySelectorAll('[aria-current]')) el.removeAttribute('aria-current');
    if (ui.curSec) {
      const secEl = main.querySelector(`.sec[data-key="${CSS.escape(ui.curSec)}"]`);
      const secHead = secEl && secEl.querySelector(':scope > .sec-head');
      if (secHead) secHead.classList.add('is-current');
      const row = toc.querySelector(`.toc-group[data-key="${CSS.escape(ui.curSec)}"] .toc-sec`);
      if (row) row.setAttribute('aria-current', 'true');
    }
    let tocRow = null;
    if (ui.curFile) {
      const q = `.sec[data-key="${CSS.escape(ui.curFile.sec)}"] .file[data-path="${CSS.escape(ui.curFile.path)}"] > .file-head`;
      const head = main.querySelector(q);
      if (head) head.classList.add('is-current');
      tocRow = toc.querySelector(`.file-row[data-sec="${CSS.escape(ui.curFile.sec)}"][data-path="${CSS.escape(ui.curFile.path)}"]`);
      if (tocRow) tocRow.setAttribute('aria-current', 'true');
    }
    if (scrollToc && !ui.tocHover) {
      const target = tocRow || toc.querySelector('.toc-sec[aria-current]');
      if (target && toc.scrollHeight > toc.clientHeight) target.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---------- основная колонка ----------

  // В режиме «Файлы» — без intent: там читают код, а не историю изменения.
  function renderHero() {
    const g = R.guide, m = R.meta, t = m.totals;
    const compact = filesMode();
    const commits = m.commits || [];
    const meta = [
      m.label,
      m.branch && `ветка ${m.branch}`,
      m.worktree ? `${m.repoName} (worktree ${m.worktree})` : m.repoName,
      plural(t.files, FILES),
      statPair(t.additions, t.deletions),
      commits.length > 0 && plural(commits.length, ['коммит', 'коммита', 'коммитов']),
      g.generator && g.generator.model && `гайд: ${g.generator.model}`,
    ].filter(Boolean);
    return h('header', { class: 'hero' },
      h('h1', { id: 'review-title' }, g.title),
      !compact && g.intent && h('div', { class: 'intent md', html: md(g.intent) }),
      h('div', { class: 'hero-meta' }, meta.flatMap((part, i) => (i ? [h('span', { class: 'sep' }, ' · '), part] : [part]))),
      (m.notes || []).map((note) => h('div', { class: 'callout callout-note' }, note)),
      commits.length > 0 && h('details', { class: 'commits' },
        h('summary', {}, h('span', { class: 'marker', 'aria-hidden': 'true' }, '›'), `Коммиты · ${commits.length}`),
        h('ul', {}, commits.map((c) => {
          const sp = c.indexOf(' ');
          return h('li', {}, h('code', { class: 'hash' }, sp > 0 ? c.slice(0, sp) : c), h('span', {}, sp > 0 ? c.slice(sp + 1) : ''));
        }))),
      m.untrackedIncluded > 0 && h('p', { class: 'hero-untracked' }, `Включены неотслеживаемые файлы: ${m.untrackedIncluded}`));
  }

  function renderMain() {
    $main().replaceChildren(renderHero(), ...groups().map(renderSection));
  }

  // Безголовая группа режима «Файлы»: только строка фильтра и карточки файлов.
  function renderFilesGroup(sec) {
    return h('section', { class: 'sec headless', id: sec.key, dataset: { key: sec.key }, 'aria-label': 'Файлы' },
      filterStatus(),
      secFiles(sec).map((f) => renderFile(f, sec)));
  }

  function filterStatus() {
    const total = R.files.length, shown = ui.visible ? ui.visible.size : total;
    return h('div', { class: 'filter-status', hidden: !ui.visible, role: 'status' },
      h('span', {}, `Показано ${shown} из ${plural(total, FILES)}`),
      h('button', { class: 'btn sm ghost', type: 'button', dataset: { act: 'filter-reset' } }, 'Сбросить фильтр'));
  }

  function renderSection(sec) {
    if (sec.headless) return renderFilesGroup(sec);
    const open = sectionOpen(sec);
    const done = !!S.reviewed[sec.key];
    const st = secStats(sec);
    const current = ui.curSec === sec.key;
    const summary = open || !done
      ? [plural(st.files, FILES), st.files > 0 && [' · ', statPair(st.add, st.del)]]
      : [plural(st.files, FILES), ' · просмотрено'];
    const head = h('div', { class: `sec-head${current ? ' is-current' : ''}`, dataset: { anchor: `s:${sec.key}` } },
      h('button', {
        class: 'sec-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': `${sec.key}-body`, 'aria-keyshortcuts': 'Shift+O',
        dataset: { act: 'toggle-sec' },
      },
      h('span', { class: 'sec-num' }, sec.synthetic ? '—' : `${pad2(sec.idx + 1)} / ${pad2(sec.total)}`),
      h('h2', {}, sec.title),
      icon('chevron', 'chev')),
      h('span', { class: 'sec-sum' }, summary),
      h('label', { class: 'viewed-toggle' },
        h('input', { type: 'checkbox', class: 'check', checked: done, dataset: { act: 'sec-viewed' }, 'aria-label': `Просмотрено: глава «${sec.title}»`, 'aria-keyshortcuts': 'Shift+V' }),
        h('span', {}, 'Просмотрено')));

    const card = h('section', {
      class: `sec${open ? '' : ' collapsed'}${done ? ' reviewed' : ''}`, id: sec.key,
      dataset: { key: sec.key }, 'aria-labelledby': null,
    }, head);
    if (!open) return card;

    const files = secFiles(sec);
    const aside = h('div', { class: 'sec-aside' },
      h('div', { class: 'aside-in' },
        sec.overview && h('div', { class: 'overview md', html: md(sec.overview) }),
        renderSectionComment(sec),
        files.length > 0 && h('div', { class: 'aside-files' },
          h('div', { class: 'aside-label' }, 'Файлы главы'),
          files.map((f) => fileRow(f, sec, false)))));
    const filesBox = h('div', { class: 'sec-files' });
    if (!files.length) {
      filesBox.append(h('div', { class: 'sec-empty' }, 'Файлов этой главы нет в текущем диффе. Гайд мог устареть.'));
    } else {
      for (const f of files) filesBox.append(renderFile(f, sec));
    }
    if (!done) {
      const last = sec.idx === sections.length - 1;
      filesBox.append(h('div', { class: 'sec-foot' },
        h('button', { class: 'btn', type: 'button', dataset: { act: 'sec-done' } },
          last ? 'Глава просмотрена' : 'Глава просмотрена — к следующей', !last && icon('arrow-right'))));
    }
    card.append(h('div', { class: 'sec-body', id: `${sec.key}-body` }, aside, filesBox));
    return card;
  }

  // Комментарий к главе (3.10): текст пишется прямо в S.sectionComments, черновика у него нет.
  function renderSectionComment(sec) {
    const value = S.sectionComments[sec.key] || '';
    const wrap = h('div', { class: 'sec-comment', dataset: { key: sec.key } });
    if (ui.secForm === sec.key) {
      wrap.append(sectionCommentEditor(sec));
    } else if (!value.trim()) {
      wrap.append(h('button', { class: 'btn sm ghost add-sec-comment', type: 'button', dataset: { act: 'sec-comment-edit' }, 'aria-keyshortcuts': 'Shift+C' },
        icon('plus'), 'Комментарий к главе'));
    } else {
      wrap.append(h('div', { class: 'note', dataset: { anchor: `sc:${sec.key}` } },
        h('div', { class: 'note-head' }, h('span', { class: 'note-title' }, 'Комментарий к главе')),
        h('div', { class: 'note-text' }, value.trim()),
        h('div', { class: 'note-foot' },
          h('button', { class: 'btn sm ghost', type: 'button', dataset: { act: 'sec-comment-edit' }, 'aria-keyshortcuts': 'Shift+C' }, 'Изменить'),
          h('button', { class: 'btn sm ghost danger', type: 'button', dataset: { act: 'sec-comment-delete' } }, 'Удалить'))));
    }
    return wrap;
  }

  function sectionCommentEditor(sec) {
    const ta = h('textarea', {
      class: 'grow', rows: 3, placeholder: 'Что думаешь о главе целиком', 'aria-label': `Комментарий к главе «${sec.title}»`,
      'data-focus-key': `sec-comment:${sec.key}`,
    });
    ta.value = S.sectionComments[sec.key] || '';
    ta.addEventListener('input', () => {
      if (ta.value.trim()) S.sectionComments[sec.key] = ta.value;
      else delete S.sectionComments[sec.key];
      fitTextarea(ta);
      save();
      updateHeader();
    });
    ta.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSectionComment();
      }
    });
    return h('div', { class: 'editor sec-editor' },
      h('div', { class: 'editor-head' }, h('span', { class: 'editor-title' }, 'Комментарий к главе')),
      ta,
      h('div', { class: 'editor-actions' },
        h('button', { class: 'btn sm primary', type: 'button', dataset: { act: 'sec-comment-done' } }, 'Готово'),
        h('span', { class: 'hint' }, `${MOD_ENTER} или Esc — готово`)));
  }

  function openSectionComment(key) {
    const sec = secByKey.get(key);
    if (!sec || finished) return;
    if (ui.form) closeForm(false);
    if (!sectionOpen(sec)) S.sectionOpen[key] = true;
    ui.secForm = key;
    withAnchor(() => rerenderSection(key));
    updateChrome();
    const ta = $main().querySelector(`${secQ(key)} .sec-comment textarea`);
    if (!ta) return;
    fitTextarea(ta);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
    revealEditor(ta.closest('.editor'));
  }

  function closeSectionComment() {
    const key = ui.secForm;
    if (!key) return;
    ui.secForm = null;
    const v = (S.sectionComments[key] || '').trim();
    if (v) S.sectionComments[key] = v; else delete S.sectionComments[key];
    save();
    const hadFocus = document.activeElement && document.activeElement.closest('.sec-comment');
    withAnchor(() => rerenderSection(key));
    updateChrome();
    if (hadFocus) {
      const btn = $main().querySelector(`${secQ(key)} .sec-comment button`);
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  function deleteSectionComment(key) {
    const before = S.sectionComments[key];
    delete S.sectionComments[key];
    save();
    withAnchor(() => rerenderSection(key));
    updateChrome();
    toast('Комментарий к главе удалён', {
      label: 'Вернуть', run: () => {
        S.sectionComments[key] = before;
        save();
        withAnchor(() => rerenderSection(key));
        updateChrome();
      },
    });
  }

  // ---------- файл ----------

  function renderPath(file) {
    const parts = [];
    if (file.oldPath) parts.push(h('span', { class: 'p-old' }, h('span', { class: 'p-old-dir' }, dirname(file.oldPath)), h('span', { class: 'p-old-name' }, basename(file.oldPath))), h('span', { class: 'p-arrow' }, '→'));
    parts.push(h('span', { class: 'p-dir' }, dirname(file.path)), h('span', { class: 'p-name' }, basename(file.path)));
    return h('span', { class: 'path' }, parts);
  }

  // «Весь файл» — у изменённых файлов с ханками. У добавленных и удалённых весь файл уже в диффе.
  function wholeButton(file) {
    if (file.binary || !file.baseHunks.length || file.status === 'added' || file.status === 'deleted') return null;
    const ok = canExpand(file), on = ok && isWhole(file);
    return h('button', {
      class: 'btn sm ghost whole-btn', type: 'button', dataset: { act: 'whole-file' },
      'aria-pressed': String(on), 'aria-keyshortcuts': 'E', disabled: !ok,
      title: ok ? (on ? 'Показать только изменения и раскрытое (E)' : 'Показать весь файл (E)') : expandReason(file),
    }, icon('expand-all'), h('span', { class: 'whole-text' }, 'Весь файл'));
  }

  function renderFile(file, sec) {
    const open = fileOpen(file);
    const viewed = isViewed(file);
    const g = sec && sec.headless ? guideOf.get(file.path) : null;
    const d = sec && !sec.headless && sec.diffs.find((x) => x.file === file.path);
    const summary = g ? g.summary : d && d.summary;
    const count = fileComments(file.path);
    const current = ui.curFile && ui.curFile.path === file.path && sec && ui.curFile.sec === sec.key;
    const head = h('div', { class: `file-head${current ? ' is-current' : ''}`, dataset: { anchor: `fh:${sec ? sec.key : ''}:${file.path}` } },
      // Заголовок третьего уровня: переход по заголовкам скринридера доходит до файлов.
      h('div', { class: 'file-h', role: 'heading', 'aria-level': '3' },
        h('button', { class: 'file-toggle', type: 'button', 'aria-expanded': String(open), 'aria-keyshortcuts': 'O', dataset: { act: 'toggle-file' }, title: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path },
          icon('chevron', 'chev'), statusBadge(file), renderPath(file))),
      count > 0 && h('button', { class: 'badge comments', type: 'button', dataset: { act: 'first-note' }, title: plural(count, NOTES) }, icon('comment'), String(count)),
      open && wholeButton(file),
      h('span', { class: 'file-stat' }, statPair(file.additions, file.deletions, file.binary)),
      h('label', { class: 'viewed' },
        h('input', { type: 'checkbox', class: 'check', checked: viewed, dataset: { act: 'file-viewed' }, 'aria-label': `Просмотрено: ${file.path}`, 'aria-keyshortcuts': 'V' }),
        h('span', { class: 'viewed-text' }, 'Просмотрено')));

    const box = h('div', {
      class: `file${viewed ? ' is-viewed' : ''}${open ? '' : ' collapsed'}`, id: fileDomId(file.path),
      dataset: { path: file.path, anchor: `f:${sec ? sec.key : ''}:${file.path}` },
      hidden: !!(sec && sec.headless && ui.visible && !ui.visible.has(file.path)),
    }, head);
    // В режиме «Файлы» у файла из главы — её номер и название: переход к файлу в гайде.
    if (g && g.sec) {
      box.append(h('div', { class: 'file-summary with-chip' },
        h('button', { class: 'sec-chip', type: 'button', dataset: { act: 'to-guide' }, title: 'Открыть этот файл в гайде' },
          g.sec.synthetic ? g.sec.title : `Глава ${g.sec.idx + 1} · ${g.sec.title}`),
        summary && h('span', { html: inline(summary) })));
    } else if (summary) box.append(h('div', { class: 'file-summary', html: inline(summary) }));
    if (!open) {
      const reason = collapseReason(file);
      if (reason) {
        box.append(h('div', { class: 'collapsed-note' }, h('span', {}, reason.text),
          !reason.noShow && h('button', { class: 'btn sm ghost', type: 'button', dataset: { act: 'show-file' } }, 'Показать')));
      }
      return box;
    }
    if (file.binary) box.append(h('div', { class: 'file-empty' }, 'Бинарный файл — содержимое не показывается'));
    else if (!file.hunks.length) box.append(h('div', { class: 'file-empty' }, 'Содержимое не менялось (переименование или смена прав).'));
    else box.append(renderDiff(file, sec));
    return box;
  }

  // ---------- дифф ----------

  // Быстрые конструкторы ячеек: на больших файлах тысячи строк.
  function td(cls, text) {
    const c = document.createElement('td');
    c.className = cls;
    if (text) c.textContent = text;
    return c;
  }

  // Кнопка «+» у номера строки (3.7). Без tabindex: с клавиатуры комментарий открывает C.
  function cmtBtn(no) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cmt-btn';
    b.tabIndex = -1;
    b.setAttribute('aria-label', `Комментарий к строке ${no}`);
    return b;
  }

  // btn — эта сторона комментируемая: у add и ctx новая, у del старая.
  function numTd(side, no, t, extra, marks, btn) {
    let cls = `num ${side} l-${t}${extra || ''}`;
    if (no != null && marks) {
      if (marks.note[side].has(no)) cls += ' has-note';
      if (marks.draft[side].has(no)) cls += ' has-draft';
    }
    const c = td(cls, no == null ? '' : String(no));
    c.dataset.side = side;
    if (no != null) {
      c.dataset.no = String(no);
      if (btn) c.append(cmtBtn(no));
    }
    return c;
  }

  const SIGN = { add: '+', del: '−', ctx: ' ' };

  function codeTd(file, l, wd, extra) {
    const c = td(`code l-${l.t}${extra || ''}`);
    const segs = D.segments(l.s, wd[l.i], synTokensOf(file)[l.i]);
    for (const s of segs) {
      if (!s.w && !s.cls) { c.append(s.text); continue; }
      const sp = document.createElement('span');
      sp.className = [s.w && 'w', s.cls].filter(Boolean).join(' ');
      sp.textContent = s.text;
      c.append(sp);
    }
    if (l.nonl) {
      c.append(h('span', { class: 'nonl', title: 'Нет перевода строки в конце файла' }, '⏎̸'));
    }
    return c;
  }

  // Разделитель промежутка с кнопками раскрытия. hk — ханк после промежутка (null — хвост файла).
  function gapRow(gap, hk, cols) {
    const btn = (dir, label, ic) => h('button', {
      class: 'gap-btn', type: 'button', title: label, 'aria-label': label,
      dataset: { act: 'gap', dir, from: String(gap.newFrom), to: String(gap.newTo) },
    }, icon(ic));
    const tail = !hk, head = gap.newFrom === 1;
    const lines = (n) => plural(n, ['строку', 'строки', 'строк']);
    const btns = gap.n <= EXPAND_STEP
      ? [btn('all', `Показать ${lines(gap.n)}`, 'expand-all')]
      : [
        !head && btn('down', `Показать ${EXPAND_STEP} строк ниже`, 'expand-down'),
        !tail && btn('up', `Показать ${EXPAND_STEP} строк выше`, 'expand-up'),
      ];
    const cell = td('hunk-cell');
    cell.colSpan = cols;
    const inner = h('div', { class: 'hunk-in' },
      h('span', { class: 'gap-btns' }, btns),
      h('span', { class: 'hunk-skip' }, tail
        ? `⋯ ${plural(gap.n, ['строка', 'строки', 'строк'])} до конца файла`
        : `⋯ ${plural(gap.n, ['строка без изменений', 'строки без изменений', 'строк без изменений'])}`));
    if (hk) {
      const range = /^@@ [^@]*@@/.exec(hk.header);
      inner.append(h('span', { class: 'hunk-range' }, range ? range[0].replace(/^@@ -/, '@@ −') : hk.header));
      if (hk.fn) inner.append(h('span', { class: 'hunk-fn' }, hk.fn));
    }
    cell.append(inner);
    const tr = document.createElement('tr');
    tr.className = 'hunk gap';
    tr.append(cell);
    return tr;
  }

  function hunkRow(hk, cols) {
    const cell = td('hunk-cell');
    cell.colSpan = cols;
    const inner = h('div', { class: 'hunk-in' });
    if (hk.skip) {
      inner.append(h('span', { class: 'hunk-skip' }, hk.skip.first
        ? (hk.skip.n === 1 ? '⋯ строка 1 не показана' : `⋯ строки 1–${hk.skip.to} не показаны`)
        : `⋯ ${plural(hk.skip.n, ['строка без изменений', 'строки без изменений', 'строк без изменений'])}`));
    }
    const range = /^@@ [^@]*@@/.exec(hk.header);
    inner.append(h('span', { class: 'hunk-range' }, range ? range[0].replace(/^@@ -/, '@@ −') : hk.header));
    if (hk.fn) inner.append(h('span', { class: 'hunk-fn' }, hk.fn));
    cell.append(inner);
    const tr = document.createElement('tr');
    tr.className = 'hunk';
    tr.append(cell);
    return tr;
  }

  function numDigits(file) {
    let max = file.newLines || 0;
    for (const l of file.lines) max = Math.max(max, l.o || 0, l.n || 0);
    return Math.max(3, String(max).length);
  }

  const formIn = (path, secKey) => (ui.form && ui.form.path === path && ui.form.sec === secKey ? ui.form : null);

  // Метки комментариев и черновиков на номерах и то, что встаёт под строкой end своей стороны:
  // карточки, строки черновиков и открытая форма. Ключ — "side:no".
  function fileMarks(file, secKey) {
    const after = new Map();
    const note = { old: new Set(), new: new Set() }, draft = { old: new Set(), new: new Set() };
    const push = (k, item) => { const list = after.get(k); if (list) list.push(item); else after.set(k, [item]); };
    const markRange = (set, r) => { if (set) for (let n = r.start; n <= r.end; n++) set.add(n); };
    for (const a of S.annotations) {
      if (a.file !== file.path) continue;
      markRange(note[a.side], a);
      push(`${a.side}:${a.end}`, { kind: 'note', a });
    }
    const form = formIn(file.path, secKey);
    for (const [key, d] of Object.entries(S.drafts)) {
      if (!d || d.file !== file.path || d.editingId || (form && form.key === key)) continue;
      markRange(draft[d.side], d);
      push(`${d.side}:${d.end}`, { kind: 'draft', key, d });
    }
    if (form && !form.editId) push(`${form.side}:${form.end}`, { kind: 'form' });
    return { after, note, draft };
  }

  function renderDiff(file, sec) {
    const view = fileView(file);
    const wd = wordRangesOf(file);
    const secKey = sec ? sec.key : '';
    const marks = fileMarks(file, secKey);
    const cur = ui.cursor && ui.cursor.path === file.path && ui.cursor.sec === secKey ? ui.cursor : null;
    const inCur = (l) => !!(cur && l && l.i >= cur.from && l.i <= cur.to);
    const onlyNew = file.status === 'added', onlyOld = file.status === 'deleted';
    const table = document.createElement('table');
    table.className = `diff ${view}${view === 'unified' && onlyNew ? ' only-new' : ''}${view === 'unified' && onlyOld ? ' only-old' : ''}`;
    table.style.setProperty('--num-ch', String(numDigits(file)));
    table.setAttribute('aria-label', `Дифф ${file.path}`);
    const colgroup = document.createElement('colgroup');
    const col = (cls) => { const c = document.createElement('col'); if (cls) c.className = cls; colgroup.append(c); };
    const tbody = document.createElement('tbody');
    const pathKey = `${secKey}:${file.path}`;
    // Промежутки по номерам строк. Без полного текста — старые заголовки ханков без кнопок.
    const gaps = canExpand(file) ? new Map(D.gapsOf(file.hunks, file.newLines).map((g) => [g.at, g])) : null;
    const sepRow = (k, cols) => {
      const hk = file.hunks[k];
      if (!gaps) return hk ? hunkRow(hk, cols) : null;
      const gap = gaps.get(k);
      return gap ? gapRow(gap, hk || null, cols) : hk ? hunkRow(hk, cols) : null;
    };
    let rows = 0;

    if (view === 'unified') {
      if (!onlyNew) col('c-num');
      if (!onlyOld) col('c-num');
      col('c-sign');
      col('c-code');
      const cols = colgroup.children.length;
      for (const [k, hk] of file.hunks.entries()) {
        tbody.append(sepRow(k, cols));
        rows += 1.4;
        for (const l of hk.lines) {
          const tr = document.createElement('tr');
          tr.className = inCur(l) ? 'ln cursor' : 'ln';
          tr.dataset.t = l.t;
          tr.dataset.i = String(l.i);
          tr.dataset.anchor = `r:${pathKey}:${lineKey(l)}`;
          if (!onlyNew) tr.append(numTd('old', l.o, l.t, '', marks, l.t === 'del'));
          if (!onlyOld) tr.append(numTd('new', l.n, l.t, '', marks, l.t !== 'del'));
          tr.append(td(`sign l-${l.t}`, SIGN[l.t]), codeTd(file, l, wd));
          tbody.append(tr);
          rows++;
          const keys = l.t === 'ctx' ? [['new', l.n], ['old', l.o]] : l.t === 'add' ? [['new', l.n]] : [['old', l.o]];
          for (const extra of trailing(file, sec, marks, keys, cols)) tbody.append(extra);
        }
      }
      const tail = sepRow(file.hunks.length, cols);
      if (tail) { tbody.append(tail); rows += 1.4; }
    } else {
      col('c-num'); col('c-sign'); col('c-code'); col('c-num'); col('c-sign'); col('c-code');
      splitIndex(file);
      let k = 0;
      for (const [hi, hk] of file.hunks.entries()) {
        tbody.append(sepRow(hi, 6));
        rows += 1.4;
        for (const [left, right] of hk.pairs) {
          const tr = document.createElement('tr');
          tr.className = inCur(left) || inCur(right) ? 'ln cursor' : 'ln';
          tr.dataset.i = String(k);
          tr.dataset.anchor = `p:${pathKey}:${lineKey(right || left)}`;
          k++;
          for (const [side, l] of [['old', left], ['new', right]]) {
            if (!l) {
              const half = side === 'new' ? ' half-new' : '';
              tr.append(numTd(side, null, 'none', ` filler${half}`), td('sign filler'), td('code filler'));
              continue;
            }
            const t = side === 'old' ? (l.t === 'del' ? 'del' : 'ctx') : (l.t === 'add' ? 'add' : 'ctx');
            const btn = side === 'old' ? l.t === 'del' : true;
            tr.append(numTd(side, side === 'old' ? l.o : l.n, t, side === 'new' ? ' half-new' : '', marks, btn), td(`sign l-${t}`, SIGN[t]), codeTd(file, l, wd));
          }
          tbody.append(tr);
          rows++;
          for (const extra of trailing(file, sec, marks, [['old', left && left.o], ['new', right && right.n]], 6)) tbody.append(extra);
        }
      }
      const tail = sepRow(file.hunks.length, 6);
      if (tail) { tbody.append(tail); rows += 1.4; }
    }
    const sel = selection && selection.path === file.path && selection.sec === secKey ? selection : null;
    if (sel) paintSelection(tbody, sel, view === 'split');
    table.append(colgroup, tbody);
    const wrap = h('div', { class: 'diff-wrap' }, table);
    wrap.style.containIntrinsicSize = `auto ${Math.round(rows * 20)}px`;
    if (ui.ready) markFresh(wrap);
    return wrap;
  }

  // Перерисованный дифф первые кадры рендерится целиком (content-visibility: visible). Оценка высоты
  // не знает о переносе строк, карточках и форме, и файл вне экрана получил бы реальную высоту уже после
  // того, как withAnchor выставил прокрутку: место чтения уехало бы. Пока дифф виден целиком, его размер
  // точный и запоминается браузером (contain-intrinsic-size: auto), так что возврат к auto ничего не сдвигает.
  let freshQueued = false;
  function markFresh(wrap) {
    wrap.classList.add('cv-fresh');
    if (freshQueued) return;
    freshQueued = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      freshQueued = false;
      for (const el of document.querySelectorAll('.diff-wrap.cv-fresh')) el.classList.remove('cv-fresh');
    }));
  }

  // Выделенные строки: оверлей на коде и подсветка номеров выбранной стороны. В «Рядом» — только своя половина.
  function paintSelection(root, sel, split) {
    for (const el of root.querySelectorAll('.sel')) el.classList.remove('sel');
    if (!sel) return;
    for (const num of root.querySelectorAll(`td.num[data-side="${sel.side}"][data-no]`)) {
      const no = +num.dataset.no;
      if (no < sel.start || no > sel.end) continue;
      num.classList.add('sel');
      num.parentElement.classList.add('sel');
      if (split) {
        num.nextElementSibling.classList.add('sel');
        num.nextElementSibling.nextElementSibling.classList.add('sel');
      }
    }
  }

  // ---------- комментарии к строкам (3.9–3.11, 4.4, 4.5) ----------

  const draftKey = (path, side, start, end) => `${path}|${side}|${start}|${end}`;
  const editKey = (id) => `edit|${id}`;
  const FIELD_SIZING = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content');

  // Высота поля по тексту: от 3 строк до 50vh. Где есть field-sizing, это делает CSS.
  function fitTextarea(ta) {
    if (FIELD_SIZING || !ta.isConnected) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight + 2, window.innerHeight * 0.5)}px`;
  }

  // Строки, которые встают под строкой таблицы: карточки, черновики, форма.
  function trailing(file, sec, marks, keys, cols) {
    const rows = [];
    for (const [side, no] of keys) {
      if (no == null) continue;
      const list = marks.after.get(`${side}:${no}`);
      if (!list) continue;
      for (const it of list) {
        if (it.kind === 'note') rows.push(...noteRows(file, sec, it.a, cols));
        else if (it.kind === 'draft') rows.push(annotRow(cols, it.d.side, draftCard(it.key, it.d)));
        else rows.push(annotRow(cols, ui.form.side, editorCard(file, null)));
      }
    }
    return rows;
  }

  function annotRow(cols, side, card) {
    const cell = td('annot-cell');
    cell.colSpan = cols;
    cell.append(h('div', { class: `annot-in side-${side}` }, card));
    const tr = document.createElement('tr');
    tr.className = 'annot-row';
    tr.append(cell);
    return tr;
  }

  function noteRows(file, sec, a, cols) {
    const form = formIn(file.path, sec ? sec.key : '');
    if (form && form.editId === a.id) return [annotRow(cols, a.side, editorCard(file, a))];
    const out = [annotRow(cols, a.side, noteCard(file, a))];
    const dk = editKey(a.id);
    if (S.drafts[dk]) out.push(annotRow(cols, a.side, draftCard(dk, S.drafts[dk])));
    return out;
  }

  function noteCard(file, a) {
    return h('div', { class: 'note', dataset: { anchor: `n:${a.id}`, id: a.id } },
      h('div', { class: 'note-head' },
        h('span', { class: 'note-title' }, `${cap(rangeLabel(a))} · ${sideLabel(a.side)}`),
        h('span', { class: 'note-actions' },
          h('button', { class: 'btn sm ghost', type: 'button', dataset: { act: 'note-edit', id: a.id } }, 'Изменить'),
          h('button', { class: 'btn sm ghost danger', type: 'button', dataset: { act: 'note-delete', id: a.id } }, 'Удалить'))),
      a.text && h('div', { class: 'note-text' }, a.text),
      a.suggestion && suggestionBox(file, a));
  }

  // Мини-дифф правки: исходные строки диапазона со знаком −, затем предложенные со знаком +.
  function suggestionBox(file, a) {
    const line = (t, sign, text) => h('div', { class: `sg-line sg-${t}` }, h('span', { class: 'sg-sign' }, sign), h('span', { class: 'sg-code' }, text));
    return h('div', { class: 'suggestion' },
      h('div', { class: 'suggestion-head' }, 'Предложенная правка'),
      h('div', { class: 'sg-body' },
        quote(file, a.side, a.start, a.end).map((l) => line('del', '−', l.s)),
        a.suggestion.split('\n').map((s) => line('add', '+', s))));
  }

  function draftCard(key, d) {
    const text = String(d.text || '').replace(/\s+/g, ' ').trim() || (d.suggestion ? 'предложенная правка' : '');
    const short = text.length > 80 ? `${text.slice(0, 80).trimEnd()}…` : text;
    return h('div', { class: 'draft-row', dataset: { anchor: `d:${key}`, key } },
      h('span', { class: 'draft-text', title: text },
        h('span', { class: 'draft-label' }, d.editingId ? 'Черновик правки:' : 'Черновик:'), ' ',
        h('span', { class: 'draft-q' }, '«'), h('span', { class: 'draft-quote' }, short), h('span', { class: 'draft-q' }, '»')),
      h('span', { class: 'draft-actions' },
        h('button', { class: 'btn sm ghost', type: 'button', dataset: { act: 'draft-continue', key } }, 'Продолжить'),
        h('button', { class: 'btn sm ghost danger', type: 'button', dataset: { act: 'draft-delete', key } }, 'Удалить')));
  }

  // Черновик формы: пишется на каждый ввод. Пустой новый комментарий и неизменённая правка черновика не дают.
  function writeDraft(f, text, suggestion, existing) {
    const unchanged = existing
      ? text === existing.text && suggestion === (existing.suggestion || '')
      : !text.trim() && !suggestion.trim();
    if (unchanged) delete S.drafts[f.key];
    else {
      S.drafts[f.key] = { file: f.path, side: f.side, start: f.start, end: f.end, text, suggestion };
      if (existing) S.drafts[f.key].editingId = existing.id;
    }
  }

  // Tab в поле правки вставляет два пробела, Shift+Tab убирает отступ у строк выделения.
  function indentText(ta, outdent) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    if (!outdent && s === e) { ta.setRangeText('  ', s, e, 'end'); return; }
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e);
    if (le < 0) le = v.length;
    const lines = v.slice(ls, le).split('\n');
    let first = 0, total = 0;
    const out = lines.map((l, k) => {
      if (!outdent) return `  ${l}`;
      const n = (/^ {1,2}|^\t/.exec(l) || [''])[0].length;
      if (k === 0) first = n;
      total += n;
      return l.slice(n);
    });
    ta.setRangeText(out.join('\n'), ls, le, 'preserve');
    if (outdent) ta.setSelectionRange(Math.max(ls, s - first), Math.max(ls, e - total));
    else ta.setSelectionRange(s + 2, e + 2 * lines.length);
  }

  // Форма комментария (3.10). existing — редактируемая аннотация.
  function editorCard(file, existing) {
    const f = ui.form;
    const d = S.drafts[f.key];
    const ta = h('textarea', { class: 'grow', rows: 3, placeholder: 'Вопрос, замечание или просьба', 'aria-label': 'Текст комментария', 'data-focus-key': 'form-text' });
    ta.value = d ? d.text : existing ? existing.text : '';
    const sg = h('textarea', { class: 'grow mono', rows: 3, spellcheck: 'false', placeholder: 'Код, которым заменить выделенные строки', 'aria-label': 'Предложенная правка', 'data-focus-key': 'form-sug' });
    sg.value = d ? d.suggestion || '' : existing ? existing.suggestion || '' : '';
    const sugBox = h('div', { class: 'sug-box', hidden: !f.sugOpen },
      h('div', { class: 'sug-head' },
        h('span', { class: 'sug-label' }, 'Предложенная правка'),
        // Tab здесь вставляет отступ: выйти из поля клавиатурой можно только так.
        h('span', { class: 'hint' }, `Tab — отступ · Esc — закрыть форму · ${MOD_ENTER} — сохранить`)),
      sg);
    const sugToggle = h('button', { class: 'btn sm ghost sug-toggle', type: 'button', hidden: f.sugOpen }, '± Предложить правку');
    const saveBtn = h('button', { class: 'btn sm primary', type: 'button', 'aria-keyshortcuts': isMac ? 'Meta+Enter' : 'Control+Enter' }, 'Сохранить');
    const closeBtn = h('button', { class: 'btn sm', type: 'button' }, 'Закрыть');
    const discard = h('button', { class: 'btn sm ghost danger', type: 'button' }, 'Удалить черновик');
    const refresh = () => {
      saveBtn.disabled = !ta.value.trim() && !(f.sugOpen && sg.value.trim());
      discard.classList.toggle('is-off', !S.drafts[f.key]);
    };
    const sync = () => {
      writeDraft(f, ta.value, f.sugOpen ? sg.value : '', existing);
      refresh();
      save();
    };
    const commit = () => {
      const text = ta.value.trim();
      const suggestion = f.sugOpen ? sg.value.replace(/\s+$/, '') : '';
      if (!text && !suggestion) return;
      if (existing) Object.assign(existing, { text, suggestion });
      else S.annotations.push({ id: uid(), file: f.path, side: f.side, start: f.start, end: f.end, text, suggestion });
      delete S.drafts[f.key];
      save();
      closeForm(true);
    };
    sugToggle.addEventListener('click', () => {
      f.sugOpen = true;
      sugBox.hidden = false;
      sugToggle.hidden = true;
      if (!sg.value) sg.value = quote(file, f.side, f.start, f.end).map((l) => l.s).join('\n');
      sync();
      fitTextarea(sg);
      sg.focus({ preventScroll: true });
      // Форма выросла: её нижний ряд с «Сохранить» мог уйти за край окна.
      revealEditor(sg.closest('.editor'));
    });
    saveBtn.addEventListener('click', commit);
    closeBtn.addEventListener('click', () => closeForm(true));
    discard.addEventListener('click', () => deleteDraft(f.key));
    for (const t of [ta, sg]) {
      t.addEventListener('input', () => { fitTextarea(t); sync(); });
      t.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        if (e.key === 'Enter' && isMod(e)) { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeForm(true); }
        else if (t === sg && e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); indentText(sg, e.shiftKey); sync(); }
      });
    }
    refresh();
    return h('div', { class: 'editor annot-form', dataset: { anchor: 'form' } },
      h('div', { class: 'editor-head' },
        h('span', { class: 'editor-title' }, `${cap(rangeLabel(f))} · ${sideLabel(f.side)}`),
        !existing && h('span', { class: 'hint' }, 'Shift+клик — расширить диапазон')),
      ta, sugToggle, sugBox,
      h('div', { class: 'editor-actions' }, saveBtn, closeBtn, discard,
        // Короткий вариант — когда длинный не помещается в ряд с кнопками (container query в CSS).
        h('span', { class: 'hint save-hint', title: 'Esc закрывает форму, текст остаётся черновиком' },
          h('span', { class: 'hint-long' }, `${MOD_ENTER} — сохранить · Esc — закрыть, черновик останется`),
          h('span', { class: 'hint-short' }, `${MOD_ENTER} — сохранить · Esc — закрыть`))));
  }

  // Перерисовать файлы, где были или появились форма и выделение.
  function refreshFiles(paths, keep) {
    const set = new Set(paths.filter(Boolean));
    withAnchor(() => { for (const p of set) rerenderFile(p); }, keep);
    updateChrome();
  }

  // Форма в поле зрения: под закреплёнными заголовками и не ниже окна.
  function revealEditor(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const top = (el.closest('.sec-aside') ? L.header + L.secHead : stickyOffset()) + 8;
    const r = el.getBoundingClientRect();
    if (r.top < top) window.scrollBy({ top: r.top - top, behavior: 'instant' });
  }

  function focusForm() {
    const ta = $main().querySelector('.annot-form textarea');
    if (!ta) return;
    fitTextarea(ta);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
    revealEditor(ta.closest('.editor'));
  }

  // Форма нового комментария на диапазоне. extend — расширен диапазон той же формы: черновик переезжает с ней.
  // row — строка таблицы, с которой работал пользователь: она остаётся на месте экрана.
  function openLineForm(file, secKey, range, anchor, extend, row) {
    if (finished) return;
    const prev = ui.form, prevSel = selection;
    if (ui.secForm) closeSectionComment();
    const key = draftKey(file.path, range.side, range.start, range.end);
    let sugOpen = false;
    if (extend && prev && !prev.editId && prev.path === file.path) {
      sugOpen = prev.sugOpen;
      if (prev.key !== key && S.drafts[prev.key]) {
        S.drafts[key] = { ...S.drafts[prev.key], side: range.side, start: range.start, end: range.end };
        delete S.drafts[prev.key];
        save();
      }
    }
    const d = S.drafts[key];
    pinRange(file, range);
    selection = { path: file.path, sec: secKey, ...range, anchor };
    ui.form = { key, path: file.path, sec: secKey, ...range, editId: null, sugOpen: sugOpen || !!(d && d.suggestion) };
    refreshFiles([prev && prev.path, prevSel && prevSel.path, file.path], row);
    focusForm();
  }

  function openEditForm(a, secKey) {
    if (finished) return;
    const prev = ui.form, prevSel = selection;
    if (ui.secForm) closeSectionComment();
    const key = editKey(a.id), d = S.drafts[key];
    ui.form = { key, path: a.file, sec: secKey, side: a.side, start: a.start, end: a.end, editId: a.id, sugOpen: !!(d ? d.suggestion : a.suggestion) };
    selection = { path: a.file, sec: secKey, side: a.side, start: a.start, end: a.end, anchor: null };
    refreshFiles([prev && prev.path, prevSel && prevSel.path, a.file]);
    focusForm();
  }

  // Закрыть форму: текст остаётся черновиком. focusBack — вернуть фокус из формы на заголовок файла.
  function closeForm(focusBack) {
    const f = ui.form, sel = selection;
    if (!f && !sel) return;
    const active = document.activeElement;
    const hadFocus = focusBack && active && active.closest && active.closest('.annot-form');
    ui.form = null;
    selection = null;
    refreshFiles([f && f.path, sel && sel.path]);
    if (hadFocus && f) {
      const t = $main().querySelector(`${fileQ(f.sec, f.path)} .file-toggle`);
      if (t) t.focus({ preventScroll: true });
    }
  }

  // Строка диффа, под которой стоит элемент (карточка, черновик): по ней держится прокрутка.
  function lineRowBefore(el) {
    let tr = el && el.closest('tr');
    while (tr && !tr.matches('tr.ln')) tr = tr.previousElementSibling;
    return tr || null;
  }

  function continueDraft(key, secKey, row) {
    const d = S.drafts[key];
    if (!d) return;
    if (d.editingId) {
      const a = S.annotations.find((x) => x.id === d.editingId);
      if (a) openEditForm(a, secKey);
      return;
    }
    const file = fileByPath.get(d.file);
    if (!file) return;
    const l = lineAt(file, d.side, d.start);
    openLineForm(file, secKey, { side: d.side, start: d.start, end: d.end }, l ? { li: l.i, side: d.side } : null, false, row);
  }

  function deleteDraft(key) {
    const d = S.drafts[key];
    delete S.drafts[key];
    save();
    if (ui.form && ui.form.key === key) closeForm(true);
    else if (d) refreshFiles([d.file]);
  }

  function deleteNote(id) {
    const idx = S.annotations.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const a = S.annotations[idx];
    const dk = editKey(id), d = S.drafts[dk];
    S.annotations.splice(idx, 1);
    delete S.drafts[dk];
    if (ui.form && ui.form.editId === id) { ui.form = null; selection = null; }
    save();
    refreshFiles([a.file]);
    toast('Комментарий удалён', {
      label: 'Вернуть', run: () => {
        if (S.annotations.some((x) => x.id === id)) return;
        S.annotations.splice(Math.min(idx, S.annotations.length), 0, a);
        if (d && !S.drafts[dk]) S.drafts[dk] = d;
        save();
        refreshFiles([a.file]);
      },
    });
  }

  // ---------- выделение мышью: клик, Shift+клик, протягивание (4.3, 4.4) ----------

  function numLine(num) {
    const fileEl = num.closest('.file'), secEl = num.closest('.sec');
    const file = fileEl && fileByPath.get(fileEl.dataset.path);
    const line = file && lineAt(file, num.dataset.side, +num.dataset.no);
    return line ? { file, fileEl, sec: secEl.dataset.key, line } : null;
  }

  function onMainMouseDown(e) {
    const num = e.button === 0 && !finished ? e.target.closest('td.num[data-no]') : null;
    if (!num) return;
    // Без выделения текста страницы и без потери фокуса.
    e.preventDefault();
    const hit = numLine(num);
    if (!hit) return;
    const { file, fileEl, sec, line } = hit;
    // У строки контекста комментарий всегда к новой версии, по какой бы цифре ни кликнули.
    const side = line.t === 'ctx' ? 'new' : num.dataset.side;
    const extend = e.shiftKey && selection && selection.anchor && selection.path === file.path && selection.sec === sec
      && !(ui.form && ui.form.editId);
    const anchor = extend ? selection.anchor : { li: line.i, side };
    ui.drag = { file, sec, fileEl, anchor, extend, range: rangeOf(file, anchor, line), row: num.closest('tr') };
    document.body.classList.add('dragging');
    paintSelection(fileEl, { side: ui.drag.range.side, start: ui.drag.range.start, end: ui.drag.range.end }, fileView(file) === 'split');
    document.addEventListener('mouseup', onDragEnd, { once: true });
  }

  function onMainMouseOver(e) {
    const g = ui.drag;
    if (!g) return;
    const num = e.target.closest('td.num[data-no]');
    if (!num || !g.fileEl.contains(num)) return;
    const hit = numLine(num);
    if (!hit) return;
    const r = rangeOf(g.file, g.anchor, hit.line);
    g.row = num.closest('tr');
    if (r.side === g.range.side && r.start === g.range.start && r.end === g.range.end) return;
    g.range = r;
    paintSelection(g.fileEl, r, fileView(g.file) === 'split');
  }

  function onDragEnd() {
    const g = ui.drag;
    ui.drag = null;
    document.body.classList.remove('dragging');
    if (g && g.fileEl.isConnected) openLineForm(g.file, g.sec, g.range, g.anchor, g.extend, g.row);
  }

  function cancelDrag() {
    const g = ui.drag;
    ui.drag = null;
    document.body.classList.remove('dragging');
    document.removeEventListener('mouseup', onDragEnd);
    if (g) refreshFiles([g.file.path]);
  }

  // ---------- тосты (3.16) ----------

  let toastTimer = null, toastLife = 0;
  function toast(text, action) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.replaceChildren(h('span', { class: 'toast-text' }, text));
    if (action) el.append(h('button', { class: 'toast-btn', type: 'button', onclick: () => { hideToast(); action.run(); } }, action.label));
    el.classList.add('show');
    toastLife = action ? 6000 : 4000;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, toastLife);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    const el = document.getElementById('toast');
    if (el) el.classList.remove('show');
  }

  // ---------- делегирование событий в #main ----------

  function onMainClick(e) {
    if (finished) return;
    const num = e.target.closest('td.num[data-no]');
    if (num) {
      // Мышь обрабатывают mousedown/mouseup; сюда доходит только активация кнопки «+» без мыши.
      if (e.detail !== 0) return;
      const hit = numLine(num);
      if (!hit) return;
      const side = hit.line.t === 'ctx' ? 'new' : num.dataset.side;
      const anchor = { li: hit.line.i, side };
      openLineForm(hit.file, hit.sec, rangeOf(hit.file, anchor, hit.line), anchor, false, num.closest('tr'));
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'INPUT') return;
    const act = btn.dataset.act;
    const secEl = btn.closest('.sec');
    const sec = secEl && secByKey.get(secEl.dataset.key);
    const fileEl = btn.closest('.file');
    const file = fileEl && fileByPath.get(fileEl.dataset.path);
    if (act === 'toggle-sec') {
      toggleSection(sec, btn.closest('.sec-head'));
      const again = $main().querySelector(`${secQ(sec.key)} .sec-toggle`);
      if (again && e.detail === 0) again.focus({ preventScroll: true });
    } else if (act === 'toggle-file' || act === 'show-file') {
      toggleFile(file, sec, act === 'show-file' ? true : !fileOpen(file));
      const again = $main().querySelector(`${fileQ(sec.key, file.path)} .file-toggle`);
      if (again && (e.detail === 0 || act === 'toggle-file')) again.focus({ preventScroll: true });
    } else if (act === 'to-guide') {
      setMode('guide', file.path);
    } else if (act === 'filter-reset') {
      resetFilter();
    } else if (act === 'gap') {
      expandGap(btn, e.detail === 0);
    } else if (act === 'whole-file') {
      setWholeFile(file, !isWhole(file));
    } else if (act === 'goto-file') {
      jumpToFile(btn.dataset.path, btn.dataset.sec);
    } else if (act === 'sec-done') {
      const next = sections[sec.idx + 1];
      setSectionViewed(sec, true);
      if (next) jumpToSection(next.key);
    } else if (act === 'first-note') {
      const first = S.annotations.filter((a) => a.file === file.path).sort((a, b) => a.start - b.start)[0];
      if (first) goToNote(first.id, sec.key);
    } else if (act === 'note-edit') {
      const a = S.annotations.find((x) => x.id === btn.dataset.id);
      if (a) openEditForm(a, sec.key);
    } else if (act === 'note-delete') {
      deleteNote(btn.dataset.id);
    } else if (act === 'draft-continue') {
      continueDraft(btn.dataset.key, sec.key, lineRowBefore(btn));
    } else if (act === 'draft-delete') {
      deleteDraft(btn.dataset.key);
    } else if (act === 'sec-comment-edit') {
      openSectionComment(sec.key);
    } else if (act === 'sec-comment-done') {
      closeSectionComment();
    } else if (act === 'sec-comment-delete') {
      deleteSectionComment(sec.key);
    }
  }

  function toggleSection(sec, keep) {
    S.sectionOpen[sec.key] = !sectionOpen(sec);
    save();
    withAnchor(() => rerenderSection(sec.key), keep);
    updateChrome();
  }

  function toggleFile(file, sec, open) {
    S.fileOpen[file.path] = open;
    save();
    const head = $main().querySelector(`${fileQ(sec.key, file.path)} > .file-head`);
    withAnchor(() => rerenderFile(file.path), head);
    updateChrome();
  }

  // Раскрыть главу и файл, если свёрнуты, и прокрутить к карточке комментария с подсветкой.
  function goToNote(id, secKey) {
    const a = S.annotations.find((x) => x.id === id);
    const file = a && fileByPath.get(a.file);
    if (!file) return;
    const sec = groups().includes(secByKey.get(secKey)) ? secByKey.get(secKey) : groupFor(a.file);
    if (!sec) return;
    revealFile(file, sec);
    const q = `${fileQ(sec.key, file.path)} .note[data-id="${CSS.escape(id)}"]`;
    const note = $main().querySelector(q);
    if (!note) return;
    scrollToElement(() => $main().querySelector(q), stickyOffset() + 16);
    flash(note);
  }

  // Раскрыть главу и файл, чтобы до строк можно было дойти.
  function revealFile(file, sec) {
    if (sec.headless && ui.visible && !ui.visible.has(file.path)) resetFilter();
    const changed = [];
    if (!sectionOpen(sec)) { S.sectionOpen[sec.key] = true; changed.push('sec'); }
    if (!fileOpen(file)) { S.fileOpen[file.path] = true; changed.push('file'); }
    if (!changed.length) return;
    save();
    withAnchor(() => {
      if (changed.includes('sec')) rerenderSection(sec.key);
      else rerenderFile(file.path);
    });
    updateChrome();
  }

  function flash(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  function onMainChange(e) {
    const input = e.target;
    if (!input.matches('input[data-act]')) return;
    const secEl = input.closest('.sec');
    const sec = secEl && secByKey.get(secEl.dataset.key);
    if (input.dataset.act === 'sec-viewed') setSectionViewed(sec, input.checked, input.closest('.sec-head'));
    if (input.dataset.act === 'file-viewed') {
      const path = input.closest('.file').dataset.path;
      const closed = setFileViewed(fileByPath.get(path), input.checked, input.closest('.file-head'));
      // Глава закрылась вместе с файлом — фокус на её заголовке, иначе на том же чекбоксе.
      const again = closed
        ? $main().querySelector(`${secQ(closed)} .sec-toggle`)
        : $main().querySelector(`${fileQ(sec.key, path)} input[data-act="file-viewed"]`);
      if (again && document.activeElement === document.body) again.focus({ preventScroll: true });
    }
  }

  // ---------- вид, перенос, тема ----------

  function setViewMode(mode) {
    if (mode === 'split' && !splitAvailable()) return;
    if (S.viewMode === mode) return;
    S.viewMode = mode;
    save();
    rerenderAllFiles(() => document.body.classList.toggle('view-split', mode === 'split'));
    updateChrome();
  }

  function setWrap(value) {
    S.wrap = value;
    save();
    withAnchor(() => document.body.classList.toggle('nowrap', !S.wrap));
    renderMenuState();
  }

  function applyTheme() {
    if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', S.theme);
  }

  function setTheme(theme) {
    S.theme = theme;
    applyTheme();
    save();
    renderMenuState();
  }

  // ---------- меню «Ещё» (3.13) ----------

  function menuItems() {
    return [
      { kind: 'check', label: 'Перенос строк', key: 'W', on: () => S.wrap, run: () => setWrap(!S.wrap) },
      'sep',
      { kind: 'label', label: 'Тема' },
      { kind: 'radio', label: 'Авто', hint: 'как в системе', on: () => S.theme === 'auto', run: () => setTheme('auto') },
      { kind: 'radio', label: 'Светлая', icon: 'sun', on: () => S.theme === 'light', run: () => setTheme('light') },
      { kind: 'radio', label: 'Тёмная', icon: 'moon', on: () => S.theme === 'dark', run: () => setTheme('dark') },
      'sep',
      { kind: 'check', label: filesMode() ? 'Дерево файлов' : 'Оглавление', key: 'T', on: tocVisible, run: () => { toggleToc(); renderMenuState(); } },
      { kind: 'item', label: 'Свернуть все файлы', key: 'Z', run: () => { closeMenu(true); setAllFilesOpen(false); } },
      { kind: 'item', label: 'Развернуть все файлы', key: '⇧Z', run: () => { closeMenu(true); setAllFilesOpen(true); } },
      { kind: 'item', label: 'Горячие клавиши', key: '?', run: () => openHelp() },
      'sep',
      { kind: 'item', label: 'Закрыть без ответа…', run: () => { closeMenu(); openSubmit('close'); } },
    ];
  }

  function toggleMenu() {
    if (ui.menu) closeMenu(true);
    else openMenu();
  }

  function openMenu() {
    const btn = document.getElementById('more-btn');
    const items = menuItems();
    const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': 'Ещё' });
    // Пункты темы — группа с подписью: скринридер читает «Тема», и в самих пунктах слово не повторяется.
    let box = menu;
    for (const it of items) {
      if (it === 'sep') { box = menu; menu.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
      if (it.kind === 'label') {
        const id = `menu-group-${uid()}`;
        box = h('div', { role: 'group', 'aria-labelledby': id }, h('div', { class: 'menu-group-label', id }, it.label));
        menu.append(box);
        continue;
      }
      const role = it.kind === 'check' ? 'menuitemcheckbox' : it.kind === 'radio' ? 'menuitemradio' : 'menuitem';
      const b = h('button', { class: 'menu-item', type: 'button', role, tabindex: '-1' },
        h('span', { class: 'menu-mark' }, it.kind !== 'item' && icon('check')),
        h('span', { class: 'menu-label' }, it.label),
        it.hint && h('span', { class: 'menu-hint' }, it.hint),
        it.icon && h('span', { class: 'menu-icon' }, icon(it.icon)),
        it.key && h('kbd', {}, it.key));
      b._item = it;
      b.addEventListener('click', () => it.run());
      box.append(b);
    }
    menu.addEventListener('keydown', onMenuKey);
    document.getElementById('top').append(menu);
    ui.menu = menu;
    btn.setAttribute('aria-expanded', 'true');
    renderMenuState();
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.right = `${document.documentElement.clientWidth - r.right}px`;
    menu.querySelector('.menu-item').focus();
    document.addEventListener('mousedown', onMenuOutside);
  }

  function renderMenuState() {
    if (!ui.menu) return;
    for (const b of ui.menu.querySelectorAll('.menu-item')) {
      if (b._item.on) b.setAttribute('aria-checked', String(!!b._item.on()));
    }
  }

  function closeMenu(focusBtn) {
    if (!ui.menu) return;
    ui.menu.remove();
    ui.menu = null;
    document.removeEventListener('mousedown', onMenuOutside);
    const btn = document.getElementById('more-btn');
    btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) btn.focus();
  }

  function onMenuOutside(e) {
    if (ui.menu && !ui.menu.contains(e.target) && !e.target.closest('#more-btn')) closeMenu(false);
  }

  function onMenuKey(e) {
    const items = [...ui.menu.querySelectorAll('.menu-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1].focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    }
  }

  // ---------- клавиатура (4.3) ----------

  // Поля, где буквы — это ввод. Чекбоксы «Просмотрено» сюда не входят: после клика по ним клавиши должны работать.
  const TEXT_INPUT = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])';

  const KEYS = {
    KeyJ: () => stepFile(1),
    KeyK: () => stepFile(-1),
    BracketRight: () => stepSection(1),
    BracketLeft: () => stepSection(-1),
    KeyN: () => stepChange(1),
    KeyP: () => stepChange(-1),
    KeyV: () => toggleCurrentFileViewed(),
    KeyO: () => toggleCurrentFile(),
    KeyE: () => toggleCurrentWholeFile(),
    KeyC: () => commentAtCursor(),
    KeyS: () => setViewMode(S.viewMode === 'split' ? 'unified' : 'split'),
    KeyW: () => setWrap(!S.wrap),
    KeyT: () => toggleToc(),
    KeyG: () => setMode(filesMode() ? 'guide' : 'files'),
    KeyZ: () => setAllFilesOpen(false),
    Slash: () => focusFilter(),
  };
  // Клавиши глав: в «Файлах» глав нет — подсказка вместо действия.
  const guideOnly = (fn) => () => (filesMode() ? toast('Это действие с главами — оно есть в режиме «Гайд» (G)') : fn());
  KEYS.BracketRight = guideOnly(KEYS.BracketRight);
  KEYS.BracketLeft = guideOnly(KEYS.BracketLeft);
  const SHIFT_KEYS = {
    KeyV: guideOnly(() => toggleCurrentSectionViewed()),
    KeyO: guideOnly(() => toggleCurrentSection()),
    KeyC: guideOnly(() => { if (ui.curSec) openSectionComment(ui.curSec); }),
    KeyZ: () => setAllFilesOpen(true),
  };

  function focusFilter() {
    if (!filesMode()) setMode('files');
    if (narrowScreen.matches && !ui.drawer) setDrawer(true);
    else if (!narrowScreen.matches && S.tocOpen === false) toggleToc();
    const input = document.getElementById('tree-filter');
    if (input) { input.focus(); input.select(); }
  }

  function onKeyDown(e) {
    if (finished || e.isComposing) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest(TEXT_INPUT)) return;
    if (document.querySelector('dialog[open]')) return;
    if (ui.menu && t && ui.menu.contains(t)) return;
    const code = e.code;
    if (code === 'Enter' && isMod(e) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      openSubmit('feedback');
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '?' || (code === 'Slash' && e.shiftKey)) { e.preventDefault(); openHelp(); return; }
    if (code === 'Escape') { onEscape(); return; }
    const fn = (e.shiftKey ? SHIFT_KEYS : KEYS)[code];
    if (!fn) return;
    e.preventDefault();
    // Текущий элемент обновляется в кадре после прокрутки; клавиша, нажатая сразу после неё, получает свежий.
    trackCurrent();
    fn();
  }

  // Esc закрывает по очереди: меню, выезжающее оглавление, форму (черновик остаётся), выделение, курсор.
  function onEscape() {
    if (ui.menu) { closeMenu(true); return; }
    if (narrowScreen.matches && ui.drawer) { setDrawer(false); return; }
    if (ui.drag) { cancelDrag(); return; }
    if (ui.secForm) { closeSectionComment(); return; }
    if (ui.form || selection) { closeForm(true); return; }
    if (ui.cursor) { ui.cursor = null; applyCursor(); }
  }

  const openFileEls = () => [...$main().querySelectorAll('.sec:not(.collapsed) .file:not([hidden])')];

  // J/K: соседний файл в раскрытых главах, включая свёрнутые файлы.
  function stepFile(dir) {
    const list = openFileEls();
    if (!list.length) return;
    const c = ui.curFile;
    const cur = c ? list.findIndex((f) => f.dataset.path === c.path && f.closest('.sec').dataset.key === c.sec) : -1;
    let next = cur + dir;
    if (cur < 0) {
      // Текущего файла нет (после ]/[ или V, закрывшего главу): соседний файл считается от текущей главы.
      const at = sections.findIndex((s) => s.key === ui.curSec);
      const secIdx = (f) => secByKey.get(f.closest('.sec').dataset.key).idx;
      if (at < 0) next = dir > 0 ? 0 : list.length - 1;
      else if (dir > 0) { next = list.findIndex((f) => secIdx(f) >= at); if (next < 0) next = list.length; }
      else { next = -1; list.forEach((f, k) => { if (secIdx(f) < at) next = k; }); }
    }
    if (next < 0 || next >= list.length) {
      toast(dir > 0 ? 'Это последний файл' : 'Это первый файл');
      return;
    }
    const el = list[next];
    goFile(el.dataset.path, el.closest('.sec').dataset.key);
  }

  // Заголовок файла под заголовок главы, файл текущий, фокус на его кнопке.
  function goFile(path, key) {
    ui.curFile = { path, sec: key };
    ui.curSec = key;
    ui.pin = { sec: key, path };
    applyCurrent(true);
    scrollToElement(() => $main().querySelector(fileQ(key, path)), L.header + L.secHead);
    const t = $main().querySelector(`${fileQ(key, path)} .file-toggle`);
    if (t) t.focus({ preventScroll: true });
  }

  // ]/[: соседняя глава, включая свёрнутые.
  function stepSection(dir) {
    const cur = sections.findIndex((s) => s.key === ui.curSec);
    const next = cur < 0 ? 0 : cur + dir;
    if (next < 0 || next >= sections.length) {
      toast(dir > 0 ? 'Это последняя глава' : 'Это первая глава');
      return;
    }
    const key = sections[next].key;
    ui.curSec = key;
    ui.curFile = null;
    ui.pin = { sec: key, path: null };
    applyCurrent(true);
    jumpToSection(key);
    const t = $main().querySelector(`${secQ(key)} .sec-toggle`);
    if (t) t.focus({ preventScroll: true });
  }

  // Строки таблицы блока изменений (в «Рядом» блок занимает пары).
  function blockRows(c) {
    const fileEl = c && $main().querySelector(fileQ(c.sec, c.path));
    const file = c && fileByPath.get(c.path);
    if (!fileEl || !file || !fileEl.querySelector('table.diff')) return [];
    const idx = new Set();
    for (let li = c.from; li <= c.to; li++) idx.add(rowIndex(file, li));
    return [...idx].map((i) => fileEl.querySelector(`tr.ln[data-i="${i}"]`)).filter(Boolean);
  }

  function applyCursor() {
    for (const el of $main().querySelectorAll('tr.ln.cursor')) el.classList.remove('cursor');
    for (const tr of blockRows(ui.cursor)) tr.classList.add('cursor');
  }

  // N/P: следующий блок изменений в раскрытых файлах раскрытых глав.
  function stepChange(dir) {
    const list = [];
    for (const fileEl of $main().querySelectorAll('.sec:not(.collapsed) .file:not(.collapsed):not([hidden])')) {
      if (!fileEl.querySelector('table.diff')) continue;
      const file = fileByPath.get(fileEl.dataset.path), sec = fileEl.closest('.sec').dataset.key;
      for (const b of fileBlocks(file)) list.push({ path: file.path, sec, from: b.from, to: b.to });
    }
    const c = ui.cursor;
    let next = -1;
    const cur = c ? list.findIndex((b) => b.path === c.path && b.sec === c.sec && b.from === c.from) : -1;
    if (cur >= 0) next = cur + dir;
    else if (list.length) {
      // Без курсора — от экрана: первый блок под закреплёнными заголовками или последний над ними.
      const line = stickyOffset() - 1;
      const top = (b) => { const r = blockRows(b)[0]; return r ? r.getBoundingClientRect().top : -Infinity; };
      if (dir > 0) next = list.findIndex((b) => top(b) >= line);
      else for (let k = 0; k < list.length && top(list[k]) < line; k++) next = k;
      if (next < 0) next = dir > 0 ? list.length : -1;
    }
    if (next < 0 || next >= list.length) {
      toast(dir > 0 ? 'Дальше изменений нет' : 'Это первое изменение');
      return;
    }
    ui.cursor = list[next];
    // Файл курсора становится текущим и закреплённым: иначе V, O и Shift+V сработали бы
    // на файле или главе, закреплённых раньше клавишами J/K/]/[, хотя их уже нет на экране.
    ui.curFile = { path: ui.cursor.path, sec: ui.cursor.sec };
    ui.curSec = ui.cursor.sec;
    ui.pin = { sec: ui.cursor.sec, path: ui.cursor.path };
    applyCurrent(true);
    applyCursor();
    scrollToElement(() => blockRows(ui.cursor)[0], stickyOffset() + Math.round(window.innerHeight * 0.25));
  }

  // C: форма на блоке под курсором. Есть добавленные строки — новая сторона по ним, иначе старая по удалённым.
  function commentAtCursor() {
    const c = ui.cursor;
    const file = c && fileByPath.get(c.path);
    if (!file || !blockRows(c).length) {
      toast('Выбери изменение клавишами N/P или кликни по номеру строки');
      return;
    }
    const lines = file.lines.slice(c.from, c.to + 1);
    const adds = lines.filter((l) => l.t === 'add');
    const side = adds.length ? 'new' : 'old';
    const picked = adds.length ? adds : lines.filter((l) => l.t === 'del');
    const nos = picked.map((l) => (side === 'new' ? l.n : l.o));
    openLineForm(file, c.sec, { side, start: Math.min(...nos), end: Math.max(...nos) }, { li: picked[0].i, side }, false, blockRows(c)[0]);
  }

  function currentFile() {
    const c = ui.curFile;
    const file = c && fileByPath.get(c.path);
    const el = file && $main().querySelector(fileQ(c.sec, c.path));
    return el ? { file, sec: secByKey.get(c.sec), head: el.querySelector('.file-head') } : null;
  }

  const NO_FILE = 'Нет текущего файла: выбери его клавишами J/K';

  // Перерисовка убирает узел с фокусом. Фокус возвращается на кнопку заголовка файла или главы,
  // если он не ушёл сам (например, в поле формы).
  function refocus(secKey, path) {
    if (document.activeElement && document.activeElement !== document.body) return;
    const t = $main().querySelector(path ? `${fileQ(secKey, path)} .file-toggle` : `${secQ(secKey)} .sec-toggle`);
    if (t) t.focus({ preventScroll: true });
  }

  function toggleCurrentFileViewed() {
    const cur = currentFile();
    if (!cur) { toast(NO_FILE); return; }
    ui.pin = { sec: cur.sec.key, path: cur.file.path };
    const closed = setFileViewed(cur.file, !isViewed(cur.file), cur.head);
    refocus(closed || cur.sec.key, closed ? null : cur.file.path);
  }

  function toggleCurrentFile() {
    const cur = currentFile();
    if (!cur) { toast(NO_FILE); return; }
    if (cur.file.binary) return;
    ui.pin = { sec: cur.sec.key, path: cur.file.path };
    toggleFile(cur.file, cur.sec, !fileOpen(cur.file));
    refocus(cur.sec.key, cur.file.path);
  }

  function toggleCurrentWholeFile() {
    const cur = currentFile();
    if (!cur) { toast(NO_FILE); return; }
    if (!wholeButton(cur.file)) { toast('У этого файла весь текст уже в диффе'); return; }
    ui.pin = { sec: cur.sec.key, path: cur.file.path };
    setWholeFile(cur.file, !isWhole(cur.file));
  }

  function currentSecHead() {
    const el = ui.curSec && $main().querySelector(secQ(ui.curSec));
    return el ? el.querySelector('.sec-head') : null;
  }

  function toggleCurrentSectionViewed() {
    const sec = secByKey.get(ui.curSec);
    if (!sec) return;
    ui.pin = { sec: sec.key, path: null };
    setSectionViewed(sec, !S.reviewed[sec.key], currentSecHead());
    refocus(sec.key, null);
  }

  function toggleCurrentSection() {
    const sec = secByKey.get(ui.curSec);
    if (!sec) return;
    ui.pin = { sec: sec.key, path: null };
    toggleSection(sec, currentSecHead());
    refocus(sec.key, null);
  }

  // ---------- диалоги: общий каркас ----------

  const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])';

  function dialogEl(id, cls) {
    let d = document.getElementById(id);
    if (d) return d;
    d = h('dialog', { id, class: `dlg ${cls}` });
    const outside = (e) => {
      const r = d.getBoundingClientRect();
      return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
    };
    // Клик по фону закрывает, но только если и нажатие было на фоне: выделение текста мышью диалог не закроет.
    d.addEventListener('mousedown', (e) => { d.downOutside = outside(e); });
    d.addEventListener('click', (e) => { if (d.downOutside && outside(e)) d.close(); });
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && isMod(e) && d.primary && !d.primary.disabled) {
        e.preventDefault();
        d.primary.click();
      } else if (e.key === 'Tab') {
        // Держим фокус внутри: после последнего элемента — первый, и наоборот.
        const items = [...d.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (document.activeElement === d) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    d.addEventListener('close', () => {
      if (finished) return;
      updateChrome();
      const back = d.opener && d.opener.isConnected ? d.opener : null;
      if (back) back.focus({ preventScroll: true });
    });
    document.body.append(d);
    return d;
  }

  // Кто открыл диалог: туда вернётся фокус. Пункт меню исчезает вместе с меню — тогда кнопка «Ещё».
  function dialogOpener() {
    const a = document.activeElement;
    if (ui.menu && a && ui.menu.contains(a)) return document.getElementById('more-btn');
    return a && a !== document.body ? a : null;
  }

  // ---------- справка (3.15) ----------

  // Клавиши глав показываются только в «Гайде»: в «Файлах» они ничего не делают.
  function helpGroups() {
    const mod = isMac ? '⌘' : 'Ctrl';
    const guide = !filesMode();
    const rows = (list) => list.filter(Boolean);
    return [
      ['Навигация', rows([
        [[['J'], ['K']], 'Следующий / предыдущий файл'],
        guide && [[[']'], ['[']], 'Следующая / предыдущая глава'],
        [[['N'], ['P']], 'Следующее / предыдущее изменение'],
        [[['G']], 'Режим: гайд или файлы'],
        [[['/']], 'Фильтр файлов'],
      ])],
      ['Ревью', rows([
        [[['V']], 'Отметить файл просмотренным'],
        guide && [[['Shift', 'V']], 'Отметить главу просмотренной'],
        [[['O']], 'Свернуть или развернуть файл'],
        [[['E']], 'Весь файл или только изменения'],
        [[['Z'], ['Shift', 'Z']], 'Свернуть / развернуть все файлы'],
        guide && [[['Shift', 'O']], 'Свернуть или развернуть главу'],
      ])],
      ['Комментарии', rows([
        [[['C']], 'Комментарий к изменению под курсором'],
        guide && [[['Shift', 'C']], 'Комментарий к главе'],
        [[['клик']], 'По номеру — комментарий к любой строке'],
        [[['Shift', 'клик']], 'Расширить диапазон строк'],
        [[[mod, 'Enter']], 'Сохранить комментарий'],
      ])],
      ['Вид', [
        [[['S']], 'Единый / Рядом'],
        [[['W']], 'Перенос строк'],
        [[['T']], guide ? 'Оглавление' : 'Дерево файлов'],
      ]],
      ['Отправка', [
        [[[mod, 'Enter']], 'Отправить фидбек'],
        [[['Esc']], 'Закрыть меню, форму, выделение, курсор'],
        [[['?']], 'Эта справка'],
      ]],
    ];
  }

  function keyCombo(alts) {
    return alts.flatMap((combo, k) => [
      k > 0 && h('span', { class: 'key-or' }, '/'),
      combo.flatMap((key, j) => [j > 0 && h('span', { class: 'key-plus' }, '+'), key === 'клик' ? h('span', { class: 'key-word' }, key) : h('kbd', {}, key)]),
    ]);
  }

  function openHelp() {
    if (finished) return;
    const opener = dialogOpener();
    closeMenu(false);
    const d = dialogEl('help', 'help');
    if (d.open) return;
    d.opener = opener;
    d.primary = null;
    d.setAttribute('aria-labelledby', 'help-title');
    d.replaceChildren(
      h('div', { class: 'dlg-head' },
        h('h2', { id: 'help-title' }, 'Горячие клавиши'),
        h('button', { class: 'icon-btn sm dlg-x', type: 'button', 'aria-label': 'Закрыть', onclick: () => d.close() }, icon('x'))),
      h('div', { class: 'help-grid' }, helpGroups().map(([title, rows]) => h('section', { class: 'help-group' },
        h('h3', {}, title),
        h('dl', {}, rows.map(([keys, text]) => h('div', { class: 'help-row' }, h('dt', {}, keyCombo(keys)), h('dd', {}, text))))))),
      h('p', { class: 'dlg-note' }, 'Клавиши работают в любой раскладке. В полях ввода отключены.'));
    d.showModal();
    // Фокус на самом диалоге, а не на «×»: иначе самым заметным в справке становится кнопка закрытия.
    d.tabIndex = -1;
    d.focus();
  }

  // ---------- фидбек ----------

  function fence(text, lang) {
    const longest = Math.max(2, ...(text.match(/`+/g) || []).map((s) => s.length));
    const f = '`'.repeat(longest + 1);
    return `${f}${lang || ''}\n${text}\n${f}`;
  }

  function buildMarkdown(action) {
    const g = R.guide, m = R.meta;
    const out = [];
    out.push(`# ${action === 'approve' ? 'Ревью одобрено' : 'Фидбек по ревью'}: ${g.title}`, '');
    out.push(`- Диапазон: ${m.label}`);
    out.push(`- Репозиторий: \`${m.root}\`${m.branch ? `, ветка \`${m.branch}\`` : ''}`);
    out.push('');
    if (S.globalComment.trim()) out.push('## Общий комментарий', '', S.globalComment.trim(), '');

    sections.forEach((sec, i) => {
      const c = S.sectionComments[sec.key];
      if (c && c.trim()) out.push(`## Глава ${sec.synthetic ? '' : `${i + 1}. `}${sec.title}`, '', c.trim(), '');
    });

    const order = new Map(R.files.map((f, i) => [f.path, i]));
    const notes = [...S.annotations].sort((a, b) =>
      (order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9) || a.start - b.start);
    for (const a of notes) {
      const file = fileByPath.get(a.file);
      out.push(`## \`${a.file}\`, ${rangeLabel(a)} (${sideLabel(a.side)})`, '');
      if (file) {
        const quoted = quote(file, a.side, a.start, a.end).slice(0, 20)
          .map((l) => (l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' ') + l.s).join('\n');
        if (quoted) out.push(fence(quoted, 'diff'), '');
      }
      if (a.text) out.push(a.text, '');
      if (a.suggestion) out.push('Предложенная замена:', '', fence(a.suggestion, 'suggestion'), '');
    }
    return out.join('\n').trim();
  }

  // ---------- диалог отправки (3.14) ----------

  const SUBMIT_TITLES = { feedback: 'Отправить фидбек', approve: 'Одобрить изменения', close: 'Закрыть без ответа' };
  const SUBMIT_HINTS = {
    feedback: 'Сессия Claude Code получит этот текст как твоё сообщение: ответит на вопросы и внесёт просьбы о правках.',
    approve: 'Сессия получит одобрение. Ничего не будет закоммичено. Комментарии, если есть, приложатся.',
    close: 'Сервер остановится, в сессию уйдёт только отметка, что ревью закрыто. Комментарии останутся в state.json.',
  };

  const fileOrder = () => new Map(R.files.map((f, i) => [f.path, i]));

  // Черновик виден на странице: его строка end есть в патче файла (у правки — строка end комментария),
  // и файл стоит в какой-то главе. Черновик на строках, которых в патче больше нет, показать негде.
  function draftReachable(d) {
    const file = d && fileByPath.get(d.file);
    if (!file || !sections.some((s) => s.diffs.some((x) => x.file === d.file))) return false;
    const a = d.editingId ? S.annotations.find((x) => x.id === d.editingId) : d;
    return !!a && !!lineAt(file, a.side, a.end);
  }

  // Непустые черновики, до которых можно дойти, в порядке файлов и строк.
  function draftList() {
    const order = fileOrder();
    return Object.entries(S.drafts)
      .filter(([, d]) => draftReachable(d))
      .sort(([, a], [, b]) => (order.get(a.file) - order.get(b.file)) || a.start - b.start);
  }

  const secComments = () => sections.filter((s) => (S.sectionComments[s.key] || '').trim());

  function submitCounts() {
    return { lines: S.annotations.length, secs: secComments().length, global: !!S.globalComment.trim() };
  }

  function submitSummary() {
    const c = submitCounts();
    const files = R.files.length;
    const viewed = R.files.filter((f) => isViewed(fileByPath.get(f.path))).length;
    const secDone = sections.filter((s) => S.reviewed[s.key]).length;
    const item = (dt, dd) => h('div', { class: 'sum-item' }, h('dt', {}, dt), h('dd', {}, dd));
    return [
      item('Комментарии к строкам', String(c.lines)),
      item('К главам', String(c.secs)),
      item('Общий', c.global ? 'есть' : 'нет'),
      item('Просмотрено', `${viewed} из ${plural(files, ['файла', 'файлов', 'файлов'])}, ${secDone} из ${plural(sections.length, ['главы', 'глав', 'глав'])}`),
    ];
  }

  function submitWarnings(action, d) {
    const out = [];
    if (action === 'approve') {
      const left = R.files.filter((f) => !isViewed(fileByPath.get(f.path)));
      if (left.length) {
        out.push(h('div', { class: 'callout callout-warning dlg-warn' },
          h('p', { class: 'warn-head' }, 'Не все файлы просмотрены'),
          h('ul', { class: 'dlg-paths' }, left.slice(0, 5).map((f) => h('li', {}, f.path))),
          left.length > 5 && h('p', { class: 'dlg-more' }, `и ещё ${left.length - 5}`)));
      }
    }
    const drafts = draftList();
    if (drafts.length) {
      out.push(h('div', { class: 'callout callout-warning dlg-warn dlg-drafts' },
        h('p', {}, `Есть неотправленные черновики: ${drafts.length}. Они не войдут в фидбек.`),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { d.close(); goToDraft(drafts[0][0]); } }, 'Перейти', icon('arrow-right'))));
    }
    return out;
  }

  const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';

  function submitList(d) {
    const order = fileOrder();
    const items = secComments().map((sec) => ({
      loc: sec.synthetic ? sec.title : `Глава ${pad2(sec.idx + 1)}`,
      text: S.sectionComments[sec.key],
      go: () => goToSectionComment(sec.key),
    }));
    const notes = [...S.annotations].sort((a, b) => ((order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9)) || a.start - b.start);
    for (const a of notes) {
      items.push({
        loc: `${a.file}:${a.start === a.end ? a.start : `${a.start}–${a.end}`}`,
        text: a.text || (a.suggestion ? 'Предложенная правка' : ''),
        go: () => goToNote(a.id),
      });
    }
    if (!items.length) return null;
    return h('ul', { class: 'dlg-list', 'aria-label': 'Комментарии' }, items.map((it) => h('li', {},
      h('button', { class: 'dlg-item', type: 'button', title: it.loc, onclick: () => { d.close(); it.go(); } },
        h('span', { class: 'dlg-loc' }, it.loc),
        h('span', { class: 'dlg-text' }, firstLine(it.text))))));
  }

  function openSubmit(action) {
    if (finished) return;
    const opener = dialogOpener();
    closeMenu(false);
    if (narrowScreen.matches && ui.drawer) setDrawer(false);
    const d = dialogEl('submit', 'submit');
    if (d.open) return;
    d.opener = opener || document.getElementById(action === 'approve' ? 'approve-btn' : 'submit-btn');
    const title = SUBMIT_TITLES[action];
    const withComments = action !== 'close';
    const send = h('button', { class: 'btn primary', type: 'button', 'aria-keyshortcuts': isMac ? 'Meta+Enter' : 'Control+Enter' }, title);
    const cancel = h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Отмена');
    const summary = h('dl', { class: 'dlg-summary' });
    const preview = h('pre', { class: 'preview' });
    const empty = h('p', { class: 'dlg-empty', hidden: true }, 'Комментариев пока нет: кликни по номеру строки в диффе или напиши общий комментарий.');
    const error = h('div', { class: 'dlg-error', role: 'alert', hidden: true });
    let sending = false;
    const refresh = () => {
      summary.replaceChildren(...submitSummary());
      if (withComments) preview.textContent = buildMarkdown(action);
      const nothing = action === 'feedback' && commentCount() === 0;
      empty.hidden = !nothing;
      if (!sending) send.disabled = nothing;
    };
    let ta = null;
    if (withComments) {
      ta = h('textarea', { class: 'global', rows: 4, placeholder: 'Общий комментарий к ревью (необязательно)', 'aria-label': 'Общий комментарий' });
      ta.value = S.globalComment;
      ta.addEventListener('input', () => { S.globalComment = ta.value; save(); refresh(); });
    }
    send.addEventListener('click', async () => {
      if (send.disabled) return;
      sending = true;
      send.disabled = true;
      send.textContent = 'Отправляю…';
      error.hidden = true;
      const markdown = action === 'close' || (action === 'approve' && commentCount() === 0) ? '' : buildMarkdown(action);
      const counts = submitCounts();
      try {
        clearTimeout(saveTimer);
        saveTimer = null;
        await api('PUT', '/api/state', S);
        await api('POST', '/api/submit', { action, markdown });
        finished = true;
        d.close();
        showFinished(action, counts);
      } catch (err) {
        sending = false;
        send.disabled = false;
        send.textContent = title;
        error.textContent = `Не удалось отправить: ${err.message}. Прогресс сохранён, попробуй ещё раз.`;
        error.hidden = false;
      }
    });
    d.primary = send;
    d.setAttribute('aria-labelledby', 'submit-title');
    d.setAttribute('aria-describedby', 'submit-hint');
    d.replaceChildren(...[
      h('div', { class: 'dlg-head' },
        h('div', {}, h('h2', { id: 'submit-title' }, title), h('p', { id: 'submit-hint', class: 'dlg-hint' }, SUBMIT_HINTS[action]))),
      summary,
      ...submitWarnings(action, d),
      withComments && submitList(d),
      ta,
      withComments && h('details', { class: 'dlg-preview' }, h('summary', {}, 'Что уйдёт в сессию'), preview),
      action === 'feedback' && empty,
      error,
      h('div', { class: 'dlg-actions' }, cancel, send),
    ].filter(Boolean));
    refresh();
    d.showModal();
    // Ширина кнопки не меняется, когда текст становится «Отправляю…».
    send.style.minWidth = `${send.offsetWidth}px`;
    (ta || cancel).focus();
  }

  function goToSectionComment(key) {
    const sec = secByKey.get(key);
    if (!sec) return;
    if (filesMode()) setMode('guide');
    if (!sectionOpen(sec)) {
      S.sectionOpen[key] = true;
      save();
      withAnchor(() => rerenderSection(key));
      updateChrome();
    }
    jumpToSection(key);
    flash($main().querySelector(`${secQ(key)} .sec-comment .note`));
  }

  function goToDraft(key) {
    const d = S.drafts[key];
    const file = d && fileByPath.get(d.file);
    const sec = file && groupFor(d.file);
    if (!sec) return;
    revealFile(file, sec);
    const q = ui.form && ui.form.key === key ? `${fileQ(sec.key, file.path)} .annot-form` : `${fileQ(sec.key, file.path)} .draft-row[data-key="${CSS.escape(key)}"]`;
    const el = $main().querySelector(q);
    if (!el) return;
    scrollToElement(() => $main().querySelector(q), stickyOffset() + 16);
    flash(el);
  }

  function showFinished(action, counts) {
    const text = {
      feedback: 'Фидбек отправлен в сессию Claude Code.',
      approve: 'Одобрение отправлено в сессию Claude Code.',
      close: 'Ревью закрыто.',
    }[action];
    let sub = 'Комментарии сохранены в state.json.';
    if (action !== 'close') {
      // Нулевые части не пишутся: «0 к главам» — шум. Слово «комментарий» склоняется у первого числа.
      const parts = [];
      if (counts.lines) parts.push(`${plural(counts.lines, NOTES)} к строкам`);
      if (counts.secs) parts.push(`${parts.length ? counts.secs : plural(counts.secs, NOTES)} к главам`);
      if (counts.global) parts.push(parts.length ? 'и общий комментарий' : 'общий комментарий');
      sub = parts.length ? `Отправлено: ${parts.join(', ').replace(', и ', ' и ')}.` : 'Без комментариев.';
    }
    const closing = h('p', { class: 'finished-close', role: 'status' });
    document.body.replaceChildren(h('main', { class: 'finished' },
      h('div', { class: `finished-icon ${action === 'close' ? 'closed' : 'sent'}` }, icon(action === 'close' ? 'x' : 'check')),
      h('h1', {}, text),
      h('p', {}, 'Сервер остановлен, вкладку можно закрыть.'),
      h('p', { class: 'finished-sub' }, sub),
      closing));
    autoClose(closing, CLOSE_AFTER_S);
  }

  // Вкладку, открытую скиллом (одна запись в истории), браузер даёт закрыть скриптом. Если не дал —
  // вкладка остаётся, и строка просит закрыть её вручную.
  function autoClose(el, seconds) {
    const tick = (left) => {
      if (left > 0) {
        el.textContent = `Вкладка закроется через ${left} с`;
        setTimeout(() => tick(left - 1), 1000);
        return;
      }
      window.close();
      setTimeout(() => { if (!window.closed) el.textContent = 'Браузер не дал закрыть вкладку автоматически — закройте её вручную.'; }, 300);
    };
    tick(seconds);
  }

  // ---------- сборка ----------

  function readLayoutVars() {
    const cs = getComputedStyle(document.documentElement);
    const px = (name, def) => { const v = parseFloat(cs.getPropertyValue(name)); return Number.isFinite(v) ? v : def; };
    L.header = px('--header-h', 52);
    L.secHead = px('--sec-head-h', 48);
    if (!filesMode()) L.secHeadGuide = L.secHead;
    L.fileHead = px('--file-head-h', 40);
  }

  function renderShell() {
    renderHeader();
    applyTocState();
    renderMain();
    updateChrome();
    document.getElementById('toc').addEventListener('click', onTocClick);
    document.addEventListener('keydown', onDrawerTab);
    const main = $main();
    main.addEventListener('click', onMainClick);
    main.addEventListener('change', onMainChange);
    main.addEventListener('mousedown', onMainMouseDown);
    main.addEventListener('mouseover', onMainMouseOver);
  }

  function watchLayout() {
    const main = $main();
    ui.mainW = main.clientWidth;
    new ResizeObserver(() => {
      if (finished) return;
      const before = splitAvailable();
      ui.mainW = main.clientWidth;
      if (before !== splitAvailable()) {
        if (S.viewMode === 'split') rerenderAllFiles();
        updateHeader();
      }
    }).observe(main);
    narrowScreen.addEventListener('change', () => { if (finished) return; ui.drawer = false; applyTocState(); });
    const toc = document.getElementById('toc');
    toc.addEventListener('mouseenter', () => { ui.tocHover = true; });
    toc.addEventListener('mouseleave', () => { ui.tocHover = false; });
    // Закрыть выезжающее оглавление кликом вне панели.
    document.addEventListener('mousedown', (e) => {
      if (narrowScreen.matches && ui.drawer && !e.target.closest('#toc, #toc-btn')) { ui.drawer = false; applyTocState(); }
    });
    window.addEventListener('scroll', queueTrack, { passive: true });
    // Прокрутка пользователем снимает закрепление текущего элемента (клавиши J/K ставят его заново).
    const unpin = () => { ui.pin = null; };
    for (const ev of ['wheel', 'touchmove', 'mousedown']) window.addEventListener(ev, unpin, { passive: true, capture: true });
    const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'Space']);
    window.addEventListener('keydown', (e) => { if (SCROLL_KEYS.has(e.code)) unpin(); }, { capture: true });
    window.addEventListener('resize', queueTrack, { passive: true });
    // Пока заголовок ревью виден, в шапке контекст репозитория; потом — название ревью.
    observeTitle();
  }

  async function init() {
    let review;
    try {
      review = await api('GET', '/api/review');
    } catch (err) {
      $main().replaceChildren(h('div', { class: 'load-error' },
        h('div', { class: 'callout callout-warning' },
          h('div', { class: 'callout-title' }, 'Внимание'),
          h('p', {}, `Не удалось загрузить ревью: ${err.message}. Возможно, сервер уже остановлен или ссылка без токена.`)),
        h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Повторить')));
      return;
    }
    performance.mark('dr-review');
    R = review;
    S = normalizeState(R.state);
    applyTheme();
    applyModeLayout();
    R.files.forEach((f, idx) => {
      const hunks = D.parsePatch(f.patch);
      const lines = hunks.flatMap((hk) => hk.lines);
      fileByPath.set(f.path, {
        ...f, idx, hunks, lines, baseHunks: hunks, baseCount: lines.length, hash: D.fnv1a(f.patch),
        fullAvail: !!f.full, newLines: f.content && f.content.lines != null ? f.content.lines : null, full: null, fullBad: false,
      });
    });
    // Раскрытое в прошлый раз: полный текст этих файлов нужен до первой отрисовки, иначе страница прыгнет.
    for (const p of Object.keys(S.expanded)) if (!fileByPath.has(p)) delete S.expanded[p];
    await Promise.all(Object.keys(S.expanded).map((p) => {
      const file = fileByPath.get(p);
      return ensureFull(file).then(() => applyView(file));
    }));
    sections = R.guide.sections.map((s, i) => ({ ...s, key: `s${i + 1}` }));
    if (R.guide.unplacedFiles && R.guide.unplacedFiles.length) {
      sections.push({
        key: 'rest', synthetic: true, title: 'Остальные файлы',
        overview: 'Файлы, которые не вошли ни в одну главу: шум или мелочи без отдельной истории.',
        diffs: R.guide.unplacedFiles.map((file) => ({ file })),
      });
    }
    const numbered = sections.filter((s) => !s.synthetic).length;
    sections.forEach((s, i) => { s.idx = i; s.total = numbered; secByKey.set(s.key, s); });
    for (const sec of sections) for (const d of sec.diffs) if (!guideOf.has(d.file)) guideOf.set(d.file, { sec, summary: d.summary || '' });
    treeRoot = buildTree(R.files.map((f) => f.path));
    filesGroup = { key: 'files', headless: true, idx: 0, total: 0, title: 'Файлы', diffs: treeRoot.all.map((file) => ({ file })) };
    secByKey.set(filesGroup.key, filesGroup);
    if (filesMode()) computeVisible();
    migrateFilesViewed();
    document.title = `Ревью: ${R.guide.title}`;
    document.body.classList.toggle('view-split', S.viewMode === 'split');
    document.body.classList.toggle('nowrap', !S.wrap);
    ui.mainW = $main().clientWidth;
    renderShell();
    ui.ready = true;
    watchLayout();
    trackCurrent();
    performance.mark('dr-ready');
    performance.measure('dr-render', 'dr-review', 'dr-ready');
    window.addEventListener('beforeunload', flushSave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
    document.addEventListener('keydown', onKeyDown);
  }

  init();
})();

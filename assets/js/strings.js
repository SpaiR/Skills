// The page language: every user-visible string of the viewer and the feedback.md template.
// Parameterized strings are functions. No other module holds page text; assets/viewer.html keeps
// only the static text shown before this script runs.

import { plural } from './diffcore.js';

export const LOCALE = 'ru';

// Plural word forms for plural(n, forms): [one, few, many].
export const WORDS = Object.freeze({
  files: ['файл', 'файла', 'файлов'],
  lines: ['строка', 'строки', 'строк'],
  notes: ['комментарий', 'комментария', 'комментариев'],
  commits: ['коммит', 'коммита', 'коммитов'],
  linesToShow: ['строку', 'строки', 'строк'], // "Показать 1 строку"
  unchangedLines: ['строка без изменений', 'строки без изменений', 'строк без изменений'],
  ofFiles: ['файла', 'файлов', 'файлов'], // "3 из 1 файла"
  ofChapters: ['главы', 'глав', 'глав'],
});

const count = (n, forms) => `${n} ${plural(n, forms)}`;
// Lookup by a code that came with the data: only own keys, so 'toString' and the like are not codes.
const byCode = (table, code) => (Object.hasOwn(table, code) ? table[code] : undefined);

// Why collect.py has no full text for a file (meta v3 content.reason codes).
const FULL_TEXT_REASONS = {
  binary: 'бинарный файл',
  unchanged: 'содержимое не менялось',
  unreadable: 'не удалось прочитать файл',
  too_large: (c) => `файл больше ${c.limitKiB} КиБ`,
  total_limit: 'превышен общий лимит полного текста',
  not_collected: 'не собран',
  in_diff: 'весь файл уже в диффе',
};

// Notes about how the diff was collected (meta v3 notes[].code).
const NOTES = {
  no_commits: 'в репозитории нет коммитов, взяты все файлы рабочего дерева',
  base_not_found: 'базовая ветка не найдена, взяты только незакоммиченные изменения',
  full_text_mismatch: 'полный текст файлов не собран: вывод git не сошёлся со списком файлов, раскрытие контекста недоступно',
};

// Error codes of serve.py responses.
const SERVER_ERRORS = {
  request_too_large: 'слишком большой запрос',
  empty_feedback: 'пустой фидбек',
  already_submitted: 'уже отправлено',
};

export const T = Object.freeze({
  // Review data from meta.json. Older outdirs (meta v1, v2) carry ready Russian text: it is shown verbatim.
  rangeLabel(meta) {
    const r = meta.range;
    switch (r && r.mode) {
      case 'since-base': return `${r.base}...HEAD + незакоммиченное`;
      case 'uncommitted': return r.hasCommits ? 'HEAD + незакоммиченное' : 'рабочее дерево (коммитов нет)';
      case 'staged': return 'индекс (staged)';
      case 'commit': return `${r.sha.slice(0, 10)} ${r.subject}`;
      case 'range': return `${r.from}${r.dots}${r.to}`;
      case 'branch': return `${r.base}...${r.ref}`;
      default: return meta.label;
    }
  },
  note: (n) => (typeof n === 'string' ? n : byCode(NOTES, n.code) || n.text),
  fullTextReason(content) {
    const r = byCode(FULL_TEXT_REASONS, content.reason);
    return typeof r === 'function' ? r(content) : r || content.reason;
  },
  // The raw response body stays as shown before; only a known error code is replaced by its text.
  serverError(body) {
    let code;
    try { code = JSON.parse(body).error; } catch { return body; }
    const text = byCode(SERVER_ERRORS, code);
    return text ? body.replace(JSON.stringify(code), JSON.stringify(text)) : body;
  },

  // Shared bits.
  status: { added: 'новый', modified: 'изменён', deleted: 'удалён', renamed: 'переименован', copied: 'скопирован', typechange: 'тип изменён' },
  branch: (name) => `ветка ${name}`,
  binaryStat: 'бинарный',
  viewed: 'Просмотрено',
  viewedFile: 'Просмотрен',
  viewedFiles: 'Просмотрено файлов',
  edit: 'Изменить',
  delete: 'Удалить',
  undo: 'Вернуть',
  close: 'Закрыть',
  attention: 'Внимание',
  helpButton: ' — горячие клавиши',
  lineRange: (start, end) => (start === end ? `строка ${start}` : `строки ${start}–${end}`),
  side: (side) => (side === 'new' ? 'новая версия' : 'старая версия'),
  chapterChip: (num, title) => `Глава ${num} · ${title}`,
  chapterNo: (num) => `Глава ${num}`,

  // Boot and page title.
  page: {
    title: (title) => `Ревью: ${title}`,
    loadError: (msg) => `Не удалось загрузить ревью: ${msg}. Возможно, сервер уже остановлен или ссылка без токена.`,
    retry: 'Повторить',
    restTitle: 'Остальные файлы',
    restOverview: 'Файлы, которые не вошли ни в одну главу: шум или мелочи без отдельной истории.',
    filesGroup: 'Файлы',
  },

  // Top bar.
  header: {
    sidebar: 'Боковая панель',
    sidebarTitle: 'Боковая панель (T)',
    mode: 'Режим',
    guide: 'Гайд',
    files: 'Файлы',
    diffView: 'Вид диффа',
    unified: 'Единый',
    split: 'Рядом',
    unifiedTitle: 'Единый (S)',
    splitTitle: 'Рядом (S)',
    splitUnavailable: 'Недостаточно ширины',
    more: 'Ещё',
    approve: 'Одобрить',
    submit: 'Отправить фидбек',
    submitTitle: (modEnter) => `Отправить фидбек (${modEnter})`,
    saveError: 'Не удалось сохранить прогресс: сервер недоступен. Комментарии на странице пока целы, но отправить их не получится.',
    progressTitle: (viewed, total, secDone, secTotal) => `Просмотрено файлов: ${viewed} из ${total}, глав: ${secDone} из ${secTotal}`,
    allViewed: 'Всё просмотрено',
  },

  // Hero block and chapter cards of the main column.
  section: {
    guideModel: (model) => `гайд: ${model}`,
    commits: (n) => `Коммиты · ${n}`,
    untracked: (n) => `Включены неотслеживаемые файлы: ${n}`,
    filesShown: (shown, total) => `Показано ${shown} из ${count(total, WORDS.files)}`,
    resetFilter: 'Сбросить фильтр',
    viewedSuffix: ' · просмотрено',
    viewedChapter: (title) => `Просмотрено: глава «${title}»`,
    chapterFiles: 'Файлы главы',
    noFiles: 'Файлов этой главы нет в текущем диффе. Гайд мог устареть.',
    done: 'Глава просмотрена',
    doneNext: 'Глава просмотрена — к следующей',
    comment: 'Комментарий к главе',
    commentPlaceholder: 'Что думаешь о главе целиком',
    commentAria: (title) => `Комментарий к главе «${title}»`,
    commentDone: 'Готово',
    commentHint: (modEnter) => `${modEnter} или Esc — готово`,
    commentDeleted: 'Комментарий к главе удалён',
  },

  // Sidebar: chapter list (Guide mode) and file tree (Files mode).
  toc: {
    chapters: 'Главы',
    markChapter: (title) => `Отметить главу «${title}» просмотренной`,
    chapterViewed: 'Глава просмотрена',
    markChapterTitle: 'Отметить главу просмотренной',
    files: 'Файлы',
    filterPlaceholder: 'Фильтр по пути',
    filterAria: 'Фильтр файлов по пути',
    hideViewed: 'Скрыть просмотренные',
    resizeAria: 'Ширина панели файлов',
    resizeTitle: 'Потяни, чтобы изменить ширину',
    noMatch: 'Ни один файл не подходит под фильтр',
  },

  // File card.
  file: {
    wholeOn: 'Показать только изменения и раскрытое (E)',
    wholeOff: 'Показать весь файл (E)',
    whole: 'Весь файл',
    viewedAria: (path) => `Просмотрено: ${path}`,
    openInGuide: 'Открыть этот файл в гайде',
    show: 'Показать',
    binary: 'Бинарный файл — содержимое не показывается',
    noContentChange: 'Содержимое не менялось (переименование или смена прав).',
    collapsedDeleted: (lines) => `Удалён, ${count(lines, WORDS.lines)}`,
    collapsedLockfile: 'Lock-файл — обычно не читают',
    collapsedBig: (lines) => `Большой дифф: ${count(lines, WORDS.lines)}`,
  },

  // Diff table.
  diff: {
    table: (path) => `Дифф ${path}`,
    commentLine: (no) => `Комментарий к строке ${no}`,
    noEol: 'Нет перевода строки в конце файла',
    showLines: (n) => `Показать ${count(n, WORDS.linesToShow)}`,
    showBelow: (n) => `Показать ${n} строк ниже`,
    showAbove: (n) => `Показать ${n} строк выше`,
    toEnd: (n) => `⋯ ${count(n, WORDS.lines)} до конца файла`,
    unchanged: (n) => `⋯ ${count(n, WORDS.unchangedLines)}`,
    firstHidden: (n, to) => (n === 1 ? '⋯ строка 1 не показана' : `⋯ строки 1–${to} не показаны`),
  },

  // Context expansion.
  expand: {
    fileChanged: 'Файл изменился после сбора диффа — раскрытие недоступно',
    oldReview: 'Полный текст не собран: ревью создано старой версией скилла',
    notCollected: (reason) => `Полный текст не собран: ${reason}`,
    unavailable: 'Полный текст недоступен',
    loadFailed: 'Не удалось загрузить полный текст файла',
  },

  // Line comments: cards, drafts, the editor.
  comments: {
    suggestion: 'Предложенная правка',
    suggestionLower: 'предложенная правка',
    draftEdit: 'Черновик правки:',
    draft: 'Черновик:',
    continue: 'Продолжить',
    placeholder: 'Вопрос, замечание или просьба',
    textAria: 'Текст комментария',
    suggestionPlaceholder: 'Код, которым заменить выделенные строки',
    suggestionHint: (modEnter) => `Tab — отступ · Esc — закрыть форму · ${modEnter} — сохранить`,
    suggest: '± Предложить правку',
    save: 'Сохранить',
    discardDraft: 'Удалить черновик',
    extendHint: 'Shift+клик — расширить диапазон',
    saveHintTitle: 'Esc закрывает форму, текст остаётся черновиком',
    saveHintLong: (modEnter) => `${modEnter} — сохранить · Esc — закрыть, черновик останется`,
    saveHintShort: (modEnter) => `${modEnter} — сохранить · Esc — закрыть`,
    deleted: 'Комментарий удалён',
  },

  // Toasts of keyboard actions and mode switches.
  keys: {
    guideOnly: 'Это действие с главами — оно есть в режиме «Гайд» (G)',
    lastFile: 'Это последний файл',
    firstFile: 'Это первый файл',
    lastChapter: 'Это последняя глава',
    firstChapter: 'Это первая глава',
    noMoreChanges: 'Дальше изменений нет',
    firstChange: 'Это первое изменение',
    pickChange: 'Выбери изменение клавишами N/P или кликни по номеру строки',
    noFile: 'Нет текущего файла: выбери его клавишами J/K',
    wholeInDiff: 'У этого файла весь текст уже в диффе',
    allExpanded: 'Все файлы развёрнуты',
    allCollapsed: 'Все файлы свёрнуты',
  },

  // Keyboard shortcuts help dialog.
  help: {
    title: 'Горячие клавиши',
    note: 'Клавиши работают в любой раскладке. В полях ввода отключены.',
    click: 'клик',
    navigation: 'Навигация',
    nextFile: 'Следующий / предыдущий файл',
    nextChapter: 'Следующая / предыдущая глава',
    nextChange: 'Следующее / предыдущее изменение',
    mode: 'Режим: гайд или файлы',
    filter: 'Фильтр файлов',
    review: 'Ревью',
    markFile: 'Отметить файл просмотренным',
    markChapter: 'Отметить главу просмотренной',
    toggleFile: 'Свернуть или развернуть файл',
    wholeFile: 'Весь файл или только изменения',
    toggleAll: 'Свернуть / развернуть все файлы',
    toggleChapter: 'Свернуть или развернуть главу',
    comments: 'Комментарии',
    commentChange: 'Комментарий к изменению под курсором',
    commentChapter: 'Комментарий к главе',
    commentLine: 'По номеру — комментарий к любой строке',
    extendRange: 'Расширить диапазон строк',
    saveComment: 'Сохранить комментарий',
    view: 'Вид',
    viewMode: 'Единый / Рядом',
    wrap: 'Перенос строк',
    toc: 'Оглавление',
    tree: 'Дерево файлов',
    sending: 'Отправка',
    submit: 'Отправить фидбек',
    escape: 'Закрыть меню, форму, выделение, курсор',
    help: 'Эта справка',
  },

  // The "More" menu.
  menu: {
    wrap: 'Перенос строк',
    theme: 'Тема',
    auto: 'Авто',
    autoHint: 'как в системе',
    light: 'Светлая',
    dark: 'Тёмная',
    toc: 'Оглавление',
    tree: 'Дерево файлов',
    collapseAll: 'Свернуть все файлы',
    expandAll: 'Развернуть все файлы',
    help: 'Горячие клавиши',
    closeReview: 'Закрыть без ответа…',
  },

  // Submit dialog.
  submit: {
    titles: { feedback: 'Отправить фидбек', approve: 'Одобрить изменения', close: 'Закрыть без ответа' },
    hints: {
      feedback: 'Сессия Claude Code получит этот текст как твоё сообщение: ответит на вопросы и внесёт просьбы о правках.',
      approve: 'Сессия получит одобрение. Ничего не будет закоммичено. Комментарии, если есть, приложатся.',
      close: 'Сервер остановится, в сессию уйдёт только отметка, что ревью закрыто. Комментарии останутся в state.json.',
    },
    lineComments: 'Комментарии к строкам',
    chapterComments: 'К главам',
    globalComment: 'Общий',
    yes: 'есть',
    no: 'нет',
    viewed: (viewed, files, secDone, secTotal) => `${viewed} из ${count(files, WORDS.ofFiles)}, ${secDone} из ${count(secTotal, WORDS.ofChapters)}`,
    notAllViewed: 'Не все файлы просмотрены',
    andMore: (n) => `и ещё ${n}`,
    drafts: (n) => `Есть неотправленные черновики: ${n}. Они не войдут в фидбек.`,
    goTo: 'Перейти',
    listAria: 'Комментарии',
    cancel: 'Отмена',
    empty: 'Комментариев пока нет: кликни по номеру строки в диффе или напиши общий комментарий.',
    globalPlaceholder: 'Общий комментарий к ревью (необязательно)',
    globalAria: 'Общий комментарий',
    sending: 'Отправляю…',
    failed: (msg) => `Не удалось отправить: ${msg}. Прогресс сохранён, попробуй ещё раз.`,
    preview: 'Что уйдёт в сессию',
  },

  // Screen after submitting.
  finished: {
    title: { feedback: 'Фидбек отправлен в сессию Claude Code.', approve: 'Одобрение отправлено в сессию Claude Code.', close: 'Ревью закрыто.' },
    savedInState: 'Комментарии сохранены в state.json.',
    // Zero parts are omitted: "0 on chapters" is noise. The word "comment" is inflected by the first number.
    sent(counts) {
      const parts = [];
      if (counts.lines) parts.push(`${count(counts.lines, WORDS.notes)} к строкам`);
      if (counts.secs) parts.push(`${parts.length ? counts.secs : count(counts.secs, WORDS.notes)} к главам`);
      if (counts.global) parts.push(parts.length ? 'и общий комментарий' : 'общий комментарий');
      return parts.length ? `Отправлено: ${parts.join(', ').replace(', и ', ' и ')}.` : 'Без комментариев.';
    },
    serverStopped: 'Сервер остановлен, вкладку можно закрыть.',
    closingIn: (s) => `Вкладка закроется через ${s} с`,
    closeManually: 'Браузер не дал закрыть вкладку автоматически — закройте её вручную.',
  },

  // feedback.md sent to the Claude Code session.
  feedback: {
    title: (action, title) => `# ${action === 'approve' ? 'Ревью одобрено' : 'Фидбек по ревью'}: ${title}`,
    range: (label) => `- Диапазон: ${label}`,
    repo: (root, branch) => `- Репозиторий: \`${root}\`${branch ? `, ветка \`${branch}\`` : ''}`,
    global: '## Общий комментарий',
    chapter: (num, title) => `## Глава ${num ? `${num}. ` : ''}${title}`,
    suggestion: 'Предложенная замена:',
  },

  // GitHub-style callouts in guide Markdown.
  callouts: { important: 'Важно', warning: 'Внимание', note: 'Заметка', tip: 'Совет', caution: 'Осторожно' },
});

// Russian typography for guide text: short prepositions and conjunctions do not hang at the end of a line,
// particles and dashes do not start a line. Display only: feedback.md is not built from this.
export function typography(text) {
  return text
    .replace(/(?<=^|[\s(«„"])([А-Яа-яЁё]{1,2}|для|при|без|над|под|про|что|как) /gu, '$1 ')
    .replace(/ (же|ли|бы)(?=[\s.,;:!?)»]|$)/gu, ' $1')
    .replace(/ —/g, ' —');
}

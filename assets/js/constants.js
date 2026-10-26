// Viewer constants, user-visible word forms shared across modules, and platform detection.

export const TOKEN = new URLSearchParams(location.search).get('t') || '';
export const BIG_FILE_LINES = 1500;
export const CLOSE_AFTER_S = 3;       // seconds after submit before the tab closes
export const EXPAND_STEP = 20;       // lines revealed per click on the gap's up / down button
export const TREE_MIN = 220, TREE_MAX = 480, TREE_DEFAULT = 300; // file tree width, px
export const SPLIT_MIN_MAIN = 900;   // narrower than this, side-by-side view is not available
export const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum|packages\.lock\.json)$/;
export const STATUS = {
  added: ['A', 'новый'], modified: ['M', 'изменён'], deleted: ['D', 'удалён'],
  renamed: ['R', 'переименован'], copied: ['C', 'скопирован'], typechange: ['T', 'тип изменён'],
};
export const FILES = ['файл', 'файла', 'файлов'];
export const LINES = ['строка', 'строки', 'строк'];

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
export const narrowScreen = matchMedia('(max-width: 1099.98px)');
export const isMac = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
export const isMod = (e) => (isMac ? e.metaKey : e.ctrlKey);
export const MOD_ENTER = isMac ? '⌘Enter' : 'Ctrl+Enter';
export const NOTES = ['комментарий', 'комментария', 'комментариев'];

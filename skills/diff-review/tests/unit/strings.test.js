// Tests of the viewer-side formatters in strings.js that turn meta.json and server codes into page text.
// Before meta v3, collect.py wrote these Russian texts itself (86cb294:scripts/collect.py); for v3 data the
// viewer must produce exactly the same text, and older outdirs must keep showing theirs verbatim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { T } from '../../assets/js/strings.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const readMeta = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'meta.json'), 'utf8'));

describe('rangeLabel', () => {
  // [meta.range, the label the old collect.py wrote for the same diff]
  const cases = [
    [{ mode: 'since-base', base: 'main' }, 'main...HEAD + незакоммиченное'],
    [{ mode: 'since-base', base: 'origin/develop' }, 'origin/develop...HEAD + незакоммиченное'],
    [{ mode: 'uncommitted', hasCommits: true }, 'HEAD + незакоммиченное'],
    [{ mode: 'uncommitted', hasCommits: false }, 'рабочее дерево (коммитов нет)'],
    [{ mode: 'staged' }, 'индекс (staged)'],
    [
      { mode: 'commit', sha: '6aabd5da38319abb781e559a24fa196cbecea60c', subject: 'второй: правка' },
      '6aabd5da38 второй: правка',
    ],
    [{ mode: 'range', from: 'main', dots: '..', to: 'feat' }, 'main..feat'],
    [{ mode: 'range', from: 'main', dots: '...', to: 'feat' }, 'main...feat'],
    [{ mode: 'range', from: 'HEAD~3', dots: '..', to: 'HEAD' }, 'HEAD~3..HEAD'],
    [{ mode: 'branch', base: 'main', ref: 'feature/x' }, 'main...feature/x'],
  ];
  for (const [range, label] of cases) {
    test(`${JSON.stringify(range)} gives the old collect.py label`, () => {
      assert.equal(T.rangeLabel({ version: 3, label: 'English label for the session', range }), label);
    });
  }

  test('meta v1/v2 without range shows the stored label verbatim', () => {
    assert.equal(T.rangeLabel({ version: 1, label: 'main...HEAD + незакоммиченное' }), 'main...HEAD + незакоммиченное');
    assert.equal(T.rangeLabel({ version: 2, label: 'индекс (staged)', range: null }), 'индекс (staged)');
  });

  test('an unknown range mode falls back to the label', () => {
    assert.equal(T.rangeLabel({ label: 'some label', range: { mode: 'future-mode' } }), 'some label');
  });
});

describe('feedback range line', () => {
  // The golden feedback.md is produced from the v1 fixture "mixed"; the v3 fixture "mixed2" describes the same
  // since-base range as structured data and must render the same line.
  const goldenLine = fs
    .readFileSync(path.join(FIXTURES, 'mixed', 'feedback.golden.md'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('- Диапазон: '));

  test('the golden file has a range line', () => {
    assert.equal(goldenLine, '- Диапазон: main...HEAD + незакоммиченное');
  });

  test('meta v1 (mixed) renders the golden range line', () => {
    const meta = readMeta('mixed');
    assert.equal(meta.version, 1);
    assert.equal(T.feedback.range(T.rangeLabel(meta)), goldenLine);
  });

  test('meta v3 (mixed2) renders the golden range line', () => {
    const meta = readMeta('mixed2');
    assert.equal(meta.version, 3);
    assert.ok(meta.range, 'mixed2 carries a structured range');
    assert.equal(T.feedback.range(T.rangeLabel(meta)), goldenLine);
  });
});

describe('fullTextReason', () => {
  // [content.reason code, the text the old collect.py wrote]
  const cases = [
    ['binary', 'бинарный файл'],
    ['unchanged', 'содержимое не менялось'],
    ['unreadable', 'не удалось прочитать файл'],
    ['total_limit', 'превышен общий лимит полного текста'],
    ['not_collected', 'не собран'],
    ['in_diff', 'весь файл уже в диффе'],
  ];
  for (const [reason, text] of cases) {
    test(`${reason} gives the old text`, () => {
      assert.equal(T.fullTextReason({ available: false, reason }), text);
    });
  }

  test('too_large uses limitKiB', () => {
    assert.equal(T.fullTextReason({ available: false, reason: 'too_large', limitKiB: 1024 }), 'файл больше 1024 КиБ');
    assert.equal(T.fullTextReason({ available: false, reason: 'too_large', limitKiB: 512 }), 'файл больше 512 КиБ');
  });

  test('a legacy Russian reason string is shown verbatim', () => {
    assert.equal(T.fullTextReason({ available: false, reason: 'файл больше 1024 КиБ' }), 'файл больше 1024 КиБ');
  });

  test('an unknown code is shown verbatim, inherited object keys are not codes', () => {
    assert.equal(T.fullTextReason({ available: false, reason: 'future_reason' }), 'future_reason');
    assert.equal(T.fullTextReason({ available: false, reason: 'toString' }), 'toString');
  });
});

describe('note', () => {
  // [notes[].code, the text the old collect.py wrote]
  const cases = [
    ['no_commits', 'в репозитории нет коммитов, взяты все файлы рабочего дерева'],
    ['base_not_found', 'базовая ветка не найдена, взяты только незакоммиченные изменения'],
    [
      'full_text_mismatch',
      'полный текст файлов не собран: вывод git не сошёлся со списком файлов, раскрытие контекста недоступно',
    ],
  ];
  for (const [code, text] of cases) {
    test(`${code} gives the old text`, () => {
      assert.equal(T.note({ code, text: 'English text for the session' }), text);
    });
  }

  test('a legacy string note is shown verbatim', () => {
    assert.equal(T.note('базовая ветка не найдена'), 'базовая ветка не найдена');
  });

  test('an unknown code falls back to the note text', () => {
    assert.equal(T.note({ code: 'future_note', text: 'something new' }), 'something new');
    assert.equal(T.note({ code: 'toString', text: 'plain text' }), 'plain text');
  });
});

describe('serverError', () => {
  const cases = [
    ['request_too_large', 'слишком большой запрос'],
    ['empty_feedback', 'пустой фидбек'],
    ['already_submitted', 'уже отправлено'],
  ];
  for (const [code, text] of cases) {
    test(`${code} is replaced by its text inside the raw body`, () => {
      // serve.py sends json.dumps output, with a space after the colon.
      assert.equal(T.serverError(`{"error": "${code}"}`), `{"error": "${text}"}`);
    });
  }

  test('an unknown code, a body without error and a non-JSON body stay as they are', () => {
    for (const body of ['{"error": "token"}', '{"ok": true}', 'null', '<html>502</html>', '']) {
      assert.equal(T.serverError(body), body);
    }
  });
});

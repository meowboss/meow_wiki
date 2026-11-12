import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRevisionDiff } from '../web/features/workshop/WorkshopRevisionHistory.tsx';

test('revision diff compares historical source against current draft by line index', () => {
  assert.deepEqual(summarizeRevisionDiff('one\ntwo', 'one\nchanged\nthree'), {
    added: 2,
    removed: 1,
    unchanged: 1,
  });
  assert.deepEqual(summarizeRevisionDiff('one\ntwo', 'one'), {
    added: 0,
    removed: 1,
    unchanged: 1,
  });
});

test('revision diff handles empty source, unchanged source, CRLF and trailing newlines', () => {
  assert.deepEqual(summarizeRevisionDiff('', ''), { added: 0, removed: 0, unchanged: 0 });
  assert.deepEqual(summarizeRevisionDiff('', 'line'), { added: 1, removed: 0, unchanged: 0 });
  assert.deepEqual(summarizeRevisionDiff('line', ''), { added: 0, removed: 1, unchanged: 0 });
  assert.deepEqual(summarizeRevisionDiff('一\r\n🙂', '一\n🙂'), {
    added: 0,
    removed: 0,
    unchanged: 2,
  });
  assert.deepEqual(summarizeRevisionDiff('line', 'line\n'), { added: 1, removed: 0, unchanged: 1 });
});

test('revision diff intentionally counts shifted lines rather than using LCS', () => {
  assert.deepEqual(summarizeRevisionDiff('a\nb\nc', 'x\na\nb\nc'), {
    added: 4,
    removed: 3,
    unchanged: 0,
  });
});

test('revision diff processes large line counts without quadratic edit tables', () => {
  const content = 'line\n'.repeat(30000);
  assert.deepEqual(summarizeRevisionDiff(content, content), {
    added: 0,
    removed: 0,
    unchanged: 30001,
  });
});

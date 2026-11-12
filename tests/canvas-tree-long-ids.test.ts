import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTree } from '../web/features/canvas/tree-operations.ts';
import { validateLayoutTree } from '../packages/canvas-contract/layout-tree.ts';
test('valid maximum-length instance ids do not overflow generated tree node ids', () => {
  const ids = ['a'.repeat(64), 'b'.repeat(64)];
  assert.equal(validateLayoutTree(createTree(ids), ids).valid, true);
});

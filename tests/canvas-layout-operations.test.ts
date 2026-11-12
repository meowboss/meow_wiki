import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultComposition } from '../packages/canvas-contract/index.ts';
import { moveCanvasInstance } from '../web/features/canvas/layout-operations.ts';
test('canvas ordering is immutable, bounded and preserves instance identity and configuration', () => {
  const source = createDefaultComposition('wiki');
  source.instances = source.instances.filter((i) =>
    ['wiki-directory', 'wiki-document'].includes(i.id),
  );
  const before = structuredClone(source);
  const moved = moveCanvasInstance(source, 'wiki-document', -1);
  assert.deepEqual(source, before);
  assert.equal(moved.instances[0].id, 'wiki-document');
  assert.equal(moved.instances[0], source.instances[1]);
  assert.equal(moved.revision, source.revision);
  assert.equal(moveCanvasInstance(source, 'missing', 1), source);
  assert.equal(moveCanvasInstance(source, 'wiki-directory', -1), source);
  assert.deepEqual(moveCanvasInstance(moved, 'wiki-document', 1), source);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultComposition } from '../packages/canvas-contract/index.ts';
import { alignCanvasInstance } from '../web/features/canvas/alignment-operations.ts';
test('alignment preserves instance identity and config while respecting logical bounds', () => {
  const instance = createDefaultComposition('wiki').instances.find(
      (i) => i.id === 'wiki-directory',
    )!,
    copy = structuredClone(instance);
  assert.equal(alignCanvasInstance(instance, 'left').x, 0);
  assert.equal(alignCanvasInstance(instance, 'center').x, 4);
  assert.equal(alignCanvasInstance(instance, 'right').x, 8);
  assert.equal(alignCanvasInstance(instance, 'full').w, 12);
  assert.equal(alignCanvasInstance(instance, 'full').x, 0);
  assert.deepEqual(instance, copy);
  assert.equal(alignCanvasInstance(instance, 'center').config, instance.config);
});

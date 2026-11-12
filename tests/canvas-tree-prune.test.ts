import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeCanvasTreeInstance } from '../web/features/canvas/CanvasTree.tsx';
import type { LayoutTree } from '../packages/canvas-contract/layout-tree.ts';
test('removing a leaf preserves unrelated prepared empty containers', () => {
  const prepared: LayoutTree = { id: 'prepared', kind: 'grid', columns: 2, children: [] };
  const source: LayoutTree = {
    id: 'root',
    kind: 'flow',
    children: [
      { id: 'a', kind: 'view', instanceId: 'a' },
      { id: 'b', kind: 'view', instanceId: 'b' },
      prepared,
    ],
  };
  const result = removeCanvasTreeInstance(source, 'a');
  assert.equal(result.kind, 'flow');
  assert.equal(result.children?.length, 2);
  assert.equal(result.children?.[1], prepared);
});

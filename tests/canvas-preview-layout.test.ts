import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultComposition } from '../packages/canvas-contract/index.ts';
import {
  canvasBoardClassName,
  canvasBoardStyle,
  canvasItemStyle,
} from '../web/features/canvas/shared-layout-style.ts';

test('preview style preserves instance style, logical grid and drag coordinates without mutations', () => {
  const item = {
    ...createDefaultComposition('home').instances[0]!,
    x: 3,
    y: 2,
    w: 6,
    h: 4,
    style: { background: '#ffffff', color: '#123456', padding: 12, borderRadius: 8 },
  };
  const before = structuredClone(item);
  assert.deepEqual(canvasItemStyle(item), {
    ...item.style,
    gridColumn: '4 / span 6',
    gridRow: '3 / span 4',
    '--canvas-x': 3,
    '--canvas-y': 2,
    '--canvas-w': 6,
    '--canvas-h': 4,
  });
  assert.equal(canvasItemStyle(item, { id: item.id, x: 10, y: 5 }).gridColumn, '7 / span 6');
  assert.equal(canvasItemStyle(item, { id: 'other', x: 0, y: 0 }).gridRow, '3 / span 4');
  assert.deepEqual(item, before);
});

test('preview board shares theme, visibility height and wiki/tree/layer classes', () => {
  const composition = createDefaultComposition('wiki');
  composition.theme = { font: 'mono', accent: '#abcdef' };
  composition.instances.push({
    ...composition.instances[0]!,
    id: 'hidden',
    visible: false,
    y: 100,
    h: 24,
  });
  const before = structuredClone(composition);
  const preview = canvasBoardStyle(composition) as Record<string, unknown>;
  assert.equal(preview['--canvas-columns'], 12);
  assert.equal(preview['--canvas-font-family'], 'ui-monospace, monospace');
  assert.equal(preview['--canvas-accent'], '#abcdef');
  assert.equal(preview.background, composition.background);
  assert.notEqual(
    preview['--canvas-height'],
    (canvasBoardStyle(composition, true) as Record<string, unknown>)['--canvas-height'],
  );
  assert.match(canvasBoardClassName(composition), /canvas-themed/);
  assert.match(canvasBoardClassName(composition), /canvas-default-wiki/);
  assert.doesNotMatch(canvasBoardClassName(composition), /canvas-editing-board/);
  composition.tree = { id: 'root', kind: 'flow', children: [] };
  assert.match(canvasBoardClassName(composition), /canvas-has-tree/);
  delete composition.tree;
  assert.deepEqual(composition, before);
});

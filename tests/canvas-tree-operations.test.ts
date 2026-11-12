import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLayoutTree, type LayoutTree } from '../packages/canvas-contract/layout-tree.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createDefaultComposition } from '../packages/canvas-contract/index.ts';
import CanvasTreeInspector from '../web/features/canvas/CanvasTreeInspector.tsx';
import {
  addContainer,
  createTree,
  moveLeaf,
  reorderLeaf,
  updateContainer,
} from '../web/features/canvas/tree-operations.ts';

function children(tree: LayoutTree): LayoutTree[] {
  assert.notEqual(tree.kind, 'view');
  return tree.kind === 'view' ? [] : (tree.children ?? []);
}
function freeze(tree: LayoutTree) {
  if (tree.kind !== 'view') {
    tree.children?.forEach(freeze);
    if (tree.children) Object.freeze(tree.children);
  }
  Object.freeze(tree);
}

test('createTree covers all instances with deterministic stable leaf IDs', () => {
  const ids = Object.freeze(['first', 'second']);
  const tree = createTree(ids);
  assert.deepEqual(tree, {
    id: 'root',
    kind: 'flow',
    direction: 'column',
    children: [
      { id: 'node-0', kind: 'view', instanceId: 'first' },
      { id: 'node-1', kind: 'view', instanceId: 'second' },
    ],
  });
  assert.deepEqual(validateLayoutTree(tree, [...ids]), { valid: true, issues: [] });
  assert.deepEqual(createTree(ids), tree);
  assert.ok(validateLayoutTree(createTree([]), []).valid);
});

test('adding an empty container is immutable and preserves all unchanged references', () => {
  const source = createTree(['first', 'second']);
  const before = structuredClone(source);
  freeze(source);
  const next = addContainer(source, 'root', 'row', 'row-one');
  assert.notEqual(next, source);
  assert.equal(children(next)[0], children(source)[0]);
  assert.equal(children(next)[1], children(source)[1]);
  assert.deepEqual(children(next)[2], {
    id: 'row-one',
    kind: 'flow',
    direction: 'row',
    children: [],
  });
  assert.deepEqual(source, before);
  assert.ok(validateLayoutTree(next, ['first', 'second']).valid);
  const grid = addContainer(next, 'row-one', 'grid', 'grid-one');
  assert.equal(children(grid)[0], children(next)[0]);
  assert.deepEqual(children(children(grid)[2])[0], {
    id: 'grid-one',
    kind: 'grid',
    columns: 2,
    children: [],
  });
});

test('moveLeaf removes original parent reference and appends same leaf without loss', () => {
  let source = addContainer(createTree(['first', 'second']), 'root', 'column', 'column-one');
  source = addContainer(source, 'root', 'grid', 'grid-one');
  if (source.kind !== 'view') source = { ...source, gap: 17 };
  const before = structuredClone(source);
  const leaf = children(source)[0];
  const untouched = children(source)[3];
  freeze(source);
  const moved = moveLeaf(source, 'first', 'column-one');
  assert.deepEqual(source, before);
  assert.equal(children(moved).length, 3);
  assert.equal(children(children(moved)[1])[0], leaf);
  assert.equal(children(moved)[2], untouched);
  assert.equal(moved.kind === 'flow' && moved.gap, 17);
  assert.ok(validateLayoutTree(moved, ['first', 'second']).valid);
  const returned = moveLeaf(moved, 'first', 'root');
  assert.equal(children(returned).at(-1), leaf);
  assert.deepEqual(children(children(returned)[1]), []);
  assert.ok(validateLayoutTree(returned, ['first', 'second']).valid);
  assert.equal(moveLeaf(returned, 'first', 'root'), returned);
});

test('operations reject missing or leaf destinations and unknown instances without mutation', () => {
  const source = createTree(['first']);
  const before = structuredClone(source);
  for (const target of ['missing', 'node-0']) {
    assert.throws(() => addContainer(source, target, 'row', 'new-node'), /container/);
    assert.throws(() => moveLeaf(source, 'first', target), /container/);
  }
  assert.throws(() => moveLeaf(source, 'missing', 'root'), /no view leaf/);
  const leaf: LayoutTree = { id: 'leaf', kind: 'view', instanceId: 'first' };
  assert.throws(() => addContainer(leaf, 'leaf', 'row', 'new-node'), /container/);
  assert.throws(() => moveLeaf(leaf, 'first', 'leaf'), /container/);
  assert.deepEqual(source, before);
});

test('maximum depth is six, including empty containers and moved leaves', () => {
  let source = createTree(['first']);
  let target = 'root';
  for (let depth = 2; depth <= 6; depth++) {
    const nextId = `depth-${depth}`;
    source = addContainer(source, target, 'column', nextId);
    target = nextId;
  }
  const before = structuredClone(source);
  assert.throws(() => addContainer(source, target, 'row', 'too-deep'), /depth 6/);
  assert.throws(() => moveLeaf(source, 'first', target), /depth 6/);
  assert.deepEqual(source, before);
  assert.ok(validateLayoutTree(moveLeaf(source, 'first', 'depth-5'), ['first']).valid);
});

test('duplicate IDs, duplicate instance references and invalid schema are rejected', () => {
  assert.throws(() => createTree(['same', 'same']), /Duplicate/);
  assert.throws(() => createTree(['invalid id']), /Invalid|format/i);
  const source = createTree(['first']);
  assert.throws(() => addContainer(source, 'root', 'row', 'node-0'), /Duplicate node ID/);
  assert.throws(() => addContainer(source, 'root', 'row', 'bad id'), /Invalid|format/i);
  const duplicate: LayoutTree = {
    id: 'root',
    kind: 'grid',
    children: [
      { id: 'one', kind: 'view', instanceId: 'first' },
      { id: 'two', kind: 'view', instanceId: 'first' },
    ],
  };
  assert.throws(() => moveLeaf(duplicate, 'first', 'root'), /Duplicate instance/);
  const duplicateNode: LayoutTree = {
    id: 'root',
    kind: 'flow',
    children: [
      { id: 'same', kind: 'grid' },
      { id: 'same', kind: 'grid' },
    ],
  };
  assert.throws(() => addContainer(duplicateNode, 'root', 'row', 'new'), /Duplicate node ID/);
});

test('container updates preserve leaves, children arrays and untouched branches', () => {
  const source = addContainer(createTree(['first', 'second']), 'root', 'grid', 'grid');
  const before = structuredClone(source);
  freeze(source);
  const next = updateContainer(source, 'grid', { gap: 0, columns: 12 });
  assert.deepEqual(source, before);
  assert.equal(children(next)[0], children(source)[0]);
  assert.equal(children(next)[1], children(source)[1]);
  assert.equal(children(children(next)[2]), children(children(source)[2]));
  assert.deepEqual(children(next)[2], { ...children(source)[2], gap: 0, columns: 12 });
  assert.ok(validateLayoutTree(next, ['first', 'second']).valid);
  const root = updateContainer(next, 'root', { gap: 48, direction: 'row' });
  assert.equal(children(root), children(next));
  assert.equal(updateContainer(root, 'root', { gap: 48 }), root);
  assert.equal(updateContainer(root, 'root', {}), root);
});

test('container updates reject incompatible, unknown and invalid properties without mutation', () => {
  const source = addContainer(createTree(['first']), 'root', 'grid', 'grid');
  const before = structuredClone(source);
  freeze(source);
  assert.throws(() => updateContainer(source, 'root', { columns: 2 }), /field/);
  assert.throws(() => updateContainer(source, 'grid', { direction: 'row' }), /field/);
  for (const patch of [{ id: 'renamed' }, { children: [] }, { kind: 'grid' }, { extra: 1 }])
    assert.throws(() => updateContainer(source, 'root', patch as never), /field/);
  for (const gap of [-1, 49, 1.5, NaN, Infinity])
    assert.throws(() => updateContainer(source, 'root', { gap }));
  for (const columns of [0, 13, 1.5, NaN])
    assert.throws(() => updateContainer(source, 'grid', { columns }));
  assert.throws(() => updateContainer(source, 'root', { direction: 'diagonal' } as never));
  for (const id of ['missing', 'node-0'])
    assert.throws(() => updateContainer(source, id, { gap: 1 }), /container/);
  assert.deepEqual(source, before);
});

test('reorderLeaf moves among same-parent siblings with stable references and flat order', () => {
  let source = addContainer(createTree(['first', 'second', 'third']), 'root', 'grid', 'grid');
  source = moveLeaf(source, 'first', 'grid');
  source = moveLeaf(source, 'second', 'grid');
  const before = structuredClone(source);
  const originalParent = children(source)[1];
  const originalLeaves = children(originalParent);
  freeze(source);
  const next = reorderLeaf(source, 'first', 1);
  assert.deepEqual(source, before);
  assert.equal(children(next)[0], children(source)[0]);
  assert.deepEqual(children(children(next)[1]), [originalLeaves[1], originalLeaves[0]]);
  assert.equal(children(children(next)[1])[0], originalLeaves[1]);
  assert.equal(children(children(next)[1])[1], originalLeaves[0]);
  assert.ok(validateLayoutTree(next, ['first', 'second', 'third']).valid);
  assert.deepEqual(reorderLeaf(next, 'first', -1), source);
});

test('reorderLeaf bounds moves, handles root leaves and rejects invalid input', () => {
  const source = createTree(['first', 'second', 'third']);
  freeze(source);
  assert.equal(reorderLeaf(source, 'first', -1), source);
  assert.equal(reorderLeaf(source, 'third', 1), source);
  assert.equal(reorderLeaf(source, 'second', 0), source);
  assert.equal(children(reorderLeaf(source, 'first', 99)).at(-1), children(source)[0]);
  assert.equal(children(reorderLeaf(source, 'third', -99))[0], children(source)[2]);
  assert.throws(() => reorderLeaf(source, 'missing', 1), /no view leaf/);
  for (const delta of [NaN, Infinity, 0.5])
    assert.throws(() => reorderLeaf(source, 'first', delta), /integer/);
  const leaf: LayoutTree = { id: 'root', kind: 'view', instanceId: 'first' };
  assert.equal(reorderLeaf(leaf, 'first', 1), leaf);
  const invalid = { ...source, gap: -1 } as LayoutTree;
  assert.throws(() => reorderLeaf(invalid, 'first', 0));
  assert.throws(() => updateContainer(invalid, 'root', { gap: 1 }));
});

test('inspector uses native keyboard inputs and only shows kind-compatible properties', () => {
  const composition = createDefaultComposition('home');
  const ids = composition.instances.map((instance) => instance.id);
  const render = (tree: LayoutTree, selectedId = ids[0]) =>
    renderToStaticMarkup(
      createElement(CanvasTreeInspector, {
        composition: { ...composition, tree },
        selectedId,
        disabled: false,
        onChange: () => {},
      }),
    );
  const flow = render(createTree(ids));
  assert.match(flow, /type="number" min="0" max="48" step="1"/);
  assert.match(flow, /排列方向<select/);
  assert.doesNotMatch(flow, /网格列数/);
  assert.match(flow, /嵌套前移/);
  assert.match(flow, /嵌套后移/);
  const tree = { ...createTree(ids), kind: 'grid', direction: undefined };
  delete tree.direction;
  const grid = render(tree as LayoutTree);
  assert.match(grid, /type="number" min="1" max="12" step="1"/);
  assert.doesNotMatch(grid, /排列方向/);
  assert.doesNotMatch(render(createTree(ids), 'missing'), /嵌套前移|嵌套后移/);
  // No inspector-level key interception: arrows and typing stay native to number/select inputs.
  const source = readFileSync('web/features/canvas/CanvasTreeInspector.tsx', 'utf8');
  assert.doesNotMatch(source, /onKeyDown|onKeyUp|preventDefault/);
  assert.doesNotMatch(source, /instances\.(?:sort|reverse|splice)/);
});

test('empty containers count towards the node and child budgets', () => {
  let source = createTree([]);
  for (let index = 0; index < 40; index++)
    source = addContainer(source, 'root', 'row', `child-${index}`);
  assert.throws(() => addContainer(source, 'root', 'row', 'overflow'), /40/);
  for (let index = 0; index < 39; index++)
    source = addContainer(source, 'child-0', 'grid', `nested-${index}`);
  assert.ok(validateLayoutTree(source, []).valid);
  assert.throws(() => addContainer(source, 'child-1', 'row', 'node-81'), /80 nodes/);
});

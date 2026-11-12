import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLayoutTree, type LayoutTree } from '../packages/canvas-contract/layout-tree.ts';
import { addContainer, createTree, moveLeaf } from '../web/features/canvas/tree-operations.ts';

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

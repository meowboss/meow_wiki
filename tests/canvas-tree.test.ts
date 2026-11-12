import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutTreeSchema,
  validateLayoutTree,
  type LayoutTree,
} from '../packages/canvas-contract/layout-tree.ts';

const view = (id: string, instanceId = id): LayoutTree => ({ id, kind: 'view', instanceId });
const nested = (): LayoutTree => ({
  id: 'root',
  kind: 'flow',
  direction: 'column',
  gap: 48,
  children: [
    view('header'),
    { id: 'grid', kind: 'grid', columns: 12, gap: 0, children: [view('left'), view('right')] },
  ],
});
const chain = (depth: number): LayoutTree => {
  let tree = view('leaf');
  for (let i = 1; i < depth; i++) {
    tree = { id: `container-${i}`, kind: 'flow', children: [tree] };
  }
  return tree;
};
const assertInvalid = (tree: unknown, ids: string[], issue: RegExp) => {
  const result = validateLayoutTree(tree, ids);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((message) => issue.test(message)),
    result.issues.join('\n'),
  );
};

test('nested flow/grid tree and single view cover every instance without mutation', () => {
  const tree = nested();
  const before = structuredClone(tree);
  assert.equal(layoutTreeSchema.safeParse(tree).success, true);
  assert.deepEqual(validateLayoutTree(tree, ['header', 'left', 'right']), {
    valid: true,
    issues: [],
  });
  assert.deepEqual(tree, before);
  assert.deepEqual(validateLayoutTree(view('solo'), ['solo']), { valid: true, issues: [] });
  assert.equal(validateLayoutTree({ id: 'empty', kind: 'flow' }, []).valid, true);
});

test('schema is strict and fields belong only to their discriminated node kind', () => {
  for (const tree of [
    { ...nested(), unexpected: true },
    { id: 'bad', kind: 'group' },
    { id: 'bad', kind: 'flow', columns: 2 },
    { id: 'bad', kind: 'grid', direction: 'row' },
    { id: 'bad', kind: 'flow', instanceId: 'x' },
    { ...view('x'), children: [] },
    { ...view('x'), gap: 0 },
    { id: 'bad', kind: 'view' },
  ]) {
    assert.equal(layoutTreeSchema.safeParse(tree).success, false);
    assert.equal(validateLayoutTree(tree, []).valid, false);
  }
});

test('schema enforces slug, direction, numeric and per-container child bounds', () => {
  for (const tree of [
    view(''),
    view('x'.repeat(65)),
    view('bad id'),
    view('ok', 'bad/id'),
    { id: 'bad', kind: 'flow', direction: 'diagonal' },
    { id: 'bad', kind: 'flow', gap: -1 },
    { id: 'bad', kind: 'flow', gap: 49 },
    { id: 'bad', kind: 'flow', gap: 1.5 },
    ...[0, 13, 1.5].map((columns) => ({ id: 'bad', kind: 'grid', columns })),
    { id: 'bad', kind: 'flow', children: Array.from({ length: 41 }, (_, i) => view(`v${i}`)) },
  ]) {
    assert.equal(layoutTreeSchema.safeParse(tree).success, false);
  }
  assert.equal(layoutTreeSchema.safeParse(view('x'.repeat(64))).success, true);
});

test('unknown, duplicate and missing instance references are rejected', () => {
  assertInvalid(view('unknown'), ['known'], /Unknown instance reference/);
  assertInvalid(
    { id: 'root', kind: 'flow', children: [view('a', 'x'), view('b', 'x')] },
    ['x'],
    /Duplicate instance reference/,
  );
  assertInvalid(view('a'), ['a', 'lost'], /Missing instance reference: lost/);
});

test('node IDs are globally unique even across different kinds', () => {
  assertInvalid(
    { id: 'same', kind: 'grid', children: [view('same', 'x')] },
    ['x'],
    /Duplicate node ID/,
  );
});

test('root depth is one: six levels pass and seven or extreme depth fail safely', () => {
  assert.equal(validateLayoutTree(chain(6), ['leaf']).valid, true);
  assertInvalid(chain(7), ['leaf'], /maximum depth 6/);
  assertInvalid(chain(20_000), ['leaf'], /maximum depth 6/);
});

test('80 total nodes pass and 81 fail, independently of child-array limits', () => {
  const budgetTree = (leaves: number): LayoutTree => ({
    id: 'root',
    kind: 'flow',
    children: [
      { id: 'left', kind: 'grid', children: Array.from({ length: 40 }, (_, i) => view(`v${i}`)) },
      {
        id: 'right',
        kind: 'grid',
        children: Array.from({ length: leaves - 40 }, (_, i) => view(`v${i + 40}`)),
      },
    ],
  });
  assert.equal(
    validateLayoutTree(
      budgetTree(77),
      Array.from({ length: 77 }, (_, i) => `v${i}`),
    ).valid,
    true,
  );
  assertInvalid(budgetTree(78), [], /maximum 80 nodes/);
});

test('actual JS self/mutual cycles and shared nodes fail without recursive overflow', () => {
  const self: { id: string; kind: 'flow'; children: unknown[] } = {
    id: 'self',
    kind: 'flow',
    children: [],
  };
  self.children.push(self);
  assertInvalid(self, [], /cycle/);
  const other = { id: 'other', kind: 'grid', children: [self] };
  self.children = [other];
  assertInvalid(self, [], /cycle/);
  const shared = view('shared');
  assertInvalid(
    { id: 'root', kind: 'flow', children: [shared, shared] },
    ['shared'],
    /shared node/,
  );
});

test('malformed JS inputs and throwing property access return invalid instead of throwing', () => {
  for (const tree of [null, undefined, [], 'tree', 0, { id: 'root', kind: 'flow', children: {} }]) {
    assert.equal(validateLayoutTree(tree, []).valid, false);
  }
  const throwing = Object.defineProperty({}, 'children', {
    get() {
      throw new Error('not JSON');
    },
  });
  assertInvalid(throwing, [], /JSON-compatible/);
});

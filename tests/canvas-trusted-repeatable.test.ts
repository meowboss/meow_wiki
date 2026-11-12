import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compositionSchema,
  compositionDocumentSchema,
  createDefaultComposition,
} from '../packages/canvas-contract/index.ts';
test('trusted repeatability agrees with editor and both persisted contracts', () => {
  const doc = createDefaultComposition('home');
  const base = doc.instances[0];
  doc.instances = [
    { ...base, id: 'first', viewId: 'official.sample.card' },
    { ...base, id: 'second', viewId: 'official.sample.card' },
  ];
  assert.equal(compositionSchema.safeParse(doc).success, true);
  const { revision: _, ...body } = doc;
  assert.equal(compositionDocumentSchema.safeParse(body).success, true);
  doc.instances[1] = { ...doc.instances[1], viewId: 'home.content' };
  doc.instances[0] = { ...doc.instances[0], viewId: 'home.content' };
  assert.equal(compositionSchema.safeParse(doc).success, false);
});

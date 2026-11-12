import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultComposition } from '../packages/canvas-contract/index';
import {
  MAX_CANVAS_DRAFT_BYTES,
  canvasDraftKey,
  clearCanvasDraft,
  readCanvasDraft,
  saveCanvasDraft,
  type CanvasDraft,
  type CanvasDraftScope,
  type DraftStorage,
} from '../web/features/canvas/draft-storage';

class MemoryStorage implements DraftStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}
const scope: CanvasDraftScope = { ownerId: 'owner-a', workspaceId: 'workspace-a', surface: 'wiki' };
const draft = (): CanvasDraft => ({
  composition: { ...createDefaultComposition('wiki'), revision: 7, gap: 24 },
  baseRevision: 7,
  savedAt: 123456,
});

test('draft storage saves and reads a strict composition without browser globals', () => {
  const storage = new MemoryStorage();
  assert.equal(saveCanvasDraft(scope, draft(), storage), true);
  assert.deepEqual(readCanvasDraft(scope, storage), draft());
  assert.equal(canvasDraftKey(scope), 'meow.canvas.draft:owner-a:workspace-a:wiki');
});

test('draft storage isolates owners, workspaces and surfaces and clears only one scope', () => {
  const storage = new MemoryStorage();
  const otherOwner = { ...scope, ownerId: 'owner-b' };
  const otherWorkspace = { ...scope, workspaceId: 'workspace-b' };
  saveCanvasDraft(scope, draft(), storage);
  assert.equal(readCanvasDraft(otherOwner, storage), null);
  assert.equal(readCanvasDraft(otherWorkspace, storage), null);
  assert.equal(readCanvasDraft({ ...scope, surface: 'home' }, storage), null);
  saveCanvasDraft(otherOwner, draft(), storage);
  saveCanvasDraft(otherWorkspace, draft(), storage);
  clearCanvasDraft(scope, storage);
  assert.equal(readCanvasDraft(scope, storage), null);
  assert.deepEqual(readCanvasDraft(otherOwner, storage), draft());
  assert.deepEqual(readCanvasDraft(otherWorkspace, storage), draft());
  assert.notEqual(
    canvasDraftKey({ ...scope, ownerId: 'a:b', workspaceId: 'c' }),
    canvasDraftKey({ ...scope, ownerId: 'a', workspaceId: 'b:c' }),
  );
});

test('malformed JSON, unknown fields, mismatched surface and changed schema versions are removed', () => {
  const storage = new MemoryStorage();
  const invalid = [
    '{',
    JSON.stringify({ ...draft(), token: 'unexpected' }),
    JSON.stringify({ ...draft(), baseRevision: -1 }),
    JSON.stringify({ ...draft(), baseRevision: 8 }),
    JSON.stringify({ ...draft(), savedAt: 'now' }),
    JSON.stringify({ ...draft(), composition: { ...draft().composition, secret: 'unexpected' } }),
    JSON.stringify({ ...draft(), composition: { ...draft().composition, schemaVersion: 1 } }),
    JSON.stringify({ ...draft(), composition: createDefaultComposition('home') }),
  ];
  for (const raw of invalid) {
    storage.setItem(canvasDraftKey(scope), raw);
    assert.equal(readCanvasDraft(scope, storage), null);
    assert.equal(storage.getItem(canvasDraftKey(scope)), null);
  }
});

test('oversized UTF-8 records are rejected and invalid writes preserve an existing draft', () => {
  const storage = new MemoryStorage();
  storage.setItem(canvasDraftKey(scope), '界'.repeat(Math.ceil(MAX_CANVAS_DRAFT_BYTES / 3)));
  assert.equal(readCanvasDraft(scope, storage), null);
  assert.equal(storage.getItem(canvasDraftKey(scope)), null);
  saveCanvasDraft(scope, draft(), storage);
  const tooLarge = draft();
  tooLarge.composition.instances = Array.from({ length: 40 }, (_, index) => ({
    id: `text-${index}`,
    viewId: 'builtin.text',
    visible: true,
    layer: 'content',
    x: 0,
    y: 0,
    w: 12,
    h: 1,
    config: { text: '\u0000'.repeat(5000) },
    style: {},
  }));
  // Legal text limits can still exceed the byte budget after JSON escaping.
  assert.equal(saveCanvasDraft(scope, tooLarge, storage), false);
  assert.deepEqual(readCanvasDraft(scope, storage), draft());
});

test('server revision changes do not rewrite the recovered base revision', () => {
  const storage = new MemoryStorage();
  saveCanvasDraft(scope, draft(), storage);
  const recovered = readCanvasDraft(scope, storage)!;
  const server = { ...createDefaultComposition('wiki'), revision: 9 };
  assert.notEqual(recovered.baseRevision, server.revision);
  assert.equal(recovered.composition.revision, 7);
  assert.deepEqual(readCanvasDraft(scope, storage), draft());
});

test('unavailable storage and empty identities do not throw or persist drafts', () => {
  const storage = new MemoryStorage();
  const unavailable: DraftStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(saveCanvasDraft(scope, draft(), unavailable), false);
  assert.equal(readCanvasDraft(scope, unavailable), null);
  assert.doesNotThrow(() => clearCanvasDraft(scope, unavailable));
  assert.equal(saveCanvasDraft({ ...scope, ownerId: '' }, draft(), storage), false);
  assert.equal(storage.items.size, 0);
  assert.equal(readCanvasDraft(scope, null), null);
});

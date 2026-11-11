import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AccessError, ConflictError, Store, type Page } from '../src/store.ts';
import { PageTransfer } from '../src/modules/pages/transfer.ts';

function bundle(
  pages = [{ id: 'legacy page/一', title: '标题', markdown: '', parentId: null as string | null }],
) {
  return {
    format: 'meow.pages.v1',
    version: 1,
    workspace: { name: '来源空间', description: '只验证，不覆盖' },
    pages,
  };
}

function fixture() {
  const store = new Store(':memory:');
  const alice = store.ensure('alice');
  const bob = store.ensure('bob');
  return { store, alice, bob, transfer: new PageTransfer(store) };
}

function snapshot(store: Store, owner: string, wid: string) {
  const workspace = store.get(owner, wid);
  return {
    workspace,
    history: workspace.pages.map((page) => store.history(owner, wid, page.id)),
  };
}

const badRequest = { statusCode: 400 };

test('export is owner scoped and whitelists live page content without secrets or configuration', () => {
  const { store, alice, bob, transfer } = fixture();
  try {
    store.change('alice', alice, (workspace) => {
      workspace.enabled.push('secret-plugin');
      workspace.components.push({
        id: 'secret-component',
        name: 'secret',
        description: '',
        template: 'secret-template',
        status: 'private',
        authorId: 'alice',
      });
      Object.assign(workspace, { user: 'private-user', secret: 'private-key' });
    });
    const deleted = store.get('alice', alice).pages[0];
    store.updatePage('alice', alice, deleted.id, 1, {}, 'delete');
    const before = snapshot(store, 'alice', alice);
    const exported = transfer.export('alice', alice);
    assert.deepEqual(exported, {
      format: 'meow.pages.v1',
      version: 1,
      workspace: { name: before.workspace.name, description: before.workspace.description },
      pages: before.workspace.pages
        .filter((page) => !page.deletedAt)
        .map(({ id, title, markdown, parentId }) => ({ id, title, markdown, parentId })),
    });
    const serialized = JSON.stringify(exported);
    for (const forbidden of [
      'private-user',
      'private-key',
      'secret-plugin',
      'secret-component',
      'secret-template',
      'authorId',
      'revision',
      'deletedAt',
      'updatedAt',
    ])
      assert.ok(!serialized.includes(forbidden), forbidden);
    assert.deepEqual(snapshot(store, 'alice', alice), before);
    assert.throws(() => transfer.export('bob', alice), AccessError);
    assert.throws(() => transfer.export('alice', bob), AccessError);
    assert.throws(() => transfer.import('bob', alice, bundle()), AccessError);
    assert.throws(() => transfer.import('alice', bob, bundle()), AccessError);
    assert.deepEqual(snapshot(store, 'alice', alice), before);
  } finally {
    store.close();
  }
});

test('import remaps all IDs and parents, preserves existing pages, target metadata and history', () => {
  const { store, alice, bob, transfer } = fixture();
  try {
    const before = snapshot(store, 'alice', alice);
    const foreign = snapshot(store, 'bob', bob);
    const existingId = before.workspace.pages[0].id;
    const input = bundle([
      { id: 'child', title: 'child', markdown: 'body', parentId: existingId },
      { id: existingId, title: 'parent', markdown: '', parentId: null },
      { id: '__proto__', title: 'legacy', markdown: '', parentId: 'child' },
    ]);
    const original = structuredClone(input);
    const result = transfer.import('alice', alice, input);
    assert.equal(result.imported, 3);
    assert.equal(result.mapping.length, 3);
    assert.deepEqual(input, original);
    const mapping = new Map(result.mapping.map(({ sourceId, id }) => [sourceId, id]));
    const after = store.get('alice', alice);
    assert.deepEqual({ ...after, pages: before.workspace.pages }, before.workspace);
    for (const old of before.workspace.pages) {
      assert.deepEqual(
        after.pages.find((page) => page.id === old.id),
        old,
      );
      assert.deepEqual(
        store.history('alice', alice, old.id),
        before.history.find((history) => history[0].id === old.id),
      );
    }
    for (const source of input.pages) {
      const id = mapping.get(source.id)!;
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.ok(!input.pages.some((page) => page.id === id));
      const page = after.pages.find((page) => page.id === id)!;
      assert.deepEqual(
        { ...page, updatedAt: '' },
        {
          id,
          title: source.title,
          markdown: source.markdown,
          parentId: source.parentId === null ? null : mapping.get(source.parentId),
          revision: 1,
          deletedAt: null,
          updatedAt: '',
        },
      );
      assert.ok(Number.isFinite(Date.parse(page.updatedAt)));
      assert.deepEqual(store.history('alice', alice, id), [
        { ...page, actorId: 'alice', operation: 'create' },
      ]);
    }
    assert.deepEqual(snapshot(store, 'bob', bob), foreign);
    const again = transfer.import('alice', alice, input);
    assert.ok(again.mapping.every(({ id }) => !result.mapping.some((old) => old.id === id)));
  } finally {
    store.close();
  }
});

test('invalid graphs and strict schema violations reject with 400 without any mutations', () => {
  const { store, alice, transfer } = fixture();
  try {
    const valid = bundle();
    const page = valid.pages[0];
    const invalid: unknown[] = [
      null,
      [],
      {},
      { ...valid, format: 'other' },
      { ...valid, version: 2 },
      { ...valid, secret: 'x' },
      { ...valid, workspace: { ...valid.workspace, user: 'x' } },
      { ...valid, workspace: { name: '', description: '' } },
      { ...valid, workspace: { name: 'x'.repeat(161), description: '' } },
      { ...valid, workspace: { name: 'x', description: 'x'.repeat(501) } },
      bundle([{ ...page, id: '' }]),
      bundle([{ ...page, id: 'x'.repeat(201) }]),
      bundle([{ ...page, id: 'bad\u0000id' }]),
      bundle([{ ...page, id: '\n' }]),
      bundle([{ ...page, title: '' }]),
      bundle([{ ...page, title: ' ' }]),
      bundle([{ ...page, title: 'x'.repeat(161) }]),
      bundle([{ ...page, markdown: 'x'.repeat(200_001) }]),
      bundle([{ ...page, revision: 1 } as typeof page]),
      bundle([{ ...page, parentId: 'missing' }]),
      bundle([{ ...page, parentId: page.id }]),
      bundle([page, { ...page }]),
      bundle([
        { ...page, id: 'a', parentId: 'b' },
        { ...page, id: 'b', parentId: 'a' },
      ]),
      bundle(Array.from({ length: 101 }, (_, i) => ({ ...page, id: String(i) }))),
      { ...valid, pages: [{ id: 'x', title: 'x', markdown: '' }] },
    ];
    const before = snapshot(store, 'alice', alice);
    for (const input of invalid) {
      assert.throws(() => transfer.import('alice', alice, input), badRequest);
      assert.deepEqual(snapshot(store, 'alice', alice), before);
    }
  } finally {
    store.close();
  }
});

test('UTF8 total uses bytes rather than characters and accepts per-page limits and empty bundles', () => {
  const { store, alice, transfer } = fixture();
  try {
    const over = bundle(
      Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        title: 'x',
        markdown: '界'.repeat(200_000),
        parentId: null,
      })),
    );
    assert.ok(JSON.stringify(over).length < 5 * 1024 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(over), 'utf8') > 5 * 1024 * 1024);
    const before = snapshot(store, 'alice', alice);
    assert.throws(() => transfer.import('alice', alice, over), badRequest);
    assert.deepEqual(snapshot(store, 'alice', alice), before);
    assert.deepEqual(transfer.import('alice', alice, bundle([])), { imported: 0, mapping: [] });
    const result = transfer.import(
      'alice',
      alice,
      bundle([
        {
          id: 'x'.repeat(200),
          title: 'x'.repeat(160),
          markdown: 'x'.repeat(200_000),
          parentId: null,
        },
      ]),
    );
    assert.equal(result.imported, 1);
    assert.equal(
      transfer.import(
        'alice',
        alice,
        bundle(
          Array.from({ length: 100 }, (_, i) => ({
            id: String(i),
            title: 'x',
            markdown: '',
            parentId: null,
          })),
        ),
      ).imported,
      100,
    );
  } finally {
    store.close();
  }
});

function extraPage(index: number, markdown = ''): Page {
  return {
    id: randomUUID(),
    title: String(index),
    markdown,
    parentId: null,
    revision: 1,
    deletedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

test('page quota counts tombstones and rolls back the entire batch at 1000 pages', () => {
  const { store, alice, transfer } = fixture();
  try {
    store.change('alice', alice, (workspace) => {
      workspace.pages.push(...Array.from({ length: 997 }, (_, i) => extraPage(i)));
    });
    const first = store.get('alice', alice).pages[0];
    store.updatePage('alice', alice, first.id, 1, {}, 'delete');
    const before = snapshot(store, 'alice', alice);
    assert.throws(
      () =>
        transfer.import(
          'alice',
          alice,
          bundle([
            { id: 'a', title: 'a', markdown: '', parentId: null },
            { id: 'b', title: 'b', markdown: '', parentId: null },
          ]),
        ),
      ConflictError,
    );
    assert.deepEqual(snapshot(store, 'alice', alice), before);
    assert.equal(transfer.import('alice', alice, bundle()).imported, 1);
    assert.equal(store.get('alice', alice).pages.length, 1000);
    const full = snapshot(store, 'alice', alice);
    assert.throws(() => transfer.import('alice', alice, bundle()), ConflictError);
    assert.deepEqual(snapshot(store, 'alice', alice), full);
  } finally {
    store.close();
  }
});

test('history budget failure leaves all pages and history intact and the transaction usable', () => {
  const { store, alice, transfer } = fixture();
  try {
    // 270 snapshots of 190kB stay below 50MiB; the incoming batch would exceed it.
    store.change('alice', alice, (workspace) => {
      workspace.pages.push(
        ...Array.from({ length: 90 }, (_, i) => extraPage(i, 'x'.repeat(190_000))),
      );
    });
    for (let revision = 2; revision <= 3; revision++) {
      store.change('alice', alice, (workspace) => {
        for (const page of workspace.pages.slice(2)) {
          page.revision = revision;
          page.markdown = String(revision) + 'x'.repeat(189_999);
        }
      });
    }
    const before = snapshot(store, 'alice', alice);
    const incoming = bundle(
      Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        title: 'x',
        markdown: 'x'.repeat(190_000),
        parentId: null,
      })),
    );
    assert.throws(() => transfer.import('alice', alice, incoming), /50MiB/);
    assert.deepEqual(snapshot(store, 'alice', alice), before);
    assert.equal(transfer.import('alice', alice, bundle()).imported, 1);
  } finally {
    store.close();
  }
});

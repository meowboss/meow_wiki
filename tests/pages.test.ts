import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictError, Store } from '../src/store.ts';
import { createApp } from '../src/app.ts';

test('legacy JSON migration is lossless and idempotent', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meow-migration-'));
  const path = join(directory, 'legacy.sqlite');
  const old = new DatabaseSync(path);
  old.exec(
    'CREATE TABLE workspaces(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);',
  );
  old.prepare('INSERT INTO workspaces VALUES(?,?,?)').run(
    'legacy',
    'alice',
    JSON.stringify({
      id: 'legacy',
      name: '保留',
      description: '',
      enabled: [],
      components: [],
      pages: [{ id: 'old-page', title: '旧笔记', markdown: '内容不丢', updatedAt: '2026-01-01' }],
    }),
  );
  old.close();
  let store = new Store(path);
  try {
    assert.equal(store.get('alice', 'legacy').pages[0].markdown, '内容不丢');
    assert.equal(store.history('alice', 'legacy', 'old-page').length, 1);
    assert.equal(store.history('alice', 'legacy', 'old-page')[0].operation, 'migration');
    store.updatePage('alice', 'legacy', 'old-page', 1, { markdown: '新内容' });
    store.close();
    store = new Store(path);
    assert.equal(store.get('alice', 'legacy').pages[0].revision, 2);
    assert.equal(store.get('alice', 'legacy').pages[0].markdown, '新内容');
    assert.equal(store.history('alice', 'legacy', 'old-page').length, 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('CAS rejects stale saves, restore appends history, deleted pages leave retrieval and can recover', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store });
  try {
    const page = (
      await app.inject({
        method: 'POST',
        url: '/api/pages',
        payload: { title: '独特关键词', markdown: 'version-one' },
      })
    ).json();
    const url = `/api/pages/${page.id}`;
    assert.equal(
      (await app.inject({ method: 'PUT', url, payload: { title: 'new', markdown: 'v2' } }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url,
          payload: { title: '独特关键词', markdown: 'version-two', expectedRevision: 1 },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url,
          payload: { title: 'lost-update', markdown: 'bad', expectedRevision: 1 },
        })
      ).statusCode,
      409,
    );
    const history = (await app.inject(`${url}/history`)).json().revisions;
    assert.equal(history.length, 2);
    assert.equal(history[0].markdown, 'version-two');
    const restored = (
      await app.inject({
        method: 'POST',
        url: `${url}/restore`,
        payload: { revision: 1, expectedRevision: 2 },
      })
    ).json();
    assert.equal(restored.revision, 3);
    assert.equal(restored.markdown, 'version-one');
    assert.equal(
      (await app.inject({ method: 'DELETE', url, payload: { expectedRevision: 3 } })).statusCode,
      200,
    );
    const workspace = (await app.inject('/api/workspace')).json();
    assert.ok(!workspace.pages.some((p: { id: string }) => p.id === page.id));
    assert.equal(workspace.trash[0].id, page.id);
    assert.equal(
      (await app.inject('/api/search?q=' + encodeURIComponent('独特关键词'))).json().results.length,
      0,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `${url}/undelete`,
          payload: { expectedRevision: 4 },
        })
      ).json().revision,
      5,
    );
    assert.equal((await app.inject(`${url}/history`)).json().revisions.length, 5);
    const foreign = store.ensure('foreign');
    assert.equal((await app.inject(`${url}/history?workspaceId=${foreign}`)).statusCode, 404);
  } finally {
    await app.close();
    store.close();
  }
});
test('migration preserves existing page tree, tombstone and revision fields', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meow-migration-tree-'));
  const path = join(directory, 'legacy.sqlite');
  const old = new DatabaseSync(path);
  const pages = [
    {
      id: 'parent',
      title: 'parent',
      markdown: '',
      updatedAt: 'old',
      revision: 4,
      deletedAt: 'deleted',
      parentId: null,
    },
    {
      id: 'child',
      title: 'child',
      markdown: 'keep',
      updatedAt: 'old',
      revision: 7,
      deletedAt: null,
      parentId: 'parent',
    },
  ];
  old.exec('CREATE TABLE workspaces(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL)');
  old.prepare('INSERT INTO workspaces VALUES(?,?,?)').run(
    'legacy',
    'alice',
    JSON.stringify({
      id: 'legacy',
      name: 'tree',
      description: '',
      enabled: [],
      components: [],
      pages,
    }),
  );
  old.close();
  const store = new Store(path);
  try {
    assert.deepEqual(store.get('alice', 'legacy').pages, pages);
    assert.equal(store.history('alice', 'legacy', 'child')[0].revision, 7);
    assert.throws(
      () => store.updatePage('alice', 'legacy', 'child', 1, { markdown: 'stale' }),
      ConflictError,
    );
    assert.equal(store.updatePage('alice', 'legacy', 'child', 7, { markdown: 'next' }).revision, 8);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('independent database connections enforce CAS and preserve unrelated page history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meow-cas-'));
  const path = join(directory, 'shared.sqlite');
  const first = new Store(path);
  const second = new Store(path);
  try {
    const id = first.ensure('owner');
    const [page, unrelated] = second.get('owner', id).pages;
    first.updatePage('owner', id, page.id, 1, { markdown: 'winner' });
    assert.throws(
      () => second.updatePage('owner', id, page.id, 1, { markdown: 'loser' }),
      ConflictError,
    );
    second.change('owner', id, (w) => {
      w.description = 'metadata';
    });
    assert.equal(first.get('owner', id).pages[0].markdown, 'winner');
    assert.deepEqual(
      second.history('owner', id, page.id).map((r) => r.markdown),
      ['winner', page.markdown],
    );
    assert.equal(first.history('owner', id, unrelated.id).length, 1);
  } finally {
    first.close();
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('workspace listing binds owner and enforces the per-owner limit', () => {
  const store = new Store(':memory:');
  try {
    const first = store.ensure('alice');
    const bob = store.ensure('bob');
    for (let n = 1; n < 20; n++) store.create('alice', `space-${n}`);
    assert.equal(store.list('alice').length, 20);
    assert.equal(store.list('alice')[0].id, first);
    assert.deepEqual(
      store.list('bob').map((w) => w.id),
      [bob],
    );
    assert.deepEqual(store.list('unknown'), []);
    assert.throws(() => store.create('alice', 'overflow'), ConflictError);
    assert.equal(store.list('alice').length, 20);
  } finally {
    store.close();
  }
});

test('workspace changes reject implicit page rewrites and roll back all metadata and history', () => {
  const store = new Store(':memory:');
  try {
    const id = store.ensure('owner');
    const original = store.get('owner', id);
    const page = original.pages[0];
    for (const revision of [page.revision, 0, 3, NaN]) {
      assert.throws(
        () =>
          store.change('owner', id, (w) => {
            w.name = 'must roll back';
            w.pages[0].markdown = 'implicit rewrite';
            w.pages[0].revision = revision;
          }),
        ConflictError,
      );
      assert.deepEqual(store.get('owner', id), original);
      assert.equal(store.history('owner', id, page.id).length, 1);
    }
    assert.throws(
      () =>
        store.change('owner', id, (w) => {
          w.pages[0].markdown = 'valid edit must roll back';
          w.pages[0].revision++;
          w.pages[1].markdown = 'invalid same-revision edit';
        }),
      ConflictError,
    );
    assert.deepEqual(store.get('owner', id), original);
    assert.equal(store.history('owner', id, page.id).length, 1);
    assert.throws(
      () =>
        store.change('owner', id, (w) => {
          w.id = 'other-id';
        }),
      ConflictError,
    );
    assert.throws(
      () =>
        store.change('owner', id, (w) => {
          w.pages.push({ ...page, id: 'new-page', revision: 2 });
        }),
      ConflictError,
    );
    assert.throws(
      () =>
        store.change('owner', id, (w) => {
          w.pages.pop();
        }),
      ConflictError,
    );
    assert.throws(
      () =>
        store.change('owner', id, (w) => {
          w.pages.push(w.pages[0]);
        }),
      ConflictError,
    );
    store.change('owner', id, (w) => {
      w.name = 'metadata only';
      w.enabled = [];
    });
    assert.equal(store.history('owner', id, page.id).length, 1);
    assert.deepEqual(store.get('owner', id).pages, original.pages);
    store.updatePage('owner', id, page.id, 1, { markdown: 'newer' });
    assert.throws(
      () =>
        store.change('owner', id, (w) => {
          w.pages = original.pages;
        }),
      ConflictError,
    );
    assert.equal(store.get('owner', id).pages[0].markdown, 'newer');
    assert.deepEqual(
      store.history('owner', id, page.id).map((r) => r.revision),
      [2, 1],
    );
  } finally {
    store.close();
  }
});

test('deleting a parent detaches live children with CAS history and recovery never hides descendants', () => {
  const store = new Store(':memory:');
  try {
    const id = store.ensure('owner');
    const [parent, child] = store.get('owner', id).pages;
    store.updatePage('owner', id, child.id, 1, { parentId: parent.id });
    store.updatePage('owner', id, parent.id, 1, {}, 'delete');
    const detached = store.get('owner', id).pages.find((p) => p.id === child.id)!;
    assert.equal(detached.parentId, null);
    assert.equal(detached.deletedAt, null);
    assert.equal(detached.revision, 3);
    assert.throws(
      () => store.updatePage('owner', id, child.id, 2, { title: 'stale child' }),
      ConflictError,
    );
    assert.deepEqual(
      store.history('owner', id, child.id).map((r) => [r.revision, r.parentId]),
      [
        [3, null],
        [2, parent.id],
        [1, null],
      ],
    );
    assert.equal(store.history('owner', id, parent.id)[0].operation, 'delete');
    store.updatePage('owner', id, parent.id, 2, {}, 'undelete');
    assert.equal(store.history('owner', id, parent.id)[0].operation, 'undelete');
    assert.equal(store.get('owner', id).pages.find((p) => p.id === child.id)!.parentId, null);
    // A child deleted before its parent restores as a root, not under trash.
    store.updatePage('owner', id, child.id, 3, { parentId: parent.id });
    store.updatePage('owner', id, child.id, 4, {}, 'delete');
    store.updatePage('owner', id, parent.id, 3, {}, 'delete');
    const recovered = store.updatePage('owner', id, child.id, 5, {}, 'undelete');
    assert.equal(recovered.parentId, null);
    assert.equal(recovered.deletedAt, null);
    assert.equal(recovered.revision, 6);
  } finally {
    store.close();
  }
});

test('page parent assignment rejects cycles and cross-workspace parents', () => {
  const store = new Store(':memory:');
  try {
    const id = store.ensure('owner');
    const [a, b] = store.get('owner', id).pages;
    store.updatePage('owner', id, a.id, 1, { parentId: b.id });
    assert.throws(() => store.updatePage('owner', id, b.id, 1, { parentId: a.id }), /循环/);
    const foreign = store.get('foreign', store.ensure('foreign')).pages[0];
    assert.throws(() => store.updatePage('owner', id, b.id, 1, { parentId: foreign.id }));
    assert.equal(store.history('owner', id, b.id).length, 1);
  } finally {
    store.close();
  }
});

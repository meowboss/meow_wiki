import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AccessError, ConflictError, Store } from '../src/store.ts';
import { createApp } from '../src/app.ts';

function seed(store: Store, count = 25) {
  const wid = store.ensure('owner');
  const page = store.get('owner', wid).pages[0];
  for (let revision = 1; revision < count; revision++) {
    store.updatePage('owner', wid, page.id, revision, {
      markdown: `版本${revision + 1}:` + '正文'.repeat(100),
    });
  }
  return { wid, pageId: page.id };
}

function bytes(store: Store) {
  return Number(
    store.db.prepare('SELECT sum(length(CAST(data AS BLOB))) AS n FROM page_revisions').get()!.n,
  );
}

test('export contains the complete current page and all revisions with a reproducible digest', () => {
  const store = new Store(':memory:');
  try {
    const { wid, pageId } = seed(store, 200);
    const before = store.get('owner', wid);
    const history = store.history('owner', wid, pageId);
    const exported = store.exportHistory('owner', wid, pageId);
    assert.equal(exported.format, 'meow.page-history.v1');
    assert.deepEqual(exported.page, before.pages[0]);
    assert.deepEqual(exported.revisions, history);
    assert.equal(exported.revisions.length, 200);
    assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
    assert.equal(
      exported.digest,
      createHash('sha256')
        .update(JSON.stringify({ page: exported.page, revisions: exported.revisions }))
        .digest('hex'),
    );
    assert.equal(store.exportHistory('owner', wid, pageId).digest, exported.digest);
    assert.deepEqual(store.get('owner', wid), before);
    assert.deepEqual(store.history('owner', wid, pageId), history);
  } finally {
    store.close();
  }
});

test('archive keeps the most recent revisions and current page, frees bytes and resumes saving after 200', () => {
  const store = new Store(':memory:');
  try {
    const { wid, pageId } = seed(store, 200);
    const before = store.get('owner', wid);
    const history = store.history('owner', wid, pageId);
    const unrelated = store.history('owner', wid, before.pages[1].id);
    const beforeBytes = bytes(store);
    assert.throws(
      () => store.updatePage('owner', wid, pageId, 200, { markdown: 'blocked' }),
      /200版/,
    );
    const exported = store.exportHistory('owner', wid, pageId);
    assert.deepEqual(
      store.archiveHistory('owner', wid, pageId, {
        expectedRevision: 200,
        keep: 10,
        exportDigest: exported.digest,
      }),
      { removed: 190, remaining: 10, currentRevision: 200 },
    );
    assert.ok(bytes(store) < beforeBytes);
    assert.deepEqual(store.get('owner', wid), before);
    assert.deepEqual(store.history('owner', wid, pageId), history.slice(0, 10));
    assert.throws(
      () =>
        store.archiveHistory('owner', wid, pageId, {
          expectedRevision: 200,
          keep: 10,
          exportDigest: exported.digest,
        }),
      ConflictError,
    );
    assert.deepEqual(store.history('owner', wid, pageId), history.slice(0, 10));
    assert.deepEqual(store.history('owner', wid, before.pages[1].id), unrelated);
    assert.throws(() => store.restorePage('owner', wid, pageId, 1, 200), AccessError);
    const saved = store.updatePage('owner', wid, pageId, 200, { markdown: 'after archive' });
    assert.equal(saved.revision, 201);
    assert.equal(store.history('owner', wid, pageId).length, 11);
    assert.equal(store.restorePage('owner', wid, pageId, 195, 201).revision, 202);
    assert.equal(store.history('owner', wid, pageId)[0].markdown, history[5].markdown);
  } finally {
    store.close();
  }
});

test('archive rejects missing digest, invalid keep and stale page or history snapshots without mutations', () => {
  const store = new Store(':memory:');
  try {
    const { wid, pageId } = seed(store);
    const exported = store.exportHistory('owner', wid, pageId);
    const valid = { expectedRevision: 25, keep: 10, exportDigest: exported.digest };
    const before = store.history('owner', wid, pageId);
    for (const keep of [9, 101, 10.5, NaN, Infinity, '10', null]) {
      assert.throws(() => store.archiveHistory('owner', wid, pageId, { ...valid, keep } as never));
    }
    for (const exportDigest of [undefined, '', 'x'.repeat(64), '0'.repeat(64)]) {
      assert.throws(() =>
        store.archiveHistory('owner', wid, pageId, { ...valid, exportDigest } as never),
      );
    }
    assert.throws(
      () => store.archiveHistory('owner', wid, pageId, { ...valid, expectedRevision: 24 }),
      ConflictError,
    );
    assert.deepEqual(store.history('owner', wid, pageId), before);
    store.updatePage('owner', wid, pageId, 25, { markdown: 'newer' });
    assert.throws(
      () => store.archiveHistory('owner', wid, pageId, { ...valid, expectedRevision: 26 }),
      ConflictError,
    );
    const fresh = store.exportHistory('owner', wid, pageId);
    // Simulate a change to an old revision without changing the current page revision.
    const old = store.history('owner', wid, pageId).at(-1)!;
    store.db
      .prepare('UPDATE page_revisions SET data=? WHERE page_id=? AND revision=?')
      .run(JSON.stringify({ ...old, markdown: 'changed history' }), pageId, old.revision);
    const changed = store.history('owner', wid, pageId);
    assert.throws(
      () =>
        store.archiveHistory('owner', wid, pageId, {
          ...valid,
          expectedRevision: 26,
          exportDigest: fresh.digest,
        }),
      ConflictError,
    );
    assert.deepEqual(store.history('owner', wid, pageId), changed);
    const latest = store.exportHistory('owner', wid, pageId);
    assert.deepEqual(
      store.archiveHistory('owner', wid, pageId, {
        expectedRevision: 26,
        keep: 100,
        exportDigest: latest.digest,
      }),
      { removed: 0, remaining: 26, currentRevision: 26 },
    );
  } finally {
    store.close();
  }
});

test('store enforces owner and workspace boundaries for export and archive', () => {
  const store = new Store(':memory:');
  try {
    const { wid, pageId } = seed(store);
    const other = store.create('owner', 'other space');
    const foreign = store.ensure('foreign');
    const exported = store.exportHistory('owner', wid, pageId);
    const input = { expectedRevision: 25, keep: 10, exportDigest: exported.digest };
    for (const [owner, workspace] of [
      ['foreign', wid],
      ['owner', other],
      ['owner', foreign],
    ]) {
      assert.throws(() => store.exportHistory(owner, workspace, pageId), AccessError);
      assert.throws(() => store.archiveHistory(owner, workspace, pageId, input), AccessError);
    }
    assert.equal(store.history('owner', wid, pageId).length, 25);
  } finally {
    store.close();
  }
});

test('SQL deletion failure rolls back every removed revision and leaves the connection usable', () => {
  const store = new Store(':memory:');
  try {
    const { wid, pageId } = seed(store);
    const before = store.exportHistory('owner', wid, pageId);
    const beforeBytes = bytes(store);
    store.db.exec(`CREATE TRIGGER fail_archive BEFORE DELETE ON page_revisions
      WHEN (SELECT count(*) FROM page_revisions WHERE page_id=OLD.page_id)<24
      BEGIN SELECT RAISE(ABORT, 'injected deletion failure'); END;`);
    assert.throws(
      () =>
        store.archiveHistory('owner', wid, pageId, {
          expectedRevision: 25,
          keep: 10,
          exportDigest: before.digest,
        }),
      /injected deletion failure/,
    );
    assert.deepEqual(store.get('owner', wid).pages[0], before.page);
    assert.deepEqual(store.history('owner', wid, pageId), before.revisions);
    assert.equal(bytes(store), beforeBytes);
    store.db.exec('DROP TRIGGER fail_archive');
    assert.equal(
      store.archiveHistory('owner', wid, pageId, {
        expectedRevision: 25,
        keep: 10,
        exportDigest: before.digest,
      }).removed,
      15,
    );
  } finally {
    store.close();
  }
});

test('HTTP export is a safe JSON attachment and archive validates body, digest and scope', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store });
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pages',
      payload: { title: 'export', markdown: 'one' },
    });
    assert.equal(created.statusCode, 201);
    const page = created.json();
    const url = `/api/pages/${page.id}/history`;
    const response = await app.inject(`${url}/export`);
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type']), /application\/json/);
    assert.equal(
      response.headers['content-disposition'],
      `attachment; filename="${page.id}-history.json"`,
    );
    const exported = response.json();
    assert.equal(exported.format, 'meow.page-history.v1');
    assert.equal(exported.revisions.length, 1);
    const valid = { expectedRevision: 1, keep: 10, exportDigest: exported.digest };
    for (const payload of [
      { expectedRevision: 1, keep: 10 },
      { ...valid, keep: 9 },
      { ...valid, keep: 101 },
      { ...valid, keep: 10.5 },
    ]) {
      assert.equal(
        (await app.inject({ method: 'POST', url: `${url}/archive`, payload })).statusCode,
        400,
      );
    }
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `${url}/archive`,
          payload: { ...valid, exportDigest: '0'.repeat(64) },
        })
      ).statusCode,
      409,
    );
    const foreign = store.ensure('foreign');
    for (const suffix of ['export', 'archive']) {
      const denied = await app.inject({
        method: suffix === 'export' ? 'GET' : 'POST',
        url: `${url}/${suffix}?workspaceId=${foreign}`,
        ...(suffix === 'archive' ? { payload: valid } : {}),
      });
      assert.equal(denied.statusCode, 404);
    }
    assert.deepEqual(
      (await app.inject({ method: 'POST', url: `${url}/archive`, payload: valid })).json(),
      {
        removed: 0,
        remaining: 1,
        currentRevision: 1,
      },
    );
    // A migrated page ID may contain quotes/control characters: never copy them into a header.
    const wid = store.ensure('local-owner');
    const unsafe = 'unsafe"\r\nname';
    store.change('local-owner', wid, (w) => {
      w.pages.push({ ...page, id: unsafe });
    });
    const safe = await app.inject(
      `/api/pages/${encodeURIComponent(unsafe)}/history/export?workspaceId=${wid}`,
    );
    assert.equal(safe.statusCode, 200, safe.body);
    assert.equal(
      safe.headers['content-disposition'],
      'attachment; filename="unsafe___name-history.json"',
    );
  } finally {
    await app.close();
    store.close();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { createApp } from '../src/app.ts';
test('page history is bounded and rejected revision rolls back content and metadata', () => {
  const store = new Store(':memory:');
  try {
    const wid = store.ensure('owner'),
      page = store.get('owner', wid).pages[0];
    for (let revision = 1; revision < 200; revision++)
      store.updatePage('owner', wid, page.id, revision, { markdown: `v${revision + 1}` });
    assert.equal(store.history('owner', wid, page.id).length, 200);
    assert.throws(
      () =>
        store.change('owner', wid, (w) => {
          w.name = 'must rollback';
          w.pages[0] = { ...w.pages[0], revision: 201, markdown: 'bad' };
        }),
      /200版/,
    );
    assert.notEqual(store.get('owner', wid).name, 'must rollback');
    assert.equal(store.get('owner', wid).pages[0].markdown, 'v200');
    assert.equal(store.history('owner', wid, page.id).length, 200);
  } finally {
    store.close();
  }
});
test('liveness and readiness return minimal status without private details', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store, mode: 'session' });
  try {
    assert.deepEqual((await app.inject('/health/live')).json(), { status: 'ok' });
    assert.deepEqual((await app.inject('/health/ready')).json(), { status: 'ready' });
  } finally {
    await app.close();
    store.close();
  }
});

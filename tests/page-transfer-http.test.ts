import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
test('page bundle export/import uses authorized workspace and fresh identifiers', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store });
  try {
    const source = (await app.inject('/api/workspace')).json();
    const exported = await app.inject('/api/pages/export');
    assert.equal(exported.statusCode, 200);
    assert.match(String(exported.headers['content-disposition']), /attachment/);
    assert.doesNotMatch(exported.body, /apiKey|authorId|password|enabled/);
    const bundle = exported.json();
    const target = store.create('local-owner', '导入目标');
    const result = await app.inject({
      method: 'POST',
      url: `/api/pages/import?workspaceId=${target}`,
      payload: bundle,
    });
    assert.equal(result.statusCode, 201, result.body);
    assert.equal(result.json().imported, source.pages.length);
    assert.ok(
      result.json().mapping.every((m: { sourceId: string; id: string }) => m.sourceId !== m.id),
    );
    const foreign = store.ensure('foreign');
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/pages/import?workspaceId=${foreign}`,
          payload: bundle,
        })
      ).statusCode,
      404,
    );
  } finally {
    await app.close();
    store.close();
  }
});

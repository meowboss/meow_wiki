import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { ModelBroker } from '../src/models.ts';
test('model proposal generation creates reviewable evidence draft, never writes target before acceptance', async () => {
  const store = new Store(':memory:');
  const broker = new ModelBroker(
    { endpoint: 'https://provider.example/v1', model: 'test', apiKey: 'test-secret' },
    (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '猫需要清洁饮水[S1]。' } }] }),
      )) as typeof fetch,
  );
  const app = createApp({ store, modelBroker: broker });
  try {
    const workspace = (await app.inject('/api/workspace')).json();
    const page = workspace.pages[0];
    const source = (
      await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { title: '猫资料', content: '猫需要清洁饮水' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/api/sources/${source.id}/process` });
    const generated = await app.inject({
      method: 'POST',
      url: '/api/proposals/generate',
      payload: { pageId: page.id, expectedRevision: page.revision, question: '猫' },
    });
    assert.equal(generated.statusCode, 201, generated.body);
    assert.equal((await app.inject('/api/workspace')).json().pages[0].revision, 1);
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/proposals/${generated.json().id}/decide`,
      payload: { decision: 'accept' },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().page.revision, 2);
  } finally {
    await app.close();
    store.close();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { ModelBroker } from '../src/models.ts';
test('HTTP preserves sanitized upstream error status instead of masking model failures as 500', async () => {
  const store = new Store(':memory:');
  const broker = new ModelBroker(
    { endpoint: 'https://provider.example/v1', model: 'test', apiKey: 'must-not-leak' },
    (async () => {
      throw new Error('must-not-leak');
    }) as typeof fetch,
  );
  const app = createApp({ store, modelBroker: broker });
  try {
    const source = (
      await app.inject({
        method: 'POST',
        url: '/api/sources',
        payload: { title: '猫', content: '猫需要水' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/api/sources/${source.id}/process` });
    const result = await app.inject({
      method: 'POST',
      url: '/api/knowledge/ask',
      payload: { question: '猫', mode: 'model' },
    });
    assert.equal(result.statusCode, 502);
    assert.doesNotMatch(result.body, /must-not-leak/);
  } finally {
    await app.close();
    store.close();
  }
});

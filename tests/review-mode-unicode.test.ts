import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { createApp } from '../src/app.ts';
test('account-only features fail explicitly in local and token modes rather than query nonexistent users', async () => {
  for (const mode of ['local', 'token'] as const) {
    const store = new Store(':memory:');
    const token = 'x'.repeat(40);
    const app = createApp({ store, mode, token, userId: 'script' });
    try {
      const headers = mode === 'token' ? { authorization: `Bearer ${token}` } : {};
      const result = await app.inject({
        method: 'POST',
        url: '/api/domains',
        headers,
        payload: { name: 'test' },
      });
      assert.equal(result.statusCode, 409, result.body);
    } finally {
      await app.close();
      store.close();
    }
  }
});
test('Unicode Markdown reaches documented character limit without a premature byte-budget failure', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store });
  try {
    const result = await app.inject({
      method: 'POST',
      url: '/api/pages',
      payload: { title: '中文边界', markdown: '界'.repeat(200000) },
    });
    assert.equal(result.statusCode, 201, result.body.slice(0, 200));
  } finally {
    await app.close();
    store.close();
  }
});

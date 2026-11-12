import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderNetwork } from '../src/modules/workshop/provider-network.ts';
import { ProviderOperations } from '../src/modules/workshop/provider-operations.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { Store } from '../src/store.ts';
test('JSON escaped key is rejected after response decoding and operation failures have safe statuses', async () => {
  const key = 'review-fake-provider-secret';
  const raw = JSON.stringify({ data: [{ id: key }] }).replaceAll(
    key,
    [...key].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''),
  );
  const network = new ProviderNetwork({
    resolver: async () => [{ address: '8.8.8.8', family: 4 }],
    fetcher: (async () => new Response(raw)) as typeof fetch,
  });
  await assert.rejects(network.request('https://api.example.test/v1', key, 'models'));
  const store = new Store(':memory:');
  try {
    const vault = new ProviderVault(store.db, 'test-master-secret-longer-than-32-characters', {}),
      ops = new ProviderOperations(vault, network);
    await assert.rejects(
      ops.models('owner', { vendor: 'custom', baseURL: 'http://127.0.0.1/v1', apiKey: key }),
      (e) => (e as { statusCode: number }).statusCode === 400,
    );
    await assert.rejects(
      ops.models('owner', {
        vendor: 'custom',
        baseURL: 'https://api.example.test/v1',
        apiKey: key,
      }),
      (e) => (e as { statusCode: number }).statusCode === 502,
    );
  } finally {
    store.close();
  }
});

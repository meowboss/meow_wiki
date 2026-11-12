import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { ProviderNetwork } from '../src/modules/workshop/provider-network.ts';
import { ProviderOperations } from '../src/modules/workshop/provider-operations.ts';
test('model discovery and real inference checks remain distinct, secret-only, and saved endpoints cannot be swapped', async () => {
  const store = new Store(':memory:');
  try {
    store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY);INSERT INTO user VALUES('owner')");
    const vault = new ProviderVault(store.db, 'operations-test-master-secret-longer32', {});
    let calls = 0;
    const network = new ProviderNetwork({
      resolver: async () => [{ address: '8.8.8.8', family: 4 }],
      fetcher: (async (url, init) => {
        calls++;
        assert.equal((init?.headers as Headers).get('authorization'), 'Bearer operations-fake-key');
        return new Response(
          JSON.stringify(
            String(url).endsWith('/models')
              ? { data: [{ id: 'model-a' }, { id: 'model-a' }, { id: 'model-b' }] }
              : { choices: [{ message: { content: 'OK' } }] },
          ),
        );
      }) as typeof fetch,
    });
    const ops = new ProviderOperations(vault, network);
    const draft = {
      vendor: 'custom' as const,
      baseURL: 'https://api.example.test/v1',
      apiKey: 'operations-fake-key',
      model: 'model-a',
    };
    assert.deepEqual((await ops.models('owner', draft)).models, [
      { id: 'model-a' },
      { id: 'model-b' },
    ]);
    assert.equal(calls, 1);
    assert.equal((await ops.test('owner', draft)).ok, true);
    assert.equal(calls, 2);
    const saved = vault.saveCustom('owner', { ...draft, label: 'saved' });
    await ops.models('owner', { ...draft, apiKey: undefined, providerId: saved.id });
    await assert.rejects(
      ops.models('owner', {
        ...draft,
        baseURL: 'https://other.example.test/v1',
        apiKey: undefined,
        providerId: saved.id,
      }),
      /地址变更/,
    );
  } finally {
    store.close();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderNetwork } from '../src/modules/workshop/provider-network.ts';
import { containsDecodedSecret } from '../src/modules/workshop/secret-guard.ts';
test('decoded Provider echoes cannot leak quoted or backslash credentials through model discovery', async () => {
  for (const key of ['sk-SYNTHETIC-\\VALUE', 'sk-SYNTHETIC-"VALUE']) {
    for (const payload of [{ data: [{ id: key }] }, { [key]: 'value' }]) {
      const network = new ProviderNetwork({
        resolver: async () => [{ address: '8.8.8.8', family: 4 }],
        fetcher: (async () => new Response(JSON.stringify(payload))) as typeof fetch,
      });
      await assert.rejects(
        () => network.request('https://models.example/v1', key, 'models'),
        /Provider network request failed/,
      );
    }
  }
});
test('decoded secret scan covers deep strings and keys without recursive stack growth', () => {
  let value: unknown = 'synthetic-key';
  for (let i = 0; i < 20000; i++) value = [value];
  assert.equal(containsDecodedSecret(value, 'synthetic-key'), true);
  assert.equal(containsDecodedSecret({ safe: ['model'] }, 'synthetic-key'), false);
});

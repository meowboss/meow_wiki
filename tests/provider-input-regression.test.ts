import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { providerOperationSchema } from '../src/modules/workshop/provider-operations.ts';
test('Provider model and endpoint limits align and keys normalize or reject unusable header input', () => {
  const store = new Store(':memory:');
  try {
    store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY);INSERT INTO user VALUES('owner')");
    const vault = new ProviderVault(store.db, 'input-test-master-longer-than-32-characters', {});
    const value = {
      label: 'test',
      vendor: 'custom' as const,
      baseURL: 'https://api.example.test/v1',
      model: 'm'.repeat(200),
      apiKey: '  fake-provider-key  ',
    };
    const p = vault.saveCustom('owner', value);
    assert.equal(vault.resolve('owner', p.id).apiKey, 'fake-provider-key');
    assert.equal(
      providerOperationSchema.parse({
        vendor: value.vendor,
        baseURL: value.baseURL,
        model: value.model,
        apiKey: value.apiKey,
      }).apiKey,
      'fake-provider-key',
    );
    assert.throws(
      () => vault.saveCustom('owner', { ...value, label: 'x'.repeat(101) }),
      /Provider名称/,
    );
    for (const key of ['fake\nkey', 'Bearer fake-key', '"fake-key"'])
      assert.throws(() => vault.saveCustom('owner', { ...value, apiKey: key }), /API Key/);
    const longURL = 'https://api.example.test/' + 'a'.repeat(1980);
    assert.ok(longURL.length > 2000 && longURL.length < 2048);
    assert.ok(
      providerOperationSchema.safeParse({
        vendor: 'custom',
        baseURL: longURL,
        model: 'm',
        apiKey: 'fake',
      }).success,
    );
  } finally {
    store.close();
  }
});

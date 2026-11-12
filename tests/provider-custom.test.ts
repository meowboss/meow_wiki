import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ProviderError, ProviderVault } from '../src/modules/workshop/providers.ts';

const master = 'external-master-secret-at-least-32-characters';
const input = {
  label: 'Mine',
  vendor: 'custom' as const,
  baseURL: 'https://api.example.com/v1',
  model: 'my-model',
  apiKey: 'sk-private-value',
};
const status = (code: number) => (error: unknown) =>
  error instanceof ProviderError && error.statusCode === code;
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES ('alice'),('bob')",
  );
  return { db, vault: new ProviderVault(db, master, {}) };
}

test('custom settings persist independently of host maps and expose only whitelisted metadata', () => {
  const { db, vault } = fixture();
  try {
    const record = vault.saveCustom('alice', input);
    assert.deepEqual(Object.keys(record).sort(), [
      'baseURL',
      'configured',
      'endpointId',
      'id',
      'label',
      'model',
      'source',
      'vendor',
    ]);
    assert.equal(record.source, 'custom');
    assert.equal(record.vendor, input.vendor);
    assert.match(record.endpointId, /^custom:/);
    assert.equal(record.baseURL, input.baseURL);
    assert.deepEqual(vault.list('alice'), [record]);
    assert.ok(!JSON.stringify(record).includes(input.apiKey));
    const row = db.prepare('SELECT key_blob FROM workshop_providers WHERE id=?').get(record.id)!;
    assert.equal(Buffer.from(row.key_blob as Uint8Array)[0], 2);
    assert.ok(!Buffer.from(row.key_blob as Uint8Array).includes(Buffer.from(input.apiKey)));
    const reopened = new ProviderVault(db, master, {});
    assert.deepEqual(reopened.resolve('alice', record.id), {
      endpoint: input.baseURL,
      model: input.model,
      apiKey: input.apiKey,
      custom: true,
    });
    vault.remove('alice', record.id);
    assert.equal(db.prepare('SELECT count(*) AS n FROM workshop_provider_settings').get()!.n, 0);
  } finally {
    db.close();
  }
});

test('old database migrates without changing legacy v1 AAD or metadata', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES ('alice');
      CREATE TABLE workshop_providers (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      label TEXT NOT NULL, endpoint_id TEXT NOT NULL, model TEXT NOT NULL, key_blob BLOB NOT NULL);`);
    const row = {
      id: 'old',
      label: 'Legacy',
      endpointId: 'custom:old-host-map-id',
      model: 'legacy-model',
    };
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      createHash('sha256').update(master).digest(),
      nonce,
    );
    cipher.setAAD(
      Buffer.from(JSON.stringify(['alice', row.id, row.label, row.endpointId, row.model])),
    );
    const encrypted = Buffer.concat([cipher.update(input.apiKey, 'utf8'), cipher.final()]);
    const blob = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
    db.prepare('INSERT INTO workshop_providers VALUES (?,?,?,?,?,?)').run(
      row.id,
      'alice',
      row.label,
      row.endpointId,
      row.model,
      blob,
    );
    const vault = new ProviderVault(db, master, { [row.endpointId]: input.baseURL });
    assert.deepEqual(vault.list('alice'), [{ ...row, configured: true }]);
    assert.deepEqual(vault.resolve('alice', row.id), {
      endpoint: input.baseURL,
      model: row.model,
      apiKey: input.apiKey,
    });
    assert.deepEqual(
      Buffer.from(
        db.prepare('SELECT key_blob FROM workshop_providers').get()!.key_blob as Uint8Array,
      ),
      blob,
    );
    const saved = vault.save('alice', {
      label: 'New legacy',
      endpointId: row.endpointId,
      model: row.model,
      apiKey: input.apiKey,
    });
    assert.equal(
      Buffer.from(
        db.prepare('SELECT key_blob FROM workshop_providers WHERE id=?').get(saved.id)!
          .key_blob as Uint8Array,
      )[0],
      1,
    );
  } finally {
    db.close();
  }
});

test('v2 AAD rejects URL, vendor, metadata, ciphertext and settings removal tampering', () => {
  const { db, vault } = fixture();
  try {
    const row = vault.saveCustom('alice', input);
    for (const [column, value, original] of [
      ['endpoint', 'https://attacker.example.com/v1', input.baseURL],
      ['vendor', 'openai', input.vendor],
    ]) {
      db.prepare(`UPDATE workshop_provider_settings SET ${column}=? WHERE provider_id=?`).run(
        value,
        row.id,
      );
      assert.throws(() => vault.resolve('alice', row.id), status(500));
      assert.throws(() => vault.updateCustom('alice', row.id, input), status(500));
      db.prepare(`UPDATE workshop_provider_settings SET ${column}=? WHERE provider_id=?`).run(
        original,
        row.id,
      );
    }
    db.prepare('UPDATE workshop_providers SET model=? WHERE id=?').run('tampered', row.id);
    assert.throws(() => vault.resolve('alice', row.id), status(500));
    db.prepare('UPDATE workshop_providers SET model=? WHERE id=?').run(input.model, row.id);
    const blob = Buffer.from(
      db.prepare('SELECT key_blob FROM workshop_providers WHERE id=?').get(row.id)!
        .key_blob as Uint8Array,
    );
    for (const index of [0, 1, 13, blob.length - 1]) {
      const changed = Buffer.from(blob);
      changed[index] ^= 1;
      db.prepare('UPDATE workshop_providers SET key_blob=? WHERE id=?').run(changed, row.id);
      assert.throws(() => vault.resolve('alice', row.id), status(500));
    }
    db.prepare('UPDATE workshop_providers SET key_blob=? WHERE id=?').run(blob, row.id);
    db.prepare('DELETE FROM workshop_provider_settings WHERE provider_id=?').run(row.id);
    assert.throws(() => vault.resolve('alice', row.id), status(500));
  } finally {
    db.close();
  }
});

test('updates retain omitted key, reencrypt metadata and require fresh key for endpoint or vendor change', () => {
  const { db, vault } = fixture();
  try {
    const row = vault.saveCustom('alice', input);
    const { apiKey: _, ...withoutKey } = input;
    const before = db
      .prepare('SELECT key_blob FROM workshop_providers WHERE id=?')
      .get(row.id)!.key_blob;
    const updated = vault.updateCustom('alice', row.id, {
      ...withoutKey,
      label: 'Updated',
      model: 'new-model',
    });
    assert.equal(updated.label, 'Updated');
    assert.equal(vault.resolve('alice', row.id).apiKey, input.apiKey);
    assert.equal(vault.resolve('alice', row.id).model, 'new-model');
    assert.notDeepEqual(
      db.prepare('SELECT key_blob FROM workshop_providers WHERE id=?').get(row.id)!.key_blob,
      before,
    );
    for (const patch of [
      { baseURL: 'https://other.example.com/v1' },
      { vendor: 'openai' as const },
      { apiKey: '' },
      { apiKey: ' ' },
    ])
      assert.throws(
        () => vault.updateCustom('alice', row.id, { ...withoutKey, ...patch }),
        status(400),
      );
    assert.equal(vault.resolve('alice', row.id).apiKey, input.apiKey);
    const changed = vault.updateCustom('alice', row.id, {
      ...input,
      vendor: 'deepseek',
      baseURL: 'https://other.example.com/v1',
      apiKey: 'replacement-key',
    });
    assert.equal(changed.vendor, 'deepseek');
    assert.equal(vault.resolve('alice', row.id).apiKey, 'replacement-key');
    assert.equal(vault.resolve('alice', row.id).endpoint, 'https://other.example.com/v1');
  } finally {
    db.close();
  }
});

test('custom owner isolation, shared per-user limit, strict validation and cascade', () => {
  const { db, vault } = fixture();
  try {
    const row = vault.saveCustom('alice', input);
    assert.deepEqual(vault.list('bob'), []);
    for (const id of [row.id, 'missing']) {
      assert.throws(() => vault.updateCustom('bob', id, input), status(404));
      assert.throws(() => vault.resolve('bob', id), status(404));
      assert.throws(() => vault.remove('bob', id), status(404));
    }
    assert.throws(() => vault.saveCustom('missing', input), status(404));
    assert.throws(
      () => vault.saveCustom('alice', { ...input, ownerId: 'bob' } as typeof input),
      status(400),
    );
    assert.throws(
      () => vault.saveCustom('alice', input, 'https://attacker.example.com/v1'),
      status(400),
    );
    const withHost = new ProviderVault(db, master, { host: input.baseURL });
    withHost.save('alice', {
      label: 'Host',
      endpointId: 'host',
      model: input.model,
      apiKey: input.apiKey,
    });
    for (let i = 0; i < 3; i++) vault.saveCustom('alice', input);
    assert.throws(() => vault.saveCustom('alice', input), status(409));
    assert.throws(
      () =>
        withHost.save('alice', {
          label: 'Host',
          endpointId: 'host',
          model: input.model,
          apiKey: input.apiKey,
        }),
      status(409),
    );
    assert.ok(vault.saveCustom('bob', input));
    db.prepare('DELETE FROM user WHERE id=?').run('alice');
    assert.equal(db.prepare('SELECT count(*) AS n FROM workshop_provider_settings').get()!.n, 1);
  } finally {
    db.close();
  }
});

test('custom save/update settings are atomic and compose with outer transactions', () => {
  const { db, vault } = fixture();
  try {
    db.exec('BEGIN');
    vault.saveCustom('alice', input);
    db.exec('ROLLBACK');
    assert.deepEqual(vault.list('alice'), []);
    db.exec(
      `CREATE TRIGGER fail_settings BEFORE INSERT ON workshop_provider_settings BEGIN SELECT RAISE(ABORT, 'private-db-failure'); END`,
    );
    assert.throws(() => vault.saveCustom('alice', input), status(500));
    assert.deepEqual(vault.list('alice'), []);
    db.exec('DROP TRIGGER fail_settings');
    const row = vault.saveCustom('alice', input);
    db.exec(
      `CREATE TRIGGER fail_update BEFORE UPDATE ON workshop_provider_settings BEGIN SELECT RAISE(ABORT, 'private-db-failure'); END`,
    );
    assert.throws(
      () => vault.updateCustom('alice', row.id, { ...input, model: 'new-model' }),
      status(500),
    );
    assert.equal(vault.resolve('alice', row.id).model, input.model);
  } finally {
    db.close();
  }
});

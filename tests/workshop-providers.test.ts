import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  ProviderError,
  ProviderVault,
  type SaveProviderInput,
} from '../src/modules/workshop/providers.ts';

const master = 'external-master-secret-at-least-32-characters';
const endpoints = { hosted: 'https://api.example.test/v1', local: 'http://127.0.0.1:8080/v1' };
const input = {
  label: 'My provider',
  endpointId: 'hosted',
  model: 'test-model',
  apiKey: 'sk-private-provider-key',
};
function fixture(allowed = endpoints) {
  const db = new DatabaseSync(':memory:');
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES ('alice'),('bob')",
  );
  return { db, vault: new ProviderVault(db, master, allowed) };
}
function status(code: number) {
  return (error: unknown) => error instanceof ProviderError && error.statusCode === code;
}

test('provider secrets use authenticated randomized encryption and public methods expose metadata only', () => {
  const { db, vault } = fixture();
  try {
    const first = vault.save('alice', input);
    const second = vault.save('alice', input);
    const keys = ['configured', 'endpointId', 'id', 'label', 'model'];
    assert.deepEqual(Object.keys(first).sort(), keys);
    assert.deepEqual(vault.list('alice'), [first, second]);
    const rows = db.prepare('SELECT * FROM workshop_providers ORDER BY rowid').all();
    for (const row of rows) {
      assert.ok(row.key_blob instanceof Uint8Array);
      const blob = Buffer.from(row.key_blob as Uint8Array);
      assert.equal(blob[0], 1);
      assert.equal(blob.length, 1 + 12 + 16 + Buffer.byteLength(input.apiKey));
      assert.ok(!blob.includes(Buffer.from(input.apiKey)));
      assert.ok(!blob.includes(Buffer.from(master)));
      assert.ok(!JSON.stringify(row).includes(input.apiKey));
      assert.ok(!JSON.stringify(row).includes(master));
    }
    assert.notDeepEqual(rows[0].key_blob, rows[1].key_blob);
    assert.deepEqual(vault.resolve('alice', first.id), {
      endpoint: endpoints.hosted,
      model: input.model,
      apiKey: input.apiKey,
    });
    const reopened = new ProviderVault(db, master, endpoints);
    assert.deepEqual(reopened.list('alice'), [first, second]);
    assert.equal(reopened.resolve('alice', second.id).apiKey, input.apiKey);
    const columns = db
      .prepare('PRAGMA table_info(workshop_providers)')
      .all()
      .map((column) => column.name);
    assert.deepEqual(columns, ['id', 'owner_id', 'label', 'endpoint_id', 'model', 'key_blob']);
    assert.ok(!JSON.stringify(vault.list('alice')).includes(input.apiKey));
  } finally {
    db.close();
  }
});

test('every read/delete is scoped to the real caller; missing and foreign ids are indistinguishable', () => {
  const { db, vault } = fixture();
  try {
    const record = vault.save('alice', input);
    assert.deepEqual(vault.list('bob'), []);
    for (const caller of ['bob', 'missing']) {
      for (const id of [record.id, 'unknown']) {
        assert.throws(() => vault.resolve(caller, id), status(404));
        assert.throws(() => vault.remove(caller, id), status(404));
      }
    }
    assert.throws(() => vault.save('missing', input), status(404));
    assert.equal(vault.resolve('alice', record.id).apiKey, input.apiKey);
    vault.remove('alice', record.id);
    assert.deepEqual(vault.list('alice'), []);
    assert.throws(() => vault.resolve('alice', record.id), status(404));
    assert.throws(() => vault.remove('alice', record.id), status(404));
  } finally {
    db.close();
  }
});

test('tampered ciphertext, nonce, tag, metadata, owner and wrong master fail closed without sensitive errors', () => {
  const { db, vault } = fixture();
  try {
    const record = vault.save('alice', input);
    const original = Buffer.from(
      db.prepare('SELECT key_blob FROM workshop_providers WHERE id=?').get(record.id)!
        .key_blob as Uint8Array,
    );
    const fails = (resolver = () => vault.resolve('alice', record.id)) => {
      assert.throws(resolver, (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.statusCode, 500);
        assert.equal(error.message, 'Provider unavailable');
        assert.ok(!String(error.stack).includes(input.apiKey));
        assert.ok(!String(error.stack).includes(master));
        assert.equal(error.cause, undefined);
        return true;
      });
    };
    for (const index of [0, 1, 13, original.length - 1]) {
      const altered = Buffer.from(original);
      altered[index] ^= 1;
      db.prepare('UPDATE workshop_providers SET key_blob=? WHERE id=?').run(altered, record.id);
      fails();
    }
    db.prepare('UPDATE workshop_providers SET key_blob=? WHERE id=?').run(
      Buffer.from([1]),
      record.id,
    );
    fails();
    db.prepare('UPDATE workshop_providers SET key_blob=? WHERE id=?').run(original, record.id);
    for (const [column, value, restore] of [
      ['model', 'other-model', input.model],
      ['label', 'other-label', input.label],
      ['endpoint_id', 'local', input.endpointId],
    ]) {
      db.prepare(`UPDATE workshop_providers SET ${column}=? WHERE id=?`).run(value, record.id);
      fails();
      db.prepare(`UPDATE workshop_providers SET ${column}=? WHERE id=?`).run(restore, record.id);
    }
    db.prepare('UPDATE workshop_providers SET owner_id=? WHERE id=?').run('bob', record.id);
    fails(() => vault.resolve('bob', record.id));
    db.prepare('UPDATE workshop_providers SET owner_id=? WHERE id=?').run('alice', record.id);
    const wrong = new ProviderVault(
      db,
      'different-master-secret-at-least-32-characters',
      endpoints,
    );
    fails(() => wrong.resolve('alice', record.id));
    const removedEndpoint = new ProviderVault(db, master, {});
    fails(() => removedEndpoint.resolve('alice', record.id));
    assert.equal(vault.resolve('alice', record.id).apiKey, input.apiKey);
  } finally {
    db.close();
  }
});

test('endpoint configuration is trusted, explicit, HTTPS except mapped IPv4 loopback HTTP, and never request URLs', () => {
  const { db, vault } = fixture();
  try {
    const local = vault.save('alice', { ...input, endpointId: 'local' });
    assert.equal(vault.resolve('alice', local.id).endpoint, endpoints.local);
    for (const endpointId of [
      'https://api.example.test/v1',
      'http://127.0.0.1:8080/v1',
      '__proto__',
      'constructor',
      'unknown',
    ])
      assert.throws(() => vault.save('alice', { ...input, endpointId }), status(400));
    assert.throws(() => new ProviderVault(db, master, {}).save('alice', input), status(400));
    for (const endpoint of [
      'http://example.test',
      'http://localhost:8080',
      'http://127.0.0.2:8080',
      'file:///tmp/key',
      'https://user:password@example.test',
      'https://example.test?key=secret',
      'https://example.test?',
      'https://example.test#fragment',
      'invalid',
    ])
      assert.throws(() => new ProviderVault(db, master, { bad: endpoint }), status(400));
    for (const secret of ['', 'x'.repeat(31), null])
      assert.throws(() => new ProviderVault(db, secret as string, endpoints), status(400));
    // The constructor snapshots host configuration; mutations cannot replace a permitted destination.
    const configured = { hosted: endpoints.hosted };
    const frozen = new ProviderVault(db, master, configured);
    configured.hosted = 'https://attacker.example.test';
    assert.equal(frozen.resolve('alice', vault.save('alice', input).id).endpoint, endpoints.hosted);
  } finally {
    db.close();
  }
});

test('strict bounded input rejects URL/owner injection and enforces five providers independently per owner', () => {
  const { db, vault } = fixture();
  try {
    for (const patch of [
      { label: '' },
      { label: ' ' },
      { label: 'x'.repeat(101) },
      { model: '' },
      { model: ' ' },
      { model: 'x'.repeat(101) },
      { apiKey: '' },
      { apiKey: ' ' },
      { apiKey: 'x'.repeat(501) },
      { apiKey: 42 },
      { endpointId: '' },
      { endpointId: 'x'.repeat(101) },
      { endpoint: endpoints.hosted },
      { url: endpoints.hosted },
      { ownerId: 'bob' },
      { id: 'injected' },
    ])
      assert.throws(
        () => vault.save('alice', { ...input, ...patch } as SaveProviderInput),
        status(400),
      );
    for (const bad of [null, [], 'key'])
      assert.throws(() => vault.save('alice', bad as unknown as SaveProviderInput), status(400));
    assert.deepEqual(vault.list('alice'), []);
    const records = Array.from({ length: 5 }, () => vault.save('alice', input));
    assert.throws(() => vault.save('alice', input), status(409));
    assert.equal(vault.list('alice').length, 5);
    assert.ok(vault.save('bob', input));
    vault.remove('alice', records[0].id);
    const max = {
      ...input,
      label: 'l'.repeat(100),
      model: 'm'.repeat(100),
      apiKey: 'k'.repeat(500),
    };
    const replacement = vault.save('alice', max);
    assert.equal(vault.resolve('alice', replacement.id).apiKey, max.apiKey);
    assert.throws(() => vault.save('alice', input), status(409));
    assert.equal(vault.list('alice').length, 5);
  } finally {
    db.close();
  }
});

test('savepoint count/insertion composes with outer rollback and database failures are sanitized', () => {
  const { db, vault } = fixture();
  try {
    db.exec('BEGIN IMMEDIATE');
    vault.save('alice', input);
    db.exec('ROLLBACK');
    assert.deepEqual(vault.list('alice'), []);
    db.exec(`CREATE TRIGGER fail_provider BEFORE INSERT ON workshop_providers
      BEGIN SELECT RAISE(ABORT, 'secret-injected-database-error'); END`);
    assert.throws(
      () => vault.save('alice', input),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.statusCode, 500);
        assert.equal(error.message, 'Provider unavailable');
        assert.ok(!error.stack?.includes('secret-injected-database-error'));
        return true;
      },
    );
    assert.deepEqual(vault.list('alice'), []);
    assert.equal(db.isTransaction, false);
    db.exec('DROP TRIGGER fail_provider');
    for (let i = 0; i < 5; i++) vault.save('alice', input);
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => vault.save('alice', input), status(409));
    assert.equal(db.isTransaction, true);
    db.exec('ROLLBACK');
    assert.equal(vault.list('alice').length, 5);
  } finally {
    db.close();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.ts';
import { DomainError, DomainsService } from '../src/modules/domains/service.ts';
import {
  McpCredentialError,
  McpCredentials,
  type IssueMcpCredentialInput,
} from '../src/modules/mcp/credentials.ts';

function fixture() {
  const store = new Store(':memory:');
  store.db.exec(
    'CREATE TABLE user(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL)',
  );
  for (const id of ['owner', 'reader', 'other', 'outsider'])
    store.db.prepare('INSERT INTO user VALUES(?,?,?)').run(id, `${id}@example.test`, id);
  const domains = new DomainsService(store.db);
  const domain = domains.create('owner', store.ensure('owner'), { name: 'Shared' });
  domains.setMember('owner', domain.id, { userId: 'reader', role: 'reader' });
  const otherDomain = domains.create('other', store.ensure('other'), { name: 'Other' });
  domains.setMember('other', otherDomain.id, { userId: 'reader', role: 'reader' });
  let now = Date.parse('2026-05-01T00:00:00.000Z');
  const credentials = new McpCredentials(store.db, domains, () => now);
  return {
    store,
    domains,
    domain,
    otherDomain,
    credentials,
    input: { domainId: domain.id, label: 'Desktop', expiresInDays: 30 },
    advance: (milliseconds: number) => (now += milliseconds),
  };
}
function status(code: number) {
  return (error: unknown) =>
    (error instanceof McpCredentialError || error instanceof DomainError) &&
    error.statusCode === code;
}
const recordKeys = ['createdAt', 'domainId', 'expiresAt', 'id', 'label', 'revokedAt'];
const day = 86_400_000;

test('MCP credentials disclose random 256-bit tokens once and persist only SHA-256 digests', () => {
  const { store, domains, domain, credentials, input } = fixture();
  try {
    const issued = Array.from({ length: 20 }, () => credentials.issue('reader', input));
    assert.equal(new Set(issued.map(({ token }) => token)).size, 20);
    assert.equal(new Set(issued.map(({ record }) => record.id)).size, 20);
    for (const { token, record } of issued) {
      assert.match(token, /^meow_mcp_[A-Za-z0-9_-]{43}$/);
      assert.equal(Buffer.from(token.slice('meow_mcp_'.length), 'base64url').length, 32);
      assert.deepEqual(Object.keys(record).sort(), recordKeys);
      assert.equal(record.domainId, domain.id);
      assert.equal(record.createdAt, '2026-05-01T00:00:00.000Z');
      assert.equal(record.expiresAt, '2026-05-31T00:00:00.000Z');
      assert.equal(record.revokedAt, null);
      const row = store.db.prepare('SELECT * FROM mcp_credentials WHERE id=?').get(record.id)!;
      assert.equal(row.hash, createHash('sha256').update(token).digest('hex'));
      assert.equal(row.user_id, 'reader');
      assert.equal(row.scope, 'domain.read');
      assert.ok(!JSON.stringify(row).includes(token));
      assert.deepEqual(credentials.authenticate(token), {
        userId: 'reader',
        domainId: domain.id,
        credentialId: record.id,
      });
    }
    const reopened = new McpCredentials(store.db, domains, () => new Date('2026-05-01'));
    assert.deepEqual(
      reopened.list('reader'),
      issued.map(({ record }) => record),
    );
    for (const record of reopened.list('reader'))
      assert.deepEqual(Object.keys(record).sort(), recordKeys);
    const columns = store.db.prepare('PRAGMA table_info(mcp_credentials)').all();
    assert.ok(!columns.some((column) => /token|plaintext|secret/i.test(String(column.name))));
  } finally {
    store.close();
  }
});

test('issuance uses only real-user domain access, never workspace or foreign-owner authority', () => {
  const { store, domain, otherDomain, credentials, input } = fixture();
  try {
    // A reader has no workspace access or domain-maintenance power, but may issue read credentials.
    assert.throws(() => store.get('reader', domain.workspaceId));
    const { token, record } = credentials.issue('reader', input);
    assert.equal(credentials.authenticate(token).userId, 'reader');
    assert.deepEqual(credentials.list('owner'), []);
    assert.deepEqual(credentials.list('other'), []);
    for (const caller of ['owner', 'other', 'outsider', 'missing'])
      assert.throws(() => credentials.revoke(caller, record.id), status(404));
    assert.throws(() => credentials.revoke('reader', 'missing'), status(404));
    assert.throws(() => credentials.issue('other', input), status(404));
    assert.throws(() => credentials.issue('outsider', input), status(404));
    assert.throws(() => credentials.issue('missing', input), status(404));
    assert.throws(
      () => credentials.issue('owner', { ...input, domainId: otherDomain.id }),
      status(404),
    );
    // Even a legacy/damaged workspace-owned domain cannot issue for a nonexistent account.
    store.db.exec('PRAGMA foreign_keys=OFF');
    store.db.prepare('UPDATE domains SET ownerId=? WHERE id=?').run('ghost', domain.id);
    store.db.exec('PRAGMA foreign_keys=ON');
    assert.throws(() => credentials.issue('ghost', input), status(404));
    assert.equal(credentials.list('ghost').length, 0);
    assert.equal(credentials.list('reader').length, 1);
  } finally {
    store.close();
  }
});

test('expiry boundaries, malformed/unknown tokens and owner revocation reject with 401', () => {
  const { store, credentials, input, advance } = fixture();
  try {
    const expired = credentials.issue('reader', { ...input, expiresInDays: 1 });
    advance(day - 1);
    assert.equal(credentials.authenticate(expired.token).credentialId, expired.record.id);
    advance(1);
    assert.throws(() => credentials.authenticate(expired.token), status(401));
    const live = credentials.issue('reader', input);
    const revoked = credentials.revoke('reader', live.record.id);
    assert.equal(revoked.revokedAt, '2026-05-02T00:00:00.000Z');
    assert.deepEqual(Object.keys(revoked).sort(), recordKeys);
    assert.throws(() => credentials.authenticate(live.token), status(401));
    advance(day);
    assert.deepEqual(credentials.revoke('reader', live.record.id), revoked);
    assert.deepEqual(credentials.list('reader'), [expired.record, revoked]);
    for (const token of [
      '',
      'meow_mcp_short',
      'meow_mcp_' + 'A'.repeat(43),
      live.token + 'x',
      null,
    ])
      assert.throws(() => credentials.authenticate(token as string), status(401));
  } finally {
    store.close();
  }
});

test('authentication rechecks the original user membership and domain visibility every time', () => {
  const { store, domains, domain, credentials, input } = fixture();
  try {
    const { token } = credentials.issue('reader', input);
    assert.equal(credentials.authenticate(token).userId, 'reader');
    domains.removeMember('owner', domain.id, 'reader');
    assert.throws(() => credentials.authenticate(token), status(401));
    assert.equal(domains.get('owner', domain.id).ownerId, 'owner');
    domains.setMember('owner', domain.id, { userId: 'reader', role: 'reader' });
    assert.equal(credentials.authenticate(token).userId, 'reader');
    store.db.exec('PRAGMA foreign_keys=OFF');
    store.db.prepare('DELETE FROM domains WHERE id=?').run(domain.id);
    store.db.exec('PRAGMA foreign_keys=ON');
    // Credential and membership rows deliberately remain: visibility is checked, not cached.
    assert.equal(credentials.list('reader').length, 1);
    assert.throws(() => credentials.authenticate(token), status(401));
  } finally {
    store.close();
  }
});

test('the twenty-active-token quota is per user across domains and excludes revoked/expired rows', () => {
  const { store, otherDomain, credentials, input, advance } = fixture();
  try {
    const short = credentials.issue('reader', { ...input, expiresInDays: 1 });
    const issued = Array.from({ length: 19 }, (_, i) =>
      credentials.issue('reader', {
        ...input,
        domainId: i % 2 ? input.domainId : otherDomain.id,
      }),
    );
    assert.throws(() => credentials.issue('reader', input), status(409));
    assert.equal(credentials.list('reader').length, 20);
    assert.ok(credentials.issue('owner', input).token);
    credentials.revoke('reader', issued[0].record.id);
    assert.ok(credentials.issue('reader', input).token);
    assert.throws(() => credentials.issue('reader', input), status(409));
    advance(day);
    assert.throws(() => credentials.authenticate(short.token), status(401));
    assert.ok(credentials.issue('reader', input).token);
    assert.throws(() => credentials.issue('reader', input), status(409));
    assert.equal(credentials.list('reader').length, 22);
  } finally {
    store.close();
  }
});

test('quota/insertion is atomic, composes with caller rollback and validates bounded fixed scope input', () => {
  const { store, credentials, input } = fixture();
  try {
    for (const patch of [
      { expiresInDays: 0 },
      { expiresInDays: -1 },
      { expiresInDays: 31 },
      { expiresInDays: 1.5 },
      { expiresInDays: NaN },
      { label: '' },
      { label: ' ' },
      { label: 'x'.repeat(201) },
      { domainId: '' },
      { scope: 'domain.write' },
      { userId: 'owner' },
    ])
      assert.throws(
        () => credentials.issue('reader', { ...input, ...patch } as IssueMcpCredentialInput),
        status(400),
      );
    assert.deepEqual(credentials.list('reader'), []);
    store.db.exec(`CREATE TRIGGER fail_credential BEFORE INSERT ON mcp_credentials
      BEGIN SELECT RAISE(ABORT, 'injected credential failure'); END`);
    assert.throws(() => credentials.issue('reader', input), /injected credential failure/);
    assert.equal(credentials.list('reader').length, 0);
    store.db.exec('DROP TRIGGER fail_credential; BEGIN IMMEDIATE');
    const issued = credentials.issue('reader', input);
    assert.equal(credentials.authenticate(issued.token).userId, 'reader');
    store.db.exec('ROLLBACK');
    assert.deepEqual(credentials.list('reader'), []);
    assert.throws(() => credentials.authenticate(issued.token), status(401));
    for (let i = 0; i < 20; i++) credentials.issue('reader', input);
    store.db.exec('BEGIN IMMEDIATE');
    assert.throws(() => credentials.issue('reader', input), status(409));
    assert.equal(store.db.isTransaction, true);
    store.db.exec('ROLLBACK');
    assert.equal(credentials.list('reader').length, 20);
  } finally {
    store.close();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { DomainError, DomainsService } from '../src/modules/domains/service.ts';

function fixture() {
  const store = new Store(':memory:');
  store.db.exec(
    'CREATE TABLE user(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL)',
  );
  for (const id of ['owner', 'reader', 'writer', 'maintainer', 'outsider', 'other']) {
    store.db.prepare('INSERT INTO user VALUES(?,?,?)').run(id, `${id}@example.test`, id);
  }
  const workspaceId = store.ensure('owner');
  const service = new DomainsService(store.db);
  const domain = service.create('owner', workspaceId, { name: 'Shared', buildProfile: 'research' });
  service.setMember('owner', domain.id, { userId: 'reader', role: 'reader' });
  service.setMember('owner', domain.id, { userId: 'writer', role: 'contributor' });
  service.setMember('owner', domain.id, { userId: 'maintainer', role: 'maintainer' });
  return { store, workspaceId, service, domain };
}
function status(code: number) {
  return (error: unknown) => error instanceof DomainError && error.statusCode === code;
}
const proposal = {
  title: 'Snapshot',
  content: 'searchable immutable snapshot',
  expectedDomainRevision: 1,
};

test('domain permission matrix hides foreign domains and never shares workspace private pages', () => {
  const { store, workspaceId, service, domain } = fixture();
  try {
    store.change('owner', workspaceId, (draft) => {
      draft.pages[0].markdown = 'private-secret';
      draft.pages[0].revision += 1;
    });
    for (const user of ['owner', 'reader', 'writer', 'maintainer']) {
      assert.equal(service.get(user, domain.id).id, domain.id);
      assert.equal(service.list(user).length, 1);
      assert.deepEqual(service.search(user, domain.id, 'private-secret'), []);
      assert.deepEqual(service.contributions(user, domain.id), []);
    }
    assert.deepEqual(service.list('outsider'), []);
    for (const operation of [
      () => service.get('outsider', domain.id),
      () => service.members('outsider', domain.id),
      () => service.search('outsider', domain.id, 'x'),
      () => service.contributions('outsider', domain.id),
      () => service.submit('outsider', domain.id, proposal),
      () => service.update('outsider', domain.id, { name: 'bad', expectedRevision: 1 }),
    ])
      assert.throws(operation, status(404));
    for (const user of ['reader', 'writer']) {
      assert.throws(() => service.members(user, domain.id), status(403));
      assert.throws(() => service.update(user, domain.id, { expectedRevision: 1 }), status(403));
    }
    for (const user of ['reader', 'writer', 'maintainer']) {
      assert.throws(
        () => service.setMember(user, domain.id, { userId: 'outsider', role: 'reader' }),
        status(403),
      );
      assert.throws(() => service.removeMember(user, domain.id, 'reader'), status(403));
    }
    assert.equal(service.members('maintainer', domain.id).length, 4);
    assert.throws(() => service.create('outsider', workspaceId, { name: 'stolen' }), status(404));
    assert.throws(() => store.get('reader', workspaceId));
    assert.equal(store.get('owner', workspaceId).pages[0].markdown, 'private-secret');
    assert.throws(() => service.submit('reader', domain.id, proposal), status(403));
    assert.throws(
      () => service.setMember('owner', domain.id, { userId: 'missing', role: 'reader' }),
      status(404),
    );
    assert.throws(() => service.removeMember('owner', domain.id, 'owner'), status(409));
    assert.throws(
      () => service.setMember('owner', domain.id, { userId: 'owner', role: 'reader' }),
      status(409),
    );
    service.removeMember('owner', domain.id, 'reader');
    assert.throws(() => service.get('reader', domain.id), status(404));
  } finally {
    store.close();
  }
});

test('contribution visibility, review permissions, immutable snapshots and stale publication CAS', () => {
  const { store, service, domain } = fixture();
  try {
    const pending = service.submit('writer', domain.id, proposal);
    assert.equal(service.contributions('writer', domain.id).length, 1);
    assert.deepEqual(service.contributions('reader', domain.id), []);
    assert.equal(service.contributions('maintainer', domain.id).length, 1);
    assert.deepEqual(service.search('writer', domain.id, 'searchable'), []);
    for (const user of ['reader', 'writer'])
      assert.throws(
        () => service.review(user, domain.id, pending.id, { decision: 'published' }),
        status(403),
      );
    const own = service.submit('owner', domain.id, proposal);
    assert.throws(
      () => service.review('owner', domain.id, own.id, { decision: 'published' }),
      status(403),
    );
    const maintainerOwn = service.submit('maintainer', domain.id, proposal);
    assert.throws(
      () => service.review('maintainer', domain.id, maintainerOwn.id, { decision: 'rejected' }),
      status(403),
    );
    const published = service.review('maintainer', domain.id, pending.id, {
      decision: 'published',
      reason: 'verified',
    });
    assert.equal(published.status, 'published');
    assert.equal(service.get('owner', domain.id).revision, 2);
    assert.equal(service.contributions('reader', domain.id).length, 1);
    assert.equal(service.search('reader', domain.id, 'searchable')[0].content, proposal.content);
    assert.throws(
      () => service.review('maintainer', domain.id, own.id, { decision: 'published' }),
      status(409),
    );
    assert.equal(service.get('owner', domain.id).revision, 2);
    assert.equal(
      service.contributions('owner', domain.id).find((c) => c.id === own.id)!.status,
      'pending',
    );
    service.review('maintainer', domain.id, own.id, { decision: 'rejected', reason: 'stale' });
    assert.equal(service.get('owner', domain.id).revision, 2);
    assert.equal(
      service.contributions('owner', domain.id).find((c) => c.id === own.id)!.status,
      'rejected',
    );
    assert.throws(
      () => service.review('maintainer', domain.id, pending.id, { decision: 'rejected' }),
      status(409),
    );
    const d2 = service.create('owner', domain.workspaceId, { name: 'second' });
    assert.throws(
      () => service.review('owner', d2.id, pending.id, { decision: 'published' }),
      status(404),
    );
    const stale = service.submit('writer', domain.id, proposal);
    service.review('owner', domain.id, stale.id, { decision: 'rejected' });
    assert.ok(!service.contributions('writer', domain.id).some((c) => c.id === stale.id));
    service.update('owner', domain.id, { name: 'new', expectedRevision: 2 });
    assert.equal(service.search('reader', domain.id, 'searchable')[0].content, proposal.content);
  } finally {
    store.close();
  }
});

test('metadata CAS and review are synchronous, atomic, persisted and compose with caller rollback', () => {
  const { store, service, domain } = fixture();
  try {
    assert.equal(
      service.update('maintainer', domain.id, { buildProfile: 'product', expectedRevision: 1 })
        .revision,
      2,
    );
    assert.throws(
      () => service.update('owner', domain.id, { name: 'lost', expectedRevision: 1 }),
      status(409),
    );
    const pending = service.submit('writer', domain.id, { ...proposal, expectedDomainRevision: 2 });
    store.db.exec(
      `CREATE TRIGGER fail_review BEFORE UPDATE ON domain_contributions BEGIN SELECT RAISE(ABORT,'injected review failure'); END`,
    );
    assert.throws(
      () => service.review('owner', domain.id, pending.id, { decision: 'published' }),
      /injected review failure/,
    );
    assert.equal(service.get('owner', domain.id).revision, 2);
    assert.equal(service.contributions('owner', domain.id)[0].status, 'pending');
    store.db.exec('DROP TRIGGER fail_review; BEGIN IMMEDIATE');
    service.review('owner', domain.id, pending.id, { decision: 'published' });
    assert.equal(service.get('owner', domain.id).revision, 3);
    store.db.exec('ROLLBACK');
    const reopened = new DomainsService(store.db);
    assert.equal(reopened.get('owner', domain.id).revision, 2);
    assert.equal(reopened.contributions('owner', domain.id)[0].status, 'pending');
    service.review('owner', domain.id, pending.id, { decision: 'published' });
    assert.equal(reopened.get('owner', domain.id).revision, 3);
  } finally {
    store.close();
  }
});

test('bounded domains, contributions, validated content and literal bounded published search', () => {
  const { store, workspaceId, service, domain } = fixture();
  try {
    for (let i = 1; i < 20; i++) service.create('owner', workspaceId, { name: `domain-${i}` });
    assert.throws(() => service.create('owner', workspaceId, { name: 'overflow' }), status(409));
    assert.throws(
      () => service.submit('writer', domain.id, { ...proposal, content: 'x'.repeat(100001) }),
      status(400),
    );
    assert.throws(
      () =>
        service.create('owner', workspaceId, {
          name: 'bad',
          buildProfile: 'executable' as 'general',
        }),
      status(400),
    );
    assert.throws(() => service.update('owner', domain.id, { expectedRevision: 0 }), status(400));
    for (let i = 1; i <= 25; i++) {
      const c = service.submit('writer', domain.id, { ...proposal, expectedDomainRevision: i });
      service.review('owner', domain.id, c.id, { decision: 'published' });
    }
    assert.equal(service.search('reader', domain.id, 'searchable').length, 20);
    assert.deepEqual(service.search('reader', domain.id, '%'), []);
    assert.deepEqual(service.search('reader', domain.id, "' OR 1=1 --"), []);
    assert.throws(() => service.search('reader', domain.id, ' '), status(400));
    for (let i = 0; i < 100; i++) service.submit('writer', domain.id, proposal);
    assert.throws(() => service.submit('writer', domain.id, proposal), status(409));
    assert.equal(service.contributions('owner', domain.id).length, 125);
    for (const contribution of service
      .contributions('owner', domain.id)
      .filter((c) => c.status === 'pending'))
      service.review('owner', domain.id, contribution.id, { decision: 'rejected' });
    assert.throws(() => service.pruneRejected('writer', domain.id), status(403));
    assert.equal(service.pruneRejected('owner', domain.id).removed, 100);
    assert.equal(service.contributions('owner', domain.id).length, 25);
    assert.ok(service.submit('writer', domain.id, proposal).id);
  } finally {
    store.close();
  }
});

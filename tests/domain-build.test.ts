import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { DomainsService } from '../src/modules/domains/service.ts';
import { DomainBuildService } from '../src/modules/domains/build-service.ts';
test('scenario build compiles published evidence into a pending contribution and preserves review CAS', () => {
  const store = new Store(':memory:');
  try {
    store.db.exec(
      "CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT,name TEXT);INSERT INTO user VALUES('owner','o@test.invalid','Owner'),('author','a@test.invalid','Author')",
    );
    const domains = new DomainsService(store.db);
    const domain = domains.create('owner', store.ensure('owner'), {
      name: '项目域',
      buildProfile: 'project',
    });
    domains.setMember('owner', domain.id, { userId: 'author', role: 'contributor' });
    const source = domains.submit('author', domain.id, {
      title: '架构证据',
      content: '模块化单体。',
      expectedDomainRevision: 1,
    });
    domains.review('owner', domain.id, source.id, { decision: 'published', reason: 'checked' });
    const builder = new DomainBuildService(domains);
    const result = builder.build('author', domain.id, {
      title: '项目总览',
      contributionIds: [source.id],
      expectedRevision: 2,
    });
    assert.equal(result.mode, 'deterministic-compilation');
    assert.equal(result.contribution.status, 'pending');
    assert.match(result.contribution.content, /未调用语言模型/);
    assert.match(result.contribution.content, /架构与模块/);
    assert.equal(domains.get('author', domain.id).revision, 2);
    assert.throws(() =>
      builder.build('author', domain.id, {
        title: 'stale',
        contributionIds: [source.id],
        expectedRevision: 1,
      }),
    );
    domains.review('owner', domain.id, result.contribution.id, {
      decision: 'published',
      reason: 'approved',
    });
    assert.equal(domains.get('owner', domain.id).revision, 3);
  } finally {
    store.close();
  }
});

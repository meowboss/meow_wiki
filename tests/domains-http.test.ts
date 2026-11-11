import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
test('domain membership grants domain access, never private workspace access', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store, mode: 'session' });
  async function user(name: string) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:3000' },
      payload: { name, email: `${name}@example.test`, password: 'domain-password-123' },
    });
    assert.equal(created.statusCode, 200, created.body);
    const cookies = created.headers['set-cookie']!;
    const cookie = (Array.isArray(cookies) ? cookies : [cookies])
      .map((c) => c.split(';')[0])
      .join('; ');
    const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
    return { cookie, origin: 'http://localhost:3000', 'x-csrf-token': me.csrfToken };
  }
  try {
    const owner = await user('owner');
    const member = await user('member');
    const workspace = (await app.inject({ url: '/api/workspace', headers: owner })).json().workspace
      .id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: owner,
      payload: { name: '项目知识域', description: '共同维护', buildProfile: 'project' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const domain = created.json();
    assert.equal(
      (await app.inject({ url: `/api/domains/${domain.id}`, headers: member })).statusCode,
      404,
    );
    const invite = await app.inject({
      method: 'POST',
      url: `/api/domains/${domain.id}/members`,
      headers: owner,
      payload: { email: 'member@example.test', role: 'contributor' },
    });
    assert.equal(invite.statusCode, 200, invite.body);
    assert.equal(
      (await app.inject({ url: `/api/domains/${domain.id}`, headers: member })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: `/api/workspace?workspaceId=${workspace}`, headers: member }))
        .statusCode,
      404,
    );
    const proposal = await app.inject({
      method: 'POST',
      url: `/api/domains/${domain.id}/contributions`,
      headers: member,
      payload: {
        title: '项目架构',
        content: '模块化单体。',
        expectedDomainRevision: domain.revision,
      },
    });
    assert.equal(proposal.statusCode, 201, proposal.body);
    const published = await app.inject({
      method: 'POST',
      url: `/api/domains/${domain.id}/contributions/${proposal.json().id}/review`,
      headers: owner,
      payload: { decision: 'published', reason: '核对通过' },
    });
    assert.equal(published.statusCode, 200, published.body);
    assert.equal(
      (
        await app.inject({
          url: `/api/domains/${domain.id}/search?q=${encodeURIComponent('模块')}`,
          headers: member,
        })
      ).json().results.length,
      1,
    );
  } finally {
    await app.close();
    store.close();
  }
});

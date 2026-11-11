import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';

test('formal session compatibility: registration, CSRF, multiple spaces, isolation and logout', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store, mode: 'session' });
  const register = async (username: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:3000' },
      payload: { email: `${username}@example.test`, name: username, password: 'long-password-123' },
    });
    assert.equal(response.statusCode, 200);
    const set = response.headers['set-cookie'];
    assert.ok(Array.isArray(set));
    assert.ok(set[0].includes('HttpOnly'));
    const cookie = set.map((s) => s.split(';')[0]).join('; ');
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    return { cookie, origin: 'http://localhost:3000', 'x-csrf-token': me.json().csrfToken };
  };
  try {
    assert.equal((await app.inject('/api/auth/me')).json().user, null);
    assert.equal((await app.inject('/api/workspace')).statusCode, 401);
    const alice = await register('alice');
    const bob = await register('bobby');
    const initial = await app.inject({ url: '/api/workspaces', headers: alice });
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.json().workspaces.length, 1);
    const defaultId = initial.json().workspaces[0].id;
    const bobSpaces = (await app.inject({ url: '/api/workspaces', headers: bob })).json()
      .workspaces;
    assert.equal(bobSpaces.length, 1);
    assert.notEqual(bobSpaces[0].id, defaultId);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/workspaces',
          headers: { cookie: alice.cookie },
          payload: { name: 'bad csrf' },
        })
      ).statusCode,
      403,
    );
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: alice,
      payload: { name: '研究空间' },
    });
    assert.equal(created.statusCode, 201);
    const id = created.json().id;
    const listed = await app.inject({ url: '/api/workspaces', headers: alice });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().workspaces.length, 2);
    assert.deepEqual(
      new Set(listed.json().workspaces.map((w: { id: string }) => w.id)),
      new Set([defaultId, id]),
    );
    assert.equal(
      (await app.inject({ url: '/api/workspaces', headers: bob })).json().workspaces.length,
      1,
    );
    assert.equal(
      (await app.inject({ url: `/api/workspace?workspaceId=${id}`, headers: bob })).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/workspaces/${id}`,
          headers: bob,
          payload: { name: 'attack', description: '' },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/pages?workspaceId=' + id,
          headers: alice,
          payload: { title: 'private', markdown: 'secret' },
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: alice, payload: {} }))
        .statusCode,
      200,
    );
    assert.equal((await app.inject({ url: '/api/workspaces', headers: alice })).statusCode, 401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'http://localhost:3000' },
      payload: { email: 'alice@example.test', password: 'long-password-123' },
    });
    assert.equal(login.statusCode, 200);
    assert.doesNotMatch(login.body, /password_hash|password_salt|token_hash/);
  } finally {
    await app.close();
    store.close();
  }
});

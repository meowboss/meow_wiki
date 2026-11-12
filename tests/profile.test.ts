import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyRequest } from 'fastify';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { Identity, type IdentitySession } from '../src/identity.ts';
import { createKernel } from '../src/plugins/official.ts';
import { createHttpContext } from '../src/http/context.ts';
import { registerSecurity } from '../src/http/security.ts';
import { registerIdentityRoutes } from '../src/http/identity-routes.ts';
import { registerProfileRoutes } from '../src/modules/profile/routes.ts';
import { ProfileError, ProfileService } from '../src/modules/profile/service.ts';

const origin = 'http://localhost:3000';
const secret = 'profile-test-secret-more-than-thirty-two-characters';
const fields = ['createdAt', 'email', 'emailVerified', 'id', 'name', 'role', 'updatedAt'];

function fixture(mode: 'session' | 'local' | 'token' = 'session') {
  const store = new Store(':memory:');
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  const identity = mode === 'session' ? new Identity(store.db, { authSecret: secret }) : undefined;
  const kernel = createKernel();
  const context = createHttpContext({
    store,
    components: new ComponentService(store.db),
    kernel,
    mode,
    owner: 'local-owner',
    identity,
    sessions: new WeakMap<FastifyRequest, IdentitySession>(),
  });
  app.addHook('onReady', async () => {
    await identity?.ready();
  });
  registerSecurity(app, context, secret);
  registerIdentityRoutes(app, context);
  registerProfileRoutes(app, context);
  return {
    app,
    store,
    async close() {
      await app.close();
      kernel.dispose();
      store.close();
    },
  };
}

function cookieJar(value: string | string[] | undefined) {
  assert.ok(value);
  return (Array.isArray(value) ? value : [value]).map((cookie) => cookie.split(';')[0]).join('; ');
}

async function signup(app: ReturnType<typeof fixture>['app'], name: string) {
  const credentials = {
    name,
    email: `${name.toLowerCase()}@example.test`,
    password: 'long-password-123',
  };
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin },
    payload: credentials,
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = cookieJar(response.headers['set-cookie']);
  const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  return {
    id: response.json().user.id as string,
    credentials,
    cookie,
    headers: { cookie, origin, 'x-csrf-token': me.json().csrfToken as string },
  };
}

function status(code: number) {
  return (error: unknown) => error instanceof ProfileError && error.statusCode === code;
}

test('profile service follows actual Better Auth SQLite schema and scopes updates in a transaction', async () => {
  const f = fixture();
  try {
    const alice = await signup(f.app, 'Alice');
    const bob = await signup(f.app, 'Bob');
    const profiles = new ProfileService(f.store.db);
    const before = profiles.get(alice.id);
    assert.deepEqual(Object.keys(before).sort(), fields);
    assert.equal(before.emailVerified, false);
    assert.equal(before.role, 'user');
    const columns = f.store.db.prepare('PRAGMA table_info(user)').all();
    for (const name of ['createdAt', 'updatedAt']) {
      assert.equal(columns.find((column) => column.name === name)?.type, 'date');
    }
    const raw = f.store.db
      .prepare('SELECT createdAt, updatedAt, typeof(updatedAt) AS storage FROM user WHERE id = ?')
      .get(alice.id)!;
    assert.equal(raw.storage, 'text');
    assert.equal(raw.createdAt, before.createdAt);
    assert.equal(raw.updatedAt, before.updatedAt);
    assert.match(before.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const bobBefore = profiles.get(bob.id);
    const updated = profiles.update(alice.id, { name: '  Updated Alice  ' });
    assert.equal(updated.name, 'Updated Alice');
    assert.equal(updated.createdAt, before.createdAt);
    assert.ok(Date.parse(updated.updatedAt) >= Date.parse(before.updatedAt));
    assert.equal(updated.email, before.email);
    assert.equal(updated.id, before.id);
    assert.equal(updated.role, before.role);
    assert.equal(profiles.get(bob.id).name, 'Bob');
    assert.deepEqual(profiles.get(bob.id), bobBefore);
    assert.equal(
      f.store.db.prepare('SELECT updatedAt FROM user WHERE id = ?').get(alice.id)?.updatedAt,
      updated.updatedAt,
    );
    assert.throws(() => profiles.get('missing'), status(404));
    assert.throws(() => profiles.update('missing', { name: 'Nobody' }), status(404));
    // A missing-user rollback must leave the connection usable for another transaction.
    assert.equal(profiles.update(alice.id, { name: 'a'.repeat(80) }).name.length, 80);
    for (const input of [
      undefined,
      null,
      {},
      { name: '' },
      { name: '  ' },
      { name: 4 },
      { name: 'a'.repeat(81) },
      { name: 'Alice', email: 'changed@example.test' },
      { name: 'Alice', id: bob.id },
      { name: 'Alice', role: 'admin' },
      { name: 'Alice', image: 'https://external.invalid/avatar' },
      { name: 'Alice', unknown: true },
    ]) {
      assert.throws(() => profiles.update(alice.id, input), status(400));
    }
  } finally {
    await f.close();
  }
});

test('profile HTTP requires cookies and CSRF, rejects partial/unknown fields, preserves roles and fresh session names', async () => {
  const f = fixture();
  try {
    const alice = await signup(f.app, 'Alice');
    const bob = await signup(f.app, 'Bob');
    for (const method of ['GET', 'PATCH'] as const) {
      const response = await f.app.inject({
        method,
        url: '/api/profile',
        ...(method === 'PATCH' ? { payload: { name: 'No' } } : {}),
      });
      assert.equal(response.statusCode, 401, response.body);
    }
    const initial = await f.app.inject({ url: '/api/profile', headers: alice.headers });
    assert.equal(initial.statusCode, 200, initial.body);
    assert.deepEqual(Object.keys(initial.json()).sort(), fields);
    assert.equal(initial.json().email, alice.credentials.email);
    const bobBefore = (await f.app.inject({ url: '/api/profile', headers: bob.headers })).json();
    for (const headers of [
      { cookie: alice.cookie },
      { ...alice.headers, 'x-csrf-token': bob.headers['x-csrf-token'] },
      { ...alice.headers, origin: 'https://external.invalid' },
    ]) {
      const blocked = await f.app.inject({
        method: 'PATCH',
        url: '/api/profile',
        headers,
        payload: { name: 'No' },
      });
      assert.equal(blocked.statusCode, 403, blocked.body);
    }
    f.store.db
      .prepare('INSERT INTO mw_platform_roles (user_id, role) VALUES (?, ?)')
      .run(alice.id, 'admin');
    for (const payload of [
      {},
      { email: 'new@example.test' },
      { name: '   ' },
      { name: 'x'.repeat(81) },
      { name: 'Alice', role: 'user' },
      { name: 'Alice', email: 'new@example.test' },
      { name: 'Alice', id: bob.id },
      { name: 'Alice', emailVerified: true },
      { name: 'Alice', image: 'https://external.invalid/a.png' },
      { name: 'Alice', unknown: true },
    ]) {
      const invalid = await f.app.inject({
        method: 'PATCH',
        url: '/api/profile',
        headers: alice.headers,
        payload,
      });
      assert.equal(invalid.statusCode, 400, invalid.body);
    }
    const patched = await f.app.inject({
      method: 'PATCH',
      url: '/api/profile',
      headers: alice.headers,
      payload: { name: '  New Alice  ' },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.deepEqual(patched.json(), {
      ...initial.json(),
      name: 'New Alice',
      updatedAt: patched.json().updatedAt,
      role: 'admin',
    });
    assert.equal(
      f.store.db.prepare('SELECT role FROM mw_platform_roles WHERE user_id = ?').get(alice.id)
        ?.role,
      'admin',
    );
    assert.deepEqual(
      (await f.app.inject({ url: '/api/profile', headers: bob.headers })).json(),
      bobBefore,
    );
    const me = await f.app.inject({ url: '/api/auth/me', headers: alice.headers });
    assert.deepEqual(me.json().user, { id: alice.id, username: 'New Alice', role: 'admin' });
    const session = await f.app.inject({ url: '/api/auth/get-session', headers: alice.headers });
    assert.equal(session.json().user.name, 'New Alice');
    assert.equal(session.json().user.updatedAt, patched.json().updatedAt);
    const logout = await f.app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: alice.headers,
      payload: {},
    });
    assert.equal(logout.statusCode, 200, logout.body);
    assert.equal(
      (await f.app.inject({ url: '/api/profile', headers: alice.headers })).statusCode,
      401,
    );
    const login = await f.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin },
      payload: { email: alice.credentials.email, password: alice.credentials.password },
    });
    assert.equal(login.statusCode, 200, login.body);
    const persisted = await f.app.inject({
      url: '/api/profile',
      headers: { cookie: cookieJar(login.headers['set-cookie']) },
    });
    assert.equal(persisted.statusCode, 200, persisted.body);
    assert.deepEqual(persisted.json(), patched.json());
  } finally {
    await f.close();
  }
});

test('profile routes return 409 for local and authenticated token identities', async () => {
  for (const mode of ['local', 'token'] as const) {
    const f = fixture(mode);
    try {
      for (const method of ['GET', 'PATCH'] as const) {
        const response = await f.app.inject({
          method,
          url: '/api/profile',
          headers: mode === 'token' ? { authorization: `Bearer ${secret}` } : {},
          ...(method === 'PATCH' ? { payload: { name: 'No account' } } : {}),
        });
        assert.equal(response.statusCode, 409, response.body);
      }
    } finally {
      await f.close();
    }
  }
});

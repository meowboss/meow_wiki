import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';

const origin = 'http://localhost:3000';
const credentials = (name: string) => ({
  email: `${name.toLowerCase()}@example.test`,
  name,
  password: 'long-password-123',
});
function cookieJar(value: string | string[] | undefined) {
  assert.ok(value);
  return (Array.isArray(value) ? value : [value]).map((cookie) => cookie.split(';')[0]).join('; ');
}

test('Better Auth HTTP: signup, aggregate identity, CSRF, workspaces, isolation and logout revocation', async () => {
  const store = new Store(':memory:');
  const app = createApp({
    store,
    mode: 'session',
    authSecret: 'test-secret-with-more-than-thirty-two-characters',
  });
  try {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin, 'x-meow-identity-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.8' },
      payload: credentials('Alice'),
    });
    assert.equal(signup.statusCode, 200, signup.body);
    const cookie = cookieJar(signup.headers['set-cookie']);
    assert.match(String(signup.headers['set-cookie']), /HttpOnly/i);
    const sessionRecord = store.db.prepare('SELECT ipAddress FROM session').get();
    assert.equal(sessionRecord?.ipAddress, '127.0.0.1');
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    assert.equal(me.statusCode, 200, me.body);
    const identity = me.json();
    assert.deepEqual(identity.user, { id: signup.json().user.id, username: 'Alice', role: 'user' });
    assert.equal(identity.mode, 'session');
    assert.ok(identity.csrfToken.length >= 32);
    const standard = await app.inject({ url: '/api/auth/get-session', headers: { cookie } });
    assert.equal(standard.json().user.email, credentials('Alice').email);
    assert.equal(standard.json().csrfToken, undefined);
    const unauth = await app.inject({ url: '/api/workspaces' });
    assert.equal(unauth.statusCode, 401);
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { cookie },
      payload: { name: 'No CSRF' },
    });
    assert.equal(blocked.statusCode, 403);
    const writeHeaders = { cookie, origin, 'x-csrf-token': identity.csrfToken };
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: writeHeaders,
      payload: { name: 'Second garden' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const workspaceId = created.json().id;
    const list = await app.inject({ url: '/api/workspaces', headers: { cookie } });
    assert.equal(list.json().workspaces.length, 2);
    const page = await app.inject({
      method: 'POST',
      url: `/api/pages?workspaceId=${workspaceId}`,
      headers: writeHeaders,
      payload: { title: 'Private', markdown: 'Alice only' },
    });
    assert.equal(page.statusCode, 201, page.body);
    const bob = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin },
      payload: credentials('Bob'),
    });
    assert.equal(bob.statusCode, 200, bob.body);
    const bobCookie = cookieJar(bob.headers['set-cookie']);
    const bobMe = (
      await app.inject({ url: '/api/auth/me', headers: { cookie: bobCookie } })
    ).json();
    const cross = await app.inject({
      url: `/api/workspace?workspaceId=${workspaceId}`,
      headers: { cookie: bobCookie },
    });
    assert.equal(cross.statusCode, 404);
    const crossWrite = await app.inject({
      method: 'POST',
      url: `/api/pages?workspaceId=${workspaceId}`,
      headers: { cookie: bobCookie, 'x-csrf-token': bobMe.csrfToken },
      payload: { title: 'Attack', markdown: 'No' },
    });
    assert.equal(crossWrite.statusCode, 404);
    const stolenCsrf = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { cookie: bobCookie, 'x-csrf-token': identity.csrfToken },
      payload: { name: 'Attack' },
    });
    assert.equal(stolenCsrf.statusCode, 403);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin },
      payload: {},
    });
    assert.equal(logout.statusCode, 200, logout.body);
    assert.ok(logout.headers['set-cookie']);
    const stale = await app.inject({ url: '/api/auth/get-session', headers: { cookie } });
    assert.equal(stale.json(), null);
    assert.equal(
      (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json().user,
      null,
    );
    assert.equal(
      (await app.inject({ url: '/api/workspaces', headers: { cookie } })).statusCode,
      401,
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin },
      payload: { email: credentials('Alice').email, password: credentials('Alice').password },
    });
    assert.equal(login.statusCode, 200, login.body);
    const renewed = (
      await app.inject({
        url: '/api/auth/me',
        headers: { cookie: cookieJar(login.headers['set-cookie']) },
      })
    ).json();
    assert.notEqual(renewed.csrfToken, identity.csrfToken);
    assert.equal(store.db.prepare('SELECT role FROM mw_platform_roles').all().length, 0);
    // Application roles come exclusively from the host-owned table, not Better Auth signup.
    store.db
      .prepare('INSERT INTO mw_platform_roles (user_id, role) VALUES (?, ?)')
      .run(identity.user.id, 'admin');
    const hostPromoted = (
      await app.inject({
        url: '/api/auth/me',
        headers: { cookie: cookieJar(login.headers['set-cookie']) },
      })
    ).json();
    assert.equal(hostPromoted.user.role, 'admin');
  } finally {
    await app.close();
    store.close();
  }
});

test('Better Auth boundary: hostile origins, absolute URLs, role injection and reserved emails are rejected', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store, mode: 'session', reservedAdminEmails: ['root@example.test'] });
  try {
    for (const badOrigin of [
      'https://evil.invalid',
      'http://localhost:5173',
      `${origin}/path`,
      'null',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: badOrigin },
        payload: credentials('Alice'),
      });
      assert.equal(response.statusCode, 403, `${badOrigin}: ${response.body}`);
    }
    // inject normalizes absolute URLs before sending; real HTTP preserves the request-target.
    const address = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
    for (const path of [
      'http://localhost:3000/api/workspaces',
      'http://evil.invalid/api/auth/me',
      '//evil.invalid/api/workspaces',
    ]) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const outgoing = httpRequest(
          { hostname: '127.0.0.1', port: address.port, path, headers: { host: 'localhost:3000' } },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
          },
        );
        outgoing.on('error', reject);
        outgoing.end();
      });
      assert.equal(status, 400, path);
    }
    const host = await app.inject({ url: '/api/auth/me', headers: { host: 'evil.invalid' } });
    assert.equal(host.statusCode, 403);
    const injectRole = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin },
      payload: { ...credentials('Alice'), role: 'admin' },
    });
    assert.equal(injectRole.statusCode, 400, injectRole.body);
    const reserved = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin },
      payload: { ...credentials('Root'), email: 'ROOT@example.test' },
    });
    assert.equal(reserved.statusCode, 403);
    for (const endpoint of ['login', 'register', 'logout']) {
      assert.equal(
        (await app.inject({ method: 'POST', url: `/api/auth/${endpoint}`, payload: {} }))
          .statusCode,
        404,
      );
    }
    assert.equal(store.db.prepare('SELECT id FROM user').all().length, 0);
  } finally {
    await app.close();
    store.close();
  }
});

test('Better Auth configuration: explicit origins and valid secrets', async () => {
  const store = new Store(':memory:');
  assert.throws(() => createApp({ store, mode: 'session', authSecret: 'short' }), /32/);
  const app = createApp({ store, mode: 'session', trustedOrigins: ['http://localhost:5173'] });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:5173' },
      payload: credentials('Vite'),
    });
    assert.equal(response.statusCode, 200, response.body);
  } finally {
    await app.close();
    store.close();
  }
});

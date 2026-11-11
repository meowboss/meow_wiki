import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { fromNodeHeaders } from 'better-auth/node';

test('selection spike: Better Auth supports Node SQLite migrations, Fastify cookies, sessions and origin rejection', async () => {
  const db = new DatabaseSync(':memory:');
  const origin = 'http://localhost:3000';
  const options = {
    database: db, baseURL: origin, secret: randomBytes(48).toString('base64url'),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    rateLimit: { enabled: true, storage: 'database' as const },
    advanced: { database: { generateId: () => crypto.randomUUID() } },
  };
  const migrations = await getMigrations(options);
  await migrations.runMigrations();
  const second = await getMigrations(options);
  assert.equal(second.toBeCreated.length, 0);
  const auth = betterAuth(options);
  const app = Fastify();
  app.route({ method: ['GET', 'POST'], url: '/api/auth/*', async handler(request, reply) {
    const response = await auth.handler(new Request(new URL(request.url, origin), {
      method: request.method, headers: fromNodeHeaders(request.headers),
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    }));
    reply.code(response.status);
    for (const [key, value] of response.headers) if (key !== 'set-cookie') reply.header(key, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    return reply.send(await response.text());
  } });
  try {
    const signup = await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { origin }, payload: { email: 'alice@example.test', password: 'long-password-123', name: 'Alice' } });
    assert.equal(signup.statusCode, 200, signup.body);
    const cookies = signup.headers['set-cookie'];
    assert.ok(cookies);
    const cookie = (Array.isArray(cookies) ? cookies : [cookies]).map(c => c.split(';')[0]).join('; ');
    assert.match(String(cookies), /HttpOnly/i);
    const session = await app.inject({ url: '/api/auth/get-session', headers: { cookie } });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().user.email, 'alice@example.test');
    const bad = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: 'https://evil.invalid' }, payload: { email: 'alice@example.test', password: 'long-password-123' } });
    assert.equal(bad.statusCode, 403);
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin }, payload: { email: 'alice@example.test', password: 'wrong-password-123' } });
    assert.equal(wrong.statusCode, 401);
    const logout = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie, origin }, payload: {} });
    assert.equal(logout.statusCode, 200, logout.body);
    const stale = await app.inject({ url: '/api/auth/get-session', headers: { cookie } });
    assert.equal(stale.json(), null);
    const account = db.prepare('SELECT password FROM account').get();
    assert.ok(account); assert.notEqual(account.password, 'long-password-123');
  } finally { await app.close(); db.close(); }
});

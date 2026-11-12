import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
test('both same-port loopback hosts support authentication and CSRF writes without trusting other origins', async () => {
  for (const base of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
    const store = new Store(':memory:');
    const app = createApp({ store, mode: 'session', authBaseURL: base });
    try {
      for (const [i, origin] of ['http://localhost:3000', 'http://127.0.0.1:3000'].entries()) {
        const host = new URL(origin).host;
        const signup = await app.inject({
          method: 'POST',
          url: '/api/auth/sign-up/email',
          headers: { host, origin },
          payload: {
            name: '回环测试',
            email: `loopback${i}@example.test`,
            password: 'loopback-password-123',
          },
        });
        assert.equal(signup.statusCode, 200, signup.body);
        const set = signup.headers['set-cookie']!;
        const cookie = (Array.isArray(set) ? set : [set]).map((v) => v.split(';')[0]).join('; ');
        const me = (await app.inject({ url: '/api/auth/me', headers: { host, cookie } })).json();
        assert.ok(me.user);
        const write = await app.inject({
          method: 'POST',
          url: '/api/pages',
          headers: { host, origin, cookie, 'x-csrf-token': me.csrfToken },
          payload: { title: '回环页面', markdown: 'ok' },
        });
        assert.equal(write.statusCode, 201, write.body);
      }
      for (const origin of [
        'http://localhost:9999',
        'http://127.0.0.1.evil.test:3000',
        'https://evil.test',
      ]) {
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/auth/sign-in/email',
              headers: { origin },
              payload: { email: 'none@example.test', password: 'loopback-password-123' },
            })
          ).statusCode,
          403,
        );
      }
    } finally {
      await app.close();
      store.close();
    }
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
test('native fetch provider exchange completes real HTTP tool loop and cancellation aborts a waiting provider', async () => {
  const provider = Fastify();
  let requests = 0;
  let receivedKey = false;
  let promptSecret = false;
  let slowStarted!: () => void;
  const started = new Promise<void>((r) => {
    slowStarted = r;
  });
  provider.post('/v1/chat/completions', async (request, reply) => {
    requests++;
    receivedKey = request.headers.authorization === 'Bearer network-test-key';
    const body = request.body as { model: string; messages: { role: string; content: string }[] };
    promptSecret ||= JSON.stringify(body).includes('network-test-key');
    if (body.model === 'slow') {
      slowStarted();
      return reply.hijack();
    }
    const count = body.messages.filter((m) => m.role === 'assistant').length;
    const actions = [
      { tool: 'read_file', path: '/sdk/README.md' },
      {
        tool: 'write_file',
        path: '/project/component.json',
        content: JSON.stringify({ name: '网络产物', description: '', template: '# 网络验证' }),
      },
      { tool: 'validate_component' },
      { tool: 'finish' },
    ];
    return { choices: [{ message: { content: JSON.stringify(actions[count]) } }] };
  });
  await provider.listen({ host: '127.0.0.1', port: 0 });
  const address = provider.server.address();
  assert.ok(address && typeof address !== 'string');
  const store = new Store(':memory:');
  const app = createApp({
    store,
    mode: 'session',
    workshop: {
      masterSecret: 'network-test-master-secret-at-least-32',
      allowedEndpoints: { local: `http://127.0.0.1:${address.port}/v1` },
    },
  });
  try {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:3000' },
      payload: { name: 'Network', email: 'network@example.test', password: 'network-password-123' },
    });
    assert.equal(signup.statusCode, 200, signup.body);
    const set = signup.headers['set-cookie']!;
    const cookie = (Array.isArray(set) ? set : [set]).map((s) => s.split(';')[0]).join('; ');
    const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
    const headers = { cookie, 'x-csrf-token': me.csrfToken };
    const save = async (model: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/workshop/providers',
          headers,
          payload: { label: model, endpointId: 'local', model, apiKey: 'network-test-key' },
        })
      ).json();
    const profile = await save('normal');
    const project = (
      await app.inject({
        method: 'POST',
        url: '/api/workshop/projects',
        headers,
        payload: { name: 'native fetch', instruction: '构建读书卡' },
      })
    ).json();
    const run = await app.inject({
      method: 'POST',
      url: `/api/workshop/projects/${project.id}/run`,
      headers,
      payload: { providerId: profile.id },
    });
    assert.equal(run.statusCode, 200, run.body);
    assert.equal(run.json().state, 'ready');
    assert.equal(requests, 4);
    assert.equal(receivedKey, true);
    assert.equal(promptSecret, false);
    const slow = await save('slow');
    const pending = app.inject({
      method: 'POST',
      url: `/api/workshop/projects/${project.id}/run`,
      headers,
      payload: { providerId: slow.id },
    });
    await started;
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/workshop/projects/${project.id}/cancel`,
          headers,
        })
      ).statusCode,
      200,
    );
    const aborted = await pending;
    assert.equal(aborted.statusCode, 409);
    assert.match(aborted.body, /取消/);
  } finally {
    await app.close();
    store.close();
    provider.server.closeAllConnections();
    await provider.close();
  }
});

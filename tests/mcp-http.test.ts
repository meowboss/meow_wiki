import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
test('stateless MCP HTTP authenticates each request with domain token and revocation is immediate', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store, mode: 'session' });
  try {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:3000' },
      payload: { email: 'mcp@example.test', name: 'MCP', password: 'mcp-password-123' },
    });
    const set = signup.headers['set-cookie']!;
    const cookie = (Array.isArray(set) ? set : [set]).map((s) => s.split(';')[0]).join('; ');
    const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
    const headers = { cookie, 'x-csrf-token': me.csrfToken };
    const domain = (
      await app.inject({ method: 'POST', url: '/api/domains', headers, payload: { name: 'MCP域' } })
    ).json();
    const issued = await app.inject({
      method: 'POST',
      url: '/api/mcp/credentials',
      headers,
      payload: { domainId: domain.id, label: 'agent', expiresInDays: 7 },
    });
    assert.equal(issued.statusCode, 201, issued.body);
    const { token, record } = issued.json();
    const rpc = (body: unknown, bearer = token) =>
      app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          authorization: `Bearer ${bearer}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: JSON.stringify(body),
      });
    assert.equal((await app.inject({ method: 'POST', url: '/mcp', payload: {} })).statusCode, 401);
    const initialize = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    });
    assert.equal(initialize.statusCode, 200, initialize.body);
    assert.ok(initialize.json().result.serverInfo);
    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().result.tools.length, 4);
    assert.equal((await rpc([{ jsonrpc: '2.0', id: 5, method: 'tools/list' }])).statusCode, 400);
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/mcp/credentials/${record.id}`,
      headers,
    });
    assert.equal(revoke.statusCode, 200);
    assert.equal((await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).statusCode, 401);
  } finally {
    await app.close();
    store.close();
  }
});

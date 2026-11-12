import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  ProviderNetwork,
  normalizeProviderEndpoint,
  isAllowedLiteralAddress,
} from '../src/modules/workshop/provider-network.ts';
test('explicit local HTTP IP supports real model discovery and inference without a proxy', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    assert.equal(req.headers.authorization, 'Bearer local-test-key');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/v1/models'
          ? { data: [{ id: 'local-chat' }] }
          : { choices: [{ message: { content: 'OK' } }] },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const url = `http://127.0.0.1:${addr.port}/v1`;
    const network = new ProviderNetwork();
    assert.deepEqual(await network.request(url, 'local-test-key', 'models'), {
      data: [{ id: 'local-chat' }],
    });
    await network.request(url, 'local-test-key', 'chat/completions', {
      model: 'local-chat',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(calls, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
test('private literal addresses allowed while metadata special targets and HTTP domains stay denied', () => {
  for (const ip of ['127.0.0.1', '192.168.1.5', '10.2.3.4', '172.16.0.2', '::1', 'fd12::1'])
    assert.ok(isAllowedLiteralAddress(ip), ip);
  for (const ip of [
    '169.254.169.254',
    '0.0.0.0',
    '100.100.100.200',
    '224.0.0.1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(isAllowedLiteralAddress(ip), false, ip);
  assert.equal(normalizeProviderEndpoint('http://[::1]:8000/v1'), 'http://[::1]:8000/v1');
  assert.throws(() => normalizeProviderEndpoint('http://localhost:8000'));
  assert.throws(() => normalizeProviderEndpoint('http://169.254.169.254/v1'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { LookupFunction } from 'node:net';
import type { Agent, Dispatcher } from 'undici';
import {
  createSafeProviderFetch,
  isPublicAddress,
  normalizeProviderEndpoint,
  ProviderNetwork,
  type ProviderAddress,
} from '../src/modules/workshop/provider-network.ts';

test('normalize accepts public HTTPS syntax and removes trailing slashes', () => {
  assert.equal(
    normalizeProviderEndpoint('https://API.Example.com:443/v1///'),
    'https://api.example.com/v1',
  );
  assert.equal(normalizeProviderEndpoint('https://example.com'), 'https://example.com');
  assert.equal(
    normalizeProviderEndpoint('https://example.com:8443/api'),
    'https://example.com:8443/api',
  );
});

test('normalize rejects credentials, query/hash including empty delimiters, and non-HTTPS', () => {
  for (const endpoint of [
    'http://example.com',
    'ftp://example.com',
    '//example.com',
    'https://user:secret@example.com',
    'https://@example.com',
    'https://example.com?',
    'https://example.com#',
    'https://example.com?q=x',
    ' https://example.com',
    'https://example.com ',
    'https://example.com\\evil',
    'https://exa\nmple.com',
    '',
  ])
    assert.throws(
      () => normalizeProviderEndpoint(endpoint),
      { message: 'Invalid provider endpoint' },
      endpoint,
    );
});

test('strict IP matrix denies private, special-use, mapped and noncanonical syntax', () => {
  for (const address of [
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.1.2.3',
    '255.255.255.255',
    '127.1',
    '2130706433',
    '0177.0.0.1',
    '0x7f000001',
    '::',
    '::1',
    'fc00::1',
    'fdff::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    'fec0::1',
    '::ffff:8.8.8.8',
    '::ffff:127.0.0.1',
    '::ffff:808:808',
    '::8.8.8.8',
    '64:ff9b::808:808',
    '100::1',
    '2001:db8::1',
    '2001::1',
    '2001:20::1',
    '2002:808:808::1',
    '3fff::1',
    '4000::1',
    '[2606:4700:4700::1111]',
    'not-ip',
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of [
    '8.8.8.8',
    '1.1.1.1',
    '172.15.255.255',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])
    assert.equal(isPublicAddress(address), true, address);
});

function fixture(
  fetcher: typeof fetch,
  addresses: ProviderAddress[] = [{ address: '8.8.8.8', family: 4 }],
) {
  let lookups = 0;
  let destroyed = 0;
  let agentOptions: Agent.Options | undefined;
  const dispatcher = {
    destroy: async () => {
      destroyed++;
    },
  } as unknown as Dispatcher;
  const options = {
    resolver: async () => {
      lookups++;
      return addresses;
    },
    fetcher,
    agentFactory: (value: Agent.Options) => {
      agentOptions = value;
      return dispatcher;
    },
  };
  return {
    options,
    dispatcher,
    get lookups() {
      return lookups;
    },
    get destroyed() {
      return destroyed;
    },
    get lookup() {
      return (agentOptions?.connect as { lookup: LookupFunction }).lookup;
    },
  };
}

const okay: typeof fetch = async () => new Response('{"data":[]}');

test('validates every DNS answer before sending credentials', async () => {
  let sent = 0;
  for (const answers of [
    [],
    [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ],
    [{ address: '::ffff:8.8.8.8', family: 6 }],
    [{ address: '8.8.8.8', family: 6 }],
  ]) {
    const setup = fixture(async () => {
      sent++;
      return okay('');
    }, answers);
    await assert.rejects(
      new ProviderNetwork(setup.options).request(
        'https://provider.example/v1',
        'not-a-real-key',
        'models',
      ),
      { message: 'Provider network request failed' },
    );
  }
  assert.equal(sent, 0);
});

test('pins validated DNS answers in Agent lookup without changing URL/TLS hostname', async () => {
  const answers = [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ];
  const setup = fixture(async (input, init) => {
    assert.equal(input, 'https://provider.example/v1/models');
    assert.equal(init?.redirect, 'error');
    assert.equal((init as RequestInit & { dispatcher: Dispatcher }).dispatcher, setup.dispatcher);
    answers[0].address = '127.0.0.1'; // Simulate a changed DNS answer after validation.
    const one = await new Promise((resolve, reject) =>
      setup.lookup('provider.example', { family: 4 }, (error, address) =>
        error ? reject(error) : resolve(address),
      ),
    );
    assert.equal(one, '8.8.8.8');
    const all = await new Promise((resolve, reject) =>
      setup.lookup('provider.example', { all: true }, ((
        error: Error | null,
        entries: ProviderAddress[],
      ) => (error ? reject(error) : resolve(entries))) as never),
    );
    assert.deepEqual(all, [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    return new Response('{"data":[{"id":"model"}]}');
  }, answers);
  const result = await new ProviderNetwork(setup.options).request(
    'https://provider.example/v1',
    'not-a-real-key',
    'models',
  );
  assert.deepEqual(result, { data: [{ id: 'model' }] });
  assert.equal(setup.lookups, 1);
  assert.equal(setup.destroyed, 1);
});

test('safe fetch is fetch-compatible and resolves afresh for each request', async () => {
  const setup = fixture(okay);
  const fetcher: typeof fetch = createSafeProviderFetch(setup.options);
  assert.deepEqual(
    await (await fetcher(new Request('https://provider.example/v1/models'))).json(),
    { data: [] },
  );
  await fetcher('https://provider.example/v1/chat/completions', { method: 'POST', body: '{}' });
  assert.equal(setup.lookups, 2);
  assert.equal(setup.destroyed, 2);
});

test('mapped and noncanonical IP URLs never invoke DNS or fetch', async () => {
  const setup = fixture(async () => {
    assert.fail('must not send');
  });
  for (const endpoint of [
    'https://127.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://[::ffff:8.8.8.8]',
  ])
    await assert.rejects(createSafeProviderFetch(setup.options)(endpoint), {
      message: 'Provider network request failed',
    });
  assert.equal(setup.lookups, 0);
});

test('fixed sanitized failures cover redirects, upstream errors, bad/oversized JSON and secrets', async () => {
  for (const fetcher of [
    async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1' } }),
    async () => new Response('not-a-real-key upstream error', { status: 500 }),
    async () => {
      throw new Error('not-a-real-key internal DNS details');
    },
    async () => new Response('invalid json'),
    async () => new Response(JSON.stringify({ secret: 'not-a-real-key' })),
    async () => new Response('x'.repeat(256 * 1024 + 1)),
    async () => new Response('{}', { headers: { 'content-length': String(256 * 1024 + 1) } }),
  ] as (typeof fetch)[]) {
    const setup = fixture(fetcher);
    await assert.rejects(
      new ProviderNetwork(setup.options).request(
        'https://provider.example',
        'not-a-real-key',
        'models',
      ),
      { message: 'Provider network request failed' },
    );
    assert.equal(setup.destroyed, 1);
  }
});

test('abort covers DNS and body reads without exposing raw errors', async () => {
  const controller = new AbortController();
  const fetcher = createSafeProviderFetch({
    resolver: async () => {
      controller.abort();
      return new Promise(() => {});
    },
    fetcher: okay,
  });
  await assert.rejects(fetcher('https://provider.example/models', { signal: controller.signal }), {
    message: 'Provider network request failed',
  });
  const bodyController = new AbortController();
  const setup = fixture(
    async () =>
      new Response(
        new ReadableStream({
          start() {
            bodyController.abort();
          },
        }),
      ),
  );
  await assert.rejects(
    createSafeProviderFetch(setup.options)('https://provider.example/models', {
      signal: bodyController.signal,
    }),
    { message: 'Provider network request failed' },
  );
  assert.equal(setup.destroyed, 1);
});

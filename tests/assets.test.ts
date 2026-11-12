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
import { registerAssets } from '../src/modules/assets/routes.ts';
import { AssetError, AssetService, MAX_ASSET_BYTES } from '../src/modules/assets/service.ts';

const png = Buffer.from('89504e470d0a1a0a0000000001020304', 'hex');
const upload = (data: Buffer = png, mime = 'image/png', name = 'photo.png') => ({
  name,
  mime,
  base64: data.toString('base64'),
});
const status = (code: number) => (error: unknown) =>
  error instanceof AssetError && error.statusCode === code;

function fixture() {
  const store = new Store(':memory:');
  const service = new AssetService(store.db, (owner, workspace) => {
    store.get(owner, workspace);
  });
  return { store, service, workspace: store.ensure('alice') };
}

test('assets: strict media input, canonical base64, all six magic signatures and private BLOB storage', () => {
  const { store, service, workspace } = fixture();
  try {
    const samples: [string, Buffer][] = [
      ['image/png', png],
      ['image/jpeg', Buffer.from('ffd8ffe000102030', 'hex')],
      ['image/gif', Buffer.from('GIF89a123456')],
      ['image/webp', Buffer.from('524946460400000057454250', 'hex')],
      ['video/mp4', Buffer.from('000000186674797069736f6d000000006d70343269736f6d', 'hex')],
      ['video/webm', Buffer.from('1a45dfa3874282847765626d00', 'hex')],
    ];
    for (const [mime, data] of samples) {
      const metadata = service.create('alice', workspace, upload(data, mime));
      assert.deepEqual(Object.keys(metadata).sort(), ['bytes', 'id', 'mime', 'name']);
      assert.deepEqual(service.get('alice', workspace, metadata.id).data, data);
      assert.equal(
        store.db.prepare('SELECT typeof(data) AS kind FROM mw_assets WHERE id = ?').get(metadata.id)
          ?.kind,
        'blob',
      );
    }
    const invalid = [
      { name: '' },
      { name: ' ' },
      { name: 'a'.repeat(121) },
      { mime: 'image/svg+xml' },
      { mime: 'text/html' },
      { mime: 'image/PNG' },
      { extra: true },
      { data: png.toString('base64') },
      { base64: '' },
      { base64: 'Zg' },
      { base64: 'Zh==' },
      { base64: 'Zg==\n' },
      { base64: 'data:image/png;base64,' + png.toString('base64') },
      { base64: '-___' },
    ];
    for (const patch of invalid)
      assert.throws(
        () => service.create('alice', workspace, { ...upload(), ...patch }),
        status(400),
      );
    for (const mime of samples.map(([mime]) => mime)) {
      for (const data of [
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        Buffer.from('<!doctype html><script>alert(1)</script>'),
      ])
        assert.throws(() => service.create('alice', workspace, upload(data, mime)), status(400));
    }
    assert.throws(() => service.create('alice', workspace, upload(png, 'image/jpeg')), status(400));
    const highBitGif = Buffer.from('GIF89a123456');
    highBitGif[0] |= 0x80;
    assert.throws(
      () => service.create('alice', workspace, upload(highBitGif, 'image/gif')),
      status(400),
    );
    assert.throws(
      () =>
        service.create(
          'alice',
          workspace,
          upload(Buffer.from('1a45dfa3874282846e6f706500', 'hex'), 'video/webm'),
        ),
      status(400),
    );
    assert.throws(
      () =>
        service.create(
          'alice',
          workspace,
          upload(
            Buffer.from('000000186674797061766966000000006176696661766966', 'hex'),
            'video/mp4',
          ),
        ),
      status(400),
    );
    assert.equal(service.list('alice', workspace).length, 6);
    assert.throws(
      () =>
        service.get(
          'alice',
          store.create('alice', 'other'),
          service.list('alice', workspace)[0].id,
        ),
      { statusCode: 404 },
    );
  } finally {
    store.close();
  }
});

test('assets: per-user count and byte quotas span workspaces, retain atomicity and compose with transactions', () => {
  const { store, service, workspace } = fixture();
  try {
    const other = store.create('alice', 'second');
    for (let i = 0; i < 20; i++) service.create('alice', i % 2 ? workspace : other, upload());
    assert.throws(() => service.create('alice', other, upload()), status(409));
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM mw_assets').get()?.count, 20);
    service.create('bob', store.ensure('bob'), upload());
    assert.equal(service.list('bob', store.ensure('bob')).length, 1);
    const carol = store.ensure('carol');
    const large = Buffer.alloc(MAX_ASSET_BYTES);
    png.copy(large);
    const payload = upload(large);
    for (let i = 0; i < 4; i++) service.create('carol', carol, payload);
    assert.throws(() => service.create('carol', carol, upload()), status(409));
    assert.throws(
      () => service.create('carol', carol, upload(Buffer.concat([large, Buffer.from([0])]))),
      status(400),
    );
    assert.equal(service.list('carol', carol).length, 4);
    const dave = store.ensure('dave');
    store.db.exec('BEGIN');
    service.create('dave', dave, upload());
    store.db.exec('ROLLBACK');
    assert.equal(service.list('dave', dave).length, 0);
    store.db.exec(
      "CREATE TRIGGER asset_fail BEFORE INSERT ON mw_assets WHEN NEW.owner = 'dave' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    assert.throws(() => service.create('dave', dave, upload()), /test failure/);
    store.db.exec('DROP TRIGGER asset_fail');
    service.create('dave', dave, upload());
    assert.equal(service.list('dave', dave).length, 1);
  } finally {
    store.close();
  }
});

test('assets HTTP: real session cookies/CSRF, foreign 404, metadata, exact MIME and single/suffix ranges', async () => {
  const store = new Store(':memory:');
  const app = Fastify({ bodyLimit: 1024 });
  const kernel = createKernel();
  const identity = new Identity(store.db, {
    authSecret: 'assets-test-ephemeral-secret-at-least-thirty-two-characters',
  });
  const context = createHttpContext({
    store,
    components: new ComponentService(store.db),
    kernel,
    mode: 'session',
    owner: 'unused',
    identity,
    sessions: new WeakMap<FastifyRequest, IdentitySession>(),
  });
  app.addHook('onReady', async () => {
    await identity.ready();
  });
  registerSecurity(app, context);
  registerIdentityRoutes(app, context);
  registerAssets(app, context);
  const origin = 'http://localhost:3000';
  async function signup(name: string) {
    const result = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin },
      payload: { name, email: `${name}@example.test`, password: 'long-password-123' },
    });
    assert.equal(result.statusCode, 200, result.body);
    const values = result.headers['set-cookie'];
    assert.ok(values);
    const cookie = (Array.isArray(values) ? values : [values])
      .map((value) => value.split(';')[0])
      .join('; ');
    const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
    return { cookie, origin, 'x-csrf-token': me.csrfToken };
  }
  try {
    assert.equal((await app.inject({ url: '/api/assets' })).statusCode, 401);
    const alice = await signup('assetalice');
    const bob = await signup('assetbob');
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/assets',
          headers: { cookie: alice.cookie },
          payload: upload(),
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/assets',
          headers: { ...bob, 'x-csrf-token': alice['x-csrf-token'] },
          payload: upload(),
        })
      ).statusCode,
      403,
    );
    const created = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: alice,
      payload: upload(),
    });
    assert.equal(created.statusCode, 201, created.body);
    const metadata = created.json();
    assert.deepEqual(Object.keys(metadata).sort(), ['bytes', 'id', 'mime', 'name']);
    assert.deepEqual((await app.inject({ url: '/api/assets', headers: alice })).json(), {
      assets: [metadata],
    });
    const url = `/api/assets/${metadata.id}/content`;
    const full = await app.inject({ url, headers: alice });
    assert.equal(full.statusCode, 200);
    assert.deepEqual(full.rawPayload, png);
    assert.equal(full.headers['content-type'], 'image/png');
    assert.equal(full.headers['x-content-type-options'], 'nosniff');
    assert.equal(full.headers['accept-ranges'], 'bytes');
    assert.equal(full.headers['cache-control'], 'private, no-store');
    assert.equal((await app.inject({ url, headers: bob })).statusCode, 404);
    const aliceId = (await app.inject({ url: '/api/auth/me', headers: alice })).json().user.id;
    const workspace = store.ensure(aliceId);
    assert.equal(
      (await app.inject({ url: `/api/assets?workspaceId=${workspace}`, headers: bob })).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/assets?workspaceId=${workspace}`,
          headers: bob,
          payload: upload(),
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          url: `${url}?workspaceId=${store.create(aliceId, 'other')}`,
          headers: alice,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ url: `${url}?workspaceId=${workspace}`, headers: bob })).statusCode,
      404,
    );
    for (const [range, start, end] of [
      ['bytes=0-3', 0, 3],
      ['bytes=4-', 4, 15],
      ['bytes=-4', 12, 15],
      ['bytes=0-999', 0, 15],
      ['bytes=-999', 0, 15],
    ] as const) {
      const response = await app.inject({ url, headers: { ...alice, range } });
      assert.equal(response.statusCode, 206, range);
      assert.equal(response.headers['content-range'], `bytes ${start}-${end}/${png.length}`);
      assert.equal(response.headers['content-length'], String(end - start + 1));
      assert.deepEqual(response.rawPayload, png.subarray(start, end + 1));
    }
    for (const range of [
      'bytes=999-',
      'bytes=4-2',
      'bytes=-0',
      'bytes=-',
      'bytes=0-1,4-5',
      'items=0-1',
      'bytes=9007199254740992-',
      'bytes=1.5-3',
    ]) {
      const response = await app.inject({ url, headers: { ...alice, range } });
      assert.equal(response.statusCode, 416, range);
      assert.equal(response.headers['content-range'], `bytes */${png.length}`);
    }
    const large = Buffer.alloc(2 * 1024 * 1024);
    png.copy(large);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/assets',
          headers: alice,
          payload: upload(large),
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/assets',
          headers: alice,
          payload: { ...upload(), extra: 'x'.repeat(12 * 1024 * 1024) },
        })
      ).statusCode,
      413,
    );
    assert.equal(
      (await app.inject({ method: 'DELETE', url: `/api/assets/${metadata.id}`, headers: alice }))
        .statusCode,
      200,
    );
  } finally {
    await app.close();
    kernel.dispose();
    store.close();
  }
});

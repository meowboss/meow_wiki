import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  compositionDocumentSchema,
  compositionSchema,
  compositionUpdateSchema,
  createDefaultComposition,
  type CanvasSurface,
  type Composition,
} from '../packages/canvas-contract/index.ts';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { Identity, type IdentitySession } from '../src/identity.ts';
import { createKernel } from '../src/plugins/official.ts';
import { createHttpContext } from '../src/http/context.ts';
import { registerSecurity } from '../src/http/security.ts';
import { registerIdentityRoutes } from '../src/http/identity-routes.ts';
import { registerCompositions } from '../src/modules/compositions/routes.ts';
import { CompositionError, CompositionService } from '../src/modules/compositions/service.ts';

function document(value: Composition) {
  const { revision: _, ...result } = value;
  return result;
}
const status = (code: number) => (error: unknown) =>
  error instanceof CompositionError && error.statusCode === code;

test('canvas contract is strict, bounded and deterministic for every layout', () => {
  for (const surface of ['home', 'wiki', 'collaboration'] as const) {
    const value = createDefaultComposition(surface);
    assert.equal(value.revision, 0);
    assert.deepEqual(compositionSchema.parse(value), value);
    assert.deepEqual(createDefaultComposition(surface), value);
    value.instances[0].config.text = 'mutated';
    assert.equal(createDefaultComposition(surface).instances[0].config.text, undefined);
  }
  const base = document(createDefaultComposition('wiki'));
  assert.deepEqual(
    base.instances.map(({ id, x, w }) => ({ id, x, w })),
    [
      { id: 'wiki-directory', x: 0, w: 4 },
      { id: 'wiki-document', x: 4, w: 8 },
    ],
  );
  for (const layout of ['grid', 'flow', 'free'] as const) {
    assert.ok(compositionDocumentSchema.safeParse({ ...base, layout }).success);
    assert.ok(
      !compositionDocumentSchema.safeParse({
        ...base,
        layout,
        instances: [{ ...base.instances[0], x: 11, w: 2 }],
      }).success,
    );
  }
  for (const patch of [
    { revision: 0 },
    { unknown: true },
    { schemaVersion: 1 },
    { surface: 'other' },
    { layout: 'absolute' },
    { columns: 0 },
    { columns: 13 },
    { columns: 1.5 },
    { gap: 49 },
    { gap: -1 },
    { background: 'red' },
    { background: 'url(https://x)' },
    { background: '#fffff' },
    { instances: Array(41).fill(base.instances[0]) },
    { instances: [base.instances[0], base.instances[0]] },
  ])
    assert.equal(compositionDocumentSchema.safeParse({ ...base, ...patch }).success, false);
  for (const patch of [
    { id: '' },
    { id: 'a'.repeat(65) },
    { id: '../unsafe' },
    { viewId: 'plugin.script' },
    { visible: 1 },
    { x: -1 },
    { x: 12 },
    { x: 0.5 },
    { y: 101 },
    { y: -1 },
    { w: 0 },
    { h: 25 },
    { h: 0 },
    { config: { text: 'a'.repeat(5001) } },
    { config: { html: '<script>' } },
    { style: { color: 'red' } },
    { style: { padding: 49 } },
    { style: { padding: 0.5 } },
    { style: { borderRadius: 41 } },
    { style: { position: 'fixed' } },
    { extra: true },
  ])
    assert.equal(
      compositionDocumentSchema.safeParse({
        ...base,
        instances: [{ ...base.instances[0], ...patch }],
      }).success,
      false,
    );
  const valid = {
    ...base,
    instances: [
      {
        ...base.instances[0],
        id: '01234567-89ab-4cde-8fab-0123456789ab',
        y: 100,
        h: 24,
        config: { text: 'a'.repeat(5000) },
        style: { background: '#abcd', color: '#001122ff', padding: 48, borderRadius: 40 },
      },
    ],
  };
  assert.ok(compositionDocumentSchema.safeParse(valid).success);
  assert.ok(!compositionUpdateSchema.safeParse({ composition: base }).success);
  assert.ok(
    !compositionUpdateSchema.safeParse({ expectedRevision: -1, composition: base }).success,
  );
  assert.ok(
    !compositionUpdateSchema.safeParse({ expectedRevision: 0, composition: base, reset: true })
      .success,
  );
});

test('composition service CAS, isolation, snapshot preservation, reset and persistence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meow-compositions-'));
  const path = join(directory, 'content.sqlite');
  let store = new Store(path);
  const workspace = store.ensure('alice');
  const other = store.ensure('bob');
  const service = () =>
    new CompositionService(store.db, (owner, id) => {
      store.get(owner, id);
    });
  try {
    // C0 adapts home.content at render time; existing layout rows remain untouched.
    new ComponentService(store.db);
    const legacy = JSON.stringify({ widgets: ['legacy-home'], custom: 'retained' });
    store.db
      .prepare('INSERT INTO mw_layouts (workspace_id, json, revision) VALUES (?, ?, 7)')
      .run(workspace, legacy);
    let compositions = service();
    const snapshot = store.get('alice', workspace);
    const histories = snapshot.pages.map((page) => store.history('alice', workspace, page.id));
    const changesBefore = store.db.prepare('SELECT total_changes() AS n').get()!.n;
    for (const surface of ['home', 'wiki', 'collaboration'] as CanvasSurface[]) {
      assert.deepEqual(
        compositions.get('alice', workspace, surface),
        createDefaultComposition(surface),
      );
    }
    assert.equal(store.db.prepare('SELECT total_changes() AS n').get()!.n, changesBefore);
    const base = document(createDefaultComposition('home'));
    const input = { expectedRevision: 0, composition: { ...base, layout: 'flow', gap: 24 } };
    const saved = compositions.update('alice', workspace, 'home', input);
    assert.equal(saved.revision, 1);
    assert.throws(() => compositions.update('alice', workspace, 'home', input), status(409));
    assert.throws(
      () =>
        compositions.update('alice', workspace, 'wiki', {
          ...input,
          expectedRevision: 1,
          composition: document(createDefaultComposition('wiki')),
        }),
      status(409),
    );
    assert.throws(() => compositions.update('alice', workspace, 'wiki', input), status(400));
    assert.throws(() => compositions.get('bob', workspace, 'home'), { statusCode: 404 });
    assert.throws(() => compositions.update('bob', workspace, 'home', input), { statusCode: 404 });
    assert.deepEqual(compositions.get('bob', other, 'home'), createDefaultComposition('home'));
    assert.deepEqual(store.get('alice', workspace), snapshot);
    snapshot.pages.forEach((page, i) =>
      assert.deepEqual(store.history('alice', workspace, page.id), histories[i]),
    );
    store.close();
    store = new Store(path);
    compositions = service();
    assert.deepEqual(compositions.get('alice', workspace, 'home'), saved);
    const reset = compositions.update('alice', workspace, 'home', {
      expectedRevision: 1,
      composition: base,
    });
    assert.deepEqual(reset, { ...createDefaultComposition('home'), revision: 2 });
    // Nested transaction rollback must include composition writes.
    store.db.exec('BEGIN');
    compositions.update('alice', workspace, 'home', { expectedRevision: 2, composition: base });
    store.db.exec('ROLLBACK');
    assert.equal(compositions.get('alice', workspace, 'home').revision, 2);
    const huge = {
      ...base,
      instances: Array.from({ length: 40 }, (_, i) => ({
        ...base.instances[0],
        id: `text-${i}`,
        viewId: 'builtin.text' as const,
        config: { text: '😀'.repeat(2500) },
      })),
    };
    assert.equal(
      compositions.update('alice', workspace, 'wiki', {
        expectedRevision: 0,
        composition: { ...huge, surface: 'wiki' },
      }).instances.length,
      40,
    );
    assert.throws(
      () =>
        compositions.update('alice', workspace, 'home', {
          expectedRevision: 2,
          composition: {
            ...huge,
            instances: [...huge.instances, { ...huge.instances[0], id: 'extra' }],
          },
        }),
      status(400),
    );
    assert.equal(compositions.get('alice', workspace, 'home').revision, 2);
    const legacyRow = store.db
      .prepare('SELECT json, revision FROM mw_layouts WHERE workspace_id = ?')
      .get(workspace)!;
    assert.equal(legacyRow.json, legacy);
    assert.equal(legacyRow.revision, 7);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const store = new Store(':memory:');
  const app = Fastify();
  const secret = 'compositions-secret-longer-than-thirty-two-characters';
  const identity = new Identity(store.db, { authSecret: secret });
  const kernel = createKernel();
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
  registerSecurity(app, context, secret);
  registerIdentityRoutes(app, context);
  registerCompositions(app, context);
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
async function signup(f: ReturnType<typeof fixture>, name: string) {
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: 'http://localhost:3000' },
    payload: { name, email: `${name}@example.test`, password: 'password-long-1234' },
  });
  assert.equal(response.statusCode, 200, response.body);
  const values = response.headers['set-cookie']!;
  const cookie = (Array.isArray(values) ? values : [values]).map((v) => v.split(';')[0]).join('; ');
  const me = await f.app.inject({ url: '/api/auth/me', headers: { cookie } });
  return {
    id: response.json().user.id as string,
    cookie,
    headers: {
      cookie,
      origin: 'http://localhost:3000',
      'x-csrf-token': me.json().csrfToken as string,
    },
  };
}

test('composition HTTP requires auth/CSRF, validates input and enforces owner-scoped CAS', async () => {
  const f = fixture();
  try {
    const alice = await signup(f, 'alice');
    const bob = await signup(f, 'bob');
    const workspace = f.store.ensure(alice.id);
    const url = `/api/compositions/home?workspaceId=${workspace}`;
    assert.equal((await f.app.inject({ url })).statusCode, 401);
    const initial = await f.app.inject({ url, headers: alice.headers });
    assert.equal(initial.statusCode, 200, initial.body);
    assert.deepEqual(initial.json(), createDefaultComposition('home'));
    const payload = { expectedRevision: 0, composition: document(initial.json()) };
    assert.equal(
      (await f.app.inject({ method: 'PUT', url, payload, headers: { cookie: alice.cookie } }))
        .statusCode,
      403,
    );
    for (const method of ['GET', 'PUT'] as const) {
      const response = await f.app.inject({
        method,
        url,
        headers: bob.headers,
        ...(method === 'PUT' ? { payload } : {}),
      });
      assert.equal(response.statusCode, 404, response.body);
    }
    for (const invalid of [
      undefined,
      {},
      { composition: payload.composition },
      { ...payload, expectedRevision: -1 },
      { ...payload, unknown: true },
      { ...payload, composition: { ...payload.composition, revision: 0 } },
      { ...payload, composition: { ...payload.composition, surface: 'wiki' } },
    ]) {
      const response = await f.app.inject({
        method: 'PUT',
        url,
        headers: alice.headers,
        payload: invalid,
      });
      assert.equal(response.statusCode, 400, response.body);
    }
    assert.equal(
      (await f.app.inject({ url: '/api/compositions/other', headers: alice.headers })).statusCode,
      400,
    );
    const responses = await Promise.all(
      [0, 1].map(() => f.app.inject({ method: 'PUT', url, payload, headers: alice.headers })),
    );
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409]);
    assert.equal((await f.app.inject({ url, headers: alice.headers })).json().revision, 1);
    const reset = await f.app.inject({
      method: 'PUT',
      url,
      headers: alice.headers,
      payload: { ...payload, expectedRevision: 1 },
    });
    assert.deepEqual(reset.json(), { ...createDefaultComposition('home'), revision: 2 });
  } finally {
    await f.close();
  }
});

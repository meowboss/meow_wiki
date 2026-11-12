import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { CompositionError, CompositionService } from '../src/modules/compositions/service.ts';
import { createDefaultComposition, type Composition } from '../packages/canvas-contract/index.ts';
import { createHttpContext } from '../src/http/context.ts';
import { registerCompositions } from '../src/modules/compositions/routes.ts';
import { registerSecurity } from '../src/http/security.ts';
import { registerIdentityRoutes } from '../src/http/identity-routes.ts';
import { Identity, type IdentitySession } from '../src/identity.ts';
import { createKernel } from '../src/plugins/official.ts';

const definition = { name: 'Card', description: '', template: '# Original' };
const status = (code: number) => (error: unknown) =>
  error instanceof CompositionError && error.statusCode === code;
const document = ({ revision: _, ...value }: Composition) => value;
function fixture() {
  const store = new Store(':memory:');
  const workspace = store.ensure('alice');
  const foreign = store.ensure('bob');
  const components = new ComponentService(store.db);
  const service = new CompositionService(store.db, (owner, id) => {
    store.get(owner, id);
  });
  const draft = components.create('alice', workspace, definition);
  const source = components.create('bob', foreign, definition);
  const release = components.submit('bob', foreign, source.id);
  components.review('admin', release.id, 'published', '');
  components.install(workspace, release.id);
  const layout = {
    title: '旧首页标题',
    blocks: [{ componentId: draft.id }, { releaseId: release.id }, { componentId: draft.id }],
  };
  components.saveLayout('alice', workspace, layout);
  components.saveLayout('alice', workspace, layout, 1);
  const legacy = () =>
    store.db.prepare('SELECT json, revision FROM mw_layouts WHERE workspace_id=?').get(workspace)!;
  const marker = () =>
    store.db
      .prepare('SELECT * FROM mw_composition_migrations WHERE owner=? AND workspace=?')
      .get('alice', workspace);
  return {
    store,
    workspace,
    foreign,
    components,
    service,
    draft,
    source,
    release,
    layout,
    legacy,
    marker,
  };
}

test('explicit migration reads actual legacy home JSON and preserves order, title, references and immutable release', () => {
  const f = fixture();
  try {
    const before = f.legacy();
    const snapshot = f.store.get('alice', f.workspace);
    const home = f.components.home('alice', f.workspace);
    assert.deepEqual(JSON.parse(String(before.json)), home.layout);
    assert.equal(home.revision, 2);
    assert.deepEqual(f.service.get('alice', f.workspace, 'home'), createDefaultComposition('home'));
    assert.equal(f.marker(), undefined);
    const saved = f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 0 });
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.instances[0], {
      id: 'legacy-title',
      viewId: 'builtin.text',
      visible: true,
      x: 0,
      y: 0,
      w: 12,
      h: 1,
      config: { text: home.layout!.title },
      style: {},
    });
    assert.deepEqual(
      saved.instances
        .slice(1)
        .map(({ id, viewId, x, y, w, h, config }) => ({ id, viewId, x, y, w, h, config })),
      home.layout!.blocks.map((config, index) => ({
        id: `legacy-${index}`,
        viewId: 'component.render',
        x: (index % 2) * 6,
        y: 1 + Math.floor(index / 2) * 4,
        w: 6,
        h: 4,
        config,
      })),
    );
    assert.equal(
      saved.instances.some((instance) => instance.viewId === 'home.content'),
      false,
    );
    assert.deepEqual(f.legacy(), before);
    assert.deepEqual(f.store.get('alice', f.workspace), snapshot);
    assert.deepEqual(
      { ...f.marker() },
      {
        owner: 'alice',
        workspace: f.workspace,
        source_revision: 2,
        source_digest: createHash('sha256').update(String(before.json)).digest('hex'),
        target_revision: 1,
      },
    );
    f.components.update('bob', f.foreign, f.source.id, { ...definition, template: '# Changed' });
    assert.equal(f.components.installed(f.workspace)[0].release.template, '# Original');
    assert.equal(saved.instances[2].config.releaseId, f.release.id);
    assert.throws(
      () =>
        f.store.db.prepare('UPDATE mw_releases SET content=? WHERE id=?').run('{}', f.release.id),
      /immutable/,
    );
    assert.deepEqual(f.service.get('alice', f.workspace, 'home'), saved);
  } finally {
    f.store.close();
  }
});

test('migration marker makes repeated calls return current composition without overwriting later edits', () => {
  const f = fixture();
  try {
    const first = f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 0 });
    const changes = f.store.db.prepare('SELECT total_changes() AS n').get()!.n;
    assert.deepEqual(f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 0 }), first);
    assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get()!.n, changes);
    const edited = f.service.update('alice', f.workspace, 'home', {
      expectedRevision: 1,
      composition: { ...document(first), background: '#123456' },
    });
    f.components.saveLayout('alice', f.workspace, { title: 'Later legacy change', blocks: [] }, 2);
    assert.deepEqual(
      f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 0 }),
      edited,
    );
    assert.deepEqual(
      f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 999 }),
      edited,
    );
    assert.equal(f.marker()!.target_revision, 1);
    assert.equal(edited.instances.length, 4);
  } finally {
    f.store.close();
  }
});

test('migration is strict, owner scoped, explicit about missing or malformed legacy layout and reference authorization', () => {
  const f = fixture();
  try {
    for (const input of [
      undefined,
      {},
      { expectedRevision: -1 },
      { expectedRevision: 0.5 },
      { expectedRevision: '0' },
      { expectedRevision: 0, extra: true },
    ]) {
      assert.throws(() => f.service.migrateLegacy('alice', f.workspace, input), status(400));
    }
    assert.throws(() => f.service.migrateLegacy('bob', f.workspace, { expectedRevision: 0 }), {
      statusCode: 404,
    });
    assert.throws(
      () => f.service.migrateLegacy('bob', f.foreign, { expectedRevision: 0 }),
      /没有可迁移的旧首页布局/,
    );
    for (const source of [
      'not JSON',
      JSON.stringify({ widgets: [] }),
      JSON.stringify({ title: 'Foreign', blocks: [{ componentId: f.source.id }] }),
      JSON.stringify({ title: 'Uninstalled', blocks: [{ releaseId: f.release.id }] }),
    ]) {
      if (source.includes('Uninstalled'))
        f.store.db.prepare('DELETE FROM mw_installs WHERE workspace_id=?').run(f.workspace);
      f.store.db
        .prepare('UPDATE mw_layouts SET json=? WHERE workspace_id=?')
        .run(source, f.workspace);
      assert.throws(
        () => f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 0 }),
        status(400),
      );
      assert.equal(f.marker(), undefined);
      assert.equal(f.service.get('alice', f.workspace, 'home').revision, 0);
    }
  } finally {
    f.store.close();
  }
});

test('migration CAS rejects stale versions and commits only at the expected target revision', () => {
  const f = fixture();
  try {
    const before = f.legacy();
    assert.throws(
      () => f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 1 }),
      status(409),
    );
    assert.equal(f.marker(), undefined);
    const existing = f.service.update('alice', f.workspace, 'home', {
      expectedRevision: 0,
      composition: document(createDefaultComposition('home')),
    });
    assert.throws(
      () => f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 0 }),
      status(409),
    );
    assert.deepEqual(f.service.get('alice', f.workspace, 'home'), existing);
    assert.equal(f.marker(), undefined);
    assert.equal(
      f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 1 }).revision,
      2,
    );
    assert.equal(f.marker()!.target_revision, 2);
    assert.deepEqual(f.legacy(), before);
  } finally {
    f.store.close();
  }
});

test('marker failure rolls back partial composition write and nested outer rollback includes migration marker', () => {
  const f = fixture();
  try {
    const before = f.legacy();
    f.store.db.exec(`CREATE TRIGGER fail_migration BEFORE INSERT ON mw_composition_migrations
      BEGIN SELECT RAISE(ABORT, 'marker failure'); END;`);
    assert.throws(
      () => f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 0 }),
      /marker failure/,
    );
    assert.equal(f.marker(), undefined);
    assert.deepEqual(f.service.get('alice', f.workspace, 'home'), createDefaultComposition('home'));
    const existing = f.service.update('alice', f.workspace, 'home', {
      expectedRevision: 0,
      composition: document(createDefaultComposition('home')),
    });
    assert.throws(
      () => f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 1 }),
      /marker failure/,
    );
    assert.deepEqual(f.service.get('alice', f.workspace, 'home'), existing);
    assert.equal(f.marker(), undefined);
    assert.deepEqual(f.legacy(), before);
    f.store.db.exec('DROP TRIGGER fail_migration');
    f.store.db.exec('BEGIN');
    assert.equal(
      f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 1 }).revision,
      2,
    );
    f.store.db.exec('ROLLBACK');
    assert.equal(f.marker(), undefined);
    assert.deepEqual(f.service.get('alice', f.workspace, 'home'), existing);
    assert.equal(
      f.service.migrateLegacy('alice', f.workspace, { expectedRevision: 1 }).revision,
      2,
    );
  } finally {
    f.store.close();
  }
});

test('stable migration POST route requires auth and CSRF, strictly validates body, enforces owner and CAS', async () => {
  const store = new Store(':memory:');
  const app = Fastify();
  const secret = 'migration-secret-longer-than-thirty-two-characters';
  const identity = new Identity(store.db, { authSecret: secret });
  const kernel = createKernel();
  const components = new ComponentService(store.db);
  const context = createHttpContext({
    store,
    components,
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
  async function signup(name: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:3000' },
      payload: { name, email: `${name}@example.test`, password: 'password-long-1234' },
    });
    assert.equal(response.statusCode, 200, response.body);
    const values = response.headers['set-cookie']!;
    const cookie = (Array.isArray(values) ? values : [values])
      .map((v) => v.split(';')[0])
      .join('; ');
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
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
  try {
    const alice = await signup('migration-alice');
    const bob = await signup('migration-bob');
    const workspace = store.ensure(alice.id);
    const url = `/api/compositions/home/migrate-legacy?workspaceId=${workspace}`;
    const payload = { expectedRevision: 0 };
    assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 401);
    assert.equal(
      (await app.inject({ method: 'POST', url, payload, headers: { cookie: alice.cookie } }))
        .statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url, payload, headers: bob.headers })).statusCode,
      404,
    );
    const missing = await app.inject({ method: 'POST', url, payload, headers: alice.headers });
    assert.equal(missing.statusCode, 400, missing.body);
    assert.match(missing.json().error, /没有可迁移/);
    components.saveLayout(alice.id, workspace, { title: 'HTTP old home', blocks: [] });
    const get = await app.inject({
      url: `/api/compositions/home?workspaceId=${workspace}`,
      headers: alice.headers,
    });
    assert.equal(get.json().revision, 0);
    for (const invalid of [{}, { expectedRevision: -1 }, { ...payload, unknown: true }])
      assert.equal(
        (await app.inject({ method: 'POST', url, payload: invalid, headers: alice.headers }))
          .statusCode,
        400,
      );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          payload: { expectedRevision: 1 },
          headers: alice.headers,
        })
      ).statusCode,
      409,
    );
    const first = await app.inject({ method: 'POST', url, payload, headers: alice.headers });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().revision, 1);
    assert.equal(first.json().instances[0].config.text, 'HTTP old home');
    const repeat = await app.inject({ method: 'POST', url, payload, headers: alice.headers });
    assert.deepEqual(repeat.json(), first.json());
    assert.equal(
      (await app.inject({ method: 'GET', url, headers: alice.headers })).statusCode,
      404,
    );
  } finally {
    await app.close();
    kernel.dispose();
    store.close();
  }
});

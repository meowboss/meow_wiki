import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { changeAdminRole } from '../src/admin.ts';

const origin = 'http://localhost:3000';
const input = {
  name: 'Reading',
  description: 'Declarative',
  template: '# Read',
  blocks: [
    { type: 'markdown', text: 'Read safely' },
    { type: 'page-list', title: 'Pages' },
    { type: 'search', title: 'Find' },
  ],
};

test('Better Auth marketplace HTTP: author/reviewer/reader, scope, CAS, snapshots and withdrawal', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store, mode: 'session' });
  try {
    async function login(name: string) {
      const credentials = { email: `${name}@example.test`, password: 'long-password-123' };
      const signup = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin },
        payload: { ...credentials, name },
      });
      assert.equal(signup.statusCode, 200, signup.body);
      const signed = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin },
        payload: credentials,
      });
      assert.equal(signed.statusCode, 200, signed.body);
      const cookie = (
        Array.isArray(signed.headers['set-cookie'])
          ? signed.headers['set-cookie']
          : [String(signed.headers['set-cookie'])]
      )
        .map((value) => value.split(';')[0])
        .join('; ');
      const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
      const headers = { cookie, origin, 'x-csrf-token': me.csrfToken };
      const workspaceId = (await app.inject({ url: '/api/workspace', headers })).json().workspace
        .id;
      return { headers, workspaceId, id: me.user.id };
    }
    const author = await login('author');
    const admin = await login('reviewer');
    const reader = await login('reader');
    const call = async (
      who: typeof author,
      method: 'GET' | 'POST' | 'PUT',
      url: string,
      payload?: object,
      expected = 200,
    ) => {
      const response = await app.inject({
        method,
        url,
        headers: who.headers,
        ...(payload ? { payload } : {}),
      });
      assert.equal(response.statusCode, expected, `${method} ${url}: ${response.body}`);
      return response.json();
    };
    assert.equal((await app.inject({ url: '/api/marketplace' })).statusCode, 401);
    await call(author, 'GET', '/api/reviews', undefined, 403);
    assert.throws(() => changeAdminRole(store.db, 'grant', 'unknown@example.test'), /未找到/);
    changeAdminRole(store.db, 'grant', 'reviewer@example.test');
    changeAdminRole(store.db, 'grant', 'author@example.test');
    assert.equal((await call(admin, 'GET', '/api/auth/me')).user.role, 'admin');
    const draft = await call(author, 'POST', '/api/components', input, 201);
    await call(
      author,
      'POST',
      '/api/components',
      { ...input, blocks: [{ type: 'markdown', title: 'wrong' }] },
      400,
    );
    const release = await call(author, 'POST', `/api/components/${draft.id}/submit`);
    assert.equal(release.status, 'pending');
    assert.equal(
      (await call(author, 'GET', '/api/workspace')).components[0].latestRelease.id,
      release.id,
    );
    assert.deepEqual((await call(reader, 'GET', '/api/workspace')).components, []);
    assert.deepEqual((await call(reader, 'GET', '/api/components/releases')).releases, []);
    assert.equal(
      (await call(author, 'GET', '/api/components/releases')).releases[0].id,
      release.id,
    );
    await call(
      author,
      'POST',
      `/api/reviews/${release.id}`,
      { decision: 'published', reason: '' },
      403,
    );
    await call(
      reader,
      'POST',
      `/api/reviews/${release.id}`,
      { decision: 'published', reason: '' },
      403,
    );
    assert.equal((await call(admin, 'GET', '/api/reviews')).releases.length, 1);
    await call(admin, 'POST', `/api/reviews/${release.id}`, {
      decision: 'published',
      reason: 'Approved',
    });
    assert.equal(
      (await call(reader, 'GET', '/api/marketplace')).releases[0].digest,
      release.digest,
    );
    for (const route of [
      '/api/workspace',
      '/api/components/releases',
      '/api/home',
      '/api/components/installed',
    ]) {
      await call(reader, 'GET', `${route}?workspaceId=${author.workspaceId}`, undefined, 404);
    }
    await call(reader, 'PUT', `/api/components/${draft.id}`, { ...input, expectedVersion: 1 }, 404);
    await call(reader, 'POST', `/api/components/${draft.id}/submit`, undefined, 404);
    await call(
      reader,
      'POST',
      `/api/marketplace/${release.id}/install?workspaceId=${author.workspaceId}`,
      undefined,
      404,
    );
    await call(reader, 'POST', `/api/marketplace/${release.id}/install`);
    assert.equal((await call(reader, 'GET', '/api/components/installed')).installed.length, 1);
    assert.deepEqual(await call(reader, 'GET', '/api/home'), {
      layout: null,
      components: [],
      revision: 0,
    });
    const layout = { title: 'Home', blocks: [{ releaseId: release.id }] };
    await call(reader, 'PUT', '/api/home', layout, 400);
    const saved = await call(reader, 'PUT', '/api/home', { layout, expectedRevision: 0 });
    assert.equal(saved.revision, 1);
    assert.equal(saved.components[0].digest, release.digest);
    await call(reader, 'PUT', '/api/home', { ...layout, title: 'Stale', expectedRevision: 0 }, 409);
    await call(
      reader,
      'PUT',
      '/api/home',
      { ...layout, blocks: [{ componentId: draft.id }], expectedRevision: 1 },
      404,
    );
    assert.equal((await call(reader, 'GET', '/api/home')).revision, 1);
    const outcomes = await Promise.all(
      ['First', 'Second'].map((title) =>
        app.inject({
          method: 'PUT',
          url: '/api/home',
          headers: reader.headers,
          payload: { ...layout, title, expectedRevision: 1 },
        }),
      ),
    );
    assert.deepEqual(outcomes.map((response) => response.statusCode).sort(), [200, 409]);
    const updated = await call(author, 'PUT', `/api/components/${draft.id}`, {
      ...input,
      template: 'New private version',
      expectedVersion: 1,
    });
    assert.equal(updated.version, 2);
    await call(author, 'PUT', `/api/components/${draft.id}`, { ...input, expectedVersion: 1 }, 409);
    assert.equal((await call(reader, 'GET', '/api/home')).components[0].template, input.template);
    await call(admin, 'POST', `/api/reviews/${release.id}`, {
      decision: 'withdrawn',
      reason: 'Policy',
    });
    assert.deepEqual((await call(reader, 'GET', '/api/marketplace')).releases, []);
    await call(reader, 'POST', `/api/marketplace/${release.id}/install`, undefined, 409);
    await call(author, 'POST', `/api/marketplace/${release.id}/install`, undefined, 409);
    assert.equal((await call(reader, 'GET', '/api/home')).components[0].status, 'withdrawn');
    assert.equal(
      (await call(reader, 'GET', '/api/workspace')).installed[0].release.template,
      input.template,
    );
    // Simulate a dangling reference in old persisted data: preserve position instead of filtering.
    store.db.prepare('UPDATE mw_layouts SET json=? WHERE workspace_id=?').run(
      JSON.stringify({
        title: 'Legacy',
        blocks: [{ componentId: 'missing' }, { releaseId: release.id }],
      }),
      reader.workspaceId,
    );
    const dangling = await call(reader, 'GET', '/api/home');
    assert.equal(dangling.components.length, 2);
    assert.equal(dangling.components[0], null);
    assert.equal(dangling.components[1].id, release.id);
    changeAdminRole(store.db, 'revoke', 'reviewer@example.test');
    await call(admin, 'GET', '/api/reviews', undefined, 403);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM mw_audit WHERE action='component.review'").get()!
        .n,
      2,
    );
    assert.throws(() => store.db.exec('DELETE FROM mw_audit'), /immutable/);
  } finally {
    await app.close();
    store.close();
  }
});

test('layout revision migrates existing rows and performs compare-and-swap', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY, owner TEXT NOT NULL);
      INSERT INTO workspaces VALUES ('space', 'author');
      CREATE TABLE mw_layouts(workspace_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      INSERT INTO mw_layouts VALUES ('space', '{"title":"Old","blocks":[]}');`);
    const service = new ComponentService(db);
    assert.equal(service.home('author', 'space').revision, 1);
    assert.throws(
      () => service.saveLayout('author', 'space', { title: 'Stale', blocks: [] }, 0),
      (error) => (error as { statusCode: number }).statusCode === 409,
    );
    service.saveLayout('author', 'space', { title: 'New', blocks: [] }, 1);
    assert.equal(new ComponentService(db).home('author', 'space').revision, 2);
  } finally {
    db.close();
  }
});

for (const mode of ['local', 'token'] as const)
  test(`${mode} identities cannot review even with a host role row`, async () => {
    const store = new Store(':memory:');
    const token = 'a'.repeat(40);
    const app = createApp({ store, mode, token, userId: 'host' });
    try {
      store.db.exec(
        "CREATE TABLE mw_platform_roles(user_id TEXT PRIMARY KEY, role TEXT); INSERT INTO mw_platform_roles VALUES ('host','admin')",
      );
      const headers = mode === 'token' ? { authorization: `Bearer ${token}` } : {};
      assert.equal((await app.inject({ url: '/api/reviews', headers })).statusCode, 403);
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/reviews/missing',
            headers,
            payload: { decision: 'published', reason: '' },
          })
        ).statusCode,
        403,
      );
    } finally {
      await app.close();
      store.close();
    }
  });

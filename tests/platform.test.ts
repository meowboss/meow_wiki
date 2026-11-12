import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { Kernel, type Plugin } from '../src/kernel.ts';

const fixture = () => {
  const store = new Store(':memory:');
  const app = createApp({ store });
  return {
    store,
    app,
    async close() {
      await app.close();
      store.close();
    },
  };
};
test('official defaults, page persistence, scoped search and honest cited answers', async () => {
  const f = fixture();
  try {
    const initial = (await f.app.inject('/api/workspace')).json();
    assert.equal(initial.plugins.filter((p: { enabled: boolean }) => p.enabled).length, 3);
    const created = await f.app.inject({
      method: 'POST',
      url: '/api/pages',
      payload: { title: '橘猫笔记', markdown: '橘猫喜欢晒太阳。' },
    });
    assert.equal(created.statusCode, 201);
    const page = created.json();
    assert.equal(
      (
        await f.app.inject({
          method: 'PUT',
          url: `/api/pages/${page.id}`,
          payload: {
            title: '橘猫日记',
            markdown: '橘猫在花园里。',
            expectedRevision: page.revision,
          },
        })
      ).statusCode,
      200,
    );
    const result = (await f.app.inject('/api/search?q=' + encodeURIComponent('橘猫'))).json();
    assert.equal(result.results[0].id, page.id);
    const answer = (
      await f.app.inject({ method: 'POST', url: '/api/ask', payload: { question: '橘猫' } })
    ).json();
    assert.equal(answer.mode, 'local-extractive');
    assert.equal(answer.sources[0].id, page.id);
    assert.match(answer.answer, /花园/);
  } finally {
    await f.close();
  }
});
test('cross-workspace reads and writes fail even with forged identity headers', async () => {
  const f = fixture();
  try {
    const foreignId = f.store.ensure('someone-else');
    const foreignPage = f.store.get('someone-else', foreignId).pages[0];
    for (const path of ['/api/workspace', '/api/search?q=Wiki']) {
      const separator = path.includes('?') ? '&' : '?';
      assert.equal(
        (
          await f.app.inject({
            url: `${path}${separator}workspaceId=${foreignId}`,
            headers: { 'x-user-id': 'someone-else' },
          })
        ).statusCode,
        404,
      );
    }
    assert.equal(
      (
        await f.app.inject({
          method: 'PUT',
          url: `/api/pages/${foreignPage.id}`,
          payload: { title: 'attack', markdown: '', expectedRevision: 1 },
        })
      ).statusCode,
      404,
    );
    assert.throws(() => f.store.get('local-owner', foreignId));
  } finally {
    await f.close();
  }
});
test('sanitized markdown strips active content and remote image requests', async () => {
  const f = fixture();
  try {
    const result = await f.app.inject({
      method: 'POST',
      url: '/api/render',
      payload: {
        markdown:
          '# Hello\n<script>alert(1)</script><img src="https://tracker.invalid/p" onerror="alert(1)">\n[click](javascript:alert)\n<iframe src="http://bad"></iframe>',
      },
    });
    assert.equal(result.statusCode, 200);
    const html = result.json().html;
    assert.match(html, /<h1 id="wiki-hello">Hello<a[^>]*>[\s\S]*?<\/a><\/h1>/);
    assert.doesNotMatch(html, /script|onerror|javascript:|iframe|<img/i);
  } finally {
    await f.close();
  }
});
test('dependency toggle is atomic and unavailable capabilities fail closed', async () => {
  const f = fixture();
  try {
    const toggle = (id: string, enabled: boolean) =>
      f.app.inject({ method: 'POST', url: `/api/plugins/${id}`, payload: { enabled } });
    assert.equal((await toggle('official.search', false)).statusCode, 409);
    assert.equal((await f.app.inject('/api/search?q=Wiki')).statusCode, 200);
    assert.equal((await toggle('official.llm-wiki', false)).statusCode, 200);
    assert.equal((await toggle('official.search', false)).statusCode, 200);
    assert.equal((await f.app.inject('/api/search?q=Wiki')).statusCode, 409);
    assert.equal((await toggle('official.llm-wiki', true)).statusCode, 409);
  } finally {
    await f.close();
  }
});
test('private -> pending is not publishing; only trusted review publishes, other owner can install', async () => {
  const f = fixture();
  try {
    const created = (
      await f.app.inject({
        method: 'POST',
        url: '/api/components',
        payload: {
          name: '读书卡',
          description: '我的模板',
          template: '<script>not executable</script>',
        },
      })
    ).json();
    assert.equal(created.version, 1);
    assert.deepEqual(f.store.marketplace(), []);
    const release = (
      await f.app.inject({ method: 'POST', url: `/api/components/${created.id}/submit` })
    ).json();
    assert.equal(release.status, 'pending');
    assert.equal(
      (await f.app.inject({ method: 'POST', url: `/api/components/${created.id}/submit` }))
        .statusCode,
      409,
    );
    assert.equal(
      (await f.app.inject({ method: 'POST', url: `/api/marketplace/${created.id}/install` }))
        .statusCode,
      404,
    );
    const service = new ComponentService(f.store.db);
    service.review('host-reviewer', release.id, 'published', 'checked');
    assert.equal(service.marketplace().length, 1);
    const other = createApp({ store: f.store, userId: 'reader' });
    try {
      assert.equal((await other.inject('/api/workspace')).json().components.length, 0);
      assert.equal(
        (await other.inject({ method: 'POST', url: `/api/marketplace/${release.id}/install` }))
          .statusCode,
        200,
      );
      assert.equal((await other.inject('/api/workspace')).json().installed.length, 1);
      assert.equal((await other.inject('/api/workspace')).json().components.length, 0);
      assert.equal(
        (await other.inject({ method: 'POST', url: `/api/components/${created.id}/submit` }))
          .statusCode,
        404,
      );
    } finally {
      await other.close();
    }
  } finally {
    await f.close();
  }
});
test('token mode fails closed, ignores identity spoofing, rejects hostile origins and invalid input', async () => {
  assert.throws(() => createApp({ mode: 'token' }));
  const store = new Store(':memory:');
  const token = 'a'.repeat(40);
  const app = createApp({ store, mode: 'token', token, userId: 'alice' });
  try {
    assert.equal((await app.inject('/api/workspace')).statusCode, 401);
    assert.equal((await app.inject({ url: 'http://localhost/api/workspace' })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          url: '/api/workspace',
          headers: { host: 'evil.invalid', authorization: `Bearer ${token}` },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ url: '/api/workspace', headers: { authorization: `Bearer ${token}` } }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          url: '/api/workspace',
          headers: { origin: 'https://evil.invalid', authorization: `Bearer ${token}` },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/pages',
          headers: { authorization: `Bearer ${token}` },
          payload: { title: '', markdown: 42 },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
    store.close();
  }
});
test('absolute-form HTTP cannot bypass token authentication on a real listener', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store, mode: 'token', token: 'b'.repeat(40), userId: 'alice' });
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== 'string');
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: 'http://evil.invalid/api/workspace',
          headers: { host: `127.0.0.1:${address.port}` },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 400); // Explicitly reject absolute-form request targets before routing.
  } finally {
    await app.close();
    store.close();
  }
});
test('kernel rejects duplicate capabilities, missing dependencies, and rolls back failed setup', () => {
  const kernel = new Kernel();
  const plugin: Plugin = {
    manifest: {
      id: 'test.search',
      name: 'Test',
      description: '',
      version: '1',
      apiVersion: 1,
      kind: 'search',
      requires: [],
    },
    setup: (register) => {
      register('search', () => []);
      throw new Error('failure');
    },
  };
  assert.throws(() => kernel.register(plugin));
  assert.equal(kernel.list().length, 0);
  kernel.register({ ...plugin, setup: (register) => register('search', () => []) });
  assert.throws(() => kernel.register(plugin));
  assert.throws(() =>
    kernel.register({
      ...plugin,
      manifest: { ...plugin.manifest, id: 'test.other' },
      setup: (register) => register('search', () => []),
    }),
  );
  assert.throws(() =>
    kernel.register({
      ...plugin,
      manifest: { ...plugin.manifest, id: 'test.missing', requires: ['not.present'] },
    }),
  );
});
test('SQLite survives reopening and mutations roll back', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meow-test-'));
  const file = join(directory, 'test.sqlite');
  let store = new Store(file);
  try {
    const id = store.ensure('owner');
    assert.throws(() =>
      store.change('owner', id, (w) => {
        w.name = 'bad';
        throw new Error('rollback');
      }),
    );
    assert.notEqual(store.get('owner', id).name, 'bad');
    store.change('owner', id, (w) => {
      w.name = 'persistent';
    });
    store.close();
    store = new Store(file);
    assert.equal(store.get('owner', id).name, 'persistent');
    assert.throws(() => store.get('owner', randomUUID()));
  } finally {
    store.close();
    // Exact known fresh test directory, never a repository/user path.
    rmSync(directory, { recursive: true, force: true });
  }
});

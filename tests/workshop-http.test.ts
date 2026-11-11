import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
test('workshop HTTP cannot execute host files and installs validated definitions only as private drafts', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store });
  try {
    const config = (await app.inject('/api/workshop/config')).json();
    assert.equal(config.configured, false);
    const project = (
      await app.inject({
        method: 'POST',
        url: '/api/workshop/projects',
        payload: { name: '测试', instruction: '读书卡' },
      })
    ).json();
    assert.ok(project.id);
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/workshop/projects/${project.id}/file`,
          payload: { path: '../secrets', content: 'bad' },
        })
      ).statusCode,
      400,
    );
    const content = JSON.stringify({ name: '私有读书卡', description: '', template: '# 读书' });
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/workshop/projects/${project.id}/file`,
          payload: { path: '/project/component.json', content },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({ method: 'POST', url: `/api/workshop/projects/${project.id}/validate` })
      ).json().valid,
      true,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: `/api/workshop/projects/${project.id}/install` }))
        .statusCode,
      200,
    );
    const workspace = (await app.inject('/api/workspace')).json();
    assert.equal(workspace.components[0].status, 'private');
    assert.equal(workspace.marketplace.length, 0);
  } finally {
    await app.close();
    store.close();
  }
});

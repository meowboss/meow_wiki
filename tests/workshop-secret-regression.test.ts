import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import { WorkshopEngine } from '../src/modules/workshop/engine.ts';
test('JSON-escaped provider key cannot be written into virtual component output', async () => {
  const store = new Store(':memory:');
  try {
    store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY);INSERT INTO user VALUES('owner')");
    const components = new ComponentService(store.db);
    const projects = new WorkshopProjects(store.db, components);
    const workspace = store.ensure('owner');
    const vault = new ProviderVault(store.db, 'test-only-master-secret-at-least-32', {
      test: 'https://provider.example/v1',
    });
    const key = 'sk-FAKE-REVIEW-ONLY';
    const profile = vault.save('owner', {
      label: 'test',
      endpointId: 'test',
      model: 'test',
      apiKey: key,
    });
    for (const nested of [false, true]) {
      const project = projects.create('owner', workspace, {
        name: 'secret regression',
        instruction: 'test',
      });
      const component = JSON.stringify({ name: 'test', description: '', template: key });
      const escaped = component.replaceAll(key, '\\u0073k-FAKE-REVIEW-ONLY');
      let raw = JSON.stringify({
        tool: 'write_file',
        path: '/project/component.json',
        content: nested ? escaped : component,
      });
      if (!nested) raw = raw.replaceAll(key, '\\u0073k-FAKE-REVIEW-ONLY');
      assert.equal(raw.includes(key), false);
      const engine = new WorkshopEngine(
        projects,
        vault,
        (async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: raw } }] }),
          )) as typeof fetch,
      );
      await assert.rejects(engine.run('owner', project.id, profile.id), /敏感凭据/);
      assert.equal(projects.get('owner', project.id).files['/project/component.json'], '');
      assert.equal(components.list('owner', workspace).length, 0);
    }
  } finally {
    store.close();
  }
});

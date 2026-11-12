import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import { WorkshopEngine } from '../src/modules/workshop/engine.ts';
test('cancellation racing provider EOF cannot commit finish or a write action', async () => {
  const store = new Store(':memory:');
  try {
    store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY);INSERT INTO user VALUES('owner')");
    const components = new ComponentService(store.db);
    const projects = new WorkshopProjects(store.db, components);
    const vault = new ProviderVault(store.db, 'eof-test-master-secret-longer-than-32', {
      test: 'https://provider.example/v1',
    });
    const provider = vault.save('owner', {
      label: 'test',
      endpointId: 'test',
      model: 'test',
      apiKey: 'eof-test-fake-secret',
    });
    const wid = store.ensure('owner');
    for (const action of [
      { tool: 'finish' },
      {
        tool: 'write_file',
        path: '/project/component.json',
        content: '{"name":"bad","description":"","template":"changed"}',
      },
    ]) {
      const project = projects.create('owner', wid, { name: 'EOF', instruction: 'test' });
      const original = JSON.stringify({ name: 'original', description: '', template: '' });
      projects.writeFile('owner', project.id, '/project/component.json', original);
      let engine: WorkshopEngine;
      engine = new WorkshopEngine(projects, vault, (async () => {
        let sent = false;
        return new Response(
          new ReadableStream({
            pull(c) {
              if (!sent) {
                sent = true;
                c.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }),
                  ),
                );
              } else {
                engine.cancel('owner', project.id);
                c.close();
              }
            },
          }),
        );
      }) as typeof fetch);
      await assert.rejects(engine.run('owner', project.id, provider.id), /取消/);
      assert.equal(projects.get('owner', project.id).state, 'failed');
      assert.equal(projects.get('owner', project.id).files['/project/component.json'], original);
    }
  } finally {
    store.close();
  }
});

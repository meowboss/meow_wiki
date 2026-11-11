import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import { WorkshopEngine } from '../src/modules/workshop/engine.ts';
test('startup marks interrupted jobs failed and storage failure does not permanently consume engine slots', async () => {
  const store = new Store(':memory:');
  try {
    store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY);INSERT INTO user VALUES('owner')");
    const components = new ComponentService(store.db),
      projects = new WorkshopProjects(store.db, components);
    const project = projects.create('owner', store.ensure('owner'), {
      name: '恢复测试',
      instruction: 'test',
    });
    projects.setRunState('owner', project.id, 'running', 1, null);
    assert.equal(projects.recoverInterruptedRuns(), 1);
    assert.equal(projects.get('owner', project.id).state, 'failed');
    const vault = new ProviderVault(store.db, 'test-only-master-at-least-32-characters', {
      test: 'https://provider.example/v1',
    });
    const provider = vault.save('owner', {
      label: 'test',
      endpointId: 'test',
      model: 'test',
      apiKey: 'fake-key-for-test',
    });
    projects.writeFile(
      'owner',
      project.id,
      '/project/component.json',
      JSON.stringify({ name: '恢复', description: '', template: '' }),
    );
    const engine = new WorkshopEngine(
      projects,
      vault,
      (async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"tool":"finish"}' } }] }),
        )) as typeof fetch,
    );
    store.db.exec(
      "CREATE TRIGGER deny_run BEFORE UPDATE ON mw_workshop_projects BEGIN SELECT RAISE(ABORT,'fail'); END",
    );
    await assert.rejects(engine.run('owner', project.id, provider.id));
    store.db.exec('DROP TRIGGER deny_run');
    assert.equal((await engine.run('owner', project.id, provider.id)).state, 'ready');
  } finally {
    store.close();
  }
});

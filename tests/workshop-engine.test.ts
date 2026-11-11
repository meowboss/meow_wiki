import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import { WorkshopEngine } from '../src/modules/workshop/engine.ts';
test('bounded harness executes only virtual tools and imports a separately confirmed private component', async () => {
  const store = new Store(':memory:');
  try {
    store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('owner')");
    const workspace = store.ensure('owner');
    const components = new ComponentService(store.db);
    const projects = new WorkshopProjects(store.db, components);
    const vault = new ProviderVault(store.db, 'test-only-master-secret-at-least-32-characters', {
      mock: 'https://provider.example/v1',
    });
    const profile = vault.save('owner', {
      label: '测试',
      endpointId: 'mock',
      model: 'test',
      apiKey: 'test-only-key',
    });
    const project = projects.create('owner', workspace, {
      name: '读书卡',
      instruction: '创建读书组件',
    });
    const content = JSON.stringify({
      name: '读书卡',
      description: '',
      template: '# 读书',
      blocks: [{ type: 'markdown', text: '# 读书' }],
    });
    const actions = [
      { tool: 'read_file', path: '/sdk/README.md' },
      { tool: 'write_file', path: '/project/component.json', content },
      { tool: 'validate_component' },
      { tool: 'finish' },
    ];
    const engine = new WorkshopEngine(projects, vault, (async (_url, init) => {
      assert.ok(!String(init?.body).includes('test-only-key'));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions.shift()) } }] }),
      );
    }) as typeof fetch);
    const result = await engine.run('owner', project.id, profile.id);
    assert.equal(result.state, 'ready');
    assert.equal(result.iterations, 4);
    assert.equal(components.list('owner', workspace).length, 0);
    projects.install('owner', project.id);
    assert.equal(components.list('owner', workspace).length, 1);
    const bad = projects.create('owner', workspace, { name: '越权请求', instruction: 'test' });
    const denied = new WorkshopEngine(
      projects,
      vault,
      (async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    tool: 'write_file',
                    path: '/etc/passwd',
                    content: 'bad',
                  }),
                },
              },
            ],
          }),
        )) as typeof fetch,
    );
    await assert.rejects(denied.run('owner', bad.id, profile.id));
    assert.equal(projects.get('owner', bad.id).state, 'failed');
  } finally {
    store.close();
  }
});

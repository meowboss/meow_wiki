import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import { WorkshopEngine } from '../src/modules/workshop/engine.ts';
test('owner cancellation aborts provider call and releases slot; instruction and read results never send the current key', async () => {
  const store = new Store(':memory:');
  try {
    store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY);INSERT INTO user VALUES('owner')");
    const components = new ComponentService(store.db);
    const projects = new WorkshopProjects(store.db, components);
    const vault = new ProviderVault(store.db, 'test-master-key-longer-than-32-characters', {
      test: 'https://provider.example/v1',
    });
    const key = 'fake-key-must-not-enter-context';
    const provider = vault.save('owner', {
      label: 'test',
      endpointId: 'test',
      model: 'test',
      apiKey: key,
    });
    const wid = store.ensure('owner');
    let calls = 0;
    const blocked = new WorkshopEngine(projects, vault, (async () => {
      calls++;
      throw new Error('should not call');
    }) as typeof fetch);
    const bad = projects.create('owner', wid, { name: 'bad', instruction: key });
    await assert.rejects(blocked.run('owner', bad.id, provider.id), /凭据/);
    assert.equal(calls, 0);
    const nested = JSON.stringify({
      nested: JSON.stringify({ template: key }).replaceAll(
        key,
        '\\u0066ake-key-must-not-enter-context',
      ),
    });
    const encoded = projects.create('owner', wid, { name: 'nested', instruction: nested });
    await assert.rejects(blocked.run('owner', encoded.id, provider.id), /凭据/);
    assert.equal(calls, 0);
    const p = projects.create('owner', wid, { name: 'cancel', instruction: 'test' });
    let started!: () => void;
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    const engine = new WorkshopEngine(
      projects,
      vault,
      ((_url, init) =>
        new Promise((_resolve, reject) => {
          started();
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        })) as typeof fetch,
    );
    const run = engine.run('owner', p.id, provider.id);
    await begin;
    assert.throws(() => engine.cancel('foreign', p.id));
    engine.cancel('owner', p.id);
    await assert.rejects(run, /取消/);
    assert.equal(projects.get('owner', p.id).state, 'failed');
    const secretFile = projects.create('owner', wid, { name: 'file', instruction: 'test' });
    projects.writeFile(
      'owner',
      secretFile.id,
      '/project/component.json',
      JSON.stringify({ name: 'test', description: '', template: key }),
    );
    let reads = 0;
    const reader = new WorkshopEngine(projects, vault, (async () => {
      reads++;
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: '{"tool":"read_file","path":"/project/component.json"}' } },
          ],
        }),
      );
    }) as typeof fetch);
    await assert.rejects(reader.run('owner', secretFile.id, provider.id), /凭据/);
    assert.equal(reads, 1);
  } finally {
    store.close();
  }
});

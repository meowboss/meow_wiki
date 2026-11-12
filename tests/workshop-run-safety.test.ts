import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { CompositionService } from '../src/modules/compositions/service.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import { ConversationStore } from '../src/modules/workshop/conversation.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { WorkshopEngine, MAX_AGENT_STEPS, MAX_RUN_MS } from '../src/modules/workshop/engine.ts';

function fixture() {
  const store = new Store(':memory:');
  store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('owner')");
  const workspace = store.ensure('owner');
  const components = new ComponentService(store.db);
  const projects = new WorkshopProjects(store.db, components);
  const conversation = new ConversationStore(store.db, projects);
  const vault = new ProviderVault(store.db, 'test-only-master-secret-at-least-32-characters', {
    mock: 'https://provider.example/v1',
  });
  const profile = vault.save('owner', {
    label: 'test',
    endpointId: 'mock',
    model: 'test',
    apiKey: 'test-only-provider-secret',
  });
  const project = projects.create('owner', workspace, { name: 'Long run', instruction: 'Build' });
  return { store, workspace, components, projects, conversation, vault, profile, project };
}
function response(action: unknown) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }),
  );
}

test('twelve tool calls then finish persist real counts above eight and further chats remain available', async () => {
  const f = fixture();
  try {
    const actions = Array.from({ length: 11 }, (_, i) => ({
      tool: 'read_file',
      path: i % 2 ? '/sdk/component.schema.json' : '/sdk/README.md',
    }));
    const queue: unknown[] = [
      ...actions,
      {
        tool: 'write_file',
        path: '/project/component.json',
        content: JSON.stringify({ name: 'Done', description: '', template: '# Done' }),
      },
      { tool: 'finish' },
    ];
    const engine = new WorkshopEngine(
      f.projects,
      f.vault,
      (async () => response(queue.shift())) as typeof fetch,
      f.conversation,
    );
    const ready = await engine.run('owner', f.project.id, f.profile.id);
    assert.equal(ready.state, 'ready');
    assert.equal(ready.iterations, 13);
    assert.equal(
      f.store.db.prepare('SELECT iterations FROM mw_workshop_projects WHERE id=?').get(f.project.id)
        ?.iterations,
      13,
    );
    assert.equal(f.conversation.list('owner', f.project.id).at(-1)?.turn, 13);
    assert.equal(f.components.list('owner', f.workspace).length, 0);
    for (let i = 0; i < 12; i++) {
      queue.push({ tool: 'ask_user', message: `Question ${i}` });
      const next = await engine.chat('owner', f.project.id, f.profile.id, `Continue ${i}`);
      assert.equal(next.project.state, 'draft');
    }
  } finally {
    f.store.close();
  }
});

test('four identical action/result pairs stop with an explicit error and accurate count', async () => {
  const f = fixture();
  try {
    let calls = 0;
    const engine = new WorkshopEngine(
      f.projects,
      f.vault,
      (async () => {
        calls++;
        return response({ tool: 'read_file', path: '/sdk/README.md' });
      }) as typeof fetch,
      f.conversation,
    );
    await assert.rejects(engine.run('owner', f.project.id, f.profile.id), /工具重复无进展/);
    assert.equal(calls, 4);
    assert.equal(f.projects.get('owner', f.project.id).iterations, 4);
    assert.equal(f.conversation.list('owner', f.project.id).at(-1)?.status, 'error');
  } finally {
    f.store.close();
  }
});

test('abnormal step fuse preserves 128 actual calls rather than clamping to eight', async () => {
  const f = fixture();
  try {
    let calls = 0;
    const engine = new WorkshopEngine(
      f.projects,
      f.vault,
      (async () =>
        response({
          tool: 'write_file',
          path: '/project/component.json',
          content: String(++calls),
        })) as typeof fetch,
      f.conversation,
    );
    await assert.rejects(engine.run('owner', f.project.id, f.profile.id), /异常安全熔断/);
    assert.equal(calls, MAX_AGENT_STEPS);
    assert.equal(f.projects.get('owner', f.project.id).iterations, MAX_AGENT_STEPS);
    assert.equal(f.conversation.list('owner', f.project.id).at(-1)?.turn, MAX_AGENT_STEPS);
  } finally {
    f.store.close();
  }
});

test('wall clock safety deadline stops before a later tool can write', async (t) => {
  const f = fixture();
  try {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const engine = new WorkshopEngine(
      f.projects,
      f.vault,
      (async () => {
        t.mock.timers.tick(MAX_RUN_MS + 1);
        return response({ tool: 'write_file', path: '/project/component.json', content: 'late' });
      }) as typeof fetch,
      f.conversation,
    );
    await assert.rejects(engine.run('owner', f.project.id, f.profile.id), /安全时限/);
    assert.equal(f.projects.readFile('owner', f.project.id, '/project/component.json'), '');
    assert.equal(f.projects.get('owner', f.project.id).state, 'failed');
  } finally {
    f.store.close();
  }
});

test('legacy CHECK migration retains page files, metadata, snapshots, messages, custom columns and indexes', () => {
  const f = fixture();
  try {
    // Recreate the old schema, including its original eight-step check.
    const current = String(
      f.store.db.prepare("SELECT sql FROM sqlite_master WHERE name='mw_workshop_projects'").get()
        ?.sql,
    );
    f.store.db.exec(`DROP TABLE mw_workshop_projects; ${current.replace('9007199254740991', '8')};
      CREATE INDEX mw_workshop_projects_owner ON mw_workshop_projects(owner, workspace_id);
      ALTER TABLE mw_workshop_projects ADD COLUMN extra_metadata TEXT;
      CREATE INDEX custom_project_name ON mw_workshop_projects(name);
      CREATE TRIGGER preserve_project_trigger AFTER UPDATE OF name ON mw_workshop_projects BEGIN SELECT 1; END;`);
    const compositions = new CompositionService(f.store.db, (owner, id) => {
      f.store.get(owner, id);
    });
    // Seed old data without constructing the new service (which would migrate immediately).
    f.store.db
      .prepare(
        `INSERT INTO mw_workshop_projects
      (id,owner,workspace_id,name,instruction,content,state,error,iterations,kind,source_surface,source_revision,revision,extra_metadata)
      VALUES ('legacy','owner',?,'Page','Build','saved page','failed','old error',8,'page','home',7,3,'retain')`,
      )
      .run(f.workspace);
    f.store.db
      .prepare(
        `INSERT INTO mw_workshop_project_revisions VALUES ('owner','legacy',3,'saved page',10,'old timestamp')`,
      )
      .run();
    f.conversation.append('owner', 'legacy', {
      role: 'assistant',
      content: 'old message',
      turn: 8,
    });
    const before = f.store.db.prepare('SELECT * FROM mw_workshop_projects').all();
    const projects = new WorkshopProjects(f.store.db, f.components, compositions);
    assert.deepEqual(f.store.db.prepare('SELECT * FROM mw_workshop_projects').all(), before);
    assert.equal(projects.readRevision('owner', 'legacy', 3).content, 'saved page');
    assert.equal(f.conversation.list('owner', 'legacy')[0].content, 'old message');
    assert.equal(projects.setRunState('owner', 'legacy', 'ready', 13).iterations, 13);
    for (const name of [
      'custom_project_name',
      'mw_workshop_projects_owner',
      'preserve_project_trigger',
    ])
      assert.ok(f.store.db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name));
    assert.equal(
      new WorkshopProjects(f.store.db, f.components, compositions).get('owner', 'legacy')
        .iterations,
      13,
    );
    assert.deepEqual(f.store.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    f.store.close();
  }
});

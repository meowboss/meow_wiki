import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { CompositionService } from '../src/modules/compositions/service.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import { ProjectRevisions } from '../src/modules/workshop/project-revisions.ts';
import { WorkshopEngine } from '../src/modules/workshop/engine.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { PAGE_FILE } from '../packages/workshop-contract/index.ts';

const input = { name: 'Page', instruction: 'Build page', surface: 'home', fromCurrent: false };
const status = (code: number) => (error: unknown) =>
  !!error && (error as { statusCode: number }).statusCode === code;
function fixture() {
  const store = new Store(':memory:');
  const workspace = store.ensure('alice');
  store.ensure('bob');
  const components = new ComponentService(store.db);
  const compositions = new CompositionService(store.db, (owner, id) => {
    store.get(owner, id);
  });
  const projects = new WorkshopProjects(store.db, components, compositions);
  return { store, workspace, components, compositions, projects };
}

test('page creation and manual/engine writes persist exact snapshots with metadata-only lists', () => {
  const f = fixture();
  try {
    const project = f.projects.createPage('alice', f.workspace, input);
    const initial = f.projects.readRevision('alice', project.id, 0);
    assert.equal(initial.content, project.files[PAGE_FILE]);
    assert.equal(initial.revision, 0);
    assert.ok(Number.isFinite(Date.parse(initial.createdAt)));
    const content = '中文🙂 draft';
    f.projects.writeFile('alice', project.id, PAGE_FILE, content, false, 0);
    f.projects.claimRun('alice', project.id);
    f.projects.writeFile('alice', project.id, PAGE_FILE, 'engine draft', true);
    const list = f.projects.listRevisions('alice', project.id);
    assert.deepEqual(
      list.map((row) => row.revision),
      [2, 1, 0],
    );
    assert.equal(list[1].bytes, Buffer.byteLength(content, 'utf8'));
    for (const row of list)
      assert.deepEqual(Object.keys(row).sort(), ['bytes', 'createdAt', 'revision']);
    assert.deepEqual(f.projects.readRevision('alice', project.id, 1), {
      revision: 1,
      content,
      createdAt: list[1].createdAt,
    });
    const reopened = new WorkshopProjects(f.store.db, f.components, f.compositions);
    assert.deepEqual(reopened.listRevisions('alice', project.id), list);
    assert.equal(f.projects.readRevision('alice', project.id, 0).content, initial.content);
  } finally {
    f.store.close();
  }
});

test('CAS, invalid writes and run guards leave both file and revision history unchanged', () => {
  const f = fixture();
  try {
    const p = f.projects.createPage('alice', f.workspace, input);
    f.projects.writeFile('alice', p.id, PAGE_FILE, 'saved', false, 0);
    const before = f.projects.get('alice', p.id);
    const history = f.projects.listRevisions('alice', p.id);
    for (const action of [
      () => f.projects.writeFile('alice', p.id, PAGE_FILE, 'stale', false, 0),
      () => f.projects.writeFile('alice', p.id, PAGE_FILE, 'missing CAS'),
      () => f.projects.writeFile('alice', p.id, '/sdk/README.md', 'no', false, 1),
      () => f.projects.writeFile('alice', p.id, PAGE_FILE, 'x'.repeat(30001), false, 1),
    ])
      assert.throws(action);
    assert.deepEqual(f.projects.get('alice', p.id), before);
    assert.deepEqual(f.projects.listRevisions('alice', p.id), history);
    f.projects.claimRun('alice', p.id);
    assert.throws(
      () => f.projects.writeFile('alice', p.id, PAGE_FILE, 'busy', false, 1),
      status(409),
    );
    assert.deepEqual(f.projects.listRevisions('alice', p.id), history);
  } finally {
    f.store.close();
  }
});

test('last 50 snapshots are retained per project; failed snapshot/prune rolls back file and history', (t) => {
  const f = fixture();
  try {
    const p = f.projects.createPage('alice', f.workspace, input);
    const other = f.projects.createPage('alice', f.workspace, input);
    for (let revision = 0; revision < 55; revision++)
      f.projects.writeFile('alice', p.id, PAGE_FILE, `revision ${revision + 1}`, false, revision);
    const history = f.projects.listRevisions('alice', p.id);
    assert.equal(history.length, 50);
    assert.deepEqual(
      history.map((r) => r.revision),
      Array.from({ length: 50 }, (_, i) => 55 - i),
    );
    assert.equal(f.projects.readRevision('alice', p.id, 55).content, 'revision 55');
    assert.throws(() => f.projects.readRevision('alice', p.id, 5), status(404));
    assert.equal(f.projects.listRevisions('alice', other.id).length, 1);
    const before = f.projects.get('alice', p.id);
    const record = ProjectRevisions.prototype.record;
    const failure = t.mock.method(
      ProjectRevisions.prototype,
      'record',
      function (this: ProjectRevisions, owner: string, id: string) {
        record.call(this, owner, id);
        throw new Error('private storage internals');
      },
    );
    assert.throws(
      () => f.projects.writeFile('alice', p.id, PAGE_FILE, 'not committed', false, 55),
      status(500),
    );
    assert.deepEqual(f.projects.get('alice', p.id), before);
    assert.deepEqual(f.projects.listRevisions('alice', p.id), history);
    assert.throws(() => f.projects.readRevision('alice', p.id, 56), status(404));
    assert.throws(() => f.projects.createPage('alice', f.workspace, input), status(500));
    assert.equal(f.projects.list('alice', f.workspace).length, 2);
    failure.mock.restore();
    f.projects.writeFile('alice', p.id, PAGE_FILE, 'retry', false, 55);
    assert.equal(f.projects.listRevisions('alice', p.id).length, 50);
    assert.equal(f.projects.readRevision('alice', p.id, 56).content, 'retry');
  } finally {
    f.store.close();
  }
});

test('history is owner/project authorized; component projects retain their old shape', () => {
  const f = fixture();
  try {
    const p = f.projects.createPage('alice', f.workspace, input);
    for (const owner of ['bob', 'unknown']) {
      assert.throws(() => f.projects.listRevisions(owner, p.id), status(404));
      assert.throws(() => f.projects.readRevision(owner, p.id, 0), status(404));
      assert.throws(() => f.projects.readRevision(owner, p.id, -1), status(404));
    }
    assert.throws(() => f.projects.listRevisions('alice', 'missing'), status(404));
    assert.throws(() => f.projects.readRevision('alice', p.id, 100), status(404));
    for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => f.projects.readRevision('alice', p.id, revision), status(400));
    const component = f.projects.create('alice', f.workspace, {
      name: 'Component',
      instruction: 'Build',
    });
    const saved = f.projects.writeFile('alice', component.id, '/project/component.json', '{}');
    assert.deepEqual(Object.keys(saved).sort(), Object.keys(component).sort());
    assert.equal(Object.hasOwn(saved, 'revision'), false);
    assert.throws(() => f.projects.listRevisions('alice', component.id), status(400));
    assert.throws(() => f.projects.readRevision('alice', component.id, 0), status(400));
  } finally {
    f.store.close();
  }
});

test('engine secret guards reject escaped provider credentials before page history writes', async () => {
  const f = fixture();
  try {
    f.store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('alice')");
    const vault = new ProviderVault(f.store.db, 'test-only-master-secret-at-least-32', {
      test: 'https://provider.example/v1',
    });
    const key = 'sk-FAKE-HISTORY-ONLY';
    const profile = vault.save('alice', {
      label: 'test',
      endpointId: 'test',
      model: 'test',
      apiKey: key,
    });
    const p = f.projects.createPage('alice', f.workspace, input);
    const history = f.projects.listRevisions('alice', p.id);
    const escaped = JSON.stringify({ name: key }).replaceAll(key, '\\u0073k-FAKE-HISTORY-ONLY');
    const engine = new WorkshopEngine(
      f.projects,
      vault,
      (async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    tool: 'write_file',
                    path: PAGE_FILE,
                    content: escaped,
                  }),
                },
              },
            ],
          }),
        )) as typeof fetch,
    );
    await assert.rejects(engine.run('alice', p.id, profile.id), /敏感凭据/);
    assert.equal(f.projects.get('alice', p.id).files[PAGE_FILE], p.files[PAGE_FILE]);
    assert.deepEqual(f.projects.listRevisions('alice', p.id), history);
    assert.doesNotMatch(f.projects.readRevision('alice', p.id, 0).content, /sk-FAKE-HISTORY-ONLY/);
  } finally {
    f.store.close();
  }
});

test('apply snapshots its new current revision and failed apply leaves no history', (t) => {
  const f = fixture();
  try {
    const p = f.projects.createPage('alice', f.workspace, input);
    const before = f.projects.listRevisions('alice', p.id);
    const record = ProjectRevisions.prototype.record;
    const failure = t.mock.method(
      ProjectRevisions.prototype,
      'record',
      function (this: ProjectRevisions, owner: string, id: string) {
        record.call(this, owner, id);
        throw new Error('snapshot failure');
      },
    );
    assert.throws(() => f.projects.apply('alice', p.id, 0), status(500));
    assert.deepEqual(f.projects.get('alice', p.id), p);
    assert.equal(f.compositions.get('alice', f.workspace, 'home').revision, 0);
    assert.deepEqual(f.projects.listRevisions('alice', p.id), before);
    failure.mock.restore();
    const applied = f.projects.apply('alice', p.id, 0);
    assert.equal(applied.revision, 1);
    assert.equal(f.projects.readRevision('alice', p.id, 1).content, p.files[PAGE_FILE]);
  } finally {
    f.store.close();
  }
});

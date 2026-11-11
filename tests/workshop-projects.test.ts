import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComponentService, componentSchema } from '../src/components.ts';
import { Store } from '../src/store.ts';
import {
  WorkshopError,
  WorkshopProjects,
  type WorkshopState,
} from '../src/modules/workshop/projects.ts';

const componentPath = '/project/component.json';
const input = { name: 'Reading card', instruction: 'Create a private reading card' };
const definition = {
  name: 'Reading card',
  description: 'Private declaration',
  template: '# Notes',
  blocks: [
    { type: 'markdown', text: 'Inert Markdown' },
    { type: 'page-list', title: 'Pages' },
    { type: 'search', title: 'Search' },
  ],
};
const fixtureStore = () => {
  const store = new Store(':memory:');
  const alice = store.ensure('alice');
  const other = store.create('alice', 'Other');
  const bob = store.ensure('bob');
  const components = new ComponentService(store.db);
  return {
    store,
    alice,
    other,
    bob,
    components,
    projects: new WorkshopProjects(store.db, components),
  };
};
const status = (code: number) => (error: unknown) => {
  assert.ok(error instanceof WorkshopError);
  assert.equal(error.statusCode, code);
  return true;
};

test('projects persist with owner/workspace scope and contain no credentials or mutable shared files', () => {
  const f = fixtureStore();
  try {
    const project = f.projects.create('alice', f.alice, input);
    assert.deepEqual(
      Object.keys(project).sort(),
      ['id', 'workspaceId', 'name', 'instruction', 'files', 'state', 'error', 'iterations'].sort(),
    );
    assert.equal(project.state, 'draft');
    assert.equal(project.iterations, 0);
    assert.equal(project.error, null);
    assert.deepEqual(
      Object.keys(project.files).sort(),
      ['/sdk/README.md', '/sdk/component.schema.json', componentPath].sort(),
    );
    assert.deepEqual(f.projects.list('alice', f.alice), [project]);
    assert.deepEqual(f.projects.list('alice', f.other), []);
    assert.deepEqual(f.projects.list('bob', f.bob), []);
    assert.throws(() => f.projects.create('bob', f.alice, input), status(404));
    assert.throws(() => f.projects.list('bob', f.alice), status(404));
    assert.throws(() => f.projects.list('alice', 'missing'), status(404));
    for (const action of [
      () => f.projects.get('bob', project.id),
      () => f.projects.readFile('bob', project.id, '/sdk/README.md'),
      () => f.projects.writeFile('bob', project.id, componentPath, '{}'),
      () => f.projects.validate('bob', project.id),
      () => f.projects.install('bob', project.id),
      () => f.projects.setRunState('bob', project.id, 'running', 1),
      () => f.projects.get('alice', 'missing'),
    ])
      assert.throws(action, status(404));
    project.files[componentPath] = 'caller mutation';
    project.files['/sdk/README.md'] = 'caller mutation';
    assert.equal(f.projects.get('alice', project.id).files[componentPath], '');
    assert.match(
      f.projects.readFile('alice', project.id, '/sdk/README.md'),
      /markdown block uses text/,
    );
    assert.ok(
      JSON.parse(f.projects.readFile('alice', project.id, '/sdk/component.schema.json')).properties
        .blocks,
    );
    assert.deepEqual(
      new WorkshopProjects(f.store.db, f.components).get('alice', project.id),
      f.projects.get('alice', project.id),
    );
    f.store.db.prepare('UPDATE workspaces SET owner = ? WHERE id = ?').run('bob', f.alice);
    assert.throws(() => f.projects.get('alice', project.id), status(404));
    assert.throws(() => f.projects.get('bob', project.id), status(404));
  } finally {
    f.store.close();
  }
});

test('only literal virtual file paths are allowed; SDK is read-only and code remains inert text', () => {
  const f = fixtureStore();
  try {
    const p = f.projects.create('alice', f.alice, input);
    for (const path of [
      '',
      '/',
      '../component.json',
      '/project/../project/component.json',
      '/project/./component.json',
      '/project//component.json',
      '//project/component.json',
      '/project/component.json/',
      '/project/component.json?x=1',
      '/project/component.json\0',
      '/project/%2e%2e/component.json',
      '/project/COMPONENT.json',
      'project/component.json',
      '\\project\\component.json',
      'C:\\Windows\\win.ini',
      '/etc/passwd',
      '/sdk',
      '/sdk/README.md/../README.md',
      '__proto__',
      'constructor',
    ]) {
      assert.throws(() => f.projects.readFile('alice', p.id, path), status(400));
      assert.throws(() => f.projects.writeFile('alice', p.id, path, '{}'), status(400));
    }
    for (const path of ['/sdk/README.md', '/sdk/component.schema.json']) {
      assert.ok(f.projects.readFile('alice', p.id, path));
      assert.throws(() => f.projects.writeFile('alice', p.id, path, '{}'), status(400));
    }
    const text = '<script>throw new Error("executed")</script>${process.exit(1)}';
    f.projects.writeFile('alice', p.id, componentPath, text);
    assert.equal(f.projects.readFile('alice', p.id, componentPath), text);
    f.projects.writeFile('alice', p.id, componentPath, 'x'.repeat(30000));
    assert.throws(
      () => f.projects.writeFile('alice', p.id, componentPath, 'x'.repeat(30001)),
      status(400),
    );
    assert.throws(
      () => f.projects.writeFile('alice', p.id, componentPath, null as unknown as string),
      status(400),
    );
    assert.equal(f.projects.readFile('alice', p.id, componentPath).length, 30000);
  } finally {
    f.store.close();
  }
});

test('project inputs, owner-wide quota, and run state have strict bounds', () => {
  const f = fixtureStore();
  try {
    for (const value of [
      null,
      {},
      { ...input, name: ' ' },
      { ...input, name: 'x'.repeat(161) },
      { ...input, instruction: '' },
      { ...input, instruction: 'x'.repeat(3001) },
      { ...input, secret: 'not stored' },
    ]) {
      assert.throws(() => f.projects.create('alice', f.alice, value), status(400));
    }
    for (const value of ['', 42, null, 'x'.repeat(201)]) {
      assert.throws(() => f.projects.create(value as string, f.alice, input), status(400));
      assert.throws(() => f.projects.get('alice', value as string), status(400));
    }
    const p = f.projects.create('alice', f.alice, {
      name: 'x'.repeat(160),
      instruction: 'x'.repeat(3000),
    });
    for (let i = 1; i < 20; i++) f.projects.create('alice', i % 2 ? f.alice : f.other, input);
    assert.throws(() => f.projects.create('alice', f.other, input), status(409));
    assert.ok(f.projects.create('bob', f.bob, input));
    for (const iterations of [-1, 9, 0.5, NaN, Infinity, '1']) {
      assert.throws(
        () => f.projects.setRunState('alice', p.id, 'running', iterations as number),
        status(400),
      );
    }
    assert.throws(
      () => f.projects.setRunState('alice', p.id, 'unknown' as WorkshopState, 0),
      status(400),
    );
    assert.throws(
      () => f.projects.setRunState('alice', p.id, 'failed', 1, 'x'.repeat(2001)),
      status(400),
    );
    assert.equal(f.projects.setRunState('alice', p.id, 'running', 0).state, 'running');
    assert.throws(() => f.projects.writeFile('alice', p.id, componentPath, '{}'), status(409));
    assert.throws(() => f.projects.install('alice', p.id), status(409));
    f.projects.writeFile('alice', p.id, componentPath, JSON.stringify(definition), true);
    assert.equal(f.projects.get('alice', p.id).state, 'running');
    const failed = f.projects.setRunState('alice', p.id, 'failed', 8, 'x'.repeat(2000));
    assert.equal(failed.iterations, 8);
    assert.equal(failed.error!.length, 2000);
    f.projects.writeFile('alice', p.id, componentPath, '{}');
    assert.equal(f.projects.get('alice', p.id).state, 'draft');
    assert.equal(f.projects.get('alice', p.id).error, null);
  } finally {
    f.store.close();
  }
});

test('validation uses the shared schema, sanitizes invalid JSON, and installs distinct private drafts only', () => {
  const f = fixtureStore();
  try {
    const p = f.projects.create('alice', f.alice, input);
    const malformed = '{"secret-in-invalid-json":';
    f.projects.writeFile('alice', p.id, componentPath, malformed);
    const result = f.projects.validate('alice', p.id);
    assert.deepEqual(result, { valid: false, issues: ['Invalid JSON component declaration'] });
    assert.doesNotMatch(JSON.stringify(result), /secret-in-invalid-json|SyntaxError|stack/);
    for (const invalid of [
      null,
      {},
      { ...definition, script: 'execute()' },
      { ...definition, blocks: [{ type: 'markdown', title: 'Wrong' }] },
      { ...definition, blocks: [{ type: 'search', text: 'Wrong' }] },
      { ...definition, blocks: [{ type: 'javascript', text: 'execute()' }] },
    ]) {
      assert.equal(componentSchema.safeParse(invalid).success, false);
      f.projects.writeFile('alice', p.id, componentPath, JSON.stringify(invalid));
      const validation = f.projects.validate('alice', p.id);
      assert.equal(validation.valid, false);
      assert.ok('issues' in validation && validation.issues.length > 0);
      assert.throws(() => f.projects.install('alice', p.id), status(400));
    }
    assert.deepEqual(f.components.list('alice', f.alice), []);
    f.projects.writeFile('alice', p.id, componentPath, JSON.stringify(definition));
    assert.deepEqual(f.projects.validate('alice', p.id), { valid: true });
    f.projects.setRunState('alice', p.id, 'ready', 2);
    const first = f.projects.install('alice', p.id);
    const second = f.projects.install('alice', p.id);
    assert.notEqual(first.id, second.id);
    assert.equal(first.workspaceId, f.alice);
    assert.equal(first.authorId, 'alice');
    assert.equal(first.version, 1);
    assert.equal(f.components.list('alice', f.alice).length, 2);
    assert.deepEqual(f.components.list('alice', f.other), []);
    assert.deepEqual(f.components.marketplace(), []);
    assert.deepEqual(f.components.pending(), []);
    f.projects.writeFile(
      'alice',
      p.id,
      componentPath,
      JSON.stringify({ ...definition, name: 'Changed' }),
    );
    assert.equal(f.components.list('alice', f.alice)[0].name, definition.name);
  } finally {
    f.store.close();
  }
});

test('database failures are sanitized and failed creates roll back', () => {
  const f = fixtureStore();
  try {
    f.store.db.exec(`CREATE TRIGGER fail_workshop BEFORE INSERT ON mw_workshop_projects
      BEGIN SELECT RAISE(ABORT, 'private SQL internals'); END`);
    assert.throws(
      () => f.projects.create('alice', f.alice, input),
      (error) => {
        status(500)(error);
        assert.doesNotMatch((error as Error).message, /private SQL|mw_workshop|INSERT/);
        return true;
      },
    );
    assert.deepEqual(f.projects.list('alice', f.alice), []);
    f.store.db.exec('DROP TRIGGER fail_workshop');
    const p = f.projects.create('alice', f.alice, input);
    f.store.close();
    assert.throws(() => f.projects.get('alice', p.id), status(500));
  } finally {
    if (f.store.db.isOpen) f.store.close();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { CompositionService } from '../src/modules/compositions/service.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import { PAGE_FILE } from '../packages/workshop-contract/index.ts';

const input = {
  name: 'Page',
  instruction: 'Make a declarative page',
  surface: 'home',
  fromCurrent: false,
};
function fixture() {
  const store = new Store(':memory:');
  const alice = store.ensure('alice');
  const other = store.create('alice', 'Other');
  const bob = store.ensure('bob');
  const components = new ComponentService(store.db);
  const compositions = new CompositionService(store.db, (owner, workspace) => {
    store.get(owner, workspace);
  });
  const projects = new WorkshopProjects(store.db, components, compositions);
  return { store, alice, other, bob, components, compositions, projects };
}
const status = (statusCode: number) => (error: unknown) =>
  !!error && (error as { statusCode: number }).statusCode === statusCode;

test('page declarations are owner/workspace scoped, virtual-only and share component quota', () => {
  const f = fixture();
  try {
    for (const surface of ['home', 'wiki', 'collaboration']) {
      const p = f.projects.createPage('alice', f.alice, { ...input, surface });
      assert.equal(p.kind, 'page');
      assert.equal(p.sourceSurface, surface);
      assert.equal(p.sourceRevision, 0);
      assert.equal(p.revision, 0);
      assert.deepEqual(
        Object.keys(p.files).sort(),
        ['/sdk/README.md', '/sdk/page.schema.json', PAGE_FILE].sort(),
      );
      assert.equal(JSON.parse(p.files[PAGE_FILE]).composition.surface, surface);
      assert.deepEqual(f.projects.validate('alice', p.id), { valid: true });
      for (const path of [
        '/etc/passwd',
        'C:\\Windows\\win.ini',
        '/project/../page.json',
        '/project/component.json',
        '/sdk/component.schema.json',
      ])
        assert.throws(() => f.projects.readFile('alice', p.id, path), status(400));
      assert.throws(() => f.projects.install('alice', p.id), status(400));
      assert.throws(() => f.projects.get('bob', p.id), status(404));
      assert.equal(f.compositions.get('alice', f.alice, surface as 'home').revision, 0);
    }
    assert.deepEqual(f.projects.list('alice', f.other), []);
    assert.deepEqual(f.projects.list('bob', f.bob), []);
    assert.throws(() => f.projects.createPage('bob', f.alice, input), status(404));
    for (let i = 3; i < 20; i++)
      f.projects.create('alice', f.other, { name: 'Component', instruction: 'Create' });
    assert.throws(() => f.projects.createPage('alice', f.alice, input), status(409));
    assert.ok(f.projects.createPage('bob', f.bob, input));
  } finally {
    f.store.close();
  }
});

test('manual and engine page writes use CAS and never apply automatically', () => {
  const f = fixture();
  try {
    const p = f.projects.createPage('alice', f.alice, input);
    const content = p.files[PAGE_FILE];
    assert.throws(() => f.projects.writeFile('alice', p.id, PAGE_FILE, content), status(400));
    assert.throws(
      () => f.projects.writeFile('alice', p.id, PAGE_FILE, 'x'.repeat(30001), false, 0),
      status(400),
    );
    const saved = f.projects.writeFile('alice', p.id, PAGE_FILE, content, false, 0);
    assert.equal(saved.revision, 1);
    assert.throws(
      () => f.projects.writeFile('alice', p.id, PAGE_FILE, content, false, 0),
      status(409),
    );
    assert.throws(() => f.projects.apply('alice', p.id, 0), status(409));
    f.projects.claimRun('alice', p.id);
    assert.throws(
      () => f.projects.writeFile('alice', p.id, PAGE_FILE, content, false, 1),
      status(409),
    );
    assert.throws(() => f.projects.apply('alice', p.id, 1), status(409));
    assert.equal(f.projects.writeFile('alice', p.id, PAGE_FILE, content, true).revision, 2);
    f.projects.setRunState('alice', p.id, 'ready', 1);
    assert.equal(f.compositions.get('alice', f.alice, 'home').revision, 0);
    const applied = f.projects.apply('alice', p.id, 2);
    assert.equal(applied.sourceRevision, 1);
    assert.equal(applied.revision, 3);
    assert.equal(f.compositions.get('alice', f.alice, 'home').revision, 1);
    assert.equal(f.compositions.get('alice', f.other, 'home').revision, 0);
  } finally {
    f.store.close();
  }
});

test('blank and copied projects capture current source CAS; stale or invalid references roll back', () => {
  const f = fixture();
  try {
    const { revision: _, ...base } = f.compositions.get('alice', f.alice, 'home');
    const current = f.compositions.update('alice', f.alice, 'home', {
      expectedRevision: 0,
      composition: { ...base, gap: 31 },
    });
    const blank = f.projects.createPage('alice', f.alice, input);
    const copied = f.projects.createPage('alice', f.alice, { ...input, fromCurrent: true });
    assert.equal(blank.sourceRevision, current.revision);
    assert.notEqual(JSON.parse(blank.files[PAGE_FILE]).composition.gap, 31);
    assert.equal(JSON.parse(copied.files[PAGE_FILE]).composition.gap, 31);
    f.projects.apply('alice', copied.id, 0);
    assert.throws(() => f.projects.apply('alice', blank.id, 0), status(409));
    assert.deepEqual(f.projects.get('alice', blank.id), blank);
    const invalid = f.projects.createPage('alice', f.alice, input);
    const declaration = JSON.parse(invalid.files[PAGE_FILE]);
    declaration.composition.instances = [
      {
        ...base.instances[0],
        viewId: 'component.render',
        config: { componentId: '11111111-1111-4111-8111-111111111111' },
      },
    ];
    const saved = f.projects.writeFile(
      'alice',
      invalid.id,
      PAGE_FILE,
      JSON.stringify(declaration),
      false,
      0,
    );
    const before = f.compositions.get('alice', f.alice, 'home');
    assert.throws(() => f.projects.apply('alice', invalid.id, 1), status(400));
    assert.deepEqual(f.projects.get('alice', invalid.id), saved);
    assert.deepEqual(f.compositions.get('alice', f.alice, 'home'), before);
    // Force a failure after composition.update to prove the enclosing transaction rolls it back.
    const valid = f.projects.createPage('alice', f.alice, input);
    f.store.db.exec(
      `CREATE TRIGGER fail_page_metadata BEFORE UPDATE OF source_revision ON mw_workshop_projects BEGIN SELECT RAISE(ABORT, 'metadata failure'); END`,
    );
    assert.throws(() => f.projects.apply('alice', valid.id, 0), status(500));
    assert.deepEqual(f.projects.get('alice', valid.id), valid);
    assert.deepEqual(f.compositions.get('alice', f.alice, 'home'), before);
  } finally {
    f.store.close();
  }
});

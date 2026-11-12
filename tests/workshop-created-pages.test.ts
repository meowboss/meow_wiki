import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { CompositionService } from '../src/modules/compositions/service.ts';
import { WorkshopCreatedPages } from '../src/modules/workshop/created-pages.ts';
import { createDefaultComposition } from '../packages/canvas-contract/index.ts';
test('created page snapshots are scoped and do not overwrite any existing surface', () => {
  const store = new Store(':memory:');
  try {
    const a = store.ensure('alice'),
      b = store.ensure('bob');
    const compositions = new CompositionService(store.db, (owner, workspace) => {
      store.get(owner, workspace);
    });
    const pages = new WorkshopCreatedPages(
      store.db,
      (owner, workspace) => {
        store.get(owner, workspace);
      },
      (owner, workspace, doc) => compositions.validateReferences(owner, workspace, doc),
    );
    const { revision: _, ...composition } = createDefaultComposition('home');
    const created = pages.create('alice', a, {
      title: 'Independent',
      composition,
      sourceProject: 'project',
      sourceProjectRevision: 1,
    });
    assert.equal(created.title, 'Independent');
    assert.equal(pages.list('alice', a).length, 1);
    assert.equal(pages.list('bob', b).length, 0);
    assert.throws(() => pages.get('bob', b, created.id));
    assert.equal(compositions.get('alice', a, 'home').revision, 0);
    assert.throws(() =>
      pages.create('alice', a, {
        title: 'Duplicate',
        composition,
        sourceProject: 'project',
        sourceProjectRevision: 1,
      }),
    );
    assert.equal(pages.get('alice', a, created.id).composition.surface, 'home');
  } finally {
    store.close();
  }
});

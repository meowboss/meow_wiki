import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import { PAGE_FILE } from '../packages/workshop-contract/index.ts';
import { CompositionService } from '../src/modules/compositions/service.ts';
import { WorkshopCreatedPages } from '../src/modules/workshop/created-pages.ts';
import { createDefaultComposition } from '../packages/canvas-contract/index.ts';
test('updating from a project persists content and provenance without applying surfaces or editing projects', () => {
  const f = fixture();
  try {
    const surfaces = (['home', 'wiki', 'collaboration'] as const).map((surface) =>
      f.compositions.get('alice', f.alice, surface),
    );
    const edited = f.projects.writeFile(
      'alice',
      f.project.id,
      PAGE_FILE,
      JSON.stringify({
        ...JSON.parse(f.project.files[PAGE_FILE]),
        composition: { ...f.composition, gap: 31 },
      }),
      false,
      0,
    );
    const saved = f.pages.updateFromProject(
      'alice',
      f.alice,
      f.page.id,
      {
        expectedRevision: 0,
        expectedProjectRevision: 1,
        title: ' Updated ',
      },
      edited,
    );
    assert.equal(saved.title, 'Updated');
    assert.equal(saved.revision, 1);
    assert.equal(saved.composition.gap, 31);
    assert.equal(saved.sourceProject, edited.id);
    assert.equal(saved.sourceProjectRevision, 1);
    assert.equal(saved.createdAt, f.page.createdAt);
    assert.deepEqual(f.pages.get('alice', f.alice, saved.id), saved);
    assert.deepEqual(f.projects.get('alice', edited.id), edited);
    assert.deepEqual(
      (['home', 'wiki', 'collaboration'] as const).map((surface) =>
        f.compositions.get('alice', f.alice, surface),
      ),
      surfaces,
    );
    // A unique provenance tuple already belonging to this page is not a duplicate.
    const repeated = f.pages.updateFromProject(
      'alice',
      f.alice,
      saved.id,
      {
        expectedRevision: 1,
        expectedProjectRevision: 1,
        title: 'Same source',
      },
      edited,
    );
    assert.equal(repeated.revision, 2);
    // A different project can replace the source pointer without modifying either project.
    const replacement = f.projects.createPage('alice', f.alice, {
      name: 'Replacement',
      instruction: 'Build',
      surface: 'home',
      fromCurrent: false,
    });
    const replaced = f.pages.updateFromProject(
      'alice',
      f.alice,
      saved.id,
      {
        expectedRevision: 2,
        expectedProjectRevision: 0,
        title: 'Replacement',
      },
      replacement,
    );
    assert.equal(replaced.sourceProject, replacement.id);
    assert.equal(replaced.sourceProjectRevision, 0);
    assert.deepEqual(f.projects.get('alice', replacement.id), replacement);
  } finally {
    f.store.close();
  }
});

test('page updates reject stale revisions, running projects and cross-scope access atomically', () => {
  const f = fixture();
  try {
    const update = (project = f.project, expectedRevision = 0, expectedProjectRevision = 0) =>
      f.pages.updateFromProject(
        'alice',
        f.alice,
        f.page.id,
        {
          expectedRevision,
          expectedProjectRevision,
          title: 'Changed',
        },
        project,
      );
    assert.throws(() => update(f.project, 1), status(409));
    assert.throws(() => update(f.project, 0, 1), status(409));
    const edited = f.projects.writeFile(
      'alice',
      f.project.id,
      PAGE_FILE,
      f.project.files[PAGE_FILE],
      false,
      0,
    );
    assert.throws(() => update(edited), status(409));
    f.projects.claimRun('alice', edited.id);
    assert.throws(() => update(f.projects.get('alice', edited.id), 0, 1), status(409));
    const crossWorkspace = f.projects.createPage('alice', f.other, {
      name: 'Other',
      instruction: 'Build',
      surface: 'home',
      fromCurrent: false,
    });
    assert.throws(() => update(crossWorkspace), status(404));
    const input = { expectedRevision: 0, expectedProjectRevision: 0, title: 'Changed' };
    assert.throws(
      () => f.pages.updateFromProject('alice', f.other, f.page.id, input, f.project),
      status(404),
    );
    assert.throws(
      () => f.pages.updateFromProject('bob', f.bob, f.page.id, input, f.project),
      status(404),
    );
    assert.throws(
      () => f.pages.updateFromProject('bob', f.alice, f.page.id, input, f.project),
      status(404),
    );
    assert.deepEqual(f.pages.get('alice', f.alice, f.page.id), f.page);
  } finally {
    f.store.close();
  }
});

test('invalid declarations, changed surfaces, references and duplicate provenance roll back page updates', () => {
  const f = fixture();
  try {
    const update = (content: string) => {
      const project = f.projects.get('alice', f.project.id);
      const edited = f.projects.writeFile(
        'alice',
        project.id,
        PAGE_FILE,
        content,
        false,
        project.revision,
      );
      return () =>
        f.pages.updateFromProject(
          'alice',
          f.alice,
          f.page.id,
          {
            expectedRevision: 0,
            expectedProjectRevision: edited.revision!,
            title: 'Changed',
          },
          edited,
        );
    };
    assert.throws(update('{'), status(400));
    assert.throws(
      update(
        JSON.stringify({
          format: 'meow.page',
          version: 1,
          name: 'Changed',
          composition: { ...f.composition, surface: 'wiki' },
        }),
      ),
      status(400),
    );
    assert.throws(
      update(
        JSON.stringify({
          format: 'meow.page',
          version: 1,
          name: 'Changed',
          composition: {
            ...f.composition,
            instances: [
              {
                id: 'missing-component',
                viewId: 'component.render',
                visible: true,
                layer: 'content',
                x: 0,
                y: 0,
                w: 6,
                h: 4,
                config: { componentId: 'missing' },
                style: {},
              },
            ],
          },
        }),
      ),
      status(400),
    );
    assert.deepEqual(f.pages.get('alice', f.alice, f.page.id), f.page);
    const edited = f.projects.writeFile(
      'alice',
      f.project.id,
      PAGE_FILE,
      f.project.files[PAGE_FILE],
      false,
      f.projects.get('alice', f.project.id).revision,
    );
    f.pages.create('alice', f.alice, {
      title: 'Already saved',
      composition: f.composition,
      sourceProject: edited.id,
      sourceProjectRevision: edited.revision,
    });
    assert.throws(
      () =>
        f.pages.updateFromProject(
          'alice',
          f.alice,
          f.page.id,
          {
            expectedRevision: 0,
            expectedProjectRevision: edited.revision!,
            title: 'Changed',
          },
          edited,
        ),
      status(409),
    );
    assert.deepEqual(f.pages.get('alice', f.alice, f.page.id), f.page);
    assert.deepEqual(f.projects.get('alice', edited.id), edited);
  } finally {
    f.store.close();
  }
});

const status = (statusCode: number) => (error: unknown) =>
  !!error && (error as { statusCode: number }).statusCode === statusCode;

function fixture() {
  const store = new Store(':memory:');
  const alice = store.ensure('alice');
  const other = store.create('alice', 'Other');
  const bob = store.ensure('bob');
  const authorize = (owner: string, workspace: string) => {
    store.get(owner, workspace);
  };
  const compositions = new CompositionService(store.db, authorize);
  const projects = new WorkshopProjects(store.db, new ComponentService(store.db), compositions);
  const pages = new WorkshopCreatedPages(store.db, authorize, (owner, workspace, doc) =>
    compositions.validateReferences(owner, workspace, doc),
  );
  const project = projects.createPage('alice', alice, {
    name: 'Source',
    instruction: 'Build page',
    surface: 'home',
    fromCurrent: false,
  });
  const composition = JSON.parse(project.files[PAGE_FILE]).composition;
  const page = pages.create('alice', alice, {
    title: 'Original',
    composition,
    sourceProject: project.id,
    sourceProjectRevision: 0,
  });
  return { store, alice, other, bob, compositions, projects, pages, project, page, composition };
}

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

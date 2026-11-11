import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { ContentRepository } from '../src/infrastructure/sqlite/content-repository.ts';
import { updatePages, PageRuleError } from '../src/modules/pages/domain.ts';
import type { Page } from '../src/modules/pages/domain.ts';
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(directory, entry.name))
      : /\.[cm]?[jt]sx?$/.test(entry.name)
        ? [resolve(directory, entry.name)]
        : [],
  );
}
function imports(file: string) {
  return [...readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );
}
test('browser features depend on shared contracts, never server internals or app assembly', () => {
  for (const file of files('web'))
    for (const specifier of imports(file)) {
      assert.ok(!specifier.startsWith('node:'), `Node builtin in browser: ${file}`);
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      const source = relative(resolve('web'), file).replaceAll('\\', '/');
      const destination = relative(resolve('web'), target).replaceAll('\\', '/');
      assert.ok(
        !destination.startsWith('../'),
        `Browser import escapes boundary: ${source} -> ${specifier}`,
      );
      if (source.startsWith('features/')) {
        assert.ok(!destination.startsWith('app/'), `Feature imports assembly: ${source}`);
        const own = source.split('/')[1];
        assert.ok(
          !destination.startsWith('features/') || destination.split('/')[1] === own,
          `Cross-feature import: ${source} -> ${destination}`,
        );
      }
      if (source.startsWith('shared/'))
        assert.ok(
          destination.startsWith('shared/'),
          `Shared imports a feature/app: ${source} -> ${destination}`,
        );
    }
});
test('application services do not depend on HTTP framework or route handlers', () => {
  for (const file of files('src')) {
    if (!file.endsWith('service.ts')) continue;
    for (const specifier of imports(file))
      assert.ok(
        !specifier.includes('fastify') &&
          !specifier.includes('/http') &&
          !specifier.includes('routes'),
        `${file} depends on HTTP ${specifier}`,
      );
  }
});

test('Store delegates SQL and page rules to concrete infrastructure and a pure domain', () => {
  const store = readFileSync('src/store.ts', 'utf8');
  assert.ok(
    !/\.prepare\s*\(|\.exec\s*\(|node:sqlite|CREATE TABLE|INSERT INTO|UPDATE pages/.test(store),
  );
  assert.match(store, /ContentRepository/);
  assert.match(store, /updatePages\(/);
  for (const specifier of imports('src/modules/pages/domain.ts')) {
    assert.fail(`Page domain must not depend on infrastructure or HTTP: ${specifier}`);
  }
  const domain = readFileSync('src/modules/pages/domain.ts', 'utf8');
  assert.ok(!/Date\(|Date\.now|randomUUID|statusCode|DatabaseSync|fetch\(/.test(domain));
  for (const specifier of imports('src/infrastructure/sqlite/content-repository.ts')) {
    assert.ok(
      !specifier.includes('store') && !specifier.includes('http') && !specifier.includes('fastify'),
    );
  }
});

const domainPage = (id: string, parentId: string | null = null): Page => ({
  id,
  parentId,
  title: id,
  markdown: '',
  revision: 1,
  deletedAt: null,
  updatedAt: 'before',
});

test('page domain is deterministic, rejects invalid trees, and never mutates its input', () => {
  const input = [domainPage('root'), domainPage('child', 'root'), domainPage('leaf', 'child')];
  const original = structuredClone(input);
  input.forEach(Object.freeze);
  Object.freeze(input);
  const result = updatePages(input, 'root', 1, {}, 'delete', 'after');
  assert.deepEqual(input, original);
  assert.deepEqual(
    result.pages.map((p) => [p.id, p.revision, p.parentId, p.deletedAt]),
    [
      ['root', 2, null, 'after'],
      ['child', 2, null, null],
      ['leaf', 1, 'child', null],
    ],
  );
  assert.deepEqual(updatePages(input, 'root', 1, {}, 'delete', 'after'), result);
  for (const parentId of ['root', 'leaf'])
    assert.throws(() => updatePages(input, 'root', 1, { parentId }, 'update', 'after'), /循环/);
  assert.throws(
    () => updatePages(input, 'root', 1, { parentId: 'foreign' }, 'update', 'after'),
    PageRuleError,
  );
  assert.throws(() => updatePages(result.pages, 'child', 1, {}, 'update', 'after'), /页面已被更新/);
  assert.throws(() => updatePages(result.pages, 'root', 2, {}, 'update', 'after'), /已删除/);
  const restored = updatePages(result.pages, 'root', 2, {}, 'undelete', 'later');
  assert.equal(restored.page.parentId, null);
  assert.equal(restored.page.deletedAt, null);
  assert.equal(restored.page.revision, 3);
  assert.deepEqual(input, original);
});

test('repository migration preserves raw legacy JSON and rollback includes revisions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meow-repository-'));
  const path = join(directory, 'content.sqlite');
  const legacy = new DatabaseSync(path);
  const oldPage = { ...domainPage('old'), revision: 7, custom: { retained: true } };
  const raw = JSON.stringify(
    { id: 'space', pages: [oldPage], extra: { untouched: true } },
    null,
    2,
  );
  legacy.exec(
    'CREATE TABLE workspaces(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL)',
  );
  legacy.prepare('INSERT INTO workspaces VALUES(?,?,?)').run('space', 'owner', raw);
  legacy.close();
  let repository: ContentRepository | undefined;
  try {
    repository = new ContentRepository(path);
    assert.equal(repository.workspaceData('owner', 'space'), raw);
    assert.equal(repository.workspaceData('foreign', 'space'), undefined);
    assert.deepEqual(repository.pages('space'), [oldPage]);
    assert.deepEqual(repository.history('old'), [
      { ...oldPage, actorId: 'owner', operation: 'migration' },
    ]);
    repository.begin();
    repository.updatePage(
      'space',
      'editor',
      { ...oldPage, revision: 8, markdown: 'rollback' },
      'update',
    );
    repository.insertPage('space', 'editor', domainPage('new'), 'create');
    repository.updateWorkspace('space', 'owner', '{}');
    repository.rollback();
    assert.equal(repository.workspaceData('owner', 'space'), raw);
    assert.deepEqual(repository.pages('space'), [oldPage]);
    assert.equal(repository.history('old').length, 1);
    assert.deepEqual(repository.history('new'), []);
    repository.close();
    repository = undefined;
    repository = new ContentRepository(path);
    assert.deepEqual(repository.pages('space'), [oldPage]);
    assert.equal(repository.history('old').length, 1);
    assert.equal(repository.workspaceData('owner', 'space'), raw);
  } finally {
    repository?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

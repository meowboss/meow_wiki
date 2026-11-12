import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageRows } from '../web/features/wiki/space-tree.ts';
import type { WikiPage } from '../web/shared/api.ts';
const page = (id: string, parentId: string | null = null): WikiPage => ({
  id,
  parentId,
  title: id,
  markdown: '',
  revision: 1,
  updatedAt: '2026-11-12',
  deletedAt: null,
});
test('space tree preserves orphan and cyclic components without mutating input or losing notes', () => {
  const pages = [
    page('parent'),
    page('child', 'parent'),
    page('orphan', 'missing'),
    page('a', 'b'),
    page('b', 'a'),
    page('self', 'self'),
  ];
  const before = structuredClone(pages);
  const rows = pageRows(pages);
  assert.deepEqual(pages, before);
  assert.equal(rows.length, 6);
  assert.equal(new Set(rows.map((r) => r.page.id)).size, 6);
  assert.equal(rows.find((r) => r.page.id === 'child')?.depth, 1);
});
test('navigation stays extracted and composition root does not regrow inline menu or recycle markup', () => {
  const app = readFileSync('web/app/App.tsx', 'utf8');
  assert.match(app, /<PrimaryNavigation /);
  assert.ok(!app.includes('<nav className="main-nav"'));
  assert.ok(!app.includes('回收站 ·'));
  for (const file of [
    'web/app/navigation/PrimaryNavigation.tsx',
    'web/features/wiki/SpaceNavigator.tsx',
    'web/features/wiki/SpaceManagement.tsx',
  ])
    assert.ok(
      readFileSync(file, 'utf8').split('\n').length <= 330,
      `${file} exceeds reviewed navigation module budget; split responsibilities before raising budget`,
    );
});

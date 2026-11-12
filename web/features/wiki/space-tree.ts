import type { WikiPage } from '../../shared/api';

export type SpaceTreeRow = { page: WikiPage; depth: number };
const MAX_DEPTH = 8;

/** Stable preorder, including orphaned and cyclic components once each. */
export function pageRows(pages: WikiPage[]): SpaceTreeRow[] {
  const unique = new Map(pages.map((page) => [page.id, page]));
  const children = new Map<string, WikiPage[]>();
  const roots: WikiPage[] = [];
  for (const page of unique.values()) {
    if (!page.parentId || !unique.has(page.parentId)) roots.push(page);
    else {
      const siblings = children.get(page.parentId) ?? [];
      siblings.push(page);
      children.set(page.parentId, siblings);
    }
  }
  const visited = new Set<string>();
  const rows: SpaceTreeRow[] = [];
  const visit = (root: WikiPage) => {
    const stack = [{ page: root, depth: 0 }];
    while (stack.length) {
      const row = stack.pop()!;
      if (visited.has(row.page.id)) continue;
      visited.add(row.page.id);
      rows.push(row);
      const descendants = children.get(row.page.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index--) {
        stack.push({ page: descendants[index], depth: Math.min(row.depth + 1, MAX_DEPTH) });
      }
    }
  };
  roots.forEach(visit);
  unique.forEach((page) => {
    if (!visited.has(page.id)) visit(page);
  });
  return rows;
}

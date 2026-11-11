export type Page = {
  id: string;
  title: string;
  markdown: string;
  updatedAt: string;
  revision: number;
  deletedAt: string | null;
  parentId: string | null;
};
export type PageRevision = Page & { actorId: string; operation: string };
export type PagePatch = Partial<Pick<Page, 'title' | 'markdown' | 'parentId'>>;
export type PageAction = 'update' | 'delete' | 'undelete';

/** Domain failures have no persistence or transport dependency. */
export class PageRuleError extends Error {
  constructor(
    readonly kind: 'conflict' | 'missing',
    message: string,
  ) {
    super(message);
  }
}

/** Return a new page snapshot; callers own time, persistence and transaction boundaries. */
export function updatePages(
  pages: readonly Page[],
  pageId: string,
  expectedRevision: number,
  patch: PagePatch,
  action: PageAction,
  updatedAt: string,
): { pages: Page[]; page: Page } {
  const current = pages.find((page) => page.id === pageId);
  if (!current) throw new PageRuleError('missing', '未找到页面');
  if (current.revision !== expectedRevision)
    throw new PageRuleError('conflict', '页面已被更新，请保留本地内容并重新加载最新版本');
  if (action !== 'undelete' && current.deletedAt)
    throw new PageRuleError('conflict', '页面已删除，请先恢复');
  if (action === 'undelete' && !current.deletedAt)
    throw new PageRuleError('conflict', '页面未被删除');
  if (patch.parentId) {
    let next: string | null = patch.parentId;
    const visited = new Set([current.id]);
    while (next) {
      if (visited.has(next)) throw new PageRuleError('conflict', '页面树不能形成循环');
      visited.add(next);
      const parent = pages.find((page) => page.id === next && !page.deletedAt);
      if (!parent) throw new PageRuleError('missing', '未找到父页面');
      next = parent.parentId;
    }
  }
  const page: Page = { ...current, ...patch, revision: current.revision + 1, updatedAt };
  if (action === 'delete') page.deletedAt = updatedAt;
  if (action === 'undelete') {
    page.deletedAt = null;
    page.parentId = null;
  }
  return {
    page,
    pages: pages.map((existing) => {
      if (existing.id === page.id) return page;
      // Detaching live children is a versioned edit, not an untracked tree rewrite.
      if (action === 'delete' && existing.parentId === page.id && !existing.deletedAt)
        return { ...existing, parentId: null, revision: existing.revision + 1, updatedAt };
      return existing;
    }),
  };
}

export function revisionOperation(previous: Page, next: Page): 'delete' | 'undelete' | 'update' {
  return !previous.deletedAt && next.deletedAt
    ? 'delete'
    : previous.deletedAt && !next.deletedAt
      ? 'undelete'
      : 'update';
}

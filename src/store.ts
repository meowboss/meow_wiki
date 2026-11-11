import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Page = { id: string; title: string; markdown: string; updatedAt: string; revision: number; deletedAt: string | null; parentId: string | null };
export type PageRevision = Page & { actorId: string; operation: string };
export class ConflictError extends Error { statusCode = 409; }
export type Component = { id: string; name: string; description: string; template: string; status: 'private' | 'pending' | 'published' | 'rejected'; authorId: string };
export type Workspace = { id: string; name: string; description: string; pages: Page[]; enabled: string[]; components: Component[] };
export class AccessError extends Error { statusCode = 404; }
export class Store {
  readonly db: DatabaseSync;
  constructor(path = '.data/meow.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS catalog (id TEXT PRIMARY KEY, data TEXT NOT NULL);');
    this.migrate();
  }
  private migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pages_workspace ON pages(workspace_id);
      CREATE TABLE IF NOT EXISTS page_revisions (page_id TEXT NOT NULL REFERENCES pages(id), revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(page_id, revision));`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Check under the write lock: another Store may have completed migration
      // while this connection waited for BEGIN IMMEDIATE.
      if (this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()) {
        this.db.exec('COMMIT');
        return;
      }
      for (const row of this.db.prepare('SELECT id, owner, data FROM workspaces').all()) {
        const workspace = JSON.parse(String(row.data));
        for (const old of workspace.pages ?? []) {
          const page: Page = { ...old, revision: old.revision ?? 1, deletedAt: old.deletedAt ?? null, parentId: old.parentId ?? null };
          this.insertPage(String(row.id), String(row.owner), page, 'migration');
        }
      }
      this.db.prepare('INSERT INTO schema_migrations VALUES (1, ?)').run(new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private insertPage(workspaceId: string, actorId: string, page: Page, operation: string) {
    this.db.prepare('INSERT INTO pages VALUES (?, ?, ?)').run(page.id, workspaceId, JSON.stringify(page));
    this.recordRevision(actorId, page, operation);
  }
  private recordRevision(actorId: string, page: Page, operation: string) {
    this.db.prepare('INSERT INTO page_revisions VALUES (?, ?, ?)').run(page.id, page.revision, JSON.stringify({ ...page, actorId, operation }));
  }
  list(owner: string) {
    return this.db.prepare('SELECT id FROM workspaces WHERE owner=? ORDER BY rowid').all(owner).map(row => {
      const w = this.get(owner, String(row.id));
      return { id: w.id, name: w.name, description: w.description };
    });
  }
  create(owner: string, name: string, description = '') {
    if (this.list(owner).length >= 20) throw new ConflictError('每位用户最多创建20个空间');
    return this.seed(owner, name, description);
  }
  ensure(owner: string): string {
    const found = this.db.prepare('SELECT id FROM workspaces WHERE owner = ?').get(owner);
    if (found) return String(found.id);
    return this.seed(owner, '我的喵喵知识花园', '让每一个好奇，都长成自己的知识。');
  }
  private seed(owner: string, name: string, description: string): string {
    const id = randomUUID();
    const workspace: Workspace = {
      id, name, description,
      enabled: ['official.markdown', 'official.search', 'official.llm-wiki'], components: [],
      pages: [
        { id: randomUUID(), revision: 1, deletedAt: null, parentId: null, title: '欢迎来到 Meow Wiki', updatedAt: new Date().toISOString(), markdown: '# 让知识，长成你的样子\n\n这里是你的专属 Wiki，也是一个可以不断生长的知识花园。\n\n## 从一个小小的想法开始\n\n- **写下来**：用 Markdown 记录想法与灵感\n- **连接起来**：用检索找到散落的线索\n- **自由生长**：启用插件，定制属于自己的知识空间\n\n> 一切皆插件，但信任与数据边界属于内核。\n\n## 诚实的 AI\n\nLLM Wiki 目前提供本地检索摘录，不会把模板回答伪装成模型生成。真正的模型接入会在密钥管理、权限控制和引用验证准备好之后开放。' },
        { id: randomUUID(), revision: 1, deletedAt: null, parentId: null, title: '插件与自己的组件', updatedAt: new Date().toISOString(), markdown: '# 小组件，大可能\n\n官方的 Markdown、检索和问答都通过插件提供。你可以在插件市场启停它们。\n\n## 你的组件，默认只属于你\n\n第一版支持纯文本声明式组件，不执行 JavaScript，不读取文件，不联网。你可以写一个读书卡片或每日灵感模板，保存在自己的空间。\n\n提交审核不等于发布。只有官方审核通过的版本，才会进入公共市场。当前审核流程为后端受信服务接口，还没有公开审核控制台。' },
      ],
    };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO workspaces VALUES (?, ?, ?)').run(id, owner, JSON.stringify({ ...workspace, pages: [] }));
      for (const page of workspace.pages) this.insertPage(id, owner, page, 'create');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return id;
  }
  get(owner: string, id: string): Workspace {
    const row = this.db.prepare('SELECT data FROM workspaces WHERE id = ? AND owner = ?').get(id, owner);
    if (!row) throw new AccessError('未找到此 Wiki');
    const workspace: Workspace = JSON.parse(String(row.data));
    workspace.pages = this.db.prepare('SELECT data FROM pages WHERE workspace_id=? ORDER BY rowid').all(id).map(p => JSON.parse(String(p.data)));
    return workspace;
  }
  change<T>(owner: string, id: string, mutate: (workspace: Workspace) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const workspace = this.get(owner, id);
      const before = new Map(workspace.pages.map(page => [page.id, JSON.stringify(page)]));
      const result = mutate(workspace);
      if (workspace.id !== id) throw new ConflictError('不能改写空间标识');
      const pageIds = new Set(workspace.pages.map(page => page.id));
      if (pageIds.size !== workspace.pages.length || [...before.keys()].some(pageId => !pageIds.has(pageId))) {
        throw new ConflictError('不能移除或重复页面，请使用软删除');
      }
      for (const page of workspace.pages) {
        const previous = before.get(page.id);
        if (!previous) {
          if (page.revision !== 1) throw new ConflictError('新页面版本必须为1');
          this.insertPage(id, owner, page, 'create');
        } else if (previous !== JSON.stringify(page)) {
          const old: Page = JSON.parse(previous);
          // A workspace callback must not silently rewrite page content at an
          // existing revision (or replay a stale full-workspace snapshot).
          if (!Number.isSafeInteger(page.revision) || page.revision !== old.revision + 1) {
            throw new ConflictError('页面修改必须递增一个版本');
          }
          this.db.prepare('UPDATE pages SET data=? WHERE id=? AND workspace_id=?').run(JSON.stringify(page), page.id, id);
          this.recordRevision(owner, page, !old.deletedAt && page.deletedAt ? 'delete' : old.deletedAt && !page.deletedAt ? 'undelete' : 'update');
        }
      }
      this.db.prepare('UPDATE workspaces SET data = ? WHERE id = ? AND owner = ?').run(JSON.stringify({ ...workspace, pages: [] }), id, owner);
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  history(owner: string, workspaceId: string, pageId: string): PageRevision[] {
    if (!this.get(owner, workspaceId).pages.some(p => p.id === pageId)) throw new AccessError('未找到页面');
    return this.db.prepare('SELECT data FROM page_revisions WHERE page_id=? ORDER BY revision DESC').all(pageId).map(r => JSON.parse(String(r.data)));
  }
  updatePage(owner: string, workspaceId: string, pageId: string, expectedRevision: number, patch: Partial<Pick<Page, 'title' | 'markdown' | 'parentId'>>, action: 'update' | 'delete' | 'undelete' = 'update') {
    return this.change(owner, workspaceId, workspace => {
      const page = workspace.pages.find(p => p.id === pageId);
      if (!page) throw new AccessError('未找到页面');
      if (page.revision !== expectedRevision) throw new ConflictError('页面已被更新，请保留本地内容并重新加载最新版本');
      if (action !== 'undelete' && page.deletedAt) throw new ConflictError('页面已删除，请先恢复');
      if (action === 'undelete' && !page.deletedAt) throw new ConflictError('页面未被删除');
      if (patch.parentId) {
        let next: string | null = patch.parentId;
        const visited = new Set([page.id]);
        while (next) {
          if (visited.has(next)) throw new ConflictError('页面树不能形成循环');
          visited.add(next);
          const parent: Page | undefined = workspace.pages.find(p => p.id === next && !p.deletedAt);
          if (!parent) throw new AccessError('未找到父页面');
          next = parent.parentId;
        }
      }
      Object.assign(page, patch, { revision: page.revision + 1, updatedAt: new Date().toISOString() });
      if (action === 'delete') {
        page.deletedAt = page.updatedAt;
        // Keep live descendants reachable. Detaching is itself a versioned
        // edit, so a child editor cannot silently overwrite the structural change.
        for (const child of workspace.pages.filter(p => p.parentId === page.id && !p.deletedAt)) {
          child.parentId = null;
          child.revision += 1;
          child.updatedAt = page.updatedAt;
        }
      }
      if (action === 'undelete') { page.deletedAt = null; page.parentId = null; }
      return page;
    });
  }
  restorePage(owner: string, workspaceId: string, pageId: string, revision: number, expectedRevision: number) {
    const historical = this.history(owner, workspaceId, pageId).find(r => r.revision === revision);
    if (!historical) throw new AccessError('未找到历史版本');
    return this.updatePage(owner, workspaceId, pageId, expectedRevision, { title: historical.title, markdown: historical.markdown });
  }
  marketplace(): Component[] {
    return this.db.prepare('SELECT data FROM catalog').all().map(row => JSON.parse(String(row.data)));
  }
  /** Trusted service call only. Never exposed as a public HTTP moderation shortcut. */
  review(owner: string, workspaceId: string, componentId: string, decision: 'published' | 'rejected') {
    return this.change(owner, workspaceId, workspace => {
      const component = workspace.components.find(c => c.id === componentId);
      if (!component || component.status !== 'pending') throw new AccessError('组件未处于待审核状态');
      component.status = decision;
      if (decision === 'published') this.db.prepare('INSERT INTO catalog VALUES (?, ?)').run(component.id, JSON.stringify(component));
      return component;
    });
  }
  close() { this.db.close(); }
}

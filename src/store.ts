import { randomUUID } from 'node:crypto';
import { ContentRepository } from './infrastructure/sqlite/content-repository.ts';
import { PageRuleError, revisionOperation, updatePages } from './modules/pages/domain.ts';
import type { Page, PageRevision } from './modules/pages/domain.ts';
export type { Page, PageRevision } from './modules/pages/domain.ts';
export class ConflictError extends Error {
  statusCode = 409;
}
export type Component = {
  id: string;
  name: string;
  description: string;
  template: string;
  status: 'private' | 'pending' | 'published' | 'rejected';
  authorId: string;
};
export type Workspace = {
  id: string;
  name: string;
  description: string;
  pages: Page[];
  enabled: string[];
  components: Component[];
};
export class AccessError extends Error {
  statusCode = 404;
}
export class Store {
  private readonly repository: ContentRepository;
  /** Compatibility handle for existing platform/backup integrations. */
  readonly db: ContentRepository['db'];
  constructor(path = '.data/meow.sqlite') {
    this.repository = new ContentRepository(path);
    this.db = this.repository.db;
  }
  list(owner: string) {
    return this.repository.workspaceIds(owner).map((id) => {
      const w = this.get(owner, id);
      return { id: w.id, name: w.name, description: w.description };
    });
  }
  create(owner: string, name: string, description = '') {
    if (this.list(owner).length >= 20) throw new ConflictError('每位用户最多创建20个空间');
    return this.seed(owner, name, description);
  }
  ensure(owner: string): string {
    const found = this.repository.firstWorkspaceId(owner);
    if (found) return found;
    return this.seed(owner, '我的喵喵知识花园', '让每一个好奇，都长成自己的知识。');
  }
  private seed(owner: string, name: string, description: string): string {
    const id = randomUUID();
    const workspace: Workspace = {
      id,
      name,
      description,
      enabled: ['official.markdown', 'official.search', 'official.llm-wiki'],
      components: [],
      pages: [
        {
          id: randomUUID(),
          revision: 1,
          deletedAt: null,
          parentId: null,
          title: '欢迎来到 Meow Wiki',
          updatedAt: new Date().toISOString(),
          markdown:
            '# 让知识，长成你的样子\n\n这里是你的专属 Wiki，也是一个可以不断生长的知识花园。\n\n## 从一个小小的想法开始\n\n- **写下来**：用 Markdown 记录想法与灵感\n- **连接起来**：用检索找到散落的线索\n- **自由生长**：启用插件，定制属于自己的知识空间\n\n> 一切皆插件，但信任与数据边界属于内核。\n\n## 诚实的 AI\n\nLLM Wiki 目前提供本地检索摘录，不会把模板回答伪装成模型生成。真正的模型接入会在密钥管理、权限控制和引用验证准备好之后开放。',
        },
        {
          id: randomUUID(),
          revision: 1,
          deletedAt: null,
          parentId: null,
          title: '插件与自己的组件',
          updatedAt: new Date().toISOString(),
          markdown:
            '# 小组件，大可能\n\n官方的 Markdown、检索和问答都通过插件提供。你可以在插件市场启停它们。\n\n## 你的组件，默认只属于你\n\n第一版支持纯文本声明式组件，不执行 JavaScript，不读取文件，不联网。你可以写一个读书卡片或每日灵感模板，保存在自己的空间。\n\n提交审核不等于发布。只有官方审核通过的版本，才会进入公共市场。当前审核流程为后端受信服务接口，还没有公开审核控制台。',
        },
      ],
    };
    this.repository.begin();
    try {
      this.repository.insertWorkspace(id, owner, JSON.stringify({ ...workspace, pages: [] }));
      for (const page of workspace.pages) this.repository.insertPage(id, owner, page, 'create');
      this.repository.commit();
    } catch (error) {
      this.repository.rollback();
      throw error;
    }
    return id;
  }
  get(owner: string, id: string): Workspace {
    const data = this.repository.workspaceData(owner, id);
    if (data === undefined) throw new AccessError('未找到此 Wiki');
    const workspace: Workspace = JSON.parse(data);
    workspace.pages = this.repository.pages(id);
    return workspace;
  }
  change<T>(owner: string, id: string, mutate: (workspace: Workspace) => T): T {
    this.repository.begin();
    try {
      const workspace = this.get(owner, id);
      const before = new Map(workspace.pages.map((page) => [page.id, JSON.stringify(page)]));
      const result = mutate(workspace);
      if (workspace.id !== id) throw new ConflictError('不能改写空间标识');
      const pageIds = new Set(workspace.pages.map((page) => page.id));
      if (
        pageIds.size !== workspace.pages.length ||
        [...before.keys()].some((pageId) => !pageIds.has(pageId))
      ) {
        throw new ConflictError('不能移除或重复页面，请使用软删除');
      }
      for (const page of workspace.pages) {
        const previous = before.get(page.id);
        if (!previous) {
          if (page.revision !== 1) throw new ConflictError('新页面版本必须为1');
          this.repository.insertPage(id, owner, page, 'create');
        } else if (previous !== JSON.stringify(page)) {
          const old: Page = JSON.parse(previous);
          // A workspace callback must not silently rewrite page content at an
          // existing revision (or replay a stale full-workspace snapshot).
          if (!Number.isSafeInteger(page.revision) || page.revision !== old.revision + 1) {
            throw new ConflictError('页面修改必须递增一个版本');
          }
          this.repository.updatePage(id, owner, page, revisionOperation(old, page));
        }
      }
      this.repository.updateWorkspace(id, owner, JSON.stringify({ ...workspace, pages: [] }));
      this.repository.commit();
      return result;
    } catch (error) {
      this.repository.rollback();
      throw error;
    }
  }
  history(owner: string, workspaceId: string, pageId: string): PageRevision[] {
    if (!this.get(owner, workspaceId).pages.some((p) => p.id === pageId))
      throw new AccessError('未找到页面');
    return this.repository.history(pageId);
  }
  updatePage(
    owner: string,
    workspaceId: string,
    pageId: string,
    expectedRevision: number,
    patch: Partial<Pick<Page, 'title' | 'markdown' | 'parentId'>>,
    action: 'update' | 'delete' | 'undelete' = 'update',
  ) {
    return this.change(owner, workspaceId, (workspace) => {
      try {
        const result = updatePages(
          workspace.pages,
          pageId,
          expectedRevision,
          patch,
          action,
          new Date().toISOString(),
        );
        workspace.pages = result.pages;
        return result.page;
      } catch (error) {
        if (error instanceof PageRuleError) {
          if (error.kind === 'missing') throw new AccessError(error.message);
          throw new ConflictError(error.message);
        }
        throw error;
      }
    });
  }
  restorePage(
    owner: string,
    workspaceId: string,
    pageId: string,
    revision: number,
    expectedRevision: number,
  ) {
    const historical = this.history(owner, workspaceId, pageId).find(
      (r) => r.revision === revision,
    );
    if (!historical) throw new AccessError('未找到历史版本');
    return this.updatePage(owner, workspaceId, pageId, expectedRevision, {
      title: historical.title,
      markdown: historical.markdown,
    });
  }
  marketplace(): Component[] {
    return this.repository.catalogData().map((data) => JSON.parse(data));
  }
  /** Trusted service call only. Never exposed as a public HTTP moderation shortcut. */
  review(
    owner: string,
    workspaceId: string,
    componentId: string,
    decision: 'published' | 'rejected',
  ) {
    return this.change(owner, workspaceId, (workspace) => {
      const component = workspace.components.find((c) => c.id === componentId);
      if (!component || component.status !== 'pending')
        throw new AccessError('组件未处于待审核状态');
      component.status = decision;
      if (decision === 'published')
        this.repository.insertCatalog(component.id, JSON.stringify(component));
      return component;
    });
  }
  close() {
    this.repository.close();
  }
}

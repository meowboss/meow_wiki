import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Page = { id: string; title: string; markdown: string; updatedAt: string };
export type Component = { id: string; name: string; description: string; template: string; status: 'private' | 'pending' | 'published' | 'rejected'; authorId: string };
export type Workspace = { id: string; name: string; description: string; pages: Page[]; enabled: string[]; components: Component[] };
export class AccessError extends Error { statusCode = 404; }
export class Store {
  readonly db: DatabaseSync;
  constructor(path = '.data/meow.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS catalog (id TEXT PRIMARY KEY, data TEXT NOT NULL);');
  }
  ensure(owner: string): string {
    const found = this.db.prepare('SELECT id FROM workspaces WHERE owner = ?').get(owner);
    if (found) return String(found.id);
    const id = randomUUID();
    const workspace: Workspace = {
      id, name: '我的喵喵知识花园', description: '让每一个好奇，都长成自己的知识。',
      enabled: ['official.markdown', 'official.search', 'official.llm-wiki'], components: [],
      pages: [
        { id: randomUUID(), title: '欢迎来到 Meow Wiki', updatedAt: new Date().toISOString(), markdown: '# 让知识，长成你的样子\n\n这里是你的专属 Wiki，也是一个可以不断生长的知识花园。\n\n## 从一个小小的想法开始\n\n- **写下来**：用 Markdown 记录想法与灵感\n- **连接起来**：用检索找到散落的线索\n- **自由生长**：启用插件，定制属于自己的知识空间\n\n> 一切皆插件，但信任与数据边界属于内核。\n\n## 诚实的 AI\n\nLLM Wiki 目前提供本地检索摘录，不会把模板回答伪装成模型生成。真正的模型接入会在密钥管理、权限控制和引用验证准备好之后开放。' },
        { id: randomUUID(), title: '插件与自己的组件', updatedAt: new Date().toISOString(), markdown: '# 小组件，大可能\n\n官方的 Markdown、检索和问答都通过插件提供。你可以在插件市场启停它们。\n\n## 你的组件，默认只属于你\n\n第一版支持纯文本声明式组件，不执行 JavaScript，不读取文件，不联网。你可以写一个读书卡片或每日灵感模板，保存在自己的空间。\n\n提交审核不等于发布。只有官方审核通过的版本，才会进入公共市场。当前审核流程为后端受信服务接口，还没有公开审核控制台。' },
      ],
    };
    this.db.prepare('INSERT INTO workspaces VALUES (?, ?, ?)').run(id, owner, JSON.stringify(workspace));
    return id;
  }
  get(owner: string, id: string): Workspace {
    const row = this.db.prepare('SELECT data FROM workspaces WHERE id = ? AND owner = ?').get(id, owner);
    if (!row) throw new AccessError('未找到此 Wiki');
    return JSON.parse(String(row.data));
  }
  change<T>(owner: string, id: string, mutate: (workspace: Workspace) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const workspace = this.get(owner, id);
      const result = mutate(workspace);
      this.db.prepare('UPDATE workspaces SET data = ? WHERE id = ? AND owner = ?').run(JSON.stringify(workspace), id, owner);
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
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

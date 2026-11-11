import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Store } from './store.ts';
import { KnowledgeService } from './knowledge.ts';
import { z } from 'zod';
const inputSchema = z.object({ pageId: z.string().uuid(), expectedRevision: z.number().int().positive(), title: z.string().trim().min(1).max(160), markdown: z.string().min(1).max(200_000), evidence: z.array(z.object({ sourceId: z.string().uuid(), revision: z.number().int().positive(), chunkId: z.string().uuid() }).strict()).min(1).max(8) }).strict();
export class ProposalError extends Error { constructor(message: string, public statusCode: number) { super(message); } }
export class Proposals {
  constructor(private db: DatabaseSync, private store: Store, private knowledge: KnowledgeService) {
    db.exec(`CREATE TABLE IF NOT EXISTS mw_proposals(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')));`);
  }
  private validate(owner: string, workspaceId: string, input: z.infer<typeof inputSchema>) {
    const page = this.store.get(owner, workspaceId).pages.find(p => p.id === input.pageId && !p.deletedAt);
    if (!page) throw new ProposalError('未找到目标页面', 404);
    if (page.revision !== input.expectedRevision) throw new ProposalError('目标页面版本已变更，提议未应用', 409);
    for (const ref of input.evidence) {
      const source = this.knowledge.detail(owner, workspaceId, ref.sourceId);
      if (source.revision !== ref.revision || source.status !== 'ready') throw new ProposalError('证据已变更或尚未就绪', 409);
      if (!this.db.prepare('SELECT 1 FROM knowledge_chunks WHERE id=? AND workspace_id=? AND source_id=? AND revision=?').get(ref.chunkId, workspaceId, ref.sourceId, ref.revision)) throw new ProposalError('引用片段不可用', 409);
    }
  }
  create(owner: string, workspaceId: string, value: unknown) {
    const input = inputSchema.parse(value); this.validate(owner, workspaceId, input);
    const id = randomUUID(); const data = { id, ...input, createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO mw_proposals VALUES(?,?,?,?,?)').run(id, workspaceId, owner, JSON.stringify(data), 'pending');
    return { ...data, status: 'pending' };
  }
  list(owner: string, workspaceId: string) {
    this.store.get(owner, workspaceId);
    return this.db.prepare('SELECT data,status FROM mw_proposals WHERE owner=? AND workspace_id=? ORDER BY rowid DESC LIMIT 100').all(owner, workspaceId).map(row => ({ ...JSON.parse(String(row.data)), status: String(row.status) }));
  }
  decide(owner: string, workspaceId: string, id: string, decision: 'accept' | 'reject') {
    this.store.get(owner, workspaceId);
    const row = this.db.prepare('SELECT data,status FROM mw_proposals WHERE id=? AND owner=? AND workspace_id=?').get(id, owner, workspaceId);
    if (!row) throw new ProposalError('未找到提议', 404);
    if (row.status !== 'pending') throw new ProposalError('提议已经处理', 409);
    const input = inputSchema.parse((({ id: _id, createdAt: _time, ...content }) => content)(JSON.parse(String(row.data))));
    if (decision === 'reject') { this.db.prepare("UPDATE mw_proposals SET status='rejected' WHERE id=? AND status='pending'").run(id); return { status: 'rejected' }; }
    this.validate(owner, workspaceId, input);
    // Store.change owns the write transaction; page, revision and proposal status commit together.
    return this.store.change(owner, workspaceId, workspace => {
      this.validate(owner, workspaceId, input);
      const current = this.db.prepare('SELECT status FROM mw_proposals WHERE id=?').get(id);
      if (current?.status !== 'pending') throw new ProposalError('提议已经处理', 409);
      const page = workspace.pages.find(p => p.id === input.pageId)!;
      Object.assign(page, { title: input.title, markdown: input.markdown, revision: page.revision + 1, updatedAt: new Date().toISOString() });
      this.db.prepare("UPDATE mw_proposals SET status='accepted' WHERE id=?").run(id);
      return { status: 'accepted', page };
    });
  }
}

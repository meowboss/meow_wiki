import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Store } from './store.ts';
import { KnowledgeService } from './knowledge.ts';
import { z } from 'zod';
import { ProposalRepository } from './infrastructure/proposal-repository.ts';
const inputSchema = z
  .object({
    pageId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    markdown: z.string().min(1).max(200_000),
    evidence: z
      .array(
        z
          .object({
            sourceId: z.string().uuid(),
            revision: z.number().int().positive(),
            chunkId: z.string().uuid(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export class ProposalError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}
export class Proposals {
  private readonly repository: ProposalRepository;
  constructor(
    db: DatabaseSync,
    private store: Store,
    private knowledge: KnowledgeService,
  ) {
    this.repository = new ProposalRepository(db);
  }
  private validate(owner: string, workspaceId: string, input: z.infer<typeof inputSchema>) {
    const page = this.store
      .get(owner, workspaceId)
      .pages.find((p) => p.id === input.pageId && !p.deletedAt);
    if (!page) throw new ProposalError('未找到目标页面', 404);
    if (page.revision !== input.expectedRevision)
      throw new ProposalError('目标页面版本已变更，提议未应用', 409);
    for (const ref of input.evidence) {
      const source = this.knowledge.detail(owner, workspaceId, ref.sourceId);
      if (source.revision !== ref.revision || source.status !== 'ready')
        throw new ProposalError('证据已变更或尚未就绪', 409);
      if (!this.repository.evidenceExists(workspaceId, ref.sourceId, ref.revision, ref.chunkId))
        throw new ProposalError('引用片段不可用', 409);
    }
  }
  create(owner: string, workspaceId: string, value: unknown) {
    const input = inputSchema.parse(value);
    this.validate(owner, workspaceId, input);
    const id = randomUUID();
    const data = { id, ...input, createdAt: new Date().toISOString() };
    if (this.repository.count(owner) >= 200)
      throw new ProposalError('每个账号最多保留200条提议，请联系宿主管理归档', 409);
    this.repository.insert(owner, workspaceId, id, data);
    return { ...data, status: 'pending' };
  }
  list(owner: string, workspaceId: string) {
    this.store.get(owner, workspaceId);
    return this.repository
      .list(owner, workspaceId)
      .map((row) => ({ ...JSON.parse(String(row.data)), status: String(row.status) }));
  }
  decide(owner: string, workspaceId: string, id: string, decision: 'accept' | 'reject') {
    this.store.get(owner, workspaceId);
    const row = this.repository.get(owner, workspaceId, id);
    if (!row) throw new ProposalError('未找到提议', 404);
    if (row.status !== 'pending') throw new ProposalError('提议已经处理', 409);
    const input = inputSchema.parse(
      (({ id: _id, createdAt: _time, ...content }) => content)(JSON.parse(String(row.data))),
    );
    if (decision === 'reject') {
      if (!this.repository.transition(owner, workspaceId, id, 'rejected'))
        throw new ProposalError('提议已经处理', 409);
      return { status: 'rejected' };
    }
    this.validate(owner, workspaceId, input);
    // Store.change owns the write transaction; page, revision and proposal status commit together.
    return this.store.change(owner, workspaceId, (workspace) => {
      this.validate(owner, workspaceId, input);
      const current = this.repository.get(owner, workspaceId, id);
      if (current?.status !== 'pending') throw new ProposalError('提议已经处理', 409);
      const page = workspace.pages.find((p) => p.id === input.pageId)!;
      Object.assign(page, {
        title: input.title,
        markdown: input.markdown,
        revision: page.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      if (!this.repository.transition(owner, workspaceId, id, 'accepted'))
        throw new ProposalError('提议已经处理', 409);
      return { status: 'accepted', page };
    });
  }
}

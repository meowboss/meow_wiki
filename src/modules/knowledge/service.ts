import { z } from 'zod';
import type { KnowledgeService } from '../../knowledge.ts';
import type { ModelBroker } from '../../models.ts';
import type { Proposals } from '../../proposals.ts';
import type { Store } from '../../store.ts';

/** Knowledge use cases, independent of HTTP and explicitly composed by the host. */
export class KnowledgeApplication {
  constructor(
    private readonly store: Store,
    private readonly knowledge: KnowledgeService,
    private readonly proposals: Proposals,
    private readonly broker?: ModelBroker,
  ) {}

  list(owner: string, workspaceId: string) {
    return {
      sources: this.knowledge.list(owner, workspaceId),
      jobs: this.knowledge.listJobs(owner, workspaceId),
    };
  }

  create(owner: string, workspaceId: string, value: unknown) {
    const input = z
      .object({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(200_000) })
      .parse(value);
    return this.knowledge.create(owner, workspaceId, input);
  }

  detail(owner: string, workspaceId: string, id: string) {
    return this.knowledge.detail(owner, workspaceId, id);
  }

  update(owner: string, workspaceId: string, id: string, value: unknown) {
    const input = z
      .object({
        title: z.string().trim().min(1).max(200),
        content: z.string().min(1).max(200_000),
        expectedRevision: z.number().int().positive(),
      })
      .parse(value);
    return this.knowledge.update(owner, workspaceId, id, input);
  }

  remove(owner: string, workspaceId: string, id: string) {
    return this.knowledge.remove(owner, workspaceId, id);
  }

  process(owner: string, workspaceId: string, id: string) {
    return this.knowledge.run(owner, workspaceId, id);
  }

  modelStatus() {
    return this.broker?.status() ?? { configured: false, model: null };
  }

  async generate(owner: string, workspaceId: string, value: unknown) {
    if (!this.broker)
      throw Object.assign(new Error('宿主尚未配置模型，未生成提议'), { statusCode: 409 });
    const workspace = this.store.get(owner, workspaceId);
    if (
      !workspace.enabled.includes('official.llm-wiki') ||
      !workspace.enabled.includes('official.search')
    )
      throw Object.assign(new Error('请启用问答与检索插件'), { statusCode: 409 });
    const input = z
      .object({
        pageId: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
        question: z.string().trim().min(1).max(1000),
      })
      .parse(value);
    const page = workspace.pages.find((p) => p.id === input.pageId && !p.deletedAt);
    if (!page) throw Object.assign(new Error('未找到目标页'), { statusCode: 404 });
    if (page.revision !== input.expectedRevision)
      throw Object.assign(new Error('目标页版本已变更'), { statusCode: 409 });
    const sources = this.knowledge
      .search(owner, workspaceId, input.question)
      .map((s, i) => ({ ...s, label: `S${i + 1}` }));
    if (!sources.length)
      throw Object.assign(new Error('没有可引用资料，未调用模型'), { statusCode: 409 });
    const markdown = await this.broker.generate(
      `为Wiki页面“${page.title}”起草完整替换内容；只根据证据写作并保留来源编号。用户要求：${input.question}`,
      sources,
    );
    return this.proposals.create(owner, workspaceId, {
      pageId: page.id,
      expectedRevision: input.expectedRevision,
      title: page.title,
      markdown,
      evidence: sources.map(({ sourceId, revision, chunkId }) => ({
        sourceId,
        revision,
        chunkId,
      })),
    });
  }

  async ask(owner: string, workspaceId: string, value: unknown) {
    const workspace = this.store.get(owner, workspaceId);
    if (
      !workspace.enabled.includes('official.llm-wiki') ||
      !workspace.enabled.includes('official.search')
    )
      throw Object.assign(new Error('请先启用问答与检索插件'), { statusCode: 409 });
    const { question, mode } = z
      .object({
        question: z.string().trim().min(1).max(1000),
        mode: z.enum(['extractive', 'model']).default('extractive'),
      })
      .parse(value);
    const sources = this.knowledge
      .search(owner, workspaceId, question)
      .map((s, i) => ({ ...s, label: `S${i + 1}` }));
    if (mode === 'model') {
      if (!this.broker) throw Object.assign(new Error('宿主尚未配置模型'), { statusCode: 409 });
      if (!sources.length)
        return { mode: 'no-evidence', answer: '没有找到可引用来源，未调用模型。', sources };
      const answer = await this.broker.generate(question, sources);
      // A network wait can race source edits/deletion; do not return stale citations as current evidence.
      for (const source of sources) {
        const current = this.knowledge.detail(owner, workspaceId, source.sourceId);
        if (current.revision !== source.revision || current.status !== 'ready')
          throw Object.assign(new Error('回答期间来源发生变化，请重新提问'), { statusCode: 409 });
      }
      return { mode: 'model', answer, sources };
    }
    return {
      mode: 'local-extractive',
      answer: sources.length
        ? sources.map((s) => `[${s.label}] ${s.title}\n${s.excerpt}`).join('\n\n')
        : '没有匹配的就绪资料。请导入并处理来源，或换用资料中的关键词。',
      sources,
    };
  }
}

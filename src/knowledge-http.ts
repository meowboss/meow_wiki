import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { KnowledgeService } from './knowledge.ts';
import type { Store } from './store.ts';
import type { ModelBroker } from './models.ts';

/** Called by the host after its authentication hook is registered. */
export function registerKnowledge(app: FastifyInstance, store: Store, caller: (request: FastifyRequest) => string, broker?: ModelBroker) {
  const knowledge = new KnowledgeService(store.db);
  const scope = (request: FastifyRequest) => {
    const owner = caller(request);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.query);
    const workspace = store.get(owner, workspaceId ?? store.ensure(owner));
    return { owner, workspace };
  };
  app.get('/api/sources', async request => { const { owner, workspace } = scope(request); return { sources: knowledge.list(owner, workspace.id), jobs: knowledge.listJobs(owner, workspace.id) }; });
  app.post('/api/sources', async (request, reply) => {
    const { owner, workspace } = scope(request);
    const input = z.object({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(200_000) }).parse(request.body);
    return reply.code(201).send(knowledge.create(owner, workspace.id, input));
  });
  app.get<{ Params: { id: string } }>('/api/sources/:id', async request => { const { owner, workspace } = scope(request); return knowledge.detail(owner, workspace.id, request.params.id); });
  app.put<{ Params: { id: string } }>('/api/sources/:id', async request => {
    const { owner, workspace } = scope(request);
    const input = z.object({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(200_000), expectedRevision: z.number().int().positive() }).parse(request.body);
    return knowledge.update(owner, workspace.id, request.params.id, input);
  });
  app.delete<{ Params: { id: string } }>('/api/sources/:id', async request => { const { owner, workspace } = scope(request); return knowledge.remove(owner, workspace.id, request.params.id); });
  app.post<{ Params: { id: string } }>('/api/sources/:id/process', async request => { const { owner, workspace } = scope(request); return knowledge.run(owner, workspace.id, request.params.id); });
  app.get('/api/models/status', async request => { scope(request); return broker?.status() ?? { configured: false, model: null }; });
  app.post('/api/knowledge/ask', async request => {
    const { owner, workspace } = scope(request);
    if (!workspace.enabled.includes('official.llm-wiki') || !workspace.enabled.includes('official.search')) throw Object.assign(new Error('请先启用问答与检索插件'), { statusCode: 409 });
    const { question, mode } = z.object({ question: z.string().trim().min(1).max(1000), mode: z.enum(['extractive', 'model']).default('extractive') }).parse(request.body);
    const sources = knowledge.search(owner, workspace.id, question).map((s, i) => ({ ...s, label: `S${i + 1}` }));
    if (mode === 'model') {
      if (!broker) throw Object.assign(new Error('宿主尚未配置模型'), { statusCode: 409 });
      if (!sources.length) return { mode: 'no-evidence', answer: '没有找到可引用来源，未调用模型。', sources };
      const answer = await broker.generate(question, sources);
      // A network wait can race source edits/deletion; do not return stale citations as current evidence.
      for (const source of sources) {
        const current = knowledge.detail(owner, workspace.id, source.sourceId);
        if (current.revision !== source.revision || current.status !== 'ready') throw Object.assign(new Error('回答期间来源发生变化，请重新提问'), { statusCode: 409 });
      }
      return { mode: 'model', answer, sources };
    }
    return { mode: 'local-extractive', answer: sources.length ? sources.map(s => `[${s.label}] ${s.title}\n${s.excerpt}`).join('\n\n') : '没有匹配的就绪资料。请导入并处理来源，或换用资料中的关键词。', sources };
  });
}

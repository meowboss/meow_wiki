import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Workspace } from '../../store.ts';
import type { KnowledgeApplication } from './service.ts';

/** Shared authorization callback supplied by the composition factory, not a service container. */
export type KnowledgeScope = (request: FastifyRequest) => { owner: string; workspace: Workspace };

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  scope: KnowledgeScope,
  knowledge: KnowledgeApplication,
) {
  app.get('/api/sources', async (request) => {
    const { owner, workspace } = scope(request);
    return knowledge.list(owner, workspace.id);
  });
  app.post('/api/sources', async (request, reply) => {
    const { owner, workspace } = scope(request);
    return reply.code(201).send(knowledge.create(owner, workspace.id, request.body));
  });
  app.get<{ Params: { id: string } }>('/api/sources/:id', async (request) => {
    const { owner, workspace } = scope(request);
    return knowledge.detail(owner, workspace.id, request.params.id);
  });
  app.put<{ Params: { id: string } }>('/api/sources/:id', async (request) => {
    const { owner, workspace } = scope(request);
    return knowledge.update(owner, workspace.id, request.params.id, request.body);
  });
  app.delete<{ Params: { id: string } }>('/api/sources/:id', async (request) => {
    const { owner, workspace } = scope(request);
    return knowledge.remove(owner, workspace.id, request.params.id);
  });
  app.post<{ Params: { id: string } }>('/api/sources/:id/process', async (request) => {
    const { owner, workspace } = scope(request);
    return knowledge.process(owner, workspace.id, request.params.id);
  });
  app.get('/api/models/status', async (request) => {
    scope(request);
    return knowledge.modelStatus();
  });
  app.post('/api/knowledge/ask', async (request) => {
    const { owner, workspace } = scope(request);
    return knowledge.ask(owner, workspace.id, request.body);
  });
}

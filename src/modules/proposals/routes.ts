import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Proposals } from '../../proposals.ts';
import type { KnowledgeScope } from '../knowledge/routes.ts';
import type { KnowledgeApplication } from '../knowledge/service.ts';

export function registerProposalRoutes(
  app: FastifyInstance,
  scope: KnowledgeScope,
  proposals: Proposals,
  knowledge: KnowledgeApplication,
) {
  app.post('/api/proposals/generate', async (request, reply) => {
    const { owner, workspace } = scope(request);
    return reply.code(201).send(await knowledge.generate(owner, workspace.id, request.body));
  });
  app.get('/api/proposals', async (request) => {
    const { owner, workspace } = scope(request);
    return { proposals: proposals.list(owner, workspace.id) };
  });
  app.post('/api/proposals', async (request, reply) => {
    const { owner, workspace } = scope(request);
    return reply.code(201).send(proposals.create(owner, workspace.id, request.body));
  });
  app.post<{ Params: { id: string } }>('/api/proposals/:id/decide', async (request) => {
    const { owner, workspace } = scope(request);
    const { decision } = z.object({ decision: z.enum(['accept', 'reject']) }).parse(request.body);
    return proposals.decide(owner, workspace.id, request.params.id, decision);
  });
}

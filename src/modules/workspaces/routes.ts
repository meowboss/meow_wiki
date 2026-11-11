import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpContext } from '../../http/context.ts';
import type { WorkspacesService } from './service.ts';

const text = z.string().trim().min(1).max(160);

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  { caller, scope }: HttpContext,
  workspaces: WorkspacesService,
) {
  app.get('/api/workspaces', async (request) => ({ workspaces: workspaces.list(caller(request)) }));
  app.post('/api/workspaces', async (request, reply) => {
    const body = z
      .object({ name: text, description: z.string().max(500).default('') })
      .parse(request.body);
    const id = workspaces.create(caller(request), body.name, body.description);
    return reply.code(201).send({ id });
  });
  app.patch<{ Params: { id: string } }>('/api/workspaces/:id', async (request) => {
    const body = z.object({ name: text, description: z.string().max(500) }).parse(request.body);
    return workspaces.update(caller(request), request.params.id, body);
  });
  app.get('/api/workspace', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    return workspaces.snapshot(owner, w);
  });
}

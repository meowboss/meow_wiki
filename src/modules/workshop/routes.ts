import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpContext } from '../../http/context.ts';
import { ProviderVault } from './providers.ts';
import { WorkshopProjects } from './projects.ts';
import { WorkshopEngine } from './engine.ts';
import { ConversationStore } from './conversation.ts';
export type WorkshopOptions = {
  masterSecret: string;
  allowedEndpoints: Record<string, string>;
  fetcher?: typeof fetch;
};
export function registerWorkshop(
  app: FastifyInstance,
  context: HttpContext,
  options: WorkshopOptions,
) {
  const vault = new ProviderVault(context.store.db, options.masterSecret, options.allowedEndpoints);
  const projects = new WorkshopProjects(context.store.db, context.components);
  projects.recoverInterruptedRuns(); // Single-instance startup reconciliation, not a multi-replica lease.
  const conversation = new ConversationStore(context.store.db, projects);
  const engine = new WorkshopEngine(projects, vault, options.fetcher, conversation);
  app.get('/api/workshop/config', async () => ({
    endpoints: Object.keys(options.allowedEndpoints).map((id) => ({ id, label: id })),
    configured: Object.keys(options.allowedEndpoints).length > 0,
  }));
  app.get('/api/workshop/providers', async (request) => ({
    providers: vault.list(context.caller(request)),
  }));
  app.post('/api/workshop/providers', async (request, reply) =>
    reply.code(201).send(vault.save(context.caller(request), request.body as never)),
  );
  app.delete<{ Params: { id: string } }>('/api/workshop/providers/:id', async (request) => {
    vault.remove(context.caller(request), request.params.id);
    return { ok: true };
  });
  app.get('/api/workshop/projects', async (request) => ({
    projects: projects.list(context.caller(request), context.scope(request).id),
  }));
  app.post('/api/workshop/projects', async (request, reply) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(160),
        instruction: z.string().trim().min(1).max(3000),
      })
      .strict()
      .parse(request.body);
    return reply
      .code(201)
      .send(projects.create(context.caller(request), context.scope(request).id, input));
  });
  app.get<{ Params: { id: string } }>('/api/workshop/projects/:id', async (request) =>
    projects.get(context.caller(request), request.params.id),
  );
  app.put<{ Params: { id: string } }>('/api/workshop/projects/:id/file', async (request) => {
    const input = z
      .object({ path: z.literal('/project/component.json'), content: z.string().max(30000) })
      .strict()
      .parse(request.body);
    projects.writeFile(context.caller(request), request.params.id, input.path, input.content);
    return projects.get(context.caller(request), request.params.id);
  });
  app.post<{ Params: { id: string } }>('/api/workshop/projects/:id/validate', async (request) =>
    projects.validate(context.caller(request), request.params.id),
  );
  app.get<{ Params: { id: string } }>('/api/workshop/projects/:id/messages', async (request) => ({
    messages: conversation.list(context.caller(request), request.params.id),
  }));
  app.post<{ Params: { id: string } }>('/api/workshop/projects/:id/chat', async (request) => {
    const { providerId, message } = z
      .object({
        providerId: z.string().uuid(),
        message: z.string().trim().min(1).max(3000),
      })
      .strict()
      .parse(request.body);
    return engine.chat(context.caller(request), request.params.id, providerId, message);
  });
  app.post<{ Params: { id: string } }>('/api/workshop/projects/:id/run', async (request) => {
    const { providerId } = z.object({ providerId: z.string().uuid() }).strict().parse(request.body);
    return engine.run(context.caller(request), request.params.id, providerId);
  });
  app.post<{ Params: { id: string } }>('/api/workshop/projects/:id/cancel', async (request) =>
    engine.cancel(context.caller(request), request.params.id),
  );
  app.post<{ Params: { id: string } }>('/api/workshop/projects/:id/install', async (request) =>
    projects.install(context.caller(request), request.params.id),
  );
}

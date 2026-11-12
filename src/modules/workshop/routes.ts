import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpContext } from '../../http/context.ts';
import { ProviderVault } from './providers.ts';
import { CompositionService } from '../compositions/service.ts';
import { pageInput, revisionSchema } from './page-projects.ts';
import { WorkshopError, WorkshopProjects } from './projects.ts';
import { parsePage } from './page-projects.ts';
import { WorkshopEngine } from './engine.ts';
import { ConversationStore } from './conversation.ts';
import { WorkshopCreatedPages } from './created-pages.ts';
import { ProviderOperations } from './provider-operations.ts';
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
  const providerOperations = new ProviderOperations(vault);
  app.post('/api/workshop/providers/custom', async (request, reply) =>
    reply.code(201).send(vault.saveCustom(context.caller(request), request.body as never)),
  );
  app.put<{ Params: { id: string } }>('/api/workshop/providers/custom/:id', async (request) =>
    vault.updateCustom(context.caller(request), request.params.id, request.body as never),
  );
  app.post('/api/workshop/providers/custom/models', async (request) =>
    providerOperations.models(context.caller(request), request.body),
  );
  app.post('/api/workshop/providers/custom/test', async (request) =>
    providerOperations.test(context.caller(request), request.body),
  );
  const compositions = new CompositionService(context.store.db, (owner, workspace) => {
    context.store.get(owner, workspace);
  });
  const projects = new WorkshopProjects(context.store.db, context.components, compositions);
  const createdPages = new WorkshopCreatedPages(
    context.store.db,
    (owner, workspace) => context.store.get(owner, workspace),
    (owner, workspace, composition) =>
      compositions.validateReferences(owner, workspace, composition),
  );
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
  app.get('/api/workshop/pages', async (request) => {
    const workspaceId = context.scope(request).id;
    return { pages: createdPages.list(context.caller(request), workspaceId) };
  });
  app.get<{ Params: { id: string } }>('/api/workshop/pages/:id', async (request) => {
    const workspaceId = context.scope(request).id;
    const page = createdPages.get(context.caller(request), workspaceId, request.params.id);
    return {
      id: page.id,
      title: page.title,
      composition: page.composition,
      revision: page.revision,
      workspaceId: page.workspaceId,
    };
  });
  app.post<{ Params: { id: string } }>(
    '/api/workshop/projects/:id/create-page',
    async (request, reply) => {
      const input = z
        .strictObject({
          expectedProjectRevision: revisionSchema,
          title: z.string().trim().min(1).max(160),
        })
        .parse(request.body);
      const owner = context.caller(request);
      const project = projects.get(owner, request.params.id);
      if (
        project.workspaceId !== context.scope(request).id ||
        project.kind !== 'page' ||
        project.state === 'running'
      )
        throw new WorkshopError('Invalid workshop page project', 400);
      if (project.revision !== input.expectedProjectRevision)
        throw new WorkshopError('Project revision conflict', 409);
      const declaration = parsePage(project.files['/project/page.json']);
      const page = createdPages.create(owner, project.workspaceId, {
        title: input.title,
        composition: declaration.composition,
        sourceProject: project.id,
        sourceProjectRevision: input.expectedProjectRevision,
      });
      return reply.code(201).send({
        id: page.id,
        title: page.title,
        composition: page.composition,
        revision: page.revision,
        workspaceId: page.workspaceId,
      });
    },
  );
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
  app.post('/api/workshop/page-projects', async (request, reply) =>
    reply
      .code(201)
      .send(
        projects.createPage(
          context.caller(request),
          context.scope(request).id,
          pageInput.parse(request.body),
        ),
      ),
  );
  app.post<{ Params: { id: string } }>('/api/workshop/projects/:id/apply', async (request) => {
    const input = z.strictObject({ expectedProjectRevision: revisionSchema }).parse(request.body);
    return projects.apply(
      context.caller(request),
      request.params.id,
      input.expectedProjectRevision,
    );
  });
  app.get<{ Params: { id: string } }>('/api/workshop/projects/:id', async (request) =>
    projects.get(context.caller(request), request.params.id),
  );
  app.put<{ Params: { id: string } }>('/api/workshop/projects/:id/file', async (request) => {
    const input = z
      .object({
        path: z.enum(['/project/component.json', '/project/page.json']),
        content: z.string().max(30000),
        expectedRevision: revisionSchema.optional(),
      })
      .strict()
      .parse(request.body);
    projects.writeFile(
      context.caller(request),
      request.params.id,
      input.path,
      input.content,
      false,
      input.expectedRevision,
    );
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

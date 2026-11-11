import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ExtensionsService } from './service.ts';
import { componentSchema, layoutSchema } from '../../components.ts';
import type { HttpContext } from '../../http/context.ts';

export function registerExtensionRoutes(
  app: FastifyInstance,
  { components, caller, scope, requireAdmin }: HttpContext,
  extensions: ExtensionsService,
) {
  app.post<{ Params: { id: string } }>('/api/plugins/:id', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    return extensions.setEnabled(owner, w.id, request.params.id, enabled);
  });
  app.post('/api/components', async (request, reply) => {
    const w = scope(request);
    return reply.code(201).send(components.create(caller(request), w.id, request.body));
  });
  app.put<{ Params: { id: string } }>('/api/components/:id', async (request) => {
    const w = scope(request);
    const { expectedVersion, ...body } = componentSchema
      .extend({ expectedVersion: z.number().int().positive() })
      .parse(request.body);
    return components.update(caller(request), w.id, request.params.id, body, expectedVersion);
  });
  app.post<{ Params: { id: string } }>('/api/components/:id/submit', async (request) => {
    const w = scope(request);
    return components.submit(caller(request), w.id, request.params.id);
  });
  app.get('/api/components/releases', async (request) => {
    const w = scope(request);
    return { releases: components.releases(caller(request), w.id) };
  });
  app.get('/api/marketplace', async () => ({ releases: components.marketplace() }));
  app.get('/api/components/installed', async (request) => ({
    installed: components.installed(scope(request).id),
  }));
  app.post<{ Params: { id: string } }>('/api/marketplace/:id/install', async (request) =>
    components.install(scope(request).id, request.params.id),
  );
  app.get('/api/home', async (request) => components.home(caller(request), scope(request).id));
  app.put('/api/home', async (request) => {
    const w = scope(request);
    const revision = z.number().int().nonnegative();
    const body = z
      .union([
        layoutSchema.extend({ expectedRevision: revision }),
        z.object({ layout: layoutSchema, expectedRevision: revision }).strict(),
      ])
      .parse(request.body);
    const { expectedRevision, ...fields } = body;
    const layout = 'layout' in fields ? fields.layout : fields;
    components.saveLayout(caller(request), w.id, layout, expectedRevision);
    return components.home(caller(request), w.id);
  });
  app.get('/api/reviews', async (request) => {
    requireAdmin(request);
    return { releases: components.pending() };
  });
  app.post<{ Params: { id: string } }>('/api/reviews/:id', async (request) => {
    const reviewer = requireAdmin(request);
    const body = z
      .object({
        decision: z.enum(['published', 'rejected', 'withdrawn']),
        reason: z.string().max(2000),
      })
      .strict()
      .parse(request.body);
    return components.review(reviewer, request.params.id, body.decision, body.reason);
  });
}

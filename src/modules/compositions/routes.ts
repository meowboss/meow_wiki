import type { FastifyInstance } from 'fastify';
import { surfaceSchema } from '../../../packages/canvas-contract/index.ts';
import type { HttpContext } from '../../http/context.ts';
import { CompositionService } from './service.ts';

/** Existing matched-route security hooks provide session authentication and PUT CSRF. */
export function registerCompositions(app: FastifyInstance, context: HttpContext) {
  const service = new CompositionService(context.store.db, (owner, workspace) => {
    context.store.get(owner, workspace);
  });
  app.get<{ Params: { surface: string } }>('/api/compositions/:surface', async (request) => {
    const owner = context.caller(request);
    const workspace = context.scope(request);
    return service.get(owner, workspace.id, surfaceSchema.parse(request.params.surface));
  });
  app.put<{ Params: { surface: string } }>('/api/compositions/:surface', async (request) => {
    const owner = context.caller(request);
    const workspace = context.scope(request);
    return service.update(
      owner,
      workspace.id,
      surfaceSchema.parse(request.params.surface),
      request.body,
    );
  });
}

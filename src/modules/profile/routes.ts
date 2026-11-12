import type { FastifyInstance } from 'fastify';
import type { HttpContext } from '../../http/context.ts';
import { ProfileService } from './service.ts';

/** Authentication and PATCH CSRF checks use the existing matched-route security hooks. */
export function registerProfileRoutes(app: FastifyInstance, context: HttpContext) {
  const profiles = new ProfileService(context.store.db);
  app.get('/api/profile', async (request, reply) => {
    if (context.mode !== 'session')
      return reply.code(409).send({ error: '请启用 session 模式使用账号资料' });
    return profiles.get(context.caller(request));
  });
  app.patch('/api/profile', async (request, reply) => {
    if (context.mode !== 'session')
      return reply.code(409).send({ error: '请启用 session 模式使用账号资料' });
    return profiles.update(context.caller(request), request.body);
  });
}

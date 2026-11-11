import type { FastifyInstance } from 'fastify';
import type { Store } from '../store.ts';
export function registerHealth(app: FastifyInstance, store: Store) {
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      store.db.prepare('SELECT 1').get();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}

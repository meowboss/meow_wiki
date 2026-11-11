import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpContext } from '../../http/context.ts';
import type { DomainsService } from './service.ts';
import { DomainBuildService } from './build-service.ts';

const input = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1000).default(''),
  buildProfile: z.enum(['general', 'project', 'research', 'product']).default('general'),
});
export function registerDomainRoutes(
  app: FastifyInstance,
  context: HttpContext,
  domains: DomainsService,
) {
  const { caller, scope } = context;
  const builder = new DomainBuildService(domains);
  app.post<{ Params: { id: string } }>('/api/domains/:id/build', async (request, reply) =>
    reply.code(201).send(builder.build(caller(request), request.params.id, request.body)),
  );
  function describe(userId: string, id: string) {
    return domains.describe(userId, id);
  }
  app.get('/api/domains', async (request) => ({
    domains: domains.list(caller(request)).map((d) => describe(caller(request), d.id)),
  }));
  app.post('/api/domains', async (request, reply) => {
    const workspace = scope(request);
    const domain = domains.create(caller(request), workspace.id, input.parse(request.body));
    return reply.code(201).send(describe(caller(request), domain.id));
  });
  app.get<{ Params: { id: string } }>('/api/domains/:id', async (request) =>
    describe(caller(request), request.params.id),
  );
  app.put<{ Params: { id: string } }>('/api/domains/:id', async (request) => {
    const domain = domains.update(
      caller(request),
      request.params.id,
      input.extend({ expectedRevision: z.number().int().positive() }).parse(request.body),
    );
    return describe(caller(request), domain.id);
  });
  app.get<{ Params: { id: string } }>('/api/domains/:id/members', async (request) => ({
    members: domains.memberProfiles(caller(request), request.params.id),
  }));
  app.post<{ Params: { id: string } }>('/api/domains/:id/members', async (request) => {
    const value = z
      .object({
        email: z.string().email().max(254),
        role: z.enum(['reader', 'contributor', 'maintainer']),
      })
      .parse(request.body);
    return domains.invite(caller(request), request.params.id, value.email, value.role);
  });
  app.delete<{ Params: { id: string; userId: string } }>(
    '/api/domains/:id/members/:userId',
    async (request) =>
      domains.removeMember(caller(request), request.params.id, request.params.userId),
  );
  app.get<{ Params: { id: string } }>('/api/domains/:id/contributions', async (request) => ({
    contributions: domains.contributions(caller(request), request.params.id),
  }));
  app.post<{ Params: { id: string } }>('/api/domains/:id/contributions', async (request, reply) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(160),
        content: z.string().min(1).max(100_000),
        expectedDomainRevision: z.number().int().positive(),
      })
      .parse(request.body);
    return reply.code(201).send(domains.submit(caller(request), request.params.id, body));
  });
  app.post<{ Params: { id: string; contributionId: string } }>(
    '/api/domains/:id/contributions/:contributionId/review',
    async (request) =>
      domains.review(
        caller(request),
        request.params.id,
        request.params.contributionId,
        z
          .object({ decision: z.enum(['published', 'rejected']), reason: z.string().max(2000) })
          .parse(request.body),
      ),
  );
  app.get<{ Params: { id: string } }>('/api/domains/:id/search', async (request) => {
    const { q } = z.object({ q: z.string().max(500) }).parse(request.query);
    return { results: domains.search(caller(request), request.params.id, q) };
  });
}

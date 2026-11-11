import type { FastifyInstance } from 'fastify';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { HttpContext } from '../../http/context.ts';
import type { DomainsService } from '../domains/service.ts';
import { McpCredentials } from './credentials.ts';
import { createDomainMcp } from './server.ts';

export function registerMcpRoutes(
  app: FastifyInstance,
  context: HttpContext,
  domains: DomainsService,
) {
  const credentials = new McpCredentials(context.store.db, domains);
  app.get('/api/mcp/credentials', async (request) => ({
    credentials: credentials.list(context.caller(request)),
  }));
  app.post('/api/mcp/credentials', async (request, reply) => {
    const body = z
      .object({
        domainId: z.string().uuid(),
        label: z.string().trim().min(1).max(100),
        expiresInDays: z.number().int().min(1).max(30).default(7),
      })
      .strict()
      .parse(request.body);
    return reply.code(201).send(credentials.issue(context.caller(request), body));
  });
  app.delete<{ Params: { id: string } }>('/api/mcp/credentials/:id', async (request) =>
    credentials.revoke(context.caller(request), request.params.id),
  );
  app.route({
    method: ['POST', 'GET', 'DELETE'],
    url: '/mcp',
    async handler(request, reply) {
      const authorization = request.headers.authorization ?? '';
      if (!authorization.startsWith('Bearer '))
        return reply
          .code(401)
          .header('WWW-Authenticate', 'Bearer')
          .send({ error: '需要域范围MCP凭据' });
      let principal;
      try {
        principal = credentials.authenticate(authorization.slice(7));
      } catch {
        return reply
          .code(401)
          .header('WWW-Authenticate', 'Bearer')
          .send({ error: 'MCP凭据不可用或已撤权' });
      }
      // Stateless transport gives every request fresh authorization and no lingering user/session context.
      const server = createDomainMcp(domains, principal);
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      try {
        await server.connect(transport);
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers))
          if (typeof value === 'string') headers.set(name, value);
        const response = await transport.handleRequest(
          new Request(`http://localhost${request.url}`, {
            method: request.method,
            headers,
            ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
          }),
        );
        reply.code(response.status);
        for (const [name, value] of response.headers) reply.header(name, value);
        return reply.send(await response.text());
      } finally {
        await server.close();
      }
    },
  });
}

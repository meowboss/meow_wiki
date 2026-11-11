import type { FastifyInstance } from 'fastify';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { HttpContext } from '../../http/context.ts';
import type { DomainsService } from '../domains/service.ts';
import { McpCredentials, mcpScopeSchema } from './credentials.ts';
import { createDomainMcp } from './server.ts';
import { McpBudget, boundedMcpText } from './budget.ts';

export function registerMcpRoutes(
  app: FastifyInstance,
  context: HttpContext,
  domains: DomainsService,
) {
  const credentials = new McpCredentials(context.store.db, domains);
  const budget = new McpBudget();
  app.get('/api/mcp/credentials', async (request) => ({
    credentials: credentials.list(context.caller(request)),
  }));
  app.post('/api/mcp/credentials', async (request, reply) => {
    const body = z
      .object({
        domainId: z.string().uuid(),
        label: z.string().trim().min(1).max(100),
        expiresInDays: z.number().int().min(1).max(30).default(7),
        scope: mcpScopeSchema.optional(),
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
      if (Array.isArray(request.body))
        return reply.code(400).send({ error: 'MCP批处理暂不支持，请逐次请求' });
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
      if (request.method !== 'POST')
        return reply
          .code(405)
          .header('Allow', 'POST')
          .send({ error: '无状态MCP仅支持POST，不提供持久SSE会话' });
      const release = budget.enter(principal.userId);
      if (!release)
        return reply
          .code(429)
          .header('Retry-After', '60')
          .send({ error: 'MCP请求速率或并发超过账号预算' });
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
        return reply.send(await boundedMcpText(response));
      } finally {
        release();
        await server.close();
      }
    },
  });
}

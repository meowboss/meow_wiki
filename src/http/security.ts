import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpContext } from './context.ts';

export function registerSecurity(app: FastifyInstance, context: HttpContext, token?: string) {
  const { identity, sessions, store, mode } = context;
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    // Guard every request, including absolute-form and encoded paths.
    reply.header('Cache-Control', 'no-store');
    if (!request.url.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\'))
      return reply.code(400).send({ error: '仅接受 origin-form 请求路径' });
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
      return reply.code(403).send({ error: '仅接受本机 Host，禁止 DNS rebinding' });
    }
    // No CORS: reject cross-site browser reads as well as writes.
    const origin = request.headers.origin;
    if (origin) {
      let normalized: string;
      try {
        normalized = new URL(origin).origin;
      } catch {
        return reply.code(403).send({ error: '无效来源' });
      }
      const allowed = identity
        ? identity.trustedOrigins.has(origin)
        : normalized === origin && origin === `http://${host}`;
      if (!allowed) return reply.code(403).send({ error: '禁止跨站 API 请求' });
    }
    if (mode === 'token') {
      const expected = Buffer.from(`Bearer ${token}`);
      const received = Buffer.from(request.headers.authorization ?? '');
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        return reply.code(401).send({ error: '需要有效访问令牌' });
      }
    }
  });
  app.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url ?? '';
    if (!identity) {
      if (/^\/api\/(domains|mcp\/credentials|workshop\/providers)(\/|$)/.test(route))
        return reply
          .code(409)
          .send({ error: '此功能需要session账号模式；本地/脚本身份不会隐式获得平台账号权限' });
      return;
    }
    // Authorization uses the matched route, never client-controlled URL classification.
    if (!route.startsWith('/api/') || (route.startsWith('/api/auth/') && route !== '/api/auth/me'))
      return;
    const session = await identity.session(request);
    if (session) {
      sessions.set(request, session);
      store.ensure(session.user.id);
    }
    if (route === '/api/auth/me') return;
    if (!session) return reply.code(401).send({ error: '请先登录' });
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !identity.verifyCsrf(session, String(request.headers['x-csrf-token'] ?? ''))
    )
      return reply.code(403).send({ error: 'CSRF 校验失败' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: '输入校验失败', details: error.flatten() });
    const candidate =
      error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status =
      typeof candidate === 'number' && candidate >= 400 && candidate <= 599 ? candidate : 500;
    if (status === 500) app.log.error(error);
    return reply.code(status).send({
      error:
        status === 500
          ? '服务暂时无法完成请求'
          : error instanceof Error
            ? error.message
            : '请求失败',
    });
  });
}

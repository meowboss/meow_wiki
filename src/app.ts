import Fastify, { type FastifyRequest } from 'fastify';
import { Identity, type IdentityOptions, type IdentitySession } from './identity.ts';
import { randomUUID } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createKernel } from './plugins/official.ts';
import { AccessError, Store } from './store.ts';
import { ComponentService, componentSchema, layoutSchema } from './components.ts';
import { registerKnowledge } from './knowledge-http.ts';
import type { ModelBroker } from './models.ts';

const text = z.string().trim().min(1).max(160);
const pageInput = z.object({ title: text, markdown: z.string().max(200_000) });
export type AppOptions = IdentityOptions & { modelBroker?: ModelBroker; databasePath?: string; store?: Store; mode?: 'local' | 'token' | 'session'; token?: string; userId?: string; /** @deprecated Ignored: public signup cannot grant roles. */ adminUsernames?: string[]; /** @deprecated Ignored. */ adminBootstrapToken?: string; logger?: boolean };

export function createApp(options: AppOptions = {}) {
  const mode = options.mode ?? 'local';
  if (mode === 'token' && (!options.token || options.token.length < 32 || !options.userId)) {
    throw new Error('Token 模式需要至少 32 字符 MEOW_AUTH_TOKEN 和明确的 MEOW_USER_ID');
  }
  const app = Fastify({ logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'], serializers: { req: request => ({ method: request.method, url: String(request.url).split('?')[0], remoteAddress: request.ip }) } } : false, bodyLimit: 256 * 1024, ajv: { customOptions: { removeAdditional: false } } });
  const store = options.store ?? new Store(options.databasePath);
  const components = new ComponentService(store.db);
  const kernel = createKernel();
  // Identity is configured by the host, NEVER accepted from an owner/user header or request body.
  const owner = options.userId ?? 'local-owner';
  if (mode !== 'session') store.ensure(owner);
  // createApp's generated secret is ephemeral (tests/embedding). The server supplies a persistent host secret.
  const identity = mode === 'session' ? new Identity(store.db, options) : undefined;
  const sessions = new WeakMap<FastifyRequest, IdentitySession>();
  const caller = (request: FastifyRequest) => mode === 'session' ? sessions.get(request)!.user.id : owner;
  app.addHook('onReady', async () => { await identity?.ready(); });
  app.addHook('onClose', async () => { try { kernel.dispose(); } finally { if (!options.store) store.close(); } });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    // Guard every request, not a raw URL prefix: HTTP absolute-form/encoded paths
    // may be routed to an API even when request.url does not start with /api/.
    reply.header('Cache-Control', 'no-store');
    if (!request.url.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) return reply.code(400).send({ error: '仅接受 origin-form 请求路径' });
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
      return reply.code(403).send({ error: '仅接受本机 Host，禁止 DNS rebinding' });
    }
    // No CORS. Origin check also blocks browser-driven writes/reads from hostile sites to localhost.
    const origin = request.headers.origin;
    if (origin) {
      let normalized: string;
      try { normalized = new URL(origin).origin; } catch { return reply.code(403).send({ error: '无效来源' }); }
      const allowed = identity ? identity.trustedOrigins.has(origin) : normalized === origin && origin === `http://${host}`;
      if (!allowed) return reply.code(403).send({ error: '禁止跨站 API 请求' });
    }
    if (mode === 'token') {
      const expected = Buffer.from(`Bearer ${options.token}`);
      const received = Buffer.from(request.headers.authorization ?? '');
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        return reply.code(401).send({ error: '需要有效访问令牌' });
      }
    }
  });
  app.addHook('preHandler', async (request, reply) => {
    if (!identity) return;
    const route = request.routeOptions.url ?? '';
    // Authorization uses Fastify's matched route, never client-controlled raw URL classification.
    if (!route.startsWith('/api/') || route.startsWith('/api/auth/') && route !== '/api/auth/me') return;
    const session = await identity.session(request);
    if (session) { sessions.set(request, session); store.ensure(session.user.id); }
    if (route === '/api/auth/me') return;
    if (!session) return reply.code(401).send({ error: '请先登录' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !identity.verifyCsrf(session, String(request.headers['x-csrf-token'] ?? ''))) return reply.code(403).send({ error: 'CSRF 校验失败' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: '输入校验失败', details: error.flatten() });
    const candidate = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof candidate === 'number' && candidate >= 400 && candidate < 500 ? candidate : 500;
    if (status === 500) app.log.error(error);
    return reply.code(status).send({ error: status === 500 ? '服务暂时无法完成请求' : error instanceof Error ? error.message : '请求失败' });
  });
  function scope(request: FastifyRequest) {
    const parsed = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.query);
    const userId = caller(request);
    const id = parsed.workspaceId ?? store.ensure(userId);
    return store.get(userId, id);
  }
  app.get('/api/auth/me', async request => ({ mode, user: mode === 'session' ? sessions.get(request)?.user ?? null : { id: owner, username: '本地用户', role: 'user' }, csrfToken: sessions.get(request)?.csrfToken ?? '' }));
  // Explicitly expose only the standard credential endpoints. No legacy password or role API.
  const email = { type: 'string', minLength: 3, maxLength: 254 };
  const password = { type: 'string', minLength: 1, maxLength: 256 };
  for (const action of ['sign-up/email', 'sign-in/email', 'sign-out'] as const) {
    const signup = action === 'sign-up/email';
    app.post(`/api/auth/${action}`, { schema: { body: {
      type: 'object', additionalProperties: false,
      properties: action === 'sign-out' ? {} : { email, password, ...(signup ? { name: { type: 'string', minLength: 1, maxLength: 160 } } : { rememberMe: { type: 'boolean' } }) },
      ...(action === 'sign-out' ? {} : { required: signup ? ['email', 'password', 'name'] : ['email', 'password'] }),
    } } }, async (request, reply) => {
      if (!identity) return reply.code(409).send({ error: '请启用 session 模式使用账号功能' });
      if (signup && identity.reservedAdminEmails.has(String((request.body as { email: string }).email).trim().toLowerCase())) return reply.code(403).send({ error: '此邮件由宿主保留，禁止公开注册' });
      return identity.handle(request, reply);
    });
  }
  app.get('/api/auth/get-session', async (request, reply) => {
    if (!identity) return reply.code(409).send({ error: '请启用 session 模式使用账号功能' });
    return identity.handle(request, reply);
  });
  app.get('/api/workspaces', async request => ({ workspaces: store.list(caller(request)) }));
  app.post('/api/workspaces', async (request, reply) => {
    const body = z.object({ name: text, description: z.string().max(500).default('') }).parse(request.body);
    const id = store.create(caller(request), body.name, body.description);
    return reply.code(201).send({ id });
  });
  app.patch<{ Params: { id: string } }>('/api/workspaces/:id', async request => {
    const body = z.object({ name: text, description: z.string().max(500) }).parse(request.body);
    return store.change(caller(request), request.params.id, w => { w.name = body.name; w.description = body.description; return { id: w.id, name: w.name, description: w.description }; });
  });
  app.get('/api/workspace', async request => {
    const owner = caller(request);
    const w = scope(request);
    const releases = components.releases(owner, w.id);
    return {
      workspace: { id: w.id, name: w.name, description: w.description }, pages: w.pages.filter(p => !p.deletedAt), trash: w.pages.filter(p => p.deletedAt),
      plugins: kernel.list().map(p => ({ ...p, enabled: w.enabled.includes(p.id) })),
      components: components.list(owner, w.id).map(draft => {
        const latestRelease = releases.filter(release => release.componentId === draft.id).at(-1) ?? null;
        return { ...draft, status: latestRelease?.status ?? 'private', latestRelease };
      }), marketplace: components.marketplace(), installed: components.installed(w.id),
    };
  });
  app.post('/api/pages', async (request, reply) => {
    const owner = caller(request);
    const w = scope(request);
    const body = pageInput.parse(request.body);
    const page = { id: randomUUID(), ...body, updatedAt: new Date().toISOString(), revision: 1, deletedAt: null, parentId: null };
    store.change(owner, w.id, draft => {
      if (draft.pages.length >= 1000) throw Object.assign(new Error('已达到本原型每空间 1000 页上限'), { statusCode: 409 });
      draft.pages.push(page);
    });
    return reply.code(201).send(page);
  });
  app.put<{ Params: { id: string } }>('/api/pages/:id', async request => {
    const owner = caller(request);
    const w = scope(request);
    const { expectedRevision, ...patch } = pageInput.extend({ expectedRevision: z.number().int().positive(), parentId: z.string().uuid().nullable().optional() }).parse(request.body);
    return store.updatePage(owner, w.id, request.params.id, expectedRevision, patch);
  });
  app.get<{ Params: { id: string } }>('/api/pages/:id/history', async request => {
    const owner = caller(request);
    const w = scope(request);
    return { revisions: store.history(owner, w.id, request.params.id) };
  });
  app.post<{ Params: { id: string } }>('/api/pages/:id/restore', async request => {
    const owner = caller(request);
    const w = scope(request);
    const body = z.object({ revision: z.number().int().positive(), expectedRevision: z.number().int().positive() }).parse(request.body);
    return store.restorePage(owner, w.id, request.params.id, body.revision, body.expectedRevision);
  });
  app.delete<{ Params: { id: string } }>('/api/pages/:id', async request => {
    const owner = caller(request);
    const w = scope(request);
    const body = z.object({ expectedRevision: z.number().int().positive() }).parse(request.body);
    return store.updatePage(owner, w.id, request.params.id, body.expectedRevision, {}, 'delete');
  });
  app.post<{ Params: { id: string } }>('/api/pages/:id/undelete', async request => {
    const owner = caller(request);
    const w = scope(request);
    const body = z.object({ expectedRevision: z.number().int().positive() }).parse(request.body);
    return store.updatePage(owner, w.id, request.params.id, body.expectedRevision, {}, 'undelete');
  });
  app.post('/api/render', async request => {
    const owner = caller(request);
    const w = scope(request);
    const { markdown } = z.object({ markdown: z.string().max(200_000) }).parse(request.body);
    return { html: await kernel.service('render', new Set(w.enabled))(markdown) };
  });
  app.get('/api/search', async request => {
    const owner = caller(request);
    const w = scope(request);
    const { q } = z.object({ q: z.string().max(500) }).parse(request.query);
    return { results: kernel.service('search', new Set(w.enabled))(q, w.pages.filter(p => !p.deletedAt)) };
  });
  app.post('/api/ask', async request => {
    const owner = caller(request);
    const w = scope(request);
    const { question } = z.object({ question: z.string().trim().min(1).max(500) }).parse(request.body);
    return kernel.service('ask', new Set(w.enabled))(question, w.pages.filter(p => !p.deletedAt));
  });
  app.post<{ Params: { id: string } }>('/api/plugins/:id', async request => {
    const owner = caller(request);
    const w = scope(request);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    return store.change(owner, w.id, draft => {
      if (!kernel.list().some(p => p.id === request.params.id)) throw new AccessError('未找到插件');
      const next = new Set(draft.enabled);
      if (enabled) next.add(request.params.id); else next.delete(request.params.id);
      kernel.validateEnabled(next);
      draft.enabled = [...next];
      return { ok: true };
    });
  });
  app.post('/api/components', async (request, reply) => {
    const w = scope(request);
    return reply.code(201).send(components.create(caller(request), w.id, request.body));
  });
  app.put<{ Params: { id: string } }>('/api/components/:id', async request => {
    const w = scope(request);
    const { expectedVersion, ...body } = componentSchema.extend({ expectedVersion: z.number().int().positive() }).parse(request.body);
    return components.update(caller(request), w.id, request.params.id, body, expectedVersion);
  });
  app.post<{ Params: { id: string } }>('/api/components/:id/submit', async request => {
    const w = scope(request);
    return components.submit(caller(request), w.id, request.params.id);
  });
  app.get('/api/components/releases', async request => {
    const w = scope(request);
    return { releases: components.releases(caller(request), w.id) };
  });
  app.get('/api/marketplace', async () => ({ releases: components.marketplace() }));
  app.get('/api/components/installed', async request => ({ installed: components.installed(scope(request).id) }));
  app.post<{ Params: { id: string } }>('/api/marketplace/:id/install', async request =>
    components.install(scope(request).id, request.params.id));
  app.get('/api/home', async request => components.home(caller(request), scope(request).id));
  app.put('/api/home', async request => {
    const w = scope(request);
    const revision = z.number().int().nonnegative();
    const body = z.union([
      layoutSchema.extend({ expectedRevision: revision }),
      z.object({ layout: layoutSchema, expectedRevision: revision }).strict(),
    ]).parse(request.body);
    const { expectedRevision, ...fields } = body;
    const layout = 'layout' in fields ? fields.layout : fields;
    components.saveLayout(caller(request), w.id, layout, expectedRevision);
    return components.home(caller(request), w.id);
  });
  function requireAdmin(request: FastifyRequest) {
    if (mode !== 'session' || sessions.get(request)?.user.role !== 'admin') {
      throw Object.assign(new Error('需要平台管理员权限'), { statusCode: 403 });
    }
    return sessions.get(request)!.user.id;
  }
  app.get('/api/reviews', async request => {
    requireAdmin(request);
    return { releases: components.pending() };
  });
  app.post<{ Params: { id: string } }>('/api/reviews/:id', async request => {
    const reviewer = requireAdmin(request);
    const body = z.object({ decision: z.enum(['published', 'rejected', 'withdrawn']), reason: z.string().max(2000) }).strict().parse(request.body);
    return components.review(reviewer, request.params.id, body.decision, body.reason);
  });
  registerKnowledge(app, store, caller, options.modelBroker);
  return app;
}

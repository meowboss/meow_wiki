import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createKernel } from './plugins/official.ts';
import { AccessError, Store, type Component } from './store.ts';

const text = z.string().trim().min(1).max(160);
const pageInput = z.object({ title: text, markdown: z.string().max(200_000) });
const componentInput = z.object({ name: text, description: z.string().max(500), template: z.string().min(1).max(10_000) });
export type AppOptions = { store?: Store; mode?: 'local' | 'token'; token?: string; userId?: string; logger?: boolean };

export function createApp(options: AppOptions = {}) {
  const mode = options.mode ?? 'local';
  if (mode === 'token' && (!options.token || options.token.length < 32 || !options.userId)) {
    throw new Error('Token 模式需要至少 32 字符 MEOW_AUTH_TOKEN 和明确的 MEOW_USER_ID');
  }
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024 });
  const store = options.store ?? new Store();
  const kernel = createKernel();
  // Identity is configured by the host, NEVER accepted from an owner/user header or request body.
  const owner = options.userId ?? 'local-owner';
  const defaultWorkspace = store.ensure(owner);
  app.addHook('onClose', async () => { if (!options.store) store.close(); });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    // Guard every request, not a raw URL prefix: HTTP absolute-form/encoded paths
    // may be routed to an API even when request.url does not start with /api/.
    reply.header('Cache-Control', 'no-store');
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
      return reply.code(403).send({ error: '仅接受本机 Host，禁止 DNS rebinding' });
    }
    // No CORS. Origin check also blocks browser-driven writes/reads from hostile sites to localhost.
    const origin = request.headers.origin;
    if (origin) {
      let originHost: string;
      try { originHost = new URL(origin).host; } catch { return reply.code(403).send({ error: '无效来源' }); }
      if (originHost !== request.headers.host) return reply.code(403).send({ error: '禁止跨站 API 请求' });
    }
    if (mode === 'token') {
      const expected = Buffer.from(`Bearer ${options.token}`);
      const received = Buffer.from(request.headers.authorization ?? '');
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        return reply.code(401).send({ error: '需要有效访问令牌' });
      }
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: '输入校验失败', details: error.flatten() });
    const candidate = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof candidate === 'number' && candidate >= 400 && candidate < 500 ? candidate : 500;
    if (status === 500) app.log.error(error);
    return reply.code(status).send({ error: status === 500 ? '服务暂时无法完成请求' : error instanceof Error ? error.message : '请求失败' });
  });
  function scope(query: unknown) {
    const parsed = z.object({ workspaceId: z.string().uuid().optional() }).parse(query);
    const id = parsed.workspaceId ?? defaultWorkspace;
    return store.get(owner, id);
  }
  app.get('/api/workspace', async request => {
    const w = scope(request.query);
    return {
      workspace: { id: w.id, name: w.name, description: w.description }, pages: w.pages,
      plugins: kernel.list().map(p => ({ ...p, enabled: w.enabled.includes(p.id) })),
      components: w.components, marketplace: store.marketplace(),
    };
  });
  app.post('/api/pages', async (request, reply) => {
    const w = scope(request.query);
    const body = pageInput.parse(request.body);
    const page = { id: randomUUID(), ...body, updatedAt: new Date().toISOString() };
    store.change(owner, w.id, draft => {
      if (draft.pages.length >= 1000) throw Object.assign(new Error('已达到本原型每空间 1000 页上限'), { statusCode: 409 });
      draft.pages.push(page);
    });
    return reply.code(201).send(page);
  });
  app.put<{ Params: { id: string } }>('/api/pages/:id', async request => {
    const w = scope(request.query);
    const body = pageInput.parse(request.body);
    return store.change(owner, w.id, draft => {
      const page = draft.pages.find(p => p.id === request.params.id);
      if (!page) throw new AccessError('未找到页面');
      Object.assign(page, body, { updatedAt: new Date().toISOString() });
      return page;
    });
  });
  app.post('/api/render', async request => {
    const w = scope(request.query);
    const { markdown } = z.object({ markdown: z.string().max(200_000) }).parse(request.body);
    return { html: await kernel.service('render', new Set(w.enabled))(markdown) };
  });
  app.get('/api/search', async request => {
    const w = scope(request.query);
    const { q } = z.object({ q: z.string().max(500) }).parse(request.query);
    return { results: kernel.service('search', new Set(w.enabled))(q, w.pages) };
  });
  app.post('/api/ask', async request => {
    const w = scope(request.query);
    const { question } = z.object({ question: z.string().trim().min(1).max(500) }).parse(request.body);
    return kernel.service('ask', new Set(w.enabled))(question, w.pages);
  });
  app.post<{ Params: { id: string } }>('/api/plugins/:id', async request => {
    const w = scope(request.query);
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
    const w = scope(request.query);
    const body = componentInput.parse(request.body);
    const component: Component = { id: randomUUID(), ...body, authorId: owner, status: 'private' };
    store.change(owner, w.id, draft => {
      if (draft.components.length >= 200) throw Object.assign(new Error('已达到本原型每空间 200 个组件上限'), { statusCode: 409 });
      draft.components.push(component);
    });
    return reply.code(201).send(component);
  });
  app.post<{ Params: { id: string } }>('/api/components/:id/submit', async request => {
    const w = scope(request.query);
    return store.change(owner, w.id, draft => {
      const component = draft.components.find(c => c.id === request.params.id && c.authorId === owner);
      if (!component) throw new AccessError('未找到私有组件');
      if (!['private', 'rejected'].includes(component.status)) throw Object.assign(new Error('只有私有或被退回的组件能够提交'), { statusCode: 409 });
      component.status = 'pending';
      return component;
    });
  });
  app.post<{ Params: { id: string } }>('/api/marketplace/:id/install', async request => {
    const w = scope(request.query);
    const component = store.marketplace().find(c => c.id === request.params.id && c.status === 'published');
    if (!component) throw new AccessError('未找到已审核组件');
    return store.change(owner, w.id, draft => {
      if (!draft.components.some(c => c.id === component.id)) {
        if (draft.components.length >= 200) throw Object.assign(new Error('已达到组件上限'), { statusCode: 409 });
        draft.components.push(component);
      }
      return component;
    });
  });
  return app;
}

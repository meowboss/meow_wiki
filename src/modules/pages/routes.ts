import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HttpContext } from '../../http/context.ts';
import type { PagesService } from './service.ts';

const pageInput = z.object({
  title: z.string().trim().min(1).max(160),
  markdown: z.string().max(200_000),
});

export function registerPageRoutes(
  app: FastifyInstance,
  { caller, scope }: HttpContext,
  pages: PagesService,
) {
  app.post('/api/pages', async (request, reply) => {
    const owner = caller(request);
    const w = scope(request);
    const body = pageInput.parse(request.body);
    return reply.code(201).send(pages.create(owner, w.id, body));
  });
  app.put<{ Params: { id: string } }>('/api/pages/:id', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    const { expectedRevision, ...patch } = pageInput
      .extend({
        expectedRevision: z.number().int().positive(),
        parentId: z.string().uuid().nullable().optional(),
      })
      .parse(request.body);
    return pages.update(owner, w.id, request.params.id, expectedRevision, patch);
  });
  app.get<{ Params: { id: string } }>('/api/pages/:id/history', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    return { revisions: pages.history(owner, w.id, request.params.id) };
  });
  app.get<{ Params: { id: string } }>('/api/pages/:id/history/export', async (request, reply) => {
    const owner = caller(request);
    const w = scope(request);
    const result = pages.exportHistory(owner, w.id, request.params.id);
    const safeId = request.params.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'page';
    return reply
      .type('application/json')
      .header('Content-Disposition', `attachment; filename="${safeId}-history.json"`)
      .header('Cache-Control', 'no-store')
      .send(result);
  });
  app.post<{ Params: { id: string } }>('/api/pages/:id/history/archive', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    const body = z
      .object({
        expectedRevision: z.number().int().positive(),
        keep: z.number().int().min(10).max(100),
        exportDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(request.body);
    return pages.archiveHistory(owner, w.id, request.params.id, body);
  });
  app.post<{ Params: { id: string } }>('/api/pages/:id/restore', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    const body = z
      .object({
        revision: z.number().int().positive(),
        expectedRevision: z.number().int().positive(),
      })
      .parse(request.body);
    return pages.restore(owner, w.id, request.params.id, body.revision, body.expectedRevision);
  });
  app.delete<{ Params: { id: string } }>('/api/pages/:id', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    const body = z.object({ expectedRevision: z.number().int().positive() }).parse(request.body);
    return pages.delete(owner, w.id, request.params.id, body.expectedRevision);
  });
  app.post<{ Params: { id: string } }>('/api/pages/:id/undelete', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    const body = z.object({ expectedRevision: z.number().int().positive() }).parse(request.body);
    return pages.undelete(owner, w.id, request.params.id, body.expectedRevision);
  });
  app.post('/api/render', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    const { markdown } = z.object({ markdown: z.string().max(200_000) }).parse(request.body);
    return pages.render(w, markdown);
  });
  app.get('/api/search', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    const { q } = z.object({ q: z.string().max(500) }).parse(request.query);
    return pages.search(w, q);
  });
  app.post('/api/ask', async (request) => {
    const owner = caller(request);
    const w = scope(request);
    const { question } = z
      .object({ question: z.string().trim().min(1).max(500) })
      .parse(request.body);
    return pages.ask(w, question);
  });
}

import type { FastifyInstance } from 'fastify';
import type { HttpContext } from '../../http/context.ts';
import { AssetService } from './service.ts';

/** A single byte range only; malformed, empty and multipart requests receive 416. */
function byteRange(header: string, size: number): [number, number] | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return;
    return [Math.max(0, size - suffix), size - 1];
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end)
    return;
  return [start, Math.min(end, size - 1)];
}

/** Shared security hooks authenticate sessions and enforce CSRF before these handlers run. */
export function registerAssets(app: FastifyInstance, context: HttpContext) {
  const service = new AssetService(context.store.db, (owner, workspace) => {
    context.store.get(owner, workspace);
  });
  app.get('/api/assets', async (request) => {
    const owner = context.caller(request);
    const workspace = context.scope(request);
    return { assets: service.list(owner, workspace.id) };
  });
  app.post('/api/assets', { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const owner = context.caller(request);
    const workspace = context.scope(request);
    return reply.code(201).send(service.create(owner, workspace.id, request.body));
  });
  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (request) => {
    const owner = context.caller(request);
    const workspace = context.scope(request);
    service.remove(owner, workspace.id, request.params.id);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/api/assets/:id/content', async (request, reply) => {
    const owner = context.caller(request);
    const workspace = context.scope(request);
    const asset = service.get(owner, workspace.id, request.params.id);
    reply.header('Content-Type', asset.mime);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Accept-Ranges', 'bytes');
    const range = request.headers.range;
    if (range !== undefined) {
      const parsed = byteRange(range, asset.bytes);
      if (!parsed) return reply.code(416).header('Content-Range', `bytes */${asset.bytes}`).send();
      const [start, end] = parsed;
      return reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${asset.bytes}`)
        .header('Content-Length', end - start + 1)
        .send(asset.data.subarray(start, end + 1));
    }
    return reply.header('Content-Length', asset.bytes).send(asset.data);
  });
}

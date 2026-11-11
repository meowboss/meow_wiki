import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { createApp } from './app.ts';

const mode = process.env.MEOW_AUTH_MODE ?? 'local';
if (mode !== 'local' && mode !== 'token') throw new Error('MEOW_AUTH_MODE 只能是 local 或 token');
const app = createApp({ mode, token: process.env.MEOW_AUTH_TOKEN, userId: process.env.MEOW_USER_ID, logger: true });
const root = resolve('dist');
if (existsSync(root)) await app.register(fastifyStatic, { root });
app.setNotFoundHandler((request, reply) => {
  if (request.method === 'GET' && !request.url.startsWith('/api/') && existsSync(root)) return reply.sendFile('index.html');
  return reply.code(404).send({ error: '未找到资源；前端请先执行 pnpm build' });
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close(); });
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效');
// This milestone is local-first. No public listener until full identity, limits and operational hardening land.
await app.listen({ host: '127.0.0.1', port });
if (mode === 'local') app.log.warn('本地单用户模式：仅供本人使用，不得通过反向代理公开到网络。');

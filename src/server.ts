import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { createApp } from './app.ts';
import { ModelBroker } from './models.ts';

const mode = process.env.MEOW_AUTH_MODE ?? 'session';
if (mode !== 'local' && mode !== 'token' && mode !== 'session')
  throw new Error('MEOW_AUTH_MODE 只能是 local、token 或 session');
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效');
function persistentSecret() {
  if (process.env.MEOW_AUTH_SECRET !== undefined) {
    if (process.env.MEOW_AUTH_SECRET.length < 32)
      throw new Error('MEOW_AUTH_SECRET 必须至少 32 字符');
    return process.env.MEOW_AUTH_SECRET;
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('生产环境必须显式配置至少 32 字符 MEOW_AUTH_SECRET');
  // This local-first host persists its random secret. Production deployments must provision
  // MEOW_AUTH_SECRET explicitly and use the same secret across all restarts/replicas.
  const directory = resolve('.data');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = resolve(directory, 'auth-secret');
  try {
    writeFileSync(file, randomBytes(48).toString('base64url'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  const secret = readFileSync(file, 'utf8').trim();
  if (secret.length < 32) throw new Error('.data/auth-secret 无效：必须至少 32 字符');
  // POSIX creation mode is 0600. Windows access depends on the host account's inherited ACL;
  // mode bits are not a claim that Windows ACLs were hardened.
  return secret;
}
const trustedOrigins = (process.env.MEOW_TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Explicit local Vite opt-in; createApp never implicitly trusts development origins.
if (process.env.MEOW_ALLOW_VITE_ORIGIN === '1')
  trustedOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173');
const modelConfigured = [
  process.env.MEOW_MODEL_ENDPOINT,
  process.env.MEOW_MODEL_NAME,
  process.env.MEOW_MODEL_KEY,
].filter(Boolean).length;
if (modelConfigured !== 0 && modelConfigured !== 3)
  throw new Error('模型需要同时配置 MEOW_MODEL_ENDPOINT/NAME/KEY');
const modelBroker = modelConfigured
  ? new ModelBroker({
      endpoint: process.env.MEOW_MODEL_ENDPOINT!,
      model: process.env.MEOW_MODEL_NAME!,
      apiKey: process.env.MEOW_MODEL_KEY!,
      allowLocal: process.env.MEOW_MODEL_ALLOW_LOCAL === '1',
    })
  : undefined;
const app = createApp({
  modelBroker,
  databasePath: process.env.MEOW_DATABASE,
  mode,
  token: process.env.MEOW_AUTH_TOKEN,
  userId: process.env.MEOW_USER_ID,
  authSecret: mode === 'session' ? persistentSecret() : undefined,
  authBaseURL: process.env.MEOW_AUTH_BASE_URL ?? `http://localhost:${port}`,
  trustedOrigins,
  // Reservation only, NEVER automatic promotion: existing users require a future trusted host
  // bootstrap/CLI to write mw_platform_roles. No public request may grant administrator roles.
  reservedAdminEmails: process.env.MEOW_ADMIN_EMAILS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  logger: true,
});
const root = resolve('dist');
if (existsSync(root)) await app.register(fastifyStatic, { root });
app.setNotFoundHandler((request, reply) => {
  if (request.method === 'GET' && !request.url.startsWith('/api/') && existsSync(root))
    return reply.sendFile('index.html');
  return reply.code(404).send({ error: '未找到资源；前端请先执行 pnpm build' });
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void app.close();
  });
// Listen waits for onReady, including Better Auth schema migrations.
await app.listen({ host: '127.0.0.1', port });
if (mode === 'local') app.log.warn('本地单用户模式：仅供本人使用，不得通过反向代理公开到网络。');
if (mode === 'session' && !process.env.MEOW_AUTH_SECRET)
  app.log.warn(
    '使用持久本地身份密钥；部署需配置 MEOW_AUTH_SECRET 或持久保留 .data/auth-secret；Windows 请由宿主管理文件 ACL。',
  );

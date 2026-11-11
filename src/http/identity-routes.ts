import type { FastifyInstance } from 'fastify';
import type { HttpContext } from './context.ts';

export function registerIdentityRoutes(
  app: FastifyInstance,
  { mode, owner, identity, sessions }: HttpContext,
) {
  app.get('/api/auth/me', async (request) => ({
    mode,
    user:
      mode === 'session'
        ? (sessions.get(request)?.user ?? null)
        : { id: owner, username: '本地用户', role: 'user' },
    csrfToken: sessions.get(request)?.csrfToken ?? '',
  }));
  // Explicitly expose only the standard credential endpoints. No legacy password or role API.
  const email = { type: 'string', minLength: 3, maxLength: 254 };
  const password = { type: 'string', minLength: 1, maxLength: 256 };
  for (const action of ['sign-up/email', 'sign-in/email', 'sign-out'] as const) {
    const signup = action === 'sign-up/email';
    app.post(
      `/api/auth/${action}`,
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            properties:
              action === 'sign-out'
                ? {}
                : {
                    email,
                    password,
                    ...(signup
                      ? { name: { type: 'string', minLength: 1, maxLength: 160 } }
                      : { rememberMe: { type: 'boolean' } }),
                  },
            ...(action === 'sign-out'
              ? {}
              : { required: signup ? ['email', 'password', 'name'] : ['email', 'password'] }),
          },
        },
      },
      async (request, reply) => {
        if (!identity) return reply.code(409).send({ error: '请启用 session 模式使用账号功能' });
        if (
          signup &&
          identity.reservedAdminEmails.has(
            String((request.body as { email: string }).email)
              .trim()
              .toLowerCase(),
          )
        )
          return reply.code(403).send({ error: '此邮件由宿主保留，禁止公开注册' });
        return identity.handle(request, reply);
      },
    );
  }
  app.get('/api/auth/get-session', async (request, reply) => {
    if (!identity) return reply.code(409).send({ error: '请启用 session 模式使用账号功能' });
    return identity.handle(request, reply);
  });
}

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type IdentityOptions = {
  authBaseURL?: string;
  authSecret?: string;
  trustedOrigins?: string[];
  reservedAdminEmails?: string[];
};
export type IdentitySession = {
  user: { id: string; username: string; role: 'user' | 'admin' };
  csrfToken: string;
};

/** Only the host may change mw_platform_roles. Public signup never writes roles. */
export class Identity {
  readonly auth;
  private readonly config;
  private readonly secret: string;
  readonly baseURL: string;
  readonly trustedOrigins: Set<string>;
  readonly reservedAdminEmails: Set<string>;

  constructor(
    private readonly db: DatabaseSync,
    options: IdentityOptions = {},
  ) {
    this.secret = options.authSecret ?? randomBytes(48).toString('base64url');
    if (this.secret.length < 32) throw new Error('Session authSecret 必须至少 32 字符');
    const url = new URL(options.authBaseURL ?? 'http://localhost:3000');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('authBaseURL 必须是 HTTP(S) origin');
    this.baseURL = url.origin;
    this.trustedOrigins = new Set([
      this.baseURL,
      // Explicit same-port IPv4 loopback aliases only; never trust arbitrary Host headers.
      ...(['localhost', '127.0.0.1'].includes(url.hostname)
        ? [
            new URL(
              `${url.protocol}//${url.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}${url.port ? ':' + url.port : ''}`,
            ).origin,
          ]
        : []),
      ...(options.trustedOrigins ?? []).map((origin) => {
        const parsed = new URL(origin);
        if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol))
          throw new Error('trustedOrigins 必须是明确 HTTP(S) origin，不允许通配符');
        return origin;
      }),
    ]);
    this.reservedAdminEmails = new Set(
      (options.reservedAdminEmails ?? []).map((email) => email.trim().toLowerCase()),
    );
    this.config = {
      database: db,
      baseURL: this.baseURL,
      secret: this.secret,
      trustedOrigins: [...this.trustedOrigins],
      emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
      session: { cookieCache: { enabled: false } },
      rateLimit: {
        enabled: true,
        storage: 'database' as const,
        customRules: { '/sign-up/email': { window: 60, max: 10 } },
      },
      // Never trust user-supplied forwarding headers. The bridge overwrites this header.
      advanced: {
        ipAddress: { ipAddressHeaders: ['x-meow-identity-ip'] },
        database: { generateId: () => randomUUID() },
      },
      // Avoid auth library logs accidentally including credentials or session material.
      logger: { disabled: true },
    };
    this.auth = betterAuth(this.config);
  }

  async ready() {
    const migrations = await getMigrations(this.config);
    await migrations.runMigrations();
    this.db.exec(`CREATE TABLE IF NOT EXISTS mw_platform_roles (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin'))
    )`);
  }

  private headers(request: FastifyRequest) {
    const headers = fromNodeHeaders(request.headers);
    headers.set('x-meow-identity-ip', request.ip);
    return headers;
  }

  async session(request: FastifyRequest): Promise<IdentitySession | null> {
    const result = await this.auth.api.getSession({ headers: this.headers(request) });
    if (!result) return null;
    const row = this.db
      .prepare('SELECT role FROM mw_platform_roles WHERE user_id=?')
      .get(result.user.id);
    return {
      user: {
        id: result.user.id,
        username: result.user.name,
        role: row?.role === 'admin' ? 'admin' : 'user',
      },
      // Session-bound signed double-submit token: no independent browser-readable cookie required.
      csrfToken: createHmac('sha256', this.secret)
        .update('meow-csrf\0')
        .update(result.session.token)
        .digest('base64url'),
    };
  }

  verifyCsrf(session: IdentitySession, received: string) {
    const expected = Buffer.from(session.csrfToken);
    const actual = Buffer.from(received);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async handle(request: FastifyRequest, reply: FastifyReply) {
    const response = await this.auth.handler(
      new Request(new URL(request.url, this.baseURL), {
        method: request.method,
        headers: this.headers(request),
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      }),
    );
    reply.code(response.status);
    for (const [key, value] of response.headers) if (key !== 'set-cookie') reply.header(key, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    return reply.send(await response.text());
  }
}

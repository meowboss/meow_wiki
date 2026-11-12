import Fastify, { type FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { registerWorkshop, type WorkshopOptions } from './modules/workshop/routes.ts';
import { Identity, type IdentityOptions, type IdentitySession } from './identity.ts';
import { createKernel } from './plugins/official.ts';
import { Store } from './store.ts';
import { ComponentService } from './components.ts';
import { registerKnowledge } from './knowledge-http.ts';
import type { ModelBroker } from './models.ts';
import { createHttpContext } from './http/context.ts';
import { registerSecurity } from './http/security.ts';
import { registerHealth } from './http/health.ts';
import { registerIdentityRoutes } from './http/identity-routes.ts';
import { PagesService } from './modules/pages/service.ts';
import { registerPageRoutes } from './modules/pages/routes.ts';
import { WorkspacesService } from './modules/workspaces/service.ts';
import { registerWorkspaceRoutes } from './modules/workspaces/routes.ts';
import { registerExtensionRoutes } from './modules/extensions/routes.ts';
import { ExtensionsService } from './modules/extensions/service.ts';
import { DomainsService } from './modules/domains/service.ts';
import { registerDomainRoutes } from './modules/domains/routes.ts';
import { registerMcpRoutes } from './modules/mcp/routes.ts';
import { registerPluginRuntime } from './modules/plugin-runtime/routes.ts';
import { registerProfileRoutes } from './modules/profile/routes.ts';

export type AppOptions = IdentityOptions & {
  modelBroker?: ModelBroker;
  workshop?: WorkshopOptions;
  databasePath?: string;
  store?: Store;
  mode?: 'local' | 'token' | 'session';
  token?: string;
  userId?: string;
  /** @deprecated Ignored: public signup cannot grant roles. */ adminUsernames?: string[];
  /** @deprecated Ignored. */ adminBootstrapToken?: string;
  logger?: boolean;
};

export function createApp(options: AppOptions = {}) {
  const mode = options.mode ?? 'local';
  if (mode === 'token' && (!options.token || options.token.length < 32 || !options.userId)) {
    throw new Error('Token 模式需要至少 32 字符 MEOW_AUTH_TOKEN 和明确的 MEOW_USER_ID');
  }
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-csrf-token"]',
            'res.headers["set-cookie"]',
          ],
          serializers: {
            req: (request) => ({
              method: request.method,
              url: String(request.url).split('?')[0],
              remoteAddress: request.ip,
            }),
          },
        }
      : false,
    bodyLimit: 2 * 1024 * 1024, // Supports 200k Unicode Markdown plus JSON escaping; route/schema limits remain stricter.
    ajv: { customOptions: { removeAdditional: false } },
  });
  const store = options.store ?? new Store(options.databasePath);
  const components = new ComponentService(store.db);
  const kernel = createKernel();
  // Identity is configured by the host, never accepted from request headers/body.
  const owner = options.userId ?? 'local-owner';
  if (mode !== 'session') store.ensure(owner);
  // Embedding uses an ephemeral secret; the server supplies a persistent host secret.
  const identity = mode === 'session' ? new Identity(store.db, options) : undefined;
  const sessions = new WeakMap<FastifyRequest, IdentitySession>();
  const context = createHttpContext({ store, components, kernel, mode, owner, identity, sessions });
  app.addHook('onReady', async () => {
    await identity?.ready();
  });
  app.addHook('onClose', async () => {
    try {
      kernel.dispose();
    } finally {
      if (!options.store) store.close();
    }
  });
  registerSecurity(app, context, options.token);
  registerHealth(app, store);
  registerIdentityRoutes(app, context);
  registerProfileRoutes(app, context);
  registerWorkspaceRoutes(app, context, new WorkspacesService(store, components, kernel));
  registerPageRoutes(app, context, new PagesService(store, kernel));
  registerExtensionRoutes(app, context, new ExtensionsService(store, kernel));
  registerKnowledge(app, store, context.caller, options.modelBroker);
  const domains = new DomainsService(store.db);
  registerDomainRoutes(app, context, domains);
  registerMcpRoutes(app, context, domains);
  registerPluginRuntime(app);
  registerWorkshop(
    app,
    context,
    options.workshop ?? {
      masterSecret: options.authSecret ?? randomBytes(48).toString('base64url'),
      allowedEndpoints: {},
    },
  );
  return app;
}

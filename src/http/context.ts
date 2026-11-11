import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Identity, IdentitySession } from '../identity.ts';
import type { Store, Workspace } from '../store.ts';
import type { ComponentService } from '../components.ts';
import type { Kernel } from '../kernel.ts';

/** Explicit HTTP dependencies shared by route adapters, not an application service locator. */
export type HttpContext = {
  store: Store;
  components: ComponentService;
  kernel: Kernel;
  mode: 'local' | 'token' | 'session';
  owner: string;
  identity: Identity | undefined;
  sessions: WeakMap<FastifyRequest, IdentitySession>;
  caller: (request: FastifyRequest) => string;
  scope: (request: FastifyRequest) => Workspace;
  requireAdmin: (request: FastifyRequest) => string;
};

export function createHttpContext(
  dependencies: Pick<
    HttpContext,
    'store' | 'components' | 'kernel' | 'mode' | 'owner' | 'identity' | 'sessions'
  >,
): HttpContext {
  const { store, mode, owner, sessions } = dependencies;
  const caller = (request: FastifyRequest) =>
    mode === 'session' ? sessions.get(request)!.user.id : owner;
  return {
    ...dependencies,
    caller,
    scope(request) {
      const parsed = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.query);
      const userId = caller(request);
      const id = parsed.workspaceId ?? store.ensure(userId);
      return store.get(userId, id);
    },
    requireAdmin(request) {
      if (mode !== 'session' || sessions.get(request)?.user.role !== 'admin') {
        throw Object.assign(new Error('需要平台管理员权限'), { statusCode: 403 });
      }
      return sessions.get(request)!.user.id;
    },
  };
}

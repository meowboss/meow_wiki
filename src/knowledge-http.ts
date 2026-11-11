import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { KnowledgeService } from './knowledge.ts';
import type { Store } from './store.ts';
import type { ModelBroker } from './models.ts';
import { Proposals } from './proposals.ts';
import { KnowledgeApplication } from './modules/knowledge/service.ts';
import { registerKnowledgeRoutes, type KnowledgeScope } from './modules/knowledge/routes.ts';
import { registerProposalRoutes } from './modules/proposals/routes.ts';

/** Compatibility composition entry, called after the host registers authentication. */
export function registerKnowledge(
  app: FastifyInstance,
  store: Store,
  caller: (request: FastifyRequest) => string,
  broker?: ModelBroker,
) {
  const knowledge = new KnowledgeService(store.db);
  const proposals = new Proposals(store.db, store, knowledge);
  const application = new KnowledgeApplication(store, knowledge, proposals, broker);
  const scope: KnowledgeScope = (request) => {
    const owner = caller(request);
    const { workspaceId } = z
      .object({ workspaceId: z.string().uuid().optional() })
      .parse(request.query);
    const workspace = store.get(owner, workspaceId ?? store.ensure(owner));
    return { owner, workspace };
  };
  registerKnowledgeRoutes(app, scope, application);
  registerProposalRoutes(app, scope, proposals, application);
}

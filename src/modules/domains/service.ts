import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { DomainRepository } from '../../infrastructure/sqlite/domain-repository.ts';
import {
  canMaintain,
  canContribute,
  createDomainSchema,
  updateDomainSchema,
  memberSchema,
  submitSchema,
  reviewSchema,
  searchSchema,
  type Domain,
  type DomainRole,
  type Contribution,
  type CreateDomainInput,
  type UpdateDomainInput,
  type MemberInput,
  type SubmitInput,
  type ReviewInput,
} from './domain.ts';

export class DomainError extends Error {
  constructor(
    readonly statusCode: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new DomainError(400, 'Invalid domain input');
  return result.data;
}
function conflict(): never {
  throw new DomainError(409, 'Domain revision or state conflict');
}

/** Synchronous application API. Caller is the authenticated user ID, never a workspace owner proxy. */
export class DomainsService {
  private readonly repository: DomainRepository;
  constructor(db: DatabaseSync) {
    this.repository = new DomainRepository(db);
  }

  private access(caller: string, id: string): { domain: Domain; role: DomainRole } {
    const domain = this.repository.get(caller, id);
    const role = this.repository.role(caller, id);
    if (!domain || !role) throw new DomainError(404, 'Domain not found');
    return { domain, role };
  }
  describe(caller: string, id: string) {
    const { domain, role } = this.access(caller, id);
    return { ...domain, role };
  }
  private require(allowed: boolean): void {
    if (!allowed) throw new DomainError(403, 'Domain permission denied');
  }
  create(caller: string, workspaceId: string, input: CreateDomainInput): Domain {
    const values = parse(createDomainSchema, input);
    return this.repository.transaction(() => {
      if (!this.repository.ownsWorkspace(caller, workspaceId))
        throw new DomainError(404, 'Workspace not found');
      if (!this.repository.userExists(caller)) throw new DomainError(403, 'Unknown user');
      if (this.repository.ownerCount(caller) >= 20)
        throw new DomainError(409, 'Domain limit reached');
      const domain: Domain = {
        id: randomUUID(),
        workspaceId,
        ownerId: caller,
        ...values,
        revision: 1,
      };
      this.repository.insert(domain);
      return domain;
    });
  }
  list(caller: string): Domain[] {
    return this.repository.list(caller);
  }
  get(caller: string, id: string): Domain {
    return this.access(caller, id).domain;
  }
  update(caller: string, id: string, input: UpdateDomainInput): Domain {
    const { expectedRevision, ...patch } = parse(updateDomainSchema, input);
    return this.repository.transaction(() => {
      const { domain, role } = this.access(caller, id);
      this.require(canMaintain(role));
      if (domain.revision !== expectedRevision) conflict();
      const next: Domain = {
        ...domain,
        name: patch.name ?? domain.name,
        description: patch.description ?? domain.description,
        buildProfile: patch.buildProfile ?? domain.buildProfile,
        revision: domain.revision + 1,
      };
      if (!this.repository.update(next, expectedRevision)) conflict();
      return next;
    });
  }
  setMember(caller: string, id: string, input: MemberInput) {
    const { userId, role } = parse(memberSchema, input);
    return this.repository.transaction(() => {
      const access = this.access(caller, id);
      this.require(access.role === 'owner');
      if (userId === access.domain.ownerId) throw new DomainError(409, 'Owner role is immutable');
      if (!this.repository.userExists(userId)) throw new DomainError(404, 'User not found');
      this.repository.setMember(id, userId, role);
      return { domainId: id, userId, role };
    });
  }
  removeMember(caller: string, id: string, userId: string): void {
    this.repository.transaction(() => {
      const { domain, role } = this.access(caller, id);
      this.require(role === 'owner');
      if (userId === domain.ownerId) throw new DomainError(409, 'Owner cannot be removed');
      this.repository.removeMember(id, userId);
    });
  }
  members(caller: string, id: string) {
    const { role } = this.access(caller, id);
    this.require(canMaintain(role));
    return this.repository.members(caller, id);
  }
  memberProfiles(caller: string, id: string) {
    this.members(caller, id);
    return this.repository.memberProfiles(caller, id);
  }
  invite(caller: string, id: string, email: string, role: 'reader' | 'contributor' | 'maintainer') {
    const access = this.access(caller, id);
    this.require(access.role === 'owner');
    const user = this.repository.userByEmail(email);
    if (!user) throw new DomainError(404, '未找到可邀请的注册账号');
    return this.setMember(caller, id, { userId: String(user.id), role });
  }
  submit(caller: string, id: string, input: SubmitInput): Contribution {
    const values = parse(submitSchema, input);
    return this.repository.transaction(() => {
      const { role } = this.access(caller, id);
      this.require(canContribute(role));
      if (this.repository.pendingByAuthor(caller, id) >= 100)
        throw new DomainError(409, '每位作者每域最多100条待审贡献');
      if (this.repository.contributionCount(caller, id) >= 500)
        throw new DomainError(409, 'Contribution limit reached');
      const contribution: Contribution = {
        id: randomUUID(),
        domainId: id,
        authorId: caller,
        ...values,
        status: 'pending',
        reviewerId: null,
        reason: null,
      };
      this.repository.insertContribution(contribution);
      return contribution;
    });
  }
  contributions(caller: string, id: string): Contribution[] {
    this.access(caller, id);
    return this.repository.contributions(caller, id);
  }
  review(caller: string, id: string, contributionId: string, input: ReviewInput): Contribution {
    const { decision, reason } = parse(reviewSchema, input);
    return this.repository.transaction(() => {
      const { domain, role } = this.access(caller, id);
      this.require(canMaintain(role));
      const contribution = this.repository
        .contributions(caller, id)
        .find((c) => c.id === contributionId);
      if (!contribution) throw new DomainError(404, 'Contribution not found');
      this.require(contribution.authorId !== caller);
      if (contribution.status !== 'pending') conflict();
      if (decision === 'published') {
        if (contribution.expectedDomainRevision !== domain.revision) conflict();
        if (!this.repository.update({ ...domain, revision: domain.revision + 1 }, domain.revision))
          conflict();
      }
      const reviewed = { ...contribution, status: decision, reviewerId: caller, reason };
      if (!this.repository.review(reviewed)) conflict();
      return reviewed;
    });
  }
  pruneRejected(caller: string, id: string) {
    const { role } = this.access(caller, id);
    this.require(canMaintain(role));
    return { removed: this.repository.pruneRejected(caller, id) };
  }
  published(caller: string, id: string, after = '', limit = 20): Contribution[] {
    this.access(caller, id);
    if (after.length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new DomainError(400, 'Invalid publication cursor');
    return this.repository.published(caller, id, after, limit);
  }
  publishedById(caller: string, id: string, contributionId: string) {
    this.access(caller, id);
    return this.repository.publishedById(caller, id, contributionId);
  }
  search(caller: string, id: string, query: string): Contribution[] {
    this.access(caller, id);
    return this.repository.search(caller, id, parse(searchSchema, query));
  }
}

import { z } from 'zod';

export const buildProfileSchema = z.enum(['general', 'project', 'research', 'product']);
export const memberRoleSchema = z.enum(['reader', 'contributor', 'maintainer']);
const revisionSchema = z.number().int().positive();
const nameSchema = z.string().trim().min(1).max(200);
export const createDomainSchema = z
  .object({
    name: nameSchema,
    description: z.string().max(10000).default(''),
    buildProfile: buildProfileSchema.default('general'),
  })
  .strict();
export const updateDomainSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().max(10000).optional(),
    buildProfile: buildProfileSchema.optional(),
    expectedRevision: revisionSchema,
  })
  .strict();
export const memberSchema = z
  .object({ userId: z.string().min(1), role: memberRoleSchema })
  .strict();
export const submitSchema = z
  .object({
    title: nameSchema,
    content: z.string().min(1).max(100000),
    expectedDomainRevision: revisionSchema,
  })
  .strict();
export const reviewSchema = z
  .object({
    decision: z.enum(['published', 'rejected']),
    reason: z.string().max(10000).default(''),
  })
  .strict();
export const searchSchema = z.string().trim().min(1).max(500);

export type BuildProfile = z.infer<typeof buildProfileSchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
export type DomainRole = MemberRole | 'owner';
export type Domain = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  description: string;
  buildProfile: BuildProfile;
  revision: number;
};
export type Membership = { domainId: string; userId: string; role: DomainRole };
export type Contribution = {
  id: string;
  domainId: string;
  authorId: string;
  title: string;
  content: string;
  expectedDomainRevision: number;
  status: 'pending' | 'published' | 'rejected';
  reviewerId: string | null;
  reason: string | null;
};
export type CreateDomainInput = z.input<typeof createDomainSchema>;
export type UpdateDomainInput = z.input<typeof updateDomainSchema>;
export type MemberInput = z.input<typeof memberSchema>;
export type SubmitInput = z.input<typeof submitSchema>;
export type ReviewInput = z.input<typeof reviewSchema>;

export function canMaintain(role: DomainRole): boolean {
  return role === 'owner' || role === 'maintainer';
}
export function canContribute(role: DomainRole): boolean {
  return canMaintain(role) || role === 'contributor';
}
export function canReadContribution(
  role: DomainRole,
  caller: string,
  contribution: Contribution,
): boolean {
  return (
    canMaintain(role) ||
    contribution.status === 'published' ||
    (contribution.authorId === caller && contribution.status === 'pending')
  );
}

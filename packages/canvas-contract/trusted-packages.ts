import { z } from 'zod';

/** Open-ended IDs for renderers shipped by the application, not a closed renderer enum. */
export const trustedViewIdSchema = z
  .string()
  .max(110)
  .regex(/^official\.[a-z][a-z0-9-]{0,47}\.[a-z][a-z0-9-]{0,47}$/);
export type TrustedViewId = z.infer<typeof trustedViewIdSchema>;

const trustedPackageIdSchema = z
  .string()
  .max(57)
  .regex(/^official\.[a-z][a-z0-9-]{0,47}$/);

// SemVer 2.0.0, including optional prerelease/build identifiers; bound metadata size.
const versionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
  );

const trustedPackageViewSchema = z.strictObject({
  id: trustedViewIdSchema,
  title: z.string().min(1).max(100),
  surfaces: z
    .array(z.enum(['home', 'wiki', 'collaboration']))
    .min(1)
    .max(3)
    .refine((surfaces) => new Set(surfaces).size === surfaces.length, {
      message: 'View surfaces must be unique',
    }),
});
export type TrustedPackageView = z.infer<typeof trustedPackageViewSchema>;

/**
 * Metadata only for trusted packages compiled into the application registry.
 * Parsing metadata neither loads a renderer nor grants execution or permissions.
 * Registry loading must use application-owned compile-time imports, never metadata paths.
 */
export const trustedPackageSchema = z
  .strictObject({
    id: trustedPackageIdSchema,
    version: versionSchema,
    views: z.array(trustedPackageViewSchema).min(1).max(20),
  })
  .superRefine((metadata, context) => {
    const seen = new Set<string>();
    for (const [index, view] of metadata.views.entries()) {
      if (!view.id.startsWith(`${metadata.id}.`)) {
        context.addIssue({
          code: 'custom',
          message: 'View ID must belong to its package namespace',
          path: ['views', index, 'id'],
        });
      }
      if (seen.has(view.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Package view IDs must be unique',
          path: ['views', index, 'id'],
        });
      }
      seen.add(view.id);
    }
  });
export type TrustedPackage = z.infer<typeof trustedPackageSchema>;

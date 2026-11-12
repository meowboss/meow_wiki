import { z } from 'zod';
import { validateLayoutTree } from './layout-tree';
import { trustedViewIdSchema } from './trusted-packages';
export { trustedViewIdSchema, trustedPackageSchema } from './trusted-packages';

export { layoutTreeSchema, validateLayoutTree } from './layout-tree';
export type { LayoutTree } from './layout-tree';

/** Browser-safe C0 canvas contract. Coordinates are logical cells in all layouts. */
export const surfaceSchema = z.enum(['home', 'wiki', 'collaboration']);
export type CanvasSurface = z.infer<typeof surfaceSchema>;
const coreViewIdSchema = z.enum([
  'wiki.directory',
  'wiki.document',
  'wiki.header',
  'wiki.stats',
  'wiki.ask',
  'wiki.footer',
  'wiki.toolbar',
  'home.content',
  'home.header',
  'home.controls',
  'collaboration.content',
  'collaboration.header',
  'collaboration.directory',
  'collaboration.detail',
  'builtin.text',
  'component.render',
  'builtin.search',
  'builtin.directory',
  'builtin.image',
  'builtin.video',
  'builtin.pet',
]);
export const canvasViewIdSchema = z.union([coreViewIdSchema, trustedViewIdSchema]);

const hex = z.string().regex(/^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/);
/** Opaque six-digit colors only: theme values can never carry CSS or URLs. */
const themeHex = z.string().regex(/^#[\da-fA-F]{6}$/);
export const canvasThemeSchema = z.strictObject({
  foreground: themeHex.optional(),
  accent: themeHex.optional(),
  font: z.enum(['sans', 'serif', 'mono']).optional(),
  fontSize: z.number().int().min(14).max(22).optional(),
  lineHeight: z.number().min(1.3).max(2.2).optional(),
});
export type CanvasTheme = z.infer<typeof canvasThemeSchema>;
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const instanceSchema = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
    viewId: canvasViewIdSchema,
    visible: z.boolean(),
    layer: z.enum(['background', 'content', 'overlay']).default('content'),
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(100),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(24),
    config: z.strictObject({
      text: z.string().max(5000).optional(),
      // Old wiki.document instances keep their embedded reader actions until explicitly split.
      splitToolbar: z.boolean().optional(),
      splitHome: z.boolean().optional(),
      componentId: z.string().uuid().optional(),
      releaseId: z.string().uuid().optional(),
      assetId: z.string().uuid().optional(),
      alt: z.string().max(300).optional(),
      muted: z.boolean().optional(),
      autoplay: z.boolean().optional(),
      loop: z.boolean().optional(),
    }),
    style: z.strictObject({
      background: hex.optional(),
      color: hex.optional(),
      padding: z.number().int().min(0).max(48).optional(),
      borderRadius: z.number().int().min(0).max(40).optional(),
    }),
  })
  .refine((instance) => instance.x + instance.w <= 12, {
    message: 'Instance exceeds the 12-column logical grid',
    path: ['w'],
  });
export type CanvasInstance = z.infer<typeof instanceSchema>;

const documentShape = {
  schemaVersion: z.literal(2),
  surface: surfaceSchema,
  layout: z.enum(['grid', 'flow', 'free']),
  columns: z.literal(12),
  gap: z.number().int().min(0).max(48),
  background: hex,
  theme: canvasThemeSchema.optional(),
  instances: z.array(instanceSchema).max(40),
  // Unknown intentionally: bounded iterative validation must precede recursive tree parsing.
  tree: z.unknown().optional(),
};
const uniqueIds = (document: { instances: { id: string }[] }) =>
  new Set(document.instances.map((instance) => instance.id)).size === document.instances.length;
const uniqueMessage = { message: 'Instance IDs must be unique', path: ['instances'] };
const validateCompositionTree = (
  document: { tree?: unknown; instances: { id: string }[] },
  context: z.RefinementCtx,
) => {
  if (document.tree === undefined) return;
  const result = validateLayoutTree(
    document.tree,
    document.instances.map((instance) => instance.id),
  );
  for (const message of result.issues)
    context.addIssue({ code: 'custom', message, path: ['tree'] });
};

/** Editable document excludes the server-owned revision. Array order defines flow order. */
export const compositionDocumentSchema = z
  .strictObject(documentShape)
  .refine(uniqueIds, uniqueMessage)
  .superRefine(validateCompositionTree)
  .refine(
    (document) => {
      const views = document.instances
        .filter(
          (i) =>
            ![
              'builtin.text',
              'component.render',
              'builtin.search',
              'builtin.directory',
              'builtin.image',
              'builtin.video',
              'builtin.pet',
            ].includes(i.viewId) && !trustedViewIdSchema.safeParse(i.viewId).success,
        )
        .map((i) => i.viewId);
      return new Set(views).size === views.length;
    },
    {
      message: 'Legacy business views are singletons; duplicate independent text instances instead',
      path: ['instances'],
    },
  );
export const compositionSchema = z
  .strictObject({ ...documentShape, revision })
  .refine(uniqueIds, uniqueMessage)
  .superRefine(validateCompositionTree)
  .refine(
    (document) => {
      const views = document.instances
        .filter(
          (i) =>
            ![
              'builtin.text',
              'component.render',
              'builtin.search',
              'builtin.directory',
              'builtin.image',
              'builtin.video',
              'builtin.pet',
            ].includes(i.viewId) && !trustedViewIdSchema.safeParse(i.viewId).success,
        )
        .map((i) => i.viewId);
      return new Set(views).size === views.length;
    },
    {
      message: 'Legacy business views are singletons; duplicate independent text instances instead',
      path: ['instances'],
    },
  );
export const compositionUpdateSchema = z.strictObject({
  expectedRevision: revision,
  composition: compositionDocumentSchema,
});
export type CompositionDocument = z.infer<typeof compositionDocumentSchema>;
export type Composition = z.infer<typeof compositionSchema>;
export type CompositionUpdate = z.infer<typeof compositionUpdateSchema>;

/** Fresh objects with stable IDs; legacy mw_layouts are deliberately not migrated in C0. */
export function createDefaultComposition(surface: CanvasSurface): Composition {
  surfaceSchema.parse(surface);
  const instance = (
    id: string,
    viewId: CanvasInstance['viewId'],
    x: number,
    w: number,
  ): CanvasInstance => ({
    id,
    viewId,
    visible: true,
    layer: 'content',
    x,
    y: 0,
    w,
    h: 1,
    config: {},
    style: {},
  });
  return {
    schemaVersion: 2,
    surface,
    revision: 0,
    layout: 'grid',
    columns: 12,
    gap: 16,
    background: '#ffffff',
    instances:
      surface === 'wiki'
        ? [
            instance('wiki-header', 'wiki.header', 0, 12),
            { ...instance('wiki-stats', 'wiki.stats', 0, 12), y: 1 },
            { ...instance('wiki-directory', 'wiki.directory', 0, 4), y: 2, h: 2 },
            { ...instance('wiki-toolbar', 'wiki.toolbar', 4, 8), y: 2 },
            {
              ...instance('wiki-document', 'wiki.document', 4, 8),
              y: 3,
              config: { splitToolbar: true },
            },
            { ...instance('wiki-ask', 'wiki.ask', 0, 12), y: 4 },
            { ...instance('wiki-footer', 'wiki.footer', 0, 12), y: 5 },
          ]
        : surface === 'home'
          ? [
              instance('home-header', 'home.header', 0, 12),
              { ...instance('home-controls', 'home.controls', 0, 12), y: 1 },
              {
                ...instance('home-content', 'home.content', 0, 12),
                y: 2,
                config: { splitHome: true },
              },
            ]
          : [
              instance('collaboration-header', 'collaboration.header', 0, 12),
              { ...instance('collaboration-directory', 'collaboration.directory', 0, 4), y: 1 },
              { ...instance('collaboration-detail', 'collaboration.detail', 4, 8), y: 1 },
            ],
  };
}

import { z } from 'zod';

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

export type LayoutTree =
  | {
      id: string;
      kind: 'flow';
      direction?: 'row' | 'column';
      gap?: number;
      children?: LayoutTree[];
    }
  | { id: string; kind: 'grid'; columns?: number; gap?: number; children?: LayoutTree[] }
  | { id: string; kind: 'view'; instanceId: string };

/** Structural contract only; use validateLayoutTree for bounded, complete instance coverage. */
export const layoutTreeSchema: z.ZodType<LayoutTree> = z.discriminatedUnion('kind', [
  z.strictObject({
    id: slug,
    kind: z.literal('flow'),
    direction: z.enum(['row', 'column']).optional(),
    gap: z.number().int().min(0).max(48).optional(),
    children: z
      .array(z.lazy(() => layoutTreeSchema))
      .max(40)
      .optional(),
  }),
  z.strictObject({
    id: slug,
    kind: z.literal('grid'),
    columns: z.number().int().min(1).max(12).optional(),
    gap: z.number().int().min(0).max(48).optional(),
    children: z
      .array(z.lazy(() => layoutTreeSchema))
      .max(40)
      .optional(),
  }),
  z.strictObject({ id: slug, kind: z.literal('view'), instanceId: slug }),
]);

/**
 * Root depth is 1. Every supplied instance must occur in exactly one view leaf.
 * Iterative preflight bounds work before recursive Zod parsing, including for non-JSON JS input.
 * This foundation is not yet wired into the composition contract or renderer.
 */
export function validateLayoutTree(
  tree: unknown,
  instanceIds: string[],
): { valid: boolean; issues: string[] } {
  try {
    const pending: { node: unknown; depth: number }[] = [{ node: tree, depth: 1 }];
    const seen = new WeakSet<object>();
    let count = 0;
    while (pending.length > 0) {
      const { node, depth } = pending.pop()!;
      if (++count > 80) return { valid: false, issues: ['Layout tree exceeds maximum 80 nodes'] };
      if (depth > 6) return { valid: false, issues: ['Layout tree exceeds maximum depth 6'] };
      if (typeof node !== 'object' || node === null || Array.isArray(node)) {
        return { valid: false, issues: ['Layout tree nodes must be objects'] };
      }
      if (seen.has(node)) {
        return { valid: false, issues: ['Layout tree contains a cycle or shared node object'] };
      }
      seen.add(node);
      const children = (node as { children?: unknown }).children;
      if (children !== undefined) {
        if (!Array.isArray(children) || children.length > 40) {
          return { valid: false, issues: ['Node children must be an array of at most 40 nodes'] };
        }
        for (const child of children) pending.push({ node: child, depth: depth + 1 });
      }
    }

    const parsed = layoutTreeSchema.safeParse(tree);
    if (!parsed.success) {
      return {
        valid: false,
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || 'tree'}: ${issue.message}`,
        ),
      };
    }

    const issues: string[] = [];
    const knownInstances = new Set(instanceIds);
    const nodeIds = new Set<string>();
    const references = new Set<string>();
    const nodes: LayoutTree[] = [parsed.data];
    while (nodes.length > 0) {
      const node = nodes.pop()!;
      if (nodeIds.has(node.id)) issues.push(`Duplicate node ID: ${node.id}`);
      nodeIds.add(node.id);
      if (node.kind === 'view') {
        if (!knownInstances.has(node.instanceId)) {
          issues.push(`Unknown instance reference: ${node.instanceId}`);
        }
        if (references.has(node.instanceId)) {
          issues.push(`Duplicate instance reference: ${node.instanceId}`);
        }
        references.add(node.instanceId);
      } else {
        nodes.push(...(node.children ?? []));
      }
    }
    for (const id of knownInstances) {
      if (!references.has(id)) issues.push(`Missing instance reference: ${id}`);
    }
    return { valid: issues.length === 0, issues };
  } catch {
    // Accessors/proxies are not JSON data; never expose their exceptions as validation crashes.
    return { valid: false, issues: ['Layout tree must be readable, acyclic JSON-compatible data'] };
  }
}

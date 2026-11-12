import type { CSSProperties, ReactNode } from 'react';
import { validateLayoutTree, type LayoutTree } from '../../../packages/canvas-contract/index';
import type { CanvasInstance } from './useCanvasComposition';

/** Refuse malformed/unbounded draft data before any recursive rendering or editing. */
export function readCanvasTree(tree: unknown, instanceIds: string[]): LayoutTree {
  const result = validateLayoutTree(tree, instanceIds);
  if (!result.valid) throw new Error(result.issues.join('; '));
  return tree as LayoutTree;
}

function nextNodeId(tree: LayoutTree, prefix: string): string {
  const ids = new Set<string>();
  const nodes = [tree];
  while (nodes.length) {
    const node = nodes.pop()!;
    ids.add(node.id);
    if (node.kind !== 'view') nodes.push(...(node.children ?? []));
  }
  let index = 1;
  while (ids.has(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}

/** Preserve existing nesting; a view root is wrapped only when a second leaf is added. */
export function appendCanvasTreeInstance(tree: LayoutTree, instanceId: string): LayoutTree {
  const leaf: LayoutTree = { id: nextNodeId(tree, 'view'), kind: 'view', instanceId };
  return tree.kind === 'view'
    ? { id: nextNodeId(tree, 'root'), kind: 'flow', direction: 'column', children: [tree, leaf] }
    : { ...tree, children: [...(tree.children ?? []), leaf] };
}

/** Prune the removed leaf and empty ancestors without flattening surviving groups. */
export function removeCanvasTreeInstance(tree: LayoutTree, instanceId: string): LayoutTree {
  function prune(node: LayoutTree): LayoutTree | null {
    if (node.kind === 'view') return node.instanceId === instanceId ? null : node;
    const original = node.children ?? [];
    const children = original.map(prune).filter((child) => child !== null);
    const changed =
      children.length !== original.length ||
      children.some((child, index) => child !== original[index]);
    if (!changed) return node;
    return children.length ? { ...node, children } : null;
  }
  return prune(tree) ?? { id: tree.id, kind: 'flow', direction: 'column', children: [] };
}

type Props = {
  tree: unknown;
  instances: CanvasInstance[];
  renderInstance: (instance: CanvasInstance, nested: boolean) => ReactNode;
};

export default function CanvasTree({ tree, instances, renderInstance }: Props) {
  let root: LayoutTree;
  try {
    root = readCanvasTree(
      tree,
      instances.map((instance) => instance.id),
    );
  } catch {
    // A corrupt local draft must not silently masquerade as a flat layout.
    return (
      <p className="canvas-error" role="alert">
        嵌套布局无效，请撤销修改或重新加载布局。
      </p>
    );
  }
  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  function renderNode(node: LayoutTree): ReactNode {
    if (node.kind === 'view') {
      const instance = byId.get(node.instanceId);
      // Background and overlay instances are mounted exactly once, as canvas siblings.
      if (!instance || instance.layer !== 'content') return null;
      return renderInstance(instance, true);
    }
    const children = (node.children ?? []).map(renderNode).filter((child) => child !== null);
    if (!children.length) return null;
    const style = {
      '--canvas-tree-gap': node.gap === undefined ? 'var(--canvas-gap)' : `${node.gap}px`,
      '--canvas-tree-columns': node.kind === 'grid' ? (node.columns ?? 1) : undefined,
      flexDirection: node.kind === 'flow' ? (node.direction ?? 'column') : undefined,
    } as CSSProperties;
    return (
      <div
        key={node.id}
        data-tree-node-id={node.id}
        className={`canvas-tree-node canvas-tree-${node.kind}`}
        style={style}
      >
        {children}
      </div>
    );
  }
  return <div className="canvas-tree-root">{renderNode(root)}</div>;
}

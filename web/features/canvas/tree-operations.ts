import { validateLayoutTree, type LayoutTree } from '../../../packages/canvas-contract/layout-tree';

type ContainerKind = 'row' | 'column' | 'grid';

function instanceIds(tree: LayoutTree): string[] {
  const result = validateLayoutTree(tree, []);
  // A preflight using no instances may only report unknown references on a well-formed tree.
  const structuralIssues = result.issues.filter(
    (issue) => !issue.startsWith('Unknown instance reference:'),
  );
  if (structuralIssues.length) throw new Error(structuralIssues.join('; '));
  const ids: string[] = [];
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'view') ids.push(node.instanceId);
    else pending.push(...(node.children ?? []));
  }
  return ids;
}

function checked(tree: LayoutTree, ids: string[]): LayoutTree {
  const result = validateLayoutTree(tree, ids);
  if (!result.valid) throw new Error(result.issues.join('; '));
  return tree;
}

function find(tree: LayoutTree, id: string): LayoutTree | undefined {
  if (tree.id === id) return tree;
  if (tree.kind !== 'view') {
    for (const child of tree.children ?? []) {
      const found = find(child, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Stable leaf IDs; instance order remains the original flat reading order. */
export function createTree(ids: readonly string[]): LayoutTree {
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate instance IDs');
  return checked(
    {
      id: 'root',
      kind: 'flow',
      direction: 'column',
      children: ids.map((instanceId, index) => ({ id: `node-${index}`, kind: 'view', instanceId })),
    },
    [...ids],
  );
}

/** Caller supplies a UUID so this operation stays deterministic and pure. */
export function addContainer(
  tree: LayoutTree,
  targetId: string,
  kind: ContainerKind,
  nodeId: string,
): LayoutTree {
  const ids = instanceIds(tree);
  const target = find(tree, targetId);
  if (!target || target.kind === 'view') throw new Error('Target must be an existing container');
  if (find(tree, nodeId)) throw new Error(`Duplicate node ID: ${nodeId}`);
  const child: LayoutTree =
    kind === 'grid'
      ? { id: nodeId, kind: 'grid', columns: 2, children: [] }
      : { id: nodeId, kind: 'flow', direction: kind, children: [] };
  function append(node: LayoutTree): LayoutTree {
    if (node.kind === 'view') return node;
    if (node.id === targetId) return { ...node, children: [...(node.children ?? []), child] };
    const children = node.children?.map(append);
    return children?.some((item, index) => item !== node.children?.[index])
      ? { ...node, children }
      : node;
  }
  return checked(append(tree), ids);
}

/** Only leaves move: containers never become their own descendants. */
export function moveLeaf(tree: LayoutTree, instanceId: string, targetId: string): LayoutTree {
  const ids = instanceIds(tree);
  const target = find(tree, targetId);
  if (!target || target.kind === 'view') throw new Error('Target must be an existing container');
  let leaf: Extract<LayoutTree, { kind: 'view' }> | undefined;
  function locate(node: LayoutTree) {
    if (node.kind === 'view') {
      if (node.instanceId === instanceId) leaf = node;
    } else node.children?.forEach(locate);
  }
  locate(tree);
  if (!leaf) throw new Error('Selected instance has no view leaf');
  function move(node: LayoutTree): LayoutTree {
    if (node.kind === 'view') return node;
    const original = node.children ?? [];
    const children = original.filter((child) => child !== leaf).map(move);
    if (node.id === targetId) children.push(leaf!);
    return children.length !== original.length ||
      children.some((child, index) => child !== original[index])
      ? { ...node, children }
      : node;
  }
  return checked(move(tree), ids);
}

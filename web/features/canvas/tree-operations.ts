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

type ContainerPatch = { gap?: number; columns?: number; direction?: 'row' | 'column' };

/** Only the path to the edited node is copied; all other references stay stable. */
function replaceNode(tree: LayoutTree, id: string, replacement: LayoutTree): LayoutTree {
  if (tree.id === id) return replacement;
  if (tree.kind === 'view') return tree;
  const children = tree.children?.map((child) => replaceNode(child, id, replacement));
  return children?.some((child, index) => child !== tree.children?.[index])
    ? { ...tree, children }
    : tree;
}

/** Container properties are strict: fields belonging to another kind are never ignored. */
export function updateContainer(tree: LayoutTree, id: string, patch: ContainerPatch): LayoutTree {
  const ids = instanceIds(tree);
  const target = find(tree, id);
  if (!target || target.kind === 'view') throw new Error('Target must be an existing container');
  const allowed = target.kind === 'grid' ? ['gap', 'columns'] : ['gap', 'direction'];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new Error('Container patch must be an object');
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key)) throw new Error(`Invalid ${target.kind} container field: ${key}`);
  }
  const replacement = { ...target, ...patch };
  const next = checked(replaceNode(tree, id, replacement), ids);
  return Object.entries(patch).every(([key, value]) => Reflect.get(target, key) === value)
    ? tree
    : next;
}

/** Reorder within the current parent only; the flat instances order is never involved. */
export function reorderLeaf(tree: LayoutTree, instanceId: string, delta: number): LayoutTree {
  const ids = instanceIds(tree);
  if (!Number.isSafeInteger(delta)) throw new Error('Reorder delta must be a safe integer');
  if (!ids.includes(instanceId)) throw new Error('Selected instance has no view leaf');
  let parent: Exclude<LayoutTree, { kind: 'view' }> | undefined;
  function locate(node: LayoutTree) {
    if (node.kind === 'view') return;
    if (node.children?.some((child) => child.kind === 'view' && child.instanceId === instanceId))
      parent = node;
    else node.children?.forEach(locate);
  }
  locate(tree);
  if (!parent) return checked(tree, ids);
  const original = parent.children!;
  const index = original.findIndex(
    (child) => child.kind === 'view' && child.instanceId === instanceId,
  );
  const destination = Math.max(0, Math.min(original.length - 1, index + delta));
  if (destination === index) return checked(tree, ids);
  const children = [...original];
  const [leaf] = children.splice(index, 1);
  children.splice(destination, 0, leaf!);
  return checked(replaceNode(tree, parent.id, { ...parent, children }), ids);
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

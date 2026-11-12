import { useState } from 'react';
import { compositionSchema, type Composition } from '../../../packages/canvas-contract/index';
import { validateLayoutTree, type LayoutTree } from '../../../packages/canvas-contract/layout-tree';
import {
  addContainer,
  createTree,
  moveLeaf,
  reorderLeaf,
  updateContainer,
} from './tree-operations';

type TreeComposition = Composition & { tree?: LayoutTree };
type Props = {
  composition: Composition;
  selectedId?: string;
  disabled: boolean;
  onChange: (composition: Composition) => void;
};
type Row = { node: LayoutTree; depth: number; label: string };

function rows(tree: LayoutTree, composition: Composition): Row[] {
  const result: Row[] = [];
  function visit(node: LayoutTree, depth: number) {
    const label =
      node.kind === 'view'
        ? `组件：${composition.instances.find((instance) => instance.id === node.instanceId)?.viewId ?? node.instanceId}`
        : `${node.kind === 'grid' ? '网格容器' : node.direction === 'row' ? '行容器' : '列容器'}（${node.id}）`;
    result.push({ node, depth, label });
    if (node.kind !== 'view') node.children?.forEach((child) => visit(child, depth + 1));
  }
  visit(tree, 1);
  return result;
}

export default function CanvasTreeInspector({
  composition,
  selectedId,
  disabled,
  onChange,
}: Props) {
  const [selectedContainer, setSelectedContainer] = useState('');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  const source = (composition as TreeComposition).tree;
  const validation =
    source === undefined
      ? undefined
      : validateLayoutTree(
          source,
          composition.instances.map((instance) => instance.id),
        );
  // A single-view root is legal in the contract; editing wraps it instead of losing its leaf.
  const tree: LayoutTree | undefined =
    validation?.valid && source
      ? source.kind === 'view'
        ? {
            id: source.id === 'root' ? 'layout-root' : 'root',
            kind: 'flow',
            direction: 'column',
            children: [source],
          }
        : source
      : undefined;
  const items = tree ? rows(tree, composition) : [];
  const containers = items.filter(({ node }) => node.kind !== 'view');
  const activeId = containers.some(({ node }) => node.id === selectedContainer)
    ? selectedContainer
    : (tree?.id ?? '');
  const targetId = containers.some(({ node }) => node.id === destination)
    ? destination
    : (tree?.id ?? '');

  const activeContainer = containers.find(({ node }) => node.id === activeId)?.node;
  const selectedLeaf = items.find(
    ({ node }) => node.kind === 'view' && node.instanceId === selectedId,
  );

  function change(operation: () => TreeComposition) {
    if (disabled) return;
    try {
      const next = operation();
      if (next.tree !== undefined) {
        const result = validateLayoutTree(
          next.tree,
          next.instances.map((instance) => instance.id),
        );
        if (!result.valid) throw new Error(result.issues.join('; '));
      }
      const parsed = compositionSchema.safeParse(next);
      if (!parsed.success)
        throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
      setError('');
      onChange(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '布局修改失败');
    }
  }

  return (
    <fieldset disabled={disabled} aria-label="嵌套布局">
      <legend>嵌套布局</legend>
      {source === undefined ? (
        <button
          type="button"
          onClick={() =>
            change(() => ({
              ...composition,
              tree: createTree(composition.instances.map((instance) => instance.id)),
            }))
          }
        >
          创建嵌套布局
        </button>
      ) : (
        <>
          {tree && (
            <>
              <p className="muted">
                最多 6 层、80 个节点；空容器也占用节点预算，每个容器最多 40 个子节点。
              </p>
              <ul aria-label="布局层列表">
                {items.map(({ node, depth, label }) => (
                  <li key={node.id}>
                    {`第 ${depth} 层 · `}
                    {node.kind === 'view' ? (
                      label
                    ) : (
                      <button
                        type="button"
                        aria-pressed={activeId === node.id}
                        onClick={() => setSelectedContainer(node.id)}
                      >
                        {node.id === tree.id ? `根 · ${label}` : label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {activeContainer && activeContainer.kind !== 'view' && (
                <div role="group" aria-label="容器属性">
                  <label>
                    容器间距
                    <input
                      type="number"
                      min={0}
                      max={48}
                      step={1}
                      value={activeContainer.gap ?? composition.gap}
                      onChange={(event) =>
                        change(() => ({
                          ...composition,
                          tree: updateContainer(tree, activeId, {
                            gap: event.target.valueAsNumber,
                          }),
                        }))
                      }
                    />
                  </label>
                  {activeContainer.kind === 'grid' ? (
                    <label>
                      网格列数
                      <input
                        type="number"
                        min={1}
                        max={12}
                        step={1}
                        value={activeContainer.columns ?? 1}
                        onChange={(event) =>
                          change(() => ({
                            ...composition,
                            tree: updateContainer(tree, activeId, {
                              columns: event.target.valueAsNumber,
                            }),
                          }))
                        }
                      />
                    </label>
                  ) : (
                    <label>
                      排列方向
                      <select
                        value={activeContainer.direction ?? 'column'}
                        onChange={(event) =>
                          change(() => ({
                            ...composition,
                            tree: updateContainer(tree, activeId, {
                              direction: event.target.value as 'row' | 'column',
                            }),
                          }))
                        }
                      >
                        <option value="row">横向</option>
                        <option value="column">纵向</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
              <div role="group" aria-label="添加容器">
                {(['row', 'column', 'grid'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() =>
                      change(() => ({
                        ...composition,
                        tree: addContainer(tree, activeId, kind, crypto.randomUUID()),
                      }))
                    }
                  >
                    {kind === 'row'
                      ? '添加行容器'
                      : kind === 'column'
                        ? '添加列容器'
                        : '添加网格容器'}
                  </button>
                ))}
              </div>
              <label>
                移动选中组件到容器
                <select value={targetId} onChange={(event) => setDestination(event.target.value)}>
                  {containers.map(({ node, label }) => (
                    <option key={node.id} value={node.id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!selectedId}
                onClick={() =>
                  change(() => ({
                    ...composition,
                    tree: moveLeaf(tree, selectedId!, targetId),
                  }))
                }
              >
                移动选中组件到容器
              </button>
              {selectedLeaf && (
                <div role="group" aria-label="嵌套组件顺序">
                  {([-1, 1] as const).map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() =>
                        change(() => ({
                          ...composition,
                          tree: reorderLeaf(tree, selectedId!, delta),
                        }))
                      }
                    >
                      {delta === -1 ? '嵌套前移' : '嵌套后移'}
                    </button>
                  ))}
                </div>
              )}
              {!selectedId && <p className="muted">请先在画布中选择组件；只能移动组件叶节点。</p>}
            </>
          )}
          <p className="muted">取消嵌套布局后将恢复原有平面布局方式和组件顺序，不会删除组件。</p>
          <button
            type="button"
            onClick={() => {
              if (disabled || !window.confirm('取消嵌套布局并恢复平面布局？组件与配置将保留。'))
                return;
              change(() => {
                const next = { ...composition } as TreeComposition;
                delete next.tree;
                return next;
              });
            }}
          >
            取消嵌套布局
          </button>
        </>
      )}
      {(error || validation?.valid === false) && (
        <p role="alert">{error || validation?.issues.join('; ')}</p>
      )}
    </fieldset>
  );
}

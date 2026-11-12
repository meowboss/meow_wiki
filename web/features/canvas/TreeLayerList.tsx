import { useRef, type DragEvent } from 'react';
import type { LayoutTree } from '../../../packages/canvas-contract/layout-tree';

export type TreeLayerItem = { node: LayoutTree; depth: number; label: string };
type Props = {
  items: TreeLayerItem[];
  activeId: string;
  disabled: boolean;
  onSelectContainer: (containerId: string) => void;
  onMoveLeaf: (instanceId: string, containerId: string) => void;
};

const INSTANCE_TYPE = 'application/x-meow-canvas-instance';

export default function TreeLayerList({
  items,
  activeId,
  disabled,
  onSelectContainer,
  onMoveLeaf,
}: Props) {
  // MIME alone is not proof of origin: only this mounted list can start a move.
  const activeDrag = useRef<string | null>(null);

  function isInternalDrag(event: DragEvent, containerId: string) {
    return (
      !disabled &&
      activeDrag.current !== null &&
      event.dataTransfer.types.includes(INSTANCE_TYPE) &&
      items.some(({ node }) => node.kind === 'view' && node.instanceId === activeDrag.current) &&
      items.some(({ node }) => node.kind !== 'view' && node.id === containerId)
    );
  }

  function drop(event: DragEvent, containerId: string) {
    const valid = isInternalDrag(event, containerId);
    const instanceId = activeDrag.current;
    activeDrag.current = null;
    if (!valid || !instanceId || event.dataTransfer.getData(INSTANCE_TYPE) !== instanceId) return;
    event.preventDefault();
    onMoveLeaf(instanceId, containerId);
  }

  return (
    <>
      <p className="muted">可拖动组件到容器；键盘操作请使用下方的“移动选中组件到容器”。</p>
      <ul aria-label="布局层列表">
        {items.map(({ node, depth, label }) => (
          <li
            key={node.id}
            onDragOver={
              node.kind === 'view'
                ? undefined
                : (event) => {
                    if (!isInternalDrag(event, node.id)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }
            }
            onDrop={node.kind === 'view' ? undefined : (event) => drop(event, node.id)}
          >
            {`第 ${depth} 层 · `}
            {node.kind === 'view' ? (
              <button
                type="button"
                disabled={disabled}
                draggable={!disabled}
                aria-label={`移动组件 ${label.replace(/^组件：/, '')}`}
                onDragStart={(event) => {
                  activeDrag.current = null;
                  if (disabled) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.clearData();
                  event.dataTransfer.setData(INSTANCE_TYPE, node.instanceId);
                  event.dataTransfer.effectAllowed = 'move';
                  activeDrag.current = node.instanceId;
                }}
                onDragEnd={() => {
                  activeDrag.current = null;
                }}
              >
                {label}
              </button>
            ) : (
              <button
                type="button"
                disabled={disabled}
                aria-pressed={activeId === node.id}
                onClick={() => {
                  if (!disabled) onSelectContainer(node.id);
                }}
              >
                {depth === 1 ? `根 · ${label}` : label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

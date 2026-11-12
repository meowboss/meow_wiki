import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import CanvasHandle from './CanvasHandle';
import CanvasResizeHandle from './CanvasResizeHandle';
import { ViewBoundary, ViewContent } from './CanvasView';
import type { CanvasInstance } from './useCanvasComposition';

type Props = {
  item: CanvasInstance;
  style: CSSProperties;
  nested: boolean;
  editing: boolean;
  loading?: boolean;
  selected: boolean;
  workspaceId: string;
  surface: string;
  renderView: (instance: CanvasInstance) => ReactNode;
  handle: Omit<ComponentProps<typeof CanvasHandle>, 'item' | 'selected'>;
};

export default function CanvasInstanceFrame({
  item,
  style,
  nested,
  editing,
  loading = false,
  selected,
  workspaceId,
  surface,
  renderView,
  handle,
}: Props) {
  return (
    <div
      style={style}
      data-view-id={item.viewId}
      data-layer={item.layer}
      hidden={!editing && !item.visible}
      className={`canvas-instance${nested ? ' canvas-nested-instance' : ''}${editing && selected ? ' is-selected' : ''}${!item.visible ? ' is-hidden' : ''}`}
    >
      {editing && (
        <>
          <CanvasHandle
            {...handle}
            item={item}
            selected={selected}
            layout={nested ? 'flow' : handle.layout}
          />
          {!nested && handle.layout !== 'flow' && (
            <CanvasResizeHandle
              item={item}
              layout={handle.layout}
              disabled={handle.disabled}
              gap={handle.gap}
              onChange={handle.onChange}
            />
          )}
          <button
            type="button"
            className="canvas-select-overlay"
            disabled={handle.disabled}
            tabIndex={-1}
            aria-label={`选择组件 ${item.viewId}`}
            onClick={handle.onSelect}
          />
        </>
      )}
      <div className="canvas-business-content" inert={editing || loading}>
        <ViewBoundary key={`${workspaceId}:${surface}:${item.id}`}>
          <ViewContent instance={item} renderView={renderView} workspaceId={workspaceId} />
        </ViewBoundary>
      </div>
    </div>
  );
}

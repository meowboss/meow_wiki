import type { ReactNode } from 'react';
import type { CanvasInstance, CompositionDocument } from '../../../packages/canvas-contract/index';
import {
  CanvasInstanceSessionScopeProvider,
  useCanvasInstanceSessionScope,
} from '../../shared/canvas-instance-session';
import CanvasInstanceFrame from './CanvasInstanceFrame';
import CanvasTree from './CanvasTree';
import { canvasBoardClassName, canvasBoardStyle, canvasItemStyle } from './shared-layout-style';
import './canvas.css';

export type CanvasPreviewProps = {
  /** A validated document; validation and authorization belong to the caller. */
  composition: CompositionDocument;
  workspaceId: string;
  renderView: (instance: CanvasInstance) => ReactNode;
  /** Use the authenticated owner when available; never an SDK credential. */
  ownerId?: string;
};
const noop = () => {};

/** Read-only layout, not inert business content: the app supplies read-only view slots. */
export default function CanvasPreview({
  composition,
  workspaceId,
  renderView,
  ownerId = 'preview',
}: CanvasPreviewProps) {
  const surface = `preview:${composition.surface}`;
  const instanceSession = useCanvasInstanceSessionScope(
    { ownerId, workspaceId, surface },
    composition.instances.map((item) => item.id),
  );
  function renderInstance(item: CanvasInstance, nested: boolean) {
    return (
      <CanvasInstanceFrame
        key={item.id}
        item={item}
        style={canvasItemStyle(item)}
        nested={nested}
        editing={false}
        loading={false}
        selected={false}
        workspaceId={workspaceId}
        surface={surface}
        renderView={renderView}
        handle={{
          disabled: true,
          layout: composition.layout,
          gap: composition.gap,
          onSelect: noop,
          onPreview: noop,
          onChange: noop,
        }}
      />
    );
  }
  return (
    <section className="canvas-surface canvas-preview" aria-label="页面实时预览">
      <CanvasInstanceSessionScopeProvider value={instanceSession}>
        <div
          className={canvasBoardClassName(composition)}
          style={canvasBoardStyle(composition)}
          aria-busy={false}
        >
          {composition.tree !== undefined ? (
            <>
              <CanvasTree
                tree={composition.tree}
                instances={composition.instances}
                renderInstance={renderInstance}
              />
              {composition.instances
                .filter((item) => item.layer !== 'content')
                .map((item) => renderInstance(item, false))}
            </>
          ) : (
            composition.instances.map((item) => renderInstance(item, false))
          )}
          {!composition.instances.some((item) => item.visible) && (
            <p className="canvas-empty">此布局暂无可见组件。</p>
          )}
        </div>
      </CanvasInstanceSessionScopeProvider>
    </section>
  );
}

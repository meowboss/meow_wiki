import { useEffect, useRef, useState, type ReactNode } from 'react';
import CanvasInstanceFrame from './CanvasInstanceFrame';
import CanvasTree from './CanvasTree';
import CanvasInspector from './CanvasInspector';

import CanvasCatalog, { type CanvasCatalogEntry } from './CanvasCatalog';
import { useCanvasInstances } from './useCanvasInstances';
import {
  useCanvasComposition,
  type CanvasInstance,
  type CanvasSurfaceName,
} from './useCanvasComposition';
import './canvas.css';
import {
  CanvasInstanceSessionScopeProvider,
  useCanvasInstanceSessionScope,
} from '../../shared/canvas-instance-session';
import { exportCanvasLayout } from './export-layout';
import { canvasItemStyle, canvasBoardStyle, canvasBoardClassName } from './shared-layout-style';

type Props = {
  surface: CanvasSurfaceName;
  workspaceId: string;
  ownerId: string;
  renderView: (instance: CanvasInstance) => ReactNode;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  contentDirty?: boolean;
  catalog?: CanvasCatalogEntry[];
  availableViews?: CanvasCatalogEntry[];
};
const CONTENT_DRAFT_MESSAGE = '请先保存或取消业务草稿，再编辑布局或重新加载布局。';

export default function CanvasSurface({
  surface,
  workspaceId,
  ownerId,
  renderView,
  onDirtyChange,
  onBusyChange,
  disabled = false,
  contentDirty = false,
  catalog = [],
  availableViews,
}: Props) {
  const [mediaBusy, setMediaBusy] = useState(false);
  const state = useCanvasComposition(surface, workspaceId, onDirtyChange, () => {}, ownerId);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => {
    busyCallback.current(state.busy || mediaBusy);
    return () => busyCallback.current(false);
  }, [state.busy, mediaBusy]);
  const [selectedId, setSelectedId] = useState('');
  const [dragPosition, setDragPosition] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const { draft, editing, busy } = state;
  const instanceSession = useCanvasInstanceSessionScope(
    { ownerId, workspaceId, surface },
    draft?.instances.map((item) => item.id) ?? [],
  );
  const locked = disabled || busy || mediaBusy;
  const selected = draft?.instances.find((item) => item.id === selectedId);
  const { updateInstance, addView, addText, duplicate, remove, restoreDefault } =
    useCanvasInstances({
      draft,
      editing,
      locked,
      contentDirty,
      surface,
      availableViews,
      catalog,
      selected,
      selectedId,
      setSelectedId,
      stateChange: state.change,
      setEditing: state.setEditing,
      setDragPosition,
    });
  function renderInstance(item: CanvasInstance, nested: boolean) {
    if (!draft) return null;
    return (
      <CanvasInstanceFrame
        key={item.id}
        item={item}
        style={canvasItemStyle(item, dragPosition)}
        nested={nested}
        editing={editing}
        loading={busy}
        selected={item.id === selectedId}
        workspaceId={workspaceId}
        surface={surface}
        renderView={renderView}
        handle={{
          disabled: locked,
          layout: draft.layout,
          gap: draft.gap,
          onSelect: () => setSelectedId(item.id),
          onPreview: setDragPosition,
          onChange: updateInstance,
        }}
      />
    );
  }
  const visible = draft?.instances.filter((item) => editing || item.visible) ?? [];
  const boardStyle = draft ? canvasBoardStyle(draft, editing) : undefined;
  return (
    <section className={`canvas-surface${editing ? ' is-editing' : ''}`} aria-label="页面画布">
      {state.hasRecovery && !editing && (
        <div role="status" className="canvas-recovery">
          发现此账号和空间的未保存布局草稿。
          <button type="button" disabled={locked || contentDirty} onClick={state.recoverDraft}>
            恢复布局草稿
          </button>
          <button type="button" disabled={locked} onClick={state.discardDraft}>
            丢弃布局草稿
          </button>
        </div>
      )}
      <div className="canvas-toolbar" role="toolbar" aria-label="布局工具">
        {!editing ? (
          <>
            <button
              type="button"
              disabled={locked || !draft || contentDirty}
              title={contentDirty ? CONTENT_DRAFT_MESSAGE : undefined}
              onClick={() => {
                if (!locked && draft && !contentDirty) state.setEditing(true);
              }}
            >
              编辑布局
            </button>
            {contentDirty && <span role="status">{CONTENT_DRAFT_MESSAGE}</span>}
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={locked || !state.dirty || state.conflict || !state.loaded}
              onClick={() => void state.save()}
            >
              保存布局
            </button>
            <button
              type="button"
              disabled={busy || mediaBusy}
              onClick={() => {
                if (!state.dirty || window.confirm('放弃当前未保存的布局修改？')) {
                  setDragPosition(null);
                  state.cancel();
                }
              }}
            >
              取消布局编辑
            </button>
            <button
              type="button"
              disabled={locked || (draft?.instances.length ?? 0) >= 40}
              onClick={addText}
            >
              添加文本
            </button>
            <CanvasCatalog
              catalog={catalog}
              availableViews={availableViews}
              surface={surface}
              instances={draft?.instances ?? []}
              disabled={locked || contentDirty || (draft?.instances.length ?? 0) >= 40}
              onAdd={addView}
            />
            <button type="button" disabled={locked || !state.canUndo} onClick={state.undo}>
              撤销布局修改
            </button>
            <button type="button" disabled={locked || !state.canRedo} onClick={state.redo}>
              重做布局修改
            </button>
            <span className="canvas-status" role="status">
              {state.dirty ? '布局有未保存修改' : '布局已保存'}
            </span>
          </>
        )}
        <button
          type="button"
          disabled={locked || contentDirty || !draft}
          title={contentDirty ? CONTENT_DRAFT_MESSAGE : undefined}
          onClick={restoreDefault}
        >
          恢复默认布局
        </button>
        {surface === 'home' && (
          <button
            type="button"
            disabled={locked || contentDirty || !state.loaded}
            onClick={() => void state.migrateLegacy()}
          >
            迁移旧首页组件
          </button>
        )}
        <button
          type="button"
          disabled={!draft || locked}
          onClick={() => draft && exportCanvasLayout(draft)}
        >
          导出当前布局
        </button>
        {busy && <span role="status">正在处理布局…</span>}
      </div>
      {state.error && (
        <div className="canvas-error" role="alert">
          {state.error}
          <button
            type="button"
            disabled={busy || contentDirty}
            title={contentDirty ? CONTENT_DRAFT_MESSAGE : undefined}
            onClick={() => {
              if (!contentDirty) state.loadLatest();
            }}
          >
            重新加载布局
          </button>
        </div>
      )}
      <div className="canvas-workspace">
        <CanvasInstanceSessionScopeProvider value={instanceSession}>
          <div
            className={
              draft ? canvasBoardClassName(draft, editing) : 'canvas-board canvas-layout-flow'
            }
            style={boardStyle}
            aria-busy={busy}
          >
            {draft?.tree !== undefined ? (
              <>
                <CanvasTree
                  tree={draft.tree}
                  instances={draft.instances}
                  editing={editing}
                  renderInstance={renderInstance}
                />
                {draft.instances
                  .filter((item) => item.layer !== 'content')
                  .map((item) => renderInstance(item, false))}
              </>
            ) : (
              draft?.instances.map((item) => renderInstance(item, false))
            )}
            {draft && visible.length === 0 && (
              <p className="canvas-empty">
                此布局暂无组件。可通过“编辑布局”添加文本或恢复默认布局。
              </p>
            )}
          </div>
        </CanvasInstanceSessionScopeProvider>
        {editing && draft && (
          <CanvasInspector
            workspaceId={workspaceId}
            onMediaBusyChange={setMediaBusy}
            composition={draft}
            selected={selected}
            disabled={locked}
            onChange={state.change}
            onInstanceChange={updateInstance}
            onDuplicate={duplicate}
            onRemove={remove}
          />
        )}
      </div>
    </section>
  );
}

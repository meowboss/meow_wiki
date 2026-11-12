import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ViewBoundary, ViewContent } from './CanvasView';
import CanvasInspector from './CanvasInspector';
import CanvasHandle from './CanvasHandle';
import CanvasCatalog, { type CanvasCatalogEntry } from './CanvasCatalog';
import { createDefaultComposition } from '../../../packages/canvas-contract/index';
import { availableCanvasViews, isRepeatableView, isViewOnSurface } from './registry';
import {
  useCanvasComposition,
  type CanvasInstance,
  type CanvasSurfaceName,
} from './useCanvasComposition';
import './canvas.css';

type Props = {
  surface: CanvasSurfaceName;
  workspaceId: string;
  renderView: (instance: CanvasInstance) => ReactNode;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  contentDirty?: boolean;
  catalog?: CanvasCatalogEntry[];
  availableViews?: CanvasCatalogEntry[];
};
const COLUMNS = 12;
const CONTENT_DRAFT_MESSAGE = '请先保存或取消业务草稿，再编辑布局或重新加载布局。';

export default function CanvasSurface({
  surface,
  workspaceId,
  renderView,
  onDirtyChange,
  onBusyChange,
  disabled = false,
  contentDirty = false,
  catalog = [],
  availableViews,
}: Props) {
  const [mediaBusy, setMediaBusy] = useState(false);
  const state = useCanvasComposition(surface, workspaceId, onDirtyChange, () => {});
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
  const locked = disabled || busy || mediaBusy;
  const selected = draft?.instances.find((item) => item.id === selectedId);
  function updateInstance(next: CanvasInstance) {
    if (draft)
      state.change({
        ...draft,
        instances: draft.instances.map((item) => (item.id === next.id ? next : item)),
      });
  }
  function addView(viewId: CanvasInstance['viewId'], config: CanvasInstance['config']) {
    if (!draft || locked || contentDirty || !editing || draft.instances.length >= 40) return;
    const entries = [...availableCanvasViews(surface, availableViews), ...catalog];
    if (!isViewOnSurface(viewId, surface) || !entries.some((entry) => entry.viewId === viewId))
      return;
    if (!isRepeatableView(viewId) && draft.instances.some((item) => item.viewId === viewId)) return;
    const item: CanvasInstance = {
      id: crypto.randomUUID(),
      viewId,
      visible: true,
      layer: 'content',
      x: 0,
      y: Math.min(100, Math.max(0, ...draft.instances.map((i) => i.y + i.h))),
      w: 6,
      h: 4,
      config: { ...config },
      style: {},
    };
    state.change({ ...draft, instances: [...draft.instances, item] });
    setSelectedId(item.id);
  }
  function addText() {
    if (!draft || draft.instances.length >= 40) return;
    const item: CanvasInstance = {
      id: crypto.randomUUID(),
      viewId: 'builtin.text',
      visible: true,
      layer: 'content',
      x: 0,
      y: Math.min(100, Math.max(0, ...draft.instances.map((value) => value.y + value.h))),
      w: 6,
      h: 3,
      config: { text: '在此输入文本' },
      style: {},
    };
    state.change({ ...draft, instances: [...draft.instances, item] });
    setSelectedId(item.id);
  }
  function duplicate() {
    if (!draft || !selected || !isRepeatableView(selected.viewId) || draft.instances.length >= 40)
      return;
    const item = {
      ...selected,
      id: crypto.randomUUID(),
      y: Math.min(100, selected.y + 1),
      config: { ...selected.config },
      style: { ...selected.style },
    };
    state.change({ ...draft, instances: [...draft.instances, item] });
    setSelectedId(item.id);
  }
  function restoreDefault() {
    if (locked || contentDirty || !draft) return;
    if (!window.confirm('恢复默认布局将替换当前布局并进入编辑草稿；保存布局后才会生效，是否继续？'))
      return;
    setDragPosition(null);
    setSelectedId('');
    state.change({ ...createDefaultComposition(surface), revision: draft.revision });
    state.setEditing(true);
  }
  function remove() {
    if (!draft || !selected || !window.confirm('仅从布局中移除此组件？原有数据不会被删除。'))
      return;
    state.change({
      ...draft,
      instances: draft.instances.filter((item) => item.id !== selected.id),
    });
    setSelectedId('');
  }
  function itemStyle(item: CanvasInstance): CSSProperties {
    const position = dragPosition?.id === item.id ? dragPosition : item;
    const width = Math.min(item.w, COLUMNS);
    const x = Math.min(position.x, COLUMNS - width);
    return {
      background: item.style.background,
      color: item.style.color,
      padding: item.style.padding,
      borderRadius: item.style.borderRadius,
      gridColumn: `${x + 1} / span ${width}`,
      gridRow: `${position.y + 1} / span ${item.h}`,
      '--canvas-x': x,
      '--canvas-y': position.y,
      '--canvas-w': width,
      '--canvas-h': item.h,
    } as CSSProperties;
  }
  const visible = draft?.instances.filter((item) => editing || item.visible) ?? [];
  const maxBottom = Math.max(1, ...visible.map((item) => item.y + item.h));
  const boardStyle = draft
    ? ({
        '--canvas-columns': COLUMNS,
        '--canvas-gap': `${draft.gap}px`,
        '--canvas-height': `${maxBottom * 48 + Math.max(0, maxBottom - 1) * draft.gap}px`,
        background: draft.background,
      } as CSSProperties)
    : undefined;
  return (
    <section className={`canvas-surface${editing ? ' is-editing' : ''}`} aria-label="页面画布">
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
        <div
          className={`canvas-board canvas-layout-${draft?.layout ?? 'flow'}${editing ? ' canvas-editing-board' : ''}`}
          style={boardStyle}
          aria-busy={busy}
        >
          {draft?.instances.map((item) => (
            <div
              key={item.id}
              style={itemStyle(item)}
              data-view-id={item.viewId}
              data-layer={item.layer}
              hidden={!editing && !item.visible}
              className={`canvas-instance${editing && item.id === selectedId ? ' is-selected' : ''}${!item.visible ? ' is-hidden' : ''}`}
            >
              {editing && (
                <>
                  <CanvasHandle
                    item={item}
                    selected={item.id === selectedId}
                    disabled={locked}
                    layout={draft.layout}
                    gap={draft.gap}
                    onSelect={() => setSelectedId(item.id)}
                    onPreview={setDragPosition}
                    onChange={updateInstance}
                  />
                  <button
                    type="button"
                    className="canvas-select-overlay"
                    disabled={locked}
                    tabIndex={-1}
                    aria-label={`选择组件 ${item.viewId}`}
                    onClick={() => setSelectedId(item.id)}
                  />
                </>
              )}
              <div className="canvas-business-content" inert={editing}>
                <ViewBoundary key={`${workspaceId}:${surface}:${item.id}`}>
                  <ViewContent instance={item} renderView={renderView} workspaceId={workspaceId} />
                </ViewBoundary>
              </div>
            </div>
          ))}
          {draft && visible.length === 0 && (
            <p className="canvas-empty">此布局暂无组件。可通过“编辑布局”添加文本或恢复默认布局。</p>
          )}
        </div>
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

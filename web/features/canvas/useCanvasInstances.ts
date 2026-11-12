import {
  createDefaultComposition,
  type Composition,
} from '../../../packages/canvas-contract/index';
import type { CanvasCatalogEntry } from './CanvasCatalog';
import { appendCanvasTreeInstance, readCanvasTree, removeCanvasTreeInstance } from './CanvasTree';
import { availableCanvasViews, isRepeatableView, isViewOnSurface } from './registry';
import type { CanvasInstance, CanvasSurfaceName } from './useCanvasComposition';

type Context = {
  draft: Composition | null;
  editing: boolean;
  locked: boolean;
  contentDirty: boolean;
  surface: CanvasSurfaceName;
  availableViews?: CanvasCatalogEntry[];
  catalog: CanvasCatalogEntry[];
  selected?: CanvasInstance;
  selectedId: string;
  setSelectedId: (id: string) => void;
  stateChange: (next: Composition) => void;
  setEditing: (editing: boolean) => void;
  setDragPosition: (position: { id: string; x: number; y: number } | null) => void;
};

export function useCanvasInstances({
  draft,
  editing,
  locked,
  contentDirty,
  surface,
  availableViews,
  catalog,
  selected,
  setSelectedId,
  stateChange,
  setEditing,
  setDragPosition,
}: Context) {
  function updateInstance(next: CanvasInstance) {
    if (draft)
      stateChange({
        ...draft,
        instances: draft.instances.map((item) => (item.id === next.id ? next : item)),
      });
  }

  function changeInstances(instances: CanvasInstance[], addedId?: string, removedId?: string) {
    if (!draft) return false;
    try {
      let tree = draft.tree;
      if (tree !== undefined) {
        const current = readCanvasTree(
          tree,
          draft.instances.map((item) => item.id),
        );
        tree = addedId
          ? appendCanvasTreeInstance(current, addedId)
          : removedId
            ? removeCanvasTreeInstance(current, removedId)
            : current;
        readCanvasTree(
          tree,
          instances.map((item) => item.id),
        );
      }
      stateChange({ ...draft, instances, ...(tree === undefined ? {} : { tree }) });
      return true;
    } catch {
      window.alert(
        '无法更新嵌套布局（可能已达到节点或深度上限）。请先调整布局树，现有嵌套已保留。',
      );
      return false;
    }
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
    if (changeInstances([...draft.instances, item], item.id)) setSelectedId(item.id);
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
    if (changeInstances([...draft.instances, item], item.id)) setSelectedId(item.id);
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
    if (changeInstances([...draft.instances, item], item.id)) setSelectedId(item.id);
  }

  function restoreDefault() {
    if (locked || contentDirty || !draft) return;
    if (!window.confirm('恢复默认布局将替换当前布局并进入编辑草稿；保存布局后才会生效，是否继续？'))
      return;
    setDragPosition(null);
    setSelectedId('');
    stateChange({ ...createDefaultComposition(surface), revision: draft.revision });
    setEditing(true);
  }

  function remove() {
    if (!draft || !selected || !window.confirm('仅从布局中移除此组件？原有数据不会被删除。'))
      return;
    if (
      changeInstances(
        draft.instances.filter((item) => item.id !== selected.id),
        undefined,
        selected.id,
      )
    )
      setSelectedId('');
  }

  return { updateInstance, addView, addText, duplicate, remove, restoreDefault };
}

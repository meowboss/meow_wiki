import type { CanvasInstance, CanvasSurfaceName } from './useCanvasComposition';
import {
  availableCanvasViews,
  isRepeatableView,
  isViewOnSurface,
  type CanvasCatalogEntry,
} from './registry';
export type { CanvasCatalogEntry } from './registry';

export default function CanvasCatalog({
  catalog,
  availableViews,
  surface,
  instances,
  disabled,
  onAdd,
}: {
  catalog: CanvasCatalogEntry[];
  availableViews?: CanvasCatalogEntry[];
  surface: CanvasSurfaceName;
  instances: CanvasInstance[];
  disabled: boolean;
  onAdd: (viewId: CanvasInstance['viewId'], config: CanvasInstance['config']) => void;
}) {
  const views = availableCanvasViews(surface, availableViews);
  const components = catalog.filter((entry) => isViewOnSurface(entry.viewId, surface));
  const exists = (entry: CanvasCatalogEntry) =>
    !isRepeatableView(entry.viewId) && instances.some((item) => item.viewId === entry.viewId);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => onAdd('builtin.search', {})}>
        添加搜索
      </button>
      <label>
        添加功能视图
        <select
          aria-label="添加功能视图"
          value=""
          disabled={disabled || !views.length}
          onChange={(event) => {
            if (!event.target.value) return;
            const entry = views[Number(event.target.value)];
            if (entry && !exists(entry)) onAdd(entry.viewId, { ...entry.config });
          }}
        >
          <option value="">选择功能视图</option>
          {views.map((entry, i) => (
            <option key={entry.viewId} value={i} disabled={exists(entry)}>
              {entry.label}
              {exists(entry) ? '（已添加）' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        添加空间组件
        <select
          aria-label="添加画布组件"
          value=""
          disabled={disabled || !components.length}
          onChange={(event) => {
            if (!event.target.value) return;
            const entry = components[Number(event.target.value)];
            if (entry && !exists(entry)) onAdd(entry.viewId, { ...entry.config });
          }}
        >
          <option value="">选择私有或已安装组件</option>
          {components.map((entry, i) => (
            <option key={i} value={i} disabled={exists(entry)}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

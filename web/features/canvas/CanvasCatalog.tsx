import type { CanvasInstance } from './useCanvasComposition';
export type CanvasCatalogEntry = {
  label: string;
  viewId: CanvasInstance['viewId'];
  config: CanvasInstance['config'];
};
export default function CanvasCatalog({
  catalog,
  disabled,
  onAdd,
}: {
  catalog: CanvasCatalogEntry[];
  disabled: boolean;
  onAdd: (viewId: CanvasInstance['viewId'], config: CanvasInstance['config']) => void;
}) {
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => onAdd('builtin.search', {})}>
        添加搜索
      </button>
      <label>
        添加空间组件
        <select
          aria-label="添加画布组件"
          value=""
          disabled={disabled || !catalog.length}
          onChange={(event) => {
            if (!event.target.value) return;
            const entry = catalog[Number(event.target.value)];
            if (entry) onAdd(entry.viewId, entry.config);
          }}
        >
          <option value="">选择私有或已安装组件</option>
          {catalog.map((entry, i) => (
            <option key={i} value={i}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

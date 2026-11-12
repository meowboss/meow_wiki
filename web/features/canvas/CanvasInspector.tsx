import type { Composition } from '../../../packages/canvas-contract/index';
import type { CanvasInstance } from './useCanvasComposition';
import MediaInspector from './MediaInspector';
import { isRepeatableView } from './registry';

type Props = {
  composition: Composition;
  selected: CanvasInstance | undefined;
  disabled: boolean;
  onChange: (next: Composition) => void;
  onInstanceChange: (next: CanvasInstance) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  workspaceId: string;
  onMediaBusyChange?: (value: boolean) => void;
};
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(event) => {
          if (event.target.value === '') return;
          const number = Number(event.target.value);
          if (Number.isFinite(number)) onChange(Math.max(min, Math.min(max, Math.round(number))));
        }}
      />
    </label>
  );
}
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label>
      {label}
      <span className="canvas-color-field">
        <input
          type="color"
          value={value || '#ffffff'}
          onChange={(event) => onChange(event.target.value)}
        />
        <span>{value || '未设置'}</span>
        <button type="button" onClick={() => onChange(undefined)}>
          清除
        </button>
      </span>
    </label>
  );
}
export default function CanvasInspector({
  composition,
  selected,
  disabled,
  onChange,
  onInstanceChange,
  onDuplicate,
  onRemove,
  workspaceId,
  onMediaBusyChange,
}: Props) {
  function style(patch: Partial<CanvasInstance['style']>) {
    if (!selected) return;
    onInstanceChange({ ...selected, style: { ...selected.style, ...patch } });
  }
  return (
    <aside className="canvas-inspector" aria-label="布局属性">
      <fieldset disabled={disabled}>
        <legend>画布设置</legend>
        <label>
          布局方式
          <select
            value={composition.layout}
            onChange={(event) =>
              onChange({ ...composition, layout: event.target.value as Composition['layout'] })
            }
          >
            <option value="grid">网格</option>
            <option value="flow">纵向流式</option>
            <option value="free">自由布局</option>
          </select>
        </label>
        <p className="muted">所有布局使用固定 12 列逻辑坐标；流式布局按组件顺序排列。</p>
        <NumberField
          label="组件间距"
          value={composition.gap}
          min={0}
          max={48}
          onChange={(gap) => onChange({ ...composition, gap })}
        />
        <label>
          画布背景
          <input
            type="color"
            value={composition.background}
            onChange={(event) => onChange({ ...composition, background: event.target.value })}
          />
        </label>
      </fieldset>
      {selected ? (
        <fieldset disabled={disabled}>
          <legend>所选组件</legend>
          <MediaInspector
            instance={selected}
            workspaceId={workspaceId}
            onBusyChange={onMediaBusyChange}
            disabled={disabled}
            onChange={onInstanceChange}
          />
          <p className="canvas-view-name">{selected.viewId}</p>
          <label className="canvas-checkbox">
            <input
              type="checkbox"
              checked={selected.visible}
              onChange={(event) => onInstanceChange({ ...selected, visible: event.target.checked })}
            />
            显示组件
          </label>
          <div className="canvas-number-grid">
            {(['x', 'y', 'w', 'h'] as const).map((key) => (
              <NumberField
                key={key}
                label={{ x: '横向位置 X', y: '纵向位置 Y', w: '宽度 W', h: '高度 H' }[key]}
                value={selected[key]}
                min={key === 'w' || key === 'h' ? 1 : 0}
                max={{ x: 12 - selected.w, y: 100, w: 12 - selected.x, h: 24 }[key]}
                onChange={(value) => onInstanceChange({ ...selected, [key]: value })}
              />
            ))}
          </div>
          {selected.viewId === 'builtin.text' && (
            <label>
              文本内容
              <textarea
                rows={5}
                maxLength={5000}
                value={selected.config.text ?? ''}
                onChange={(event) =>
                  onInstanceChange({
                    ...selected,
                    config: { ...selected.config, text: event.target.value },
                  })
                }
              />
            </label>
          )}
          <NumberField
            label="内边距"
            value={selected.style.padding ?? 0}
            min={0}
            max={48}
            onChange={(padding) => style({ padding })}
          />
          <NumberField
            label="圆角"
            value={selected.style.borderRadius ?? 0}
            min={0}
            max={40}
            onChange={(borderRadius) => style({ borderRadius })}
          />
          <ColorField
            label="组件背景"
            value={selected.style.background}
            onChange={(background) => style({ background })}
          />
          <ColorField
            label="文字颜色"
            value={selected.style.color}
            onChange={(color) => style({ color })}
          />
          <div className="canvas-inspector-actions">
            <button
              type="button"
              disabled={!isRepeatableView(selected.viewId) || composition.instances.length >= 40}
              title={
                !isRepeatableView(selected.viewId)
                  ? '现有业务组件（legacy）使用单实例，文本、搜索和空间组件支持独立复制。'
                  : undefined
              }
              onClick={onDuplicate}
            >
              复制组件
            </button>
            <button type="button" onClick={onRemove}>
              移除布局组件
            </button>
          </div>
          {!isRepeatableView(selected.viewId) && (
            <p className="muted">
              现有业务组件（legacy）为单实例，不能复制。文本、搜索和空间组件支持独立复制。
            </p>
          )}
          <p className="muted">移除仅影响布局，不会删除原有数据。选中拖动手柄后可用方向键移动。</p>
        </fieldset>
      ) : (
        <p className="muted">选择一个组件以编辑其属性。</p>
      )}
    </aside>
  );
}

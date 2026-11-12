import type { CanvasTheme, Composition } from '../../../packages/canvas-contract/index';
import { CANVAS_THEME_PRESETS, DEFAULT_CANVAS_THEME, canvasContrastRatio } from './theme';

type Props = {
  composition: Composition;
  disabled: boolean;
  onChange: (next: Composition) => void;
};

export default function CanvasThemeInspector({ composition, disabled, onChange }: Props) {
  const theme = { ...DEFAULT_CANVAS_THEME, ...composition.theme };
  const contrast = canvasContrastRatio(theme.foreground, composition.background);
  function patch(next: Partial<CanvasTheme>) {
    onChange({ ...composition, theme: { ...composition.theme, ...next } });
  }
  return (
    <fieldset disabled={disabled}>
      <legend>画布主题</legend>
      <div className="canvas-inspector-actions" role="group" aria-label="主题预设">
        {(['light', 'dark'] as const).map((preset) => (
          <button
            type="button"
            key={preset}
            onClick={() => {
              const value = CANVAS_THEME_PRESETS[preset];
              onChange({ ...composition, background: value.background, theme: { ...value.theme } });
            }}
          >
            {preset === 'light' ? '明亮主题' : '深色主题'}
          </button>
        ))}
        <button
          type="button"
          disabled={composition.theme === undefined}
          onClick={() => {
            const { theme: _theme, ...rest } = composition;
            onChange(rest);
          }}
        >
          清除主题
        </button>
      </div>
      <p className="muted">
        仅影响画布内容；未设置的字段使用预览默认值，不会自动写入布局。组件自定义颜色优先。
      </p>
      {(['foreground', 'accent'] as const).map((key) => (
        <label key={key}>
          {key === 'foreground' ? '主题文字' : '强调色'}
          <input
            type="color"
            value={theme[key]}
            onChange={(event) => patch({ [key]: event.target.value })}
          />
        </label>
      ))}
      <label>
        字号
        <input
          type="number"
          min={14}
          max={22}
          step={1}
          value={theme.fontSize}
          onChange={(event) => {
            if (!event.target.value) return;
            const value = Number(event.target.value);
            if (Number.isFinite(value))
              patch({ fontSize: Math.max(14, Math.min(22, Math.round(value))) });
          }}
        />
      </label>
      <label>
        字族
        <select
          value={theme.font}
          onChange={(event) => patch({ font: event.target.value as CanvasTheme['font'] })}
        >
          <option value="sans">无衬线</option>
          <option value="serif">衬线</option>
          <option value="mono">等宽</option>
        </select>
      </label>
      <label>
        行高
        <input
          type="number"
          min={1.3}
          max={2.2}
          step={0.1}
          value={theme.lineHeight}
          onChange={(event) => {
            if (!event.target.value) return;
            const value = Number(event.target.value);
            if (Number.isFinite(value)) patch({ lineHeight: Math.max(1.3, Math.min(2.2, value)) });
          }}
        />
      </label>
      {contrast !== undefined && contrast < 4.5 && (
        <p className="canvas-theme-warning" role="status">
          主题文字与背景对比度为 {contrast.toFixed(2)}:1，低于建议的 4.5:1。建议调整颜色；仍可保存。
          透明背景按忽略透明度估算。
        </p>
      )}
    </fieldset>
  );
}

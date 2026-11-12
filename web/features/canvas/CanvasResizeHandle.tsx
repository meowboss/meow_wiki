import { useRef, useState, type PointerEvent } from 'react';
import type { CanvasInstance } from './useCanvasComposition';

const COLUMNS = 12;
const MAX_HEIGHT = 24;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
type Size = { w: number; h: number };
type Props = {
  item: CanvasInstance;
  layout: 'grid' | 'flow' | 'free';
  disabled: boolean;
  gap: number;
  onChange: (item: CanvasInstance) => void;
};
type Resize = {
  pointer: number;
  startX: number;
  startY: number;
  columnWidth: number;
  heights: number[];
  original: Size;
  next: Size;
};

/** Use resolved tracks, not a fixed row estimate when content has stretched the grid. */
function spanHeights(computed: CSSStyleDeclaration, item: CanvasInstance, gap: number) {
  const tracks = computed.gridTemplateRows.trim().split(/\s+/);
  const rows = tracks.every((track) => /^\d+(?:\.\d+)?px$/.test(track))
    ? tracks.map(Number.parseFloat)
    : [];
  const resolvedGap = Number.parseFloat(computed.rowGap);
  const rowGap = Number.isFinite(resolvedGap) ? resolvedGap : gap;
  // If the current span cannot be resolved (e.g. responsive flex), use conservative units.
  const resolved = rows.length >= item.y + item.h;
  let height = 0;
  return Array.from({ length: MAX_HEIGHT }, (_, index) => {
    height += (resolved ? (rows[item.y + index] ?? 48) : 48) + (index ? rowGap : 0);
    return height;
  });
}

export default function CanvasResizeHandle({ item, layout, disabled, gap, onChange }: Props) {
  const resize = useRef<Resize | null>(null);
  const [preview, setPreview] = useState<Size | null>(null);
  const maxWidth = Math.max(1, COLUMNS - item.x);

  function update(event: PointerEvent<HTMLButtonElement>) {
    const current = resize.current;
    if (!current || current.pointer !== event.pointerId || disabled) return;
    const targetHeight = current.heights[current.original.h - 1] + event.clientY - current.startY;
    const nearest = current.heights.reduce(
      (closest, height, index, heights) =>
        Math.abs(height - targetHeight) < Math.abs(heights[closest] - targetHeight)
          ? index
          : closest,
      0,
    );
    current.next = {
      w: clamp(
        current.original.w + Math.round((event.clientX - current.startX) / current.columnWidth),
        1,
        maxWidth,
      ),
      h: nearest + 1,
    };
    setPreview(current.next);
  }

  function stop(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const current = resize.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (commit) update(event);
    resize.current = null;
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (
      commit &&
      !disabled &&
      layout !== 'flow' &&
      (current.next.w !== item.w || current.next.h !== item.h)
    )
      onChange({ ...item, ...current.next });
  }

  if (layout === 'flow') return null;
  return (
    <>
      <button
        type="button"
        className="canvas-resize-handle"
        disabled={disabled}
        aria-label={`调整组件尺寸 ${item.viewId}`}
        title="拖动调整组件尺寸；支持键盘方向键：左右调整宽度，上下调整高度"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0 || resize.current) return;
          const board = event.currentTarget.closest('.canvas-board');
          if (!board || window.matchMedia('(max-width: 760px)').matches) return;
          const computed = window.getComputedStyle(board);
          if (layout === 'grid' && computed.display !== 'grid') return;
          const columnGap = Number.parseFloat(computed.columnGap);
          const columnWidth =
            (board.getBoundingClientRect().width + (Number.isFinite(columnGap) ? columnGap : gap)) /
            COLUMNS;
          if (columnWidth <= 0) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus();
          const original = {
            w: clamp(item.w, 1, maxWidth),
            h: clamp(item.h, 1, MAX_HEIGHT),
          };
          resize.current = {
            pointer: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            columnWidth,
            heights:
              layout === 'grid'
                ? spanHeights(computed, item, gap)
                : Array.from({ length: MAX_HEIGHT }, (_, index) => (index + 1) * (48 + gap) - gap),
            original,
            next: original,
          };
          setPreview(original);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={update}
        onPointerUp={(event) => stop(event, true)}
        onPointerCancel={(event) => stop(event, false)}
        onLostPointerCapture={(event) => stop(event, false)}
        onKeyDown={(event) => {
          if (
            disabled ||
            resize.current ||
            !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const w = clamp(
            item.w + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0),
            1,
            maxWidth,
          );
          const h = clamp(
            item.h + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0),
            1,
            MAX_HEIGHT,
          );
          if (w !== item.w || h !== item.h) onChange({ ...item, w, h });
        }}
      >
        ◢
      </button>
      {preview && !disabled && (
        <span className="canvas-resize-preview" role="status" aria-live="polite">
          {preview.w} × {preview.h}
        </span>
      )}
    </>
  );
}

import { useRef } from 'react';
import type { CanvasInstance } from './useCanvasComposition';

const COLUMNS = 12;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
type Position = { id: string; x: number; y: number };
type Props = {
  item: CanvasInstance;
  selected: boolean;
  disabled: boolean;
  layout: 'grid' | 'flow' | 'free';
  gap: number;
  onSelect: () => void;
  onPreview: (position: Position | null) => void;
  onChange: (item: CanvasInstance) => void;
};
type Drag = {
  pointer: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  nextX: number;
  nextY: number;
  columnWidth: number;
  rows: number[];
};

/** Resolved grid tracks can grow with business content; map pointer deltas to their real starts. */
function rowStarts(computed: CSSStyleDeclaration): number[] {
  const tracks = computed.gridTemplateRows.trim().split(/\s+/);
  if (!tracks.length || tracks.some((track) => !/^\d+(?:\.\d+)?px$/.test(track))) return [];
  const gap = Number.parseFloat(computed.rowGap) || 0;
  const starts = [0];
  for (const track of tracks)
    starts.push(starts[starts.length - 1] + Number.parseFloat(track) + gap);
  return starts.slice(0, -1);
}

export default function CanvasHandle({
  item,
  selected,
  disabled,
  layout,
  gap,
  onSelect,
  onPreview,
  onChange,
}: Props) {
  const drag = useRef<Drag | null>(null);
  function stop(commit: boolean) {
    const current = drag.current;
    drag.current = null;
    onPreview(null);
    if (commit && current) onChange({ ...item, x: current.nextX, y: current.nextY });
  }
  return (
    <div className="canvas-instance-tools">
      <button
        type="button"
        className="canvas-drag-handle"
        disabled={disabled}
        aria-label={`选择并移动组件 ${item.viewId}`}
        aria-pressed={selected}
        onClick={onSelect}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          onSelect();
          const board = event.currentTarget.closest('.canvas-board');
          if (!board || layout === 'flow' || window.matchMedia('(max-width: 760px)').matches)
            return;
          const computed = window.getComputedStyle(board);
          if (computed.display !== 'grid' && layout !== 'free') return;
          event.preventDefault();
          const x = clamp(item.x, 0, COLUMNS - item.w);
          drag.current = {
            pointer: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x,
            y: item.y,
            nextX: x,
            nextY: item.y,
            columnWidth: (board.getBoundingClientRect().width + gap) / COLUMNS,
            rows: layout === 'grid' ? rowStarts(computed) : [],
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          current.nextX = clamp(
            current.x + Math.round((event.clientX - current.startX) / current.columnWidth),
            0,
            COLUMNS - item.w,
          );
          const delta = event.clientY - current.startY;
          if (layout === 'free') {
            current.nextY = clamp(current.y + Math.round(delta / (48 + gap)), 0, 100);
          } else if (current.rows[current.y] !== undefined) {
            const target = current.rows[current.y] + delta;
            current.nextY = current.rows.reduce(
              (closest, start, index, rows) =>
                Math.abs(start - target) < Math.abs(rows[closest] - target) ? index : closest,
              0,
            );
            current.nextY = Math.min(100, current.nextY);
          }
          onPreview({ id: item.id, x: current.nextX, y: current.nextY });
        }}
        onPointerUp={() => stop(true)}
        onPointerCancel={() => stop(false)}
        onLostPointerCapture={() => stop(false)}
        onKeyDown={(event) => {
          if (
            disabled ||
            layout === 'flow' ||
            !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
          )
            return;
          event.preventDefault();
          onChange({
            ...item,
            x: clamp(
              item.x + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0),
              0,
              COLUMNS - item.w,
            ),
            y: clamp(
              item.y + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0),
              0,
              100,
            ),
          });
        }}
      >
        ⠿ {item.viewId}
        {!item.visible ? ' · 已隐藏' : ''}
      </button>
    </div>
  );
}

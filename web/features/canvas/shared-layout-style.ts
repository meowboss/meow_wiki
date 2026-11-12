import type { CSSProperties } from 'react';
import type { CanvasInstance, CompositionDocument } from '../../../packages/canvas-contract/index';
import { canvasThemeStyle } from './theme';

export const CANVAS_COLUMNS = 12;
type Position = Pick<CanvasInstance, 'id' | 'x' | 'y'>;

/** Logical coordinates are shared by grid, free, and overlay layouts. */
export function canvasItemStyle(
  item: CanvasInstance,
  dragPosition?: Position | null,
): CSSProperties {
  const position = dragPosition?.id === item.id ? dragPosition : item;
  const width = Math.min(item.w, CANVAS_COLUMNS);
  const x = Math.min(position.x, CANVAS_COLUMNS - width);
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

export function canvasBoardStyle(composition: CompositionDocument, editing = false): CSSProperties {
  const visible = composition.instances.filter((item) => editing || item.visible);
  const maxBottom = Math.max(1, ...visible.map((item) => item.y + item.h));
  return {
    '--canvas-columns': CANVAS_COLUMNS,
    '--canvas-gap': `${composition.gap}px`,
    '--canvas-height': `${maxBottom * 48 + Math.max(0, maxBottom - 1) * composition.gap}px`,
    ...canvasThemeStyle(composition.theme),
    background: composition.background,
  } as CSSProperties;
}

export function canvasBoardClassName(composition: CompositionDocument, editing = false): string {
  const directory = composition.instances.find((item) => item.viewId === 'wiki.directory');
  const document = composition.instances.find((item) => item.viewId === 'wiki.document');
  const defaultWiki =
    composition.surface === 'wiki' &&
    directory?.x === 0 &&
    directory.w === 4 &&
    document?.x === 4 &&
    document.w === 8;
  return [
    'canvas-board',
    composition.theme !== undefined && 'canvas-themed',
    `canvas-layout-${composition.layout}`,
    composition.tree !== undefined && 'canvas-has-tree',
    editing && 'canvas-editing-board',
    defaultWiki && 'canvas-default-wiki',
  ]
    .filter(Boolean)
    .join(' ');
}

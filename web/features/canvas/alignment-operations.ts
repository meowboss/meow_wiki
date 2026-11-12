import type { CanvasInstance } from './useCanvasComposition';
export function alignCanvasInstance(
  instance: CanvasInstance,
  alignment: 'left' | 'center' | 'right' | 'full',
): CanvasInstance {
  const x =
    alignment === 'left' || alignment === 'full'
      ? 0
      : alignment === 'right'
        ? 12 - instance.w
        : Math.floor((12 - instance.w) / 2);
  return { ...instance, x, w: alignment === 'full' ? 12 : instance.w };
}

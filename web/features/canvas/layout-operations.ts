import type { Composition } from '../../../packages/canvas-contract/index';
/** Ordering is persistent document state: it defines flow/reading order and same-plane stacking. */
export function moveCanvasInstance(document: Composition, id: string, delta: -1 | 1): Composition {
  const index = document.instances.findIndex((instance) => instance.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= document.instances.length) return document;
  const instances = [...document.instances];
  [instances[index], instances[target]] = [instances[target], instances[index]];
  return { ...document, instances };
}

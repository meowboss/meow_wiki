import type { Composition } from '../../../packages/canvas-contract/index';
/** Local configuration export; never includes fetched business content or provider credentials. */
export function exportCanvasLayout(composition: Composition) {
  const blob = new Blob([JSON.stringify(composition, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `canvas-${composition.surface}-v${composition.revision}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

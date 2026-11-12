import { z } from 'zod';
import { compositionSchema, type CanvasSurface } from '../../../packages/canvas-contract/index';

export const MAX_CANVAS_DRAFT_BYTES = 1024 * 1024;
export interface CanvasDraftScope {
  ownerId: string;
  workspaceId: string;
  surface: CanvasSurface;
}
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const canvasDraftSchema = z
  .strictObject({
    composition: compositionSchema,
    baseRevision: revision,
    savedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .refine((draft) => draft.composition.revision === draft.baseRevision);
export type CanvasDraft = z.infer<typeof canvasDraftSchema>;

export function canvasDraftKey(scope: CanvasDraftScope): string {
  return `meow.canvas.draft:${encodeURIComponent(scope.ownerId)}:${encodeURIComponent(scope.workspaceId)}:${scope.surface}`;
}
function sessionStorageOrNull(): DraftStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
function validScope(scope: CanvasDraftScope): boolean {
  return Boolean(scope.ownerId.trim() && scope.workspaceId.trim());
}
export function clearCanvasDraft(
  scope: CanvasDraftScope,
  storage: DraftStorage | null = sessionStorageOrNull(),
): void {
  if (!storage || !validScope(scope)) return;
  try {
    storage.removeItem(canvasDraftKey(scope));
  } catch {
    // Storage may be disabled; layout editing remains available.
  }
}
export function readCanvasDraft(
  scope: CanvasDraftScope,
  storage: DraftStorage | null = sessionStorageOrNull(),
): CanvasDraft | null {
  if (!storage || !validScope(scope)) return null;
  try {
    const raw = storage.getItem(canvasDraftKey(scope));
    if (raw === null) return null;
    if (new TextEncoder().encode(raw).byteLength > MAX_CANVAS_DRAFT_BYTES) {
      clearCanvasDraft(scope, storage);
      return null;
    }
    const result = canvasDraftSchema.safeParse(JSON.parse(raw));
    if (!result.success || result.data.composition.surface !== scope.surface) {
      clearCanvasDraft(scope, storage);
      return null;
    }
    return result.data;
  } catch {
    clearCanvasDraft(scope, storage);
    return null;
  }
}
export function saveCanvasDraft(
  scope: CanvasDraftScope,
  draft: CanvasDraft,
  storage: DraftStorage | null = sessionStorageOrNull(),
): boolean {
  if (!storage || !validScope(scope)) return false;
  const result = canvasDraftSchema.safeParse(draft);
  if (!result.success || result.data.composition.surface !== scope.surface) return false;
  try {
    const raw = JSON.stringify(result.data);
    if (new TextEncoder().encode(raw).byteLength > MAX_CANVAS_DRAFT_BYTES) return false;
    storage.setItem(canvasDraftKey(scope), raw);
    return true;
  } catch {
    return false;
  }
}

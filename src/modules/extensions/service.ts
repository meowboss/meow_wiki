import { AccessError, type Store } from '../../store.ts';
import type { Kernel } from '../../kernel.ts';

/** Plugin configuration use cases; component use cases remain in ComponentService. */
export class ExtensionsService {
  constructor(
    private readonly store: Store,
    private readonly kernel: Kernel,
  ) {}

  setEnabled(owner: string, workspaceId: string, pluginId: string, enabled: boolean) {
    return this.store.change(owner, workspaceId, (draft) => {
      if (!this.kernel.list().some((p) => p.id === pluginId)) throw new AccessError('未找到插件');
      const next = new Set(draft.enabled);
      if (enabled) next.add(pluginId);
      else next.delete(pluginId);
      this.kernel.validateEnabled(next);
      draft.enabled = [...next];
      return { ok: true };
    });
  }
}

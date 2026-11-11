import type { Store, Workspace } from '../../store.ts';
import type { ComponentService } from '../../components.ts';
import type { Kernel } from '../../kernel.ts';

export class WorkspacesService {
  constructor(
    private readonly store: Store,
    private readonly components: ComponentService,
    private readonly kernel: Kernel,
  ) {}

  list(owner: string) {
    return this.store.list(owner);
  }

  create(owner: string, name: string, description: string) {
    return this.store.create(owner, name, description);
  }

  update(owner: string, workspaceId: string, input: { name: string; description: string }) {
    return this.store.change(owner, workspaceId, (w) => {
      w.name = input.name;
      w.description = input.description;
      return { id: w.id, name: w.name, description: w.description };
    });
  }

  snapshot(owner: string, w: Workspace) {
    const releases = this.components.releases(owner, w.id);
    return {
      workspace: { id: w.id, name: w.name, description: w.description },
      pages: w.pages.filter((p) => !p.deletedAt),
      trash: w.pages.filter((p) => p.deletedAt),
      plugins: this.kernel.list().map((p) => ({ ...p, enabled: w.enabled.includes(p.id) })),
      components: this.components.list(owner, w.id).map((draft) => {
        const latestRelease =
          releases.filter((release) => release.componentId === draft.id).at(-1) ?? null;
        return { ...draft, status: latestRelease?.status ?? 'private', latestRelease };
      }),
      marketplace: this.components.marketplace(),
      installed: this.components.installed(w.id),
    };
  }
}

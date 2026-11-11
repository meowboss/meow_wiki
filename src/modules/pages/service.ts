import { randomUUID } from 'node:crypto';
import type { Page, Store, Workspace } from '../../store.ts';
import type { Kernel } from '../../kernel.ts';

export type PageInput = Pick<Page, 'title' | 'markdown'>;
export type PagePatch = PageInput & { parentId?: string | null };

/** Page use cases accept validated values and have no HTTP/request dependencies. */
export class PagesService {
  constructor(
    private readonly store: Store,
    private readonly kernel: Kernel,
  ) {}

  async render(workspace: Workspace, markdown: string) {
    return { html: await this.kernel.service('render', new Set(workspace.enabled))(markdown) };
  }

  search(workspace: Workspace, query: string) {
    return {
      results: this.kernel.service('search', new Set(workspace.enabled))(
        query,
        workspace.pages.filter((p) => !p.deletedAt),
      ),
    };
  }

  ask(workspace: Workspace, question: string) {
    return this.kernel.service('ask', new Set(workspace.enabled))(
      question,
      workspace.pages.filter((p) => !p.deletedAt),
    );
  }

  create(owner: string, workspaceId: string, input: PageInput): Page {
    const page: Page = {
      id: randomUUID(),
      ...input,
      updatedAt: new Date().toISOString(),
      revision: 1,
      deletedAt: null,
      parentId: null,
    };
    this.store.change(owner, workspaceId, (draft) => {
      if (draft.pages.length >= 1000)
        throw Object.assign(new Error('已达到本原型每空间 1000 页上限'), { statusCode: 409 });
      draft.pages.push(page);
    });
    return page;
  }

  update(
    owner: string,
    workspaceId: string,
    pageId: string,
    expectedRevision: number,
    patch: PagePatch,
  ) {
    return this.store.updatePage(owner, workspaceId, pageId, expectedRevision, patch);
  }

  history(owner: string, workspaceId: string, pageId: string) {
    return this.store.history(owner, workspaceId, pageId);
  }

  restore(
    owner: string,
    workspaceId: string,
    pageId: string,
    revision: number,
    expectedRevision: number,
  ) {
    return this.store.restorePage(owner, workspaceId, pageId, revision, expectedRevision);
  }

  delete(owner: string, workspaceId: string, pageId: string, expectedRevision: number) {
    return this.store.updatePage(owner, workspaceId, pageId, expectedRevision, {}, 'delete');
  }

  undelete(owner: string, workspaceId: string, pageId: string, expectedRevision: number) {
    return this.store.updatePage(owner, workspaceId, pageId, expectedRevision, {}, 'undelete');
  }
}

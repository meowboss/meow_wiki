import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConflictError, type Store } from '../../store.ts';

const sourceId = z
  .string()
  .min(1)
  .max(200)
  .refine((id) => id.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(id));
const bundleSchema = z
  .object({
    format: z.literal('meow.pages.v1'),
    version: z.literal(1),
    workspace: z
      .object({
        name: z
          .string()
          .min(1)
          .max(160)
          .refine((name) => name.trim().length > 0),
        description: z.string().max(500),
      })
      .strict(),
    // Empty spaces (including spaces containing only tombstones) can round-trip.
    pages: z
      .array(
        z
          .object({
            id: sourceId,
            title: z
              .string()
              .min(1)
              .max(160)
              .refine((title) => title.trim().length > 0),
            markdown: z.string().max(200_000),
            parentId: sourceId.nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type PageBundle = z.infer<typeof bundleSchema>;

function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

/** Portable page content only; persistence and transaction ownership remain in Store. */
export class PageTransfer {
  constructor(private readonly store: Store) {}

  export(owner: string, workspaceId: string): PageBundle {
    const workspace = this.store.get(owner, workspaceId);
    const bundle: PageBundle = {
      format: 'meow.pages.v1',
      version: 1,
      workspace: { name: workspace.name, description: workspace.description },
      pages: workspace.pages
        .filter((page) => !page.deletedAt)
        .map(({ id, title, markdown, parentId }) => ({ id, title, markdown, parentId })),
    };
    if (
      bundle.pages.length > 100 ||
      Buffer.byteLength(JSON.stringify(bundle), 'utf8') > 5 * 1024 * 1024
    )
      throw new ConflictError(
        '当前空间超过单包100页/5MiB可恢复边界，未生成不可回导页面包；请使用数据库备份，分批页面包支持尚未实现',
      );
    return bundle;
  }

  import(owner: string, workspaceId: string, input: unknown) {
    const parsed = bundleSchema.safeParse(input);
    if (!parsed.success) invalid('页面包格式无效');
    const bundle = parsed.data;
    if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > 5 * 1024 * 1024)
      invalid('页面包超过5MiB上限');

    const sources = new Map(bundle.pages.map((page) => [page.id, page]));
    if (sources.size !== bundle.pages.length) invalid('页面包包含重复ID');
    for (const page of bundle.pages) {
      const visited = new Set<string>([page.id]);
      let parentId = page.parentId;
      while (parentId !== null) {
        if (visited.has(parentId)) invalid('页面包不能包含循环父子关系');
        visited.add(parentId);
        const parent = sources.get(parentId);
        if (!parent) invalid('页面包缺少父页面');
        parentId = parent.parentId;
      }
    }

    return this.store.change(owner, workspaceId, (workspace) => {
      if (workspace.pages.length + bundle.pages.length > 1000)
        throw new ConflictError('已达到本原型每空间 1000 页上限');
      const used = new Set([...workspace.pages.map((page) => page.id), ...sources.keys()]);
      const ids = new Map<string, string>();
      for (const page of bundle.pages) {
        let id: string;
        do {
          id = randomUUID();
        } while (used.has(id));
        used.add(id);
        ids.set(page.id, id);
      }
      const updatedAt = new Date().toISOString();
      workspace.pages.push(
        ...bundle.pages.map((page) => ({
          id: ids.get(page.id)!,
          title: page.title,
          markdown: page.markdown,
          parentId: page.parentId === null ? null : ids.get(page.parentId)!,
          revision: 1,
          updatedAt,
          deletedAt: null,
        })),
      );
      return {
        imported: bundle.pages.length,
        mapping: [...ids].map(([sourceId, id]) => ({ sourceId, id })),
      };
    });
  }
}

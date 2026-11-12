import type { DatabaseSync } from 'node:sqlite';
import {
  compositionSchema,
  compositionUpdateSchema,
  createDefaultComposition,
  surfaceSchema,
  type CanvasSurface,
  type Composition,
} from '../../../packages/canvas-contract/index.ts';

export class CompositionError extends Error {
  constructor(
    readonly statusCode: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Dedicated C0 storage: never edits workspace/page snapshots or legacy mw_layouts. */
export class CompositionService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly authorize: (owner: string, workspace: string) => void,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS mw_compositions (
      owner TEXT NOT NULL,
      workspace TEXT NOT NULL,
      surface TEXT NOT NULL CHECK (surface IN ('home', 'wiki', 'collaboration')),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      json TEXT NOT NULL,
      PRIMARY KEY (owner, workspace, surface)
    )`);
  }

  get(owner: string, workspace: string, surface: CanvasSurface): Composition {
    this.authorize(owner, workspace);
    surfaceSchema.parse(surface);
    const row = this.db
      .prepare(
        'SELECT revision, json FROM mw_compositions WHERE owner = ? AND workspace = ? AND surface = ?',
      )
      .get(owner, workspace, surface);
    if (!row) return createDefaultComposition(surface);
    return compositionSchema.parse({
      ...JSON.parse(String(row.json)),
      revision: Number(row.revision),
    });
  }

  update(owner: string, workspace: string, surface: CanvasSurface, input: unknown): Composition {
    this.authorize(owner, workspace);
    surfaceSchema.parse(surface);
    const parsed = compositionUpdateSchema.safeParse(input);
    if (!parsed.success) throw new CompositionError(400, '画布输入校验失败');
    const { expectedRevision, composition } = parsed.data;
    if (composition.surface !== surface)
      throw new CompositionError(400, '画布 surface 与路径不一致');
    for (const instance of composition.instances) {
      if (instance.viewId !== 'component.render') continue;
      const { componentId, releaseId } = instance.config;
      if (!!componentId === !!releaseId)
        throw new CompositionError(400, '空间组件需要唯一的草稿或发行版引用');
      const allowed = componentId
        ? this.db
            .prepare('SELECT 1 FROM mw_components WHERE id=? AND author_id=? AND workspace_id=?')
            .get(componentId, owner, workspace)
        : this.db
            .prepare('SELECT 1 FROM mw_installs WHERE release_id=? AND workspace_id=?')
            .get(releaseId!, workspace);
      if (!allowed) throw new CompositionError(400, '空间组件不可访问或尚未安装');
    }
    if (expectedRevision === Number.MAX_SAFE_INTEGER)
      throw new CompositionError(409, '画布版本已达上限');
    const json = JSON.stringify(composition);
    if (Buffer.byteLength(json, 'utf8') > 1024 * 1024)
      throw new CompositionError(400, '画布不能超过 1MiB');

    // Synchronous SAVEPOINT composes with an existing transaction without async interleaving.
    this.db.exec('SAVEPOINT composition_update');
    try {
      const result =
        expectedRevision === 0
          ? this.db
              .prepare(
                `INSERT INTO mw_compositions (owner, workspace, surface, revision, json)
            VALUES (?, ?, ?, 1, ?) ON CONFLICT (owner, workspace, surface) DO NOTHING`,
              )
              .run(owner, workspace, surface, json)
          : this.db
              .prepare(
                `UPDATE mw_compositions SET revision = revision + 1, json = ?
            WHERE owner = ? AND workspace = ? AND surface = ? AND revision = ?`,
              )
              .run(json, owner, workspace, surface, expectedRevision);
      if (result.changes !== 1) throw new CompositionError(409, '画布已被更新，请重新加载');
      const saved: Composition = { ...composition, revision: expectedRevision + 1 };
      this.db.exec('RELEASE SAVEPOINT composition_update');
      return saved;
    } catch (error) {
      this.db.exec('ROLLBACK TO SAVEPOINT composition_update');
      this.db.exec('RELEASE SAVEPOINT composition_update');
      throw error;
    }
  }
}

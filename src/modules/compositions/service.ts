import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { layoutSchema } from '../../components.ts';
import {
  compositionSchema,
  compositionUpdateSchema,
  createDefaultComposition,
  surfaceSchema,
  type CanvasSurface,
  type Composition,
  type CompositionDocument,
} from '../../../packages/canvas-contract/index.ts';

const legacyMigrationSchema = z.strictObject({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

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
    );
    CREATE TABLE IF NOT EXISTS mw_composition_migrations (
      owner TEXT NOT NULL,
      workspace TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      source_digest TEXT NOT NULL,
      target_revision INTEGER NOT NULL,
      PRIMARY KEY (owner, workspace)
    )`);
  }

  /** Explicit, one-time home import; GET never reads or migrates legacy layouts. */
  migrateLegacy(owner: string, workspace: string, input: unknown): Composition {
    this.authorize(owner, workspace);
    const parsed = legacyMigrationSchema.safeParse(input);
    if (!parsed.success) throw new CompositionError(400, '迁移输入校验失败');

    // This outer savepoint atomically commits both update() and its provenance marker.
    this.db.exec('SAVEPOINT composition_migrate_legacy');
    try {
      const migrated = this.db
        .prepare('SELECT 1 FROM mw_composition_migrations WHERE owner = ? AND workspace = ?')
        .get(owner, workspace);
      if (migrated) {
        const current = this.get(owner, workspace, 'home');
        this.db.exec('RELEASE SAVEPOINT composition_migrate_legacy');
        return current;
      }
      const row = this.db
        .prepare('SELECT json, revision FROM mw_layouts WHERE workspace_id = ?')
        .get(workspace);
      if (!row) throw new CompositionError(400, '没有可迁移的旧首页布局');
      let source: unknown;
      try {
        source = JSON.parse(String(row.json));
      } catch {
        throw new CompositionError(400, '旧首页布局 JSON 无效');
      }
      const legacy = layoutSchema.safeParse(source);
      if (!legacy.success) throw new CompositionError(400, '旧首页布局格式无效');
      const { revision: _, ...composition } = createDefaultComposition('home');
      // Migration intentionally yields only independent title/component views, not legacy controls.
      composition.instances = [];
      composition.instances.push({
        id: 'legacy-title',
        viewId: 'builtin.text',
        visible: true,
        layer: 'content' as const,
        x: 0,
        y: 0,
        w: 12,
        h: 1,
        config: { text: legacy.data.title },
        style: {},
      });
      composition.instances.push(
        ...legacy.data.blocks.map((block, index) => ({
          id: `legacy-${index}`,
          viewId: 'component.render' as const,
          visible: true,
          layer: 'content' as const,
          x: (index % 2) * 6,
          y: 1 + Math.floor(index / 2) * 4,
          w: 6,
          h: 4,
          config: block,
          style: {},
        })),
      );
      // Reuse normal validation, reference authorization and revision CAS.
      const saved = this.update(owner, workspace, 'home', {
        expectedRevision: parsed.data.expectedRevision,
        composition,
      });
      this.db
        .prepare(
          `INSERT INTO mw_composition_migrations
          (owner, workspace, source_revision, source_digest, target_revision) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          owner,
          workspace,
          row.revision,
          createHash('sha256').update(String(row.json)).digest('hex'),
          saved.revision,
        );
      this.db.exec('RELEASE SAVEPOINT composition_migrate_legacy');
      return saved;
    } catch (error) {
      this.db.exec('ROLLBACK TO SAVEPOINT composition_migrate_legacy');
      this.db.exec('RELEASE SAVEPOINT composition_migrate_legacy');
      throw error;
    }
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

  validateReferences(owner: string, workspace: string, composition: CompositionDocument): void {
    this.authorize(owner, workspace);
    for (const instance of composition.instances) {
      if (instance.config.assetId) {
        const asset = this.db
          .prepare('SELECT mime FROM mw_assets WHERE id=? AND owner=? AND workspace=?')
          .get(instance.config.assetId, owner, workspace);
        if (
          !asset ||
          (instance.viewId === 'builtin.image' && !String(asset.mime).startsWith('image/')) ||
          (instance.viewId === 'builtin.video' && !String(asset.mime).startsWith('video/'))
        )
          throw new CompositionError(400, '媒体素材不可访问或格式不匹配');
      }
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
  }

  update(owner: string, workspace: string, surface: CanvasSurface, input: unknown): Composition {
    this.authorize(owner, workspace);
    surfaceSchema.parse(surface);
    const parsed = compositionUpdateSchema.safeParse(input);
    if (!parsed.success) throw new CompositionError(400, '画布输入校验失败');
    const { expectedRevision, composition } = parsed.data;
    if (composition.surface !== surface)
      throw new CompositionError(400, '画布 surface 与路径不一致');
    this.validateReferences(owner, workspace, composition);
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

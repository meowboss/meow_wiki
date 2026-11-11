import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const identifier = z.string().min(1).max(200);
export const componentSchema = z
  .object({
    name: z.string().min(1).max(160),
    description: z.string().max(500),
    template: z.string().max(10000),
    blocks: z
      .array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('markdown'), text: z.string().max(10000) }).strict(),
          z.object({ type: z.literal('page-list'), title: z.string().max(160) }).strict(),
          z.object({ type: z.literal('search'), title: z.string().max(160) }).strict(),
        ]),
      )
      .max(20)
      .optional(),
  })
  .strict();
export const layoutSchema = z
  .object({
    title: z.string().min(1).max(160),
    blocks: z
      .array(
        z
          .object({ componentId: identifier.optional(), releaseId: identifier.optional() })
          .strict()
          .refine(
            (value) =>
              Number(value.componentId !== undefined) + Number(value.releaseId !== undefined) === 1,
            'Each block must reference exactly one draft or release',
          ),
      )
      .max(12),
  })
  .strict();
export type ComponentInput = z.infer<typeof componentSchema>;
export type LayoutInput = z.infer<typeof layoutSchema>;
export type ComponentDraft = ComponentInput & {
  id: string;
  authorId: string;
  workspaceId: string;
  version: number;
};
export type ReleaseStatus = 'pending' | 'published' | 'rejected' | 'withdrawn';
export type ComponentRelease = ComponentInput & {
  id: string;
  componentId: string;
  authorId: string;
  workspaceId: string;
  version: number;
  status: ReleaseStatus;
  digest: string;
  reviewerId: string | null;
  reason: string | null;
};
export type ComponentInstall = {
  workspaceId: string;
  releaseId: string;
  release: ComponentRelease;
};
export class ComponentError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ComponentError';
  }
}
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw new ComponentError('Invalid component input', 400);
  return result.data;
};
const missing = () => new ComponentError('Component or workspace not found', 404);
const conflict = () => new ComponentError('Component state conflict', 409);

export function ensureAudit(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS mw_audit (
    id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
    target_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS mw_audit_no_update BEFORE UPDATE ON mw_audit
    BEGIN SELECT RAISE(ABORT, 'Audit is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS mw_audit_no_delete BEFORE DELETE ON mw_audit
    BEGIN SELECT RAISE(ABORT, 'Audit is immutable'); END;`);
}

/** Synchronous declaration-only storage. HTTP must authorize workspace-only methods and admin review calls.
 * Workspace ownership comes from the host's workspaces(id, owner) table; no legacy component data is used.
 * Draft updates replace the full definition and increment version. Release definitions never change.
 */
export class ComponentService {
  constructor(private readonly db: DatabaseSync) {
    this.database(() =>
      db.exec(`
      CREATE TABLE IF NOT EXISTS mw_components (
        id TEXT PRIMARY KEY, author_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        content TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0)
      );
      CREATE TABLE IF NOT EXISTS mw_releases (
        id TEXT PRIMARY KEY, component_id TEXT NOT NULL REFERENCES mw_components(id),
        author_id TEXT NOT NULL, workspace_id TEXT NOT NULL, content TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        status TEXT NOT NULL CHECK(status IN ('pending','published','rejected','withdrawn')),
        digest TEXT NOT NULL, reviewer_id TEXT, reason TEXT,
        UNIQUE(component_id, version)
      );
      CREATE TABLE IF NOT EXISTS mw_installs (
        workspace_id TEXT NOT NULL, release_id TEXT NOT NULL REFERENCES mw_releases(id),
        PRIMARY KEY(workspace_id, release_id)
      );
      CREATE TABLE IF NOT EXISTS mw_layouts (workspace_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS mw_components_scope ON mw_components(author_id, workspace_id);
      CREATE INDEX IF NOT EXISTS mw_releases_status ON mw_releases(status);
      CREATE TRIGGER IF NOT EXISTS mw_release_snapshot_immutable
        BEFORE UPDATE OF id, component_id, author_id, workspace_id, content, version, digest ON mw_releases
        BEGIN SELECT RAISE(ABORT, 'Release snapshot is immutable'); END;
    `),
    );
    this.database(() => {
      ensureAudit(db);
      if (
        !db
          .prepare('PRAGMA table_info(mw_layouts)')
          .all()
          .some((row) => row.name === 'revision')
      ) {
        db.exec('ALTER TABLE mw_layouts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
      }
      db.exec(
        'CREATE TABLE IF NOT EXISTS mw_component_migrations (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
    });
    this.transaction(() => {
      const key = 'legacy-components-v1';
      if (db.prepare('SELECT 1 FROM mw_component_migrations WHERE key=?').get(key)) return;
      const hasLegacyData = db
        .prepare('PRAGMA table_info(workspaces)')
        .all()
        .some((row) => row.name === 'data');
      for (const row of hasLegacyData
        ? db.prepare('SELECT id, owner, data FROM workspaces').all()
        : []) {
        const legacy = JSON.parse(String(row.data));
        for (const old of legacy.components ?? []) {
          // Installed catalog copies are not drafts. Preserve all legacy JSON in place as an archive.
          if (old.authorId !== String(row.owner)) continue;
          const content = parse(componentSchema, {
            name: old.name,
            description: old.description,
            template: old.template,
            ...(old.blocks === undefined ? {} : { blocks: old.blocks }),
          });
          db.prepare(
            'INSERT OR IGNORE INTO mw_components (id, author_id, workspace_id, content, version) VALUES (?, ?, ?, ?, 1)',
          ).run(old.id, String(row.owner), String(row.id), JSON.stringify(content));
        }
      }
      // Legacy catalog publication is deliberately not trusted as a reviewed release.
      db.prepare('INSERT INTO mw_component_migrations VALUES (?, ?)').run(
        key,
        new Date().toISOString(),
      );
    });
  }

  create(authorId: string, workspaceId: string, input: unknown): ComponentDraft {
    this.ids(authorId, workspaceId);
    const content = parse(componentSchema, input);
    return this.transaction(() => {
      this.ownedWorkspace(authorId, workspaceId);
      if (
        Number(
          this.db
            .prepare('SELECT count(*) AS n FROM mw_components WHERE workspace_id=?')
            .get(workspaceId)!.n,
        ) >= 200
      )
        throw conflict();
      const draft = { ...content, id: randomUUID(), authorId, workspaceId, version: 1 };
      this.db
        .prepare(
          'INSERT INTO mw_components (id, author_id, workspace_id, content, version) VALUES (?, ?, ?, ?, ?)',
        )
        .run(draft.id, authorId, workspaceId, JSON.stringify(content), 1);
      return draft;
    });
  }

  list(authorId: string, workspaceId: string): ComponentDraft[] {
    this.ids(authorId, workspaceId);
    return this.database(() => {
      this.ownedWorkspace(authorId, workspaceId);
      return this.db
        .prepare(
          'SELECT * FROM mw_components WHERE author_id = ? AND workspace_id = ? ORDER BY rowid',
        )
        .all(authorId, workspaceId)
        .map((row) => this.draft(row));
    });
  }

  update(
    authorId: string,
    workspaceId: string,
    id: string,
    input: unknown,
    expectedVersion?: number,
  ): ComponentDraft {
    this.ids(authorId, workspaceId, id);
    const content = parse(componentSchema, input);
    if (expectedVersion !== undefined) parse(z.number().int().positive(), expectedVersion);
    return this.transaction(() => {
      const current = this.scopedDraft(authorId, workspaceId, id);
      if (expectedVersion !== undefined && current.version !== expectedVersion) throw conflict();
      const version = current.version + 1;
      this.db
        .prepare('UPDATE mw_components SET content = ?, version = ? WHERE id = ?')
        .run(JSON.stringify(content), version, id);
      return { ...content, id, authorId, workspaceId, version };
    });
  }

  submit(authorId: string, workspaceId: string, id: string): ComponentRelease {
    this.ids(authorId, workspaceId, id);
    return this.transaction(() => {
      const draft = this.scopedDraft(authorId, workspaceId, id);
      if (
        this.db
          .prepare('SELECT id FROM mw_releases WHERE component_id = ? AND version = ?')
          .get(id, draft.version)
      )
        throw conflict();
      const content = JSON.stringify(
        parse(componentSchema, {
          name: draft.name,
          description: draft.description,
          template: draft.template,
          ...(draft.blocks === undefined ? {} : { blocks: draft.blocks }),
        }),
      );
      const releaseId = randomUUID();
      const digest = createHash('sha256').update(content).digest('hex');
      this.db
        .prepare(
          `INSERT INTO mw_releases
        (id, component_id, author_id, workspace_id, content, version, status, digest)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(releaseId, id, authorId, workspaceId, content, draft.version, digest);
      return this.releaseById(releaseId);
    });
  }

  /** Trusted admin caller only. */
  pending(): ComponentRelease[] {
    return this.releasesWithStatus('pending');
  }

  /** pending -> published/rejected; published -> withdrawn. Terminal decisions cannot be reversed. */
  review(
    reviewerId: string,
    releaseId: string,
    decision: 'published' | 'rejected' | 'withdrawn',
    reason: string,
  ): ComponentRelease {
    this.ids(reviewerId, releaseId);
    parse(z.enum(['published', 'rejected', 'withdrawn']), decision);
    parse(z.string().max(2000), reason);
    return this.transaction(() => {
      const release = this.releaseById(releaseId);
      if (release.authorId === reviewerId)
        throw new ComponentError('Self review is forbidden', 403);
      if (decision === 'withdrawn' ? release.status !== 'published' : release.status !== 'pending')
        throw conflict();
      this.db
        .prepare('UPDATE mw_releases SET status = ?, reviewer_id = ?, reason = ? WHERE id = ?')
        .run(decision, reviewerId, reason, releaseId);
      this.db
        .prepare('INSERT INTO mw_audit VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          randomUUID(),
          reviewerId,
          'component.review',
          releaseId,
          JSON.stringify({ from: release.status, decision, reason }),
          new Date().toISOString(),
        );
      return this.releaseById(releaseId);
    });
  }

  releases(authorId: string, workspaceId: string): ComponentRelease[] {
    this.ids(authorId, workspaceId);
    return this.database(() => {
      this.ownedWorkspace(authorId, workspaceId);
      return this.db
        .prepare('SELECT * FROM mw_releases WHERE author_id=? AND workspace_id=? ORDER BY rowid')
        .all(authorId, workspaceId)
        .map((row) => this.release(row));
    });
  }

  marketplace(): ComponentRelease[] {
    return this.releasesWithStatus('published');
  }

  /** Caller must authorize the target workspace. Even an idempotent retry requires a published release. */
  install(workspaceId: string, releaseId: string): ComponentInstall {
    this.ids(workspaceId, releaseId);
    return this.transaction(() => {
      this.workspace(workspaceId);
      const release = this.releaseById(releaseId);
      if (release.status !== 'published') throw conflict();
      if (
        !this.db
          .prepare('SELECT 1 FROM mw_installs WHERE workspace_id=? AND release_id=?')
          .get(workspaceId, releaseId) &&
        Number(
          this.db
            .prepare('SELECT count(*) AS n FROM mw_installs WHERE workspace_id=?')
            .get(workspaceId)!.n,
        ) >= 200
      )
        throw conflict();
      this.db
        .prepare('INSERT OR IGNORE INTO mw_installs (workspace_id, release_id) VALUES (?, ?)')
        .run(workspaceId, releaseId);
      return { workspaceId, releaseId, release };
    });
  }

  /** Previously installed definitions remain readable after withdrawal. */
  installed(workspaceId: string): ComponentInstall[] {
    this.ids(workspaceId);
    return this.database(() => {
      this.workspace(workspaceId);
      return this.db
        .prepare(
          `SELECT r.* FROM mw_installs i JOIN mw_releases r ON r.id = i.release_id
        WHERE i.workspace_id = ? ORDER BY i.rowid`,
        )
        .all(workspaceId)
        .map((row) => ({ workspaceId, releaseId: String(row.id), release: this.release(row) }));
    });
  }

  saveLayout(
    authorId: string,
    workspaceId: string,
    input: unknown,
    expectedRevision?: number,
  ): LayoutInput {
    this.ids(authorId, workspaceId);
    const layout = parse(layoutSchema, input);
    if (expectedRevision !== undefined) parse(z.number().int().nonnegative(), expectedRevision);
    return this.transaction(() => {
      this.ownedWorkspace(authorId, workspaceId);
      const row = this.db
        .prepare('SELECT revision FROM mw_layouts WHERE workspace_id=?')
        .get(workspaceId);
      const revision = row ? Number(row.revision) : 0;
      if (expectedRevision !== undefined && revision !== expectedRevision) throw conflict();
      for (const block of layout.blocks) {
        if (block.componentId !== undefined)
          this.scopedDraft(authorId, workspaceId, block.componentId);
        else if (
          !this.db
            .prepare('SELECT 1 FROM mw_installs WHERE workspace_id = ? AND release_id = ?')
            .get(workspaceId, block.releaseId!)
        )
          throw missing();
      }
      if (row) {
        const result = this.db
          .prepare(
            'UPDATE mw_layouts SET json=?, revision=revision+1 WHERE workspace_id=? AND revision=?',
          )
          .run(JSON.stringify(layout), workspaceId, revision);
        if (result.changes !== 1) throw conflict();
      } else {
        this.db
          .prepare('INSERT INTO mw_layouts (workspace_id, json, revision) VALUES (?, ?, 1)')
          .run(workspaceId, JSON.stringify(layout));
      }
      return layout;
    });
  }

  /** Caller must authorize workspace; null means no saved layout (not a generated default). */
  layout(workspaceId: string): LayoutInput | null {
    this.ids(workspaceId);
    return this.database(() => {
      this.workspace(workspaceId);
      const row = this.db
        .prepare('SELECT json FROM mw_layouts WHERE workspace_id = ?')
        .get(workspaceId);
      return row ? (JSON.parse(String(row.json)) as LayoutInput) : null;
    });
  }

  /** Read the layout and resolve its references in order; dangling references stay null. */
  home(
    authorId: string,
    workspaceId: string,
  ): {
    layout: LayoutInput | null;
    components: (ComponentDraft | ComponentRelease | null)[];
    revision: number;
  } {
    this.ids(authorId, workspaceId);
    return this.transaction(() => {
      this.ownedWorkspace(authorId, workspaceId);
      const row = this.db
        .prepare('SELECT json, revision FROM mw_layouts WHERE workspace_id=?')
        .get(workspaceId);
      const layout = row ? (JSON.parse(String(row.json)) as LayoutInput) : null;
      const drafts = new Map(this.list(authorId, workspaceId).map((item) => [item.id, item]));
      const releases = new Map(
        this.installed(workspaceId).map((item) => [item.releaseId, item.release]),
      );
      return {
        layout,
        revision: row ? Number(row.revision) : 0,
        components:
          layout?.blocks.map((block) =>
            block.componentId !== undefined
              ? (drafts.get(block.componentId) ?? null)
              : (releases.get(block.releaseId!) ?? null),
          ) ?? [],
      };
    });
  }

  private ids(...ids: string[]): void {
    for (const id of ids) parse(identifier, id);
  }
  private workspace(id: string): void {
    if (!this.db.prepare('SELECT id FROM workspaces WHERE id = ?').get(id)) throw missing();
  }
  private ownedWorkspace(authorId: string, workspaceId: string): void {
    if (
      !this.db
        .prepare('SELECT id FROM workspaces WHERE id = ? AND owner = ?')
        .get(workspaceId, authorId)
    )
      throw missing();
  }
  private scopedDraft(authorId: string, workspaceId: string, id: string): ComponentDraft {
    this.ownedWorkspace(authorId, workspaceId);
    const row = this.db
      .prepare('SELECT * FROM mw_components WHERE id = ? AND author_id = ? AND workspace_id = ?')
      .get(id, authorId, workspaceId);
    if (!row) throw missing();
    return this.draft(row);
  }
  private draft(row: Record<string, unknown>): ComponentDraft {
    return {
      ...JSON.parse(String(row.content)),
      id: String(row.id),
      authorId: String(row.author_id),
      workspaceId: String(row.workspace_id),
      version: Number(row.version),
    };
  }
  private release(row: Record<string, unknown>): ComponentRelease {
    return {
      ...JSON.parse(String(row.content)),
      id: String(row.id),
      componentId: String(row.component_id),
      authorId: String(row.author_id),
      workspaceId: String(row.workspace_id),
      version: Number(row.version),
      status: row.status as ReleaseStatus,
      digest: String(row.digest),
      reviewerId: row.reviewer_id === null ? null : String(row.reviewer_id),
      reason: row.reason === null ? null : String(row.reason),
    };
  }
  private releaseById(id: string): ComponentRelease {
    const row = this.db.prepare('SELECT * FROM mw_releases WHERE id = ?').get(id);
    if (!row) throw missing();
    return this.release(row);
  }
  private releasesWithStatus(status: ReleaseStatus): ComponentRelease[] {
    return this.database(() =>
      this.db
        .prepare('SELECT * FROM mw_releases WHERE status = ? ORDER BY rowid')
        .all(status)
        .map((row) => this.release(row)),
    );
  }
  private database<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof ComponentError) throw error;
      throw new ComponentError('Component storage unavailable', 500);
    }
  }
  private transaction<T>(operation: () => T): T {
    return this.database(() => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = operation();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          /* Preserve original error. */
        }
        throw error;
      }
    });
  }
}

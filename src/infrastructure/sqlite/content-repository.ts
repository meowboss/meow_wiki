import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page, PageRevision } from '../../modules/pages/domain.ts';

/** SQLite persistence only. Store owns application transactions and authorization. */
export class ContentRepository {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(
        'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS catalog (id TEXT PRIMARY KEY, data TEXT NOT NULL);',
      );
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private migrate() {
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pages_workspace ON pages(workspace_id);
      CREATE TABLE IF NOT EXISTS page_revisions (page_id TEXT NOT NULL REFERENCES pages(id), revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(page_id, revision));`);
    this.begin();
    try {
      // Read the marker under the write lock, including after waiting for another connection.
      if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()) {
        for (const row of this.db.prepare('SELECT id, owner, data FROM workspaces').all()) {
          const workspace = JSON.parse(String(row.data));
          for (const old of workspace.pages ?? []) {
            const page: Page = {
              ...old,
              revision: old.revision ?? 1,
              deletedAt: old.deletedAt ?? null,
              parentId: old.parentId ?? null,
            };
            this.insertPage(String(row.id), String(row.owner), page, 'migration');
          }
        }
        // Do not rewrite the legacy workspace JSON: preserve the original backup payload.
        this.db
          .prepare('INSERT INTO schema_migrations VALUES (1, ?)')
          .run(new Date().toISOString());
      }
      this.commit();
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  begin() {
    this.db.exec('BEGIN IMMEDIATE');
  }
  commit() {
    this.db.exec('COMMIT');
  }
  rollback() {
    this.db.exec('ROLLBACK');
  }
  close() {
    this.db.close();
  }

  workspaceIds(owner: string): string[] {
    return this.db
      .prepare('SELECT id FROM workspaces WHERE owner=? ORDER BY rowid')
      .all(owner)
      .map((row) => String(row.id));
  }
  firstWorkspaceId(owner: string): string | undefined {
    const row = this.db.prepare('SELECT id FROM workspaces WHERE owner = ?').get(owner);
    return row ? String(row.id) : undefined;
  }
  workspaceData(owner: string, id: string): string | undefined {
    const row = this.db
      .prepare('SELECT data FROM workspaces WHERE id = ? AND owner = ?')
      .get(id, owner);
    return row ? String(row.data) : undefined;
  }
  insertWorkspace(id: string, owner: string, data: string) {
    this.db.prepare('INSERT INTO workspaces VALUES (?, ?, ?)').run(id, owner, data);
  }
  updateWorkspace(id: string, owner: string, data: string) {
    this.db
      .prepare('UPDATE workspaces SET data = ? WHERE id = ? AND owner = ?')
      .run(data, id, owner);
  }
  ownerHistoryBytes(owner: string): number {
    return Number(
      this.db
        .prepare(
          `SELECT coalesce(sum(length(CAST(r.data AS BLOB))),0) AS n FROM page_revisions r JOIN pages p ON p.id=r.page_id JOIN workspaces w ON w.id=p.workspace_id WHERE w.owner=?`,
        )
        .get(owner)!.n,
    );
  }
  revisionCount(pageId: string): number {
    return Number(
      this.db.prepare('SELECT count(*) AS n FROM page_revisions WHERE page_id=?').get(pageId)!.n,
    );
  }
  pages(workspaceId: string): Page[] {
    return this.db
      .prepare('SELECT data FROM pages WHERE workspace_id=? ORDER BY rowid')
      .all(workspaceId)
      .map((row) => JSON.parse(String(row.data)));
  }
  insertPage(workspaceId: string, actorId: string, page: Page, operation: string) {
    this.db
      .prepare('INSERT INTO pages VALUES (?, ?, ?)')
      .run(page.id, workspaceId, JSON.stringify(page));
    this.recordRevision(actorId, page, operation);
  }
  updatePage(workspaceId: string, actorId: string, page: Page, operation: string) {
    this.db
      .prepare('UPDATE pages SET data=? WHERE id=? AND workspace_id=?')
      .run(JSON.stringify(page), page.id, workspaceId);
    this.recordRevision(actorId, page, operation);
  }
  private recordRevision(actorId: string, page: Page, operation: string) {
    this.db
      .prepare('INSERT INTO page_revisions VALUES (?, ?, ?)')
      .run(page.id, page.revision, JSON.stringify({ ...page, actorId, operation }));
  }
  history(pageId: string): PageRevision[] {
    return this.db
      .prepare('SELECT data FROM page_revisions WHERE page_id=? ORDER BY revision DESC')
      .all(pageId)
      .map((row) => JSON.parse(String(row.data)));
  }
  deleteOldRevisions(pageId: string, currentRevision: number, keep: number): number {
    return Number(
      this.db
        .prepare(
          `DELETE FROM page_revisions WHERE page_id=? AND revision<>? AND revision NOT IN
          (SELECT revision FROM page_revisions WHERE page_id=? ORDER BY (revision=?) DESC, revision DESC LIMIT ?)`,
        )
        .run(pageId, currentRevision, pageId, currentRevision, keep).changes,
    );
  }
  catalogData(): string[] {
    return this.db
      .prepare('SELECT data FROM catalog')
      .all()
      .map((row) => String(row.data));
  }
  insertCatalog(id: string, data: string) {
    this.db.prepare('INSERT INTO catalog VALUES (?, ?)').run(id, data);
  }
}

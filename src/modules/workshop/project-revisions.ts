import type { DatabaseSync } from 'node:sqlite';
import { WorkshopError, type WorkshopProject } from './projects.ts';
import { revisionSchema, PAGE_FILE } from './page-projects.ts';

export type ProjectRevisionMetadata = { revision: number; bytes: number; createdAt: string };
export type ProjectRevision = { revision: number; content: string; createdAt: string };

/** Page snapshots only; callers record inside the same transaction as the project mutation. */
export class ProjectRevisions {
  constructor(
    private readonly db: DatabaseSync,
    private readonly authorize: (owner: string, id: string) => WorkshopProject,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS mw_workshop_project_revisions (
      owner TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 0),
      content TEXT NOT NULL CHECK(length(content) <= 30000),
      bytes INTEGER NOT NULL CHECK(bytes >= 0), created_at TEXT NOT NULL,
      PRIMARY KEY(owner, project_id, revision)
    )`);
  }

  record(owner: string, id: string): void {
    const project = this.page(owner, id);
    const content = project.files[PAGE_FILE];
    this.db
      .prepare(
        `INSERT INTO mw_workshop_project_revisions
        (owner, project_id, revision, content, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        owner,
        id,
        project.revision!,
        content,
        Buffer.byteLength(content, 'utf8'),
        new Date().toISOString(),
      );
    // Always retain current, plus the newest 49 other snapshots for this owner/project.
    this.db
      .prepare(
        `DELETE FROM mw_workshop_project_revisions WHERE owner=? AND project_id=? AND revision!=?
        AND revision NOT IN (SELECT revision FROM mw_workshop_project_revisions
          WHERE owner=? AND project_id=? AND revision!=? ORDER BY revision DESC LIMIT 49)`,
      )
      .run(owner, id, project.revision!, owner, id, project.revision!);
  }

  list(owner: string, id: string): ProjectRevisionMetadata[] {
    this.page(owner, id);
    return this.db
      .prepare(
        `SELECT revision, bytes, created_at FROM mw_workshop_project_revisions
        WHERE owner=? AND project_id=? ORDER BY revision DESC`,
      )
      .all(owner, id)
      .map((row) => ({
        revision: Number(row.revision),
        bytes: Number(row.bytes),
        createdAt: String(row.created_at),
      }));
  }

  getRevision(owner: string, id: string, revision: number): ProjectRevision {
    this.page(owner, id);
    if (!revisionSchema.safeParse(revision).success)
      throw new WorkshopError('Invalid workshop input', 400);
    const row = this.db
      .prepare(
        `SELECT revision, content, created_at FROM mw_workshop_project_revisions
        WHERE owner=? AND project_id=? AND revision=?`,
      )
      .get(owner, id, revision);
    if (!row) throw new WorkshopError('Workshop project revision not found', 404);
    return {
      revision: Number(row.revision),
      content: String(row.content),
      createdAt: String(row.created_at),
    };
  }

  private page(owner: string, id: string): WorkshopProject {
    const project = this.authorize(owner, id);
    if (project.kind !== 'page') throw new WorkshopError('Invalid workshop input', 400);
    return project;
  }
}

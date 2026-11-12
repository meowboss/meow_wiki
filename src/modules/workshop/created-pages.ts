import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  compositionDocumentSchema,
  type CompositionDocument,
} from '../../../packages/canvas-contract/index.ts';

export class CreatedPageError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CreatedPageError';
  }
}

export type CreatedPage = {
  id: string;
  owner: string;
  workspaceId: string;
  title: string;
  composition: CompositionDocument;
  revision: number;
  createdAt: string;
  updatedAt: string;
  sourceProject: string | null;
  sourceProjectRevision: number | null;
};
export type CreatedPageMetadata = Omit<CreatedPage, 'composition'>;

const id = z.string().min(1).max(200);
const title = z.string().trim().min(1).max(160);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Durable, owner/workspace-scoped page snapshots. This store never writes a canvas surface. */
export class WorkshopCreatedPages {
  constructor(
    private readonly db: DatabaseSync,
    private readonly authorize: (owner: string, workspaceId: string) => void,
    private readonly validateRefs: (
      owner: string,
      workspaceId: string,
      composition: CompositionDocument,
    ) => void,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS mw_workshop_pages (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
      composition_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_project TEXT,
      source_project_revision INTEGER,
      UNIQUE(owner, source_project, source_project_revision)
    );
    CREATE INDEX IF NOT EXISTS mw_workshop_pages_owner_workspace
      ON mw_workshop_pages(owner, workspace_id);`);
  }

  create(
    owner: string,
    workspaceId: string,
    input: {
      title: string;
      composition: unknown;
      sourceProject?: string;
      sourceProjectRevision?: number;
    },
  ): CreatedPage {
    this.ids(owner, workspaceId);
    const parsedTitle = title.safeParse(input?.title);
    const parsedComposition = compositionDocumentSchema.safeParse(input?.composition);
    const parsedSource =
      input?.sourceProject === undefined ? undefined : id.safeParse(input.sourceProject);
    const parsedSourceRevision =
      input?.sourceProjectRevision === undefined
        ? undefined
        : revision.safeParse(input.sourceProjectRevision);
    if (
      !parsedTitle.success ||
      !parsedComposition.success ||
      (!parsedSource?.success && input?.sourceProject !== undefined) ||
      (!parsedSourceRevision?.success && input?.sourceProjectRevision !== undefined)
    )
      throw new CreatedPageError('Invalid created page input', 400);
    if ((input.sourceProject === undefined) !== (input.sourceProjectRevision === undefined))
      throw new CreatedPageError('Source project and revision must be supplied together', 400);
    const doc = parsedComposition.data;
    this.authorize(owner, workspaceId);
    this.validateRefs(owner, workspaceId, doc);
    return this.transaction(() => {
      const count = this.db
        .prepare('SELECT count(*) AS n FROM mw_workshop_pages WHERE owner=?')
        .get(owner);
      if (Number(count?.n) >= 50) throw new CreatedPageError('Created page quota reached', 409);
      const now = new Date().toISOString();
      const pageId = randomUUID();
      try {
        this.db
          .prepare(
            `INSERT INTO mw_workshop_pages
          (id, owner, workspace_id, title, composition_json, revision, created_at, updated_at, source_project, source_project_revision)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          )
          .run(
            pageId,
            owner,
            workspaceId,
            parsedTitle.data,
            JSON.stringify(doc),
            now,
            now,
            input.sourceProject ?? null,
            input.sourceProjectRevision ?? null,
          );
      } catch (error) {
        if (String(error).includes('UNIQUE constraint failed'))
          throw new CreatedPageError('Page already created for this project revision', 409);
        throw error;
      }
      return this.get(owner, workspaceId, pageId);
    });
  }

  list(owner: string, workspaceId: string): CreatedPageMetadata[] {
    this.ids(owner, workspaceId);
    this.authorize(owner, workspaceId);
    return this.db
      .prepare(
        `SELECT id, owner, workspace_id, title, revision, created_at, updated_at,
      source_project, source_project_revision FROM mw_workshop_pages
      WHERE owner=? AND workspace_id=? ORDER BY rowid`,
      )
      .all(owner, workspaceId)
      .map((row) => this.metadata(row));
  }

  get(owner: string, workspaceId: string, pageId: string): CreatedPage {
    this.ids(owner, workspaceId, pageId);
    this.authorize(owner, workspaceId);
    const row = this.db
      .prepare('SELECT * FROM mw_workshop_pages WHERE owner=? AND workspace_id=? AND id=?')
      .get(owner, workspaceId, pageId);
    if (!row) throw new CreatedPageError('Created page not found', 404);
    return this.page(row);
  }

  private page(row: Record<string, unknown>): CreatedPage {
    return {
      ...this.metadata(row),
      composition: compositionDocumentSchema.parse(JSON.parse(String(row.composition_json))),
    };
  }
  private metadata(row: Record<string, unknown>): CreatedPageMetadata {
    return {
      id: String(row.id),
      owner: String(row.owner),
      workspaceId: String(row.workspace_id),
      title: String(row.title),
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      sourceProject: row.source_project == null ? null : String(row.source_project),
      sourceProjectRevision:
        row.source_project_revision == null ? null : Number(row.source_project_revision),
    };
  }
  private ids(...values: string[]) {
    if (values.some((value) => !id.safeParse(value).success))
      throw new CreatedPageError('Invalid created page identifier', 400);
  }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      if (error instanceof CreatedPageError) throw error;
      throw new CreatedPageError('Created page storage operation failed', 500);
    }
  }
}

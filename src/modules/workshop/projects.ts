import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CompositionError, CompositionService } from '../compositions/service.ts';
import type { CanvasSurface } from '../../../packages/canvas-contract/index.ts';
import {
  PAGE_FILE,
  componentPath,
  projectInput,
  pageInput,
  revisionSchema,
  projectFromRow,
  parsePage,
  validation,
  pageContent,
} from './page-projects.ts';
import { ComponentError, ComponentService, type ComponentDraft } from '../../components.ts';

export type WorkshopState = 'draft' | 'running' | 'ready' | 'failed';
export type WorkshopProject = {
  id: string;
  workspaceId: string;
  name: string;
  instruction: string;
  files: Record<string, string>;
  state: WorkshopState;
  error: string | null;
  iterations: number;
  kind?: 'page';
  sourceSurface?: CanvasSurface;
  sourceRevision?: number;
  revision?: number;
};
export type WorkshopValidation = { valid: true } | { valid: false; issues: string[] };
export class WorkshopError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'WorkshopError';
  }
}

const identifier = z.string().min(1).max(200);
const runInput = z
  .object({
    state: z.enum(['draft', 'running', 'ready', 'failed']),
    iterations: z.number().int().min(0).max(8),
    error: z.string().max(2000).nullable(),
  })
  .strict();
const invalid = () => new WorkshopError('Invalid workshop input', 400);
const missing = () => new WorkshopError('Workshop project or workspace not found', 404);
const conflict = () => new WorkshopError('Workshop project state conflict or limit reached', 409);

/** Owner-scoped declaration storage only: never resolves virtual paths on the host. */
export class WorkshopProjects {
  constructor(
    private readonly db: DatabaseSync,
    private readonly components: ComponentService,
    private readonly compositions?: CompositionService,
  ) {
    this.database(() =>
      db.exec(`
      CREATE TABLE IF NOT EXISTS mw_workshop_projects (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, workspace_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
        instruction TEXT NOT NULL CHECK(length(instruction) BETWEEN 1 AND 3000),
        content TEXT NOT NULL DEFAULT '' CHECK(length(content) <= 30000),
        state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','running','ready','failed')),
        error TEXT CHECK(error IS NULL OR length(error) <= 2000),
        iterations INTEGER NOT NULL DEFAULT 0 CHECK(iterations BETWEEN 0 AND 8)
      );
      CREATE INDEX IF NOT EXISTS mw_workshop_projects_owner ON mw_workshop_projects(owner, workspace_id);
    `),
    );
    this.database(() => {
      const columns = new Set(
        this.db
          .prepare('PRAGMA table_info(mw_workshop_projects)')
          .all()
          .map((row) => row.name),
      );
      for (const [name, definition] of Object.entries({
        kind: "TEXT NOT NULL DEFAULT 'component'",
        source_surface: 'TEXT',
        source_revision: 'INTEGER',
        revision: 'INTEGER NOT NULL DEFAULT 0',
      }))
        if (!columns.has(name))
          this.db.exec(`ALTER TABLE mw_workshop_projects ADD COLUMN ${name} ${definition}`);
    });
  }

  recoverInterruptedRuns(): number {
    return Number(
      this.db
        .prepare(
          "UPDATE mw_workshop_projects SET state='failed',error='服务重启中断了运行；请检查产物后重新运行' WHERE state='running'",
        )
        .run().changes,
    );
  }

  create(owner: string, workspaceId: string, input: unknown): WorkshopProject {
    this.ids(owner, workspaceId);
    const parsed = projectInput.safeParse(input);
    if (!parsed.success) throw invalid();
    return this.transaction(() => this.createInTransaction(owner, workspaceId, parsed.data));
  }

  private createInTransaction(
    owner: string,
    workspaceId: string,
    input: z.infer<typeof projectInput>,
  ): WorkshopProject {
    this.ownedWorkspace(owner, workspaceId);
    const count = this.db
      .prepare('SELECT count(*) AS n FROM mw_workshop_projects WHERE owner = ?')
      .get(owner)!;
    if (Number(count.n) >= 20) throw conflict();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO mw_workshop_projects
        (id, owner, workspace_id, name, instruction) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, owner, workspaceId, input.name, input.instruction);
    return this.get(owner, id);
  }

  createPage(owner: string, workspaceId: string, input: unknown): WorkshopProject {
    this.ids(owner, workspaceId);
    const parsed = pageInput.safeParse(input);
    if (!parsed.success || !this.compositions) throw invalid();
    const service = this.compositions;
    return this.transaction(() => {
      const project = this.createInTransaction(owner, workspaceId, parsed.data);
      const current = service.get(owner, workspaceId, parsed.data.surface);
      const content = pageContent(parsed.data.name, current, parsed.data.fromCurrent);
      this.db
        .prepare(
          `UPDATE mw_workshop_projects SET kind='page', content=?, source_surface=?,
        source_revision=? WHERE owner=? AND id=?`,
        )
        .run(content, parsed.data.surface, current.revision, owner, project.id);
      return this.get(owner, project.id);
    });
  }

  apply(owner: string, id: string, expectedProjectRevision: number): WorkshopProject {
    if (!revisionSchema.safeParse(expectedProjectRevision).success || !this.compositions)
      throw invalid();
    const service = this.compositions;
    return this.transaction(() => {
      const project = this.get(owner, id);
      if (project.kind !== 'page') throw invalid();
      if (
        project.state === 'running' ||
        project.revision !== expectedProjectRevision ||
        project.revision === Number.MAX_SAFE_INTEGER
      )
        throw conflict();
      const declaration = parsePage(project.files[PAGE_FILE]);
      const saved = service.update(owner, project.workspaceId, project.sourceSurface!, {
        expectedRevision: project.sourceRevision,
        composition: declaration.composition,
      });
      const changed = this.db
        .prepare(
          `UPDATE mw_workshop_projects SET source_revision=?, revision=revision+1
        WHERE owner=? AND id=? AND revision=? AND state!='running'`,
        )
        .run(saved.revision, owner, id, expectedProjectRevision);
      if (Number(changed.changes) !== 1) throw conflict();
      return this.get(owner, id);
    });
  }

  list(owner: string, workspaceId: string): WorkshopProject[] {
    this.ids(owner, workspaceId);
    return this.database(() => {
      this.ownedWorkspace(owner, workspaceId);
      return this.db
        .prepare(
          'SELECT * FROM mw_workshop_projects WHERE owner = ? AND workspace_id = ? ORDER BY rowid',
        )
        .all(owner, workspaceId)
        .map((row) => projectFromRow(row));
    });
  }

  get(owner: string, id: string): WorkshopProject {
    this.ids(owner, id);
    return this.database(() => {
      const row = this.db
        .prepare(
          `SELECT p.* FROM mw_workshop_projects p
        JOIN workspaces w ON w.id = p.workspace_id AND w.owner = p.owner
        WHERE p.owner = ? AND p.id = ?`,
        )
        .get(owner, id);
      if (!row) throw missing();
      return projectFromRow(row);
    });
  }

  readFile(owner: string, id: string, path: string): string {
    const project = this.get(owner, id);
    if (typeof path !== 'string' || !Object.hasOwn(project.files, path)) throw invalid();
    return project.files[path];
  }

  /** engine=true is only for the trusted, serialized engine; never expose it as HTTP input. */
  writeFile(
    owner: string,
    id: string,
    path: string,
    content: string,
    engine = false,
    expectedRevision?: number,
  ): WorkshopProject {
    const project = this.get(owner, id);
    if (
      path !== (project.kind === 'page' ? PAGE_FILE : componentPath) ||
      typeof content !== 'string' ||
      content.length > 30000 ||
      typeof engine !== 'boolean'
    )
      throw invalid();
    if (project.state === 'running' && !engine) throw conflict();
    const expected = engine ? project.revision : expectedRevision;
    if (expected !== undefined && !revisionSchema.safeParse(expected).success) throw invalid();
    if (project.kind === 'page' && expected === undefined) throw invalid();
    if (
      project.kind === 'page' &&
      (expected !== project.revision || expected === Number.MAX_SAFE_INTEGER)
    )
      throw conflict();
    return this.database(() => {
      const result = this.db
        .prepare(
          `UPDATE mw_workshop_projects SET content = ?, revision=revision+1,
        state = CASE WHEN state = 'running' THEN state ELSE 'draft' END, error = NULL
        WHERE owner = ? AND id = ? AND (? IS NULL OR revision = ?)`,
        )
        .run(content, owner, id, expected ?? null, expected ?? null);
      if (Number(result.changes) !== 1) throw conflict();
      return this.get(owner, id);
    });
  }

  validate(owner: string, id: string): WorkshopValidation {
    const project = this.get(owner, id);
    return validation(
      project.files[project.kind === 'page' ? PAGE_FILE : componentPath],
      project.kind === 'page',
    );
  }

  install(owner: string, id: string): ComponentDraft {
    const project = this.get(owner, id);
    if (project.kind === 'page') throw invalid();
    if (project.state === 'running') throw conflict();
    const content = project.files[componentPath];
    if (!validation(content).valid) throw new WorkshopError('Invalid component declaration', 400);
    // ComponentService performs its own ownership check and creates a distinct private draft.
    return this.components.create(owner, project.workspaceId, JSON.parse(content));
  }

  /** Atomic project lock shared by engines using this database, acquired before any history writes. */
  claimRun(owner: string, id: string): void {
    this.get(owner, id);
    const result = this.db
      .prepare(
        "UPDATE mw_workshop_projects SET state = 'running', iterations = 0, error = NULL WHERE owner = ? AND id = ? AND state != 'running'",
      )
      .run(owner, id);
    if (Number(result.changes) !== 1) throw conflict();
  }

  setRunState(
    owner: string,
    id: string,
    state: WorkshopState,
    iterations: number,
    error: string | null = null,
  ): WorkshopProject {
    this.get(owner, id);
    if (!runInput.safeParse({ state, iterations, error }).success) throw invalid();
    return this.database(() => {
      this.db
        .prepare(
          'UPDATE mw_workshop_projects SET state = ?, iterations = ?, error = ? WHERE owner = ? AND id = ?',
        )
        .run(state, iterations, error, owner, id);
      return this.get(owner, id);
    });
  }

  private ids(...values: string[]): void {
    if (values.some((value) => !identifier.safeParse(value).success)) throw invalid();
  }

  private ownedWorkspace(owner: string, workspaceId: string): void {
    if (
      !this.db
        .prepare('SELECT 1 FROM workspaces WHERE id = ? AND owner = ?')
        .get(workspaceId, owner)
    )
      throw missing();
  }

  private database<T>(action: () => T): T {
    try {
      return action();
    } catch (error) {
      if (
        error instanceof WorkshopError ||
        error instanceof ComponentError ||
        error instanceof CompositionError
      )
        throw error;
      throw new WorkshopError('Workshop storage operation failed', 500);
    }
  }

  private transaction<T>(action: () => T): T {
    return this.database(() => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = action();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
  }
}

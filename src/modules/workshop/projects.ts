import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  ComponentError,
  ComponentService,
  componentSchema,
  type ComponentDraft,
} from '../../components.ts';

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
const projectInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    instruction: z.string().min(1).max(3000),
  })
  .strict();
const runInput = z
  .object({
    state: z.enum(['draft', 'running', 'ready', 'failed']),
    iterations: z.number().int().min(0).max(8),
    error: z.string().max(2000).nullable(),
  })
  .strict();
const componentPath = '/project/component.json';
const sdkFiles: Readonly<Record<string, string>> = Object.freeze({
  '/sdk/README.md': `# Declarative component SDK
This is a database-backed virtual filesystem, not an OS filesystem or code sandbox.
Only /sdk/README.md, /sdk/component.schema.json and /project/component.json can be read.
Only /project/component.json can be written (at most 30000 characters).
All paths must match exactly. No directories, aliases, traversal, shell, npm, host files,
network access or executable code are supported. Never put provider keys or secrets in files.

Write a JSON object matching /sdk/component.schema.json:
- name: nonempty string, at most 160 characters.
- description: string, at most 500 characters.
- template: inert plain text/Markdown string, at most 10000 characters.
- blocks: optional array of at most 20 blocks. Each block is exactly one of:
  {"type":"markdown","text":"Markdown text (at most 10000 characters)"}
  {"type":"page-list","title":"Title (at most 160 characters)"}
  {"type":"search","title":"Title (at most 160 characters)"}
The markdown block uses text, not title. page-list and search use title, not text.
Unknown fields, scripts, imports and custom executable blocks are rejected.
Validate the JSON before importing it. Import creates a new private component in the
project's workspace, never overwrites an existing component and never publishes to market.
`,
  '/sdk/component.schema.json': JSON.stringify(z.toJSONSchema(componentSchema), null, 2),
});
const invalid = () => new WorkshopError('Invalid workshop input', 400);
const missing = () => new WorkshopError('Workshop project or workspace not found', 404);
const conflict = () => new WorkshopError('Workshop project state conflict or limit reached', 409);

/** Owner-scoped declaration storage only: never resolves virtual paths on the host. */
export class WorkshopProjects {
  constructor(
    private readonly db: DatabaseSync,
    private readonly components: ComponentService,
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
    return this.transaction(() => {
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
        .run(id, owner, workspaceId, parsed.data.name, parsed.data.instruction);
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
        .map((row) => this.project(row));
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
      return this.project(row);
    });
  }

  readFile(owner: string, id: string, path: string): string {
    const project = this.get(owner, id);
    if (typeof path !== 'string' || (path !== componentPath && !Object.hasOwn(sdkFiles, path)))
      throw invalid();
    return project.files[path];
  }

  /** engine=true is only for the trusted, serialized engine; never expose it as HTTP input. */
  writeFile(
    owner: string,
    id: string,
    path: string,
    content: string,
    engine = false,
  ): WorkshopProject {
    const project = this.get(owner, id);
    if (
      path !== componentPath ||
      typeof content !== 'string' ||
      content.length > 30000 ||
      typeof engine !== 'boolean'
    )
      throw invalid();
    if (project.state === 'running' && !engine) throw conflict();
    return this.database(() => {
      this.db
        .prepare(
          `UPDATE mw_workshop_projects SET content = ?,
        state = CASE WHEN state = 'running' THEN state ELSE 'draft' END, error = NULL
        WHERE owner = ? AND id = ?`,
        )
        .run(content, owner, id);
      return this.get(owner, id);
    });
  }

  validate(owner: string, id: string): WorkshopValidation {
    return this.validation(this.get(owner, id).files[componentPath]);
  }

  install(owner: string, id: string): ComponentDraft {
    const project = this.get(owner, id);
    if (project.state === 'running') throw conflict();
    const content = project.files[componentPath];
    if (!this.validation(content).valid)
      throw new WorkshopError('Invalid component declaration', 400);
    // ComponentService performs its own ownership check and creates a distinct private draft.
    return this.components.create(owner, project.workspaceId, JSON.parse(content));
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

  private validation(content: string): WorkshopValidation {
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      return { valid: false, issues: ['Invalid JSON component declaration'] };
    }
    const result = componentSchema.safeParse(value);
    if (result.success) return { valid: true };
    return {
      valid: false,
      issues: result.error.issues.map(
        (issue) => `${issue.path.map(String).join('.') || 'component'}: ${issue.code}`,
      ),
    };
  }

  private project(row: Record<string, unknown>): WorkshopProject {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      instruction: String(row.instruction),
      files: { ...sdkFiles, [componentPath]: String(row.content) },
      state: row.state as WorkshopState,
      error: row.error === null ? null : String(row.error),
      iterations: Number(row.iterations),
    };
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
      if (error instanceof WorkshopError || error instanceof ComponentError) throw error;
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

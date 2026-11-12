import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { WorkshopError, type WorkshopProjects } from './projects.ts';

export const conversationDetailsSchema = z
  .object({
    path: z
      .enum([
        '/sdk/README.md',
        '/sdk/component.schema.json',
        '/project/component.json',
        '/sdk/page.schema.json',
        '/project/page.json',
      ])
      .optional(),
    bytes: z.number().int().min(0).max(128000).optional(),
    lines: z.number().int().min(0).max(30001).optional(),
    valid: z.boolean().optional(),
    issues: z.array(z.string().max(160)).max(8).optional(),
    durationMs: z.number().int().min(0).max(300000).optional(),
    summary: z.string().max(300).optional(),
  })
  .strict();
export type ConversationDetails = z.infer<typeof conversationDetailsSchema>;

function storedDetails(value: unknown): ConversationDetails | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = conversationDetailsSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export type ConversationMessage = {
  id: string;
  projectId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  status?: string;
  createdAt: string;
  sequence: number;
  runId?: string;
  callId?: string;
  turn?: number;
  details?: ConversationDetails;
};
const input = z
  .object({
    role: z.enum(['user', 'assistant', 'tool', 'system']),
    content: z.string().max(3000),
    status: z.enum(['started', 'completed', 'failed', 'question', 'error', 'cancelled']).optional(),
    runId: z.string().uuid().optional(),
    callId: z.string().uuid().optional(),
    turn: z.number().int().min(0).max(8).optional(),
    details: conversationDetailsSchema.optional(),
  })
  .strict();
const tools = new Set([
  'read_file',
  'write_file',
  'validate_component',
  'validate_project',
  'ask_user',
  'finish',
]);

/** Durable, owner-scoped bounded history. Tool content is an allowlisted name, never raw I/O. */
export class ConversationStore {
  constructor(
    private db: DatabaseSync,
    private projects: WorkshopProjects,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS mw_workshop_messages (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, status TEXT, created_at TEXT NOT NULL, sequence INTEGER NOT NULL,
      UNIQUE(project_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS mw_workshop_messages_project ON mw_workshop_messages(project_id, sequence);`);
    const columns = new Set(
      db
        .prepare('PRAGMA table_info(mw_workshop_messages)')
        .all()
        .map((row) => String(row.name)),
    );
    for (const [name, type] of [
      ['run_id', 'TEXT'],
      ['call_id', 'TEXT'],
      ['turn', 'INTEGER'],
      ['details_json', 'TEXT'],
    ] as const)
      if (!columns.has(name))
        db.exec(`ALTER TABLE mw_workshop_messages ADD COLUMN ${name} ${type}`);
  }

  list(owner: string, projectId: string): ConversationMessage[] {
    this.projects.get(owner, projectId);
    return this.db
      .prepare('SELECT * FROM mw_workshop_messages WHERE project_id = ? ORDER BY sequence')
      .all(projectId)
      .map((row) => {
        const details =
          row.role === 'tool' && tools.has(String(row.content))
            ? storedDetails(row.details_json)
            : undefined;
        return {
          id: String(row.id),
          projectId: String(row.project_id),
          role: row.role as ConversationMessage['role'],
          content: String(row.content),
          ...(row.status === null ? {} : { status: String(row.status) }),
          createdAt: String(row.created_at),
          sequence: Number(row.sequence),
          ...(row.run_id ? { runId: String(row.run_id) } : {}),
          ...(row.call_id ? { callId: String(row.call_id) } : {}),
          ...(row.turn !== null ? { turn: Number(row.turn) } : {}),
          ...(details === undefined ? {} : { details }),
        };
      });
  }

  append(
    owner: string,
    projectId: string,
    value: Pick<
      ConversationMessage,
      'role' | 'content' | 'status' | 'runId' | 'callId' | 'turn' | 'details'
    >,
  ): ConversationMessage {
    this.projects.get(owner, projectId);
    const parsed = input.safeParse(value);
    if (
      !parsed.success ||
      (value.role === 'tool' && !tools.has(value.content)) ||
      (value.details !== undefined && value.role !== 'tool')
    )
      throw new WorkshopError('Invalid conversation message', 400);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const last = this.db
        .prepare('SELECT max(sequence) AS n FROM mw_workshop_messages WHERE project_id = ?')
        .get(projectId)!;
      const message: ConversationMessage = {
        ...parsed.data,
        id: randomUUID(),
        projectId,
        createdAt: new Date().toISOString(),
        sequence: Number(last.n ?? 0) + 1,
      };
      this.db
        .prepare(
          'INSERT INTO mw_workshop_messages (id, project_id, role, content, status, created_at, sequence,run_id,call_id,turn,details_json) VALUES (?, ?, ?, ?, ?, ?, ?,?,?,?,?)',
        )
        .run(
          message.id,
          projectId,
          message.role,
          message.content,
          message.status ?? null,
          message.createdAt,
          message.sequence,
          message.runId ?? null,
          message.callId ?? null,
          message.turn ?? null,
          message.details === undefined ? null : JSON.stringify(message.details),
        );
      const rows = this.list(owner, projectId);
      let bytes = rows.reduce(
        (sum, row) => sum + Buffer.byteLength(JSON.stringify(row), 'utf8'),
        0,
      );
      while (rows.length > 200 || bytes > 256000) {
        const oldest = rows.shift()!;
        bytes -= Buffer.byteLength(JSON.stringify(oldest), 'utf8');
        this.db.prepare('DELETE FROM mw_workshop_messages WHERE id = ?').run(oldest.id);
      }
      this.db.exec('COMMIT');
      return message;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

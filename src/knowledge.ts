import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type KnowledgeStatus = 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
export type KnowledgeSource = {
  id: string;
  workspaceId: string;
  title: string;
  revision: number;
  status: KnowledgeStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type KnowledgeDetail = KnowledgeSource & { content: string };
export type KnowledgeJob = {
  id: string;
  workspaceId: string;
  sourceId: string;
  revision: number;
  attempt: number;
  status: KnowledgeStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type KnowledgeInput = { title: string; content: string };
export type KnowledgeHit = {
  sourceId: string;
  revision: number;
  chunkId: string;
  title: string;
  excerpt: string;
};
export class KnowledgeError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'KnowledgeError';
  }
}

const MAX_OWNER_SOURCES = 200;
const MAX_OWNER_REVISION_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_REVISIONS = 100;
const MAX_SEARCH_CANDIDATES = 100;

type Row = Record<string, unknown>;
const sourceFrom = (r: Row): KnowledgeSource => ({
  id: String(r.id),
  workspaceId: String(r.workspace_id),
  title: String(r.title),
  revision: Number(r.revision),
  status: r.status as KnowledgeStatus,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  deletedAt: r.deleted_at == null ? null : String(r.deleted_at),
});
const jobFrom = (r: Row): KnowledgeJob => ({
  id: String(r.id),
  workspaceId: String(r.workspace_id),
  sourceId: String(r.source_id),
  revision: Number(r.revision),
  attempt: Number(r.attempt),
  status: r.status as KnowledgeStatus,
  error: r.error == null ? null : String(r.error),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

/** Local, synchronous text indexing. Owns its tables, not the injected database. No AI/network calls. */
export class KnowledgeService {
  constructor(private readonly db: DatabaseSync) {
    // SQLite's built-in lower() is ASCII-only; keep the original JS Unicode matching semantics.
    db.function('knowledge_lower', { deterministic: true }, (value) => String(value).toLowerCase());
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_sources (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        title TEXT NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','ready','failed','cancelled')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
        UNIQUE(workspace_id,id)
      );
      CREATE INDEX IF NOT EXISTS knowledge_sources_workspace ON knowledge_sources(workspace_id,deleted_at,status);
      CREATE TABLE IF NOT EXISTS knowledge_revisions (
        workspace_id TEXT NOT NULL, source_id TEXT NOT NULL, revision INTEGER NOT NULL,
        title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id,source_id,revision),
        FOREIGN KEY(workspace_id,source_id) REFERENCES knowledge_sources(workspace_id,id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source_id TEXT NOT NULL,
        revision INTEGER NOT NULL, ordinal INTEGER NOT NULL, content TEXT NOT NULL,
        UNIQUE(workspace_id,source_id,revision,ordinal),
        FOREIGN KEY(workspace_id,source_id,revision) REFERENCES knowledge_revisions(workspace_id,source_id,revision)
      );
      CREATE INDEX IF NOT EXISTS knowledge_chunks_workspace_revision ON knowledge_chunks(workspace_id,source_id,revision);
      CREATE TABLE IF NOT EXISTS knowledge_jobs (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source_id TEXT NOT NULL,
        revision INTEGER NOT NULL, attempt INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','ready','failed','cancelled')),
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(workspace_id,source_id,revision,attempt),
        FOREIGN KEY(workspace_id,source_id,revision) REFERENCES knowledge_revisions(workspace_id,source_id,revision)
      );
      CREATE INDEX IF NOT EXISTS knowledge_jobs_workspace ON knowledge_jobs(workspace_id,source_id,revision,attempt);
    `);
  }

  private scope(owner: string, workspaceId: string) {
    if (
      typeof owner !== 'string' ||
      typeof workspaceId !== 'string' ||
      !this.db.prepare('SELECT 1 FROM workspaces WHERE id=? AND owner=?').get(workspaceId, owner)
    ) {
      throw new KnowledgeError('未找到此空间', 404);
    }
  }
  private source(workspaceId: string, id: string): Row {
    if (typeof id !== 'string') throw new KnowledgeError('未找到知识源', 404);
    const row = this.db
      .prepare(
        'SELECT * FROM knowledge_sources WHERE workspace_id=? AND id=? AND deleted_at IS NULL',
      )
      .get(workspaceId, id);
    if (!row) throw new KnowledgeError('未找到知识源', 404);
    return row;
  }
  private validate(input: KnowledgeInput) {
    if (
      !input ||
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 200 ||
      typeof input.content !== 'string' ||
      !input.content.trim() ||
      input.content.length > 200_000
    ) {
      throw new KnowledgeError('标题须为1–200字符，Markdown或文本内容须为1–200000字符', 400);
    }
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /** Called inside the write transaction. Tombstones/history still consume quota: deletion cannot reset it. */
  private quota(owner: string, input: KnowledgeInput, sourceId?: string) {
    if (sourceId === undefined) {
      const usage = this.db
        .prepare(
          `SELECT count(*) AS n FROM knowledge_sources s
        JOIN workspaces w ON w.id=s.workspace_id WHERE w.owner=?`,
        )
        .get(owner)!;
      if (Number(usage.n) >= MAX_OWNER_SOURCES)
        throw new KnowledgeError('每位用户最多保留200个知识源（含已删除）', 409);
    } else {
      const usage = this.db
        .prepare('SELECT count(*) AS n FROM knowledge_revisions WHERE source_id=?')
        .get(sourceId)!;
      if (Number(usage.n) >= MAX_SOURCE_REVISIONS)
        throw new KnowledgeError('每个知识源最多保留100个版本', 409);
    }
    const usage = this.db
      .prepare(
        `SELECT coalesce(sum(length(CAST(r.title AS BLOB)) + length(CAST(r.content AS BLOB))),0) AS bytes
      FROM knowledge_revisions r JOIN workspaces w ON w.id=r.workspace_id WHERE w.owner=?`,
      )
      .get(owner)!;
    const added =
      Buffer.byteLength(input.title.trim(), 'utf8') + Buffer.byteLength(input.content, 'utf8');
    if (Number(usage.bytes) + added > MAX_OWNER_REVISION_BYTES) {
      throw new KnowledgeError('每位用户知识源历史总量最多20MiB（含已删除）', 409);
    }
  }
  private queue(workspaceId: string, row: Row): KnowledgeJob {
    const last = this.db
      .prepare(
        `SELECT * FROM knowledge_jobs WHERE workspace_id=? AND source_id=? AND revision=? ORDER BY attempt DESC LIMIT 1`,
      )
      .get(workspaceId, String(row.id), Number(row.revision));
    if (last && ['queued', 'running', 'ready'].includes(String(last.status))) return jobFrom(last);
    const now = new Date().toISOString();
    const job: KnowledgeJob = {
      id: randomUUID(),
      workspaceId,
      sourceId: String(row.id),
      revision: Number(row.revision),
      attempt: last ? Number(last.attempt) + 1 : 1,
      status: 'queued',
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO knowledge_jobs (id,workspace_id,source_id,revision,attempt,status,error,created_at,updated_at)
      VALUES (?,?,?,?,?,'queued',NULL,?,?)`,
      )
      .run(job.id, workspaceId, job.sourceId, job.revision, job.attempt, now, now);
    this.db
      .prepare(
        "UPDATE knowledge_sources SET status='queued',updated_at=? WHERE workspace_id=? AND id=? AND deleted_at IS NULL",
      )
      .run(now, workspaceId, job.sourceId);
    return job;
  }
  private invalidate(workspaceId: string, id: string, now: string) {
    this.db
      .prepare('DELETE FROM knowledge_chunks WHERE workspace_id=? AND source_id=?')
      .run(workspaceId, id);
    this.db
      .prepare(
        "UPDATE knowledge_jobs SET status='cancelled',updated_at=? WHERE workspace_id=? AND source_id=? AND status!='cancelled'",
      )
      .run(now, workspaceId, id);
  }

  create(owner: string, workspaceId: string, input: KnowledgeInput): KnowledgeSource {
    return this.transaction(() => {
      this.scope(owner, workspaceId);
      this.validate(input);
      this.quota(owner, input);
      const id = randomUUID(),
        now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO knowledge_sources (id,workspace_id,title,content,revision,status,created_at,updated_at,deleted_at)
        VALUES (?,?,?,?,1,'queued',?,?,NULL)`,
        )
        .run(id, workspaceId, input.title.trim(), input.content, now, now);
      this.db
        .prepare('INSERT INTO knowledge_revisions VALUES (?,?,1,?,?,?)')
        .run(workspaceId, id, input.title.trim(), input.content, now);
      this.queue(workspaceId, this.source(workspaceId, id));
      return sourceFrom(this.source(workspaceId, id));
    });
  }
  list(owner: string, workspaceId: string): KnowledgeSource[] {
    this.scope(owner, workspaceId);
    return this.db
      .prepare(
        'SELECT id,workspace_id,title,revision,status,created_at,updated_at,deleted_at FROM knowledge_sources WHERE workspace_id=? AND deleted_at IS NULL ORDER BY rowid',
      )
      .all(workspaceId)
      .map(sourceFrom);
  }
  detail(owner: string, workspaceId: string, id: string): KnowledgeDetail {
    this.scope(owner, workspaceId);
    const row = this.source(workspaceId, id);
    return { ...sourceFrom(row), content: String(row.content) };
  }
  update(
    owner: string,
    workspaceId: string,
    id: string,
    input: KnowledgeInput & { expectedRevision: number },
  ): KnowledgeSource {
    return this.transaction(() => {
      this.scope(owner, workspaceId);
      const row = this.source(workspaceId, id);
      this.validate(input);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
        throw new KnowledgeError('expectedRevision须为正整数', 400);
      if (Number(row.revision) !== input.expectedRevision)
        throw new KnowledgeError('知识源版本冲突，请重新加载', 409);
      this.quota(owner, input, id);
      const now = new Date().toISOString(),
        revision = input.expectedRevision + 1;
      const result = this.db
        .prepare(
          `UPDATE knowledge_sources SET title=?,content=?,revision=?,status='queued',updated_at=?
        WHERE workspace_id=? AND id=? AND revision=? AND deleted_at IS NULL`,
        )
        .run(
          input.title.trim(),
          input.content,
          revision,
          now,
          workspaceId,
          id,
          input.expectedRevision,
        );
      if (result.changes !== 1) throw new KnowledgeError('知识源版本冲突，请重新加载', 409);
      this.invalidate(workspaceId, id, now);
      this.db
        .prepare('INSERT INTO knowledge_revisions VALUES (?,?,?,?,?,?)')
        .run(workspaceId, id, revision, input.title.trim(), input.content, now);
      this.queue(workspaceId, this.source(workspaceId, id));
      return sourceFrom(this.source(workspaceId, id));
    });
  }
  remove(owner: string, workspaceId: string, id: string): KnowledgeSource {
    return this.transaction(() => {
      this.scope(owner, workspaceId);
      const row = this.source(workspaceId, id),
        now = new Date().toISOString();
      this.invalidate(workspaceId, id, now);
      this.db
        .prepare(
          "UPDATE knowledge_sources SET deleted_at=?,updated_at=?,status='cancelled' WHERE workspace_id=? AND id=?",
        )
        .run(now, now, workspaceId, id);
      return { ...sourceFrom(row), status: 'cancelled', deletedAt: now, updatedAt: now };
    });
  }
  /** Idempotently queue the current revision. A failed attempt creates a new attempt. */
  prepare(owner: string, workspaceId: string, id: string): KnowledgeJob {
    return this.transaction(() => {
      this.scope(owner, workspaceId);
      return this.queue(workspaceId, this.source(workspaceId, id));
    });
  }
  /** Synchronously index current revision; repeating a successful run does not add jobs/chunks. */
  run(owner: string, workspaceId: string, id: string): KnowledgeSource {
    const job = this.prepare(owner, workspaceId, id);
    if (job.status === 'ready') return this.detailWithoutContent(owner, workspaceId, id);
    this.transaction(() => {
      this.scope(owner, workspaceId);
      const row = this.source(workspaceId, id);
      if (Number(row.revision) !== job.revision) throw new KnowledgeError('知识源版本冲突', 409);
      const now = new Date().toISOString();
      this.db
        .prepare(
          "UPDATE knowledge_jobs SET status='running',updated_at=? WHERE workspace_id=? AND id=?",
        )
        .run(now, workspaceId, job.id);
      this.db
        .prepare(
          "UPDATE knowledge_sources SET status='running',updated_at=? WHERE workspace_id=? AND id=?",
        )
        .run(now, workspaceId, id);
    });
    try {
      return this.transaction(() => {
        this.scope(owner, workspaceId);
        const row = this.source(workspaceId, id);
        if (Number(row.revision) !== job.revision) throw new KnowledgeError('知识源版本冲突', 409);
        this.db
          .prepare(
            'DELETE FROM knowledge_chunks WHERE workspace_id=? AND source_id=? AND revision=?',
          )
          .run(workspaceId, id, job.revision);
        // Code points avoid splitting surrogate pairs; 1000 characters with a 100-character overlap.
        const chars = Array.from(String(row.content));
        const insert = this.db.prepare(
          'INSERT INTO knowledge_chunks (id,workspace_id,source_id,revision,ordinal,content) VALUES (?,?,?,?,?,?)',
        );
        for (let start = 0, ordinal = 0; start < chars.length; start += 900, ordinal++) {
          insert.run(
            randomUUID(),
            workspaceId,
            id,
            job.revision,
            ordinal,
            chars.slice(start, start + 1000).join(''),
          );
          if (start + 1000 >= chars.length) break;
        }
        const now = new Date().toISOString();
        this.db
          .prepare(
            "UPDATE knowledge_jobs SET status='ready',error=NULL,updated_at=? WHERE workspace_id=? AND id=?",
          )
          .run(now, workspaceId, job.id);
        this.db
          .prepare(
            "UPDATE knowledge_sources SET status='ready',updated_at=? WHERE workspace_id=? AND id=? AND revision=? AND deleted_at IS NULL",
          )
          .run(now, workspaceId, id, job.revision);
        return sourceFrom(this.source(workspaceId, id));
      });
    } catch (error) {
      this.transaction(() => {
        const now = new Date().toISOString();
        this.db
          .prepare(
            "UPDATE knowledge_jobs SET status='failed',error=?,updated_at=? WHERE workspace_id=? AND id=? AND status='running'",
          )
          .run('知识源处理失败', now, workspaceId, job.id);
        this.db
          .prepare(
            "UPDATE knowledge_sources SET status='failed',updated_at=? WHERE workspace_id=? AND id=? AND revision=? AND deleted_at IS NULL AND status='running'",
          )
          .run(now, workspaceId, id, job.revision);
      });
      if (error instanceof KnowledgeError) throw error;
      throw new KnowledgeError('知识源处理失败，可重试', 500);
    }
  }
  private detailWithoutContent(owner: string, workspaceId: string, id: string): KnowledgeSource {
    this.scope(owner, workspaceId);
    return sourceFrom(this.source(workspaceId, id));
  }
  listJobs(owner: string, workspaceId: string): KnowledgeJob[] {
    this.scope(owner, workspaceId);
    return this.db
      .prepare('SELECT * FROM knowledge_jobs WHERE workspace_id=? ORDER BY rowid DESC')
      .all(workspaceId)
      .map(jobFrom);
  }
  /** Literal, case-insensitive local search; deterministic relevance ranking, never a generated answer. */
  search(owner: string, workspaceId: string, query: string): KnowledgeHit[] {
    this.scope(owner, workspaceId);
    if (typeof query !== 'string' || query.length > 1000)
      throw new KnowledgeError('检索词须为不超过1000字符的文本', 400);
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const pattern = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
    // Bound matching candidates in SQL, not after loading every chunk into JS. Ranking is within this stable page.
    const rows = this.db
      .prepare(
        `SELECT c.id,c.source_id,c.revision,c.ordinal,c.content,s.title FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.workspace_id=c.workspace_id AND s.id=c.source_id AND s.revision=c.revision
      WHERE c.workspace_id=? AND s.workspace_id=? AND s.status='ready' AND s.deleted_at IS NULL
        AND (knowledge_lower(c.content) LIKE ? ESCAPE '\\' OR knowledge_lower(s.title) LIKE ? ESCAPE '\\')
      ORDER BY c.source_id,c.ordinal LIMIT ?`,
      )
      .all(workspaceId, workspaceId, pattern, pattern, MAX_SEARCH_CANDIDATES);
    return rows
      .map((row) => {
        const content = String(row.content),
          lower = content.toLowerCase(),
          position = lower.indexOf(needle);
        const titleMatch = String(row.title).toLowerCase().includes(needle);
        const score = (titleMatch ? 5 : 0) + (position < 0 ? 0 : lower.split(needle).length - 1);
        const start = Math.max(0, position - 80);
        return {
          score,
          hit: {
            sourceId: String(row.source_id),
            revision: Number(row.revision),
            chunkId: String(row.id),
            title: String(row.title),
            excerpt: content.slice(start, start + 300),
          },
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.hit);
  }
}

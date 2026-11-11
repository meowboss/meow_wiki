import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { DomainError, type DomainsService } from '../domains/service.ts';

export class McpCredentialError extends Error {
  constructor(
    readonly statusCode: 400 | 401 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export type McpCredentialRecord = {
  id: string;
  domainId: string;
  label: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
};

const issueSchema = z
  .object({
    domainId: z.string().min(1),
    label: z.string().trim().min(1).max(200),
    expiresInDays: z.number().int().min(1).max(30),
  })
  .strict();
export type IssueMcpCredentialInput = z.input<typeof issueSchema>;
const publicColumns = `id, domain_id AS domainId, label, expires_at AS expiresAt,
  created_at AS createdAt, revoked_at AS revokedAt`;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/** Credentials represent a real user, never the domain/workspace owner on their behalf. */
export class McpCredentials {
  constructor(
    private readonly db: DatabaseSync,
    private readonly domains: DomainsService,
    private readonly clock: () => number | Date = Date.now,
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'domain.read' CHECK(scope = 'domain.read'),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS mcp_credentials_user ON mcp_credentials(user_id, revoked_at, expires_at);
    `);
  }

  private userExists(userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM user WHERE id=?').get(userId);
  }

  issue(caller: string, input: IssueMcpCredentialInput) {
    const parsed = issueSchema.safeParse(input);
    if (!parsed.success) throw new McpCredentialError(400, 'Invalid credential input');
    const values = parsed.data;
    // Savepoints also compose with an outer transaction; count and insertion commit together.
    this.db.exec('SAVEPOINT mcp_credential_issue');
    try {
      this.domains.get(caller, values.domainId);
      if (!this.userExists(caller)) throw new McpCredentialError(404, 'User not found');
      const now = new Date(this.clock());
      const createdAt = now.toISOString();
      const count = this.db
        .prepare(
          `SELECT count(*) AS n FROM mcp_credentials
           WHERE user_id=? AND revoked_at IS NULL AND expires_at>?`,
        )
        .get(caller, createdAt)!;
      if (Number(count.n) >= 20) throw new McpCredentialError(409, 'Credential limit reached');
      const token = `meow_mcp_${randomBytes(32).toString('base64url')}`;
      const record: McpCredentialRecord = {
        id: randomUUID(),
        domainId: values.domainId,
        label: values.label,
        expiresAt: new Date(now.getTime() + values.expiresInDays * 86_400_000).toISOString(),
        createdAt,
        revokedAt: null,
      };
      this.db
        .prepare(
          `INSERT INTO mcp_credentials
           (id,user_id,domain_id,hash,label,scope,expires_at,created_at,revoked_at)
           VALUES (?,?,?,?,?,'domain.read',?,?,NULL)`,
        )
        .run(
          record.id,
          caller,
          record.domainId,
          digest(token),
          record.label,
          record.expiresAt,
          record.createdAt,
        );
      this.db.exec('RELEASE mcp_credential_issue');
      return { token, record };
    } catch (error) {
      this.db.exec('ROLLBACK TO mcp_credential_issue; RELEASE mcp_credential_issue');
      throw error;
    }
  }

  list(caller: string): McpCredentialRecord[] {
    const rows = this.db
      .prepare(`SELECT ${publicColumns} FROM mcp_credentials WHERE user_id=? ORDER BY rowid`)
      .all(caller) as McpCredentialRecord[];
    return rows.map((record) => ({ ...record }));
  }

  revoke(caller: string, id: string): McpCredentialRecord {
    const record = this.db
      .prepare(`SELECT ${publicColumns} FROM mcp_credentials WHERE id=? AND user_id=?`)
      .get(id, caller) as McpCredentialRecord | undefined;
    if (!record) throw new McpCredentialError(404, 'Credential not found');
    const revokedAt = record.revokedAt ?? new Date(this.clock()).toISOString();
    this.db
      .prepare('UPDATE mcp_credentials SET revoked_at=? WHERE id=? AND user_id=?')
      .run(revokedAt, id, caller);
    return { ...record, revokedAt };
  }

  authenticate(token: string): { userId: string; domainId: string; credentialId: string } {
    const unauthorized = () => new McpCredentialError(401, 'Invalid MCP credential');
    if (typeof token !== 'string' || !/^meow_mcp_[A-Za-z0-9_-]{43}$/.test(token))
      throw unauthorized();
    const row = this.db
      .prepare(
        `SELECT id, user_id AS userId, domain_id AS domainId FROM mcp_credentials
         WHERE hash=? AND scope='domain.read' AND revoked_at IS NULL AND expires_at>?`,
      )
      .get(digest(token), new Date(this.clock()).toISOString());
    if (!row || !this.userExists(String(row.userId))) throw unauthorized();
    const userId = String(row.userId);
    const domainId = String(row.domainId);
    try {
      this.domains.get(userId, domainId);
    } catch (error) {
      if (error instanceof DomainError && (error.statusCode === 404 || error.statusCode === 403))
        throw unauthorized();
      throw error;
    }
    return { userId, domainId, credentialId: String(row.id) };
  }
}

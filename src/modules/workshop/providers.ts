import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export class ProviderError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const saveSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    endpointId: z.string().min(1).max(100),
    model: z.string().trim().min(1).max(100),
    apiKey: z
      .string()
      .min(1)
      .max(500)
      .refine((key) => key.trim().length > 0),
  })
  .strict();

export type SaveProviderInput = z.input<typeof saveSchema>;
export type ProviderMetadata = {
  id: string;
  label: string;
  endpointId: string;
  model: string;
  configured: true;
};
type ProviderRow = Omit<ProviderMetadata, 'configured'> & { key_blob: Uint8Array };
const publicColumns = 'id, label, endpoint_id AS endpointId, model';
const notFound = () => new ProviderError(404, 'Provider not found');
const unavailable = () => new ProviderError(500, 'Provider unavailable');
const metadata = (row: Omit<ProviderMetadata, 'configured'>): ProviderMetadata => ({
  id: row.id,
  label: row.label,
  endpointId: row.endpointId,
  model: row.model,
  configured: true,
});

/** Owner-scoped encrypted secrets. Only trusted server code may call resolve; never expose it as an API. */
export class ProviderVault {
  private readonly key: Buffer;
  private readonly endpoints = new Map<string, string>();

  constructor(
    private readonly db: DatabaseSync,
    masterSecret: string,
    allowedEndpoints: Record<string, string>,
  ) {
    if (typeof masterSecret !== 'string' || masterSecret.length < 32)
      throw new ProviderError(400, 'Invalid provider vault configuration');
    this.key = createHash('sha256').update(masterSecret).digest();
    if (
      !allowedEndpoints ||
      typeof allowedEndpoints !== 'object' ||
      Array.isArray(allowedEndpoints)
    )
      throw new ProviderError(400, 'Invalid provider vault configuration');
    for (const [id, endpoint] of Object.entries(allowedEndpoints)) {
      try {
        if (
          !id ||
          id.length > 100 ||
          typeof endpoint !== 'string' ||
          !endpoint ||
          endpoint !== endpoint.trim()
        )
          throw new Error();
        const url = new URL(endpoint);
        // This map is trusted deployment configuration, not user input. Explicit loopback HTTP
        // permits local deployments; never accept arbitrary client-supplied URLs or redirects.
        const localHttp = url.protocol === 'http:' && url.hostname === '127.0.0.1';
        if (
          (url.protocol !== 'https:' && !localHttp) ||
          !url.hostname ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          endpoint.includes('?') ||
          endpoint.includes('#')
        )
          throw new Error();
        this.endpoints.set(id, url.href);
      } catch {
        throw new ProviderError(400, 'Invalid provider vault configuration');
      }
    }
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workshop_providers (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          endpoint_id TEXT NOT NULL,
          model TEXT NOT NULL,
          key_blob BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS workshop_providers_owner ON workshop_providers(owner_id);
      `);
    } catch {
      throw unavailable();
    }
  }

  private owner(caller: string) {
    if (typeof caller !== 'string' || !caller.trim()) throw notFound();
  }

  private aad(caller: string, row: Omit<ProviderMetadata, 'configured'>): Buffer {
    return Buffer.from(JSON.stringify([caller, row.id, row.label, row.endpointId, row.model]));
  }

  save(caller: string, input: SaveProviderInput): ProviderMetadata {
    this.owner(caller);
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) throw new ProviderError(400, 'Invalid provider input');
    const values = parsed.data;
    if (!this.endpoints.has(values.endpointId))
      throw new ProviderError(400, 'Unknown provider endpoint');
    let savepoint = false;
    try {
      this.db.exec('SAVEPOINT workshop_provider_save');
      savepoint = true;
      if (!this.db.prepare('SELECT 1 FROM user WHERE id=?').get(caller)) throw notFound();
      const count = this.db
        .prepare('SELECT count(*) AS n FROM workshop_providers WHERE owner_id=?')
        .get(caller)!;
      if (Number(count.n) >= 5) throw new ProviderError(409, 'Provider limit reached');
      const record = metadata({ id: randomUUID(), ...values });
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
      cipher.setAAD(this.aad(caller, record));
      const encrypted = Buffer.concat([cipher.update(values.apiKey, 'utf8'), cipher.final()]);
      // Version byte, fresh 96-bit nonce, 128-bit authentication tag, then ciphertext.
      const blob = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
      this.db
        .prepare(
          `INSERT INTO workshop_providers (id,owner_id,label,endpoint_id,model,key_blob)
        VALUES (?,?,?,?,?,?)`,
        )
        .run(record.id, caller, record.label, record.endpointId, record.model, blob);
      this.db.exec('RELEASE workshop_provider_save');
      return record;
    } catch (error) {
      if (savepoint) {
        try {
          this.db.exec('ROLLBACK TO workshop_provider_save; RELEASE workshop_provider_save');
        } catch {
          /* Do not disclose database errors. */
        }
      }
      if (error instanceof ProviderError) throw error;
      throw unavailable();
    }
  }

  list(caller: string): ProviderMetadata[] {
    this.owner(caller);
    try {
      const rows = this.db
        .prepare(`SELECT ${publicColumns} FROM workshop_providers WHERE owner_id=? ORDER BY rowid`)
        .all(caller) as Omit<ProviderMetadata, 'configured'>[];
      return rows.map(metadata);
    } catch {
      throw unavailable();
    }
  }

  remove(caller: string, id: string): void {
    this.owner(caller);
    if (typeof id !== 'string' || !id) throw notFound();
    try {
      const result = this.db
        .prepare('DELETE FROM workshop_providers WHERE id=? AND owner_id=?')
        .run(id, caller);
      if (!result.changes) throw notFound();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw unavailable();
    }
  }

  /** Internal use only: decrypted credentials must not enter HTTP responses, logs or persistence. */
  resolve(caller: string, id: string): { endpoint: string; model: string; apiKey: string } {
    this.owner(caller);
    if (typeof id !== 'string' || !id) throw notFound();
    try {
      const row = this.db
        .prepare(
          `SELECT ${publicColumns}, key_blob FROM workshop_providers WHERE id=? AND owner_id=?`,
        )
        .get(id, caller) as ProviderRow | undefined;
      if (!row) throw notFound();
      const endpoint = this.endpoints.get(row.endpointId);
      if (!endpoint) throw unavailable();
      const blob = Buffer.from(row.key_blob);
      if (blob.length < 30 || blob[0] !== 1) throw unavailable();
      const decipher = createDecipheriv('aes-256-gcm', this.key, blob.subarray(1, 13));
      decipher.setAuthTag(blob.subarray(13, 29));
      decipher.setAAD(this.aad(caller, row));
      const apiKey = Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString(
        'utf8',
      );
      return { endpoint, model: row.model, apiKey };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw unavailable();
    }
  }
}

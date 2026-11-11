import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type AuthUser = { id: string; username: string; role: 'user' | 'admin' };
export type AuthSession = { user: AuthUser; csrfHash: string };
export type AuthResult = { user: AuthUser; token: string; csrfToken: string };
export type AuthOptions = {
  /** Trusted host configuration only. Usernames are exact, case-sensitive matches. */
  adminUsernames?: string[];
  /** Unix time in milliseconds; defaults to Date.now. */
  clock?: () => number;
};

export class AuthError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'AuthError';
  }
}

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ATTEMPT_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const validUsername = (value: unknown): value is string => typeof value === 'string'
  && [...value].length >= 3 && [...value].length <= 40 && /^[A-Za-z0-9_.\-\p{Script=Han}]+$/u.test(value);
const validPassword = (value: unknown): value is string => typeof value === 'string'
  && [...value].length >= 12 && [...value].length <= 128;
const passwordHash = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key));
});
const unauthorized = () => new AuthError('Invalid username or password', 401);

/** Independent identity storage. The injected database remains owned by the caller. */
export class AuthService {
  private readonly admins: Set<string>;
  private readonly clock: () => number;
  private readonly dummySalt = randomBytes(16).toString('hex');

  constructor(private readonly db: DatabaseSync, options: AuthOptions = {}) {
    this.admins = new Set(options.adminUsernames ?? []);
    this.clock = options.clock ?? Date.now;
    this.database(() => db.exec(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'admin'))
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        csrf_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_attempts (
        username TEXT PRIMARY KEY,
        failures INTEGER NOT NULL,
        window_started_at INTEGER NOT NULL,
        locked_until INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
    `));
  }

  async register(username: string, password: string): Promise<AuthResult> {
    if (!validUsername(username) || !validPassword(password)) {
      throw new AuthError('Username must be 3–40 safe characters; password must be 12–128 characters', 400);
    }
    const salt = randomBytes(16).toString('hex');
    const hash = (await passwordHash(password, salt)).toString('hex');
    const user: AuthUser = { id: randomUUID(), username, role: this.admins.has(username) ? 'admin' : 'user' };
    return this.transaction(() => {
      if (this.db.prepare('SELECT id FROM auth_users WHERE username = ?').get(username)) {
        throw new AuthError('Username already exists', 409);
      }
      this.db.prepare('INSERT INTO auth_users (id, username, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)')
        .run(user.id, username, hash, salt, user.role);
      return this.createSession(user);
    });
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const nameValid = validUsername(username);
    const passwordValid = validPassword(password);
    const row = nameValid ? this.database(() => this.db.prepare(
      'SELECT id, username, role, password_hash, password_salt FROM auth_users WHERE username = ?',
    ).get(username)) : undefined;
    // Unknown users (and malformed credentials) still pay for one real asynchronous scrypt.
    const actual = await passwordHash(passwordValid ? password : 'invalid-credentials', row ? String(row.password_salt) : this.dummySalt);
    const expected = row ? Buffer.from(String(row.password_hash), 'hex') : Buffer.alloc(64);
    const matches = expected.length === actual.length && timingSafeEqual(actual, expected);
    // Never leave a transaction open across the asynchronous hash. Recheck the persistent
    // lock after hashing so concurrent requests cannot bypass the fifth-failure lock.
    const result = this.transaction(() => {
      const now = this.clock();
      const attempt = nameValid ? this.db.prepare('SELECT * FROM auth_attempts WHERE username = ?').get(username) : undefined;
      if (attempt && Number(attempt.locked_until) > now) return null;
      if (!nameValid || !passwordValid || !row || !matches) {
        if (nameValid) {
          const activeWindow = attempt && now - Number(attempt.window_started_at) < ATTEMPT_MS;
          const failures = activeWindow ? Number(attempt.failures) + 1 : 1;
          const start = activeWindow ? Number(attempt.window_started_at) : now;
          this.db.prepare(`INSERT INTO auth_attempts (username, failures, window_started_at, locked_until)
            VALUES (?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET
            failures = excluded.failures, window_started_at = excluded.window_started_at, locked_until = excluded.locked_until`)
            .run(username, failures, start, failures >= MAX_FAILURES ? now + ATTEMPT_MS : 0);
        }
        return null;
      }
      this.db.prepare('DELETE FROM auth_attempts WHERE username = ?').run(username);
      return this.createSession(this.publicUser(row));
    });
    if (!result) throw unauthorized();
    return result;
  }

  authenticate(token: string): AuthSession | null {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    return this.database(() => {
      const row = this.db.prepare(`SELECT u.id, u.username, u.role, s.csrf_hash, s.expires_at
        FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(digest(token));
      if (!row) return null;
      if (Number(row.expires_at) <= this.clock()) {
        this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token));
        return null;
      }
      return { user: this.publicUser(row), csrfHash: String(row.csrf_hash) };
    });
  }

  /** The session must come from authenticate; this only checks the CSRF proof. */
  verifyCsrf(session: AuthSession | null, token: string): boolean {
    if (!session || typeof token !== 'string' || !TOKEN_PATTERN.test(token) || !/^[a-f0-9]{64}$/.test(session.csrfHash)) return false;
    return timingSafeEqual(Buffer.from(session.csrfHash, 'hex'), Buffer.from(digest(token), 'hex'));
  }

  logout(token: string): void {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return;
    this.database(() => this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token)));
  }

  private publicUser(row: Record<string, unknown>): AuthUser {
    return { id: String(row.id), username: String(row.username), role: row.role === 'admin' ? 'admin' : 'user' };
  }

  private createSession(user: AuthUser): AuthResult {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO auth_sessions (token_hash, user_id, csrf_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(digest(token), user.id, digest(csrfToken), this.clock() + SESSION_MS);
    return { user, token, csrfToken };
  }

  private database<T>(operation: () => T): T {
    try { return operation(); } catch (error) {
      if (error instanceof AuthError) throw error;
      // Do not expose SQLite messages, bound values, credentials or tokens.
      throw new AuthError('Authentication storage unavailable', 500);
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
        try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original failure. */ }
        throw error;
      }
    });
  }
}

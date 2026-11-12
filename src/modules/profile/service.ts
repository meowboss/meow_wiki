import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const updateSchema = z.strictObject({ name: z.string().trim().min(1).max(80) });

export type Profile = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  role: 'user' | 'admin';
};

export class ProfileError extends Error {
  constructor(
    readonly statusCode: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

/** Account fields belong to Better Auth; only the host-owned role table grants roles. */
export class ProfileService {
  constructor(private readonly db: DatabaseSync) {}

  get(userId: string): Profile {
    const row = this.db
      .prepare(
        `SELECT u.id, u.name, u.email, u.emailVerified, u.createdAt, u.updatedAt, r.role
         FROM user AS u LEFT JOIN mw_platform_roles AS r ON r.user_id = u.id
         WHERE u.id = ?`,
      )
      .get(userId);
    if (!row) throw new ProfileError(404, '账号不存在');
    return {
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      emailVerified: row.emailVerified === 1,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      role: row.role === 'admin' ? 'admin' : 'user',
    };
  }

  update(userId: string, input: unknown): Profile {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) throw new ProfileError(400, '仅允许修改姓名，长度须为 1 至 80 字符');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Better Auth's SQLite date columns store ISO UTC text, including milliseconds.
      const result = this.db
        .prepare('UPDATE user SET name = ?, updatedAt = ? WHERE id = ?')
        .run(parsed.data.name, new Date().toISOString(), userId);
      if (result.changes === 0) throw new ProfileError(404, '账号不存在');
      const profile = this.get(userId);
      this.db.exec('COMMIT');
      return profile;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ensureAudit } from './components.ts';

/** Host-only role provisioning. Never expose this function as an HTTP route. */
export function changeAdminRole(db: DatabaseSync, action: 'grant' | 'revoke', email: string, actorId = 'host-cli') {
  if (!['grant', 'revoke'].includes(action)) throw new Error('操作必须为 grant 或 revoke');
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !normalized.includes('@')) throw new Error('请输入已注册用户的 email');
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  db.exec('BEGIN IMMEDIATE');
  try {
    const user = db.prepare('SELECT id FROM user WHERE lower(email)=?').get(normalized);
    if (!user) throw new Error('未找到已注册的 Better Auth 用户');
    db.exec(`CREATE TABLE IF NOT EXISTS mw_platform_roles (
      user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin'))
    )`);
    ensureAudit(db);
    const before = db.prepare('SELECT role FROM mw_platform_roles WHERE user_id=?').get(String(user.id))?.role ?? 'user';
    const role = action === 'grant' ? 'admin' : 'user';
    db.prepare('INSERT INTO mw_platform_roles (user_id, role) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role')
      .run(String(user.id), role);
    db.prepare('INSERT INTO mw_audit VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), actorId, `role.${action}`,
      String(user.id), JSON.stringify({ before, role }), new Date().toISOString());
    db.exec('COMMIT');
    return { userId: String(user.id), role };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function runAdminCli(args = process.argv.slice(2), env = process.env) {
  if (args.length !== 2 || !['grant', 'revoke'].includes(args[0])) throw new Error('用法：tsx src/admin.ts <grant|revoke> <已注册 email>；MEOW_DATABASE 指定数据库');
  // Do not silently create a different/empty database when provisioning roles.
  const path = resolve(env.MEOW_DATABASE ?? '.data/meow.sqlite');
  if (!existsSync(path)) throw new Error('数据库不存在；请先启动服务并注册用户');
  const db = new DatabaseSync(path, { open: false });
  try {
    db.open();
    const result = changeAdminRole(db, args[0] as 'grant' | 'revoke', args[1]);
    console.log(`${result.userId}: ${result.role}`);
    return result;
  } finally { if (db.isOpen) db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runAdminCli(); }
  catch (error) { console.error(error instanceof Error ? error.message : '角色操作失败'); process.exitCode = 1; }
}

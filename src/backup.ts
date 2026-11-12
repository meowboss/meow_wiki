import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, openSync, closeSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** SQLite online snapshot; caller must also securely preserve its host auth secret and future assets. */
export async function createBackup(sourcePath: string, destinationPath: string) {
  const source = resolve(sourcePath),
    destination = resolve(destinationPath);
  if (source === destination || !existsSync(source) || existsSync(destination))
    throw new Error('备份要求存在的源库和全新且不同的目标文件');
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  // Reserve the exact new destination atomically with restrictive POSIX creation mode.
  // Existing directories are never chmod'ed; Windows requires a private inherited ACL.
  const fd = openSync(destination, 'wx', 0o600);
  closeSync(fd);
  if (process.platform !== 'win32') chmodSync(destination, 0o600);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, destination);
  } finally {
    db.close();
  }
  const verify = new DatabaseSync(destination, { readOnly: true });
  try {
    if (Object.values(verify.prepare('PRAGMA integrity_check').get() ?? {})[0] !== 'ok')
      throw new Error('备份完整性检查失败');
  } finally {
    verify.close();
  }
  return destination;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error('用法：tsx src/backup.ts <新备份文件>；MEOW_DATABASE指定源库');
    process.exitCode = 1;
  } else {
    try {
      console.log(
        await createBackup(process.env.MEOW_DATABASE ?? '.data/meow.sqlite', process.argv[2]),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : '备份失败');
      process.exitCode = 1;
    }
  }
}

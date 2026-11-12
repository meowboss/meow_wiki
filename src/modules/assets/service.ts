import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AccessError } from '../../store.ts';

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_USER_ASSET_BYTES = 32 * 1024 * 1024;
export const MAX_USER_ASSETS = 20;
const mimeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
]);
const inputSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(120)
    .refine((value) => value.trim().length > 0),
  mime: mimeSchema,
  base64: z
    .string()
    .min(4)
    .max(4 * Math.ceil(MAX_ASSET_BYTES / 3)),
});
export type AssetMetadata = {
  id: string;
  name: string;
  mime: z.infer<typeof mimeSchema>;
  bytes: number;
};
export type Asset = AssetMetadata & { data: Buffer };
export class AssetError extends Error {
  constructor(
    readonly statusCode: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

function matchesMagic(mime: AssetMetadata['mime'], data: Buffer): boolean {
  switch (mime) {
    case 'image/png':
      return data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    case 'image/jpeg':
      return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case 'image/gif':
      return ['GIF87a', 'GIF89a'].includes(data.toString('latin1', 0, 6));
    case 'image/webp':
      return (
        data.length >= 12 &&
        data.toString('latin1', 0, 4) === 'RIFF' &&
        data.toString('latin1', 8, 12) === 'WEBP'
      );
    case 'video/mp4': {
      if (data.length < 16 || data.toString('latin1', 4, 8) !== 'ftyp') return false;
      const size = data.readUInt32BE(0);
      if (size < 16 || size > data.length || size % 4 !== 0) return false;
      const brands = [
        'isom',
        'iso2',
        'iso3',
        'iso4',
        'iso5',
        'iso6',
        'mp41',
        'mp42',
        'avc1',
        'dash',
        'M4V ',
        'MSNV',
      ];
      for (let offset = 8; offset + 4 <= size; offset += offset === 8 ? 8 : 4)
        if (brands.includes(data.toString('latin1', offset, offset + 4))) return true;
      return false;
    }
    case 'video/webm': {
      if (data.length < 12 || !data.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')))
        return false;
      // EBML alone also identifies Matroska; require an explicit WebM DocType element.
      const header = data.subarray(4, Math.min(data.length, 4096));
      return header.includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]));
    }
  }
}

/** Private media storage; quota checks and insertion share a synchronous SQLite savepoint. */
export class AssetService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly authorize: (owner: string, workspace: string) => void,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS mw_assets (
      owner TEXT NOT NULL, workspace TEXT NOT NULL, id TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK (bytes > 0),
      data BLOB NOT NULL CHECK (length(data) = bytes)
    ); CREATE INDEX IF NOT EXISTS mw_assets_owner_workspace ON mw_assets(owner, workspace)`);
  }

  create(owner: string, workspace: string, input: unknown): AssetMetadata {
    this.authorize(owner, workspace);
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new AssetError(400, '媒体输入校验失败');
    const { name, mime, base64 } = parsed.data;
    if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
      throw new AssetError(400, '需要规范 base64');
    const data = Buffer.from(base64, 'base64');
    if (data.length === 0 || data.length > MAX_ASSET_BYTES || data.toString('base64') !== base64)
      throw new AssetError(400, '媒体必须为规范 base64 且不能超过 8MiB');
    if (!matchesMagic(mime, data)) throw new AssetError(400, '媒体类型与文件签名不匹配');
    const asset: AssetMetadata = { id: randomUUID(), name, mime, bytes: data.length };
    this.db.exec('SAVEPOINT asset_create');
    try {
      const usage = this.db
        .prepare(
          'SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM mw_assets WHERE owner = ?',
        )
        .get(owner)!;
      if (
        Number(usage.count) >= MAX_USER_ASSETS ||
        Number(usage.bytes) + data.length > MAX_USER_ASSET_BYTES
      )
        throw new AssetError(409, '每位用户最多保存 20 个媒体，累计不能超过 32MiB');
      this.db
        .prepare(
          'INSERT INTO mw_assets (owner, workspace, id, name, mime, bytes, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(owner, workspace, asset.id, name, mime, data.length, data);
      this.db.exec('RELEASE SAVEPOINT asset_create');
      return asset;
    } catch (error) {
      this.db.exec('ROLLBACK TO SAVEPOINT asset_create');
      this.db.exec('RELEASE SAVEPOINT asset_create');
      throw error;
    }
  }

  list(owner: string, workspace: string): AssetMetadata[] {
    this.authorize(owner, workspace);
    return this.db
      .prepare(
        'SELECT id, name, mime, bytes FROM mw_assets WHERE owner = ? AND workspace = ? ORDER BY rowid',
      )
      .all(owner, workspace) as AssetMetadata[];
  }

  remove(owner: string, workspace: string, id: string) {
    this.db.exec('SAVEPOINT asset_remove');
    try {
      this.get(owner, workspace, id);
      this.removeUnreferenced(owner, workspace, id);
      this.db.exec('RELEASE SAVEPOINT asset_remove');
    } catch (error) {
      this.db.exec('ROLLBACK TO SAVEPOINT asset_remove');
      this.db.exec('RELEASE SAVEPOINT asset_remove');
      throw error;
    }
  }

  private removeUnreferenced(owner: string, workspace: string, id: string) {
    const hasCompositions = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mw_compositions'")
      .get();
    const rows = hasCompositions
      ? this.db.prepare('SELECT json FROM mw_compositions WHERE owner=?').all(owner)
      : [];
    if (
      this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mw_workshop_pages'")
        .get()
    )
      rows.push(
        ...this.db
          .prepare('SELECT composition_json AS json FROM mw_workshop_pages WHERE owner=?')
          .all(owner),
      );
    for (const row of rows) {
      let document: unknown;
      try {
        document = JSON.parse(String(row.json));
      } catch {
        throw new AssetError(409, '存在无法确认引用的布局，不能删除素材');
      }
      const instances = (document as { instances?: { config?: { assetId?: string } }[] }).instances;
      if (instances?.some((i) => i.config?.assetId === id))
        throw new AssetError(409, '素材仍被已保存布局引用，请先移除引用');
    }
    this.db
      .prepare('DELETE FROM mw_assets WHERE owner=? AND workspace=? AND id=?')
      .run(owner, workspace, id);
  }
  get(owner: string, workspace: string, id: string): Asset {
    this.authorize(owner, workspace);
    const row = this.db
      .prepare(
        'SELECT id, name, mime, bytes, data FROM mw_assets WHERE owner = ? AND workspace = ? AND id = ?',
      )
      .get(owner, workspace, id);
    if (!row) throw new AccessError('未找到此媒体');
    return {
      id: String(row.id),
      name: String(row.name),
      mime: row.mime as AssetMetadata['mime'],
      bytes: Number(row.bytes),
      data: Buffer.from(row.data as Uint8Array),
    };
  }
}

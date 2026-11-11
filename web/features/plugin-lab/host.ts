import {
  SAMPLE_PLUGIN_MANIFEST,
  buildPluginPolicy,
  pluginRpcRequestSchema,
} from '../../../packages/plugin-sdk/index';
// This host is deliberately not an arbitrary-code plugin loader.
export const SAMPLE_MANIFEST = SAMPLE_PLUGIN_MANIFEST;
const policy = buildPluginPolicy(SAMPLE_MANIFEST);
export const MAX_MESSAGE_BYTES = 8000;
export const MAX_REQUESTS = 30;
export type PageSummary = { id: string; title: string };
type Reply =
  { id: string; result: PageSummary[] } | { id: string; error: { code: string; message: string } };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function messageBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? new TextEncoder().encode(json).byteLength : Infinity;
  } catch {
    return Infinity;
  }
}

/** A mount-scoped budget, not a nonce-based authorization mechanism. */
export function createSampleHost(
  getPages: () => readonly PageSummary[],
  log: (text: string) => void,
) {
  let count = 0;
  let disposed = false;
  function reject(id: string, code: string, message: string): Reply {
    // Never echo payloads, arbitrary method strings, nonce, credentials or page content.
    log(`宿主拒绝 · ${code} · ${message}`);
    return { id, error: { code, message } };
  }
  return {
    handle(value: unknown): Reply | null {
      if (disposed) return null;
      count += 1;
      if (count > MAX_REQUESTS) {
        if (count === MAX_REQUESTS + 1)
          log('宿主拒绝 · RATE_LIMIT · 每次挂载最多 30 条消息，通道已关闭。');
        return null;
      }
      if (messageBytes(value) > MAX_MESSAGE_BYTES)
        return reject('', 'MESSAGE_TOO_LARGE', '消息不得超过 8000 字节。');
      const parsed = pluginRpcRequestSchema.safeParse(value);
      if (!parsed.success) {
        // Keep unknown-method diagnostics separate without trusting or echoing input.
        if (
          record(value) &&
          typeof value.id === 'string' &&
          value.id.length >= 1 &&
          value.id.length <= 64 &&
          typeof value.method === 'string' &&
          value.method !== 'pages.list' &&
          value.method !== 'workspace.summary'
        )
          return reject(value.id, 'METHOD_NOT_FOUND', '未知方法。');
        return reject('', 'INVALID_REQUEST', '请求必须包含严格的 id、method 和空 params。');
      }
      const request = parsed.data;
      if (!policy.allows(request.method))
        return reject(request.id, 'PERMISSION_DENIED', '示例清单仅授权 pages.list。');
      const result: PageSummary[] = [];
      for (const page of getPages().slice(0, 50)) {
        // Construct a new allowlisted object; never serialize a full workspace/page.
        const row = { id: page.id, title: page.title };
        if (typeof row.id !== 'string' || typeof row.title !== 'string') continue;
        if (messageBytes({ id: request.id, result: [...result, row] }) > MAX_MESSAGE_BYTES) break;
        result.push(row);
      }
      log(`宿主允许 · pages.list · 返回 ${result.length} 个页面的 id / 标题。`);
      return { id: request.id, result };
    },
    get exhausted() {
      return count > MAX_REQUESTS;
    },
    dispose() {
      disposed = true;
    },
  };
}

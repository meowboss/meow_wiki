import { z } from 'zod';

/** Browser-safe protocol contract; this package must never import server internals. */
export const pluginMethodSchema = z.enum(['pages.list', 'workspace.summary']);
export const pluginManifestSchema = z
  .object({
    id: z.literal('example.page-list'),
    apiVersion: z.literal(1),
    version: z.string().min(1).max(64),
    permissions: z.array(z.literal('pages.list')).max(1),
  })
  .strict();
export const pluginRpcRequestSchema = z
  .object({
    id: z.string().min(1).max(64),
    method: pluginMethodSchema,
    params: z.object({}).strict(),
  })
  .strict();
export const pluginConnectionSchema = z
  .object({
    type: z.literal('meow.plugin.connect'),
    apiVersion: z.literal(1),
    nonce: z.string().min(16).max(256),
  })
  .strict();
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginRpcRequest = z.infer<typeof pluginRpcRequestSchema>;
export type PluginMethod = z.infer<typeof pluginMethodSchema>;
export const SAMPLE_PLUGIN_MANIFEST: PluginManifest = {
  id: 'example.page-list',
  apiVersion: 1,
  version: '1.0.0',
  permissions: ['pages.list'],
};

/** Permissions are an allowlist, never authority derived from a message origin. */
export function buildPluginPolicy(value: unknown) {
  const manifest = pluginManifestSchema.parse(value);
  const granted = new Set<string>(manifest.permissions);
  return { manifest, allows: (method: PluginMethod) => granted.has(method) };
}
export function isPluginConnectionMessage(
  value: unknown,
): value is z.infer<typeof pluginConnectionSchema> {
  return pluginConnectionSchema.safeParse(value).success;
}
/** Opaque sandbox origin "null" is not identity. Bind the exact iframe WindowProxy. */
export function isPluginHostSource(
  event: Pick<MessageEvent, 'source'>,
  expectedWindow: Window,
): boolean {
  return event.source === expectedWindow;
}

/**
 * Audited, dependency-free browser SDK source, embedded under the document CSP nonce.
 * No user source, dynamic compilation, script URLs, or HTML interpolation is accepted.
 * The parent creates MessageChannel and transfers precisely one port on first connect.
 */
export const PLUGIN_CLIENT_SOURCE = String.raw`
function connectPlugin(parentWindow, onConnected) {
  let connected = false;
  function receive(event) {
    if (connected || event.source !== parentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        Object.keys(data).sort().join(',') !== 'apiVersion,nonce,type' ||
        data.type !== 'meow.plugin.connect' || data.apiVersion !== 1 ||
        typeof data.nonce !== 'string' || data.nonce.length < 16 || data.nonce.length > 256 ||
        event.ports.length !== 1) return;
    connected = true;
    window.removeEventListener('message', receive);
    const port = event.ports[0];
    const pending = new Map();
    port.onmessage = function (message) {
      const response = message.data;
      if (!response || typeof response.id !== 'string') return;
      const callback = pending.get(response.id);
      if (!callback) return;
      pending.delete(response.id);
      if (response.error) callback.reject(new Error('Host rejected request'));
      else callback.resolve(response.result);
    };
    port.start();
    onConnected({
      request: function (id, method) {
        if (typeof id !== 'string' || !id || id.length > 64 ||
            !['pages.list', 'workspace.summary'].includes(method) || pending.has(id)) {
          return Promise.reject(new Error('Invalid plugin request'));
        }
        return new Promise(function (resolve, reject) {
          pending.set(id, { resolve: resolve, reject: reject });
          port.postMessage({ id: id, method: method, params: {} });
        });
      }
    });
  }
  window.addEventListener('message', receive);
}
`;

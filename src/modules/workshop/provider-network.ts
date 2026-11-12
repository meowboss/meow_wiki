import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';

const MAX_BYTES = 256 * 1024;
const failure = () => new Error('Provider network request failed');
const invalidEndpoint = () => new Error('Invalid provider endpoint');

/** Syntax validation only. DNS/public-address validation is repeated on every request. */
export function normalizeProviderEndpoint(value: string): string {
  try {
    if (
      typeof value !== 'string' ||
      !value ||
      value !== value.trim() ||
      value.length > 2048 ||
      /[\s\\\u0000-\u001f\u007f]/u.test(value) ||
      value.includes('?') ||
      value.includes('#')
    )
      throw invalidEndpoint();
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !isIP(url.hostname.replace(/^\[|\]$/g, ''))) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw invalidEndpoint();
    // Reject even empty userinfo (https://@example.com), which URL otherwise discards.
    if (
      value
        .slice(value.indexOf('://') + 3)
        .split('/')[0]
        .includes('@')
    )
      throw invalidEndpoint();
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const authority = value.slice(value.indexOf('://') + 3).split('/')[0];
    if (isIP(host) === 4 && authority.split(':')[0] !== host) throw invalidEndpoint();
    if (isIP(host) && !isAllowedLiteralAddress(host)) throw invalidEndpoint();
    return url.href.replace(/\/+$/, '');
  } catch {
    throw invalidEndpoint();
  }
}

/** Explicit IP targets may use private/loopback networks; never link-local/metadata or mapped IPs. */
export function isAllowedLiteralAddress(ip: string): boolean {
  if (!isIP(ip) || ip.includes('%')) return false;
  try {
    const parsed = ipaddr.parse(ip);
    return isPublicAddress(ip) || ['private', 'loopback', 'uniqueLocal'].includes(parsed.range());
  } catch {
    return false;
  }
}

/** Strict IP syntax plus conservative special-use classification; mapped IPv4 is always denied. */
export function isPublicAddress(ip: string): boolean {
  if (typeof ip !== 'string' || !isIP(ip) || ip.includes('%')) return false;
  try {
    const address = ipaddr.parse(ip);
    if (address.range() !== 'unicast') return false;
    if (address.kind() === 'ipv6') {
      // Only ordinary global unicast (2000::/3); exclude transition/special-use prefixes.
      const v6 = address as ipaddr.IPv6;
      if (!v6.match(ipaddr.parse('2000::') as ipaddr.IPv6, 3)) return false;
      for (const [network, prefix] of [
        ['2001::', 23],
        ['2001:db8::', 32],
        ['2002::', 16],
        ['3fff::', 20],
      ] as const) {
        if (v6.match(ipaddr.parse(network) as ipaddr.IPv6, prefix)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export type ProviderAddress = { address: string; family: number };
export type ProviderNetworkOptions = {
  resolver?: (hostname: string) => Promise<readonly ProviderAddress[]>;
  /** Trusted dependency injection only. A replacement must honor dispatcher and redirect options. */
  fetcher?: typeof fetch;
  agentFactory?: (options: Agent.Options) => Dispatcher;
};
export type ProviderRequestOptions = { signal?: AbortSignal };

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(failure());
    if (signal.aborted) {
      reject(failure());
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function readBounded(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
    await response.body?.cancel().catch(() => {});
    throw failure();
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw failure();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Fetch-compatible HTTPS transport. Never use this to authorize trusted local HTTP endpoints. */
export function createSafeProviderFetch(
  options?: ProviderNetworkOptions | typeof fetch,
): typeof fetch {
  const dependencies = typeof options === 'function' ? { fetcher: options } : (options ?? {});
  const resolver =
    dependencies.resolver ??
    ((hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  const fetcher = dependencies.fetcher ?? (undiciFetch as unknown as typeof fetch);
  const agentFactory =
    dependencies.agentFactory ?? ((options: Agent.Options) => new Agent(options));
  return async (input, init) => {
    let agent: Dispatcher | undefined;
    let response: Response | undefined;
    try {
      normalizeProviderEndpoint(input instanceof Request ? input.url : String(input));
      const request = new Request(input, init);
      const normalized = normalizeProviderEndpoint(request.url);
      const url = new URL(normalized);
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const timeout = AbortSignal.timeout(url.pathname.endsWith('/models') ? 10_000 : 30_000);
      const signal = AbortSignal.any([request.signal, timeout]);
      signal.throwIfAborted();
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await withAbort(resolver(hostname), signal);
      if (
        !addresses.length ||
        addresses.some(
          ({ address, family }) =>
            !(isIP(hostname) ? isAllowedLiteralAddress(address) : isPublicAddress(address)) ||
            family !== isIP(address),
        )
      )
        throw failure();
      // Snapshot primitives: an injected resolver cannot mutate a validated answer afterward.
      const pinned = addresses.map(({ address, family }) => ({ address, family }));
      const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
        if (_hostname !== hostname) {
          callback(failure(), '', 0);
          return;
        }
        const family = typeof lookupOptions === 'number' ? lookupOptions : lookupOptions.family;
        const candidates = pinned.filter((entry) => !family || family === entry.family);
        if (!candidates.length) {
          callback(failure(), '', 0);
          return;
        }
        // Undici may request all addresses for autoSelectFamily. No second DNS lookup occurs.
        if (typeof lookupOptions === 'object' && lookupOptions.all) {
          (callback as unknown as (error: null, result: ProviderAddress[]) => void)(
            null,
            candidates,
          );
        } else callback(null, candidates[0].address, candidates[0].family);
      };
      agent = agentFactory({ connect: { lookup: pinnedLookup } });
      // Keep the original URL/hostname, including for TLS SNI/certificate validation.
      const transportInit: RequestInit & { dispatcher: Dispatcher } = {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal,
        redirect: 'error',
        dispatcher: agent,
        ...(request.body ? { duplex: 'half' } : {}),
      };
      response = await withAbort(fetcher(request.url, transportInit), signal);
      if (response.status >= 300 && response.status < 400) throw failure();
      const bytes = await readBounded(response, signal);
      signal.throwIfAborted();
      const headers = new Headers(response.headers);
      // The fetch body is decompressed; don't forward stale encoding/length metadata.
      headers.delete('content-encoding');
      headers.delete('content-length');
      return new Response(
        [101, 204, 205, 304].includes(response.status) ? null : (bytes.buffer as ArrayBuffer),
        {
          status: response.status,
          statusText: response.statusText,
          headers,
        },
      );
    } catch {
      void response?.body?.cancel().catch(() => {});
      throw failure();
    } finally {
      if (agent) await agent.destroy().catch(() => {});
    }
  };
}

export const safeProviderFetch: typeof fetch = createSafeProviderFetch();

export class ProviderNetwork {
  private readonly fetcher: typeof fetch;
  constructor(options?: ProviderNetworkOptions) {
    this.fetcher = createSafeProviderFetch(options);
  }

  async request(
    endpoint: string,
    apiKey: string,
    path: 'models' | 'chat/completions',
    body?: unknown,
    options?: ProviderRequestOptions,
  ): Promise<unknown> {
    try {
      if (path !== 'models' && path !== 'chat/completions') throw failure();
      const url = normalizeProviderEndpoint(endpoint) + '/' + path;
      const response = await this.fetcher(url, {
        method: path === 'models' ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        ...(path === 'chat/completions' ? { body: JSON.stringify(body) } : {}),
        signal: options?.signal,
      });
      if (!response.ok) throw failure();
      const text = await response.text();
      if (apiKey && text.includes(apiKey)) throw failure();
      const decoded: unknown = JSON.parse(text);
      if (apiKey && JSON.stringify(decoded).includes(apiKey)) throw failure();
      return decoded;
    } catch {
      throw failure();
    }
  }
}

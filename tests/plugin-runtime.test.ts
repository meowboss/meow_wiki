import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import Fastify from 'fastify';
import { registerPluginRuntime } from '../src/modules/plugin-runtime/routes.ts';
import {
  buildPluginPolicy,
  isPluginHostSource,
  pluginManifestSchema,
  pluginRpcRequestSchema,
  SAMPLE_PLUGIN_MANIFEST,
} from '../packages/plugin-sdk/index.ts';

async function sample() {
  const app = Fastify();
  registerPluginRuntime(app);
  return { app, response: await app.inject('/plugin-runtime/sample.html') };
}

test('sample has a fresh CSP nonce and denies all network and dynamic code capabilities', async () => {
  const { app, response } = await sample();
  try {
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type']), /^text\/html; charset=utf-8$/);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    const csp = String(response.headers['content-security-policy']);
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    assert.ok(nonce);
    assert.match(response.body, new RegExp(`<script nonce="${nonce.replace(/[+]/g, '\\+')}">`));
    for (const directive of [
      'default-src',
      'connect-src',
      'img-src',
      'frame-src',
      'worker-src',
      'form-action',
      'base-uri',
    ]) {
      assert.ok(csp.split('; ').includes(`${directive} 'none'`), directive);
    }
    assert.ok(csp.includes("style-src 'unsafe-inline'"));
    assert.ok(!csp.includes('frame-ancestors'));
    assert.ok(!csp.includes('unsafe-eval'));
    assert.ok(!csp.includes("script-src 'unsafe-inline'"));
    assert.ok(
      !/\beval\s*\(|new\s+Function\s*\(|innerHTML|document\.write\s*\(/.test(response.body),
    );
    const second = await app.inject('/plugin-runtime/sample.html?code=untrusted-input');
    assert.notEqual(second.headers['content-security-policy'], csp);
    assert.ok(!second.body.includes('untrusted-input'));
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/plugin-runtime/sample.html',
          payload: { code: 'untrusted-input' },
        })
      ).statusCode,
      404,
    );
    assert.equal((await app.inject('/plugin-runtime/arbitrary.html')).statusCode, 404);
    assert.match(response.body, /^<!doctype html>/);
    assert.match(response.body, /fetch\('\/api\/workspace'\)/);
    assert.ok(!/https?:\/\//.test(response.body));
  } finally {
    await app.close();
  }
});

test('strict manifests and RPC reject unknown methods, arguments, versions and code', () => {
  assert.deepEqual(pluginManifestSchema.parse(SAMPLE_PLUGIN_MANIFEST), SAMPLE_PLUGIN_MANIFEST);
  const policy = buildPluginPolicy(SAMPLE_PLUGIN_MANIFEST);
  assert.equal(policy.allows('pages.list'), true);
  assert.equal(policy.allows('workspace.summary'), false);
  const valid = { id: '1', method: 'pages.list', params: {} };
  assert.deepEqual(pluginRpcRequestSchema.parse(valid), valid);
  assert.equal(
    pluginRpcRequestSchema.safeParse({ ...valid, method: 'workspace.summary' }).success,
    true,
  );
  for (const invalid of [
    { ...valid, method: 'pages.delete' },
    { ...valid, id: 'x'.repeat(65) },
    { ...valid, id: '' },
    { ...valid, params: { workspaceId: 'other' } },
    { ...valid, code: 'arbitrary source' },
    { ...valid, params: [] },
  ])
    assert.equal(pluginRpcRequestSchema.safeParse(invalid).success, false);
  for (const invalid of [
    { ...SAMPLE_PLUGIN_MANIFEST, apiVersion: 2 },
    { ...SAMPLE_PLUGIN_MANIFEST, permissions: ['workspace.summary'] },
    { ...SAMPLE_PLUGIN_MANIFEST, code: 'arbitrary source' },
  ])
    assert.equal(pluginManifestSchema.safeParse(invalid).success, false);
  const sdk = readFileSync('packages/plugin-sdk/index.ts', 'utf8');
  assert.ok(!/from ['"]node:|from ['"].*src\//.test(sdk));
  const frame = {} as Window;
  assert.equal(isPluginHostSource({ source: frame }, frame), true);
  assert.equal(isPluginHostSource({ source: {} as Window }, frame), false);
});

test(
  'sample SDK accepts only parent first connection and uses a real MessageChannel',
  { timeout: 5000 },
  async () => {
    const { app, response } = await sample();
    const channel = new MessageChannel();
    const ignored = new MessageChannel();
    try {
      const nodes = new Map<string, { textContent: string }>();
      const parentWindow = Object.defineProperty({}, 'document', {
        get() {
          throw new DOMException('Blocked', 'SecurityError');
        },
      });
      let listener: ((event: unknown) => void) | undefined;
      let complete!: () => void;
      const rendered = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const status = {
        value: '',
        get textContent() {
          return this.value;
        },
        set textContent(value: string) {
          this.value = value;
          if (value === '页面列表读取成功') complete();
        },
      };
      const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(response.body)![1];
      runInNewContext(script, {
        parent: parentWindow,
        window: {
          addEventListener(_type: string, handler: (event: unknown) => void) {
            listener = handler;
          },
          removeEventListener() {},
        },
        document: {
          querySelector(selector: string) {
            if (selector.includes('plugin-status')) return status;
            const node = { textContent: '' };
            nodes.set(selector, node);
            return node;
          },
        },
        fetch: () => Promise.reject(new TypeError('CSP blocked')),
      });
      const connect = { type: 'meow.plugin.connect', apiVersion: 1, nonce: '0123456789abcdef' };
      listener!({ source: {}, data: connect, ports: [ignored.port2], origin: 'null' });
      assert.equal(status.textContent, '');
      const request = new Promise<unknown>((resolve) => channel.port1.once('message', resolve));
      listener!({ source: parentWindow, data: connect, ports: [channel.port2], origin: 'null' });
      assert.deepEqual(await request, { id: '1', method: 'pages.list', params: {} });
      channel.port1.postMessage({
        id: '1',
        result: [{ id: 'page-1', title: '<img src=x onerror=bad>' }],
      });
      await rendered;
      assert.equal(
        nodes.get('[data-testid="plugin-pages"]')!.textContent,
        '<img src=x onerror=bad> (page-1)',
      );
      assert.match(nodes.get('[data-testid="plugin-dom-result"]')!.textContent, /隔离检查通过/);
      assert.match(nodes.get('[data-testid="plugin-fetch-result"]')!.textContent, /隔离检查通过/);
      listener!({ source: parentWindow, data: connect, ports: [ignored.port2] });
      assert.equal(status.textContent, '页面列表读取成功');
    } finally {
      channel.port1.close();
      channel.port2.close();
      ignored.port1.close();
      ignored.port2.close();
      await app.close();
    }
  },
);

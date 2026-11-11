import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { PLUGIN_CLIENT_SOURCE } from '../../../packages/plugin-sdk/index.ts';

/** Only this reviewed, immutable sample is executable. No user code endpoint exists. */
export function registerPluginRuntime(app: FastifyInstance): void {
  app.get('/plugin-runtime/sample.html', async (_request, reply) => {
    const nonce = randomBytes(24).toString('base64');
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      "connect-src 'none'",
      "img-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; ');
    // frame-ancestors is deliberately not 'none': the same-origin host embeds this.
    // Isolation depends on the host iframe sandbox='allow-scripts' (no same-origin).
    return reply
      .header('Content-Security-Policy', csp)
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>页面列表插件示例</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;color:#243044}h1{font-size:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head>
<body><h1>受限页面列表插件</h1>
<p data-testid="plugin-status">等待宿主 MessageChannel 连接</p>
<pre data-testid="plugin-pages"></pre>
<p data-testid="plugin-dom-result">父页面 DOM 检查中</p>
<p data-testid="plugin-fetch-result">网络隔离检查中</p>
<script nonce="${nonce}">
'use strict';
${PLUGIN_CLIENT_SOURCE}
const statusNode = document.querySelector('[data-testid="plugin-status"]');
const pagesNode = document.querySelector('[data-testid="plugin-pages"]');
const domNode = document.querySelector('[data-testid="plugin-dom-result"]');
const fetchNode = document.querySelector('[data-testid="plugin-fetch-result"]');
try {
  void parent.document;
  domNode.textContent = 'UNSAFE: parent DOM accessible (missing sandbox)';
} catch (error) {
  domNode.textContent = 'parent DOM blocked: ' + error.name;
}
// Same-origin diagnostic only; CSP prevents even this request from reaching a server.
fetch('/api/workspace').then(function () {
  fetchNode.textContent = 'UNSAFE: fetch allowed (missing CSP)';
}, function (error) {
  fetchNode.textContent = 'fetch blocked by CSP: ' + error.name;
});
connectPlugin(parent, function (sdk) {
  statusNode.textContent = 'MessageChannel connected';
  sdk.request('1', 'pages.list').then(function (pages) {
    if (!Array.isArray(pages) || !pages.every(function (page) {
      return page && typeof page.id === 'string' && typeof page.title === 'string';
    })) throw new Error('Invalid pages.list result');
    pagesNode.textContent = pages.map(function (page) {
      return page.title + ' (' + page.id + ')';
    }).join('\\n');
    statusNode.textContent = 'pages.list complete';
  }).catch(function (error) {
    statusNode.textContent = error.message;
  });
});
</script></body></html>`);
  });
}

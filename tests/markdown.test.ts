import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/plugins/markdown.ts';
test('Markdown supports GFM tables task lists strikethrough and safe highlighted fences', async () => {
  const html = await renderMarkdown(
    '# 中文标题\n\n# 中文标题\n\n| 项目 | 状态 |\n| :--- | ---: |\n| Wiki | **可用** |\n\n- [x] 完成\n- [ ] 待办\n\n~~旧内容~~\n\n```ts\nconst value: string = "<script>";\n```',
  );
  assert.match(html, /id="wiki-中文标题"/);
  assert.match(html, /id="wiki-中文标题-2"/);
  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /disabled/);
  assert.match(html, /<del>旧内容<\/del>/);
  assert.match(html, /hljs-keyword/);
  assert.doesNotMatch(html, /<script>/);
  const plain = await renderMarkdown('```unknown-language\n<script>alert(1)</script>\n```');
  assert.match(plain, /&lt;script&gt;/);
});
test('links and images retain readable meaning without executable navigation or tracking', async () => {
  const html = await renderMarkdown(
    '[外部](https://example.test) [锚点](#标题) [坏](javascript:alert)\n\n![说明](https://tracker.test/a.png)',
  );
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /href="#wiki-标题"/);
  assert.match(html, /图片未加载/);
  assert.doesNotMatch(html, /<img|javascript:|tracker\.test/);
});
test('raw HTML cannot execute scripts, embed content, style or define host identifiers', async () => {
  const html = await renderMarkdown(
    '<script>alert(1)</script><iframe src="https://evil.test"></iframe><svg onload="x"></svg><a href="//evil.test" onclick="x">bad</a><input type="text" value="secret" onfocus="x"><h1 id="root">raw</h1>',
  );
  assert.doesNotMatch(html, /<script|iframe|svg|onclick|onfocus|value="secret"|href="\/\//);
  assert.doesNotMatch(html, /id="root"/);
});

import { test, expect } from '@playwright/test';
test('GFM reading experience renders highlighted code tables tasks anchors and safe links on desktop/mobile', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('Markdown验收');
  await page.getByLabel('邮箱', { exact: true }).fill(`markdown-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('markdown-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  const markdown =
    '# 中文标题\n\n[章节](#中文标题) · [外部](https://example.test)\n\n## 表格与任务\n\n| 功能 | 状态 |\n| :--- | ---: |\n| **Markdown** | 可用 |\n| ~~旧方案~~ | 替换 |\n\n- [x] 安全渲染\n- [ ] 后续完善\n\n```typescript\nconst wiki: string = "Meow <script>";\nconsole.log(wiki);\n```\n\n![图示](https://tracker.invalid/pixel.png)\n\n<script>window.markdownInjected=true</script>';
  await page.getByLabel('Markdown 内容').fill(markdown);
  const body = page.locator('.markdown-body').first();
  await expect(body.locator('table')).toBeVisible();
  await expect(body.locator('.hljs-keyword').first()).toBeVisible();
  await expect(body.locator('input[type=checkbox]')).toHaveCount(2);
  await expect(body.locator('input[type=checkbox]').first()).toBeDisabled();
  await expect(body.locator('a[href="#wiki-中文标题"]').first()).toBeVisible();
  await expect(body.locator('a[href="https://example.test"]')).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await expect(body.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => 'markdownInjected' in window)).toBe(false);
  await page.screenshot({ path: 'artifacts/visual/markdown-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(body.locator('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'artifacts/visual/markdown-mobile.png', fullPage: true });
});

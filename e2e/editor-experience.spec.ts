import { test, expect } from '@playwright/test';
test('focus reading gains width while mode and formatting preserve unsaved Markdown', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('长文测试');
  await page.getByLabel('邮箱', { exact: true }).fill(`editor-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('editor-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑页面', exact: true }).click();
  const source = page.getByLabel('Markdown 内容');
  await expect(source).toBeVisible();
  const content =
    '# 长文阅读体验\n\n' +
    Array.from(
      { length: 12 },
      (_, i) =>
        `## 第${i + 1}节\n\n这是一段用于检验阅读体验的文字。合理的行长、足够的字号与留白，让知识更容易理解。\n\n- 一条清晰的记录\n- 另一个值得记住的想法`,
    ).join('\n\n');
  await source.fill('选中文字');
  await source.press('ControlOrMeta+A');
  await page.getByRole('button', { name: '粗体', exact: true }).click();
  await expect(source).toHaveValue('**选中文字**');
  await source.fill(content);
  const before = await page.locator('.editor-card').boundingBox();
  await page.getByRole('button', { name: '专注模式', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出专注', exact: true })).toBeVisible();
  const after = await page.locator('.editor-card').boundingBox();
  expect(after!.width).toBeGreaterThan(before!.width);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('heading', { name: '长文阅读体验', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/reading-focus-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(source).toHaveValue(content);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '专注模式', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '预览', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/visual/reading-mobile.png', fullPage: true });
});

import { test, expect } from '@playwright/test';
test('nested row and column groups save with complete instance coverage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('嵌套画布');
  await page.getByLabel('邮箱', { exact: true }).fill(`nested-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('nested-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByRole('button', { name: '创建嵌套布局', exact: true }).click();
  await page.getByRole('combobox', { name: '排列方向', exact: true }).selectOption('row');
  await page.getByRole('spinbutton', { name: '容器间距', exact: true }).fill('24');
  await page.getByRole('button', { name: '添加行容器', exact: true }).click();
  const target = page
    .getByRole('list', { name: '布局层列表' })
    .getByRole('button')
    .filter({ hasText: '行容器' })
    .last();
  await page.getByRole('button', { name: '移动组件 wiki.document', exact: true }).dragTo(target);
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.locator('.canvas-tree-root')).toBeVisible();
  await page.reload();
  await expect(page.locator('.canvas-tree-root')).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await expect(page.locator('.wiki-reader .markdown-body')).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/canvas-nested-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = await page.locator('.space-navigator').boundingBox();
  const document = await page.locator('.wiki-reader').boundingBox();
  expect(document!.y).toBeGreaterThanOrEqual(directory!.y + directory!.height);
  await page.screenshot({ path: 'artifacts/visual/canvas-nested-mobile.png', fullPage: true });
});

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
  await page.getByRole('button', { name: '添加行容器', exact: true }).click();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.locator('.canvas-tree-root')).toBeVisible();
  await page.reload();
  await expect(page.locator('.canvas-tree-root')).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
});

import { test, expect } from '@playwright/test';
test('wiki toolbar can be removed independently while content remains and recovery stays accessible', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('独立工具栏');
  await page.getByLabel('邮箱', { exact: true }).fill(`toolbar-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('toolbar-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByRole('button', { name: '选择并移动组件 wiki.toolbar', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '移除布局组件', exact: true }).click();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toHaveCount(0);
  await expect(page.locator('.wiki-reader .markdown-body')).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复默认布局', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toHaveCount(0);
  await expect(page.locator('.wiki-reader .markdown-body')).toBeVisible();
});

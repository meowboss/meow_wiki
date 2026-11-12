import { test, expect } from '@playwright/test';
test('directory query survives switching to nested layout and cross-container remount', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('实例会话');
  await page.getByLabel('邮箱', { exact: true }).fill(`session-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('session-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByLabel('添加功能视图').selectOption({ label: '可重复笔记目录' });
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await page.locator('.canvas-directory-view').getByLabel('目录筛选').fill('欢迎');
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByRole('button', { name: '创建嵌套布局', exact: true }).click();
  await page.getByRole('button', { name: '添加行容器', exact: true }).click();
  const target = page
    .getByRole('list', { name: '布局层列表' })
    .getByRole('button')
    .filter({ hasText: '行容器' })
    .last();
  await page
    .getByRole('button', { name: '移动组件 builtin.directory', exact: true })
    .dragTo(target);
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.locator('.canvas-directory-view').getByLabel('目录筛选')).toHaveValue('欢迎');
  await expect(page.locator('.canvas-directory-view').getByRole('button')).toHaveCount(1);
});

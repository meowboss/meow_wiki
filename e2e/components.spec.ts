import { test, expect } from '@playwright/test';
test('private declarative component can compose and persist its own workspace home', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('组件作者');
  await page.getByLabel('邮箱', { exact: true }).fill(`component-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('component-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  await page.getByRole('button', { name: '我的组件', exact: true }).click();
  await page.getByRole('button', { name: '高级手动创建', exact: true }).click();
  await page.getByLabel('组件名称', { exact: true }).fill('个人知识入口');
  await page.getByLabel('区块文本').fill('# 只属于我的首页\n\n知识在这里生长。');
  await page.getByLabel('当前空间页面列表', { exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: /保存/ }).click();
  await expect(page.getByRole('heading', { name: '个人知识入口' })).toBeVisible();
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByLabel('可添加组件').selectOption({ label: '私有 · 个人知识入口' });
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.getByRole('button', { name: /保存布局/ }).click();
  await expect(page.getByText('首页布局已保存。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '只属于我的首页' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await expect(page.getByRole('heading', { name: '只属于我的首页' })).toBeVisible();
});

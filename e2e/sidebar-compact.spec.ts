import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('compact icon sidebar persists desktop preference and keeps grouped links and avatar settings accessible', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('简略导航');
  await page.getByLabel('邮箱', { exact: true }).fill(`compact-sidebar-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('sidebar-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('button', { name: '个人设置', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-compact/);
  expect((await page.locator('.sidebar').boundingBox())!.width).toBeLessThanOrEqual(80);
  await page.getByRole('button', { name: '选择或管理工作空间', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建工作空间', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '选择或管理工作空间', exact: true }).click();
  await navigate(page, '组件工坊');
  await expect(page.getByRole('region', { name: '对话式组件工坊', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-compact/);
  await navigate(page, '个人设置');
  await expect(page.getByRole('heading', { name: '个人设置', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/sidebar-compact-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).not.toBeInViewport();
  await page.screenshot({ path: 'artifacts/visual/sidebar-compact-mobile.png', fullPage: true });
});

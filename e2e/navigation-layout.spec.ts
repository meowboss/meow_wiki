import { test, expect } from '@playwright/test';
test('larger directory and grouped navigation keep recycle hidden until management opens', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('目录布局');
  await page.getByLabel('邮箱', { exact: true }).fill(`nav-layout-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('nav-layout-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const space = page.locator('.space-navigator');
  await expect(page.getByText(/回收站 ·/)).toBeHidden();
  await page.setViewportSize({ width: 1600, height: 1000 });
  expect((await space.boundingBox())!.width).toBeGreaterThanOrEqual(320);
  await space.getByRole('button', { name: '展开目录', exact: true }).click();
  expect((await space.boundingBox())!.width).toBeGreaterThanOrEqual(420);
  await space.getByRole('tab', { name: '空间管理', exact: true }).click();
  await expect(space.getByText(/回收站 ·/)).toBeVisible();
  await expect(space.getByText('回收站为空', { exact: true })).toBeHidden();
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await nav.locator('summary').filter({ hasText: '组件中心' }).click();
  await nav.getByRole('button', { name: '我的组件', exact: true }).click();
  await expect(page.getByRole('heading', { name: /我的组件/ })).toBeVisible();
  await nav.getByRole('button', { name: '知识空间', exact: true }).click();
  await expect(page.locator('.wiki-reader .markdown-body')).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/navigation-layout-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/navigation-layout-mobile.png', fullPage: true });
});

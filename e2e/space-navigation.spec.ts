import { test, expect } from '@playwright/test';
test('space directory switches notes, overview exposes structure and plugin configuration works in place', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('空间导航');
  await page.getByLabel('邮箱', { exact: true }).fill(`navigation-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('navigation-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const navigator = page.locator('.space-navigator');
  await expect(navigator.getByRole('tab', { name: '笔记目录', exact: true })).toBeVisible();
  await navigator.getByRole('button', { name: '插件与自己的组件', exact: true }).click();
  await expect(page.locator('.wiki-reader-heading h1')).toHaveText('插件与自己的组件');
  await navigator.getByRole('tab', { name: '空间概览', exact: true }).click();
  await expect(navigator.getByText('2', { exact: true }).first()).toBeVisible();
  await navigator.getByRole('tab', { name: '插件配置', exact: true }).click();
  const toggle = navigator.getByRole('switch').last();
  const was = await toggle.getAttribute('aria-checked');
  await toggle.click();
  await expect(navigator.getByRole('switch').last()).toHaveAttribute(
    'aria-checked',
    was === 'true' ? 'false' : 'true',
  );
  await expect(page.locator('.wiki-reader .markdown-body')).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/space-navigation-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await navigator.locator('summary').click();
  await navigator.getByRole('tab', { name: '笔记目录', exact: true }).click();
  await navigator.getByRole('button', { name: '欢迎来到 Meow Wiki', exact: true }).click();
  await expect(page.locator('.wiki-reader-heading h1')).toHaveText('欢迎来到 Meow Wiki');
  await expect(page.locator('.wiki-reader .markdown-body')).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/space-navigation-mobile.png', fullPage: true });
});

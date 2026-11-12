import { test, expect } from '@playwright/test';
test('pending composition response cannot accept edits in a transient default business view', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('加载保护');
  await page.getByLabel('邮箱', { exact: true }).fill(`loading-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('loading-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  let release!: () => void;
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/compositions/wiki?*', async (route) => {
    await proceed;
    await route.continue();
  });
  await page.reload();
  await expect(page.locator('.canvas-business-content').first()).toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: '编辑布局', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await expect(
    page.locator('.canvas-instance[data-view-id="wiki.document"] .canvas-business-content'),
  ).not.toHaveAttribute('inert', '');
});

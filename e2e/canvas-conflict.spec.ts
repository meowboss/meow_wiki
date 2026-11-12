import { test, expect } from '@playwright/test';
test('canvas conflict preserves local draft and requires explicit reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('布局冲突');
  await page.getByLabel('邮箱', { exact: true }).fill(`canvas-conflict-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('conflict-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByRole('button', { name: '添加文本', exact: true }).click();
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('本地布局草稿必须保留');
  await page.route('**/api/compositions/wiki?*', async (route) => {
    if (route.request().method() === 'PUT')
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: '{"error":"conflict"}',
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('当前草稿已保留');
  await expect(page.getByRole('textbox', { name: '文本内容', exact: true })).toHaveValue(
    '本地布局草稿必须保留',
  );
  await expect(page.getByRole('button', { name: '保存布局', exact: true })).toBeDisabled();
});

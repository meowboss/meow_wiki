import { test, expect } from '@playwright/test';
test('layout edit blocks business actions and a failed layout fetch keeps reading available without unsafe overwrite', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('画布保护');
  await page.getByLabel('邮箱', { exact: true }).fill(`canvas-guard-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('guard-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await expect(
    page.locator('.canvas-instance[data-view-id="wiki.document"] .canvas-business-content'),
  ).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: '取消布局编辑', exact: true }).click();
  await page.route('**/api/compositions/wiki?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"test unavailable"}',
    }),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('临时默认布局');
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByRole('button', { name: '添加文本', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存布局', exact: true })).toBeDisabled();
});

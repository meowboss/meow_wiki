import { test, expect } from '@playwright/test';
test('layout draft survives reload and requires explicit scoped recovery', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('草稿恢复');
  await page.getByLabel('邮箱', { exact: true }).fill(`draft-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('draft-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByRole('button', { name: '添加文本', exact: true }).click();
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('刷新仍需保留的布局草稿');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(sessionStorage).some((key) => key.startsWith('meow.canvas.draft:')),
      ),
    )
    .toBe(true);
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.getByRole('button', { name: '恢复布局草稿', exact: true }).click();
  await expect(page.getByText('刷新仍需保留的布局草稿', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await page.reload();
  await expect(page.getByText('刷新仍需保留的布局草稿', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复布局草稿', exact: true })).toHaveCount(0);
});

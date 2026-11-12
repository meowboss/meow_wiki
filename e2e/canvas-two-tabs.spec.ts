import { test, expect } from '@playwright/test';
test('real two-tab canvas CAS preserves losing local draft across reload', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('双标签布局');
  await page.getByLabel('邮箱', { exact: true }).fill(`two-tabs-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('two-tabs-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑布局', exact: true })).toBeEnabled();
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('button', { name: '编辑布局', exact: true })).toBeEnabled();
  for (const [tab, value] of [
    [page, '胜出布局'],
    [other, '冲突草稿'],
  ] as const) {
    await tab.getByRole('button', { name: '编辑布局', exact: true }).click();
    await tab.getByRole('button', { name: '添加文本', exact: true }).click();
    await tab.getByRole('textbox', { name: '文本内容', exact: true }).fill(value);
  }
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑布局', exact: true })).toBeVisible();
  await other.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('当前草稿已保留');
  await expect(other.getByRole('textbox', { name: '文本内容', exact: true })).toHaveValue(
    '冲突草稿',
  );
  other.once('dialog', (d) => d.accept());
  await other.reload();
  await other.getByRole('button', { name: '恢复布局草稿', exact: true }).click();
  await expect(other.getByRole('button', { name: '保存布局', exact: true })).toBeDisabled();
  await expect(other.getByText('冲突草稿', { exact: true })).toBeVisible();
  await other.close({ runBeforeUnload: false });
});

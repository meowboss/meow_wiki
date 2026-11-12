import { test, expect } from '@playwright/test';
test('page package UI exports current pages and imports new identifiers without overwriting editor', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('迁移测试');
  await page.getByLabel('邮箱', { exact: true }).fill(`transfer-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('transfer-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const bundle = await (await page.request.get('/api/pages/export')).json();
  await page.getByRole('button', { name: '编辑页面', exact: true }).click();
  const original = await page.getByLabel('页面标题').inputValue();
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '页面包', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前空间页面包' }).click();
  await (await download).saveAs('test-results/pages-export.json');
  await page.getByRole('textbox', { name: /或粘贴页面包 JSON/ }).fill(JSON.stringify(bundle));
  await page.getByRole('button', { name: '检查并预览标题 / 数量' }).click();
  await page.getByRole('textbox', { name: /输入目标工作空间名称/ }).fill(bundle.workspace.name);
  await page.screenshot({ path: 'artifacts/visual/page-transfer-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/page-transfer-mobile.png', fullPage: true });
  await expect(page.getByRole('button', { name: '以新 ID 追加导入' })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '以新 ID 追加导入' }).click();
  await expect(page.getByText(/已导入 \d+ 个页面/, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(
    page
      .locator('.wiki-reader-heading')
      .getByRole('heading', { name: original, exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: '编辑页面', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue(original);
  const workspace = await (await page.request.get('/api/workspace')).json();
  expect(workspace.pages).toHaveLength(bundle.pages.length * 2);
});

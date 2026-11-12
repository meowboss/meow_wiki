import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('shared canvas persists independent layouts across wiki home and collaboration while isolating business editing', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('画布测试');
  await page.getByLabel('邮箱', { exact: true }).fill(`canvas-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('canvas-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  for (const surface of ['知识空间', '首页', '知识域']) {
    await navigate(page, surface);
    await page.getByRole('button', { name: '编辑布局', exact: true }).click();
    await page.getByRole('button', { name: '添加文本', exact: true }).click();
    await page.getByRole('textbox', { name: '文本内容', exact: true }).fill(`${surface}独立布局`);
    await page.getByRole('button', { name: '向前排列', exact: true }).click();
    await page.getByRole('button', { name: '撤销布局修改', exact: true }).click();
    await page.getByRole('button', { name: '重做布局修改', exact: true }).click();
    await page.getByRole('button', { name: '保存布局', exact: true }).first().click();
    await expect(page.getByRole('button', { name: '编辑布局', exact: true })).toBeVisible();
    await expect(page.getByText(`${surface}独立布局`, { exact: true })).toBeVisible();
  }
  await navigate(page, '知识空间');
  await page.reload();
  await expect(page.getByText('知识空间独立布局', { exact: true })).toBeVisible();
  await expect(page.getByText('首页独立布局', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '编辑页面', exact: true }).click();
  await page.getByLabel('Markdown 内容').fill('待保存正文');
  await expect(page.getByRole('button', { name: '编辑布局', exact: true })).toBeDisabled();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await expect(page.locator('.wiki-reader .markdown-body')).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/canvas-wiki-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/visual/canvas-wiki-mobile.png', fullPage: true });
});

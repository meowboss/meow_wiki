import { test, expect } from '@playwright/test';
test('reviewed plugin runs through isolated iframe and receives only authorized page summaries', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('插件测试');
  await page.getByLabel('邮箱', { exact: true }).fill(`plugin-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('plugin-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '插件实验室', exact: true }).click();
  const iframe = page.getByTitle('受信插件示例沙箱');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const frame = page.frameLocator('iframe[title="受信插件示例沙箱"]');
  await expect(frame.getByTestId('plugin-status')).toHaveText('pages.list complete');
  await expect(frame.getByTestId('plugin-pages')).toContainText('欢迎来到 Meow Wiki');
  await expect(frame.getByTestId('plugin-dom-result')).toContainText('parent DOM blocked');
  await expect(frame.getByTestId('plugin-fetch-result')).toContainText('fetch blocked by CSP');
  await page.screenshot({ path: 'artifacts/visual/plugin-lab-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/plugin-lab-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await expect(iframe).toHaveCount(0);
});

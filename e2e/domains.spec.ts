import { test, expect } from '@playwright/test';
test('create a domain and keep self-authored contribution pending without self-approval', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('域维护者');
  await page.getByLabel('邮箱', { exact: true }).fill(`domain-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('domain-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  await page.getByRole('button', { name: '知识域', exact: true }).click();
  await page.getByRole('button', { name: '创建知识域', exact: true }).click();
  await page.getByLabel('域名称', { exact: true }).fill('项目协作知识');
  await page.getByRole('button', { name: '创建域', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目协作知识', exact: true })).toBeVisible();
  await page.getByLabel('贡献标题', { exact: true }).fill('架构说明');
  await page.getByLabel('贡献内容', { exact: true }).fill('模块化单体，按域授权。');
  await page.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(page.getByText('架构说明', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/domains-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/domains-mobile.png', fullPage: true });
});

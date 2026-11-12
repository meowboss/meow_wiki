import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('user can configure custom Provider without host endpoints and edit metadata without reading back key', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('Provider测试');
  await page.getByLabel('邮箱', { exact: true }).fill(`provider-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('provider-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await navigate(page, '个人设置');
  await expect(page.getByRole('heading', { name: '个人设置', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '模型 Provider', exact: true })).toBeVisible();
  const providerSettings = page.locator('.shared-provider-settings details.provider-settings');
  const openProviderSettings = async () => {
    if (!(await providerSettings.evaluate((el) => (el as HTMLDetailsElement).open)))
      await providerSettings.getByText('Provider 设置', { exact: true }).click();
  };
  await openProviderSettings();
  await page.getByLabel('Provider 名称', { exact: true }).fill('我的模型');
  await page.getByRole('combobox', { name: '供应商', exact: true }).selectOption('custom');
  await page.getByLabel(/Base URL/).fill('http://192.168.1.50:8000/v1');
  await page.getByRole('combobox', { name: /模型名称/ }).fill('my-chat');
  await page.getByLabel('Provider 名称', { exact: true }).fill('x'.repeat(120));
  await expect(page.getByLabel('Provider 名称', { exact: true })).toHaveValue('x'.repeat(100));
  await page.getByLabel('Provider 名称', { exact: true }).fill('我的模型');
  await page.getByRole('combobox', { name: /模型名称/ }).fill('m'.repeat(200));
  await page.getByLabel('API Key', { exact: true }).fill('Bearer bad-key');
  await page.getByRole('button', { name: '保存 Provider', exact: true }).click();
  await expect(page.getByText(/配置未发送：请只粘贴API Key/)).toBeVisible();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('Bearer bad-key');
  await page.getByLabel('API Key', { exact: true }).fill('  browser-test-only-provider-key  ');
  await page.getByRole('button', { name: '保存 Provider', exact: true }).click();
  await openProviderSettings();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '编辑 Provider 我的模型', exact: true }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await page.getByLabel('Provider 名称', { exact: true }).fill('改名后的模型');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await openProviderSettings();
  await expect(page.getByText('改名后的模型', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/provider-settings-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/provider-settings-mobile.png', fullPage: true });
});

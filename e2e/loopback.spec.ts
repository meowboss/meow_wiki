import { test, expect } from '@playwright/test';
test('127.0.0.1 browser can register save reload and logout with canonical localhost auth configuration', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:3029/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('IP访问测试');
  await page.getByLabel('邮箱', { exact: true }).fill(`ip-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('ip-browser-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  await page.getByLabel('页面标题').fill('IP保存正常');
  await page.getByRole('button', { name: '保存页面', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('页面标题')).toHaveValue('IP保存正常');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
});

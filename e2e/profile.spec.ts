import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('personal settings shows real account, saves nickname globally and persists after reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('原始昵称');
  const email = `profile-${Date.now()}@example.test`;
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill('profile-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await navigate(page, '个人设置');
  await expect(page.getByRole('heading', { name: '个人设置', exact: true })).toBeVisible();
  await expect(page.getByLabel('邮箱', { exact: true })).toHaveValue(email);
  await page.getByLabel('昵称', { exact: true }).fill('新的喵喵昵称');
  await page.getByRole('button', { name: '保存昵称', exact: true }).click();
  await expect(page.getByText('昵称已保存。', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/profile-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/profile-mobile.png', fullPage: true });
  await page.reload();
  await navigate(page, '个人设置');
  await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('新的喵喵昵称');
});

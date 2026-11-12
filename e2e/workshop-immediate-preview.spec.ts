import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('selecting a page shows current canvas before chat and workspace visibility is reversible', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('即刻预览');
  await page.getByLabel('邮箱', { exact: true }).fill(`immediate-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('immediate-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await navigate(page, '组件工坊');
  await page.getByRole('combobox', { name: '新建类型', exact: true }).selectOption('page');
  await page.getByRole('combobox', { name: '目标页面', exact: true }).selectOption('wiki');
  await expect(page.getByRole('region', { name: '页面实时预览', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '欢迎来到 Meow Wiki', exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get('/api/workshop/projects')).json();
  expect(me.projects).toHaveLength(0);
  await page.getByRole('button', { name: '隐藏预览工作区', exact: true }).click();
  await expect(page.getByRole('region', { name: '页面实时预览', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '显示预览工作区', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '欢迎来到 Meow Wiki', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/workshop-compact-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/visual/workshop-compact-mobile.png', fullPage: true });
});

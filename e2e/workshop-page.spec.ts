import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('page project previews real canvas, edits source and applies only on explicit confirmation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('页面工坊');
  await page.getByLabel('邮箱', { exact: true }).fill(`page-workshop-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('page-workshop-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const me = await (await page.request.get('/api/auth/me')).json();
  const response = await page.request.post('/api/workshop/page-projects', {
    headers: { 'x-csrf-token': me.csrfToken },
    data: { name: '我的页面工作副本', instruction: '调整页面', surface: 'wiki', fromCurrent: true },
  });
  expect(response.status()).toBe(201);
  const project = await response.json();
  await navigate(page, '组件工坊');
  await page
    .getByRole('combobox', { name: '选择项目', exact: true })
    .selectOption({ label: '我的页面工作副本' });
  await expect(page.getByRole('region', { name: '页面实时预览', exact: true })).toBeVisible();
  await expect(page.locator('.workshop-workspace')).toBeVisible();
  await page.getByRole('tab', { name: '源码', exact: true }).click();
  const content = JSON.parse(project.files['/project/page.json']);
  content.composition.instances.push({
    ...content.composition.instances[0],
    id: 'from-workshop',
    viewId: 'builtin.text',
    y: 9,
    config: { text: '工坊源码真实预览' },
  });
  await page.getByRole('textbox', { name: /page.json/ }).fill(JSON.stringify(content));
  await page.getByRole('button', { name: '保存 JSON', exact: true }).click();
  await page.getByRole('tab', { name: '预览', exact: true }).click();
  await expect(page.getByText('工坊源码真实预览', { exact: true })).toBeVisible();
  const before = await (await page.request.get('/api/compositions/wiki')).json();
  expect(before.instances.some((i: { id: string }) => i.id === 'from-workshop')).toBe(false);
  await page.getByRole('button', { name: '校验页面', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '应用到页面', exact: true }).click();
  await expect(page.getByText('页面已应用。项目文件保存与页面应用是独立操作。')).toBeVisible();
  const after = await (await page.request.get('/api/compositions/wiki')).json();
  expect(after.instances.some((i: { id: string }) => i.id === 'from-workshop')).toBe(true);
  await page.screenshot({ path: 'artifacts/visual/workshop-page-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/workshop-page-mobile.png', fullPage: true });
});

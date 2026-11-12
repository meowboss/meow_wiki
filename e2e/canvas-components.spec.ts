import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('private components become borderless independent canvas instances outside the legacy home list', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('组合实例');
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(`canvas-components-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('components-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const me = await (await page.request.get('/api/auth/me')).json();
  const response = await page.request.post('/api/components', {
    headers: { 'x-csrf-token': me.csrfToken },
    data: {
      name: '独立提示',
      description: '',
      template: '',
      blocks: [{ type: 'markdown', text: '## 独立的画布实例' }],
    },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByLabel('添加画布组件').selectOption({ label: '私有 · 独立提示' });
  await page.getByRole('button', { name: '复制组件', exact: true }).click();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.getByRole('heading', { name: '独立的画布实例', exact: true })).toHaveCount(2);
  await expect(page.locator('.canvas-instance[data-view-id="component.render"]')).toHaveCount(2);
  await navigate(page, '首页');
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByLabel('添加画布组件').selectOption({ label: '私有 · 独立提示' });
  await page.getByRole('button', { name: '保存布局', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '独立的画布实例', exact: true })).toHaveCount(1);
});

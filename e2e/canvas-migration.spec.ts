import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('old home migration is explicit and creates independent instances without altering old layout', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('迁移首页');
  await page.getByLabel('邮箱', { exact: true }).fill(`migration-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('migration-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const me = await (await page.request.get('/api/auth/me')).json();
  const headers = { 'x-csrf-token': me.csrfToken };
  const c = await (
    await page.request.post('/api/components', {
      headers,
      data: { name: '旧首页卡', description: '', template: '# 迁移后的独立组件' },
    })
  ).json();
  const old = await (
    await page.request.put('/api/home', {
      headers,
      data: { title: '旧首页标题', blocks: [{ componentId: c.id }], expectedRevision: 0 },
    })
  ).json();
  await navigate(page, '首页');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '迁移旧首页组件', exact: true }).click();
  await expect(page.getByText('旧首页标题', { exact: true })).toBeVisible();
  await expect(page.locator('.canvas-instance[data-view-id="component.render"]')).toHaveCount(1);
  expect((await (await page.request.get('/api/home')).json()).revision).toBe(old.revision);
});

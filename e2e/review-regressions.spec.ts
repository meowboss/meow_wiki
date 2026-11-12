import { test, expect } from '@playwright/test';
test('renaming a component preserves ordered duplicate blocks and dialogs suppress global search', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('回归测试');
  await page.getByLabel('邮箱', { exact: true }).fill(`review-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('review-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/me')).json();
  const workspace = await (await page.request.get('/api/workspace')).json();
  const blocks = [
    { type: 'search', title: '查找' },
    { type: 'markdown', text: '第一块' },
    { type: 'markdown', text: '第二块' },
    { type: 'page-list', title: '页面' },
  ];
  const created = await (
    await page.request.post(`/api/components?workspaceId=${workspace.workspace.id}`, {
      headers: { 'x-csrf-token': session.csrfToken },
      data: { name: '顺序组件', description: '', template: '', blocks },
    })
  ).json();
  await page.reload();
  await page.getByRole('button', { name: '我的组件', exact: true }).click();
  await page.getByRole('button', { name: '编辑新版本', exact: true }).click();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByLabel('组件名称', { exact: true }).fill('只改名称');
  await page.getByRole('dialog').getByRole('button', { name: /保存/ }).click();
  await expect(page.getByRole('heading', { name: '只改名称' })).toBeVisible();
  const result = await (
    await page.request.get(`/api/workspace?workspaceId=${workspace.workspace.id}`)
  ).json();
  expect(result.components.find((c: { id: string }) => c.id === created.id).blocks).toEqual(blocks);
  await page.evaluate(() => {
    sessionStorage.setItem('meow-knowledge-draft:test', 'private-data');
    sessionStorage.setItem('unrelated-test', 'keep');
  });
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('meow-knowledge-draft:test'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('unrelated-test'))).toBe('keep');
});

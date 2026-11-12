import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('virtual workshop validates declaration and imports private component without a configured model', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('工坊用户');
  await page.getByLabel('邮箱', { exact: true }).fill(`workshop-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('workshop-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await navigate(page, '组件工坊');
  const me = await (await page.request.get('/api/auth/me')).json();
  await page.request.post('/api/workshop/projects', {
    headers: { 'x-csrf-token': me.csrfToken },
    data: { name: '读书组件项目', instruction: '创建可复用读书卡' },
  });
  await page.reload();
  await navigate(page, '组件工坊');
  await page
    .getByRole('combobox', { name: '选择项目', exact: true })
    .selectOption({ label: '读书组件项目' });
  await page.getByText('高级：声明式 JSON 编辑', { exact: true }).click();
  const editor = page
    .getByRole('textbox', { name: /component.json|组件 JSON|JSON 内容|项目文件/ })
    .first();
  await editor.fill(
    JSON.stringify({
      name: '工坊读书卡',
      description: '',
      template: '# 读书',
      blocks: [{ type: 'markdown', text: '# 读书' }],
    }),
  );
  await page.getByRole('button', { name: '保存 JSON', exact: true }).click();
  await page.getByRole('button', { name: '校验组件', exact: true }).click();
  await page.getByRole('button', { name: '保存为私有组件', exact: true }).click();
  await page.screenshot({ path: 'artifacts/visual/workshop-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/workshop-mobile.png', fullPage: true });
  const workspace = await (await page.request.get('/api/workspace')).json();
  expect(
    workspace.components.some(
      (c: { name: string; status: string }) => c.name === '工坊读书卡' && c.status === 'private',
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 720 });
  await navigate(page, '我的组件');
  await expect(page.getByRole('heading', { name: '工坊读书卡', exact: true })).toBeVisible();
});

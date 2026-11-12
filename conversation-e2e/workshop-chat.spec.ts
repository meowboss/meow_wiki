import { test, expect } from '@playwright/test';
test('user and Agent clarify, create, iterate and explicitly save a private component', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('对话验收');
  await page.getByLabel('邮箱', { exact: true }).fill(`chat-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('chat-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  await page.getByRole('button', { name: '我的组件', exact: true }).click();
  await page.getByRole('button', { name: '创建组件', exact: true }).click();
  await expect(page.getByRole('heading', { name: /组件工坊/ })).toBeVisible();
  await page.getByLabel('Provider 名称', { exact: true }).fill('验收模型');
  await page.getByRole('combobox', { name: '模型端点', exact: true }).selectOption('acceptance');
  await page.getByLabel('模型名称', { exact: true }).fill('acceptance-model');
  await page.getByLabel('API Key', { exact: true }).fill('acceptance-test-key');
  await page.getByRole('button', { name: '保存 Provider', exact: true }).click();
  await page.locator('#workshop-message').fill('帮我创建一个组件');
  await page.getByRole('button', { name: '发送并创建组件项目', exact: true }).click();
  await expect(
    page.getByText('你希望组件用于什么场景？例如读书笔记。', { exact: true }),
  ).toBeVisible();
  await page.locator('#workshop-message').fill('用于读书笔记');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(
    page.getByText('读书笔记组件已完成校验，你可以预览并保存为私有组件。', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-message-role="tool"]')).not.toHaveCount(0);
  await page.locator('#workshop-message').fill('增加思考章节');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的思考', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/workshop-chat-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/workshop-chat-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '保存为私有组件', exact: true }).click();
  const workspace = await (await page.request.get('/api/workspace')).json();
  expect(
    workspace.components.some(
      (c: { name: string; status: string }) => c.name === '对话读书卡' && c.status === 'private',
    ),
  ).toBeTruthy();
});

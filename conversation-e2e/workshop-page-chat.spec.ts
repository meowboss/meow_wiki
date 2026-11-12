import { test, expect } from '@playwright/test';
import { navigate } from '../e2e/navigation-helpers';
test('Agent creates page draft through real HTTP tool loop and user explicitly adds navigation page', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('页面创作对话');
  await page.getByLabel('邮箱', { exact: true }).fill(`page-chat-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('page-chat-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const me = await (await page.request.get('/api/auth/me')).json();
  await page.request.post('/api/workshop/providers', {
    headers: { 'x-csrf-token': me.csrfToken },
    data: {
      label: '页面验收模型',
      endpointId: 'acceptance',
      model: 'acceptance-model',
      apiKey: 'acceptance-test-key',
    },
  });
  await navigate(page, '组件工坊');
  await page.getByRole('combobox', { name: '新建类型', exact: true }).selectOption('page');
  await page.getByRole('combobox', { name: '目标页面', exact: true }).selectOption('wiki');
  await page
    .getByRole('combobox', { name: '对话使用的 Provider', exact: true })
    .selectOption({ label: '页面验收模型 · acceptance-model' });
  await page.locator('#workshop-message').fill('创建一个独立页面');
  await page.getByRole('button', { name: '发送并创建组件项目', exact: true }).click();
  await expect(
    page.getByText('页面工作副本已通过校验，请预览后明确保存。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('这是Agent对话生成的独立页面', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/workshop/pages')).json()).pages).toHaveLength(0);
  page.once('dialog', (d) => d.accept('我的Agent页面'));
  await page.getByRole('button', { name: '保存为新页面', exact: true }).click();
  await expect(
    page.getByText('已保存为新页面，可从左侧创作页面打开。', { exact: false }),
  ).toBeVisible();
  const nav = page.getByRole('navigation', { name: '创作页面' });
  await nav.locator('summary').click();
  await nav.getByRole('button', { name: '我的Agent页面', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的Agent页面', exact: true })).toBeVisible();
  await expect(page.getByText('这是Agent对话生成的独立页面', { exact: true })).toBeVisible();
});

import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('MCP credential is displayed once, lists without secret, and revokes immediately', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('Agent用户');
  await page.getByLabel('邮箱', { exact: true }).fill(`mcp-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('mcp-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const me = await (await page.request.get('/api/auth/me')).json();
  const created = await page.request.post('/api/domains', {
    headers: { 'x-csrf-token': me.csrfToken },
    data: { name: 'Agent测试域' },
  });
  expect(created.ok()).toBeTruthy();
  await navigate(page, 'Agent 连接');
  await page
    .getByRole('combobox', { name: '成员域', exact: true })
    .selectOption({ label: 'Agent测试域' });
  await page.getByLabel('凭据名称', { exact: true }).fill('本机测试Agent');
  await page.getByRole('button', { name: '签发只读凭据' }).click();
  const token = await page.getByRole('textbox', { name: '令牌', exact: true }).inputValue();
  expect(token).toMatch(/^meow_mcp_/);
  await page.getByRole('button', { name: '关闭并清除明文' }).click();
  await expect(page.getByRole('textbox', { name: '令牌', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/visual/mcp-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/mcp-mobile.png', fullPage: true });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const denied = await page.request.post('/mcp', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(denied.status()).toBe(401);
});

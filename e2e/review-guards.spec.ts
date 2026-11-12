import { test, expect } from '@playwright/test';
async function signup(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('交互保护');
  await page.getByLabel('邮箱', { exact: true }).fill(`guards-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('guards-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
}
test('revoking an old MCP credential preserves another currently displayed one-time secret', async ({
  page,
}) => {
  await signup(page);
  const me = await (await page.request.get('/api/auth/me')).json();
  await page.request.post('/api/domains', {
    headers: { 'x-csrf-token': me.csrfToken },
    data: { name: '双凭据域' },
  });
  await page.getByRole('button', { name: 'Agent 连接', exact: true }).click();
  await page
    .getByRole('combobox', { name: '成员域', exact: true })
    .selectOption({ label: '双凭据域' });
  await page.getByLabel('凭据名称', { exact: true }).fill('旧凭据A');
  await page.getByRole('button', { name: '签发只读凭据' }).click();
  await expect(page.getByRole('textbox', { name: '令牌', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭并清除明文' }).click();
  await page.getByLabel('凭据名称', { exact: true }).fill('新凭据B');
  await page.getByRole('button', { name: '签发只读凭据' }).click();
  const token = await page.getByRole('textbox', { name: '令牌', exact: true }).inputValue();
  page.once('dialog', (d) => d.accept());
  await page
    .locator('.mcp-credentials li')
    .filter({ has: page.getByText('旧凭据A', { exact: true }) })
    .getByRole('button', { name: '撤销', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: '令牌', exact: true })).toHaveValue(token);
  await page.getByRole('button', { name: '关闭并清除明文' }).click();
});
test('component Escape cancellation asks before discarding local edit', async ({ page }) => {
  await signup(page);
  await page.getByRole('button', { name: '我的组件', exact: true }).click();
  await page.getByRole('button', { name: '高级手动创建', exact: true }).click();
  await page.getByLabel('组件名称', { exact: true }).fill('未保存组件');
  await page.getByRole('textbox', { name: '区块文本', exact: true }).fill('不可误丢的草稿');
  page.once('dialog', (d) => d.dismiss());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '区块文本', exact: true })).toHaveValue(
    '不可误丢的草稿',
  );
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

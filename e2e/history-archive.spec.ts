import { test, expect } from '@playwright/test';
test('history cleanup requires exported snapshot acknowledgement and preserves current page', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('归档测试');
  await page.getByLabel('邮箱', { exact: true }).fill(`archive-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('archive-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  const me = await (await page.request.get('/api/auth/me')).json();
  const workspace = await (await page.request.get('/api/workspace')).json();
  const target = workspace.pages[0];
  for (let revision = 1; revision < 12; revision++) {
    const response = await page.request.put(`/api/pages/${target.id}`, {
      headers: { 'x-csrf-token': me.csrfToken },
      data: { title: target.title, markdown: `历史${revision + 1}`, expectedRevision: revision },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  await page.getByRole('button', { name: /历史/ }).first().click();
  await expect(page.getByRole('button', { name: '永久清理最旧历史' })).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出历史 JSON' }).click();
  await (await download).saveAs('test-results/page-history-export.json');
  await page.getByLabel('我已检查并安全保存导出文件').check();
  await page.getByRole('combobox', { name: /保留最近版本数/ }).selectOption('10');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '永久清理最旧历史' }).click();
  await expect(page.getByText(/历史清理成功/)).toBeVisible();
  const history = await (await page.request.get(`/api/pages/${target.id}/history`)).json();
  expect(history.revisions).toHaveLength(10);
  expect(history.revisions[0].revision).toBe(12);
  await page.screenshot({ path: 'artifacts/visual/history-archive-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/history-archive-mobile.png', fullPage: true });
});

import { test, expect } from '@playwright/test';
test('source processing and honest extractive citations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('资料测试');
  await page.getByLabel('邮箱', { exact: true }).fill(`knowledge-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('knowledge-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '资料工作台', exact: true }).click();
  await page.getByLabel('资料标题', { exact: true }).fill('猫咪百科');
  await page.getByLabel('资料原文', { exact: true }).fill('猫咪需要清洁饮水，也喜欢温暖阳光。');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.getByRole('button', { name: '处理资料', exact: true }).click();
  await page.getByLabel('资料问题', { exact: true }).fill('猫咪');
  await page.getByRole('button', { name: /提问|查找答案|开始问答/ }).click();
  await expect(page.getByText(/清洁饮水/).last()).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/knowledge-desktop.png', fullPage: true });
});

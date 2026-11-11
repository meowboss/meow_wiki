import { test, expect } from '@playwright/test';

test('register, versioned editing, history, deletion recovery and logout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.screenshot({ path: 'artifacts/visual/login-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('浏览器测试');
  await page.getByLabel('邮箱', { exact: true }).fill(`browser-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('browser-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  await page.getByRole('button', { name: '新建页面', exact: true }).last().click();
  await page.getByLabel('页面标题').fill('浏览器版本页面');
  await page.getByLabel('Markdown 内容').fill('# 浏览器验证\n\n第一版内容。');
  await page.getByRole('button', { name: '保存页面', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.getByLabel('Markdown 内容').fill('# 浏览器验证\n\n第二版内容。');
  await page.getByRole('button', { name: '保存页面', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '浏览器版本页面', exact: true }).click();
  await expect(page.getByLabel('Markdown 内容')).toHaveValue(/第二版内容/);
  await expect(
    page.locator('.markdown-body').getByRole('heading', { name: '浏览器验证' }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/editor-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).not.toBeInViewport();
  await expect(
    page.locator('.markdown-body').getByRole('heading', { name: '浏览器验证' }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/editor-mobile.png', fullPage: true });
  await expect(page.getByLabel('页面标题')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: /历史/ }).first().click();
  await expect(page.getByRole('heading', { name: '页面版本历史' })).toBeVisible();
  await page.getByLabel('关闭页面历史').click();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /删除/ }).first().click();
  await page.getByText(/回收站 · 1/).click();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('button', { name: '浏览器版本页面', exact: true }).click();
  await expect(page.getByLabel('Markdown 内容')).toHaveValue(/第二版内容/);
  await page.getByLabel('选择或管理工作空间').click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  await page.getByLabel('工作空间名称').fill('第二个浏览器空间');
  await page.getByRole('dialog').getByRole('button', { name: /创建/ }).click();
  await expect(page.getByLabel('选择或管理工作空间')).toContainText('第二个浏览器空间');
  await expect(page.getByRole('button', { name: '浏览器版本页面', exact: true })).toHaveCount(0);
  await page.getByLabel('选择或管理工作空间').click();
  await page.getByRole('button', { name: /我的喵喵知识花园/ }).click();
  await page.getByRole('button', { name: '浏览器版本页面', exact: true }).click();
  await expect(page.getByLabel('Markdown 内容')).toHaveValue(/第二版内容/);
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

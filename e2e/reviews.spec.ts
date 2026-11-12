import { test, expect } from '@playwright/test';

// The in-memory server cannot be elevated by the host CLI. Admin decisions are
// covered by marketplace API tests; this browser test exercises only real author access.
test('ordinary author submits a pending component without review navigation or market publication', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('待审核组件作者');
  await page.getByLabel('邮箱', { exact: true }).fill(`review-author-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('review-author-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  const sessionResponse = await page.request.get('/api/auth/me');
  expect(sessionResponse.ok()).toBeTruthy();
  expect((await sessionResponse.json()).user.role).toBe('user');
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('button', { name: '组件审核', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: '我的组件', exact: true }).click();
  await page.getByRole('button', { name: '高级手动创建', exact: true }).click();
  const name = '等待审核的知识入口';
  await page.getByLabel('组件名称', { exact: true }).fill(name);
  await page
    .getByLabel('描述', { exact: true })
    .fill('作者私有组件，提交后仍不能作为公开发行版安装。');
  await page
    .getByLabel('区块文本', { exact: true })
    .fill('# 我的待审核知识入口\n\n尚未发布，也能在自己的首页使用。');
  await page.getByLabel('当前空间页面列表', { exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: /保存/ }).click();
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card.getByText('私有草稿 · v1', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(page.getByText('当前版本已提交审核。', { exact: true })).toBeVisible();
  await expect(card.getByText('待审核 · v1', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '提交审核', exact: true })).toBeDisabled();
  await expect(nav.getByRole('button', { name: '组件审核', exact: true })).toHaveCount(0);
  await page.reload();
  await nav.getByRole('button', { name: '我的组件', exact: true }).click();
  await expect(card.getByText('待审核 · v1', { exact: true })).toBeVisible();

  await nav.getByRole('button', { name: '插件市场', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '公开组件发行版 · 0', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '安装组件', exact: true })).toHaveCount(0);
  await expect(page.getByText('审核通过的发行版将在这里显示。', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/market-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: '公开组件发行版 · 0', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/market-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '展开导航', exact: true }).click();
  await expect(nav.getByRole('button', { name: '组件审核', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByLabel('可添加组件', { exact: true }).selectOption({ label: `私有 · ${name}` });
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.getByRole('button', { name: /保存布局/ }).click();
  await expect(page.getByText('首页布局已保存。', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '我的待审核知识入口', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/home-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: 'artifacts/visual/home-desktop.png', fullPage: true });
  await page.reload();
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '我的待审核知识入口', exact: true }),
  ).toBeVisible();
  await expect(nav.getByRole('button', { name: '组件审核', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

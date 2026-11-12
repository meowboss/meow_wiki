import { test, expect } from '@playwright/test';
test('secondary explanations stay discoverable without dominating page content', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('简洁布局');
  await page.getByLabel('邮箱', { exact: true }).fill(`compact-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('compact-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  for (const name of [
    '知识域',
    'Agent 连接',
    '写入提议',
    '资料工作台',
    '插件市场',
    '我的组件',
    '组件工坊',
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('main')).toBeVisible();
    if (name === '知识域') {
      const help = page
        .locator('details')
        .filter({ has: page.locator('summary', { hasText: '使用说明 / 权限说明' }) })
        .first();
      await expect(help).not.toHaveAttribute('open', '');
      await help.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(help).toHaveAttribute('open', '');
      await page.keyboard.press('Enter');
      await expect(help).not.toHaveAttribute('open', '');
    }
    const path = name === '组件工坊' ? 'workshop' : name === '知识域' ? 'domains' : null;
    if (path)
      await page.screenshot({
        path: `artifacts/visual/compact-${path}-desktop.png`,
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/visual/compact-workshop-mobile.png', fullPage: true });
});

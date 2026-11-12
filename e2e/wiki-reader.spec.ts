import { test, expect } from '@playwright/test';
test('wiki opens for reading and explicit editing saves back or cancels without losing published content', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('阅读用户');
  await page.getByLabel('邮箱', { exact: true }).fill(`reader-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('reader-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await expect(page.getByLabel('Markdown 内容')).toHaveCount(0);
  await expect(page.getByLabel('页面标题')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑页面', exact: true }).click();
  await page.getByLabel('页面标题').fill('阅读优先的页面');
  await page
    .getByLabel('Markdown 内容')
    .fill(
      '# 正文内容\n\n打开页面即可阅读，只有需要修改时才进入编辑。\n\n## 小节\n\n- 清晰的工具栏\n- 独立编辑与保存',
    );
  await page.getByRole('button', { name: '保存页面', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await expect(page.getByLabel('Markdown 内容')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '阅读优先的页面', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '正文内容', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/wiki-reader-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '编辑页面', exact: true }).click();
  await page.getByLabel('Markdown 内容').fill('不应保存的内容');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await expect(page.getByLabel('Markdown 内容')).toHaveValue('不应保存的内容');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await expect(page.getByRole('heading', { name: '正文内容', exact: true })).toBeVisible();
  await expect(page.getByText('不应保存的内容', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/visual/wiki-reader-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '正文内容', exact: true })).toBeVisible();
});

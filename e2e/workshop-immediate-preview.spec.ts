import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';
test('selecting a page shows current canvas before chat and workspace visibility is reversible', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('即刻预览');
  await page.getByLabel('邮箱', { exact: true }).fill(`immediate-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('immediate-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await navigate(page, '组件工坊');
  await expect(page.getByRole('region', { name: '对话式组件工坊', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '项目与页面', exact: true }).click();
  await page.getByRole('combobox', { name: '新建类型', exact: true }).selectOption('page');
  await page.getByRole('combobox', { name: '目标页面', exact: true }).selectOption('wiki');
  await page.getByRole('button', { name: '关闭项目菜单', exact: true }).click();
  await expect(page.getByRole('region', { name: '页面实时预览', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '欢迎来到 Meow Wiki', exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get('/api/workshop/projects')).json();
  expect(me.projects).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  const separator = page.getByRole('separator', { name: '调整对话与工作区宽度', exact: true });
  const chat = page.locator('.workshop-workspace-chat');
  const initialWidth = (await chat.boundingBox())!.width;
  const handle = (await separator.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + handle.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(async () => (await chat.boundingBox())!.width).toBeGreaterThan(initialWidth);
  const draggedWidth = (await chat.boundingBox())!.width;
  await separator.focus();
  await separator.press('ArrowLeft');
  await expect.poll(async () => (await chat.boundingBox())!.width).toBeLessThan(draggedWidth);
  const keyboardWidth = (await chat.boundingBox())!.width;
  await separator.press('ArrowRight');
  await expect.poll(async () => (await chat.boundingBox())!.width).toBeGreaterThan(keyboardWidth);
  await separator.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', '30');
  await separator.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', '70');
  await separator.dblclick();
  await expect(separator).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: '隐藏预览工作区', exact: true }).click();
  await expect(page.getByRole('region', { name: '页面实时预览', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '显示预览工作区', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '欢迎来到 Meow Wiki', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/workshop-compact-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: '页面实时预览', exact: true })).toBeHidden();
  await expect(page.getByRole('textbox', { name: '描述需求', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  await page.getByRole('button', { name: '显示预览工作区', exact: true }).click();
  await expect(page.getByRole('region', { name: '页面实时预览', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '欢迎来到 Meow Wiki', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  await page.screenshot({ path: 'artifacts/visual/workshop-compact-mobile.png', fullPage: true });
});

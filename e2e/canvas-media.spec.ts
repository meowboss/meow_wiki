import { test, expect } from '@playwright/test';
test('canvas pet and image asset are interactive persisted instances independent of Markdown', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('媒体画布');
  await page.getByLabel('邮箱', { exact: true }).fill(`media-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('media-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByLabel('添加功能视图').selectOption({ label: '页面桌宠' });
  await page.getByLabel('桌宠字符').fill('🐱');
  await page.getByLabel('组件图层').selectOption('overlay');
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.locator('.canvas-instance[data-view-id="builtin.pet"]')).toBeVisible();
  const pet = page.locator('.canvas-instance[data-view-id="builtin.pet"]');
  await pet.getByRole('button').first().click();
  await expect(pet).toContainText(/你好|喵/);
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByLabel('添加功能视图').selectOption({ label: '图片 / 背景' });
  await page.getByLabel('上传媒体素材').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(page.getByRole('combobox', { name: '媒体素材', exact: true })).not.toHaveValue('');
  await page.getByLabel('图片替代文本').fill('测试背景素材');
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.getByRole('img', { name: '测试背景素材', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: '测试背景素材', exact: true })).toBeVisible();
  await expect(page.locator('.wiki-reader .markdown-body')).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/canvas-media-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/visual/canvas-media-mobile.png', fullPage: true });
});

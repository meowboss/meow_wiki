import { test, expect } from '@playwright/test';
test('keyboard canvas actions remain operable at enlarged display and narrow viewport', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('键盘画布');
  await page.getByLabel('邮箱', { exact: true }).fill(`keyboard-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('keyboard-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const edit = page.getByRole('button', { name: '编辑布局', exact: true });
  await edit.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '添加文本', exact: true }).focus();
  await page.keyboard.press('Enter');
  const text = page.getByRole('textbox', { name: '文本内容', exact: true });
  await text.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Keyboard accessible canvas');
  const move = page.getByRole('button', { name: '选择并移动组件 builtin.text', exact: true });
  await move.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('spinbutton', { name: '横向位置 X', exact: true })).toHaveValue('1');
  const size = page.getByRole('button', { name: '调整组件尺寸 builtin.text', exact: true });
  await size.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('spinbutton', { name: '宽度 W', exact: true })).toHaveValue('7');
  await page.getByRole('button', { name: '向前排列', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '保存布局', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(edit).toBeVisible();
  await expect(page.getByText('Keyboard accessible canvas', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(edit).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '1';
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: '布局属性' })).toBeVisible();
  await page.getByRole('button', { name: '取消布局编辑', exact: true }).focus();
  await page.keyboard.press('Enter');
});

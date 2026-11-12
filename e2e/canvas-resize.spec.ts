import { test, expect } from '@playwright/test';
test('canvas resize keyboard and alignment persist logical dimensions without business editing', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('尺寸控制');
  await page.getByLabel('邮箱', { exact: true }).fill(`resize-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('resize-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByRole('button', { name: '添加文本', exact: true }).click();
  const handle = page.getByRole('button', { name: '调整组件尺寸 builtin.text', exact: true });
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('spinbutton', { name: '宽度 W', exact: true })).toHaveValue('7');
  await page.getByRole('button', { name: '靠右对齐', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '横向位置 X', exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await page.reload();
  const me = await (await page.request.get('/api/compositions/wiki')).json();
  expect(me.instances.find((i: { viewId: string }) => i.viewId === 'builtin.text')).toMatchObject({
    x: 5,
    w: 7,
  });
});

import { test, expect } from '@playwright/test';
import { navigate } from './navigation-helpers';

test('real evidence proposal leaves the page unchanged until explicit browser acceptance', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill('提议作者');
  await page.getByLabel('邮箱', { exact: true }).fill(`proposal-${Date.now()}@example.test`);
  await page.getByLabel('密码', { exact: true }).fill('proposal-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '编辑页面', exact: true }).click();
  const originalTitle = await page.getByLabel('页面标题').inputValue();
  const originalMarkdown = await page.getByLabel('Markdown 内容').inputValue();
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  const sessionResponse = await page.request.get('/api/auth/me');
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  expect(session.csrfToken).toBeTruthy();
  const workspaceResponse = await page.request.get('/api/workspace');
  expect(workspaceResponse.ok()).toBeTruthy();
  const workspace = await workspaceResponse.json();
  const target = workspace.pages.find((item: { title: string }) => item.title === originalTitle);
  expect(target).toBeTruthy();
  const scope = `?workspaceId=${workspace.workspace.id}`;
  const headers = { 'X-CSRF-Token': session.csrfToken };

  // Only evidence preparation uses the API; proposal submission and acceptance use real UI.
  const sourceResponse = await page.request.post(`/api/sources${scope}`, {
    headers,
    data: { title: '猫咪饮水资料', content: '猫咪需要每日更换清洁饮水，饮水碗也应定期清洁。' },
  });
  expect(sourceResponse.status()).toBe(201);
  const source = await sourceResponse.json();
  const processResponse = await page.request.post(`/api/sources/${source.id}/process${scope}`, {
    headers,
  });
  expect(processResponse.ok()).toBeTruthy();
  expect((await processResponse.json()).status).toBe('ready');
  const answerResponse = await page.request.post(`/api/knowledge/ask${scope}`, {
    headers,
    data: { question: '猫咪', mode: 'extractive' },
  });
  expect(answerResponse.ok()).toBeTruthy();
  const answer = await answerResponse.json();
  expect(answer.mode).toBe('local-extractive');
  expect(answer.sources.length).toBeGreaterThan(0);
  const { sourceId, revision, chunkId } = answer.sources[0];
  expect(sourceId).toBe(source.id);
  expect(chunkId).toBeTruthy();
  const evidence = [{ sourceId, revision, chunkId }];
  const title = '猫咪饮水照护提议';
  const markdown = '# 猫咪饮水照护\n\n每日更换清洁饮水，并定期清洁饮水碗。';

  await navigate(page, '写入提议');
  await page.getByRole('combobox', { name: '目标页面', exact: true }).selectOption(target.id);
  await page.getByLabel('拟议标题', { exact: true }).fill(title);
  await page
    .getByRole('textbox', { name: '拟议正文（Markdown 原文）', exact: true })
    .fill(markdown);
  await page
    .getByRole('textbox', { name: '证据引用 JSON（1–8 条）', exact: true })
    .fill(JSON.stringify(evidence, null, 2));
  await page.getByRole('button', { name: '提交提议（不改正文）', exact: true }).click();
  await expect(
    page.getByText('提议已提交，页面正文没有改变。请在列表中核对后明确接受或拒绝。'),
  ).toBeVisible();
  const proposal = page
    .getByRole('article')
    .filter({ has: page.getByText(title, { exact: true }) });
  await expect(proposal.getByText('待处理', { exact: true })).toBeVisible();
  await proposal.getByText('核对当前 / 拟议纯文本及证据', { exact: true }).click();
  await expect(proposal.getByRole('region', { name: '当前页面纯文本' })).toContainText(
    originalMarkdown,
  );
  await expect(proposal.getByRole('region', { name: '拟议页面纯文本' })).toContainText(markdown);
  const unchangedResponse = await page.request.get(`/api/workspace${scope}`);
  expect(unchangedResponse.ok()).toBeTruthy();
  const unchanged = (await unchangedResponse.json()).pages.find(
    (item: { id: string }) => item.id === target.id,
  );
  expect(unchanged).toMatchObject({
    title: originalTitle,
    markdown: originalMarkdown,
    revision: target.revision,
  });
  await page.screenshot({ path: 'artifacts/visual/proposals-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('拟议标题', { exact: true })).toBeVisible();
  await expect(
    proposal.getByRole('button', { name: '接受并应用到正文', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/visual/proposals-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('替换目标页面，并创建新版本');
    await dialog.accept();
  });
  await proposal.getByRole('button', { name: '接受并应用到正文', exact: true }).click();
  await expect(proposal.getByText('已接受', { exact: true })).toBeVisible();
  await expect(proposal.getByRole('button', { name: '接受并应用到正文', exact: true })).toHaveCount(
    0,
  );
  await navigate(page, '知识空间');
  await page.locator('.space-navigator').getByRole('button', { name: title, exact: true }).click();
  await expect(
    page
      .locator('.wiki-reader-heading')
      .getByRole('heading', { name: title, exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: '编辑页面', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue(title);
  await expect(page.getByLabel('Markdown 内容')).toHaveValue(markdown);
  await expect(page.locator('.document-tag')).toHaveText(`Markdown · v${target.revision + 1}`);
  await page.reload();
  await navigate(page, '知识空间');
  await page.locator('.space-navigator').getByRole('button', { name: title, exact: true }).click();
  await expect(
    page
      .locator('.wiki-reader-heading')
      .getByRole('heading', { name: title, exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: '编辑页面', exact: true }).click();
  await expect(page.getByLabel('Markdown 内容')).toHaveValue(markdown);
  expect(errors).toEqual([]);
});

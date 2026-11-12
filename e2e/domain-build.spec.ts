import { test, expect, type Page, type APIResponse, type Response } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Domain, DomainContribution, SessionInfo } from '../web/shared/api';

async function json<T>(response: APIResponse | Response, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function register(page: Page, name: string, email: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('你的名字').fill(name);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill('domain-build-password-123');
  await page.getByRole('button', { name: '创建我的知识花园' }).click();
  await expect(page.getByRole('button', { name: '编辑页面', exact: true })).toBeVisible();
  return json<SessionInfo>(await page.request.get('/api/auth/me'));
}

async function openDomain(page: Page, name: string) {
  await page.getByRole('button', { name: '知识域', exact: true }).click();
  await page
    .getByRole('complementary', { name: '我的成员域' })
    .getByRole('button', { name: new RegExp(name) })
    .click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '加载最新域', exact: true })).toBeEnabled();
}

test('author builds published evidence in UI and a UI-issued MCP grant only submits pending snapshots', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const authorContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const client = new Client({ name: 'domain-build-e2e', version: '1.0.0' });
  try {
    const owner = await ownerContext.newPage();
    const author = await authorContext.newPage();
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const ownerSession = await register(
      owner,
      '构建域所有者',
      `build-owner-${suffix}@example.test`,
    );
    const authorEmail = `build-author-${suffix}@example.test`;
    const authorSession = await register(author, '构建贡献者', authorEmail);
    expect(ownerSession.user!.id).not.toBe(authorSession.user!.id);
    const ownerHeaders = { 'x-csrf-token': ownerSession.csrfToken };
    const authorHeaders = { 'x-csrf-token': authorSession.csrfToken };
    const domainName = '项目构建验收域';

    // Prepare through the same authenticated public endpoints used by the UI, not Store/DB hooks.
    const domain = await json<Domain>(
      await owner.request.post('/api/domains', {
        headers: ownerHeaders,
        data: {
          name: domainName,
          description: '已发布证据的确定性汇编验收',
          buildProfile: 'project',
        },
      }),
      201,
    );
    const base = `/api/domains/${domain.id}`;
    await json(
      await owner.request.post(`${base}/members`, {
        headers: ownerHeaders,
        data: { email: authorEmail, role: 'contributor' },
      }),
    );
    const source = await json<DomainContribution>(
      await author.request.post(`${base}/contributions`, {
        headers: authorHeaders,
        data: {
          title: '架构证据',
          content: '模块化单体，模块通过公开接口协作。',
          expectedDomainRevision: domain.revision,
        },
      }),
      201,
    );
    expect(source.status).toBe('pending');
    expect(source.authorId).toBe(authorSession.user!.id);
    await json(
      await owner.request.post(`${base}/contributions/${source.id}/review`, {
        headers: ownerHeaders,
        data: { decision: 'published', reason: '所有者核对作者的来源证据' },
      }),
    );
    const publishedDomain = await json<Domain>(await author.request.get(base));
    expect(publishedDomain.revision).toBe(domain.revision + 1);
    const prepared = await json<{ contributions: DomainContribution[] }>(
      await author.request.get(`${base}/contributions`),
    );
    expect(prepared.contributions.find((item) => item.id === source.id)).toMatchObject({
      status: 'published',
      authorId: authorSession.user!.id,
      reviewerId: ownerSession.user!.id,
    });

    await openDomain(author, domainName);
    const buildForm = author.getByRole('form', { name: '确定性资料汇编', exact: true });
    await expect(
      buildForm.getByRole('heading', { name: '确定性资料汇编（非 LLM）', exact: true }),
    ).toBeVisible();
    await expect(buildForm).toContainText('未调用语言模型');
    await expect(buildForm).toContainText('不会自动发布');
    const buildButton = buildForm.getByRole('button', {
      name: '确定性汇编并提交待审（非 LLM）',
      exact: true,
    });
    await expect(buildButton).toBeDisabled();
    await buildForm.getByLabel('构建标题', { exact: true }).fill('项目架构总览');
    await expect(buildButton).toBeDisabled();
    await buildForm.getByRole('checkbox', { name: '架构证据（已发布）', exact: true }).check();
    await expect(buildForm).toContainText('已选 1/10');
    const buildResponse = author.waitForResponse(
      (response) =>
        response.url().includes(`${base}/build`) && response.request().method() === 'POST',
    );
    await buildButton.click();
    const built = await json<{
      mode: string;
      contribution: DomainContribution;
      provenance: { domainRevision: number; profile: string; contributionIds: string[] };
    }>(await buildResponse, 201);
    expect(built.mode).toBe('deterministic-compilation');
    expect(built.provenance).toEqual({
      domainRevision: publishedDomain.revision,
      profile: 'project',
      contributionIds: [source.id],
    });
    expect(built.contribution).toMatchObject({
      status: 'pending',
      authorId: authorSession.user!.id,
      reviewerId: null,
    });
    expect(built.contribution.content).toContain('未调用语言模型');
    expect(built.contribution.content).toContain('## 架构与模块');
    expect(built.contribution.content).toContain(source.id);
    expect(built.contribution.content).toContain(source.content);
    await expect(author.getByRole('status')).toHaveText(
      '确定性汇编已生成待审核贡献“项目架构总览”（非 LLM），尚未发布，须由其他维护者审核。',
    );
    const buildArticle = author
      .getByRole('article')
      .filter({ has: author.getByRole('heading', { name: '项目架构总览', exact: true }) });
    await expect(buildArticle).toContainText('待审核');
    await expect(buildArticle.getByRole('button', { name: '审核并发布', exact: true })).toHaveCount(
      0,
    );
    expect((await json<Domain>(await author.request.get(base))).revision).toBe(
      publishedDomain.revision,
    );

    await author.getByRole('button', { name: 'Agent 连接', exact: true }).click();
    await author.getByRole('combobox', { name: '成员域', exact: true }).selectOption(domain.id);
    await author
      .getByRole('combobox', { name: '权限范围（scope）', exact: true })
      .selectOption('domain.contribute');
    await author.getByLabel('凭据名称', { exact: true }).fill('构建验收待审 Agent');
    await author.getByRole('button', { name: '签发待审贡献凭据', exact: true }).click();
    const token = await author.getByRole('textbox', { name: '令牌', exact: true }).inputValue();
    expect(token.startsWith('meow_mcp_')).toBeTruthy();
    await author.getByRole('button', { name: '关闭并清除明文', exact: true }).click();
    await expect(author.getByRole('textbox', { name: '令牌', exact: true })).toHaveCount(0);
    await expect(author.getByRole('region', { name: '一次性令牌', exact: true })).toHaveCount(0);

    // A real SDK Streamable HTTP client: no mocked routes, injection or in-process MCP server.
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', baseURL!), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toEqual([
      'domain_info',
      'list_publications',
      'read_contribution',
      'search_knowledge',
      'submit_contribution',
    ]);
    const submittedResult = await client.callTool({
      name: 'submit_contribution',
      arguments: {
        title: 'Agent 待审补充',
        content: 'Agent 仅提交独立快照，不能发布。',
        expectedDomainRevision: publishedDomain.revision,
      },
    });
    expect(submittedResult.isError).not.toBe(true);
    expect(Array.isArray(submittedResult.content)).toBeTruthy();
    const text = (submittedResult.content as { type: string; text?: string }[]).find(
      (item) => item.type === 'text',
    );
    expect(text?.text).toBeTruthy();
    const submitted = JSON.parse(text!.text!) as DomainContribution;
    expect(submitted).toMatchObject({
      status: 'pending',
      domainId: domain.id,
      authorId: authorSession.user!.id,
      reviewerId: null,
    });
    for (const name of ['review_contribution', 'publish_contribution']) {
      const denied = await client.callTool({
        name,
        arguments: { id: submitted.id, decision: 'published' },
      });
      expect(denied.isError).toBe(true);
    }
    const hidden = await client.callTool({
      name: 'read_contribution',
      arguments: { id: submitted.id },
    });
    expect(hidden.isError).toBe(true);
    const afterSubmit = await json<{ contributions: DomainContribution[] }>(
      await owner.request.get(`${base}/contributions`),
    );
    expect(afterSubmit.contributions).toHaveLength(3);
    for (const id of [built.contribution.id, submitted.id]) {
      expect(afterSubmit.contributions.find((item) => item.id === id)).toMatchObject({
        status: 'pending',
        reviewerId: null,
      });
    }
    expect((await json<Domain>(await owner.request.get(base))).revision).toBe(
      publishedDomain.revision,
    );

    // Capture the actual build UI only after clearing the one-time credential plaintext.
    await openDomain(author, domainName);
    await expect(author.getByRole('textbox', { name: '令牌', exact: true })).toHaveCount(0);
    await expect(
      author
        .getByRole('article')
        .filter({ has: author.getByRole('heading', { name: 'Agent 待审补充', exact: true }) }),
    ).toContainText('待审核');
    await author.screenshot({ path: 'artifacts/visual/domain-build-desktop.png', fullPage: true });
    await author.setViewportSize({ width: 390, height: 844 });
    await author.screenshot({ path: 'artifacts/visual/domain-build-mobile.png', fullPage: true });

    // Only an explicit review by a different human principal advances the domain revision.
    await openDomain(owner, domainName);
    const ownerBuild = owner
      .getByRole('article')
      .filter({ has: owner.getByRole('heading', { name: '项目架构总览', exact: true }) });
    await ownerBuild.getByLabel('审核说明', { exact: true }).fill('所有者人工核对汇编来源');
    owner.once('dialog', (dialog) => dialog.accept());
    await ownerBuild.getByRole('button', { name: '审核并发布', exact: true }).click();
    await expect(ownerBuild).toContainText('已发布');
    const finalDomain = await json<Domain>(await owner.request.get(base));
    expect(finalDomain.revision).toBe(publishedDomain.revision + 1);
    const final = await json<{ contributions: DomainContribution[] }>(
      await owner.request.get(`${base}/contributions`),
    );
    expect(final.contributions.find((item) => item.id === built.contribution.id)).toMatchObject({
      status: 'published',
      reviewerId: ownerSession.user!.id,
    });
    expect(final.contributions.find((item) => item.id === submitted.id)).toMatchObject({
      status: 'pending',
      reviewerId: null,
    });
  } finally {
    await client.close();
    await authorContext.close();
    await ownerContext.close();
  }
});

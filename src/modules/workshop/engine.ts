import { z } from 'zod';
import type { ProviderVault } from './providers.ts';
import type { WorkshopProjects } from './projects.ts';
const command = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('read_file'), path: z.string().max(100) }).strict(),
  z
    .object({
      tool: z.literal('write_file'),
      path: z.string().max(100),
      content: z.string().max(30000),
    })
    .strict(),
  z.object({ tool: z.literal('validate_component') }).strict(),
  z.object({ tool: z.literal('finish') }).strict(),
]);
export class WorkshopError extends Error {
  constructor(
    message: string,
    public statusCode = 409,
  ) {
    super(message);
  }
}
/** Bounded tool loop over virtual files, never a shell/OS sandbox or arbitrary code executor. */
export class WorkshopEngine {
  private running = new Map<string, { owner: string; controller: AbortController }>();
  cancel(owner: string, projectId: string) {
    this.projects.get(owner, projectId);
    const run = this.running.get(projectId);
    if (!run || run.owner !== owner) throw new WorkshopError('项目当前没有可取消的运行');
    run.controller.abort();
    return { requested: true };
  }
  constructor(
    private projects: WorkshopProjects,
    private providers: ProviderVault,
    private fetcher: typeof fetch = fetch,
  ) {}
  async run(owner: string, projectId: string, providerId: string) {
    if (this.running.has(projectId) || this.running.size >= 2)
      throw new WorkshopError('工坊任务正在运行或实例并发已满');
    const project = this.projects.get(owner, projectId);
    const profile = this.providers.resolve(owner, providerId);
    const controller = new AbortController();
    this.running.set(projectId, { owner, controller });
    const messages: { role: string; content: string }[] = [
      {
        role: 'system',
        content:
          '你是声明式Wiki组件开发agent。每轮只输出一个JSON对象，不要markdown围栏。工具：{"tool":"read_file","path":"/sdk/README.md"}，{"tool":"write_file","path":"/project/component.json","content":"JSON字符串"}，{"tool":"validate_component"}，{"tool":"finish"}。只能使用虚拟允许文件，不得请求shell、网络、密钥或宿主文件。先读SDK，完成合法组件后validate再finish。',
      },
      { role: 'user', content: project.instruction },
    ];
    let iteration = 0;
    try {
      if (containsSecret(project.instruction, profile.apiKey))
        throw new WorkshopError('需求包含当前Provider凭据，已阻止发送');
      this.projects.setRunState(owner, projectId, 'running', 0, null);
      for (iteration = 1; iteration <= 8; iteration++) {
        controller.signal.throwIfAborted();
        if (containsSecret(JSON.stringify(messages), profile.apiKey))
          throw new WorkshopError('开发上下文包含当前Provider凭据，已阻止发送');
        const response = await this.fetcher(
          profile.endpoint.replace(/\/$/, '') + '/chat/completions',
          {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${profile.apiKey}`,
            },
            body: JSON.stringify({
              model: profile.model,
              max_tokens: 4000,
              temperature: 0.1,
              messages,
            }),
          },
        );
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new WorkshopError('Provider拒绝请求，请检查配置或额度', 502);
        }
        const text = await readBounded(response);
        const raw = z
          .object({
            choices: z
              .array(z.object({ message: z.object({ content: z.string().max(40000) }) }))
              .min(1),
          })
          .parse(JSON.parse(text)).choices[0].message.content;
        // Never persist/raw-log model text; it may contain hostile content or accidentally echo credentials.
        if (raw.includes(profile.apiKey))
          throw new WorkshopError('Provider响应包含敏感凭据，已丢弃', 502);
        const action = command.parse(JSON.parse(raw));
        const normalized = JSON.stringify(action);
        if (
          normalized.includes(profile.apiKey) ||
          (action.tool === 'write_file' && containsSecret(action.content, profile.apiKey))
        )
          throw new WorkshopError('Provider响应包含敏感凭据，已丢弃', 502);
        messages.push({ role: 'assistant', content: raw });
        let result: unknown;
        if (action.tool === 'read_file')
          result = this.projects.readFile(owner, projectId, action.path);
        else if (action.tool === 'write_file') {
          this.projects.writeFile(owner, projectId, action.path, action.content, true);
          result = { written: true };
        } else if (action.tool === 'validate_component')
          result = this.projects.validate(owner, projectId);
        else {
          const check = this.projects.validate(owner, projectId);
          if (!check.valid) throw new WorkshopError('模型结束时组件验证未通过');
          this.projects.setRunState(owner, projectId, 'ready', iteration, null);
          return this.projects.get(owner, projectId);
        }
        if (
          containsSecret(
            typeof result === 'string' ? result : JSON.stringify(result),
            profile.apiKey,
          )
        )
          throw new WorkshopError('工具结果包含当前Provider凭据，已阻止进入上下文');
        controller.signal.throwIfAborted();
        messages.push({
          role: 'user',
          content: `工具结果：${JSON.stringify(result).slice(0, 32000)}`,
        });
        this.projects.setRunState(owner, projectId, 'running', iteration, null);
        if (JSON.stringify(messages).length > 100_000)
          throw new WorkshopError('开发上下文超出预算');
      }
      throw new WorkshopError('达到8轮工具预算，未自动安装产物');
    } catch (error) {
      const status = controller.signal.aborted
        ? 409
        : error instanceof WorkshopError
          ? error.statusCode
          : 502;
      const message = controller.signal.aborted
        ? '运行已由用户取消，产物未自动导入'
        : error instanceof WorkshopError
          ? error.message
          : '开发循环失败，已停止；请检查Provider协议或工具请求';
      this.projects.setRunState(owner, projectId, 'failed', Math.min(iteration, 8), message);
      throw new WorkshopError(message, status);
    } finally {
      this.running.delete(projectId);
    }
  }
}
function containsSecret(content: string, secret: string): boolean {
  function inspect(value: unknown, depth: number): boolean {
    if (depth > 6) return false;
    if (typeof value === 'string') {
      if (value.includes(secret)) return true;
      try {
        return inspect(JSON.parse(value), depth + 1);
      } catch {
        return false;
      }
    }
    if (Array.isArray(value)) return value.some((item) => inspect(item, depth + 1));
    if (value && typeof value === 'object')
      return Object.entries(value).some(
        ([key, item]) => key.includes(secret) || inspect(item, depth + 1),
      );
    return false;
  }
  return inspect(content, 0);
}
async function readBounded(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new WorkshopError('Provider响应为空', 502);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 128000) throw new WorkshopError('Provider响应超出限制', 502);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

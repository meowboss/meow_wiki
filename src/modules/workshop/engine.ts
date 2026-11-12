import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ProviderVault } from './providers.ts';
import { safeProviderFetch } from './provider-network.ts';
import type { WorkshopProjects } from './projects.ts';
import { buildWorkshopMessages } from './agent-definition.ts';
import {
  conversationDetailsSchema,
  type ConversationDetails,
  type ConversationStore,
  type ConversationMessage,
} from './conversation.ts';
const allowedPath = conversationDetailsSchema.shape.path;
function fileDetails(content: string): ConversationDetails {
  return {
    bytes: Buffer.byteLength(content, 'utf8'),
    lines: content.length ? content.split('\n').length : 0,
  };
}
function validationDetails(value: unknown): ConversationDetails {
  // Only the project's schema-derived validation result may reach this projection.
  const parsed = z
    .discriminatedUnion('valid', [
      z.object({ valid: z.literal(true) }).strict(),
      z.object({ valid: z.literal(false), issues: z.array(z.string()) }).strict(),
    ])
    .parse(value);
  return {
    valid: parsed.valid,
    ...(!parsed.valid
      ? {
          issues: parsed.issues
            .slice(0, 8)
            .map((issue) => issue.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160)),
        }
      : {}),
  };
}
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
  z.object({ tool: z.literal('validate_project') }).strict(),
  z.object({ tool: z.literal('ask_user'), message: z.string().trim().min(1).max(3000) }).strict(),
  z.object({ tool: z.literal('finish'), message: z.string().max(3000).optional() }).strict(),
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
    private conversation?: ConversationStore,
  ) {}
  async run(owner: string, projectId: string, providerId: string) {
    return this.execute(owner, projectId, providerId);
  }
  async chat(owner: string, projectId: string, providerId: string, message: string) {
    if (!this.conversation) throw new WorkshopError('Conversation storage is unavailable', 503);
    const parsed = z.string().trim().min(1).max(3000).safeParse(message);
    if (!parsed.success) throw new WorkshopError('Invalid chat message', 400);
    const project = await this.execute(owner, projectId, providerId, parsed.data);
    return { project, messages: this.conversation.list(owner, projectId) };
  }
  private async execute(
    owner: string,
    projectId: string,
    providerId: string,
    userMessage?: string,
  ) {
    const project = this.projects.get(owner, projectId);
    if (this.running.has(projectId) || this.running.size >= 2)
      throw new WorkshopError('工坊任务正在运行或实例并发已满');
    const profile = this.providers.resolve(owner, providerId);
    // Resolve and inspect before persisting user text. No fallback provider or fake AI.
    if (containsSecret(userMessage ?? project.instruction, profile.apiKey))
      throw new WorkshopError('需求包含当前Provider凭据，已阻止发送');
    const history = this.conversation?.list(owner, projectId) ?? [];
    if (
      userMessage !== undefined &&
      containsSecret(JSON.stringify({ project, history }), profile.apiKey)
    )
      throw new WorkshopError('开发上下文包含当前Provider凭据，已阻止发送');
    this.projects.claimRun(owner, projectId);
    const controller = new AbortController();
    this.running.set(projectId, { owner, controller });
    const runId = randomUUID();
    let iteration = 0;
    let callId: string | undefined;
    const record = (
      role: ConversationMessage['role'],
      content: string,
      status?: ConversationMessage['status'],
      details?: ConversationDetails,
    ) => {
      if (containsSecret(content, profile.apiKey)) return;
      if (details && containsSecret(JSON.stringify(details), profile.apiKey))
        details = { summary: '工具详情包含敏感信息，已隐藏' };
      return this.conversation?.append(owner, projectId, {
        role,
        content,
        status,
        ...(details === undefined ? {} : { details }),
        runId,
        turn: iteration,
        ...(role === 'tool' && callId ? { callId } : {}),
      });
    };
    const messages = buildWorkshopMessages({ project, history, userMessage });
    const subject = project.kind === 'page' ? '页面' : '组件';
    let activeTool: string | undefined;
    let toolStartedAt = 0;
    const duration = () => Math.min(300000, Math.max(0, Date.now() - toolStartedAt));
    try {
      record('user', userMessage ?? project.instruction);
      this.projects.setRunState(owner, projectId, 'running', 0, null);
      for (iteration = 1; iteration <= 8; iteration++) {
        controller.signal.throwIfAborted();
        if (containsSecret(JSON.stringify(messages), profile.apiKey))
          throw new WorkshopError('开发上下文包含当前Provider凭据，已阻止发送');
        const response = await (profile.custom ? safeProviderFetch : this.fetcher)(
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
        controller.signal.throwIfAborted(); // Cancellation can race the final response chunk.
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
          containsSecret(normalized, profile.apiKey) ||
          (action.tool === 'write_file' && containsSecret(action.content, profile.apiKey))
        )
          throw new WorkshopError('Provider响应包含敏感凭据，已丢弃', 502);
        messages.push({ role: 'assistant', content: raw });
        activeTool = action.tool;
        callId = randomUUID();
        toolStartedAt = Date.now();
        const path = 'path' in action ? allowedPath.safeParse(action.path) : undefined;
        const startedDetails: ConversationDetails = {
          ...(path?.success ? { path: path.data } : {}),
          ...(action.tool === 'write_file' ? fileDetails(action.content) : {}),
        };
        record('tool', action.tool, 'started', startedDetails);
        if (action.tool === 'ask_user') {
          record('tool', action.tool, 'completed', {
            durationMs: duration(),
            summary: '等待用户补充需求',
          });
          activeTool = undefined;
          record('assistant', action.message, 'question');
          return this.projects.setRunState(owner, projectId, 'draft', iteration, null);
        }
        let result: unknown;
        let completedDetails: ConversationDetails = { ...startedDetails };
        if (action.tool === 'read_file') {
          result = this.projects.readFile(owner, projectId, action.path);
          completedDetails = { ...startedDetails, ...fileDetails(result as string) };
        } else if (action.tool === 'write_file') {
          this.projects.writeFile(owner, projectId, action.path, action.content, true);
          result = { written: true };
        } else if (action.tool === 'validate_component' || action.tool === 'validate_project') {
          result = this.projects.validate(owner, projectId);
          completedDetails = validationDetails(result);
        } else {
          const check = this.projects.validate(owner, projectId);
          if (!check.valid) throw new WorkshopError(`模型结束时${subject}验证未通过`);
          record('tool', action.tool, 'completed', {
            ...validationDetails(check),
            durationMs: duration(),
            summary: `${subject}已通过验证，等待确认导入`,
          });
          activeTool = undefined;
          record(
            'assistant',
            action.message ?? `${subject}已完成并通过验证，等待确认导入。`,
            'completed',
          );
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
        record('tool', action.tool, 'completed', { ...completedDetails, durationMs: duration() });
        activeTool = undefined;
        messages.push({
          role: 'user',
          content: `工具结果：${JSON.stringify(result).slice(0, 32000)}`,
        });
        this.projects.setRunState(owner, projectId, 'running', iteration, null);
        if (JSON.stringify(messages).length > (userMessage === undefined ? 100_000 : 400_000))
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
      if (activeTool)
        record('tool', activeTool, 'failed', {
          durationMs: duration(),
          summary: '工具执行失败，已停止',
        });
      record('assistant', message, controller.signal.aborted ? 'cancelled' : 'error');
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

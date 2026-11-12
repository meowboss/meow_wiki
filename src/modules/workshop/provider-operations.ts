import { z } from 'zod';
import type { ProviderVault } from './providers.ts';
import { ProviderNetwork, normalizeProviderEndpoint } from './provider-network.ts';
export const providerOperationSchema = z
  .object({
    vendor: z.enum(['openai', 'deepseek', 'custom']),
    baseURL: z.string().min(1).max(2000),
    apiKey: z.string().max(500).optional(),
    model: z.string().max(100).optional(),
    providerId: z.string().uuid().optional(),
  })
  .strict();
export class ProviderOperations {
  constructor(
    private vault: ProviderVault,
    private network = new ProviderNetwork(),
  ) {}
  private resolve(owner: string, input: z.infer<typeof providerOperationSchema>) {
    let endpoint: string;
    try {
      endpoint = normalizeProviderEndpoint(input.baseURL);
    } catch {
      throw Object.assign(new Error('API地址必须为不含凭据或查询参数的HTTPS地址'), {
        statusCode: 400,
      });
    }
    if (input.apiKey?.trim()) return { endpoint, apiKey: input.apiKey, model: input.model ?? '' };
    if (!input.providerId)
      throw Object.assign(new Error('请填写API Key或选择已保存配置'), { statusCode: 400 });
    const profile = this.vault.resolve(owner, input.providerId);
    if (normalizeProviderEndpoint(profile.endpoint) !== endpoint)
      throw Object.assign(new Error('地址变更后需要重新输入密钥'), { statusCode: 400 });
    const metadata = this.vault.list(owner).find((p) => p.id === input.providerId) as
      { vendor?: string } | undefined;
    if (metadata?.vendor && metadata.vendor !== input.vendor)
      throw Object.assign(new Error('供应商变更后需要重新输入密钥'), { statusCode: 400 });
    return { ...profile, model: input.model || profile.model };
  }
  private async request(
    endpoint: string,
    apiKey: string,
    path: 'models' | 'chat/completions',
    body?: unknown,
  ) {
    try {
      return await this.network.request(endpoint, apiKey, path, body);
    } catch {
      throw Object.assign(
        new Error('Provider网络请求失败，请核对地址、密钥或模型；未回显上游错误'),
        { statusCode: 502 },
      );
    }
  }
  async models(owner: string, value: unknown) {
    const input = providerOperationSchema.parse(value),
      profile = this.resolve(owner, input);
    const result = await this.request(profile.endpoint, profile.apiKey, 'models');
    const parsed = z
      .object({ data: z.array(z.object({ id: z.string().min(1).max(200) })).max(5000) })
      .safeParse(result);
    if (!parsed.success)
      throw Object.assign(new Error('模型列表响应协议不兼容'), { statusCode: 502 });
    return {
      models: [...new Set(parsed.data.data.map((m) => m.id))]
        .sort()
        .slice(0, 500)
        .map((id) => ({ id })),
      source: 'remote',
    };
  }
  async test(owner: string, value: unknown) {
    const input = providerOperationSchema.parse(value),
      profile = this.resolve(owner, input);
    if (!profile.model.trim())
      throw Object.assign(new Error('请选择或填写模型ID'), { statusCode: 400 });
    const started = Date.now();
    const result = await this.request(profile.endpoint, profile.apiKey, 'chat/completions', {
      model: profile.model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply OK.' }],
    });
    const parsed = z
      .object({
        choices: z
          .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
          .min(1),
      })
      .safeParse(result);
    if (!parsed.success)
      throw Object.assign(new Error('模型响应协议不兼容，未确认连接成功'), { statusCode: 502 });
    return { ok: true, model: profile.model, latencyMs: Date.now() - started };
  }
}

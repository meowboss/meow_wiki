import type { DomainsService } from './service.ts';
import { DomainError } from './service.ts';
import { z } from 'zod';
const buildInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    contributionIds: z.array(z.string().uuid()).min(1).max(10),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
const outlines = {
  general: ['概览', '知识条目', '待核实问题'],
  project: ['项目概览', '架构与模块', '接口与约束', '待办事项'],
  research: ['研究问题', '来源与证据', '主要观察', '分歧与待验证'],
  product: ['产品概览', '功能与使用', '限制与常见问题'],
};
/** Deterministic evidence compilation, explicitly not model inference. */
export class DomainBuildService {
  constructor(private readonly domains: DomainsService) {}
  build(caller: string, domainId: string, value: unknown) {
    const input = buildInput.parse(value);
    const domain = this.domains.describe(caller, domainId);
    if (domain.role === 'reader') throw new DomainError(403, '只读成员不能构建贡献');
    if (domain.revision !== input.expectedRevision) throw new DomainError(409, '知识域版本已变更');
    if (new Set(input.contributionIds).size !== input.contributionIds.length)
      throw new DomainError(400, '来源不能重复');
    const published = this.domains
      .contributions(caller, domainId)
      .filter((c) => c.status === 'published');
    const sources = input.contributionIds.map((id) => {
      const source = published.find((c) => c.id === id);
      if (!source) throw new DomainError(404, '来源不是当前域已发布贡献');
      return source;
    });
    const prefix = `# ${input.title}\n\n> 确定性资料汇编，未调用语言模型。方案：${domain.buildProfile}；来源域版本：${domain.revision}。\n\n${outlines[domain.buildProfile].map((title) => `## ${title}\n\n待维护者根据以下证据整理。`).join('\n\n')}`;
    const evidence = sources
      .map((s, i) => `### [D${i + 1}] ${s.title}\n\n贡献ID：${s.id}\n\n${s.content}`)
      .join('\n\n');
    const content = `${prefix}\n\n## 来源快照\n\n${evidence}`;
    if (content.length > 100_000) throw new DomainError(409, '来源总量超出构建预算，请减少输入');
    const contribution = this.domains.submit(caller, domainId, {
      title: input.title,
      content,
      expectedDomainRevision: input.expectedRevision,
    });
    return {
      mode: 'deterministic-compilation',
      contribution,
      provenance: {
        domainRevision: domain.revision,
        profile: domain.buildProfile,
        contributionIds: input.contributionIds,
      },
    };
  }
}

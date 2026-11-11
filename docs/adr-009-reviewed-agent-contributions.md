# ADR-009：受审核Agent写入与场景构建

2026-11-12。首批允许Agent提交域贡献，不提供发布/审核/修改权限的MCP工具。

凭据显式domain.read/domain.contribute，默认read；contribute仅真实contributor/maintainer/owner能签，当前角色降为reader立即失效。每个请求原caller+绑定域，工具不可传其它域。提交必须携带expectedDomainRevision；发布仍由另一维护者人工审核并CAS，MCP永远不能自审或直接公开。

场景构建首批是从明确选择的本域已发布快照生成新的待审快照，按general/project/research/product模板组织。默认确定性提纲/引文汇编，不伪装成LLM推理；模型构建在真实provider与评测准备好后单独接入。构建保留输入贡献ID与域revision，域变化后旧产物不得直接发布。私人workspace内容不自动进入域。

滥用限制：输入数量/字节、每域贡献配额、token到期/撤销、构建并发与响应预算。提交包含不可信资料，MCP输出不被当作工具指令；用户可查看来源和差异。审计覆盖token签发/使用与贡献审核是后续加固项，不因权限scope存在就宣称完整审计完成。

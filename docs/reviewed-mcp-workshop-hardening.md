# 受审核MCP写入与工坊review修复

2026-11-12。

## 新能力

MCP scope显式domain.read/domain.contribute，默认read。只有当前贡献者及以上可签贡献凭据，降为reader后立即401；原只读表保留CHECK，通过additive grants表兼容旧库。官方SDK HTTP client实际验证submit_contribution仅创建pending、不推进域版本、不暴露pending、不提供review/publish工具。Web签发按域role限制并展示scope。

场景构建按域profile用已发布快照生成确定性提纲与引文汇编，明确非LLM；保留来源ID/域版本，生成pending，发布仍需他人审核CAS。暂未提供模型驱动场景推理。

## 独立review确认并修复

1. 模型响应在原始JSON上检测key会被Unicode escape绕过，解码后写组件文件再导入会泄漏。现在对解码action和嵌套component JSON检查；两层escape回归验证不写入、不导入。此为已知回显防御，不承诺任意编码/语义变换都可检测，根本边界仍是key不进入prompt、只信任部署provider。
2. running.add后初始化DB写失败原先位于try外，实例并发槽永久占用；移入try/finally，故障注入恢复后可再次运行。
3. 单实例启动将遗留running标failed并说明中断；不是多实例lease。
4. 非成功Provider响应显式取消body，避免无用流资源。

## 验证

103项正式测试通过；类型与构建/格式通过；10条Edge系统流程通过。新增写scope/legacy迁移/真实SDK写入与降权、构建CAS、密钥escape和槽恢复回归。UI新增构建与贡献scope的专门浏览器路径尚需扩充，不把原有系统回归覆盖说成新路径全部验证。真实provider仍未配置。

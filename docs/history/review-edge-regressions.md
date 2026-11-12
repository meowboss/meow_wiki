# 二轮Review边界回归

> 文档性质：历史快照：保留当时事实、测试数字及限制；不代表当前规格。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

2026-11-12。完整复读第一轮未覆盖的components/extensions/MCP/workshop/knowledge/proposals/models/backup核心，确认并修复：

1. 工坊cancel与Provider EOF竞争：读取后检查abort，避免cancel已返回requested却ready或写产物；回归分别finish/write两个动作。
2. MCP贡献提交落库后返回全文，控制字符转义可能令响应超预算413但数据已commit。写工具改有界receipt，不返回正文；大控制字符测试成功且回执<2k，pending仍持久化。完整快照只在应用授权读取路径返回。
3. 提议最多200但列表只最新100会隐藏旧pending。当前列表在账号200硬额度内返回最多200，pending优先；101条旧pending回归可达。未称无限分页已完成。
4. Markdown自然后缀与重复标题ID碰撞，改全局Set去重；锚点大小写/URL编码规范化。

浏览器专门验证撤旧MCP不丢新token、组件Esc拒绝放弃后草稿保留；首次label选择器因隐式文本变化失配，改可访问role后通过，未改应用掩盖丢失。

备份文件创建权限在跨平台上仍需部署ACL审阅；本机Windows无法据POSIX umask推断已验证泄漏，后续应提供私有备份目录与显式权限。review未发现证据支持跨owner/MCPscope绕过，但不构成形式化安全证明。管理员审核意见真实UI专用测试仍缺身份fixture；已经独立检查dirty接线和API权限。

验证：133项正式默认测试通过，类型/生产构建/格式通过；两条专门review-guards浏览器用例通过。全系统最终快照复验将在收尾轮统一执行，不将分批结果声称为同一最终全量执行。

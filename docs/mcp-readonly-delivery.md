# 只读MCP阶段交付

2026-11-12。五步计划第2步首批完成，第3/4步代码插件隔离与Harness未实现。

实现官方SDK 1.32.2 Streamable HTTP /mcp，无状态每请求域token认证。3个只读工具+1个域资源，仅published贡献；同一原始user调用DomainsService，域owner权限不转借。凭据签发/撤销有Web界面、session/CSRF保护，仅保存摘要、活动最多20、最多30天、成员撤权实时生效。

证据：76项单元/API/架构测试通过；官方MCP Client使用内存transport初始化/列工具/读资源/撤权验证；HTTP initialize/tools/list和撤销401通过；8条Edge系统用例通过，其中签发/一次性展示/清除/撤销/撤销后HTTP401。生产构建、全量格式和依赖审计通过。桌面/移动MCP截图已实际读图，截图在关闭token之后生成，无明文凭据。

最初浏览器用例getByLabel因隐式label含子内容匹配失败，改可访问role/name并接收撤销确认后通过；未用force click掩盖应用错误。一次严格类型检查发现测试unknown payload触发inject错误重载，序列化JSON并指定Content-Type后重测。

限制：仅本机单实例，未提供公网OAuth发现/注册、未声明真实远程Agent产品兼容全覆盖，未开放写工具、SSE长期会话或断点恢复；请求级限流/响应预算仍待安全加固。SDK依赖面增加已审计无已知漏洞，不等于全面供应链证明。

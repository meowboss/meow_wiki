# 只读MCP首批设计与验证边界

> 文档性质：设计/边界文档：可能含早期目标与原型现状，是否已实现须查当前状态。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

传输：官方@modelcontextprotocol/sdk 1.32.2，Streamable HTTP无状态JSON响应，端点/mcp；不自行实现JSONRPC解析。每请求独立构造server并结束关闭，撤销后无长存会话保留旧身份。

授权：Web凭session+CSRF签发/撤销凭据，MCP端点只认独立Bearer域token，不接受Cookie替代。token绑定真实user+单domain+domain.read+到期；只存SHA256，明文仅签发响应一次。认证每次重新核对当前membership；工具继续以原始user调用DomainsService，不代理域owner。

能力：domain_info、search_knowledge、read_contribution以及meow://domains/:id资源；仅已发布贡献，连作者/维护者token也不返回pending。无写工具、不提供私人workspace页面、无自动公开。资料为不可信文本，不当作Agent指令。

网络：仍仅本机监听、Host/Origin入口保护，不是公网OAuth资源服务器；没有OAuth授权发现/动态注册，不宣称远程互联网MCP生产可用。GET/DELETE传输行为交给官方无状态transport（不开放SSE长期流）。无session id，不声称恢复流。

验证目标：官方MCP Client内存transport互操作；真实HTTP initialize/tools/list；无token401、撤销401、移除成员立即失效；凭据摘要/额度/过期/事务；Web签发/撤销系统用例与截图。错误不得返回token、哈希或内部SQL。

下一步安全评审：请求级限流、响应分页/体积预算、SDK供应链审计、真实外部客户端连接；之后才考虑受审核写入能力。Harness与隔离代码插件仍后续独立阶段。

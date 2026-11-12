# 工坊取消与上下文密钥审阅

> 文档性质：历史快照：保留当时事实、测试数字及限制；不代表当前规格。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

2026-11-12。新增owner-scoped取消接口，AbortController关联实际fetch和body读取，UI运行中可请求取消；终态仍以服务端返回/刷新确认。取消不自动导入、并发槽finally释放。不是跨实例取消/持久任务队列。

独立只读复核未确认跨用户vault/project越权；提出instruction/read_file结果也可能由用户带入当前key。现对请求上下文、tool结果、模型输出及component JSON做有界递归JSON解码检查（最多6层）；literal/单层/嵌套unicode回归在首个网络请求前或下一轮前阻断。测试使用假key与mock，不涉及真实网络。

这些检查不是通用DLP：其它provider密钥/任意密码、base64或语义拆分不保证检测。用户业务文本会发送至所选可信provider，必须明确。Key本身只作为Bearer发送至部署允许endpoint；不能把管理员allowlist当任意URL SSRF沙箱。

106项默认测试、类型/构建通过，新增取消/槽释放/跨owner拒绝与prompt检查。UI取消按钮已接，真实Provider尚未配置，取消完整浏览器场景仍待可控provider系统fixture。继续保留准确未验边界。

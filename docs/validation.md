# M0 验证记录

日期：2026-11-11（Asia/Shanghai）。环境：Windows / Node 24.17.0 / pnpm 10.34.5。

## 已执行

- `pnpm test`：9/9 通过。
  - 默认官方插件、页面 CRUD 中创建/更新链路、scope 内关键词检索与本地引用。
  - 跨 workspace 读写拒绝及伪造身份 header 无效。
  - Markdown 脚本、危险 URL、iframe 与远程图片清洗。
  - 插件依赖启停失败回滚，禁用能力 fail closed。
  - 私有组件提交不等于发布、重复提交拒绝、受信 review 后其他身份安装。
  - 令牌模式配置/鉴权/Origin/Host/输入校验。
  - 实际临时 HTTP listener 验证 absolute-form 请求无法绕过鉴权。
  - 插件注册失败回滚、重复能力/依赖拒绝。
  - SQLite 关闭重开持久性与事务回滚。
- `pnpm build`：TypeScript strict 检查与 Vite 生产构建通过。
- `pnpm audit --registry=https://registry.npmjs.org`：全依赖未报告已知漏洞；prod-only 审计同样通过。这不是无漏洞证明。
- 实际启动 `PORT=3017 pnpm start`：首页 HTTP 200、含 React root、API 返回 2 篇初始化页面/3 个默认插件、CSP 响应头存在。临时服务检查后停止。
- `git diff --check`：通过（Windows Git 有 LF→CRLF 提示，不是空白错误）。

## 审阅中发现并修复

1. Fastify 错误参数为 unknown，补充类型收窄。
2. 首次依赖审计报告旧 static/Zod 等依赖风险，升级 `@fastify/static` 与 `zod` 至已修补版本并重测。
3. 不能按原始 `/api/` URL 前缀决定鉴权：absolute-form HTTP 可与路由规范化不一致。现在所有请求统一经过入口保护，并有真实 listener 回归测试。
4. Vite 开发代理保留原始 Host，确保与浏览器 Origin 检查兼容。
5. 私有纯文本组件补充“用模板创建页面”入口，避免组件只可保存不可使用。

## 未执行 / 未承诺

没有浏览器自动化、截图视觉验收、可访问性完整审计、压测、生产渗透测试、多实例一致性、真实 OIDC/LLM/向量召回评测。界面由源码和生产构建验证，不能据此声称所有交互已在真实浏览器逐一验证。

依赖安装时 pnpm 按默认策略忽略 esbuild 安装脚本；本机官方平台二进制仍使测试与构建正常通过，未额外放开生命周期脚本。默认 registry 的 HTTP audit 协议报错后，使用显式 HTTPS npm registry 完成审计，未修改用户全局配置。

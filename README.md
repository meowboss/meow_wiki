# 🐾 Meow Wiki

**让知识，自由生长。** 一个以「业务皆可插件化」为方向、让每个人装配自己专属 Wiki 的 AI 时代知识平台。

当前已进入 **单实例自托管试运行建设阶段**：已接入 Better Auth 登录、多空间与页面版本恢复，尚不是公开部署的完整多用户 SaaS。仓库从一个可运行的小系统开始：先把页面、插件边界、资源隔离与组件审核规则做对，再逐步打开 AI 与外部生态。

当前准确范围与未完成项见 [当前状态](<docs/current-status.md>)；历史阶段文档不代表最终完成。

## 已有能力

- React 中文知识空间：页面创建/编辑/保存、分屏 Markdown 安全预览、响应式侧栏。
- 官方插件默认启用：Markdown、当前空间关键词检索、LLM Wiki 问答入口。
- **诚实的 AI 状态**：未配置时明确本地摘录；宿主可配置模型broker生成带引用回答/待确认提议，但真实provider质量尚未实测，不冒充已验证模型效果。
- 官方插件启停与依赖校验；插件初始化失败不会留下半注册能力。
- 用户组件默认私有，内容为受限声明式区块与文本模板，不运行脚本；提交进入待审核，不能自行发布。
- 声明式首页支持私有/已安装组件、排序与版本保护；官方审核工作台支持批准/退回/撤架，管理员经受信宿主 CLI 授权。市场默认为空，未审核不会公开。
- 组件支持安全 Markdown、当前空间页面列表和搜索区块；发行版固定快照，不执行用户代码。
- SQLite 持久化、owner/workspace 访问边界、输入大小约束、HTML 清洗、Origin/Host 校验。
- 知识域独立成员/贡献审核、确定性资料汇编；MCP域范围只读/提交待审凭据及分页预算。
- 受控声明式组件工坊：用户Provider密钥加密保存、部署端点允许集、虚拟文件和8轮工具循环、取消；非通用代码IDE或OS沙箱。
- 受信代码插件示例在隔离iframe运行；尚不开放任意用户JavaScript。

## 快速开始

环境：**Node.js 24+、pnpm 10**。

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

访问 **http://localhost:3000**，注册邮箱账号后自动创建个人知识花园；默认启用 session 登录，数据库写入 `.data/meow.sqlite`，不会纳入 Git。停止服务后可以备份整个 `.data` 目录；尚无在线备份工具。

开发时两个终端分别运行：

```powershell
pnpm dev
pnpm dev:web
```

打开 Vite 输出的本地地址，`/api` 代理到 3000。修改后端会触发重启，SQLite 数据保留。生产式本地运行使用前述 `build + start`，不要用另一个项目的 GUI 地址代替本应用地址。

## 验证

```powershell
pnpm test
pnpm check
pnpm build
pnpm audit --prod --registry=https://registry.npmjs.org
```

测试涵盖默认插件、迁移/CAS/历史与回收站、跨空间拒绝、XSS、插件清理、认证与组件/来源服务。已加入 Playwright 真实浏览器链路：注册→版本化保存→历史→删除恢复→多空间切换→退出；尚无生产渗透测试。

```powershell
pnpm test:e2e
```

当前本机浏览器测试使用 Microsoft Edge；无 Edge 时设置 `PLAYWRIGHT_CHANNEL=chromium` 并执行 `pnpm exec playwright install chromium`。CI按此方式配置，但尚未有远程CI运行证据。测试数据库使用内存，不写个人数据。

部署配置：`MEOW_DATABASE` 指定数据库路径；`MEOW_AUTH_BASE_URL` 设置浏览器访问 origin；`NODE_ENV=production` 必须注入至少32字符高熵 `MEOW_AUTH_SECRET`。非生产启动会生成并保留 `.data/auth-secret`，备份时需与数据库一起安全保管。开发使用Vite前设置 `MEOW_ALLOW_VITE_ORIGIN=1`；默认不信任开发跨源地址。

## 目录

- [内核](<src/kernel.ts>)：小型 manifest 与受信能力注册表。
- [官方插件](<src/plugins/official.ts>)：安全渲染、轻量检索和本地引用问答。
- [HTTP 应用](<src/app.ts>)：宿主授权、参数校验与业务 API。
- [内容应用门面](<src/store.ts>)：事务协调与资源 scope；[SQLite 仓储](<src/infrastructure/sqlite/content-repository.ts>) 隔离SQL及迁移；[页面领域规则](<src/modules/pages/domain.ts>) 为无IO纯函数。
- [启动入口](<src/server.ts>)：仅本地监听与构建后静态文件。
- [前端装配](<web/app/App.tsx>)：Wiki、插件市场、私有组件。
- [平台测试](<tests/platform.test.ts>)。

## 安全与边界

**默认 `session` 使用 Better Auth 账号与可撤销会话。仍仅面向本机单实例试运行，不要直接暴露公网。** 可显式设置 `MEOW_AUTH_MODE=local` 使用固定本地身份；该模式同机访问者共享权限。 后端始终只监听 127.0.0.1，不把请求里的 user/owner header 当可信身份。

提供面向脚本的可选令牌模式（不是网页登录）：

```powershell
$env:MEOW_AUTH_MODE = 'token'
$env:MEOW_USER_ID = 'alice'
# 从你的密钥管理工具注入至少 32 字符随机令牌；不要提交到 Git
$env:MEOW_AUTH_TOKEN = '<your-random-secret-at-least-32-characters>'
pnpm start
```

token 模式的 API 请求需带 `Authorization: Bearer ...`，仅供脚本使用；浏览器使用默认 session 注册/登录。认证带数据库限流，写请求校验 session-bound CSRF，Cookie 不缓存可撤销会话。当前尚无邮件恢复、OIDC、RLS、公开分享、全局配额或不可信代码沙箱。官方插件在同一进程运行，只有已审阅静态代码受信；用户模板不会变成 JavaScript 插件。

Markdown 会过滤脚本、危险 URL 和 iframe，远程图片也暂不渲染，避免隐式出站跟踪。依赖声明权限不等于安全隔离。

## 从愿景到平台

先读 [产品愿景与架构决策](<docs/vision-and-architecture.md>)，包括知识花园、研究工作台、时间胶囊、AI 提议、市场治理，以及 M0→M4 的分阶段退出标准。

[参考项目研究记录](<docs/reference-notes.md>) 列出 DeepSeek Harness 与 WeKnora 的实际源码依据、借鉴与不照搬事项。

优先下一步：页面 revision/CAS 与恢复 → 首页/组件组合 → 身份与多空间 → 市场审核治理 → 带来源的 AI 知识管线。**开放来自稳定的边界，而不是提前造一个庞大系统。**

## License

[MIT](<LICENSE>) · Boss Meow

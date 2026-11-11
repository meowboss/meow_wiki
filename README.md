# 🐾 Meow Wiki

**让知识，自由生长。** 一个以「业务皆可插件化」为方向、让每个人装配自己专属 Wiki 的 AI 时代知识平台。

当前是 **M0 本地纵向原型**，不是已经可以公开部署的多用户 SaaS。仓库从一个可运行的小系统开始：先把页面、插件边界、资源隔离与组件审核规则做对，再逐步打开 AI 与外部生态。

## 已有能力

- React 中文知识空间：页面创建/编辑/保存、分屏 Markdown 安全预览、响应式侧栏。
- 官方插件默认启用：Markdown、当前空间关键词检索、LLM Wiki 问答入口。
- **诚实的 AI 状态**：当前只有本地来源摘录，明确返回 `local-extractive`，未接模型、不伪装成生成式回答。
- 官方插件启停与依赖校验；插件初始化失败不会留下半注册能力。
- 用户组件默认私有，内容仅为纯文本模板，不运行脚本；提交进入待审核，不能自行发布。
- 受信内部审核方法与市场安装 API 已有测试；**审核后台尚未实现，市场默认可以为空**。
- SQLite 持久化、owner/workspace 访问边界、输入大小约束、HTML 清洗、Origin/Host 校验。

## 快速开始

环境：**Node.js 24+、pnpm 10**。

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

访问 **http://127.0.0.1:3000**。首次启动自动创建个人知识花园；数据库写入 `.data/meow.sqlite`，不会纳入 Git。停止服务后可以备份整个 `.data` 目录；尚无在线备份工具。

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

测试涵盖默认插件、页面与持久化、跨空间访问拒绝、XSS 清洗、插件依赖/失败回滚、私有→待审核→受信发布→其他身份安装、令牌鉴权和输入校验。当前没有承诺已完成浏览器端自动化或生产渗透测试。

## 目录

- [内核](<src/kernel.ts>)：小型 manifest 与受信能力注册表。
- [官方插件](<src/plugins/official.ts>)：安全渲染、轻量检索和本地引用问答。
- [HTTP 应用](<src/app.ts>)：宿主授权、参数校验与业务 API。
- [数据仓储](<src/store.ts>)：SQLite 事务与资源 scope。
- [启动入口](<src/server.ts>)：仅本地监听与构建后静态文件。
- [前端](<web/App.tsx>)：Wiki、插件市场、私有组件。
- [平台测试](<tests/platform.test.ts>)。

## 安全与边界

**默认 `local` 是单用户本地模式：同一台机器能访问该端口的人，具有同样的本地身份。不要将它通过反向代理暴露公网。** 后端始终只监听 127.0.0.1，不把请求里的 user/owner header 当可信身份。

提供面向脚本的可选令牌模式（不是网页登录）：

```powershell
$env:MEOW_AUTH_MODE = 'token'
$env:MEOW_USER_ID = 'alice'
# 从你的密钥管理工具注入至少 32 字符随机令牌；不要提交到 Git
$env:MEOW_AUTH_TOKEN = '<your-random-secret-at-least-32-characters>'
pnpm start
```

所有 API 请求需带 `Authorization: Bearer ...`。浏览器 UI 暂无令牌输入/登录界面；token 模式应由 API 客户端使用。当前没有多人身份系统、RLS、公开分享、限流、审计或不可信代码沙箱。官方插件在同一进程运行，只有已审阅静态代码受信；用户模板不会变成 JavaScript 插件。

Markdown 会过滤脚本、危险 URL 和 iframe，远程图片也暂不渲染，避免隐式出站跟踪。依赖声明权限不等于安全隔离。

## 从愿景到平台

先读 [产品愿景与架构决策](<docs/vision-and-architecture.md>)，包括知识花园、研究工作台、时间胶囊、AI 提议、市场治理，以及 M0→M4 的分阶段退出标准。

[参考项目研究记录](<docs/reference-notes.md>) 列出 DeepSeek Harness 与 WeKnora 的实际源码依据、借鉴与不照搬事项。

优先下一步：页面 revision/CAS 与恢复 → 首页/组件组合 → 身份与多空间 → 市场审核治理 → 带来源的 AI 知识管线。**开放来自稳定的边界，而不是提前造一个庞大系统。**

## License

[MIT](<LICENSE>) · Boss Meow

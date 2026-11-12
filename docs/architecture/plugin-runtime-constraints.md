# 首批插件运行时约束

> 文档性质：设计/边界文档：可能含早期目标与原型现状，是否已实现须查当前状态。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

## 范围与接口

- `registerPluginRuntime(app: FastifyInstance): void` 仅注册 `GET /plugin-runtime/sample.html`。本模块不修改应用装配、安全中间件或前端，调用方必须显式注册。
- 仅执行仓库审查过的固定示例，不接受用户 JavaScript、HTML、脚本 URL、源码参数或上传。查询参数不会进入文档；没有运行任意代码的 POST 接口。
- 浏览器与后端共享 `packages/plugin-sdk/index.ts`；`src/modules/plugin-runtime/contract.ts` 仅为后端转出入口。共享包不依赖 Node 或服务端模块。前端构建/架构边界需由调用方显式允许该共享包，不能绕道导入 `src`。
- manifest 严格对象：`{id:'example.page-list',apiVersion:1,version:string,permissions:['pages.list']}`。版本非空且最长 64 字符，允许空权限数组表示无授权，不接受额外字段。
- RPC 严格对象：`{id:string,method:'pages.list'|'workspace.summary',params:{}}`。id 长度 1–64，参数必须严格空对象，不接受额外字段或未知方法。
- `buildPluginPolicy(manifest)` 返回 `{manifest,allows(method)}`。已知方法不等于获授权；首批示例仅授权 `pages.list`，`workspace.summary` 请求可解析但应被拒绝。

## 浏览器隔离

- 宿主必须设置 `<iframe sandbox="allow-scripts">`，绝不能包含 `allow-same-origin`；缺失 sandbox 时本示例会明确显示父页面 DOM 可访问风险。
- 响应 CSP：`default-src 'none'; script-src 'nonce-随机值'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'`。每次请求使用独立 192-bit 随机 nonce，禁止缓存。
- 不设置 `frame-ancestors 'none'`，以允许宿主嵌入；安全中间件若已有全局 CSP / X-Frame-Options，需要调用方确认不会阻断同源宿主 iframe。当前模块不覆盖全局安全策略。
- CSP 并非 sandbox 替代品。HTML 不包含动态编译、用户脚本或 HTML 注入。所有宿主返回内容以 `textContent` 呈现。
- 网络隔离探针仅尝试 `fetch('/api/workspace')`，由 `connect-src 'none'` 在发送前阻止，不向真实外部地址发送请求或携带敏感数据。DOM 探针尝试读取 `parent.document`，正确 sandbox 下显示 `SecurityError`。

## MessageChannel 协议及宿主责任

1. iframe 文档加载后，宿主生成独立连接 nonce（16–256 字符，建议密码学随机），创建 `MessageChannel`。
2. 宿主仅向该 iframe 的 `contentWindow` 发送 `{type:'meow.plugin.connect',apiVersion:1,nonce}`，转移一个端口。由于 sandbox 不带 same-origin，目标 origin 必须为 `'*'`，但该值不是认证或广播许可。
3. 示例只接受 `event.source === parent` 的首个有效握手，校验 envelope 与单个 port，随后移除全局消息监听。后续 RPC 仅走端口：`{id:'1',method:'pages.list',params:{}}`。
4. 宿主返回 `{id:'1',result:[{id,title}]}`，或 `{id,error:...}`。示例严格验证页面 id/title 字符串并用纯文本显示。
5. 宿主若监听窗口事件，必须精确比对 `event.source === iframe.contentWindow` 并绑定该 iframe 实例、受信 manifest、nonce、当前工作区与生命周期；`event.origin === 'null'` 只是 opaque origin 的表现，绝不是插件身份认证。
6. 宿主必须对端口请求运行 schema 校验、权限 allowlist，再调用现有当前用户/工作区授权服务。插件不能自行选择任意工作区，不能读取凭据、完整工作区对象或调用未授权功能。
7. 切换工作区、卸载或重载时关闭旧端口，撤销旧实例，丢弃旧会话回包。需在宿主实施请求速率/大小限制、重复 id 与生命周期处理。本示例 SDK 仅用于固定一次性请求，不承诺通用 SDK 超时/恢复行为。

## 验证边界

单元测试校验 nonce/CSP/响应头、固定脚本及 schema，并实际通过 MessageChannel 执行嵌入的 SDK 脚本。VM 中的 DOM 异常与 fetch 拒绝是测试替身，不是浏览器安全证据。完整集成仍须真实浏览器验证 sandbox 的 SecurityError、CSP 的网络拒绝、页面列表文字显示及无 JavaScript 异常；预期 CSP 阻止网络会产生浏览器安全控制台消息。

稳定测试节点：`plugin-status`、`plugin-pages`、`plugin-dom-result`、`plugin-fetch-result`。

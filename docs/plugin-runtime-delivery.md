# 插件运行时首批兼容验证

2026-11-12。阶段3只完成受信示例与最小SDK协议验证，不代表用户任意代码已开放。

共享packages/plugin-sdk公开入口提供apiVersion1 manifest/RPC/权限schema；前后端共用，不引入Node到浏览器。固定示例通过sandbox=allow-scripts且无same-origin的opaque-origin iframe执行；nonce脚本CSP禁止网络/图片/worker/form，MessageChannel只向精确iframe window转移。宿主仅pages.list权限、最多50标题/id、8k消息/响应、30消息/mount；workspace.summary默认拒绝，非法消息fail closed；卸载关闭port并移除iframe。

真实Edge测试已验证pages.list返回、parent DOM SecurityError、fetch由CSP拒绝、离开页面iframe销毁；桌面/移动截图实际读图，无正文遮挡。固定HTML不接收上传代码/JS参数，不把字符串过滤当沙箱。

84项默认测试通过（含5个前端host单测、3个运行时协议/CSP测试），类型/构建/格式通过。SDK引入Zod使浏览器bundle由约349k增至439k（未压缩），是已观察成本；后续可拆浏览器轻量schema/懒加载实验室，不在无评测时谎称零成本。

剩余：用户产物构建/版本安装/签名、恶意代码CPU与导航策略、独立来源执行器、隔离开发workspace、Harness与用户provider密钥代理。当前仅受信代码示例，所以不能把这个阶段说成安全开放代码插件生态。

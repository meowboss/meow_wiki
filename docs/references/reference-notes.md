# 参考项目源码研究记录

> 文档性质：参考研究：描述研究时的外部源码与本项目候选方案，不覆盖现行实现与策略。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

研究方式：只读检查本机两个参考仓库的文档与实际源码；未运行参考应用，未访问凭据。结论为静态研究，不是安全审计。以下绝对链接便于本机核查，不代表当前项目依赖它们。实现没有复制参考项目代码；当前项目保留 MIT 许可。

## DeepSeek Harness

- [架构与 seam](<C:/Users/liu20/code/deepseek-harness/docs/architecture.zh.md#L138-L142>)：接口/提供方/消费者分离，作为能力注册表的方向。
- [Cordis 插件契约](<C:/Users/liu20/code/deepseek-harness/vendor/cordis/src/registry.ts#L99-L133>)、[加载前配置验证](<C:/Users/liu20/code/deepseek-harness/vendor/cordis/src/fiber.ts#L50-L61>)：本项目缩小为单一 setup 与 Zod manifest；apiVersion 是本项目选择，不是照引 Cordis 字段。
- [作用域清理](<C:/Users/liu20/code/deepseek-harness/docs/cordis-tutorial/02-lifecycle-and-effects.zh.md#L64-L94>)：后续引入副作用时的生命周期依据；本次尚未实现异步 disposer，不假称热卸载。
- [Provider 注册](<C:/Users/liu20/code/deepseek-harness/packages/web/web/src/index.ts#L98-L130>)：拒绝重复能力、明确提供方，不靠覆盖顺序。
- [facade 不是安全边界](<C:/Users/liu20/code/deepseek-harness/packages/extensions/cordis-client-runner/src/client/guard.ts#L1-L13>)：权限声明、DI 与安全隔离分开。
- [前后端入口](<C:/Users/liu20/code/deepseek-harness/packages/client/ui-goal/package.json#L16-L41>)：未来同插件身份、独立浏览器与后端入口；本次先用普通 HTTP 和固定 UI。
- [Slot 模型](<C:/Users/liu20/code/deepseek-harness/packages/client/ui-slots/README.zh.md#L28-L48>)：只计划少量命名槽，不复制完整装配系统。

## WeKnora

- [实际管线插件](<C:/Users/liu20/code/WeKnora/internal/application/service/chat_pipeline/chat_pipeline.go#L9-L77>)：编译进进程的事件责任链，不等于不可信插件安装沙箱。
- [资源授权](<C:/Users/liu20/code/WeKnora/internal/application/access/knowledgebase.go#L22-L70>)：原始 caller 与资源执行域分开；本项目仓储始终显式 owner + workspace。
- [租户过滤仓储](<C:/Users/liu20/code/WeKnora/internal/application/repository/knowledge.go#L64-L88>)：应用层隔离，不推断为 RLS。
- [任务版本与取消](<C:/Users/liu20/code/WeKnora/internal/application/service/knowledge_process.go#L3850-L3946>)：未来 source revision / attempt / CAS 的依据，不在原型里假装已经落地。
- [删除一致性](<C:/Users/liu20/code/WeKnora/internal/application/service/knowledge_delete.go#L180-L235>)：tombstone、来源撤回和在途任务必须一起设计。
- [检索授权与 embedding space](<C:/Users/liu20/code/WeKnora/internal/application/service/knowledgebase_search.go#L223-L298>)：先 scope 再检索、限制候选预算、不同 embedding 空间不可混用。
- [模型配置](<C:/Users/liu20/code/WeKnora/internal/handler/dto/model.go#L51-L108>)：密钥与配置展示分离，切 provider 不继承旧 secret。
- [出站网络](<C:/Users/liu20/code/WeKnora/internal/utils/security.go#L859-L937>)：后续 URL 导入与模型自定义 endpoint 必须考虑 DNS/IP pinning、重定向与 SSRF，不能只校验一次字符串。

## 提炼的共同原则

可组合能力不等于任意执行；授权先于插件；事实与实时能力分开；AI 产物要有来源；成熟系统的复杂度应按真实需求渐进引入，而不是按目录结构复刻。

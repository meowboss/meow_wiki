# 对话式组件工坊首批实现

2026-11-12。按用户交互纠正及DSH专项源码依据，主入口“创建组件”改为对话工作台，旧表单置于“高级手动创建”。

用户首条需求自动建项目并chat；助手可ask_user追问等待用户、调用受限read/write/validate工具、合法finish后ready；用户继续对话修改，安全预览后显式保存私有组件。JSON编辑与Provider设置收进高级区，不要求普通用户先手写JSON。未配置provider不模拟AI。

对话持久化并有owner授权、200条/256k保留预算、单调sequence；执行摘要与user/assistant分类型，工具started/completed/failed带runId/turn/callId关联；UI每秒轮询真实事件，不提供伪思考。项目claimRun原子锁阻止不同engine重复运行；取消/错误有安全事件，敏感凭据持久化前检查。

验证：138项默认测试通过，构建/类型/格式通过；最终15个普通系统spec（16个测试）全部通过，独立对话式真实HTTP Provider验收1项通过；CI配置已加入test:conversation（远端尚未运行，不声称CI已过）；可控真实HTTP provider浏览器完整路径：创建入口→配置测试Provider→需求→AI追问→用户答复→工具生成/校验→继续修改→预览→私有保存。桌面/390px截图实际查看，无正文遮挡；工具状态与名称中文化，阅读到末尾时跟随新事件，向上阅读不强制跳底。

DSH借鉴范围见dsh-conversation-reference.md。差异明确：当前provider采用受控JSON动作adapter，不是标准原生tool_calls协议；ask_user保留对话但project state仍draft（UI明确等待），尚无完整可恢复step/call journal或in-flight跨重启续跑。不能把这次首批称完整DSH runtime复刻。通用代码插件与OS开发隔离仍未开放。

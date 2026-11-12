# DSH对话Harness专项源码依据

> 文档性质：参考研究：描述研究时的外部源码与本项目候选方案，不覆盖现行实现与策略。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

2026-11-12。用户明确要求工坊参考本地deepseek-harness。研究仅覆盖agent/session/provider/tool/chat关键链路，未读取凭据、未修改参考仓库，不称全面读完。

- [agent循环](<C:/Users/liu20/code/deepseek-harness/packages/core/agent-loop/src/agent.ts#L326-L433>)：turn/step和续步；后续435–609模型流与工具执行。
- [session类型](<C:/Users/liu20/code/deepseek-harness/packages/core/session/src/types.ts#L287-L393>)：消息与执行事件分离、callId关联。
- [history投影](<C:/Users/liu20/code/deepseek-harness/packages/core/session/src/surface.ts#L108-L151>)：只有message/tool-result进入模型history，boundary/log不作为消息；lead实际补读该段。
- [恢复repair](<C:/Users/liu20/code/deepseek-harness/packages/core/session/src/repair.ts#L101-L189>)：未完成调用须保守收尾，不假设成功。
- [provider契约](<C:/Users/liu20/code/deepseek-harness/packages/llm/llm/src/types.ts#L530-L585>)：消息、工具、signal边界。
- [前端事件](<C:/Users/liu20/code/deepseek-harness/packages/api/session-controller/src/client/contract/events.ts#L6-L35>)、[工具节点](<C:/Users/liu20/code/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/tool.ts#L294-L331>)：持久/临时流区分，按callId投影UI。

## 本项目采用与差异

采用对话与事件分离、run/turn/call关联、等待用户明确状态、工具准入和取消终态。预览与显式私有导入独立。当前JSON工具协议是兼容受控provider的过渡adapter，不宣称已实现标准原生tool_calls完整协议；不得把工具结果长期伪装用户文本作为最终架构。

第一批先实现真实多轮会话与安全事件可见性，后续标准provider adapter应持久化成对assistant/tool历史并做call修复/重启测试。8轮限制不替代上下文预算。任意JS与OS开发沙箱仍未开放。

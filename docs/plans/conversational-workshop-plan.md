# 对话式组件创作：交互与Harness修订

> 文档性质：规划记录：未完成项需核对当前状态，不把历史“待确认”视为新的审批要求。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

状态：用户明确要求主入口采用Agent Harness对话，而非表单/JSON先行，并指定参考本地deepseek-harness实现。当前开发候选需与源码研读结论对齐，不将外观聊天框当完整Harness。

## 产品流程

创建组件→描述需求→Agent可追问→受限工具执行→校验与安全预览→用户继续对话修改→明确保存为私有组件→可选提交审核。JSON/SDK作为高级视图，不是普通用户必经步骤。没有Provider时真实引导配置，不伪造助手消息/执行成功。

## 设计不变量

- 对话与执行分开：user/assistant自然语言与tool开始/结果/错误有不同类型；后续以turnId/callId关联。
- 项目持久化对话，重新打开可继续；当前scope caller+project，不以模型角色决定授权。
- 当前虚拟fs/加密Provider/allowlist/8轮预算/取消保留；开发与运行隔离不混淆。
- ask_user不需要合法产物，可进入等待用户；finish仅在产物验证成功后ready。工具失败与取消有明确终态，不能等同“助手回答完成”。
- UI运行时展示真实事件，不展示伪思考文本；不保存provider key、raw工具敏感内容、模型内部推理。
- 刷新/断开不代表任务取消。重启需标记interrupted，当前单实例不许假称可无损恢复所有in-flight调用。
- 预览走同一声明式renderer，数据来自当前授权workspace。保存与发布分离；对话产生结果不自动上架。

## 实施顺序

1. 针对DSH agent/session/tool事件/取消/provider/chat渲染做源码核验并记录引用。
2. 最小会话+执行事件协议、持久turn与安全工具summary、API回归。
3. 统一创建入口到聊天工作台，项目预览/高级视图/Provider配置。
4. 可控真实HTTP Provider的多轮追问和迭代系统验收，桌面/移动截图。
5. 完整review与Git提交，更新当前用户服务。保留旧API兼容但不让旧表单成为主要创建路径。

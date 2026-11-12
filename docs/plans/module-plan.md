# 平台模块实施契约

> 文档性质：规划记录：未完成项需核对当前状态，不把历史“待确认”视为新的审批要求。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

本清单把完整架构变成可逐项验收的模块。未勾选表示未完成；存在接口不等于完成产品模块。依赖方向：UI → HTTP 授权层 → 应用服务 → 仓储/能力接口；插件不拥有授权豁免。

## 依赖与验收

| 顺序 | 模块 | 契约与不变量 | 验收 |
|---|---|---|---|
| 1 | 迁移与内容版本 | schema_migrations；旧JSON一次性迁移；page revision不可变；expectedRevision必填；软删除保留历史 | 老库无损迁移、重复启动幂等、冲突409、回滚不产生历史、重启持久 |
| 2 | 身份与会话 | Better Auth托管密码与会话、到期/注销、CSRF、登录限流；默认非管理员 | 两用户隔离、会话撤销、伪造身份无效、跨站写拒绝 |
| 3 | 空间与页面组织 | 一用户多空间；资源scope；标题/说明管理；页面树防环、删除恢复、链接/反链、导入导出 | 空间切换前后不混数据、循环拒绝、备份可重导入 |
| 4 | 插件生命周期/UI贡献 | apiVersion兼容；依赖校验；注册归属、失败回滚、清理；显式命名槽 | 重复与循环依赖拒绝、卸载资源释放、禁用后入口和能力一致 |
| 5 | 声明式组件/首页 | 有版本schema；只允许受支持block；不执行脚本；空间内布局引用 | 用户可组合首页、错误组件隔离、缺失组件可见提示 |
| 6 | 市场审核 | 不可变提交快照/摘要；reviewer授权；审核审计/退回；发布/撤架；固定安装版本 | 作者无法自审、修改不污染已发布版本、撤架禁止新安装 |
| 7 | 来源与任务 | source/revision/job/chunk；幂等与attempt；ready才可检索；删除撤回 | 旧任务不能覆写或复活、跨空间检索拒绝、失败可重试 |
| 8 | 模型网关/RAG | 宿主secretRef；限时与预算；明确endpoint allowlist；来源编号验证 | 无key清晰未配置、模型失败不伪成功、引用可追溯、删除后失效 |
| 9 | AI提议 | evidence + expectedRevision + proposed content；人工确认后CAS | 过期提议拒绝、拒绝不改原文、确认产生新历史 |
| 10 | 运行与交付 | 备份恢复、配置校验、限流、健康检查、日志脱敏、端到端测试 | 新环境可启动、恢复演练、全测试构建审计通过 |

## API 兼容约定

- 保留 /api/workspace 聚合读取，workspaceId query始终显式授权。
- 页面新增 revision、deletedAt、parentId；PUT必须带expectedRevision，不再允许盲写。
- 历史 GET /api/pages/:id/history，恢复 POST /api/pages/:id/restore {revision,expectedRevision}。
- DELETE /api/pages/:id 携带 expectedRevision；POST /api/pages/:id/undelete 同样校验。
- 身份 session模式使用HttpOnly SameSite=Strict cookie，写请求额外要求 X-CSRF-Token；local/token保留兼容但不冒充多人身份。
- GET/POST /api/workspaces 以及 PATCH /api/workspaces/:id 负责空间列表、创建与设置。
- 登录/注册/注销/me属于宿主；组件和模型操作不能改变调用者身份。

## 数据策略

原型 workspaces.data 暂时保留 enabled/components 等配置。页面迁移进独立 pages 与 page_revisions 关系表，读聚合时组装，避免全空间快照覆盖页面。迁移事务先完成后记录版本，旧JSON保留用于故障核对但不再读其中页面。逐模块提取其余配置，不一次造全部表。

## 状态

- M0 已有：本地原型与基础边界测试。
- 页面版本/身份空间/组件市场/来源与提议核心链路已有测试与阶段提交，具体限制见交付记录。
- 工程结构正在落实模块化边界；链接反链、导入导出、异步worker、UI插件槽及生产运行完整性仍未全部实现。
- 本文是验收清单，不因某条接口存在就视为整模块完成。

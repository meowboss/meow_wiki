# Meow Wiki · 项目 LLM Wiki

这里是项目知识库，供开发者与 Agent 共同查阅。设计目标、当前实现和历史证据分别管理，避免把旧交付记录当成当前规格。

## 从哪里开始

1. [当前状态与边界](<status/current-status.md>)：判断“现在能做什么”。
2. [架构设计](<architecture/architecture-design.md>)与[技术决策](<architecture/technical-decisions.md>)：理解模块与依赖方向。
3. [决策索引](<decisions/README.md>)：理解约束及取舍；后继决策优先于被取代内容。
4. [功能索引](<features/README.md>)：定位阅读、编辑、导航与界面行为。
5. [开发计划](<plans/development-plan.md>)：区分待做目标与完成事实。
6. [历史记录](<history/README.md>)：查找某次测试、Review和交付证据。

## 分类

| 类别 | 内容 | 使用方式 |
| --- | --- | --- |
| [status](<status/README.md>) | 当前能力、限制、运行入口 | 当前事实入口，变化后同步更新 |
| [architecture](<architecture/README.md>) | 系统设计、边界、资源策略 | 用源码核对，不把规划当实现 |
| [decisions](<decisions/README.md>) | ADR、选择及替代关系 | 保留决策历史，新增后继而非抹除原因 |
| [features](<features/README.md>) | 用户流程与功能行为 | 查找功能入口及交互约定 |
| [plans](<plans/README.md>) | 路线、任务与需求追踪 | 未完成项不能写成已有能力 |
| [references](<references/README.md>) | DSH、WeKnora源码研究 | 参考事实不自动成为本项目实现 |
| [history](<history/README.md>) | 阶段交付、Review、验证快照 | 测试数字只代表对应快照 |
| [guides](<guides/documentation-governance.md>) | 文档维护与查阅规则 | 新建、修改、归档前先读 |

## 最近的有效变化

- [知识空间导航与插件设置](<features/space-navigation.md>)。
- [阅读优先与独立编辑](<features/wiki-reading-first.md>)、[长文布局](<features/markdown-reading-layout.md>)。
- [页面内容层级](<features/compact-content-hierarchy.md>)。
- [本地／内网 IP Provider 策略](<architecture/provider-local-ip-policy.md>)：取代早期“全部自定义目标仅公网 HTTPS”的规定。
- 个人设置和 Provider 交付属于阶段证据，入口见当前状态；不可据旧文档推断已支持邮箱修改或所有原生模型协议。

文档维护必须遵循 [维护规范](<guides/documentation-governance.md>)。分类迁移映射保存在 [路径映射](<../scripts/docs-path-map.json>)，旧路径不再作为新文档入口。

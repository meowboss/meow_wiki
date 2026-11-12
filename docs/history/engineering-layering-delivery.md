# 第二批工程分层交付

> 文档性质：历史快照：保留当时事实、测试数字及限制；不代表当前规格。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

2026-11-12。此阶段处理真实职责分离，不新增万能框架。

## 内容模块

Store保持兼容公开API，作为应用事务门面；DatabaseSync/SQL/schema/迁移集中ContentRepository；页面CAS/父子树/删除恢复是无IO纯函数，调用者传时间。新增冻结输入、迁移原文、revision回滚、重开幂等测试。Store不再写SQL，领域不依赖HTTP或DB。

## 知识与提议

KnowledgeApplication承担检索/模型等待/证据复核/提议生成，用例不依赖Fastify；HTTP只做scope与协议。提议路由单独归module；ProposalRepository封装提议SQL、状态转换与证据存在性查询。提议账号上限200，避免无限保存200k草稿。knowledge.ts和components.ts内部SQL/规则仍有耦合，后续按域进一步演进，不谎称已完全clean architecture。

## 前端

受控WikiEditor和WikiWorkspaceView已提取到wiki feature，明确typed props且不自行fetch，应用继续拥有独立编辑版本基线；UI提取不改变CAS/dirty/effect时序。App仍可继续抽编辑器hook与shell状态，不能以减少行数作为唯一质量标准。

## 工程门禁

加入GitHub Actions配置：格式→单元/API/架构→构建→Chromium系统测试，并上传截图。只表示配置落盘，本地验证不等于远端CI已成功。Playwright允许环境选择channel，本机仍用Edge。

## 验证

62项默认测试通过（新增领域/仓储架构测试），TypeScript+Vite构建通过，全部格式检查通过，6条Edge系统用例通过。仍未配置真实模型服务，provider契约用mock验证；未将长期路线图所有功能视为完成。

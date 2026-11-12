# 知识域首批交付与后续顺序

> 文档性质：历史快照：保留当时事实、测试数字及限制；不代表当前规格。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

2026-11-12。实施顺序已加入development-plan和ADR-006：知识域治理→只读MCP→隔离插件SDK/运行时→专用Harness/Provider→审核写入与场景构建。

本批：Domain绑定Workspace但不共享其pages/source；独立reader/contributor/maintainer及owner；按原始caller授权；贡献为独立快照，提交与发布分离，禁止自审，发布CAS推进域版本。构建方案general/project/research/product目前是分类配置，不是已经实现的场景生成管线。

代码按domain纯规则→application service→SQLite repository→HTTP adapter组织，前端独立feature。增加成员可见域不改变activeWorkspace，不假冒owner读取私人知识。域最多20/owner、贡献最多500/domain、单贡献100k字符；域匿名公开与团队workspace不在此批。

验证：68项单元/API/架构测试通过；生产构建/格式检查通过；7条Edge系统流程通过。Domain HTTP验证成员可读域、不可读原workspace，贡献由另一维护者发布后可搜索。Domain浏览器验证创建/提交、自审禁用及pending状态；桌面/390px截图已实际读图，未发现正文遮挡。

尚未实现：MCP服务与凭据、真正场景build执行、域Wiki投影/导出、域审计扩展、插件代码隔离与Harness。MCP SDK仅查询到候选1.32.2/Node>=18/MIT元数据，未安装、未称选型验证通过。

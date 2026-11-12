# 页面历史预算与运行探针

> 文档性质：设计/边界文档：可能含早期目标与原型现状，是否已实现须查当前状态。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

2026-11-12。账号所有空间的page_revisions累计UTF8 JSON预算50MiB；单页最多200版。Store事务内先计算新增revision体积，再写内容/历史/metadata，超额409并完整回滚。旧历史不删除，不静默截断；该预算会阻止进一步产生版本的操作（包括删除/恢复），需要宿主先备份并规划归档，不能宣称删除会自动释放空间。后续应补受审归档工具与生命周期保留容量，当前已在限制中明确。

只读/查看/备份仍可执行；域/资料/工坊预算各自独立，不等于全局磁盘配额。SQLite ownerHistoryBytes在SQL聚合，避免加载全部revision到Node。新测试200版边界及metadata/content/history回滚通过。

/health/live和/health/ready返回最小状态，不含用户数据。ready在应用onReady迁移完成后可服务，探测SQL连通性；不是完整磁盘容量/worker/provider就绪保证。token模式仍受token保护。

109项正式测试、类型/构建与格式检查通过。本批纯后端，无视觉变更。

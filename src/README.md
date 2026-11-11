# 后端模块边界

## 当前装配

- `app.ts`：composition root，只创建依赖、注册生命周期/安全边界与路由。
- `http/`：请求上下文、认证/CSRF/来源/错误边界，禁止领域应用服务反向依赖。
- `modules/pages`：路由校验与页面用例分开；HTTP不负责创建页面快照或组合保存事务。
- `modules/workspaces`：空间用例与聚合读取。
- `modules/extensions`：组件/审核HTTP入口及插件启停用例。
- `identity.ts`：Better Auth基础设施适配。
- `kernel.ts`、`plugins/`：受信能力契约/生命周期与提供者。
- `store.ts`：当前SQLite内容持久化与迁移；仍含部分页面规则，尚待提取领域规则/专属仓储。
- `components.ts`、`knowledge.ts`：当前领域存储服务，SQL与规则尚有耦合，不宣称已经完整repository分层。
- `knowledge-http.ts`：知识/提议路由，后续继续拆到对应modules；不能以当前根文件为最终结构。

## 强制方向

HTTP → 应用服务 → 持久化/能力接口。领域服务不得import Fastify、请求或路由。权限在HTTP解析caller/scope，持久化仍核对owner/workspace；不能因为路由已经检查就开放无scope普通读写。

不要为单实现机械创建factory/interface/base class；当一个模块需要独立替换、事务测试或出现第二提供者时，提取明确端口。目录重构只是第一步，剩余耦合必须继续落实，不能把文件搬家当架构完成。

`tests/architecture.test.ts`维护当前可自动验证依赖约束，未来增量扩充。旧认证实验已移出src，不得重新导入。

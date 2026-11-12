# 工程结构落实记录

> 文档性质：历史快照：保留当时事实、测试数字及限制；不代表当前规格。 [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)

2026-11-12。回应“平铺文件不足以支撑平台演进”的审阅意见，暂停横向扩功能，先做工程边界整顿。

## 本轮已落实

- 后端composition root仅依赖装配；认证/来源/CSRF/错误处理进http；pages/workspaces/extensions按领域拆routes与应用service，页面创建规则不再放路由。
- 前端app负责装配、features按业务归组、shared持有请求客户端/跨功能renderer/通用Modal；禁止feature反向import app和跨feature内部引用，shared不能依赖feature。
- 新增架构依赖测试，纳入默认test；统一Prettier和format:check，压缩长行展开为可读结构。
- 原自写认证实验移到experiments/superseded-auth，退出生产src与默认测试集合。保留原件追溯，不再长期维护双认证真相。
- 对参考两仓补做工程构建/类型/质量配置与代表性模块核验，见reference-engineering-review.md；不声称全文读完或执行过参考项目测试。

## 不是本轮已完成的事项

当前store/components/knowledge仍是SQLite领域存储服务，业务与SQL尚未全部拆开；App仍承担页面编辑状态；共享DTO仍聚合在shared/api，不是正式SDK包；动态UI Slot与独立官方插件包尚未实现。因此这次是明确的第一批工程重构，不把目录调整宣传为最终架构。

下一批优先提取页面持久化/事务端口及知识应用协调，拆编辑器hook/UI；按真实用例提接口而非空泛框架。现有根import路径暂保兼容，后续需同步文档与契约测试。

## 验证

59项默认测试通过（比此前70项少，是淘汰的13项自写认证实验移出默认测试，新增2项依赖规则；不是静默丢正式产品测试）；生产构建通过；全部src/web/tests/e2e格式检查通过；6条Edge系统流程通过。

重构期间首次编译遇到路由提取的残留AccessError引用，服务提取后修复并重测；格式检查4文件未归一已修。测试/构建阶段严格逐命令检查退出码，不以组合命令末尾成功掩盖前序失败。

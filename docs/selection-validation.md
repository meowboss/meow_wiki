# 技术选型验证记录

日期：2026-11-11。用户认可总体方向，并授权后续选型、设计及实施由代理负责。该授权解除此前等待评审的实施前置条件；不免除逐模块验证。

## 身份：采用 Better Auth 1.7.20

包元数据：npm registry返回version=1.7.20、license=MIT。已加入精确版本依赖与锁文件。新增隔离spike，不直接替换业务身份。

官方依据：[Fastify集成](https://better-auth.com/docs/integrations/fastify)、[SQLite适配](https://better-auth.com/docs/adapters/sqlite)、[安装/认证配置](https://better-auth.com/docs/installation)。文档说明支持Node内置DatabaseSync；实际本机测试才作为兼容证据，不凭文档推断集成已完成。

实际测试：tests/auth-selection.test.ts，经Fastify inject真实适配handler，验证：

- Node内存SQLite执行Better Auth schema迁移；再次规划无待创建表。
- email/password注册成功，数据库密码不是明文。
- Set-Cookie独立透传且HttpOnly；携cookie可读取会话。
- 错误密码401、恶意Origin403。
- 注销后旧cookie无法读取会话。
- TypeScript检查通过；全依赖npm审计未报告已知漏洞。

初次spike误用better-auth/db导入getMigrations导致失败；检查包公开exports后改用better-auth/db/migration，重测通过，不依赖内部路径。

尚未证明：生产渗透安全、邮件恢复、OIDC、管理员bootstrap、真实浏览器流程、生产代理IP和完整限流。测试中因inject无客户端IP，库提示共享限流桶；正式handler必须从Fastify已验证remoteAddress映射专用可信头，不能信任任意客户端X-Forwarded-For。应用会话资源授权与CSRF仍需独立覆盖。

决定：正式业务改用成熟库，旧自写密码模块作为可淘汰实验，不能长期维持双认证真相。M0未有真实多人生产账号；未来若已有旧账号需明确迁移/重新认证，不能悄悄丢弃归属。

## 存储：单实例SQLite试运行

保留Node24 DatabaseSync、WAL、显式SQL迁移与关系化页面/revision。首发不做双数据库适配。已具备旧JSON迁移/重启/CAS测试；正在进一步审查隐式写历史与父页删除，未将试运行数据库宣称高并发生产能力。

## 本轮回归结果

存储owner绑定已修复，空间数量限制与多空间集成恢复正常；增加独立连接CAS、隐式改写拒绝、迁移保留字段、父页删除后子页脱离并追加历史测试。全套47/47通过，TypeScript+Vite生产构建通过。注意其中实验认证/组件/知识服务的单测通过，不代表它们已有正式用户入口，也不代表Better Auth已经替换实验登录。

## 下一项验收

1. 修复多空间owner参数遗漏，回归空间数量与隔离。
2. 确定Better Auth正式schema迁移、基础URL、可信来源、管理员初始化与账号恢复策略。
3. 将认证接入与浏览器入口作为独立模块提交；通过后再整合组件市场，避免在未稳定身份上搭审核权限。

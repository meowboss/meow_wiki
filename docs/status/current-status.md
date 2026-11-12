# 当前能力与边界

性质：当前事实入口。更新：2026-11-12（文档分类整理，未在本轮重新执行产品测试）。实现依据为源码与链接中的阶段证据；愿景/旧交付不覆盖本文。

## 用户可用流程

- 邮箱注册/登录/注销、可撤销数据库会话、CSRF、双用户隔离与多工作空间；[个人设置](<../history/personal-settings-delivery.md>)可查看资料与修改昵称，邮箱/角色只读。
- 知识空间[默认阅读、显式编辑](<../features/wiki-reading-first.md>)；保存回阅读、取消确认；[扩大目录/空间管理（概览、插件、隐藏回收站）](<../features/space-navigation.md>)与父级路径。[长文专注与字号](<../features/markdown-reading-layout.md>)支持桌面/移动。
- 页面revision/CAS、历史恢复、软删除、防环父页；[历史导出和显式归档](<../history/history-archive-delivery.md>)已实现。每页200版、账号跨空间历史50MiB UTF8预算；不是全局磁盘配额。
- [JSON活页包](<../architecture/page-transfer-design.md>)100页/5MiB，新ID追加、父ID重映射；不含历史/附件/权限/密钥，不重写正文内部链接，不等于完整Markdown迁移。
- 私有声明式组件、不可变审核release、固定快照安装、首页布局CAS；宿主CLI管理员授权、禁止自审、批准/退回/撤架与审计。
- 文本来源版本化处理/分块/关键词引用检索、删除撤回、账号配额。模型生成提议须人工确认、校验证据/目标revision后原子写入。
- 知识域成员与独立贡献快照、审核CAS、确定性场景汇编；域权限不授予原私人空间。
- 官方MCP SDK域范围read/contribute凭据，摘要分页和预算；只能提交pending，无审核发布工具。

## 两条模型链路

1. **知识问答broker**：宿主配置 `MEOW_MODEL_ENDPOINT/NAME/KEY`，本机HTTP需 `MEOW_MODEL_ALLOW_LOCAL=1`；引用与输出预算由宿主管理。
2. **声明式工坊**：[用户Provider](<../history/provider-settings-delivery.md>)加密保存、模型发现与独立推理测试、多轮对话/受限虚拟文件/8轮工具循环/显式取消和私有保存。当前[具体IP策略](<../architecture/provider-local-ip-policy.md>)允许明确IP的HTTP/HTTPS及内网/回环；域名仍HTTPS+全部DNS公网，拒metadata/link-local/mapped/特殊地址及redirect。前期“custom只能公网HTTPS”已被取代。

两条配置互不自动联动；首批协议是OpenAI-compatible，不能推断支持原生Anthropic/Responses等。真实商业模型质量、费用和语义引用没有独立验收证据；可控HTTP fixture只证明协议链路。

## 插件画布实施进度

[基础增量](<../features/canvas-foundation.md>)已接入首页/知识空间/知识域，共享组合CAS、固定12逻辑列grid/flow/free、实例定位/尺寸/样式/隐藏、文本/搜索和私有/安装组件的独立放置。知识域header/目录/详情已分离共享状态；首页旧布局仍兼容adapter，不修改旧release快照。

[全站插件画布](<../architecture/plugin-canvas.md>)完整目标尚未达成：嵌套布局、媒体/桌宠/背景层、跨页面常驻、动态包registry、事件连线与工坊v2仍待实施，不能把本批当完整C0–C2。实施与迁移见[路线](<../plans/plugin-canvas-roadmap.md>)。

## 工程与运行边界

受信静态插件及声明式组件可用；opaque iframe/MessageChannel/CSP仅受审示例，未开放任意用户JS。工坊虚拟文件不是OS沙箱，也不是完整DSH runtime或跨重启in-flight续跑。

已有SQLite在线备份和完整性/恢复测试，命令见下方。当前单实例自托管试运行；邮件验证/密码找回、OIDC、自助注销、附件、公开分享、反链、向量/embedding/reranker、持久worker集群、通用代码沙箱/SDK分发尚未交付。全局限流/磁盘/费用配额与公网运维加固不完整。GitHub Actions配置存在，不等于远端CI已通过；管理员角色矩阵有API测试，不能称三身份完整浏览器验收。

## 常用命令与查证

```powershell
pnpm test
pnpm check
pnpm build
pnpm format:check
pnpm test:e2e
pnpm test:conversation
pnpm exec tsx src/admin.ts grant <已注册邮箱>
pnpm exec tsx src/backup.ts <全新备份路径>
```

备份还须安全保管认证secret与Provider加密主密钥。恢复先停服务并保全数据库/WAL/SHM，用已验证备份作为 `MEOW_DATABASE` 启动；无一键覆盖恢复承诺。

本机访问 `http://localhost:3000` 和 `http://127.0.0.1:3000` 均支持；Cookie独立。`127.0.0.1` 指后端机器/容器。最近产品验收见[空间导航记录](<../features/space-navigation.md>)，全部历史见[历史索引](<../history/README.md>)；不要把旧测试数字视为当前重跑。

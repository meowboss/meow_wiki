# Meow Wiki 1.0.0 · 单实例自托管版

性质：2026-11-13发布快照与审查记录，不代表未来任意代码插件平台完成。

## 发布范围

- Better Auth账号、私有多工作空间、版本化Wiki与历史恢复、授权检索及知识域/MCP协作。
- 三类页面声明式画布：独立实例、作用域CAS、嵌套布局、主题、素材图层、恢复/草稿导出。
- 对话优先工坊：全视口对话/轨迹、可拖动预览/源码分栏、虚拟项目文件、明确应用或创建导航页、继续编辑与修订历史。
- Provider管理集中于个人设置；密钥写入加密，模型发现与推理测试分开。

## 发布前Review与修复

| 问题 | 修复及回归 |
| --- | --- |
| 素材删除与组合/独立页面保存跨SQLite连接竞态 | 校验、引用扫描与写入纳入事务；双连接回归证明不能同时提交悬空引用 |
| Provider模型响应凭据带引号/反斜杠时重序列化检查漏报 | 直接迭代检查解码字符串与对象key；合成凭据回归覆盖两种转义及深层JSON |
| 个人昵称回调覆盖Provider未保存/请求状态 | 保留聚合dirty/busy报告，不在局部保存完成后清零其它表单状态 |
| 旧工作空间reload闭包覆盖创作页列表/未取消请求 | scope与mounted guard、AbortController、空空间loading清理、响应过滤 |
| 项目弹窗无完整键盘焦点管理 | 初始焦点、Tab圈定、Escape、滚动锁和关闭恢复触发点 |
| 旧组件诊断条数无统一预算 | 最多8条、每条160字符 |
| 无用导入/参数/局部变量 | TypeScript noUnusedLocals/noUnusedParameters启用并通过；保留显式身份检查调用，不为清变量删授权 |

新回归见 [后端竞态](<../../tests/workshop-review-regressions.test.ts>)、[凭据转义](<../../tests/provider-secret-escaping.test.ts>)、[前端生命周期](<../../tests/workshop-ui-lifecycle-regression.test.ts>)。

## 验证

- `pnpm test`：282项通过。
- `pnpm format:check`、`pnpm check`（含未使用符号检查）、生产构建通过。
- `pnpm test:conversation`：组件/页面真实HTTP fixture对话2项通过，不使用商业密钥，不证明模型语义质量。
- `pnpm audit --prod --registry=https://registry.npmjs.org`：本次运行未发现已知漏洞，不等于渗透测试或未来漏洞保证。
- `pnpm test:e2e`：完整43个系统spec共44个真实浏览器测试在1.0发布候选快照一次串行通过；包含登录/旧组件/画布/页面工坊/Provider个人设置等。
- 桌面与390px移动截图留在artifacts/visual，版本号通过构建注入显示于个人设置。

## 运行与升级边界

版本号为1.0.0，个人设置可查看版本。继续面向本地单实例自托管，不应直接暴露公网；启动前备份数据库及身份/Provider主密钥。新代码没有更改已有页面内容、发布快照或用户凭据格式。

- 未开放任意用户TSX/JavaScript执行、动态依赖安装、跨页面常驻与可安装自定义Agent。
- 工坊源码仍为版本化JSON声明；协作/写入工具栏预览部分为明确只读占位。
- 异常并发可能返回storage busy错误，保证不提交悬空素材引用；本次未引入自动重试。
- 构建仍有大包与Zod第三方注解提示，非零错误未被隐藏。
- 没有公网部署渗透测试、生产负载或真实商业模型费用/生成质量验收。

[当前状态](<../status/current-status.md>) · [工坊实现](<../features/workshop-execution-experience.md>)

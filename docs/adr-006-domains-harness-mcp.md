# ADR-006：知识域、插件创作Harness与MCP演进

状态：总体方向已获用户认可；按下列顺序实施，每步保留独立验收，未实现不算完成。2026-11-12。

## 实施顺序

1. 知识域、构建方案与贡献授权：Workspace拥有资源，Domain绑定一个Workspace并有独立成员/治理；不把Domain等同标签，也不把加入Domain等同获取整个Workspace。首批提供独立域资料/贡献快照，不自动共享现有私人页面。
2. 只读MCP：与Web共用Domain应用授权；凭据仅保存摘要、限定域/能力/到期、可撤销。外部Agent身份不能替换成域owner。使用官方SDK验证协议，不自行假造JSONRPC子集。
3. 插件SDK和隔离运行时：先人工开发真实插件，通过manifest、构建契约、跨来源iframe和受限RPC验证，再让Agent生成。声明式组件保留，官方受信代码与用户不可信代码分轨。
4. 专用Harness：用户Provider经secret broker，项目workspace只读SDK与可写项目，网络/构建/资源预算受控；预览用同一运行时。开发沙箱不等于发布后安全。
5. 受审核写入MCP和场景构建：Agent提交提议不直接发布；来源/目标revision重新校验、维护者审核、发布快照与审计。

## 知识域首批模型

Domain{id,workspaceId,ownerId,name,description,buildProfile,revision}，profile先固定general/project/research/product而非任意可执行DSL。Membership{domainId,userId,role:reader|contributor|maintainer}。官方角色不能隐式读取私人内容；官方共维护也需显式成员。owner唯一且不可由贡献者改写。

Contribution{id,domainId,authorId,title,content,expectedDomainRevision,status:pending|published|rejected,reviewerId,reason}。来源快照独立于workspace私人内容；公开范围首期仅成员可见，无匿名发布。reader读published；作者读自己的pending；maintainer审全部pending，禁止自审（owner可另邀维护者）；审核发布CAS推进域revision，旧快照不改写。

现有Wiki page/source不迁移、不自动公开。以后通过显式引用/快照导出到域，访问时不能反向携带owner身份读取原空间。域内容的检索只检索published快照。

## 威胁与强制边界

- 恶意成员枚举其它域：所有repository读取按caller+domain授权，404隐藏不可见；成员管理仅owner。
- Agent越权写入：MCP凭据绑定原始user与域，双重检查当前membership，撤权即时失效。
- 开发代码逃逸：文件系统允许列表不能代替OS隔离；首个执行器需进程/容器或浏览器受控环境，未具备时只允许声明式产物。
- 前端插件窃取Cookie：不动态import同源用户JS；跨源隔离、origin/source/nonce握手，RPC schema与scope，默认禁网络/顶层导航。
- Provider SSRF/密钥泄漏：用户URL受出站broker，密钥不写项目、不进模型上下文和产物；当前固定host模型不等于已支持用户provider。
- 供应链：构建依赖固定、脚本默认不执行；审核绑定不可变摘要，升级重新验证。

## 完成条件

每一步都须有真实用户入口、授权负例、持久化/状态测试、系统测试与截图。先证明边界再扩大工具；不首发完整云IDE/任意后端代码运行。当前阶段不承诺完整团队Wiki或任意场景知识生成已经具备。
